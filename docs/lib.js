// Pure helpers for the News page (no DOM). Shared by app.js and the node tests.

const TZ = "America/New_York";
export const PAPERS = ["NYT", "WSJ"];

// Combine the feed results into one list: newest date first; within a date, NYT's feed order then
// WSJ's feed order (each feed's own order is kept). Undated items go last.
export function combineFeeds(results) {
  const out = [];
  for (const res of results || []) {
    if (!res || !Array.isArray(res.items)) continue;
    const rank = PAPERS.indexOf(res.paper) < 0 ? 99 : PAPERS.indexOf(res.paper);
    res.items.forEach((raw, i) => {
      if (!raw || !raw.title || !raw.link) return;
      out.push({ paper: raw.paper || res.paper, title: raw.title, link: raw.link,
        date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || "") ? raw.date : "", rank, i });
    });
  }
  return out.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.rank - b.rank || a.i - b.i);
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
