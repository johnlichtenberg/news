// Pure helpers for the headlines page (no DOM). Shared by app.js and the node tests.

export const SECTION_ORDER = ["Top Stories", "World", "U.S.", "Politics", "Economy", "Business", "Markets",
  "Personal Finance", "Tech", "Science", "Health", "Climate", "Opinion", "Arts", "Lifestyle", "ProQuest"];

const TZ = "America/New_York";

// Canonical key for duplicate detection: publisher host + path, no query/hash/trailing slash.
export function linkKey(link) {
  const pq = /proquest\.com\/(?:[a-z0-9]+\/)?docview\/(\d+)/i.exec(String(link || ""));
  if (pq) return "proquest:" + pq[1]; // library proxy links all share /login; key on the article id
  try {
    const u = new URL(link);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch { return String(link || "").toLowerCase(); }
}
const normTitle = (t) => String(t || "").toLowerCase().replace(/[\u2018\u2019']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// Short, generic headlines ("Here's the latest.") repeat across different live blogs, so only
// headlines of a reasonable length are used to match stories across feeds.
const titleKey = (it) => { const n = normTitle(it.title); return n.length >= 25 ? it.paper + "|" + n : ""; };

// Midnight Eastern Time at the start of a YYYY-MM-DD date (handles EST/EDT).
export function etMidnight(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!m) return NaN;
  for (const off of [5, 4]) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], off);
    const h = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(t);
    if (+h === 0) return t;
  }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 5);
}

// Merge feed results into one newest-first list without duplicates.
// An article that appears in several section feeds keeps every section.
// ProQuest alert items (source "proquest") carry an exact library article link (pqLink); when the
// same story is also in a publisher feed, the merged story keeps the publisher's time, summary and
// page link and gains the exact ProQuest link.
export function mergeItems(results) {
  const byLink = new Map(), byTitle = new Map(), out = [];
  for (const res of results || []) {
    if (!res || !Array.isArray(res.items)) continue;
    for (const raw of res.items) {
      if (!raw || !raw.title || !raw.link) continue;
      const pq = raw.source === "proquest";
      const lk = linkKey(raw.link), tk = titleKey(raw);
      const prev = byLink.get(lk) || (tk && byTitle.get(tk));
      const section = raw.section || res.section || "";
      let t = Date.parse(raw.published), dateOnly = false;
      if (!Number.isFinite(t) && raw.date) { t = etMidnight(raw.date); dateOnly = Number.isFinite(t); }
      if (prev) {
        if (section && !prev.sections.includes(section)) prev.sections.push(section);
        if (!prev.description && raw.description) prev.description = raw.description;
        if (pq && !prev.pqLink) prev.pqLink = raw.link;
        if (!pq && !prev.link) prev.link = raw.link;
        if (Number.isFinite(t) && (!Number.isFinite(prev.time) || (prev.dateOnly && !dateOnly) || (dateOnly === prev.dateOnly && t > prev.time))) {
          prev.time = t; prev.dateOnly = dateOnly; prev.published = raw.published || null;
        }
        byLink.set(lk, prev); if (tk) byTitle.set(tk, prev);
        continue;
      }
      const it = { paper: raw.paper || res.paper, title: raw.title, description: raw.description || "",
        link: pq ? "" : raw.link, pqLink: pq ? raw.link : "",
        published: raw.published || null, time: Number.isFinite(t) ? t : NaN, dateOnly, sections: section ? [section] : [] };
      byLink.set(lk, it); if (tk) byTitle.set(tk, it); out.push(it);
    }
  }
  // ProQuest sometimes glues the subhead onto the headline with just a space ("…His Bunker. Maj. Robert…").
  // Match such leftovers when a publisher headline (25+ chars) is a whole-word prefix of the ProQuest title.
  const pubs = out.filter((i) => i.link);
  const merged = new Set();
  for (const it of out) {
    if (it.link || !it.pqLink) continue;
    const n = normTitle(it.title);
    let best = null;
    for (const c of pubs) {
      if (c.paper !== it.paper || c.pqLink) continue;
      const cn = normTitle(c.title);
      if (cn.length >= 25 && n.startsWith(cn + " ") && (!best || cn.length > normTitle(best.title).length)) best = c;
    }
    if (best) {
      best.pqLink = it.pqLink;
      for (const sct of it.sections) if (!best.sections.includes(sct)) best.sections.push(sct);
      merged.add(it);
    }
  }
  if (merged.size) out.splice(0, out.length, ...out.filter((i) => !merged.has(i)));
  for (const it of out) it.sections.sort((a, b) => sectionRank(a) - sectionRank(b));
  return out.sort((a, b) => (Number.isFinite(b.time) ? b.time : -Infinity) - (Number.isFinite(a.time) ? a.time : -Infinity)
    || a.title.localeCompare(b.title));
}

