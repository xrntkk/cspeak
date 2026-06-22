import {
  marketBroadIndex,
  marketCatalogue,
  searchCatalogue,
  marketItemKline,
  marketList,
  marketPriceSingle,
  type CatalogueItem,
} from "@/lib/market";
import { sendChat, poke, type ServerSnapshot } from "@/lib/ipc";
import type { AgentToolContext } from "@/lib/agent-types";

export const TOOL_LABELS: Record<string, string> = {
  getMarketIndex: "查询大盘指数",
  searchItems: "搜索饰品",
  getHotList: "获取热门榜单",
  getItemPrice: "查询多平台价格",
  getItemKline: "获取K线数据",
  compareItems: "对比饰品价格",
  getItemHistory: "分析价格趋势",
  analyzePortfolio: "库存估值分析",
  getSteamInventory: "查询 Steam 库存",
  sendChannelMessage: "发送频道消息",
  sendServerMessage: "发送全服消息",
  sendPrivateMessage: "发送私信",
  pokeClient: "戳用户",
  listChannels: "列出频道",
  listOnlineClients: "列出在线用户",
};

let catalogueCache: CatalogueItem[] | null = null;

async function getCatalogue(accessToken?: string): Promise<CatalogueItem[]> {
  if (catalogueCache) return catalogueCache;
  try {
    catalogueCache = await marketCatalogue(accessToken);
    return catalogueCache;
  } catch {
    return [];
  }
}

/// Translate raw Tauri/reqwest error strings into friendlier Chinese text.
function describeIpcError(msg: string): string {
  if (msg.includes("401")) return "访问令牌无效或未填写";
  if (msg.includes("429")) return "请求过于频繁，请稍后再试";
  if (msg.includes("404")) return "接口不存在，请检查后端是否已部署最新版本";
  if (msg.includes("502") || msg.includes("503") || msg.includes("504"))
    return "上游服务暂时不可用";
  if (msg.includes("broad index unavailable"))
    return "大盘指数数据暂不可用（可能被限流，稍后重试）";
  return msg;
}

/// Execute a client-side tool call emitted by the CS Agent model.
export async function executeClientTool(
  name: string,
  input: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  try {
    return await runTool(name, input, ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `[${name}] ${describeIpcError(msg)}` };
  }
}

