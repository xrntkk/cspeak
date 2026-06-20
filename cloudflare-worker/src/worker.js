// csspeak market cache Worker.
//
// - Daily cron pulls the full CS2 item catalogue from SteamDT's `base` endpoint
//   (rate-limited to once/day per key) and stores it in KV.
// - Clients hit GET /base to read the cached catalogue with no per-user limit.
// - GET /refresh?secret=... forces a refresh (for first deploy / manual use).
//
// The SteamDT API key lives as a Worker secret (STEAMDT_KEY), never shipped to
// clients.

const BASE = "https://open.steamdt.com";
const KV_KEY = "base_items";
const KV_TS_KEY = "base_items_ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function refreshCatalogue(env) {
  const resp = await fetch(`${BASE}/open/cs2/v1/base`, {
    headers: { Authorization: `Bearer ${env.STEAMDT_KEY}` },
  });
  const json = await resp.json();
  if (!json.success || !Array.isArray(json.data)) {
    throw new Error(`base failed: ${json.errorMsg || resp.status}`);
  }
  // Keep only the fields clients need for search.
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
  // Cron handler.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshCatalogue(env).catch((e) => console.error(e)));
  },

  // HTTP handler.
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === "/base") {
      const cached = await env.MARKET_CACHE.get(KV_KEY);
      const ts = await env.MARKET_CACHE.get(KV_TS_KEY);
      if (!cached) {
        return json({ success: false, error: "catalogue not ready" }, 503);
      }
      return new Response(
        JSON.stringify({ success: true, updatedAt: Number(ts) || 0, data: JSON.parse(cached) }),
        { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600", ...CORS } },
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

    return json({ success: true, service: "csspeak-market", endpoints: ["/base", "/refresh"] });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
