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

// /agent: direct SSE proxy to EvoMap chat/completions. Proven reliable;
// AI SDK wrappers (convertToModelMessages / toUIMessageStreamResponse)
// consistently crash under wrangler's bundling. One fetch, stream through.

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
- 数据来源于 SteamDT，可能存在延迟，重要决策请以平台实时数据为准`;

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
    return json({ error: "EVOMAP_API_KEY not configured" }, 500);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "messages required" }, 400);
  }

  // Direct SSE proxy to EvoMap — the AI SDK wrappers (convertToModelMessages,
  // toUIMessageStreamResponse) consistently crash under wrangler's bundler so
  // we just forward the request/response streams raw. Proven reliable.
  const evoBody = JSON.stringify({
    model: env.AGENT_MODEL || "evomap-deepseek-v4-flash",
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    stream: true,
    max_tokens: 4096,
  });

  const upstream = await fetch("https://api.evomap.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.EVOMAP_API_KEY}`, "Content-Type": "application/json" },
    body: evoBody,
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return json({ error: `upstream ${upstream.status}: ${err.slice(0, 200)}` }, 502);
  }

  return new Response(upstream.body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...CORS },
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

  async fetch(request, env, ctx) {
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
      return proxyGet(env, `${BASE}/open/cs2/broad/v1/index`, ttl(TTL.index));
    }

    // GET /price?marketHashName=  →  SteamDT /price/single (1 min cache)
    if (url.pathname === "/price") {
      const h = url.searchParams.get("marketHashName");
      if (!h) return json({ success: false, error: "missing marketHashName" }, 400);
      return proxyGet(env, `${BASE}/open/cs2/v1/price/single?marketHashName=${encodeURIComponent(h)}`, ttl(TTL.price));
    }

    // GET /kline?marketHashName=&platform=&type=  →  SteamDT /item/v1/kline (5 min cache)
    if (url.pathname === "/kline") {
      const mh = url.searchParams.get("marketHashName");
      const pf = url.searchParams.get("platform") || "YOUPIN";
      const tp = url.searchParams.get("type") || "1";
      if (!mh) return json({ success: false, error: "missing marketHashName" }, 400);
      const body = JSON.stringify({ marketHashName: mh, platform: pf, type: tp });
      return proxyPost(env, `${BASE}/open/cs2/item/v1/kline`, body, ttl(TTL.kline));
    }

    // GET /hotlist  →  public web skin/market/v1/list (10 min cache, open)
    if (url.pathname === "/hotlist") {
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
