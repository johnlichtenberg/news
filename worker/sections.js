// Map NYT and WSJ articles to a shared set of section tabs, using the papers' own
// assignment: the section segment in the official URL (and, when a title is known,
// public news sitemaps / RSS). ProQuest feeds have no section field and their
// links are docview URLs, so headlines are matched to those public URLs.
// Publisher URLs are never added to the public page or API items.

const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

export const SECTION_ORDER = [
  "World", "U.S.", "Politics", "Business", "Tech", "Science", "Health", "Opinion",
  "Arts", "Books", "Sports", "Style", "Food", "Travel", "Real Estate", "Markets",
  "Life & Arts", "Other",
];

export const sectionRank = (s) => {
  const i = SECTION_ORDER.indexOf(s);
  return i < 0 ? 99 : i;
};

// NYT path segment after /yyyy/mm/dd/ (or the effective section, e.g. us/politics -> politics).
const NYT_MAP = {
  world: "World",
  us: "U.S.",
  nyregion: "U.S.",
  education: "U.S.",
  politics: "Politics",
  elections: "Politics",
  business: "Business",
  economy: "Business",
  dealbook: "Business",
  technology: "Tech",
  personaltech: "Tech",
  science: "Science",
  climate: "Science",
  space: "Science",
  weather: "Science",
  energyenvironment: "Science",
  health: "Health",
  well: "Health",
  opinion: "Opinion",
  "sunday-review": "Opinion",
  arts: "Arts",
  movies: "Arts",
  music: "Arts",
  theater: "Arts",
  dance: "Arts",
  television: "Arts",
  artanddesign: "Arts",
  books: "Books",
  sports: "Sports",
  athletic: "Sports",
  style: "Style",
  fashion: "Style",
  "t-magazine": "Style",
  tmagazine: "Style",
  dining: "Food",
  food: "Food",
  cooking: "Food",
  travel: "Travel",
  realestate: "Real Estate",
  "your-money": "Markets",
  yourmoney: "Markets",
};

// WSJ first path segment (wsj.com/<section>/...).
const WSJ_MAP = {
  world: "World",
  "us-news": "U.S.",
  us: "U.S.",
  politics: "Politics",
  business: "Business",
  economy: "Business",
  pro: "Business",
  "cio-journal": "Business",
  "cfo-journal": "Business",
  "cmo-today": "Business",
  "logistics-report": "Business",
  "risk-compliance-journal": "Business",
  tech: "Tech",
  technology: "Tech",
  science: "Science",
  health: "Health",
  opinion: "Opinion",
  "arts-culture": "Arts",
  arts: "Arts",
  sports: "Sports",
  style: "Style",
  lifestyle: "Life & Arts",
  "life-arts": "Life & Arts",
  food: "Food",
  travel: "Travel",
  "real-estate": "Real Estate",
  finance: "Markets",
  markets: "Markets",
  "personal-finance": "Markets",
};

// Newsletter / desk prefixes the papers put on some ProQuest headlines.
// Used only when no official URL is found. "Breaking news:" is stripped, not assigned.
const PREFIX_RE = /^(breaking news|the world|the morning|the evening|the gift|n\.?y\.? today|today'?s headlines|quote of the day|the daily|the local|from the front page|dealbook|on tech|opinion today|the opinions|the book review|science times|climate(?: forward)?|the fashions|travel dispatch|where to eat|watching|watch|shows|extra credit|word of the day|15-minute lesson plan|gameplay|upshot|corrections|opinion|daily briefing)\s*:\s*/i;

const PREFIX_SECTION = {
  dealbook: "Business",
  "on tech": "Tech",
  "opinion today": "Opinion",
  "the opinions": "Opinion",
  opinion: "Opinion",
  "the book review": "Books",
  "science times": "Science",
  climate: "Science",
  "climate forward": "Science",
  "the fashions": "Style",
  "the gift": "Style",
  "travel dispatch": "Travel",
  "where to eat": "Food",
  watching: "Arts",
  watch: "Arts",
  shows: "Arts",
  "n.y. today": "U.S.",
  "ny today": "U.S.",
  "the local": "U.S.",
  "the morning": "Other",
  "the evening": "Other",
  "the world": "Other",
  "todays headlines": "Other",
  "today's headlines": "Other",
  "quote of the day": "Other",
  "from the front page": "Other",
  "extra credit": "Other",
  "word of the day": "Other",
  "15-minute lesson plan": "Other",
  gameplay: "Other",
  corrections: "Other",
  upshot: "Other",
  "daily briefing": "Other",
};

const STOP = new Set(("a an the of and to in for on with at by from as is are was were be or but this that it its " +
  "his her their up out over into about not").split(" "));

export function etDay(isoOrMs) {
  const t = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  return Number.isFinite(t) ? ET_DAY.format(t) : "";
}

export function normTitle(s) {
  let t = String(s || "");
  t = t.replace(/&amp;/gi, "and").replace(/&nbsp;/gi, " ").replace(/&#(?:x[0-9a-f]+|\d+);/gi, " ");
  t = t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  t = t.replace(/[\u2013\u2014]/g, "-").replace(/\u00a0/g, " ");
  t = t.replace(/&/g, " and ").toLowerCase();
  t = t.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return t;
}

function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 5) return w.slice(0, -3) + "y";
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ss")) return w;
  if (w.endsWith("s") && !w.endsWith("us")) return w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 6) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 5) return w.slice(0, -2);
  return w;
}

