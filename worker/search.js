// Private article-text storage and search. Full text lives only in KV (text:<docviewId>, plus a monthly
// index textm:<YYYY-MM> so /search can run in a handful of reads). The public /search response never
// includes the full text: only id, paper, date, headline, library link, and a short snippet.
import { FEEDS, LIBRARY_LOGIN, PROQUEST_ACCOUNT } from "./feeds.js";
import { keepItem } from "./parse.js";
import { readShard, readIndex, isMonth, monthOf } from "./history.js";
import { parseQuery, queryMatches, snippetAround, sortStories } from "../docs/lib.js";

export const TEXT_KEY = (id) => "text:" + id;
export const TEXT_MONTH_KEY = (month) => "textm:" + month;
export const MAX_TEXT = 500_000;       // characters stored per article
export const MAX_QUERY = 200;          // characters
export const MIN_QUERY = 3;
export const MAX_HITS = 200;
export const SEARCH_LIMIT = 30;        // requests
export const SEARCH_WINDOW_MS = 60_000;
export const ID_RE = /^\d{3,15}$/;

export const libraryLink = (id) =>
  `${LIBRARY_LOGIN}https://www.proquest.com/docview/${id}?accountid=${PROQUEST_ACCOUNT}`;

const seenDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

export function normalizeId(id) {
  const s = String(id || "").trim();
  return ID_RE.test(s) ? s : "";
}

// Plain text only: strip markup, drop controls, keep paragraph breaks, cap length.
export function normalizeText(raw, max = MAX_TEXT) {
  let s = String(raw || "");
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<[^>]*>/g, " ");
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, "").trim();
  return s;
}

export function timingSafeEqual(a, b) {
  const ea = String(a || ""), eb = String(b || "");
  const n = Math.max(ea.length, eb.length, 1);
  let out = ea.length ^ eb.length;
  for (let i = 0; i < n; i++) out |= (ea.charCodeAt(i) || 0) ^ (eb.charCodeAt(i) || 0);
  return out === 0 && ea.length === eb.length && ea.length > 0;
}

export function bearerToken(request) {
  const h = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(\S+)/i.exec(h);
  return m ? m[1] : "";
}

// In-isolate rate limit (each Cloudflare isolate has its own map; good enough on the free plan).
const buckets = new Map();
export const _rate = { buckets, reset() { buckets.clear(); } };

export function rateLimited(key, now = Date.now(), limit = SEARCH_LIMIT, windowMs = SEARCH_WINDOW_MS) {
  const k = String(key || "anon");
  let b = buckets.get(k);
  if (!b || now >= b.reset) b = { n: 0, reset: now + windowMs };
  b.n++;
  buckets.set(k, b);
  return b.n > limit ? { limited: true, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)) } : { limited: false, retryAfter: 0 };
}

async function getJSON(kv, key) {
  if (!kv) return null;
  try { return await kv.get(key, "json"); } catch { return null; }
}

// Locate a stored headline (paper, date, title, link, month) by docview id. Español items are ignored.
export async function findHeadline(kv, id) {
  if (!kv || !id) return null;
  for (const feed of FEEDS) {
    const months = await readIndex(kv, feed.id);
    const keep = keepItem(feed);
    for (const m of months) {
      const items = await readShard(kv, feed.id, m);
      const it = items.find((i) => i && i.id === id);
      if (it && keep(it)) {
        const date = it.date || (Number.isFinite(it.seen) ? seenDay.format(it.seen) : "");
        return { id, paper: it.paper || feed.paper, date, title: it.title, link: it.link || libraryLink(id), month: m, feed,
          ...(it.section ? { section: it.section } : {}) };
      }
    }
  }
  return null;
}

export async function putArticleText(kv, id, text, now = Date.now()) {
  const clean = normalizeText(text);
  if (!kv || !id || !clean) return { ok: false, error: "invalid" };
  const found = await findHeadline(kv, id);
  const month = (found && found.month) || monthOf(now);
  const rec = { id, text: clean, updated: new Date(now).toISOString() };
  await kv.put(TEXT_KEY(id), JSON.stringify(rec));
  const cur = await getJSON(kv, TEXT_MONTH_KEY(month)) || { items: [] };
  const items = Array.isArray(cur.items) ? cur.items.filter((i) => i && i.id !== id) : [];
  items.push({ id, text: clean });
  await kv.put(TEXT_MONTH_KEY(month), JSON.stringify({ updated: rec.updated, items }));
  return { ok: true, id, month, found: !!found, bytes: clean.length };
}

export async function loadHeadlines(kv) {
  const out = [];
  if (!kv) return out;
  for (const feed of FEEDS) {
    const months = await readIndex(kv, feed.id);
    const keep = keepItem(feed);
    for (const m of months) {
      for (const it of await readShard(kv, feed.id, m)) {
        if (!it || !it.id || !keep(it)) continue;
        const date = it.date || (Number.isFinite(it.seen) ? seenDay.format(it.seen) : "");
        out.push({ id: it.id, paper: it.paper || feed.paper, date, title: it.title, link: it.link || libraryLink(it.id), month: m,
          ...(it.section ? { section: it.section } : {}) });
      }
    }
  }
  return out;
}

async function loadTexts(kv, months) {
  const map = new Map();
  if (!kv) return map;
  const keys = [...new Set([...(months || []).filter(isMonth), "pending"])].map(TEXT_MONTH_KEY);
  await Promise.all(keys.map(async (key) => {
    const v = await getJSON(kv, key);
    if (!v || !Array.isArray(v.items)) return;
    for (const it of v.items) if (it && it.id && it.text) map.set(String(it.id), it.text);
  }));
  return map;
}

function publicHit(it, snippet) {
  const hit = { id: it.id, paper: it.paper, date: it.date || "", title: it.title, link: it.link || libraryLink(it.id) };
  if (it.section) hit.section = it.section;
  if (snippet) hit.snippet = snippet;
  return hit;
}

export async function runSearch(kv, q) {
  const parsed = parseQuery(q);
  if (!parsed.phrases.length && !parsed.words.length) return [];
  const headlines = await loadHeadlines(kv);
  const months = [...new Set(headlines.map((h) => h.month).filter(Boolean))];
  const texts = await loadTexts(kv, months);
  const seen = new Set();
  const hits = [];
  for (const it of headlines) {
    if (!it.id || seen.has(it.id)) continue;
    const body = texts.get(it.id) || "";
    const titleHit = queryMatches(it.title, parsed);
    const bodyHit = !!(body && queryMatches(body, parsed));
    if (!titleHit && !bodyHit) continue;
    seen.add(it.id);
    hits.push(publicHit(it, bodyHit ? snippetAround(body, parsed, 200) : ""));
  }
  // Sort like the page (newest date, then docview id descending).
  sortStories(hits.map((h) => (h.doc = h.id, h)));
  for (const h of hits) delete h.doc;
  return hits.slice(0, MAX_HITS);
}
