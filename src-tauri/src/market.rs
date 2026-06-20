use serde::Serialize;

/// All market data now flows through the Cloudflare Worker, which proxies
/// SteamDT and caches responses at the edge. The desktop client only needs
/// the Worker URL and an optional access token.
const WORKER: &str = "https://csspeak-market.xrntkk.top";

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

fn bearer(token: Option<&str>) -> Option<String> {
    token.map(|t| format!("Bearer {t}"))
}

#[derive(Serialize)]
pub struct PlatformPrice {
    pub platform: String,
    pub sell_price: f64,
    pub sell_count: i64,
    pub bidding_price: f64,
    pub bidding_count: i64,
    pub update_time: i64,
}

/// /price?marketHashName=
pub async fn price_single(
    access_token: Option<&str>,
    market_hash_name: &str,
) -> anyhow::Result<Vec<PlatformPrice>> {
    let resp: serde_json::Value = client()
        .get(format!("{WORKER}/price"))
        .bearer_auth(bearer(access_token))
        .query(&[("marketHashName", market_hash_name)])
        .send()
        .await?
        .json()
        .await?;
    parse_prices(resp.get("data"))
}

#[derive(Serialize)]
pub struct Candle {
    pub time: i64,
    pub open: f64,
    pub close: f64,
    pub high: f64,
    pub low: f64,
}

/// /kline?marketHashName=&platform=&type=
pub async fn item_kline(
    access_token: Option<&str>,
    market_hash_name: &str,
    platform: &str,
    kline_type: &str,
) -> anyhow::Result<Vec<Candle>> {
    let resp: serde_json::Value = client()
        .get(format!("{WORKER}/kline"))
        .bearer_auth(bearer(access_token))
        .query(&[
            ("marketHashName", market_hash_name),
            ("platform", platform),
            ("type", kline_type),
        ])
        .send()
        .await?
        .json()
        .await?;
    Ok(parse_candles(resp.get("data")))
}

#[derive(Serialize)]
pub struct BroadIndex {
    pub index: f64,
    pub diff_yesterday: f64,
    pub diff_ratio: f64,
    pub update_time: i64,
    pub history: Vec<(i64, f64)>,
}

/// /trend
pub async fn broad_index(
    access_token: Option<&str>,
) -> anyhow::Result<BroadIndex> {
    let resp: serde_json::Value = client()
        .get(format!("{WORKER}/trend"))
        .bearer_auth(bearer(access_token))
        .send()
        .await?
        .json()
        .await?;
    let d = resp.get("data").cloned().unwrap_or_default();
    if d.get("broadMarketIndex").is_none() {
        anyhow::bail!(
            "broad index unavailable: {}",
            resp.get("errorMsg").and_then(|v| v.as_str()).unwrap_or("no data"),
        );
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
pub struct MarketListPage {
    pub list: Vec<MarketListItem>,
    pub next_id: String,
}

/// /hotlist  (from the public web API, proxied through the Worker with
///          10 min edge cache — no daily limit, suitable for all users.)
pub async fn market_list(
    access_token: Option<&str>,
) -> anyhow::Result<MarketListPage> {
    let resp: serde_json::Value = client()
        .get(format!("{WORKER}/hotlist"))
        .bearer_auth(bearer(access_token))
        .send()
        .await?
        .json()
        .await?;

    let next = resp
        .pointer("/nextId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut out = Vec::new();
    if let Some(arr) = resp.pointer("/data/list").and_then(|v| v.as_array()) {
        for it in arr {
            let prices = it
                .get("sellingPriceList")
                .and_then(|v| v.as_array())
                .map(|ps| ps.iter().map(parse_price).collect())
                .unwrap_or_default();
            out.push(MarketListItem {
                item_id: it.get("itemId").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: it.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                short_name: it.get("marketShortName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                market_hash_name: it.get("marketHashName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                image_url: it.get("imageUrl").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                rarity_color: it.get("rarityColor").and_then(|v| v.as_str()).unwrap_or("#888").to_string(),
                exterior_name: it.get("exteriorName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                prices,
            });
        }
    }
    Ok(MarketListPage { list: out, next_id: next })
}

// ---- helpers ----

fn parse_prices(data: Option<&serde_json::Value>) -> Vec<PlatformPrice> {
    let Some(arr) = data.and_then(|d| d.as_array()) else { return Vec::new(); };
    arr.iter().map(parse_price).collect()
}

fn parse_price(p: &serde_json::Value) -> PlatformPrice {
    PlatformPrice {
        platform: p.get("platformName").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        sell_price: p.get("price").and_then(num).unwrap_or(0.0),
        sell_count: 0,
        bidding_price: 0.0,
        bidding_count: 0,
        update_time: p.get("lastUpdate").and_then(|v| v.as_i64()).unwrap_or(0),
    }
}

fn parse_candles(data: Option<&serde_json::Value>) -> Vec<Candle> {
    let Some(arr) = data.and_then(|d| d.as_array()) else { return Vec::new(); };
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

fn num(v: &serde_json::Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn as_i64(v: &serde_json::Value) -> i64 {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0)
}