export function titleTokens(s) {
  return normTitle(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

export function slugKey(slug) {
  let s = String(slug || "");
  s = s.replace(/-[0-9a-f]{8}$/i, "");
  if (s.endsWith(".html")) s = s.slice(0, -5);
  return normTitle(s.replace(/-/g, " "));
}

export function titleVariants(title) {
  const out = [], seen = new Set();
  const add = (t) => {
    t = String(t || "").trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  };
  add(title);
  const stripped = String(title || "").replace(PREFIX_RE, "").trim();
  add(stripped);
  if (stripped.includes(":")) {
    const i = stripped.lastIndexOf(":");
    const left = stripped.slice(0, i).trim(), right = stripped.slice(i + 1).trim();
    if (right && right.split(/\s+/).length <= 4 && /^[A-Z]/.test(right)) add(left);
  }
  const parts = stripped.split(/(?<=[.!?])\s+/);
  if (parts.length > 1 && parts[0].split(/\s+/).length >= 5) add(parts[0].replace(/[.!?]$/, ""));
  add(stripped.replace(/:\s*(News Analysis|Review|Opinion|Editorial|Comment|Late Night ROUNDUP)\s*$/i, "").trim());
  return out;
}

export function prefixSection(title) {
  const m = /^([^:]{1,40}):\s+\S/.exec(String(title || ""));
  if (!m) return "";
  const key = m[1].toLowerCase().replace(/['’]/g, "").replace(/\./g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return PREFIX_SECTION[key] || "";
}

export function tabFor(paper, raw) {
  const key = String(raw || "").toLowerCase();
  if (!key) return "";
  const map = paper === "WSJ" ? WSJ_MAP : NYT_MAP;
  return map[key] || "Other";
}

// Official article URL -> { raw, date, slug } using the path the paper itself uses.
export function sectionFromUrl(url, paper) {
  let u;
  try { u = new URL(String(url || "")); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  const path = u.pathname || "";
  if (paper === "NYT" || host === "nytimes.com") {
    if (host && host !== "nytimes.com") return null;
    if (/\/espanol\//.test(path)) return null;
    return nytFromPath(path);
  }
  if (paper === "WSJ" || host === "wsj.com") {
    if (host && host !== "wsj.com") return null;
    return wsjFromPath(path);
  }
  return null;
}

function nytFromPath(path) {
  const m = /^\/(?:(interactive|live|video)\/)?(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)(?:\/([^/]+))?/.exec(path);
  if (m) {
    let raw = m[5].toLowerCase();
    let sub = (m[6] || "").toLowerCase();
    if (sub.endsWith(".html")) sub = sub.slice(0, -5);
    // Politics is a top-level NYT section whose articles live under /us/politics/ and /us/elections/.
    if (raw === "us" && (sub === "politics" || sub === "elections")) raw = "politics";
    const slug = lastSeg(path);
    return { paper: "NYT", raw, date: `${m[2]}-${m[3]}-${m[4]}`, slug, kind: m[1] || "dated" };
  }
  if (path.startsWith("/athletic/")) {
    const d = /\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(path);
    return { paper: "NYT", raw: "athletic", date: d ? `${d[1]}-${d[2]}-${d[3]}` : "", slug: lastSeg(path), kind: "athletic" };
  }
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return null;
  return { paper: "NYT", raw: parts[0].toLowerCase(), date: "", slug: lastSeg(path), kind: "other" };
}

function wsjFromPath(path) {
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return null;
  return { paper: "WSJ", raw: parts[0].toLowerCase(), date: "", slug: lastSeg(path).replace(/-[0-9a-f]{8}$/i, ""), kind: "wsj" };
}

function lastSeg(path) {
  let s = path.replace(/\/+$/, "").split("/").pop() || "";
  if (s.endsWith(".html")) s = s.slice(0, -5);
  return s;
}

// ---- sitemap / RSS catalog -------------------------------------------------

export function parseLocs(xml) {
  return [...String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => decodeXml(m[1].trim()));
}

function decodeXml(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function tagText(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}\\s*>`, "i").exec(block);
  return m ? decodeXml(m[1].trim()) : "";
}

// urlset (monthly or Google news sitemap) -> catalog entries.
export function parseUrlset(xml, paper) {
  const out = [];
  const blocks = String(xml || "").match(/<url\b[\s\S]*?<\/url\s*>/gi) || [];
  for (const block of blocks) {
    const url = tagText(block, "loc");
    if (!url) continue;
    const info = sectionFromUrl(url, paper);
    if (!info) continue;
    const title = tagText(block, "news:title");
    const pub = tagText(block, "news:publication_date") || tagText(block, "lastmod");
    if (pub && !info.date) info.date = etDay(pub);
    out.push({ title, url, ...info });
  }
  return out;
}

// RSS / Atom section feeds (titles + links) -> catalog entries. The feed's
// section is not used when the URL names a different home section: section
// fronts often feature stories from other desks.
export function parseRssEntries(xml, paper) {
  const out = [];
  const items = String(xml || "").match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/gi) || [];
  for (const block of items) {
    let title = tagText(block, "title");
    title = title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    let url = tagText(block, "link") || tagText(block, "guid");
    if (!/^https?:/i.test(url)) {
      const href = /<link[^>]+href="([^"]+)"/i.exec(block);
      url = href ? decodeXml(href[1]) : "";
    }
    const info = sectionFromUrl(url, paper);
    if (!title || !info) continue;
    const pub = tagText(block, "pubDate") || tagText(block, "dc:date");
    if (pub && !info.date) info.date = etDay(pub);
    out.push({ title, url, ...info });
  }
  return out;
}

export function catalogMonthUrl(paper, month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || "");
  if (!m) return "";
  const year = m[1], mo = +m[2];
  if (paper === "NYT") return `https://www.nytimes.com/sitemaps/new/sitemap-${year}-${String(mo).padStart(2, "0")}.xml.gz`;
  if (paper === "WSJ") return `https://www.wsj.com/sitemaps/web/wsj/en/sitemap_wsj_en_m${mo}_${year}.xml`;
  return "";
}

export const NEWS_SITEMAPS = {
  NYT: "https://www.nytimes.com/sitemaps/new/news.xml.gz",
  WSJ: "https://www.wsj.com/wsjsitemaps/wsj_google_news.xml",
};

// ---- matching --------------------------------------------------------------

function dayNum(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? +d.replace(/-/g, "") : 0;
}

function scoreSlug(title, slug) {
  const tt = titleTokens(title), st = titleTokens(slug);
  if (!tt.length || !st.length) return 0;
  const ts = new Set(tt), ss = new Set(st);
  let n = 0;
  for (const w of ss) if (ts.has(w)) n++;
  if (!n) return 0;
  const cov = n / ss.size, prec = n / ts.size;
  if (ss.size <= 2) return (cov === 1 && prec >= 0.5 && n >= 2) ? 1.3 : 0;
  const ok = (cov >= 0.75 && n >= 3) || (prec >= 0.8 && n >= 4) || (cov >= 0.6 && prec >= 0.5 && n >= 4);
  return ok ? cov * 1.5 + prec * 1.5 + Math.min(n, 8) * 0.08 : 0;
}

export function buildIndex(entries) {
  const titles = new Map(); // normTitle -> [entry]
  const slugs = new Map();
  const inv = new Map();
  for (const e of entries || []) {
    if (e.title) {
      const k = normTitle(e.title);
      if (k) {
        if (!titles.has(k)) titles.set(k, []);
        titles.get(k).push(e);
      }
    }
    if (e.slug) {
      const k = slugKey(e.slug);
      if (k) {
        if (!slugs.has(k)) slugs.set(k, []);
        slugs.get(k).push(e);
        for (const t of titleTokens(e.slug)) {
          if (!inv.has(t)) inv.set(t, []);
          inv.get(t).push(e);
        }
      }
    }
  }
  return { titles, slugs, inv };
}

function pickSameRaw(list, date) {
  if (!list || !list.length) return null;
  let pick = list;
  const dn = dayNum(date);
  if (dn) {
    const close = list.filter((e) => e.date && Math.abs(dayNum(e.date) - dn) <= 3);
    if (close.length) pick = close;
  }
  const raws = new Set(pick.map((e) => e.raw));
  return raws.size === 1 || pick.length === 1 ? pick[0] : null;
}

// Match a ProQuest headline to a catalog entry. Returns { section, raw, how } or null.
export function matchHeadline(title, date, paper, index) {
  if (!title || !index) return null;
  for (const v of titleVariants(title)) {
    const hit = pickSameRaw(index.titles.get(normTitle(v)), date);
    if (hit) return { section: tabFor(paper, hit.raw), raw: hit.raw, how: "title", url: hit.url };
    const slugHit = pickSameRaw(index.slugs.get(normTitle(v)), date);
    if (slugHit) return { section: tabFor(paper, slugHit.raw), raw: slugHit.raw, how: "slug-exact", url: slugHit.url };
  }
  const cands = [];
  const seen = new Set();
  for (const v of titleVariants(title)) {
    const rare = [...new Set(titleTokens(v))].sort((a, b) => (index.inv.get(a) || []).length - (index.inv.get(b) || []).length).slice(0, 12);
    for (const t of rare) {
      for (const rec of index.inv.get(t) || []) {
        const id = rec.url || rec.slug;
        if (seen.has(id)) continue;
        seen.add(id);
        let sc = scoreSlug(v, rec.slug);
        if (sc <= 0) continue;
        if (date && rec.date) {
          const dd = Math.abs(dayNum(date) - dayNum(rec.date));
          if (dd <= 1) sc += 0.4;
          else if (dd <= 3) sc += 0.1;
          else if (dd > 10) sc -= 1.0;
        }
        cands.push([sc, rec]);
      }
    }
  }
  cands.sort((a, b) => b[0] - a[0]);
  if (!cands.length) return null;
  const best = cands[0], second = cands[1];
  const same = second && best[1].raw === second[1].raw;
  if (best[0] >= 2.2 && (!second || best[0] >= second[0] + 0.3 || same)) {
    return { section: tabFor(paper, best[1].raw), raw: best[1].raw, how: "slug-score", url: best[1].url };
  }
  if (same && best[0] >= 2.0) {
    return { section: tabFor(paper, best[1].raw), raw: best[1].raw, how: "slug-tied", url: best[1].url };
  }
  return null;
}

export function assignSection(item, index) {
  if (!item || item.section) return item && item.section ? item.section : "";
  const paper = item.paper || "";
  const found = index ? matchHeadline(item.title, item.date || "", paper, index) : null;
  if (found && found.section) return found.section;
  return prefixSection(item.title) || "";
}

// Fill missing section on a list. Does not overwrite an already stored section.
export function assignSections(items, index) {
  if (!items || !items.length) return items || [];
  return items.map((it) => {
    if (!it || it.section) return it;
    const section = assignSection(it, index);
    return section ? { ...it, section } : it;
  });
}

export const CATALOG_KEY = "seccat";
export const CATALOG_TTL_MS = 3 * 60 * 60 * 1000;
const UA = "news-feeds-relay (personal RSS reader)";

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/xml, text/xml, application/gzip, */*" },
  });
  if (!r.ok) throw new Error("sitemap " + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  // Some NYT ".gz" sitemaps are served as plain XML.
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    if (typeof DecompressionStream === "function") {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).text();
    }
  }
  return new TextDecoder("utf-8").decode(buf);
}

// Build a matcher index from already-parsed catalog entries (tests / backfill).
export function indexFromEntries(nytEntries, wsjEntries) {
  return {
    NYT: buildIndex(nytEntries || []),
    WSJ: buildIndex(wsjEntries || []),
  };
}

export function matchWithCatalog(item, catalogs) {
  if (!item) return "";
  if (item.section) return item.section;
  const idx = catalogs && catalogs[item.paper];
  const found = idx ? matchHeadline(item.title, item.date || "", item.paper, idx) : null;
  if (found && found.section) return found.section;
  return prefixSection(item.title) || "";
}

export const _catalog = { memo: null, inflight: null, reset() { this.memo = null; this.inflight = null; } };

export async function loadCatalog(env, now = Date.now(), month) {
  const mo = month || ET_DAY.format(now).slice(0, 7);
  if (_catalog.memo && _catalog.memo.month === mo && now - (_catalog.memo.at || 0) < CATALOG_TTL_MS) {
    return _catalog.memo.value;
  }
  if (_catalog.inflight) return _catalog.inflight;
  _catalog.inflight = loadCatalogFresh(env, now, mo).then((value) => {
    _catalog.memo = { month: mo, at: now, value };
    return value;
  }).finally(() => { _catalog.inflight = null; });
  return _catalog.inflight;
}

async function loadCatalogFresh(env, now, mo) {
  const kv = env && env.NEWS_HISTORY;
  if (kv) {
    try {
      const cached = await kv.get(CATALOG_KEY, "json");
      if (cached && cached.month === mo && cached.updated && now - Date.parse(cached.updated) < CATALOG_TTL_MS) {
        return thawCatalog(cached);
      }
    } catch { /* rebuild */ }
  }
  const entries = { NYT: [], WSJ: [] };
  const jobs = [];
  for (const paper of ["NYT", "WSJ"]) {
    const news = NEWS_SITEMAPS[paper];
    const monthUrl = catalogMonthUrl(paper, mo);
    if (news) jobs.push(fetchText(news).then((xml) => { entries[paper].push(...parseUrlset(xml, paper)); }).catch(() => {}));
    if (monthUrl) jobs.push(fetchText(monthUrl).then((xml) => { entries[paper].push(...parseUrlset(xml, paper)); }).catch(() => {}));
  }
  await Promise.all(jobs);
  const catalog = { month: mo, updated: new Date(now).toISOString(), entries };
  if (kv && (entries.NYT.length || entries.WSJ.length)) {
    try {
      // Store a compact form (no publisher URLs) so KV stays small and public dumps wouldn't leak links.
      await kv.put(CATALOG_KEY, JSON.stringify(freezeCatalog(catalog)));
    } catch { /* ignore */ }
  }
  return { month: mo, NYT: buildIndex(entries.NYT), WSJ: buildIndex(entries.WSJ), ok: !!(entries.NYT.length || entries.WSJ.length) };
}

function freezeCatalog(catalog) {
  const pack = (list) => (list || []).map((e) => [
    e.title || "", e.raw || "", e.slug || "", e.date || "",
  ]);
  return { month: catalog.month, updated: catalog.updated, nyt: pack(catalog.entries.NYT), wsj: pack(catalog.entries.WSJ) };
}

function thawCatalog(cached) {
  const unpack = (paper, rows) => (rows || []).map((r) => ({
    title: r[0], raw: r[1], slug: r[2], date: r[3], paper,
  }));
  return {
    month: cached.month,
    NYT: buildIndex(unpack("NYT", cached.nyt)),
    WSJ: buildIndex(unpack("WSJ", cached.wsj)),
    ok: true,
    cached: true,
  };
}

export function applyCatalog(items, catalogs) {
  if (!items || !items.length) return items || [];
  return items.map((it) => {
    if (!it || it.section) return it;
    const section = matchWithCatalog(it, catalogs);
    return section ? { ...it, section } : it;
  });
}

