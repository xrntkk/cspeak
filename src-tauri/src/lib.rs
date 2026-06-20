mod audio;
mod connection;
mod identity;
mod market;
mod state;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use connection::{Cmd, ConnManager};
use serde::Serialize;
use tauri::{Emitter, Manager};

struct AppState {
    conn: Mutex<Option<ConnManager>>,
}

#[tauri::command]
fn connect(state: tauri::State<AppState>, address: String, nickname: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::Connect { address, nickname });
    }
}

#[tauri::command]
fn disconnect(state: tauri::State<AppState>) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::Disconnect);
    }
}

#[tauri::command]
fn set_muted(state: tauri::State<AppState>, muted: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetMuted(muted));
    }
}

#[tauri::command]
fn set_deafened(state: tauri::State<AppState>, deafened: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetDeafened(deafened));
    }
}

#[tauri::command]
fn join_channel(state: tauri::State<AppState>, channel: u64) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::JoinChannel(channel));
    }
}

#[tauri::command]
fn list_devices() -> (Vec<String>, Vec<String>) {
    audio::list_devices()
}

#[tauri::command]
fn set_input_device(state: tauri::State<AppState>, name: Option<String>) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetInputDevice(name));
    }
}

#[tauri::command]
fn set_output_device(state: tauri::State<AppState>, name: Option<String>) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetOutputDevice(name));
    }
}

#[tauri::command]
fn set_mic_gain(state: tauri::State<AppState>, gain: f32) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetMicGain(gain));
    }
}

#[tauri::command]
fn set_spk_gain(state: tauri::State<AppState>, gain: f32) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetSpkGain(gain));
    }
}

#[tauri::command]
fn set_sensitivity(state: tauri::State<AppState>, threshold: f32) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetSensitivity(threshold));
    }
}

#[tauri::command]
fn set_ptt_enabled(state: tauri::State<AppState>, enabled: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetPttEnabled(enabled));
    }
}

#[tauri::command]
fn set_ptt_active(state: tauri::State<AppState>, active: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetPttActive(active));
    }
}

#[tauri::command]
fn set_apm_enabled(state: tauri::State<AppState>, enabled: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetApmEnabled(enabled));
    }
}

#[tauri::command]
fn set_denoise_mode(state: tauri::State<AppState>, mode: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetDenoiseMode(mode));
    }
}

#[tauri::command]
fn set_client_volume(state: tauri::State<AppState>, client: u16, volume: f32) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetClientVolume { client, volume });
    }
}

#[tauri::command]
fn set_mic_test(state: tauri::State<AppState>, on: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SetMicTest(on));
    }
}

#[tauri::command]
fn list_channel_files(state: tauri::State<AppState>, channel: u64) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::ListChannelFiles(channel));
    }
}

#[tauri::command]
fn download_file(
    state: tauri::State<AppState>,
    channel: u64,
    path: String,
    save_to: String,
) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::DownloadFile {
            channel,
            path,
            save_to: PathBuf::from(save_to),
        });
    }
}

#[tauri::command]
fn upload_file(
    state: tauri::State<AppState>,
    channel: u64,
    path: String,
    file: String,
) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::UploadFile {
            channel,
            path,
            file: PathBuf::from(file),
        });
    }
}

#[tauri::command]
fn send_chat(state: tauri::State<AppState>, target: String, message: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::SendChat { target, message });
    }
}

#[tauri::command]
fn join_channel_pw(state: tauri::State<AppState>, channel: u64, password: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::JoinChannelPw { channel, password });
    }
}

#[tauri::command]
fn poke(state: tauri::State<AppState>, client: u16, message: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::Poke { client, message });
    }
}

#[tauri::command]
fn kick_client(state: tauri::State<AppState>, client: u16, message: String, from_server: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::KickClient { client, message, from_server });
    }
}

#[tauri::command]
fn mute_client(state: tauri::State<AppState>, client: u16, mute: bool) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::MuteClient { client, mute });
    }
}

#[tauri::command]
fn request_connection_info(state: tauri::State<AppState>, client: u16) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::RequestConnectionInfo(client));
    }
}