async function runTool(
  name: string,
  input: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  const accessToken = ctx.accessToken;
  const args = (input ?? {}) as Record<string, unknown>;

  switch (name) {
    case "getMarketIndex": {
      const idx = await marketBroadIndex(accessToken);
      return {
        index: +idx.index.toFixed(2),
        diffYesterday: +idx.diffYesterday.toFixed(2),
        diffRatio: +idx.diffRatio.toFixed(2),
        trend: idx.diffYesterday >= 0 ? "up" : "down",
        historyPoints: idx.history.length,
        recentHistory: idx.history.slice(-10),
      };
    }

    case "searchItems": {
      const keyword = String(args.keyword ?? "").trim();
      if (!keyword) return { matches: [], total: 0 };
      const cat = await getCatalogue(accessToken);
      const matches = searchCatalogue(cat, keyword, { limit: 20 }).map((it) => ({
        name: it.name,
        marketHashName: it.marketHashName,
      }));
      return { matches, total: cat.length };
    }

    case "getHotList": {
      const page = await marketList(accessToken);
      const items = page.list.map((it) => {
        const valid = it.prices
          .filter((p) => p.sellPrice > 0)
          .sort((a, b) => a.sellPrice - b.sellPrice);
        const lowest = valid[0];
        const highest = valid[valid.length - 1];
        const spread =
          lowest && highest && highest.sellPrice > lowest.sellPrice
            ? ((highest.sellPrice - lowest.sellPrice) / lowest.sellPrice) * 100
            : 0;
        return {
          shortName: it.shortName,
          marketHashName: it.marketHashName,
          exterior: it.exteriorName,
          imageUrl: it.imageUrl,
          lowestPlatform: lowest?.platform ?? null,
          lowestPrice: lowest?.sellPrice ?? null,
          highestPlatform: highest?.platform ?? null,
          highestPrice: highest?.sellPrice ?? null,
          spread: +spread.toFixed(2),
        };
      });
      return { items };
    }

    case "getItemPrice": {
      const mhn = String(args.marketHashName ?? "");
      if (!mhn) return { error: "marketHashName is required" };
      const prices = await marketPriceSingle(accessToken, mhn);
      return {
        marketHashName: mhn,
        prices: prices
          .filter((p) => p.sellPrice > 0 || p.biddingPrice > 0)
          .map((p) => ({
            platform: p.platform,
            sellPrice: p.sellPrice,
            sellCount: p.sellCount,
            biddingPrice: p.biddingPrice,
            biddingCount: p.biddingCount,
          })),
      };
    }

    case "getItemKline":
    case "getItemHistory": {
      const mhn = String(args.marketHashName ?? "");
      const platform = String(args.platform ?? "YOUPIN");
      const klineType = String(args.klineType ?? "1");
      if (!mhn) return { error: "marketHashName is required" };
      const candles = await marketItemKline(accessToken, mhn, platform, klineType);
      const recent = candles.slice(-30);
      if (recent.length === 0) return { platform, klineType, candles: [], summary: null };

      const first = recent[0];
      const last = recent[recent.length - 1];
      const high = Math.max(...recent.map((c) => c.high));
      const low = Math.min(...recent.map((c) => c.low));
      const change =
        first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0;

      const base = {
        platform,
        klineType,
        candleCount: recent.length,
        summary: {
          startPrice: +first.open.toFixed(2),
          endPrice: +last.close.toFixed(2),
          change: +change.toFixed(2),
          high: +high.toFixed(2),
          low: +low.toFixed(2),
        },
      };

      if (name === "getItemHistory") {
        const closes = recent.map((c) => c.close);
        const ma5 = closes.length >= 5 ? avg(closes.slice(-5)) : null;
        const ma10 = closes.length >= 10 ? avg(closes.slice(-10)) : null;
        const volatility = stdDev(closes);
        return {
          ...base,
          ma5: ma5 != null ? +ma5.toFixed(2) : null,
          ma10: ma10 != null ? +ma10.toFixed(2) : null,
          volatility: +volatility.toFixed(2),
        };
      }

      return base;
    }

    case "compareItems": {
      const names = (args.marketHashNames ?? []) as string[];
      if (names.length < 2) return { error: "至少需要 2 个饰品进行对比" };
      const results = await Promise.all(
        names.map(async (mhn) => {
          const prices = await marketPriceSingle(accessToken, mhn);
          const valid = prices.filter((p) => p.sellPrice > 0).sort((a, b) => a.sellPrice - b.sellPrice);
          const lowest = valid[0] ?? null;
          const highest = valid[valid.length - 1] ?? null;
          const spread =
            lowest && highest && highest.sellPrice > lowest.sellPrice
              ? ((highest.sellPrice - lowest.sellPrice) / lowest.sellPrice) * 100
              : 0;
          return {
            marketHashName: mhn,
            platformCount: valid.length,
            lowestPlatform: lowest?.platform ?? null,
            lowestPrice: lowest?.sellPrice ?? null,
            highestPlatform: highest?.platform ?? null,
            highestPrice: highest?.sellPrice ?? null,
            spread: +spread.toFixed(2),
          };
        }),
      );
      return { comparisons: results };
    }

    case "analyzePortfolio": {
      const items = (args.items ?? []) as Array<{
        marketHashName: string;
        quantity?: number;
        avgBuyPrice?: number;
      }>;
      if (items.length === 0) return { error: "请提供至少一个饰品" };

      const evaluated = await Promise.all(
        items.map(async (it) => {
          const qty = Number(it.quantity ?? 1);
          const prices = await marketPriceSingle(accessToken, it.marketHashName);
          const valid = prices.filter((p) => p.sellPrice > 0).sort((a, b) => a.sellPrice - b.sellPrice);
          const currentPrice = valid[0]?.sellPrice ?? 0;
          const currentValue = currentPrice * qty;
          const cost = it.avgBuyPrice != null ? it.avgBuyPrice * qty : null;
          const pnl = cost != null ? currentValue - cost : null;
          const pnlRatio = cost != null && cost > 0 ? (pnl! / cost) * 100 : null;
          return {
            marketHashName: it.marketHashName,
            quantity: qty,
            currentPrice,
            currentValue,
            avgBuyPrice: it.avgBuyPrice ?? null,
            cost,
            pnl: pnl != null ? +pnl.toFixed(2) : null,
            pnlRatio: pnlRatio != null ? +pnlRatio.toFixed(2) : null,
          };
        }),
      );

      const totalValue = evaluated.reduce((sum, it) => sum + it.currentValue, 0);
      const totalCost = evaluated.reduce(
        (sum, it) => sum + (it.cost ?? 0),
        0,
      );
      const totalPnl = totalCost > 0 ? totalValue - totalCost : null;
      const topItem = [...evaluated].sort((a, b) => b.currentValue - a.currentValue)[0];
      const concentration = totalValue > 0 && topItem ? (topItem.currentValue / totalValue) * 100 : 0;

      return {
        totalValue: +totalValue.toFixed(2),
        totalCost: totalCost > 0 ? +totalCost.toFixed(2) : null,
        totalPnl: totalPnl != null ? +totalPnl.toFixed(2) : null,
        concentration: +concentration.toFixed(2),
        items: evaluated,
      };
    }

    case "getSteamInventory": {
      const steamId = String(args.steamId ?? "").trim();
      const appId = String(args.gameAppId ?? "730");
      if (!steamId) return { error: "steamId 不能为空" };
      const resp = await fetch(
        `https://csspeak-market.xrntkk.top/steam/inventory?steamId=${encodeURIComponent(
          steamId,
        )}&appId=${encodeURIComponent(appId)}`,
        { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
      );
      const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      if (!resp.ok) {
        return { error: json.error ?? `Steam 库存查询失败 (${resp.status})` };
      }
      const assets = (json.assets ?? []) as Array<Record<string, unknown>>;
      const descriptions = (json.descriptions ?? []) as Array<Record<string, unknown>>;
      const items = assets.slice(0, 50).map((asset) => {
        const desc = descriptions.find(
          (d) =>
            String(d.classid) === String(asset.classid) &&
            String(d.instanceid) === String(asset.instanceid),
        );
        return {
          marketHashName: String(desc?.market_hash_name ?? ""),
          name: String(desc?.name ?? ""),
        };
      });
      return {
        steamId,
        totalItems: assets.length,
        previewCount: items.length,
        items,
      };
    }

    case "sendChannelMessage": {
      if (!ctx.connected) return { error: "未连接 TS 服务器，无法发送消息" };
      const message = String(args.message ?? "");
      if (!message) return { error: "消息内容不能为空" };
      await sendChat("channel", message);
      return { success: true, scope: "channel" };
    }

    case "sendServerMessage": {
      if (!ctx.connected) return { error: "未连接 TS 服务器，无法发送消息" };
      const message = String(args.message ?? "");
      if (!message) return { error: "消息内容不能为空" };
      await sendChat("server", message);
      return { success: true, scope: "server" };
    }

    case "sendPrivateMessage": {
      if (!ctx.connected || !ctx.snapshot) return { error: "未连接 TS 服务器" };
      const clientName = String(args.clientName ?? "").trim();
      const message = String(args.message ?? "");
      if (!clientName) return { error: "clientName 不能为空" };
      if (!message) return { error: "消息内容不能为空" };
      const target = ctx.snapshot.clients.find(
        (c) => c.name === clientName || c.name.includes(clientName),
      );
      if (!target) return { error: `未找到用户「${clientName}」` };
      if (target.id === ctx.snapshot.ownClient) return { error: "不能给自己发私信" };
      await sendChat("private", message, target.id);
      return { success: true, target: target.name };
    }

    case "pokeClient": {
      if (!ctx.connected || !ctx.snapshot) return { error: "未连接 TS 服务器" };
      const clientName = String(args.clientName ?? "").trim();
      const message = String(args.message ?? "");
      if (!clientName) return { error: "clientName 不能为空" };
      const target = ctx.snapshot.clients.find(
        (c) => c.name === clientName || c.name.includes(clientName),
      );
      if (!target) return { error: `未找到用户「${clientName}」` };
      if (target.id === ctx.snapshot.ownClient) return { error: "不能戳自己" };
      await poke(target.id, message);
      return { success: true, target: target.name };
    }

    case "listChannels": {
      if (!ctx.connected || !ctx.snapshot) return { error: "未连接 TS 服务器" };
      return {
        channels: ctx.snapshot.channels
          .sort((a, b) => a.order - b.order)
          .map((ch) => ({ id: ch.id, name: ch.name })),
      };
    }

    case "listOnlineClients": {
      if (!ctx.connected || !ctx.snapshot) return { error: "未连接 TS 服务器" };
      return {
        clients: ctx.snapshot.clients.map((c) => {
          const ch = (ctx.snapshot as ServerSnapshot).channels.find((x) => x.id === c.channel);
          return { id: c.id, name: c.name, channel: ch?.name ?? "未知" };
        }),
      };
    }

    default:
      return { error: `未知工具: ${name}` };
  }
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = avg(values);
  const variance = avg(values.map((v) => Math.pow(v - mean, 2)));
  return Math.sqrt(variance);
}
