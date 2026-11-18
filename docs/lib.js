// Pure helpers for the headlines page (no DOM). Shared by app.js and the node tests.

export const SECTION_ORDER = ["Top Stories", "World", "U.S.", "Politics", "Economy", "Business", "Markets",
  "Personal Finance", "Tech", "Science", "Health", "Climate", "Opinion", "Arts", "Lifestyle"];

const TZ = "America/New_York";

// Canonical key for duplicate detection: publisher host + path, no query/hash/trailing slash.
export function linkKey(link) {
  try {
    const u = new URL(link);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch { return String(link || "").toLowerCase(); }
}
const titleKey = (it) => it.paper + "|" + String(it.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Merge feed results into one newest-first list without duplicates.
// An article that appears in several section feeds keeps every section.
export function mergeItems(results) {
  const byLink = new Map(), byTitle = new Map(), out = [];
  for (const res of results || []) {
    if (!res || !Array.isArray(res.items)) continue;
    for (const raw of res.items) {
      if (!raw || !raw.title || !raw.link) continue;
      const lk = linkKey(raw.link), tk = titleKey(raw);
      const prev = byLink.get(lk) || byTitle.get(tk);
      const section = raw.section || res.section || "";
      if (prev) {
        if (section && !prev.sections.includes(section)) prev.sections.push(section);
        if (!prev.description && raw.description) prev.description = raw.description;
        const t = Date.parse(raw.published);
        if (Number.isFinite(t) && (!Number.isFinite(prev.time) || t > prev.time)) { prev.time = t; prev.published = raw.published; }
        byLink.set(lk, prev); byTitle.set(tk, prev);
        continue;
      }
      const t = Date.parse(raw.published);
      const it = { paper: raw.paper || res.paper, title: raw.title, description: raw.description || "", link: raw.link,
        published: raw.published || null, time: Number.isFinite(t) ? t : NaN, sections: section ? [section] : [] };
      byLink.set(lk, it); byTitle.set(tk, it); out.push(it);
    }
  }
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
  const s = it.sections.filter((x) => x !== "Top Stories");
  return (s.length ? s : it.sections).slice(0, 2).join(" \u00b7 ");
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
