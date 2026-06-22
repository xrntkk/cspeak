use serde::Serialize;

const WORKER: &str = "https://csspeak-market.xrntkk.top";

fn bearer(token: Option<&str>) -> String {
    format!("Bearer {}", token.unwrap_or(""))
}

/// Build a GET URL with the given path and query pairs (both keys and values
/// are percent-encoded).
fn build_url(path: &str, pairs: &[(&str, &str)]) -> String {
    let mut u = format!("{WORKER}{path}");
    if !pairs.is_empty() {
        u.push('?');
        for (i, (k, v)) in pairs.iter().enumerate() {
            if i > 0 { u.push('&'); }
            u.push_str(&pct(k));
            u.push('=');
            u.push_str(&pct(v));
        }
    }
    u
}

fn pct(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' =>
                out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
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

pub async fn price_single(
    access_token: Option<&str>,
    market_hash_name: &str,
) -> anyhow::Result<Vec<PlatformPrice>> {
    let url = build_url("/price", &[("marketHashName", market_hash_name)]);
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", bearer(access_token))
        .send().await?.json::<serde_json::Value>().await?;
    Ok(parse_prices(resp.get("data")))
}

#[derive(Serialize)]
pub struct Candle {
    pub time: i64,
    pub open: f64,
    pub close: f64,
    pub high: f64,
    pub low: f64,
}

pub async fn item_kline(
    access_token: Option<&str>,
    market_hash_name: &str,
    platform: &str,
    kline_type: &str,
) -> anyhow::Result<Vec<Candle>> {
    let url = build_url("/kline", &[
        ("marketHashName", market_hash_name),
        ("platform", platform),
        ("type", kline_type),
    ]);
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", bearer(access_token))
        .send().await?.json::<serde_json::Value>().await?;
    Ok(parse_candles(resp.get("data")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadIndex {
    pub index: f64,
    pub diff_yesterday: f64,
    pub diff_ratio: f64,
    pub update_time: i64,
    pub history: Vec<(i64, f64)>,
}

pub async fn broad_index(
    access_token: Option<&str>,
) -> anyhow::Result<BroadIndex> {
    let url = build_url("/trend", &[]);
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", bearer(access_token))
        .send().await?.json::<serde_json::Value>().await?;
    let d = resp.get("data").cloned().unwrap_or_default();
    if d.get("broadMarketIndex").is_none() {
        anyhow::bail!("broad index unavailable");
    }
    let history = d.get("historyMarketIndexList")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|row| {
            let r = row.as_array()?;
            Some((as_i64(r.get(0)?), num(r.get(1)?)?))
        }).collect())
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
    pub item_type: String,
    pub prices: Vec<PlatformPrice>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketListPage {
    pub list: Vec<MarketListItem>,
    pub next_id: String,
}

pub async fn market_list(
    access_token: Option<&str>,
    next_id: Option<&str>,
    sort_type: Option<&str>,
) -> anyhow::Result<MarketListPage> {
    let mut pairs: Vec<(&str, &str)> = Vec::new();
    if let Some(n) = next_id.filter(|s| !s.is_empty()) {
        pairs.push(("nextId", n));
    }
    if let Some(s) = sort_type.filter(|s| !s.is_empty()) {
        pairs.push(("sortType", s));
    }
    let url = build_url("/hotlist", &pairs);
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", bearer(access_token))
        .send().await?.json::<serde_json::Value>().await?;

    let next = resp.pointer("/data/nextId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut out = Vec::new();
    if let Some(arr) = resp.pointer("/data/list").and_then(|v| v.as_array()) {
        for it in arr {
            let prices = it.get("sellingPriceList")
                .and_then(|v| v.as_array())
                .map(|ps| ps.iter().map(parse_price).collect())
                .unwrap_or_default();
            out.push(MarketListItem {
                item_id: s(it, "itemId"),          name: s(it, "name"),
                short_name: s(it, "marketShortName"),
                market_hash_name: s(it, "marketHashName"),
                image_url: s(it, "imageUrl"),
                rarity_color: s_or(it, "rarityColor", "#888"),
                exterior_name: s(it, "exteriorName"),
                item_type: normalize_type(&s(it, "itemType")),
                prices,
            });
        }
    }
    Ok(MarketListPage { list: out, next_id: next })
}

fn s(v: &serde_json::Value, key: &str) -> String {
    v.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}
fn s_or(v: &serde_json::Value, key: &str, fallback: &str) -> String {
    v.get(key).and_then(|v| v.as_str()).map(|s| s.to_string()).unwrap_or_else(|| fallback.to_string())
}

/// Normalise the hotlist's itemType (e.g. "CSGO_Type_SniperRifle", "Type_Hands")
/// to the short buckets the /base catalogue uses, so the client filters on one
/// vocabulary regardless of source.
fn normalize_type(raw: &str) -> String {
    match raw {
        "Type_Hands" => "Gloves".to_string(),
        other => other
            .strip_prefix("CSGO_Type_")
            .unwrap_or(other)
            .to_string(),
    }
}

/// price/single returns full fields: platform / sellPrice / sellCount /
/// biddingPrice / biddingCount / updateTime.
fn parse_prices(data: Option<&serde_json::Value>) -> Vec<PlatformPrice> {
    let Some(arr) = data.and_then(|d| d.as_array()) else { return Vec::new(); };
    arr.iter()
        .map(|p| PlatformPrice {
            platform: s(p, "platform"),
            sell_price: p.get("sellPrice").and_then(num).unwrap_or(0.0),
            sell_count: p.get("sellCount").and_then(|v| v.as_i64()).unwrap_or(0),
            bidding_price: p.get("biddingPrice").and_then(num).unwrap_or(0.0),
            bidding_count: p.get("biddingCount").and_then(|v| v.as_i64()).unwrap_or(0),
            update_time: p.get("updateTime").and_then(|v| v.as_i64()).unwrap_or(0),
        })
        .collect()
}

/// hotlist's sellingPriceList uses a leaner shape: platformName / price /
/// lastUpdate (no counts).
fn parse_price(p: &serde_json::Value) -> PlatformPrice {
    PlatformPrice {
        platform: s(p, "platformName"),
        sell_price: p.get("price").and_then(num).unwrap_or(0.0),
        sell_count: 0, bidding_price: 0.0, bidding_count: 0,
        update_time: p.get("lastUpdate").and_then(|v| v.as_i64()).unwrap_or(0),
    }
}

fn parse_candles(data: Option<&serde_json::Value>) -> Vec<Candle> {
    let Some(arr) = data.and_then(|d| d.as_array()) else { return Vec::new(); };
    arr.iter().filter_map(|row| {
        let r = row.as_array()?;
        Some(Candle {
            time: as_i64(r.get(0)?), open: num(r.get(1)?)?,
            close: num(r.get(2)?)?,  high: num(r.get(3)?)?,
            low: num(r.get(4)?)?,
        })
    }).collect()
}

fn num(v: &serde_json::Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn as_i64(v: &serde_json::Value) -> i64 {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0)
}
