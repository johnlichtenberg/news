// news-feeds-relay: fetches John's two public ProQuest RSS alert feeds (fixed whitelist), merges them into a
// permanent history in Workers KV (monthly shards, see history.js), and returns it as JSON (paper, headline,
// date, library article link) to the News page. A free cron trigger refreshes both feeds every 30 minutes.
// GET /search signs into ProQuest through EZproxy (LIB_USER / LIB_PIN secrets) and returns headline + snippet
// matches. Full article text is never stored or returned. If live search fails, it falls back to stored headlines.
// POST /text (bearer token) can still write private text:<docviewId> for the older stored-text path.
import { FEEDS } from "./feeds.js";
import { parseProquest, keepItem } from "./parse.js";
import { storeBatch, readShard, readIndex, purgeShard, monthOf, isMonth } from "./history.js";
import { bearerToken, timingSafeEqual, rateLimited, normalizeId, normalizeText, putArticleText, runSearch, MIN_QUERY, MAX_QUERY, MAX_TEXT, _rate } from "./search.js";
import { liveSearch, _live } from "./proquest.js";

const TTL = 300; // seconds
const BY_ID = new Map(FEEDS.map((f) => [f.id, f]));
const memo = new Map(); // per-isolate cache: id -> { at, body }
const stats = { writes: 0 };

function cors(env, origin) {
  const allowed = env.ALLOWED_ORIGIN || "https://johnlichtenberg.github.io";
  const h = { "Access-Control-Allow-Origin": allowed, "Vary": "Origin", "X-Content-Type-Options": "nosniff" };
  return { ok: origin === allowed, h };
}

function json(obj, status, headers, maxAge = TTL) {
  const cache = maxAge === 0 || status !== 200 ? "no-store" : `public, max-age=${maxAge}`;
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache, ...headers },
  });
}

function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "anon";
}

async function handleSearch(request, url, env, h) {
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) {
    return json({ ok: false, error: "query too short or too long", items: [] }, 400, h, 0);
  }
  const rl = rateLimited(clientKey(request));
  if (rl.limited) {
    return json({ ok: false, error: "rate limited", items: [] }, 429, { ...h, "Retry-After": String(rl.retryAfter) }, 0);
  }
  let live;
  try { live = await liveSearch(env, q); }
  catch { live = { ok: false, items: [], notice: "Full-text search is unavailable; showing headlines." }; }
  if (live && live.ok) {
    return json({ ok: true, q, items: live.items, source: "proquest",
      ...(live.cached ? { cached: true } : {}), ...(live.notice ? { notice: live.notice } : {}) }, 200, h, 0);
  }
  const items = env.NEWS_HISTORY ? await runSearch(env.NEWS_HISTORY, q) : [];
  const notice = (live && live.notice) || "Full-text search is unavailable; showing headlines.";
  return json({ ok: true, q, items, source: "headlines", notice }, 200, h, 0);
}

async function handlePostText(request, env, h) {
  const token = env.TEXT_TOKEN || "";
  if (!token || !timingSafeEqual(bearerToken(request), token)) {
    return json({ error: "unauthorized" }, 401, h, 0);
  }
  if (!env.NEWS_HISTORY) return json({ error: "storage unavailable" }, 503, h, 0);
  const raw = await request.text();
  if (raw.length > MAX_TEXT + 4096) return json({ error: "payload too large" }, 413, h, 0);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400, h, 0); }
  const id = normalizeId(body && body.id);
  const text = normalizeText(body && body.text);
  if (!id || !text) return json({ error: "id and text required" }, 400, h, 0);
  const st = await putArticleText(env.NEWS_HISTORY, id, text);
  if (!st.ok) return json({ error: "write failed" }, 500, h, 0);
  return json({ ok: true, id: st.id, month: st.month, found: st.found }, 200, h, 0);
}

// Items stored while the feed's dates could not be read fall back to the ET day they were first seen.
const seenDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
// ts (ISO pubDate timestamp) is included only when the feed gave one.
const publicItems = (items) => items.map(({ paper, title, date, ts, link, seen }) =>
  ({ paper, title, date: date || (Number.isFinite(seen) ? seenDay.format(seen) : null), ...(ts ? { ts } : {}), link }));

