use serde::{Deserialize, Serialize};

const DEMO_BASE_URL: &str = "https://csspeak-market.xrntkk.top";
const DIRECT_UPLOAD_URL: &str = "https://csspeak-market.xrntkk.top/demo/upload";
const MULTIPART_THRESHOLD: usize = 80 * 1024 * 1024; // use multipart above 80 MB
const CHUNK_SIZE: usize = 8 * 1024 * 1024; // 8 MB per part
const MAX_DEMO_SIZE: usize = 120 * 1024 * 1024; // 120 MB total limit (Worker memory)

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoUploadResult {
    pub report_id: String,
    pub url: String,
    pub map: String,
    pub score_ct: i32,
    pub score_t: i32,
    pub duration_seconds: f64,
    pub total_rounds: usize,
}

#[derive(Debug, Deserialize)]
struct WorkerUploadResponse {
    success: bool,
    #[serde(rename = "reportId")]
    report_id: Option<String>,
    url: Option<String>,
    summary: Option<DemoSummary>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DemoSummary {
    map: String,
    #[serde(rename = "scoreCt")]
    score_ct: i32,
    #[serde(rename = "scoreT")]
    score_t: i32,
    #[serde(rename = "durationSeconds")]
    duration_seconds: f64,
    #[serde(rename = "totalRounds")]
    total_rounds: usize,
}

#[derive(Debug, Deserialize)]
struct StartUploadResponse {
    success: bool,
    upload_id: Option<String>,
    key: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UploadPartResponse {
    success: bool,
    part: Option<UploadedPart>,
    error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct UploadedPart {
    part_number: i32,
    etag: String,
}

/// Read a local .dem file and upload it to the csspeak Worker for parsing.
/// Small files use direct upload; large files use R2 multipart upload.
pub async fn upload_demo(path: String) -> Result<DemoUploadResult, String> {
    tracing::info!(path, "uploading demo");
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("无法读取 demo 文件: {e}"))?;
    tracing::info!(size = bytes.len(), "read demo file");

    if bytes.len() > MAX_DEMO_SIZE {
        return Err(format!("demo 文件超过 {MAX_DEMO_SIZE} 限制"));
    }

    let result = if bytes.len() > MULTIPART_THRESHOLD {
        upload_multipart(bytes).await
    } else {
        upload_direct(bytes).await
    };

    result
}

async fn upload_direct(bytes: Vec<u8>) -> Result<DemoUploadResult, String> {
    if bytes.len() > 95 * 1024 * 1024 {
        return Err("demo 文件超过 95MB 直传限制".into());
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(DIRECT_UPLOAD_URL)
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("上传失败: {e}"))?;

    handle_worker_response(resp).await
}

async fn upload_multipart(bytes: Vec<u8>) -> Result<DemoUploadResult, String> {
    let client = reqwest::Client::new();

    // 1. Start multipart upload.
    let start_resp = client
        .post(format!("{DEMO_BASE_URL}/demo/start-upload"))
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("启动分片上传失败: {e}"))?;

    let start_body: StartUploadResponse = start_resp
        .json()
        .await
        .map_err(|e| format!("解析 start-upload 响应失败: {e}"))?;
    if !start_body.success {
        return Err(start_body.error.unwrap_or_else(|| "启动分片上传失败".into()));
    }
    let upload_id = start_body.upload_id.ok_or("Worker 未返回 uploadId")?;
    let key = start_body.key.ok_or("Worker 未返回 key")?;
    tracing::info!(upload_id, key, total_size = bytes.len(), "started multipart upload");

    // 2. Upload each part.
    let total_parts = (bytes.len() + CHUNK_SIZE - 1) / CHUNK_SIZE;
    let mut parts = Vec::with_capacity(total_parts);
    for (idx, chunk) in bytes.chunks(CHUNK_SIZE).enumerate() {
        let part_number = idx + 1;
        tracing::info!(part_number, total_parts, size = chunk.len(), "uploading part");
        let part_resp = client
            .post(format!(
                "{DEMO_BASE_URL}/demo/upload-part?uploadId={upload_id}&key={key}&partNumber={part_number}"
            ))
            .header("Content-Type", "application/octet-stream")
            .body(chunk.to_vec())
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| format!("上传分片 {part_number} 失败: {e}"))?;

        let part_body: UploadPartResponse = part_resp
            .json()
            .await
            .map_err(|e| format!("解析分片 {part_number} 响应失败: {e}"))?;
        if !part_body.success {
            return Err(part_body
                .error
                .unwrap_or_else(|| format!("上传分片 {part_number} 失败")));
        }
        let part = part_body.part.ok_or("Worker 未返回 part")?;
        parts.push(part);
    }

    // 3. Complete multipart upload and trigger parsing.
    tracing::info!(total_parts = parts.len(), "completing multipart upload");
    let complete_resp = client
        .post(format!("{DEMO_BASE_URL}/demo/complete-upload"))
        .json(&serde_json::json!({
            "uploadId": upload_id,
            "key": key,
            "parts": parts,
        }))
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| format!("完成分片上传失败: {e}"))?;

    handle_worker_response(complete_resp).await
}

async fn handle_worker_response(resp: reqwest::Response) -> Result<DemoUploadResult, String> {
    let status = resp.status();
    tracing::info!(status = status.as_u16(), "worker responded");
    let body: WorkerUploadResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析 Worker 响应失败: {e}"))?;

    if !body.success {
        return Err(body.error.unwrap_or_else(|| format!("HTTP {status}")));
    }

    let summary = body.summary.ok_or("Worker 未返回 summary")?;
    Ok(DemoUploadResult {
        report_id: body.report_id.ok_or("Worker 未返回 reportId")?,
        url: body.url.ok_or("Worker 未返回 url")?,
        map: summary.map,
        score_ct: summary.score_ct,
        score_t: summary.score_t,
        duration_seconds: summary.duration_seconds,
        total_rounds: summary.total_rounds,
    })
}

/// Format a demo report summary into a TS chat message that csspeak clients
/// can render as a card, while remaining readable for official TS clients.
pub fn format_demo_share_message(result: &DemoUploadResult) -> String {
    let score_line = if result.score_ct > result.score_t {
        format!("CT {} : {} T", result.score_ct, result.score_t)
    } else {
        format!("T {} : {} CT", result.score_t, result.score_ct)
    };
    let duration_min = (result.duration_seconds / 60.0).floor() as u32;
    let duration_sec = (result.duration_seconds % 60.0) as u32;

    format!(
        "[csspeak:demo] 🎬 {} | {} ({:02}:{:02})\n\
         地图: {} | 回合: {}\n\
         📊 查看完整复盘: {}\n\
         !csspeak:demo:{}",
        result.map,
        score_line,
        duration_min,
        duration_sec,
        result.map,
        result.total_rounds,
        result.url,
        result.report_id,
    )
}
