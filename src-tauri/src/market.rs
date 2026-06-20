use serde::Serialize;
use serde_json::json;

const BASE: &str = "https://open.steamdt.com";
/// Public web API (no auth) — used for browsing the item list, since the
/// official `base` endpoint is rate-limited to once per day.
const WEB_BASE: &str = "https://www.steamdt.com/api";

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformPrice {
    pub platform: String,
    pub sell_price: f64,
    pub sell_count: i64,
    pub bidding_price: f64,
    pub bidding_count: i64,
    pub update_time: i64,
}

/// Per-platform prices for one item via /open/cs2/v1/price/single.
pub async fn price_single(key: &str, market_hash_name: &str) -> anyhow::Result<Vec<PlatformPrice>> {
    let encoded = urlencode(market_hash_name);
    let resp = client()
        .get(format!("{BASE}/open/cs2/v1/price/single?marketHashName={encoded}"))
        .bearer_auth(key)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    let mut out = Vec::new();
    if let Some(arr) = resp.get("data").and_then(|d| d.as_array()) {
        for p in arr {
            out.push(PlatformPrice {
                platform: p.get("platform").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                sell_price: p.get("sellPrice").and_then(num).unwrap_or(0.0),
                sell_count: p.get("sellCount").and_then(|v| v.as_i64()).unwrap_or(0),
                bidding_price: p.get("biddingPrice").and_then(num).unwrap_or(0.0),
                bidding_count: p.get("biddingCount").and_then(|v| v.as_i64()).unwrap_or(0),
                update_time: p.get("updateTime").and_then(|v| v.as_i64()).unwrap_or(0),
            });
        }
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct Candle {
    pub time: i64,
    pub open: f64,
    pub close: f64,
    pub high: f64,
    pub low: f64,
}

/// Item OHLC candles via /open/cs2/item/v1/kline.
/// Returns rows of [timestamp, open, close, high, low].
pub async fn item_kline(
    key: &str,
    market_hash_name: &str,
    platform: &str,
    kline_type: &str,
) -> anyhow::Result<Vec<Candle>> {
    let resp = client()
        .post(format!("{BASE}/open/cs2/item/v1/kline"))
        .bearer_auth(key)
        .json(&json!({
            "marketHashName": market_hash_name,
            "platform": platform,
            "type": kline_type,
        }))
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    Ok(parse_candles(resp.get("data")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadIndex {
    pub index: f64,
    pub diff_yesterday: f64,
    pub diff_ratio: f64,
    pub update_time: i64,
    /// [timestamp, value] points.
    pub history: Vec<(i64, f64)>,
}

/// Big-board market index via /open/cs2/broad/v1/index.
pub async fn broad_index(key: &str) -> anyhow::Result<BroadIndex> {
    let resp = client()
        .get(format!("{BASE}/open/cs2/broad/v1/index"))
        .bearer_auth(key)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    let d = resp.get("data").cloned().unwrap_or(serde_json::Value::Null);
    // Fail loudly when the API returns no data (e.g. rate-limited), so the
    // frontend can hide the card instead of showing a zeroed-out index.
    if d.is_null() || d.get("broadMarketIndex").is_none() {
        let msg = resp.get("errorMsg").and_then(|v| v.as_str()).unwrap_or("no data");
        anyhow::bail!("broad index unavailable: {msg}");
    }
    let history = d
        .get("historyMarketIndexList")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|row| {
                    let r = row.as_array()?;
                    Some((as_i64(r.get(0)?), num(r.get(1)?)?))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(BroadIndex {
        index: d.get("broadMarketIndex").and_then(num).unwrap_or(0.0),
        diff_yesterday: d.get("diffYesterday").and_then(num).unwrap_or(0.0),
        diff_ratio: d.get("diffYesterdayRatio").and_then(num).unwrap_or(0.0),
        update_time: d.get("updateTime").and_then(|v| v.as_i64()).unwrap_or(0),
        history,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketListItem {
    pub item_id: String,
    pub name: String,
    pub short_name: String,
    pub market_hash_name: String,
    pub image_url: String,
    pub rarity_color: String,
    pub exterior_name: String,
    pub prices: Vec<PlatformPrice>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketListPage {
    pub list: Vec<MarketListItem>,
    pub next_id: String,
}

/// Browse the market list via the public web API (no auth, no daily limit —
/// suitable for multiple users). Cursor-paginated via `nextId`; pass an empty
/// string for the first page. `sort_type` controls ordering.
pub async fn market_list(
    sort_type: i64,
    page_size: i64,
    next_id: &str,
) -> anyhow::Result<MarketListPage> {
    let mut body = json!({ "sortType": sort_type, "pageSize": page_size });
    if !next_id.is_empty() {
        body["nextId"] = json!(next_id);
    }
    let resp = client()
        .post(format!("{WEB_BASE}/skin/market/v1/list"))
        .header("Language", "zh_CN")
        .json(&body)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    let next = resp
        .pointer("/data/nextId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut out = Vec::new();
    if let Some(arr) = resp.pointer("/data/list").and_then(|v| v.as_array()) {
        for it in arr {
            let prices = it
                .get("sellingPriceList")
                .and_then(|v| v.as_array())
                .map(|ps| {
                    ps.iter()
                        .map(|p| PlatformPrice {
                            platform: p
                                .get("platformName")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            sell_price: p.get("price").and_then(num).unwrap_or(0.0),
                            sell_count: 0,
                            bidding_price: 0.0,
                            bidding_count: 0,
                            update_time: p.get("lastUpdate").and_then(|v| v.as_i64()).unwrap_or(0),
                        })
                        .collect()
                })
                .unwrap_or_default();
            out.push(MarketListItem {
                item_id: it.get("itemId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: it.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                short_name: it
                    .get("marketShortName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                market_hash_name: it
                    .get("marketHashName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                image_url: it.get("imageUrl").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                rarity_color: it
                    .get("rarityColor")
                    .and_then(|v| v.as_str())
                    .unwrap_or("#888")
                    .to_string(),
                exterior_name: it
                    .get("exteriorName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                prices,
            });
        }
    }
    Ok(MarketListPage { list: out, next_id: next })
}

fn parse_candles(data: Option<&serde_json::Value>) -> Vec<Candle> {
    let Some(arr) = data.and_then(|d| d.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|row| {
            let r = row.as_array()?;
            Some(Candle {
                time: as_i64(r.get(0)?),
                open: num(r.get(1)?)?,
                close: num(r.get(2)?)?,
                high: num(r.get(3)?)?,
                low: num(r.get(4)?)?,
            })
        })
        .collect()
}

/// Numbers from this API arrive as either JSON numbers or numeric strings.
fn num(v: &serde_json::Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn as_i64(v: &serde_json::Value) -> i64 {
    v.as_i64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0)
}

/// Minimal percent-encoding for query values (the API key is fixed; only the
/// market hash name needs escaping for spaces and special chars).
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
