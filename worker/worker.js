// news-feeds-relay: fetches a fixed whitelist of public NYT/WSJ RSS feeds and returns
// parsed JSON (headline, feed description, section, time, link) to the headlines page.
// No article bodies, no secrets, no storage beyond a short cache.
import { FEEDS } from "./feeds.js";
import { parseRss } from "./parse.js";

const TTL = 300; // seconds
const BY_ID = new Map(FEEDS.map((f) => [f.id, f]));
const memo = new Map(); // per-isolate cache: id -> { at, body }

function cors(env, origin) {
  const allowed = env.ALLOWED_ORIGIN || "https://johnlichtenberg.github.io";
  const h = { "Access-Control-Allow-Origin": allowed, "Vary": "Origin", "X-Content-Type-Options": "nosniff" };
  return { ok: origin === allowed, h };
}

function json(obj, status, headers, maxAge = TTL) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? `public, max-age=${maxAge}` : "no-store", ...headers },
  });
}

async function loadFeed(feed, now) {
  const hit = memo.get(feed.id);
  if (hit && now - hit.at < TTL * 1000) return hit.body;
  let body;
  try {
    const r = await fetch(feed.url, {
      headers: { "User-Agent": "news-feeds-relay (personal RSS reader)", "Accept": "application/rss+xml, application/xml, text/xml" },
      cf: { cacheTtl: TTL, cacheEverything: true },
    });
    if (!r.ok) throw new Error("upstream " + r.status);
    const xml = await r.text();
    const items = parseRss(xml, feed);
    body = { id: feed.id, paper: feed.paper, section: feed.section, ok: true, fetched: new Date(now).toISOString(), items };
  } catch (e) {
    body = { id: feed.id, paper: feed.paper, section: feed.section, ok: false, error: String(e.message || e).slice(0, 100), items: [] };
  }
  if (body.ok) memo.set(feed.id, { at: now, body });
  return body;
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const { ok, h } = cors(env, request.headers.get("Origin"));
    if (request.method === "OPTIONS") {
      return new Response(null, { status: ok ? 204 : 403, headers: { ...h,
        "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400" } });
    }
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405, h);
    if (!ok) return json({ error: "forbidden" }, 403, h);

    if (url.pathname === "/feeds") {
      return json({ feeds: FEEDS.map(({ id, paper, section }) => ({ id, paper, section })) }, 200, h, 3600);
    }
    const m = url.pathname.match(/^\/feed\/([a-z0-9-]{1,40})$/);
    if (m) {
      const feed = BY_ID.get(m[1]);
      if (!feed) return json({ error: "unknown feed" }, 404, h);
      const body = await loadFeed(feed, Date.now());
      return json(body, 200, h, body.ok ? TTL : 30);
    }
    return json({ error: "not found" }, 404, h);
  },
};

export const _test = { memo };
