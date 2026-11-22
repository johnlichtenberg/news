// Pure helpers for the News page (no DOM). Shared by app.js and the node tests.

const TZ = "America/New_York";
export const PAPERS = ["NYT", "WSJ"];

// ProQuest docview id of a library link ("" if none), as a digit string.
export const docId = (link) => (/\/docview\/(\d+)/.exec(link || "") || [])[1] || "";
// Numeric descending compare of digit strings (no precision limit): longer is larger, then lexical.
const byIdDesc = (a, b) => (b.length - a.length) || (b < a ? -1 : b > a ? 1 : 0);
const docOf = (it) => it.doc || it.id || "";

// Same order as the page list: newest date first; within a date, docview id descending.
export function sortStories(items) {
  return items.sort((a, b) => (b.date || "").localeCompare(a.date || "") ||
    (!docOf(a) - !docOf(b)) || byIdDesc(docOf(a), docOf(b)) || (a.rank || 0) - (b.rank || 0) || (a.i || 0) - (b.i || 0));
}

// Combine the feed results into one list: newest date first; within a date, ProQuest docview id descending
// (numeric, NYT and WSJ mixed). Items without an id go after those with one in the same date, in NYT-then-WSJ
// feed order. Undated items go last.
export function combineFeeds(results) {
  const out = [];
  for (const res of results || []) {
    if (!res || !Array.isArray(res.items)) continue;
    const rank = PAPERS.indexOf(res.paper) < 0 ? 99 : PAPERS.indexOf(res.paper);
    res.items.forEach((raw, i) => {
      if (!raw || !raw.title || !raw.link) return;
      out.push({ paper: raw.paper || res.paper, title: raw.title, link: raw.link, doc: docId(raw.link),
        date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || "") ? raw.date : "", rank, i });
    });
  }
  return sortStories(out);
}

export function filterItems(items, paper = "All") {
  return paper === "All" ? items : items.filter((it) => it.paper === paper);
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

// Today's date in Eastern Time as YYYY-MM-DD.
export function etToday(now = Date.now()) { return dayFmt.format(now); }

// "Today", "Yesterday", or e.g. "Mon, Nov 16" for a YYYY-MM-DD date (dates are ET calendar days).
export function dayLabel(date, now = Date.now()) {
  if (!date) return "Undated";
  const today = etToday(now), yest = etToday(now - 86400000);
  if (date === today) return "Today";
  if (date === yest) return "Yesterday";
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d, 12);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
    ...(String(y) !== today.slice(0, 4) ? { year: "numeric" } : {}) }).format(t);
}

export function clockET(time) { return Number.isFinite(time) ? timeFmt.format(time) + " ET" : ""; }

// Lists per feed for display: the recent response's items, then each loaded older month (newest first).
// results: [{ id, paper, items, older }]; extra: Map(feed id -> Map(month -> items)).
export function feedLists(results, extra = new Map()) {
  return (results || []).filter(Boolean).map((res) => {
    const ex = extra.get(res.id) || new Map();
    const months = [...ex.keys()].sort().reverse();
    return { ...res, items: [...(res.items || []), ...months.flatMap((m) => ex.get(m) || [])] };
  });
}

// The newest month not yet loaded across all feeds (for "Load older"), or "".
export function nextOlderMonth(results, extra = new Map()) {
  const months = new Set();
  for (const res of results || []) {
    if (!res) continue;
    const have = extra.get(res.id);
    for (const m of res.older || []) if (/^\d{4}-\d{2}$/.test(m) && !(have && have.has(m))) months.add(m);
  }
  return [...months].sort().reverse()[0] || "";
}

export function monthLabel(m) {
  const [y, mo] = String(m).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(Date.UTC(y, mo - 1, 15));
}


