import {
  DefaultChatTransport,
  convertToModelMessages,
  jsonSchema,
  tool,
  type ModelMessage,
  type Tool,
  type UIMessage,
} from "ai";
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

// --- Tool schemas ----------------------------------------------------------
//
// Defined as plain JSON Schema so we can feed the same shape to both the AI SDK
// (via jsonSchema()) and the OpenAI-compatible EvoMap API.

const toolSchemas: Record<string, { description: string; schema: Record<string, unknown> }> = {
  getMarketIndex: {
    description: "获取 CS2 饰品市场大盘指数和近 10 个历史点，用于判断整体走势。",
    schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  searchItems: {
    description: "按关键词搜索 CS2 饰品目录，返回 name 和 marketHashName。",
    schema: {
      type: "object",
      properties: { keyword: { type: "string", description: "饰品中文名或 market hash name 关键词" } },
      required: ["keyword"],
      additionalProperties: false,
    },
  },
  getHotList: {
    description: "获取热门饰品榜单，含各平台最低价、最高价和跨平台价差百分比。",
    schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  getItemPrice: {
    description: "查询指定饰品在悠悠有品/BUFF/C5/Steam 等平台的实时价格。",
    schema: {
      type: "object",
      properties: {
        marketHashName: { type: "string", description: "饰品的 market hash name" },
      },
      required: ["marketHashName"],
      additionalProperties: false,
    },
  },
  getItemKline: {
    description: "查询指定饰品的 K 线数据（日/周/月），用于走势分析。",
    schema: {
      type: "object",
      properties: {
        marketHashName: { type: "string", description: "饰品的 market hash name" },
        platform: { type: "string", description: "平台代码，如 YOUPIN/BUFF/C5/STEAM，默认 YOUPIN" },
        klineType: { type: "string", description: "K 线类型：1=日，2=周，3=月，默认 1" },
      },
      required: ["marketHashName"],
      additionalProperties: false,
    },
  },
  sendChannelMessage: {
    description: "在当前 TeamSpeak 频道发送一条文字消息。",
    schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "要发送的消息内容" },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  sendServerMessage: {
    description: "向整个 TeamSpeak 服务器发送一条文字消息。",
    schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "要发送的消息内容" },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  pokeClient: {
    description: "戳一下指定 TeamSpeak 用户（对方会收到弹窗提醒）。",
    schema: {
      type: "object",
      properties: {
        clientName: { type: "string", description: "目标用户昵称或昵称片段" },
        message: { type: "string", description: "戳人时附带的简短消息" },
      },
      required: ["clientName"],
      additionalProperties: false,
    },
  },
  listChannels: {
    description: "列出当前 TeamSpeak 服务器的所有频道。",
    schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  listOnlineClients: {
    description: "列出当前 TeamSpeak 服务器所有在线用户及所在频道。",
    schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
};

/// AI SDK ToolSet used by `convertToModelMessages` to understand tool calls.
export const AGENT_TOOLS: Record<string, Tool> = Object.fromEntries(
  Object.entries(toolSchemas).map(([name, { description, schema }]) => [
    name,
    tool({ description, inputSchema: jsonSchema(schema) }),
  ]),
);

/// OpenAI-compatible tool definitions forwarded to the Worker/EvoMap.
export const OPENAI_TOOLS = Object.entries(toolSchemas).map(([name, { description, schema }]) => ({
  type: "function" as const,
  function: {
    name,
    description,
    parameters: schema,
  },
}));

/// Convert AI SDK ModelMessages into OpenAI chat-completion messages.
function modelMessagesToOpenAI(messages: ModelMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    switch (m.role) {
      case "system": {
        out.push({ role: "system", content: m.content });
        break;
      }
      case "user": {
        const text = typeof m.content === "string"
          ? m.content
          : m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
        out.push({ role: "user", content: text });
        break;
      }
      case "assistant": {
        const parts = typeof m.content === "string" ? [] : m.content;
        const text = parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
        const toolCalls = parts
          .filter((p) => p.type === "tool-call")
          .map((p) => ({
            id: (p as { toolCallId: string }).toolCallId,
            type: "function" as const,
            function: {
              name: (p as { toolName: string }).toolName,
              arguments: JSON.stringify((p as { input: unknown }).input),
            },
          }));
        const msg: Record<string, unknown> = { role: "assistant" };
        if (text) msg.content = text;
        if (toolCalls.length) msg.tool_calls = toolCalls;
        out.push(msg);
        // tool-result parts that are attached to the assistant message need to
        // become separate `tool` messages after it.
        const results = parts.filter((p) => p.type === "tool-result");
        for (const r of results) {
          out.push({
            role: "tool",
            tool_call_id: (r as { toolCallId: string }).toolCallId,
            content: JSON.stringify((r as { output: unknown }).output),
          });
        }
        break;
      }
      case "tool": {
        for (const part of m.content) {
          if (part.type === "tool-result") {
            out.push({
              role: "tool",
              tool_call_id: (part as { toolCallId: string }).toolCallId,
              content: JSON.stringify((part as { output: unknown }).output),
            });
          }
        }
        break;
      }
    }
  }
  return out;
}

/// Build a stable chat transport for the CS Agent worker endpoint.
/// An optional access token is sent as a Bearer header when the Worker has
/// `AGENT_ACCESS_TOKEN` configured.
export function createAgentTransport(endpoint: string, accessToken?: string) {
  return new DefaultChatTransport({
    api: endpoint,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    prepareSendMessagesRequest: async ({ messages }) => {
      const modelMessages = await convertToModelMessages(messages as UIMessage[], {
        tools: AGENT_TOOLS,
      });
      return {
        api: endpoint,
        body: {
          messages: modelMessagesToOpenAI(modelMessages),
          tools: OPENAI_TOOLS,
        },
      };
    },
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
  try {
    return await runTool(name, input, ctx);
  } catch (e) {
    // Tauri IPC rejections arrive as strings; normalise into a clear message
    // so the model and the UI badge both can surface it.
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `[${name}] ${describeIpcError(msg)}` };
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

async function runTool(
  name: string,
  input: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  const accessToken = ctx.accessToken;
  const args = (input ?? {}) as Record<string, unknown>;

  switch (name) {
    // --- Market analysis tools -------------------------------------------

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

    case "getItemKline": {
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
