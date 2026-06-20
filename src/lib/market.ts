import { invoke } from "@tauri-apps/api/core";

// User's SteamDT open-platform API key (for price/kline/index endpoints).
export const STEAMDT_KEY = "e71ae37c4d464b1888264e3cceaa8de3";

// Cloudflare Worker that caches the full item catalogue (base endpoint is
// rate-limited to once/day; the Worker absorbs that and serves all clients).
const CATALOGUE_URL = "https://csspeak-market.xrntkk.top/base";

export interface CatalogueItem {
  name: string;
  marketHashName: string;
  platformList: { name: string; itemId: string }[];
}

/// Full searchable item catalogue (name + marketHashName), served from the
/// Worker's daily cache. No image/price here — fetch those on demand.
///
/// When the Worker has `AGENT_ACCESS_TOKEN` configured, pass it here as a
/// Bearer header so the request is not rejected with 401.
export async function marketCatalogue(
  accessToken?: string,
): Promise<CatalogueItem[]> {
  const headers: Record<string, string> = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const resp = await fetch(CATALOGUE_URL, { headers });
  const json = await resp.json();
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error(json.error || "catalogue unavailable");
  }
  return json.data as CatalogueItem[];
}

export interface PlatformPrice {
  platform: string;
  sellPrice: number;
  sellCount: number;
  biddingPrice: number;
  biddingCount: number;
  updateTime: number;
}

export interface MarketListItem {
  itemId: string;
  name: string;
  shortName: string;
  marketHashName: string;
  imageUrl: string;
  rarityColor: string;
  exteriorName: string;
  prices: PlatformPrice[];
}

export interface Candle {
  time: number;
  open: number;
  close: number;
  high: number;
  low: number;
}

export interface BroadIndex {
  index: number;
  diffYesterday: number;
  diffRatio: number;
  updateTime: number;
  history: [number, number][];
}

export interface MarketListPage {
  list: MarketListItem[];
  nextId: string;
}

export function marketList(sortType: number, pageSize: number, nextId = "") {
  return invoke<MarketListPage>("market_list", { sortType, pageSize, nextId });
}

export function marketPriceSingle(marketHashName: string) {
  return invoke<PlatformPrice[]>("market_price_single", {
    key: STEAMDT_KEY,
    marketHashName,
  });
}

export function marketItemKline(
  marketHashName: string,
  platform: string,
  klineType: string,
) {
  return invoke<Candle[]>("market_item_kline", {
    key: STEAMDT_KEY,
    marketHashName,
    platform,
    klineType,
  });
}

export function marketBroadIndex() {
  return invoke<BroadIndex>("market_broad_index", { key: STEAMDT_KEY });
}
