// Live ProQuest full-text search through the Arlington EZproxy, used by GET /search.
// Credentials (LIB_USER, LIB_PIN) are Worker secrets and are never logged, stored in KV, or returned.
// Only short snippets are kept from result pages — never full article text.
import { LIBRARY_LOGIN, PROQUEST_ACCOUNT } from "./feeds.js";
import { isSpanishTitle, isSpanishSource } from "./lang.js";
import { proquestDate } from "./parse.js";
import { sortStories } from "../docs/lib.js";

export const UA = "Mozilla/5.0 (compatible; news-feeds-relay personal reader)";
export const EZPROXY = "https://library.access.arlingtonva.us";
export const PQ_HOST = "https://www-proquest-com.library.access.arlingtonva.us";
export const SESSION_KEY = "lib:session";
export const CACHE_PREFIX = "pqcache:";
export const QUOTA_PREFIX = "pqquota:";
export const LAST_KEY = "pq:last";
export const SESSION_TTL_MS = 25 * 60 * 1000;
export const CACHE_TTL_S = 3600;
export const QUOTA_DAY = 200;
export const SPACING_MS = 3000;
export const MAX_PER_PAPER = 20;
export const MAX_HITS = 50;

export const SITES = [
  { paper: "NYT", path: "nytimes" },
  { paper: "WSJ", path: "wallstreetjournal" },
];

export const libraryLink = (id) =>
  `${LIBRARY_LOGIN}https://www.proquest.com/docview/${id}?accountid=${PROQUEST_ACCOUNT}`;

// The exact ProQuest docview URL we allow EZproxy to send the browser to (never an open redirect).
export const docviewUrl = (id) =>
  `https://www.proquest.com/docview/${id}?accountid=${PROQUEST_ACCOUNT}`;

const CONNECT_HOSTS = new Set(["login.library.access.arlingtonva.us", "library.access.arlingtonva.us"]);

// A connect?session= Location is safe only if it is on the library EZproxy host and its qurl/url
// is the ProQuest docview page for this same numeric id.
export function isAllowedConnect(location, id) {
  let u;
  try { u = new URL(String(location || "")); } catch { return false; }
  if (!CONNECT_HOSTS.has(u.hostname.toLowerCase())) return false;
  if (u.pathname !== "/connect") return false;
  if (u.username || u.password) return false;
  const raw = u.searchParams.get("qurl") || u.searchParams.get("url") || "";
  let target;
  try { target = new URL(raw); } catch { return false; }
  if (target.protocol !== "https:" && target.protocol !== "http:") return false;
  if (target.username || target.password) return false;
  if (!/^(www|search)\.proquest\.com$/i.test(target.hostname)) return false;
  const m = target.pathname.match(/^\/(?:[a-z0-9]+\/)?docview\/(\d{3,15})(?:\/|$)/i);
  return !!(m && m[1] === String(id));
}

export function originAllowed(request, allowedOrigin) {
  const allowed = new URL(allowedOrigin || "https://johnlichtenberg.github.io");
  for (const name of ["Origin", "Referer"]) {
    const v = request.headers.get(name);
    if (!v) continue;
    let u;
    try { u = new URL(v); } catch { return false; }
    if (u.protocol !== allowed.protocol || u.hostname !== allowed.hostname) return false;
  }
  return true;
}

const etDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

export function cacheKey(q) {
  return CACHE_PREFIX + String(q || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 180);
}

export function quotaKey(now = Date.now()) {
  return QUOTA_PREFIX + etDay.format(now);
}

export function looksLikeChallenge(html) {
  return /recaptcha|g-recaptcha|hcaptcha|cf-challenge|cf-mitigated|just a moment|attention required|access denied|bot detected/i.test(String(html || ""));
}

