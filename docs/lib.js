// Pure helpers for the News page (no DOM). Shared by app.js and the node tests.

const TZ = "America/New_York";
export const PAPERS = ["NYT", "WSJ"];

// Official section tabs, named and ordered like each paper's own site navigation.
// NYT: 2026 masthead (U.S., World, Business, Arts, Lifestyle, Opinion) plus the
// official section-menu items the site still uses (Politics and New York under U.S.,
// Technology under Business, Books under Arts, Style/Food/Travel/Magazine under
// Lifestyle, then Science, Climate, Health, The Athletic, Real Estate).
export const NYT_SECTIONS = [
  "U.S.", "Politics", "New York", "World", "Business", "Technology", "Arts", "Books",
  "Lifestyle", "Style", "Food", "Travel", "Magazine", "Opinion", "Science", "Climate",
  "Health", "Well", "The Athletic", "Real Estate", "Games", "Other",
];
// WSJ: live top nav on wsj.com, with Science after that (a real section, not in the slim bar).
export const WSJ_SECTIONS = [
  "World", "Business", "U.S.", "Politics", "Economy", "Tech", "Markets & Finance",
  "Opinion", "Arts", "Lifestyle", "Real Estate", "Personal Finance", "Health", "Style",
  "Sports", "Science", "Other",
];
// Under All: one merged list. Shared names stay one tab; Tech/Technology and
// Sports/The Athletic are aliases (see SECTION_ALIASES). Cards still show each
// paper's own label.
export const MERGED_SECTIONS = [
  "U.S.", "Politics", "New York", "World", "Business", "Economy", "Technology",
  "Markets & Finance", "Personal Finance", "Arts", "Books", "Lifestyle", "Style",
  "Food", "Travel", "Magazine", "Opinion", "Science", "Climate", "Health", "Well",
  "Sports", "Real Estate", "Games", "Other",
];
// Kept as a union for hash validation and older links.
export const SECTION_ORDER = [...new Set([...MERGED_SECTIONS, ...NYT_SECTIONS, ...WSJ_SECTIONS])];

// Aliases used when switching papers or viewing All. Keys are stored/official labels.
export const SECTION_ALIASES = {
  Tech: "Technology",
  Technology: "Tech",
  "The Athletic": "Sports",
  Sports: "The Athletic",
  Markets: "Markets & Finance",
  "Markets & Finance": "Markets & Finance",
  "Life & Arts": "Lifestyle",
  Lifestyle: "Lifestyle",
};

// On a single paper, parent tabs include these official subsections (the way the
// site's menus nest them). Stored labels stay the specific section. All-papers
// view does not roll up, so Politics and U.S. stay distinct across both papers.
export const SECTION_FAMILY = {
  NYT: {
    "U.S.": ["U.S.", "Politics", "New York"],
    Business: ["Business", "Technology"],
    Arts: ["Arts", "Books"],
    Lifestyle: ["Lifestyle", "Style", "Food", "Travel", "Magazine", "Well"],
    "The Athletic": ["The Athletic"],
  },
  WSJ: {
    // Top-nav items are first-class on wsj.com (Economy, Tech, Personal Finance,
    // Style and Lifestyle are separate). Only path-children are grouped here.
    Opinion: ["Opinion"],
    Business: ["Business"],
  },
};

export const sectionRank = (s, paper = "All") => {
  const order = paper === "NYT" ? NYT_SECTIONS : paper === "WSJ" ? WSJ_SECTIONS : MERGED_SECTIONS;
  const i = order.indexOf(s);
  return i < 0 ? 99 : i;
};

export function tabsForPaper(paper = "All") {
  return paper === "NYT" ? NYT_SECTIONS : paper === "WSJ" ? WSJ_SECTIONS : MERGED_SECTIONS;
}

