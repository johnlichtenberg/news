// news-feeds-relay: fetches John's two public ProQuest RSS alert feeds (fixed whitelist), merges them into a
// permanent history in Workers KV (monthly shards, see history.js), and returns it as JSON (paper, headline,
// date, library article link) to the News page. A free cron trigger refreshes both feeds every 30 minutes.
import { FEEDS } from "./feeds.js";
import { parseProquest, keepItem } from "./parse.js";
import { storeBatch, readShard, readIndex, purgeShard, monthOf, isMonth } from "./history.js";

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
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? `public, max-age=${maxAge}` : "no-store", ...headers },
  });
}

const publicItems = (items) => items.map(({ paper, title, date, link }) => ({ paper, title, date, link }));

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
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405, h);
    if (!ok) return json({ error: "forbidden" }, 403, h);

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

export const _test = { memo, stats };