export function sectionRank(s) { const i = SECTION_ORDER.indexOf(s); return i < 0 ? 99 : i; }

export function filterItems(items, { paper = "All", section = "All" } = {}) {
  return items.filter((it) => (paper === "All" || it.paper === paper) && (section === "All" || it.sections.includes(section)));
}

export function sectionsFor(items, paper = "All") {
  const s = new Set();
  for (const it of items) if (paper === "All" || it.paper === paper) it.sections.forEach((x) => s.add(x));
  return [...s].sort((a, b) => sectionRank(a) - sectionRank(b) || a.localeCompare(b));
}

// Section label for a card: the most specific section (skip "Top Stories" when there is another).
export function sectionLabel(it) {
  const s = it.sections.filter((x) => x !== "Top Stories" && x !== "ProQuest");
  return (s.length ? s : it.sections.filter((x) => x !== "ProQuest")).slice(0, 2).join(" \u00b7 ");
}

export function relTime(time, now = Date.now()) {
  if (!Number.isFinite(time)) return "";
  const s = Math.round((now - time) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " min ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " hr ago";
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : d + " days ago";
}

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });

// Clock time in Eastern Time, with the date when it isn't today (ET).
export function etTime(time, now = Date.now()) {
  if (!Number.isFinite(time)) return "";
  const same = dayFmt.format(time) === dayFmt.format(now);
  return (same ? "" : dateFmt.format(time) + ", ") + timeFmt.format(time) + " ET";
}

// --- Library (ProQuest) links -------------------------------------------------
// Arlington's library offers NYT and WSJ through ProQuest behind its EZproxy sign-in.
// John signs in himself; nothing here stores or sends credentials.
export const LIBRARY_PROXY = "https://library.access.arlingtonva.us/login";
export const PROQUEST_ACCOUNT = "57895";
export const PROQUEST_PUBS = { NYT: "nytimes", WSJ: "wallstreetjournal" };

// ProQuest search query for a headline: the exact headline as a quoted phrase.
// Double quotes inside the headline would break the phrase, so they are dropped.
export function proquestQuery(title) {
  const t = String(title || "").replace(/["\u201c\u201d\u201e\u201f]/g, " ").replace(/\s+/g, " ").trim();
  return t ? '"' + t + '"' : "";
}

// ProQuest target inside the publication, e.g.
//   https://www.proquest.com/nytimes/?accountid=57895&q=%22Headline%22
export function proquestTarget(paper, title) {
  const pub = PROQUEST_PUBS[paper];
  if (!pub) return "";
  const q = proquestQuery(title);
  return `https://www.proquest.com/${pub}/?accountid=${PROQUEST_ACCOUNT}` + (q ? "&q=" + encodeURIComponent(q) : "");
}

// Wrapped in the library's EZproxy sign-in. qurl= takes the target URL-encoded once more
// (EZproxy decodes it exactly once), so the target's own %-escapes survive intact.
export function libraryLink(paper, title) {
  const target = proquestTarget(paper, title);
  return target ? LIBRARY_PROXY + "?qurl=" + encodeURIComponent(target) : "";
}

export function publisherLabel(paper) { return paper === "WSJ" ? "wsj.com" : paper === "NYT" ? "nytimes.com" : "publisher"; }

// Date label for date-only items (ProQuest alerts): "today", "yesterday", or "Nov 16" (ET).
export function etDay(time, now = Date.now()) {
  if (!Number.isFinite(time)) return "";
  const d = dayFmt.format(time);
  if (d === dayFmt.format(now)) return "today";
  if (d === dayFmt.format(now - 86400000)) return "yesterday";
  return dateFmt.format(time);
}
