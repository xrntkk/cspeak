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

/// Fuzzy search over the catalogue. Beyond plain substring matching, it
/// supports multi-keyword queries (space-separated tokens matched in any
/// order, AND semantics — so "ak 红线" and "红线 ak" both hit "AK-47 | 红线")
/// and a subsequence fallback for typo-tolerant English hash names. Results
/// are ranked by relevance: exact > prefix > substring > multi-token > subseq.
export function searchCatalogue(
  catalogue: CatalogueItem[],
  query: string,
  opts?: { limit?: number; typeFilter?: string },
): CatalogueItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const limit = opts?.limit ?? 120;
  const typeFilter = opts?.typeFilter;
  const tokens = q.split(/\s+/).filter(Boolean);
  const compact = q.replace(/\s+/g, "");

  const scored: { item: CatalogueItem; score: number }[] = [];
  for (const it of catalogue) {
    if (typeFilter && it.type !== typeFilter) continue;
    const name = it.name.toLowerCase();
    const hash = it.marketHashName.toLowerCase();
    const score = scoreCatalogueItem(name, hash, q, tokens, compact);
    if (score > 0) scored.push({ item: it, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}

function scoreCatalogueItem(
  name: string,
  hash: string,
  q: string,
  tokens: string[],
  compact: string,
): number {
  if (name === q || hash === q) return 1000;
  if (name.startsWith(q) || hash.startsWith(q)) return 800;
  if (name.includes(q) || hash.includes(q)) return 600;
  if (tokens.length > 1) {
    const all = tokens.every((t) => name.includes(t) || hash.includes(t));
    if (all) return 400;
  }
  if (isSubsequence(compact, name) || isSubsequence(compact, hash)) return 200;
  return 0;
}

/// True when every char of `needle` appears in `haystack` in order (gaps ok).
function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return false;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
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