export function looksLikeLogin(html) {
  return /name=["']pass["']/i.test(String(html || "")) || /<title[^>]*>\s*Library Login/i.test(String(html || ""));
}

export function looksLikeExpired(html, url) {
  const u = String(url || ""), h = String(html || "");
  return /sessionexpired/i.test(u) || /sessionexpired/i.test(h) || /your session has expired/i.test(h);
}

// --- cookie jar --------------------------------------------------------------
export function collectCookies(jar, response, reqUrl) {
  const host = new URL(reqUrl).hostname;
  const list = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  for (const raw of list || []) {
    if (!raw) continue;
    const parts = raw.split(";").map((s) => s.trim());
    const nv = parts[0];
    const eq = nv.indexOf("=");
    if (eq < 1) continue;
    const name = nv.slice(0, eq).trim(), value = nv.slice(eq + 1);
    if (!name) continue;
    const rec = { name, value, domain: host, path: "/" };
    for (const p of parts.slice(1)) {
      const [k, ...rest] = p.split("=");
      const key = k.trim().toLowerCase(), val = rest.join("=");
      if (key === "domain" && val) rec.domain = val.replace(/^\./, "");
      else if (key === "path" && val) rec.path = val;
    }
    jar = jar.filter((c) => !(c.name === rec.name && c.domain === rec.domain && c.path === rec.path));
    jar.push(rec);
  }
  return jar;
}

export function cookieHeader(jar, url) {
  const u = new URL(url);
  const host = u.hostname, path = u.pathname || "/";
  const out = [];
  const seen = new Set();
  for (const c of jar || []) {
    if (!c || !c.name) continue;
    const d = String(c.domain || "").replace(/^\./, "");
    if (d && host !== d && !host.endsWith("." + d)) continue;
    const p = c.path || "/";
    if (path !== p && !path.startsWith(p.endsWith("/") ? p : p + "/") && !(p === "/")) continue;
    const k = c.name;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k + "=" + c.value);
  }
  return out.join("; ");
}

// --- form + results parsing --------------------------------------------------
export function parseSearchForm(html) {
  const start = String(html || "").search(/<form\b[^>]*id=["']searchForm["'][^>]*>/i);
  if (start < 0) return null;
  const tagEnd = html.indexOf(">", start);
  const end = html.toLowerCase().indexOf("</form>", start);
  if (tagEnd < 0 || end < 0) return null;
  const tag = html.slice(start, tagEnd + 1);
  const inner = html.slice(tagEnd + 1, end);
  const am = /action=["']([^"']+)["']/i.exec(tag);
  const action = am ? am[1].replace(/&amp;/g, "&") : "";
  const fields = [];
  const re = /<(input|textarea|button)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(inner))) {
    const attrs = m[2];
    const name = (/name=["']([^"']+)["']/i.exec(attrs) || [])[1];
    if (!name) continue;
    const typ = ((/type=["']([^"']+)["']/i.exec(attrs) || [])[1] || m[1]).toLowerCase();
    if (typ === "submit" || typ === "button" || typ === "image") continue;
    const value = (/value=["']([^"']*)["']/i.exec(attrs) || [])[1] || "";
    fields.push({ name, type: typ, value: value.replace(/&amp;/g, "&") });
  }
  return { action, fields };
}

export function buildSearchBody(form, query) {
  const params = new URLSearchParams();
  let sawTerm = false, sawFt = false;
  for (const f of form.fields) {
    if (f.type === "checkbox") {
      if (f.name === "fullTextLimit") { params.append(f.name, f.value || "on"); sawFt = true; }
      continue;
    }
    if (f.name === "searchTerm") { params.append(f.name, query); sawTerm = true; continue; }
    params.append(f.name, f.value);
  }
  if (!sawTerm) params.append("searchTerm", query);
  if (!sawFt) params.append("fullTextLimit", "on");
  params.append("search", "Search");
  return params.toString();
}

