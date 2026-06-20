// csspeak market cache + CS Agent Worker.
//
// Routes:
//   GET  /base       — cached CS2 item catalogue (daily cron refresh)
//   GET  /refresh    — force-refresh the catalogue (requires ?secret=)
//   POST /agent      — CS Agent: AI SDK v7 streamText with client-side tools
//
// Secrets (set via `wrangler secret put`):
//   STEAMDT_KEY     — SteamDT open-platform API key
//   OPENAI_API_KEY  — OpenAI API key for the agent LLM
//   REFRESH_SECRET  — shared secret for manual catalogue refresh
// Optional env:
//   AGENT_MODEL     — model id (default: gpt-4o-mini)

import {
  streamText,
  tool,
  isStepCount,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const BASE = "https://open.steamdt.com";
const WEB_BASE = "https://www.steamdt.com/api";
const KV_KEY = "base_items";
const KV_TS_KEY = "base_items_ts";

// Cache TTLs (seconds). The origin responses are already time-bucketed
// (kline candles don't change intra-day, prices refresh ~1/min), so we
// can be generous on the edge to keep latency low.
const TTL = {
  index:  300,  // broad index — 5 min
  price:   60,  // single-item multi-platform price — 1 min
  kline:  300,  // OHLC candles — 5 min
  hotlist: 600, // public hot-list page — 10 min
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ---------------------------------------------------------------------------
// CS Agent
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是 CS Agent，一个集成在 csspeak（CS2 玩家的 TeamSpeak 语音客户端）中的 AI 助手。你有两大核心能力：

## 一、CS2 饰品市场数据分析
你可以调用以下工具获取 SteamDT 的实时市场数据：
- getMarketIndex：获取大盘指数和整体走势
- searchItems：按关键词搜索饰品目录（返回 name 和 marketHashName）
- getHotList：获取热门饰品榜单（含各平台最低价和跨平台价差）
- getItemPrice：查询指定饰品在各平台（悠悠有品/BUFF/C5/Steam）的价格
- getItemKline：查询K线数据（日K/周K/月K）用于走势分析

分析时请：
- 主动调用工具获取真实数据，绝不编造价格或数据
- 计算并突出关键指标：跨平台价差、涨跌幅、高低点
- 用简洁清晰的中文总结分析结论
- 可给出参考性建议，但需声明「不构成投资建议」

## 二、TeamSpeak 频道互动
你可以通过以下工具在语音频道中互动：
- sendChannelMessage：向当前频道发送文字消息
- sendServerMessage：向全服发送文字消息
- pokeClient：戳一下指定用户（对方收到弹窗提醒）
- listChannels：列出当前服务器所有频道
- listOnlineClients：列出所有在线用户及所在频道

互动时请：
- 用户让你发消息/整活/发表情时，主动调用 sendChannelMessage
- 可以发送饰品行情卡片、价格提醒、趣味文字等
- 整活时发挥创意、幽默风趣，但保持文明友善
- 戳人前先用 listOnlineClients 确认用户在线及准确昵称
- 需要发送饰品图片时，把图片 URL 放在消息中一并发送

## 注意事项
- 如果用户要求频道互动但未连接 TS 服务器，请提示需要先在「语音」页连接
- 始终使用简体中文回复
- 数据来源于 SteamDT，可能存在延迟，重要决策请以平台实时数据为准`;

/// All tools are client-side (no `execute`): the model emits a tool call, the
/// csspeak desktop client executes it via Tauri IPC and returns the result.
const agentTools = {
  getMarketIndex: tool({
    description:
      "获取 CS2 饰品大盘指数，包含当前指数、较昨日涨跌幅和近期历史走势。当用户询问大盘走势、市场整体表现时调用。",
    inputSchema: z.object({}),
  }),
  searchItems: tool({
    description:
      "按关键词搜索 CS2 饰品目录，返回匹配的饰品名称(name)和 marketHashName。当用户想找某件饰品或查询价格前，先调用此工具获取 marketHashName。",
    inputSchema: z.object({
      keyword: z.string().describe("搜索关键词，例如饰品名称「AK-47 | 红线」"),
    }),
  }),
  getHotList: tool({
    description:
      "获取 CS2 饰品热门榜单，包含各平台最低价、最高价和跨平台价差百分比。当用户想看热门饰品、涨幅排行、搬砖价差时调用。",
    inputSchema: z.object({}),
  }),
  getItemPrice: tool({
    description:
      "查询指定饰品在各大平台（YOUPIN/BUFF/C5/STEAM）的挂刀价(sellPrice)和求购价(biddingPrice)。需要先通过 searchItems 获取 marketHashName。",
    inputSchema: z.object({
      marketHashName: z
        .string()
        .describe("饰品的 marketHashName，可通过 searchItems 获取"),
    }),
  }),
  getItemKline: tool({
    description:
      "查询指定饰品的K线（蜡烛图）数据用于价格走势分析。klineType: 1=日K, 2=周K, 3=月K。platform: YOUPIN/BUFF/C5/STEAM。",
    inputSchema: z.object({
      marketHashName: z.string(),
      platform: z.string().describe("平台：YOUPIN / BUFF / C5 / STEAM"),
      klineType: z.string().describe("1=日K, 2=周K, 3=月K"),
    }),
  }),
  sendChannelMessage: tool({
    description:
      "向当前所在的 TeamSpeak 频道发送文字消息。可用于分享分析结果、发送整活内容、发表情等。需要已连接 TS 服务器。",
    inputSchema: z.object({
      message: z.string().describe("要发送的消息内容，支持纯文本和 URL"),
    }),
  }),
  sendServerMessage: tool({
    description:
      "向 TeamSpeak 服务器全局发送文字消息（所有频道可见）。需要已连接 TS 服务器。请谨慎使用，避免刷屏。",
    inputSchema: z.object({
      message: z.string().describe("要发送的消息内容"),
    }),
  }),
  pokeClient: tool({
    description:
      "戳一下(poke)指定的 TeamSpeak 用户，对方会收到一条弹窗提示。需要已连接 TS 服务器。戳人前建议先调用 listOnlineClients 确认昵称。",
    inputSchema: z.object({
      clientName: z.string().describe("目标用户的昵称（需与在线列表中的完全一致）"),
      message: z.string().describe("戳的内容"),
    }),
  }),
  listChannels: tool({
    description: "列出当前 TeamSpeak 服务器上的所有频道。需要已连接 TS 服务器。",
    inputSchema: z.object({}),
  }),
  listOnlineClients: tool({
    description:
      "列出当前 TeamSpeak 服务器上所有在线用户及其所在频道。需要已连接 TS 服务器。",
    inputSchema: z.object({}),
  }),
};

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

/// Shared bearer-token gate for all client-facing endpoints. When
/// AGENT_ACCESS_TOKEN is set, every request must carry it as a Bearer header.
/// This blocks anonymous callers from consuming EvoMap LLM quota (via /agent)
/// or scraping the cached catalogue (via /base). The token itself is not
/// sensitive — it only authorises access to the Worker — so it is fine for the
/// user to type it into the desktop client settings.
function checkAccess(request, env) {
  if (!env.AGENT_ACCESS_TOKEN) return null; // gate disabled
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${env.AGENT_ACCESS_TOKEN}`) {
    return json(
      {
        error: "访问令牌缺失或无效，请在客户端设置中填写正确的访问令牌",
        code: "UNAUTHORIZED",
      },
      401,
    );
  }
  return null;
}