#[tauri::command]
fn use_privilege_key(state: tauri::State<AppState>, token: String) {
    if let Some(conn) = state.conn.lock().unwrap().as_ref() {
        conn.send(Cmd::UsePrivilegeKey(token));
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAsset {
    name: String,
    url: String,
    size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current_version: String,
    latest_version: Option<String>,
    download_url: Option<String>,
    release_notes: Option<String>,
    assets: Vec<UpdateAsset>,
    recommended_asset: Option<UpdateAsset>,
}

/// Pick the asset that matches the current OS/arch for in-app installation.
fn find_recommended_asset(assets: &[UpdateAsset]) -> Option<UpdateAsset> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    // Priority order per platform.
    let priorities: Vec<Box<dyn Fn(&str) -> bool>> = match (os, arch) {
        ("macos", "aarch64") => vec![
            Box::new(|n: &str| n.ends_with(".dmg") && (n.contains("aarch64") || n.contains("arm64"))),
        ],
        ("macos", "x86_64") => vec![
            Box::new(|n: &str| n.ends_with(".dmg") && (n.contains("x64") || n.contains("x86_64"))),
        ],
        ("windows", _) => vec![
            Box::new(|n: &str| n.ends_with(".msi")),
            Box::new(|n: &str| n.ends_with(".exe")),
        ],
        ("linux", _) => vec![
            Box::new(|n: &str| n.ends_with(".appimage")),
            Box::new(|n: &str| n.ends_with(".deb")),
        ],
        _ => vec![],
    };

    for matcher in &priorities {
        if let Some(a) = assets.iter().find(|a| matcher(&a.name.to_lowercase())) {
            return Some(a.clone());
        }
    }
    None
}

#[tauri::command]
async fn check_update() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/repos/xrntkk/cspeak/releases/latest")
        .header("User-Agent", "csspeak-updater")
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let tag = json["tag_name"].as_str().unwrap_or("").trim_start_matches('v');
    let latest_version = if tag.is_empty() { None } else { Some(tag.to_string()) };
    let download_url = json["html_url"].as_str().map(String::from);
    let release_notes = json["body"].as_str().map(String::from);

    let assets: Vec<UpdateAsset> = json["assets"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    Some(UpdateAsset {
                        name: a["name"].as_str()?.to_string(),
                        url: a["browser_download_url"].as_str()?.to_string(),
                        size: a["size"].as_u64().unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let recommended_asset = find_recommended_asset(&assets);

    Ok(UpdateInfo {
        current_version,
        latest_version,
        download_url,
        release_notes,
        assets,
        recommended_asset,
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
}

/// Download an update asset to a temp file, emitting progress events.
/// Returns the local file path on success.
#[tauri::command]
async fn download_update(
    app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("User-Agent", "csspeak-updater")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let save_path = std::env::temp_dir().join(&filename);

    let mut file = tokio::fs::File::create(&save_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emitted: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        // Throttle progress events: emit at most every 100 KB.
        if downloaded - last_emitted >= 100_000 || (total > 0 && downloaded == total) {
            let _ = app.emit(
                "update-download-progress",
                DownloadProgress { downloaded, total },
            );
            last_emitted = downloaded;
        }
    }

    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    // Make AppImage executable on Linux so it can be launched directly.
    #[cfg(target_os = "linux")]
    {
        if filename.ends_with(".AppImage") {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&save_path)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&save_path, perms).map_err(|e| e.to_string())?;
        }
    }

    Ok(save_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn market_price_single(
    access_token: Option<String>,
    market_hash_name: String,
) -> Result<Vec<market::PlatformPrice>, String> {
    market::price_single(access_token.as_deref(), &market_hash_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn market_item_kline(
    access_token: Option<String>,
    market_hash_name: String,
    platform: String,
    kline_type: String,
) -> Result<Vec<market::Candle>, String> {
    market::item_kline(access_token.as_deref(), &market_hash_name, &platform, &kline_type)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn market_broad_index(
    access_token: Option<String>,
) -> Result<market::BroadIndex, String> {
    market::broad_index(access_token.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn market_list(
    access_token: Option<String>,
) -> Result<market::MarketListPage, String> {
    market::market_list(access_token.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            conn: Mutex::new(None),
        })
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let manager = ConnManager::spawn(app.handle().clone(), config_dir);
            app.state::<AppState>().conn.lock().unwrap().replace(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            set_muted,
            set_deafened,
            join_channel,
            list_devices,
            set_input_device,
            set_output_device,
            set_mic_gain,
            set_spk_gain,
            set_sensitivity,
            set_ptt_enabled,
            set_ptt_active,
            set_apm_enabled,
            set_denoise_mode,
            set_client_volume,
            set_mic_test,
            list_channel_files,
            download_file,
            upload_file,
            send_chat,
            join_channel_pw,
            poke,
            kick_client,
            mute_client,
            request_connection_info,
            use_privilege_key,
            check_update,
            download_update,
            market_price_single,
            market_item_kline,
            market_broad_index,
            market_list
        ])
        .on_window_event(|window, event| {
            // Disconnect cleanly before the window closes, so the server
            // releases our connection (avoids ClientTooManyClonesConnected).
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(conn) = window.state::<AppState>().conn.lock().unwrap().as_ref() {
                    conn.shutdown_blocking();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