export function parseCiteDate(text) {
  const s = String(text || "");
  const paren = s.match(/\(([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\)/);
  if (paren) return proquestDate(paren[1]) || null;
  const mdy = s.match(/\b([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\b/);
  if (mdy) return proquestDate(mdy[1]) || null;
  const dmy = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (dmy) return proquestDate(`${dmy[2]} ${dmy[1]}, ${dmy[3]}`) || null;
  return null;
}

export function classifyPaper(text, sitePaper) {
  const s = String(text || "");
  if (/español|espanol/i.test(s)) return "";
  if (/wall street journal/i.test(s)) return "WSJ";
  if (/new york times/i.test(s)) return "NYT";
  return sitePaper || "";
}

export function cleanTitle(title) {
  return String(title || "").replace(/\s*:\s*\[[^\]]+\]\s*$/, "").replace(/\s+/g, " ").trim();
}

function innerText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function snippetFrom(html, max = 200) {
  const s = innerText(html);
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "").trim() + "\u2026";
}

// Parse a ProQuest results list. Returns public items only (no full text).
export function parseResults(html, sitePaper) {
  const items = [];
  const seen = new Set();
  const blocks = String(html || "").split(/<li class="resultItem[^"]*"/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/li>/i)[0] || raw;
    const ids = [...block.matchAll(/docview\/(\d{3,15})/gi)].map((x) => x[1]);
    const id = ids[0];
    if (!id || seen.has(id)) continue;
    const titleM = /class="truncatedResultsTitle"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    const title = cleanTitle(innerText(titleM ? titleM[1] : ""));
    if (!title) continue;
    const snM = /<span class="snippet"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
    const snippet = snM ? snippetFrom(snM[1], 200) : "";
    const vis = innerText(block);
    if (isSpanishSource(vis) || isSpanishTitle(title)) continue;
    const paper = classifyPaper(vis, sitePaper);
    if (paper !== "NYT" && paper !== "WSJ") continue;
    seen.add(id);
    const date = parseCiteDate(vis) || "";
    items.push({ id, paper, date, title, link: libraryLink(id), ...(snippet ? { snippet } : {}) });
    if (items.length >= MAX_PER_PAPER) break;
  }
  return items;
}

export function mergeLiveHits(groups) {
  const seen = new Set(), out = [];
  for (const list of groups) {
    for (const it of list || []) {
      if (!it || !it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
  }
  sortStories(out.map((h) => (h.doc = h.id, h)));
  for (const h of out) delete h.doc;
  return out.slice(0, MAX_HITS);
}

// --- HTTP -------------------------------------------------------------------
async function pqFetch(url, jar, { method = "GET", body, headers } = {}) {
  const h = { "User-Agent": UA, ...(headers || {}) };
  const cookie = cookieHeader(jar, url);
  if (cookie) h.Cookie = cookie;
  if (body && !h["Content-Type"]) h["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
  const res = await fetch(url, { method, headers: h, body, redirect: "manual" });
  jar.splice(0, jar.length, ...collectCookies(jar, res, url));
  return res;
}

async function follow(url, jar, { method = "GET", body, max = 8 } = {}) {
  let u = url, m = method, b = body, last = null, text = "";
  for (let i = 0; i < max; i++) {
    last = await pqFetch(u, jar, { method: m, body: b });
    const loc = last.headers.get("Location");
    if (last.status >= 300 && last.status < 400 && loc) {
      u = new URL(loc, u).href;
      m = "GET";
      b = undefined;
      continue;
    }
    text = await last.text();
    return { url: u, res: last, text, jar };
  }
  return { url: u, res: last, text, jar, error: "too many redirects" };
}

export async function ezproxyLogin(user, pin) {
  if (!user || !pin) return { ok: false, error: "missing credentials", jar: [] };
  const jar = [];
  const start = EZPROXY + "/login";
  const body = new URLSearchParams({
    user, pass: pin,
    url: `https://www.proquest.com/nytimes/?accountid=${PROQUEST_ACCOUNT}`,
  }).toString();
  const hop = await follow(start, jar, { method: "POST", body });
  if (hop.error) return { ok: false, error: hop.error, jar };
  if (looksLikeChallenge(hop.text)) return { ok: false, error: "challenge", challenge: true, jar };
  if (looksLikeLogin(hop.text)) return { ok: false, error: "login rejected", jar };
  return { ok: true, jar };
}

// Fresh EZproxy login (no reused cookies) so the 302 is a connect?session= ticket the *browser*
// can redeem. The PIN never appears in the response. Only the validated Location is returned.
export async function ezproxyConnectTicket(user, pin, id) {
  if (!user || !pin || !id) return { ok: false, error: "missing" };
  const body = new URLSearchParams({ user, pass: pin, url: docviewUrl(id) }).toString();
  const res = await fetch(EZPROXY + "/login", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body,
    redirect: "manual",
  });
  const loc = res.headers.get("Location") || "";
  if (res.status >= 300 && res.status < 400 && isAllowedConnect(loc, id)) return { ok: true, url: loc };
  return { ok: false, error: "login failed" };
}

export async function searchSite(jar, site, query) {
  const start = `${PQ_HOST}/${site.path}/?accountid=${PROQUEST_ACCOUNT}`;
  const page = await follow(start, jar);
  if (looksLikeChallenge(page.text)) return { ok: false, error: "challenge", challenge: true, expired: false };
  if (looksLikeLogin(page.text) || looksLikeExpired(page.text, page.url)) {
    return { ok: false, error: "expired", expired: true };
  }
  const form = parseSearchForm(page.text);
  if (!form || !form.action) return { ok: false, error: "no search form", expired: false };
  const action = new URL(form.action, page.url).href;
  const posted = await follow(action, jar, { method: "POST", body: buildSearchBody(form, query) });
  if (looksLikeChallenge(posted.text)) return { ok: false, error: "challenge", challenge: true, expired: false };
  if (looksLikeLogin(posted.text) || looksLikeExpired(posted.text, posted.url)) {
    return { ok: false, error: "expired", expired: true };
  }
  return { ok: true, items: parseResults(posted.text, site.paper), expired: false };
}

// --- session / quota / cache in KV ------------------------------------------
export async function loadJar(kv) {
  if (!kv) return { jar: [], at: 0 };
  try {
    const v = await kv.get(SESSION_KEY, "json");
    if (!v || !Array.isArray(v.cookies) || !v.at) return { jar: [], at: 0 };
    if (Date.now() - v.at > SESSION_TTL_MS) return { jar: [], at: 0 };
    return { jar: v.cookies, at: v.at };
  } catch { return { jar: [], at: 0 }; }
}

export async function saveJar(kv, jar, now = Date.now()) {
  if (!kv) return;
  // Never persist credentials — only session cookies from EZproxy / ProQuest.
  await kv.put(SESSION_KEY, JSON.stringify({ cookies: jar, at: now }), { expirationTtl: Math.ceil(SESSION_TTL_MS / 1000) + 60 });
}

export async function cachedHits(kv, q) {
  if (!kv) return null;
  try { return await kv.get(cacheKey(q), "json"); } catch { return null; }
}

export async function storeHits(kv, q, items, now = Date.now()) {
  if (!kv) return;
  await kv.put(cacheKey(q), JSON.stringify({ q, at: now, items }), { expirationTtl: CACHE_TTL_S });
}

export async function takeQuota(kv, n, now = Date.now()) {
  if (!kv) return { ok: n <= QUOTA_DAY, used: n };
  const key = quotaKey(now);
  let used = 0;
  try {
    const v = await kv.get(key, "json");
    if (v && Number.isFinite(v.used)) used = v.used;
  } catch { /* ignore */ }
  if (used + n > QUOTA_DAY) return { ok: false, used };
  used += n;
  const ttl = 48 * 3600;
  await kv.put(key, JSON.stringify({ used, at: now }), { expirationTtl: ttl });
  return { ok: true, used };
}

const lastLive = { at: 0 };
export const _live = { lastLive };

export function spacingBlocked(now = Date.now()) {
  return now - lastLive.at < SPACING_MS;
}

export async function liveSearch(env, query, now = Date.now()) {
  const kv = env && env.NEWS_HISTORY;
  const cached = await cachedHits(kv, query);
  if (cached && Array.isArray(cached.items)) {
    return { ok: true, items: cached.items, source: "proquest", cached: true };
  }
  const user = env && env.LIB_USER, pin = env && env.LIB_PIN;
  if (!user || !pin) return { ok: false, error: "not configured", items: [] };

  if (spacingBlocked(now)) {
    return { ok: false, error: "busy", items: [], notice: "Full-text search is busy; showing headlines." };
  }

  const budget = await takeQuota(kv, 1, now); // reserve; we'll add remaining after
  if (!budget.ok) {
    return { ok: false, error: "quota", items: [], notice: "Full-text search is at today's limit; showing headlines." };
  }

  lastLive.at = now;
  let fetches = 1; // counted the reservation
  let { jar } = await loadJar(kv);
  const ensure = async () => {
    const login = await ezproxyLogin(user, pin);
    fetches++;
    if (!login.ok) return login;
    jar = login.jar;
    await saveJar(kv, jar, Date.now());
    return login;
  };
  if (!jar.length) {
    const login = await ensure();
    if (!login.ok) {
      const notice = login.challenge
        ? "Full-text search hit a sign-in check; showing headlines."
        : "Full-text search is unavailable; showing headlines.";
      return { ok: false, error: login.error, challenge: !!login.challenge, items: [], notice };
    }
  }

  const groups = [];
  let challenge = false, failed = 0;
  for (const site of SITES) {
    let r = await searchSite(jar, site, query);
    fetches++;
    if (r.expired) {
      const login = await ensure();
      if (!login.ok) {
        challenge = challenge || !!login.challenge;
        failed++;
        continue;
      }
      r = await searchSite(jar, site, query);
      fetches++;
    }
    if (r.challenge) challenge = true;
    if (r.ok) groups.push(r.items);
    else failed++;
    await saveJar(kv, jar, Date.now());
  }
  // The first takeQuota counted 1; record the rest (best-effort, may slightly exceed).
  if (fetches > 1) await takeQuota(kv, fetches - 1, Date.now());

  const items = mergeLiveHits(groups);
  if (!items.length && failed) {
    const notice = challenge
      ? "Full-text search hit a sign-in check; showing headlines."
      : "Full-text search is unavailable; showing headlines.";
    return { ok: false, error: "search failed", challenge, items: [], notice };
  }
  await storeHits(kv, query, items, Date.now());
  const notice = failed ? "Some full-text sources could not be searched." : undefined;
  return { ok: true, items, source: "proquest", cached: false, ...(notice ? { notice } : {}) };
}