async function handleAgent(request, env) {
  if (!env.EVOMAP_API_KEY) {
    return json(
      {
        error: "服务端未配置 EVOMAP_API_KEY，请联系管理员",
        code: "MISSING_API_KEY",
      },
      500,
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(
      { error: "请求体不是合法的 JSON", code: "BAD_REQUEST" },
      400,
    );
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(
      { error: "messages 字段为空或格式不正确", code: "BAD_REQUEST" },
      400,
    );
  }

  // EvoMap exposes an OpenAI-compatible API, so we reuse the OpenAI provider
  // with a custom baseURL. The API key lives ONLY in the Worker secret — it is
  // never shipped to the client, embedded in the bundle, or committed to git.
  const provider = createOpenAI({
    apiKey: env.EVOMAP_API_KEY,
    baseURL: "https://api.evomap.ai/v1",
  });
  const modelId = env.AGENT_MODEL || "evomap-deepseek-v4-flash";

  let result;
  try {
    result = streamText({
      model: provider(modelId),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      stopWhen: isStepCount(8),
      tools: agentTools,
    });
  } catch (e) {
    return json(
      {
        error: `模型初始化失败：${e instanceof Error ? e.message : String(e)}`,
        code: "MODEL_INIT_FAILED",
      },
      500,
    );
  }

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (error) => {
        // Translate common upstream errors into actionable Chinese messages
        // so the desktop client can surface them directly.
        return describeStreamError(error);
      },
    }),
  });
}

