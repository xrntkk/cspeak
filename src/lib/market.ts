import { invoke } from "@tauri-apps/api/core";

// Cloudflare Worker that proxies all SteamDT market APIs and caches them.
// The SteamDT API key lives ONLY in the Worker secret — never shipped to clients. (base endpoint is
// rate-limited to once/day; the Worker absorbs that and serves all clients).
const CATALOGUE_URL = "https://csspeak-market.xrntkk.top/base";

export interface CatalogueItem {
  name: string;
  marketHashName: string;
  platformList: { name: string; itemId: string }[];
  type?: string;
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
  itemType: string;
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

export function marketList(
  accessToken?: string,
  nextId?: string,
  sortType?: string,
) {
  return invoke<MarketListPage>("market_list", {
    accessToken: accessToken ?? null,
    nextId: nextId ?? null,
    sortType: sortType ?? null,
  });
}

export function marketPriceSingle(
  accessToken: string | undefined,
  marketHashName: string,
) {
  return invoke<PlatformPrice[]>("market_price_single", {
    accessToken: accessToken ?? null,
    marketHashName,
  });
}

export function marketItemKline(
  accessToken: string | undefined,
  marketHashName: string,
  platform: string,
  klineType: string,
) {
  return invoke<Candle[]>("market_item_kline", {
    accessToken: accessToken ?? null,
    marketHashName,
    platform,
    klineType,
  });
}

export function marketBroadIndex(accessToken?: string) {
  return invoke<BroadIndex>("market_broad_index", { accessToken: accessToken ?? null });
}