export function canonicalSection(name, paper = "All") {
  const s = String(name || "");
  if (!s || s === "All") return s || "All";
  const tabs = tabsForPaper(paper);
  if (tabs.includes(s)) return s;
  const alias = SECTION_ALIASES[s];
  if (alias && tabs.includes(alias)) return alias;
  // Merged view uses the merged label for aliased pairs.
  if (paper === "All") {
    if (s === "Tech") return "Technology";
    if (s === "The Athletic") return "Sports";
    if (s === "Markets" || s === "Markets & Finance") return "Markets & Finance";
    if (s === "Life & Arts") return "Lifestyle";
  }
  return "";
}

export function isKnownSection(name) {
  return !!canonicalSection(name, "All") || NYT_SECTIONS.includes(name) || WSJ_SECTIONS.includes(name) || SECTION_ORDER.includes(name);
}

// When switching papers, keep the selection if that paper (or All) has an equivalent tab.
export function resolveSection(selected, fromPaper, toPaper) {
  if (!selected || selected === "All") return "All";
  const next = canonicalSection(selected, toPaper);
  return next || "All";
}

export function sectionGroup(tab, paper = "All") {
  if (!tab || tab === "All") return null;
  if (paper === "All") {
    const key = canonicalSection(tab, "All") || tab;
    const group = new Set([key, tab]);
    if (key === "Technology") group.add("Tech");
    if (key === "Sports") group.add("The Athletic");
    if (key === "Markets & Finance") group.add("Markets");
    if (key === "Lifestyle") group.add("Life & Arts");
    return group;
  }
  const family = (SECTION_FAMILY[paper] || {})[tab];
  return new Set(family && family.length ? family : [tab]);
}

export function sectionMatches(itemSection, tab, paper = "All") {
  if (!tab || tab === "All") return true;
  if (!itemSection) return false;
  const group = sectionGroup(tab, paper);
  return group ? group.has(itemSection) : itemSection === tab;
}

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
        date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || "") ? raw.date : "", rank, i,
        ...(raw.section ? { section: raw.section } : {}) });
    });
  }
  return sortStories(out);
}

export function filterItems(items, paper = "All", section = "All") {
  return (items || []).filter((it) =>
    (paper === "All" || it.paper === paper) &&
    sectionMatches(it.section, section, paper));
}

// Tabs to show for the current paper filter. Empty tabs are hidden. A parent tab
// (e.g. NYT U.S.) appears when any of its official subsections has an item.
export function sectionsFor(items, paper = "All") {
  const pool = (items || []).filter((it) => (paper === "All" || it.paper === paper) && it.section);
  return tabsForPaper(paper).filter((tab) => {
    if (tab === "Other") return pool.some((it) => it.section === "Other");
    return pool.some((it) => sectionMatches(it.section, tab, paper));
  });
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
export function mergeSearchHits(headlineItems, hits, paper = "All", libraryLink, section = "All") {
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
    // Full-text hits without a known section only appear under All.
    if (section !== "All" && hit.section && !sectionMatches(hit.section, section, paper)) continue;
    const id = String(hit.id || hit.doc || "");
    if (!id) continue;
    const existing = out.get(id);
    const snippet = typeof hit.snippet === "string" ? hit.snippet : "";
    if (existing) {
      if (snippet) existing.snippet = snippet;
      if (!existing.section && hit.section) existing.section = hit.section;
      continue;
    }
    const link = hit.link || (libraryLink ? libraryLink(id) : "");
    if (!hit.title || !link) continue;
    out.set(id, { paper: hit.paper || "", title: hit.title, date: /^\d{4}-\d{2}-\d{2}$/.test(hit.date || "") ? hit.date : "",
      link, doc: id, snippet, rank: PAPERS_RANK(hit.paper), i: 0, ...(hit.section ? { section: hit.section } : {}) });
  }
  let items = [...out.values()];
  if (paper !== "All") items = items.filter((it) => it.paper === paper);
  if (section !== "All") items = items.filter((it) => sectionMatches(it.section, section, paper));
  return sortStories(items);
}