/// Map an opaque stream error to a human-readable Chinese message. Includes
/// a `code` prefix so the frontend can pattern-match for special handling
/// (e.g. auth failures, rate limits).
function describeStreamError(error) {
  if (error == null) return "[INTERNAL] 未知错误";
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    const msg = error.message;
    // OpenAI-compatible API error shapes
    if (error.name === "APIError" || msg.includes("API error")) {
      if (msg.includes("401")) return "[AUTH] EvoMap API 密钥无效或已过期";
      if (msg.includes("429")) return "[RATE_LIMIT] 请求过于频繁，请稍后再试";
      if (msg.includes("500") || msg.includes("502") || msg.includes("503"))
        return "[UPSTREAM] EvoMap 服务暂时不可用，请稍后重试";
      if (msg.includes("400")) return `[BAD_REQUEST] ${msg}`;
    }
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("ECONNRESET"))
      return "[NETWORK] 无法连接到 EvoMap 服务，请检查网络";
    return msg;
  }

  // Some SDKs throw plain objects
  const str = JSON.stringify(error);
  if (str.includes("401")) return "[AUTH] EvoMap API 密钥无效或已过期";
  if (str.includes("429")) return "[RATE_LIMIT] 请求过于频繁，请稍后再试";
  return str;
}

// ---------------------------------------------------------------------------
// Catalogue cache (unchanged)
// ---------------------------------------------------------------------------