// --- headline / body search -------------------------------------------------
// Quoted "phrases" are exact substrings; unquoted tokens are AND; all case-insensitive.
export function parseQuery(q) {
  const phrases = [], words = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  const s = String(q || "").trim();
  while ((m = re.exec(s))) {
    if (m[1] != null) { const p = m[1].trim().toLowerCase(); if (p) phrases.push(p); }
    else { const w = m[2].toLowerCase(); if (w && w !== '"') words.push(w); }
  }
  return { phrases, words };
}

export function queryMatches(text, parsed) {
  if (!parsed || (!parsed.phrases.length && !parsed.words.length)) return false;
  const hay = String(text || "").toLowerCase();
  return parsed.phrases.every((p) => hay.includes(p)) && parsed.words.every((w) => hay.includes(w));
}

// Filter already-combined page items by headline. An empty query leaves the list unchanged.
export function filterByQuery(items, q) {
  const parsed = parseQuery(q);
  if (!parsed.phrases.length && !parsed.words.length) return items;
  return items.filter((it) => queryMatches(it.title, parsed));
}

// A short excerpt of `text` (~max characters) centered on the first query match. Never returns more
// than `max` characters of the source (ellipsis marks are extra). Empty if the text does not match.
export function snippetAround(text, parsed, max = 200) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw || !parsed) return "";
  const hay = raw.toLowerCase();
  let idx = -1, len = 0;
  for (const term of [...parsed.phrases, ...parsed.words]) {
    if (!term) continue;
    const i = hay.indexOf(term);
    if (i >= 0 && (idx < 0 || i < idx)) { idx = i; len = term.length; }
  }
  if (idx < 0) return "";
  const budget = Math.max(24, Math.min(200, max | 0));
  const pad = Math.max(0, Math.floor((budget - len) / 2));
  let start = Math.max(0, idx - pad), end = Math.min(raw.length, idx + len + pad);
  if (start > 0) { const sp = raw.lastIndexOf(" ", start); if (sp >= 0 && start - sp < 40) start = sp + 1; }
  if (end < raw.length) { const sp = raw.indexOf(" ", end); if (sp >= 0 && sp - end < 40) end = sp; }
  let s = raw.slice(start, end).trim();
  if (s.length > budget) s = s.slice(0, budget).replace(/\s+\S*$/, "").trim();
  if (start > 0) s = "\u2026" + s;
  if (end < raw.length) s = s + "\u2026";
  return s;
}

const PAPERS_RANK = (paper) => { const i = PAPERS.indexOf(paper); return i < 0 ? 99 : i; };

// Merge client-side headline matches with /search hits (which may include body-only matches and snippets).
// Remote-only hits are turned into page items (link is built from the docview id when missing).
// Result is filtered by paper and sorted like the main list. Never copies a `text` field.
export function mergeSearchHits(headlineItems, hits, paper = "All", libraryLink) {
  const out = new Map();
  for (const it of headlineItems || []) {
    if (!it) continue;
    const id = docOf(it);
    const key = id || "t:" + (it.title || "") + "@" + (it.date || "");
    out.set(key, { ...it });
  }
  for (const hit of hits || []) {
    if (!hit) continue;
    if (paper !== "All" && hit.paper && hit.paper !== paper) continue;
    const id = String(hit.id || hit.doc || "");
    if (!id) continue;
    const existing = out.get(id);
    const snippet = typeof hit.snippet === "string" ? hit.snippet : "";
    if (existing) {
      if (snippet) existing.snippet = snippet;
      continue;
    }
    const link = hit.link || (libraryLink ? libraryLink(id) : "");
    if (!hit.title || !link) continue;
    out.set(id, { paper: hit.paper || "", title: hit.title, date: /^\d{4}-\d{2}-\d{2}$/.test(hit.date || "") ? hit.date : "",
      link, doc: id, snippet, rank: PAPERS_RANK(hit.paper), i: 0 });
  }
  const items = [...out.values()];
  return paper === "All" ? sortStories(items) : sortStories(items.filter((it) => it.paper === paper));
}