// Fetch one feed, merge into history (writes only the current month's shard, only if changed) and return
// the recent history: this month's and last month's shards, plus the list of all stored months.
export async function refreshFeed(feed, env, now = Date.now(), { force = false } = {}) {
  const hit = memo.get(feed.id);
  if (!force && hit && now - hit.at < TTL * 1000) return hit.body;
  const kv = env.NEWS_HISTORY;
  let fresh = null, error = "";
  try {
    const r = await fetch(feed.url, {
      headers: { "User-Agent": "news-feeds-relay (personal RSS reader)", "Accept": "application/rss+xml, application/xml, text/xml" },
      cf: { cacheTtl: TTL, cacheEverything: true },
    });
    if (!r.ok) throw new Error("upstream " + r.status);
    fresh = parseProquest(await r.text(), feed);
  } catch (e) {
    error = String(e.message || e).slice(0, 100);
  }
  let st;
  try {
    st = await storeBatch(kv, feed.id, fresh, now, keepItem(feed));
    stats.writes += st.writes;
  } catch (e) {
    error = error || "history write failed";
    st = { months: [], month: monthOf(now), current: fresh || [], previous: [], failed: true };
  }
  // Without a KV binding (or if storage failed) serve the live batch.
  const current = kv && !st.failed ? st.current : (fresh || []);
  const loaded = [st.month, st.previousMonth].filter(Boolean);
  const body = { id: feed.id, paper: feed.paper, ok: !!fresh, fetched: new Date(now).toISOString(),
    latest: fresh ? fresh.length : 0, months: st.months, loaded,
    older: st.months.filter((m) => !loaded.includes(m)),
    items: publicItems([...current, ...(st.previous || [])].filter(keepItem(feed))) };
  if (error) body.error = error;
  if (fresh) memo.set(feed.id, { at: now, body });
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
    // Server-to-server ingest: bearer token, no browser Origin required. Never from the public page.
    if (url.pathname === "/text" && request.method === "POST") return handlePostText(request, env, h);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405, h);
    if (!ok) return json({ error: "forbidden" }, 403, h);

    if (url.pathname === "/search") return handleSearch(request, url, env, h);
    if (url.pathname === "/text") return json({ error: "method not allowed" }, 405, h);
    if (url.pathname === "/feeds") {
      return json({ feeds: FEEDS.map(({ id, paper }) => ({ id, paper })) }, 200, h, 3600);
    }
    const mm = url.pathname.match(/^\/feed\/([a-z0-9-]{1,40})\/(\d{4}-\d{2})$/);
    if (mm) {
      const feed = BY_ID.get(mm[1]);
      if (!feed || !isMonth(mm[2])) return json({ error: "unknown feed or month" }, 404, h);
      const kv = env.NEWS_HISTORY;
      const [items, months] = await Promise.all([readShard(kv, feed.id, mm[2]), readIndex(kv, feed.id)]);
      const past = mm[2] < monthOf(Date.now());
      return json({ id: feed.id, paper: feed.paper, ok: true, month: mm[2], months, items: publicItems(items.filter(keepItem(feed))) }, 200, h, past ? 3600 : TTL);
    }
    const m = url.pathname.match(/^\/feed\/([a-z0-9-]{1,40})$/);
    if (m) {
      const feed = BY_ID.get(m[1]);
      if (!feed) return json({ error: "unknown feed" }, 404, h);
      const body = await refreshFeed(feed, env, Date.now());
      return json(body, 200, h, body.ok ? TTL : 30);
    }
    return json({ error: "not found" }, 404, h);
  },

  // Free cron trigger (wrangler.toml): refresh both feeds so history fills in between visits.
  // It also purges excluded items (NYT en Español) from older stored months; writes only when one is removed.
  async scheduled(event, env, ctx) {
    const now = Date.now();
    const work = Promise.all(FEEDS.map(async (f) => {
      await refreshFeed(f, env, now, { force: true });
      if (f.excludeSpanish && env.NEWS_HISTORY) {
        const months = (await readIndex(env.NEWS_HISTORY, f.id)).filter((m) => m !== monthOf(now));
        for (const m of months) stats.purged = (stats.purged || 0) + await purgeShard(env.NEWS_HISTORY, f.id, m, keepItem(f), now);
      }
    }));
    if (ctx && ctx.waitUntil) ctx.waitUntil(work);
    await work;
  },
};

export const _test = { memo, stats, rate: _rate, live: _live };