async function refreshCatalogue(env) {
  const resp = await fetch(`${BASE}/open/cs2/v1/base`, {
    headers: { Authorization: `Bearer ${env.STEAMDT_KEY}` },
  });
  const json = await resp.json();
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error(`base failed: ${json.errorMsg || resp.status}`);
  }
  const items = json.data.map((it) => ({
    name: it.name,
    marketHashName: it.marketHashName,
    platformList: it.platformList,
  }));
  await env.MARKET_CACHE.put(KV_KEY, JSON.stringify(items));
  await env.MARKET_CACHE.put(KV_TS_KEY, String(Date.now()));
  return items.length;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshCatalogue(env).catch((e) => console.error(e)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    // CS Agent — AI SDK v7 streaming endpoint.
    if (url.pathname === "/agent" && request.method === "POST") {
      const denied = checkAccess(request, env);
      if (denied) return denied;
      try {
        return await handleAgent(request, env);
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    if (url.pathname === "/base") {
      const denied = checkAccess(request, env);
      if (denied) return denied;
      const cached = await env.MARKET_CACHE.get(KV_KEY);
      const ts = await env.MARKET_CACHE.get(KV_TS_KEY);
      if (!cached) {
        return json({ success: false, error: "catalogue not ready" }, 503);
      }
      return new Response(
        JSON.stringify({
          success: true,
          updatedAt: Number(ts) || 0,
          data: JSON.parse(cached),
        }),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
            ...CORS,
          },
        },
      );
    }

    if (url.pathname === "/refresh") {
      if (url.searchParams.get("secret") !== env.REFRESH_SECRET) {
        return json({ success: false, error: "forbidden" }, 403);
      }
      try {
        const count = await refreshCatalogue(env);
        return json({ success: true, count });
      } catch (e) {
        return json({ success: false, error: String(e) }, 500);
      }
    }

    // ---- Market proxy endpoints (cached, access-controlled) ----

    // GET /trend  →  SteamDT broad/v1/index (5 min cache)
    if (url.pathname === "/trend") {
      const denied = checkAccess(request, env);
      if (denied) return denied;
      return proxyGet(env, `${BASE}/open/cs2/broad/v1/index`, ttl(TTL.index));
    }

    // GET /price?marketHashName=  →  SteamDT /price/single (1 min cache)
    if (url.pathname === "/price") {
      const denied = checkAccess(request, env);
      if (denied) return denied;
      const h = url.searchParams.get("marketHashName");
      if (!h) return json({ success: false, error: "missing marketHashName" }, 400);
      return proxyGet(env, `${BASE}/open/cs2/v1/price/single?marketHashName=${encodeURIComponent(h)}`, ttl(TTL.price));
    }

    // GET /kline?marketHashName=&platform=&type=  →  SteamDT /item/v1/kline (5 min cache)
    if (url.pathname === "/kline") {
      const denied = checkAccess(request, env);
      if (denied) return denied;
      const mh = url.searchParams.get("marketHashName");
      const pf = url.searchParams.get("platform") || "YOUPIN";
      const tp = url.searchParams.get("type") || "1";
      if (!mh) return json({ success: false, error: "missing marketHashName" }, 400);
      const body = JSON.stringify({ marketHashName: mh, platform: pf, type: tp });
      return proxyPost(env, `${BASE}/open/cs2/item/v1/kline`, body, ttl(TTL.kline));
    }

    // GET /hotlist  →  public web skin/market/v1/list (10 min cache, no auth)
    if (url.pathname === "/hotlist") {
      const denied = checkAccess(request, env);
      if (denied) return denied;
      const body = JSON.stringify({ sortType: 1, pageSize: 100 });
      const key = new Request(`https://hotlist`, { method: "GET" });
      // Build a deduplicated cache key from the body.
      const cacheUrl = new URL(request.url);
      cacheUrl.search = ""; // normalise
      const cacheReq = new Request(cacheUrl, { method: "GET" });
      let cached = await caches.default.match(cacheReq);
      if (cached) return cached;

      const resp = await fetch(`${WEB_BASE}/skin/market/v1/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Language": "zh_CN" },
        body,
      });
      if (!resp.ok) return json({ success: false, error: `upstream ${resp.status}` }, 502);
      const copy = new Response(resp.body, resp);
      copy.headers.set("Cache-Control", `public, max-age=${TTL.hotlist}`);
      copy.headers.set("Access-Control-Allow-Origin", "*");
      ctx.waitUntil(caches.default.put(cacheReq, copy.clone()));
      return copy;
    }

    return json({
      success: true,
      service: "csspeak-market",
      endpoints: ["/base", "/refresh", "/agent (POST)", "/trend", "/price", "/kline", "/hotlist"],
    });
  },
};

// ---------------------------------------------------------------------------
// Market proxy helpers (cached)
// ---------------------------------------------------------------------------

function ttl(sec) {
  return `public, max-age=${sec}, s-maxage=${sec}`;
}

/// Simple Cache-Aside: match → fetch + cache → return.
async function cacheThrough(cacheReq, fetchFn, ttlStr) {
  let cached = await caches.default.match(cacheReq);
  if (cached) return cached;
  const upstream = await fetchFn();
  if (!upstream.ok) return null;
  const resp = new Response(upstream.body, upstream);
  resp.headers.set("Cache-Control", ttlStr);
  resp.headers.set("Access-Control-Allow-Origin", "*");
  caches.default.put(cacheReq, resp.clone());
  return resp;
}

async function proxyGet(env, url, ttlStr) {
  const cacheReq = new Request(url, { method: "GET" });
  const resp = await cacheThrough(cacheReq, () =>
    fetch(url, { headers: { Authorization: `Bearer ${env.STEAMDT_KEY}` } }),
    ttlStr,
  );
  if (!resp) return json({ success: false, error: "upstream error" }, 502);
  return resp;
}

async function proxyPost(env, url, bodyStr, ttlStr) {
  const cacheReq = new Request(url, { method: "POST", body: bodyStr });
  const resp = await cacheThrough(cacheReq, () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.STEAMDT_KEY}` },
      body: bodyStr,
    }),
    ttlStr,
  );
  if (!resp) return json({ success: false, error: "upstream error" }, 502);
  return resp;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
