// Minimal RSS 2.0 parser. Keeps only what the feed itself provides per item:
// headline, the feed's short description, link, publish time. Output is plain text.
import { LINK_HOSTS, LIBRARY_LOGIN, PROQUEST_ACCOUNT } from "./feeds.js";

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018",
  rdquo: "\u201d", ldquo: "\u201c", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", eacute: "\u00e9" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// Plain text: unwrap CDATA, decode, strip any markup, decode again (double-encoded feeds), collapse spaces.
export function plainText(raw, max = 500) {
  if (!raw) return "";
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = decodeEntities(s);
  s = s.replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " ");
  s = decodeEntities(s).replace(/[<>]/g, "");
  s = s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, "") + "\u2026";
  return s;
}

function tag(block, name) {
  const re = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + "\\s*>", "i");
  const m = block.match(re);
  return m ? m[1] : "";
}

export function cleanLink(raw, paper) {
  const s = plainText(raw, 2000);
  let u;
  try { u = new URL(s); } catch { return ""; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "";
  const hosts = LINK_HOSTS[paper] || [];
  if (!hosts.includes(u.hostname.toLowerCase())) return "";
  u.protocol = "https:";
  u.hash = "";
  // Drop RSS tracking params; the article path is all that's needed.
  for (const k of [...u.searchParams.keys()]) if (/^(mod|smid|utm_|partner|emc)/i.test(k)) u.searchParams.delete(k);
  return u.toString();
}

export function parseRss(xml, feed, limit = 60) {
  const out = [];
  const items = String(xml || "").match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/gi) || [];
  for (const block of items) {
    if (out.length >= limit) break;
    const title = plainText(tag(block, "title"), 300);
    const link = cleanLink(tag(block, "link"), feed.paper);
    if (!title || !link) continue;
    const t = Date.parse(plainText(tag(block, "pubDate"), 100));
    out.push({
      paper: feed.paper,
      section: feed.section,
      title,
      description: plainText(tag(block, "description"), 500),
      link,
      published: Number.isFinite(t) ? new Date(t).toISOString() : null,
    });
  }
  return out;
}

// --- ProQuest RSS alerts -----------------------------------------------------
// Items carry the headline (prefixed "ProQuest:"), a date-only pubDate ("Nov 18, 2026"), and a link to the
// article's docview page behind the library proxy. The description holds only authors/publication and
// "Citation / Full text" format links, which are not used. Nothing beyond headline, date and link is kept.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function proquestDate(raw) {
  const m = plainText(raw, 60).match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  const mo = MONTHS[m[1].toLowerCase()], d = +m[2], y = +m[3];
  if (d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Exact article link in the library proxy form: login?url=https://www.proquest.com/docview/<id>?accountid=57895
export function proquestLink(raw) {
  const s = plainText(raw, 2000);
  let u;
  try { u = new URL(s); } catch { return ""; }
  let inner = s;
  if (u.hostname === "library.access.arlingtonva.us" && u.pathname === "/login") {
    inner = s.slice(s.indexOf("url=") + 4);
    if (s.indexOf("url=") < 0) return "";
    if (/^https?%3a/i.test(inner)) { try { inner = decodeURIComponent(inner); } catch { return ""; } }
  }
  const m = inner.match(/^https?:\/\/(?:www|search)\.proquest\.com\/(?:[a-z0-9]+\/)?docview\/(\d{3,15})(?:[/?#]|$)/i);
  if (!m) return "";
  return `${LIBRARY_LOGIN}https://www.proquest.com/docview/${m[1]}?accountid=${PROQUEST_ACCOUNT}`;
}

export function parseProquest(xml, feed, limit = 100) {
  const out = [];
  const items = String(xml || "").match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item\s*>/gi) || [];
  for (const block of items) {
    if (out.length >= limit) break;
    let title = plainText(tag(block, "title"), 600).replace(/^ProQuest:\s*/i, "");
    if (feed.subheadSep && title.includes(feed.subheadSep)) title = title.slice(0, title.indexOf(feed.subheadSep)).trim();
    if (title.length > 300) title = title.slice(0, 299).replace(/\s+\S*$/, "") + "\u2026";
    const link = proquestLink(tag(block, "link"));
    if (!title || !link) continue; // skips the "View ProQuest search results" item
    out.push({ paper: feed.paper, section: feed.section, title, description: "", link,
      published: null, date: proquestDate(tag(block, "pubDate")), source: "proquest" });
  }
  return out;
}
