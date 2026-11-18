// node test/lib.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combineFeeds, filterItems, dayLabel, etToday, clockET } from "../docs/lib.js";
import { parseProquest } from "../worker/parse.js";
import { FEEDS } from "../worker/feeds.js";

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };
const L = (id) => `https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/${id}?accountid=57895`;

const res = [
  { id: "wsj-proquest", paper: "WSJ", ok: true, items: [
    { paper: "WSJ", title: "W1", date: "2026-11-18", link: L(21) },
    { paper: "WSJ", title: "W2 older", date: "2026-11-17", link: L(22) },
    { paper: "WSJ", title: "W3", date: "2026-11-18", link: L(23) } ] },
  { id: "nyt-proquest", paper: "NYT", ok: true, items: [
    { paper: "NYT", title: "N1", date: "2026-11-18", link: L(11) },
    { paper: "NYT", title: "N2 undated", date: null, link: L(12) },
    { paper: "NYT", title: "N3", date: "2026-11-18", link: L(13) },
    { paper: "NYT", title: "", date: "2026-11-18", link: L(14) },
    { paper: "NYT", title: "no link", date: "2026-11-18" } ] },
  { id: "x", ok: false, items: [] }, null,
];
const items = combineFeeds(res);
eq(items.map((i) => i.title), ["N1", "N3", "W1", "W3", "W2 older", "N2 undated"],
  "newest date first; within a date NYT then WSJ, each in its feed's order; undated last");
eq(Object.keys(items[0]).sort(), ["date", "i", "link", "paper", "rank", "title"]);
eq(items[0].link, L(11));
eq(filterItems(items, "NYT").map((i) => i.title), ["N1", "N3", "N2 undated"]);
eq(filterItems(items, "WSJ").map((i) => i.title), ["W1", "W3", "W2 older"]);
eq(filterItems(items, "All").length, 6);
eq(combineFeeds([]), []);

const now = Date.parse("2026-11-18T07:28:00Z"); // 2:28 AM ET
eq(etToday(now), "2026-11-18");
eq(etToday(Date.parse("2026-11-18T03:00:00Z")), "2026-11-17", "ET day, not UTC day");
eq(dayLabel("2026-11-18", now), "Today");
eq(dayLabel("2026-11-17", now), "Yesterday");
eq(dayLabel("2026-11-14", now), "Sat, Nov 14");
eq(dayLabel("2025-12-31", now), "Wed, Dec 31, 2025");
eq(dayLabel("", now), "Undated");
eq(clockET(Date.parse("2026-11-18T07:28:00Z")), "2:28 AM ET");

// end to end: Worker parser output -> page list
const xml = (paper) => `<rss><channel><item><title>ProQuest:${paper} A; sub</title><pubDate>Nov 18, 2026</pubDate><link>https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/${paper === "NYT" ? 111 : 222}?accountid=57895</link></item></channel></rss>`;
const e2e = combineFeeds(FEEDS.map((f) => ({ id: f.id, paper: f.paper, ok: true, items: parseProquest(xml(f.paper), f) })));
eq(e2e.map((i) => [i.paper, i.title, i.date, i.link]), [["NYT", "NYT A; sub", "2026-11-18", L(111)], ["WSJ", "WSJ A", "2026-11-18", L(222)]]);

// static page checks
const app = readFileSync(new URL("../docs/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(app), "DOM built with textContent only");
ok(/link\.rel = "noopener noreferrer"/.test(app), "article links use rel=noopener");
ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|clipboard/.test(app), "nothing stored or copied");
ok(!/nytimes\.com|wsj\.com|section/i.test(app), "no publisher links or sections left");
ok(!/id="sections"/.test(html), "section chips removed");
for (const p of ["All", "NYT", "WSJ"]) ok(html.includes(`data-paper="${p}"`), "paper filter " + p);
for (const m of html.matchAll(/<a [^>]*>/g)) ok(/rel="noopener noreferrer"/.test(m[0]), "header link rel " + m[0]);
ok(/Library \(sign in with card &amp; PIN\)/.test(html), "library sign-in note kept");
ok(/connect-src https:\/\/news-feeds-relay\.johnlichtenberg\.workers\.dev;/.test(html), "CSP limits fetches to the relay");

console.log(`page tests: ${n} passed`);
