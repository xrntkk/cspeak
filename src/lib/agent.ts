import { DefaultChatTransport } from "ai";
import {
  marketBroadIndex,
  marketCatalogue,
  marketList,
  marketPriceSingle,
  marketItemKline,
  type CatalogueItem,
} from "@/lib/market";
import { sendChat, poke, type ServerSnapshot } from "@/lib/ipc";

/// Default CS Agent endpoint (same Cloudflare Worker that serves the catalogue).
export const AGENT_ENDPOINT_DEFAULT =
  "https://csspeak-market.xrntkk.top/agent";

export interface AgentToolContext {
  /// Whether the TS client is currently connected to a server.
  connected: boolean;
  /// Latest server snapshot (channels + clients), needed by messaging tools.
  snapshot: ServerSnapshot | null;
  /// Optional bearer token for Worker access control (AGENT_ACCESS_TOKEN).
  accessToken?: string;
}

/// Build a stable chat transport for the CS Agent worker endpoint.
/// An optional access token is sent as a Bearer header when the Worker has
/// `AGENT_ACCESS_TOKEN` configured.
export function createAgentTransport(endpoint: string, accessToken?: string) {
  return new DefaultChatTransport({
    api: endpoint,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
}

// --- Catalogue cache for the searchItems tool -------------------------------
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

/// Friendly labels for tool names, used by the chat UI to render status.
export const TOOL_LABELS: Record<string, string> = {
  getMarketIndex: "查询大盘指数",
  searchItems: "搜索饰品",
  getHotList: "获取热门榜单",
  getItemPrice: "查询多平台价格",
  getItemKline: "获取K线数据",
  sendChannelMessage: "发送频道消息",
  sendServerMessage: "发送全服消息",
  pokeClient: "戳用户",
  listChannels: "列出频道",
  listOnlineClients: "列出在线用户",
};

/// Execute a client-side tool call emitted by the CS Agent model.
///
/// All tools run on the desktop client (not the worker) because they either
/// call Tauri IPC commands (market_*, send_chat, poke) or need the live TS
/// server snapshot. Returns structured data the model can reason about.
export async function executeClientTool(
  name: string,
  input: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  const accessToken = ctx.accessToken;
  const args = (input ?? {}) as Record<string, unknown>;

  switch (name) {
    // --- Market analysis tools -------------------------------------------

    case "getMarketIndex": {
      const idx = await marketBroadIndex();
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
      const keyword = String(args.keyword ?? "").trim().toLowerCase();
      if (!keyword) return { matches: [], total: 0 };
      const cat = await getCatalogue(accessToken);
      const matches = cat
        .filter(
          (it) =>
            it.name.toLowerCase().includes(keyword) ||
            it.marketHashName.toLowerCase().includes(keyword),
        )
        .slice(0, 20)
        .map((it) => ({ name: it.name, marketHashName: it.marketHashName }));
      return { matches, total: cat.length };
    }

    case "getHotList": {
      const page = await marketList(1, 50, "");
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
      const prices = await marketPriceSingle(mhn);
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

    case "getItemKline": {
      const mhn = String(args.marketHashName ?? "");
      const platform = String(args.platform ?? "YOUPIN");
      const klineType = String(args.klineType ?? "1");
      if (!mhn) return { error: "marketHashName is required" };
      const candles = await marketItemKline(mhn, platform, klineType);
      const recent = candles.slice(-30);
      if (recent.length === 0) return { platform, klineType, candles: [], summary: null };
      const first = recent[0];
      const last = recent[recent.length - 1];
      const high = Math.max(...recent.map((c) => c.high));
      const low = Math.min(...recent.map((c) => c.low));
      const change =
        first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0;
      return {
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
    }

    // --- TeamSpeak messaging tools ---------------------------------------

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

    case "pokeClient": {
      if (!ctx.connected || !ctx.snapshot)
        return { error: "未连接 TS 服务器" };
      const clientName = String(args.clientName ?? "").trim();
      const message = String(args.message ?? "");
      if (!clientName) return { error: "clientName 不能为空" };
      const target = ctx.snapshot.clients.find(
        (c) => c.name === clientName || c.name.includes(clientName),
      );
      if (!target) return { error: `未找到用户「${clientName}」` };
      if (target.id === ctx.snapshot.ownClient)
        return { error: "不能戳自己" };
      await poke(target.id, message);
      return { success: true, target: target.name };
    }

    case "listChannels": {
      if (!ctx.connected || !ctx.snapshot)
        return { error: "未连接 TS 服务器" };
      return {
        channels: ctx.snapshot.channels
          .sort((a, b) => a.order - b.order)
          .map((ch) => ({ id: ch.id, name: ch.name })),
      };
    }

    case "listOnlineClients": {
      if (!ctx.connected || !ctx.snapshot)
        return { error: "未连接 TS 服务器" };
      return {
        clients: ctx.snapshot.clients.map((c) => {
          const ch = ctx.snapshot!.channels.find((x) => x.id === c.channel);
          return { id: c.id, name: c.name, channel: ch?.name ?? "未知" };
        }),
      };
    }

    default:
      return { error: `未知工具: ${name}` };
  }
}
