// node test/lib.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combineFeeds, filterItems, dayLabel, etToday, clockET, feedLists, nextOlderMonth, monthLabel } from "../docs/lib.js";
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
eq(items.map((i) => i.title), ["W3", "W1", "N3", "N1", "W2 older", "N2 undated"],
  "newest date first; within a date docview id descending, papers mixed; undated last");
eq(Object.keys(items[0]).sort(), ["date", "doc", "i", "link", "paper", "rank", "title"], "no ts on page items: cards show paper and date only");
eq(items[0].link, L(23));
eq(filterItems(items, "NYT").map((i) => i.title), ["N3", "N1", "N2 undated"]);
eq(filterItems(items, "WSJ").map((i) => i.title), ["W3", "W1", "W2 older"]);
// Numeric (not lexical) compare with real-size ids, papers interleaved, no-id items after ids in that day.
const mixed = combineFeeds([
  { paper: "NYT", items: [{ title: "a", date: "2026-11-17", link: L(3413923744) }, { title: "b", date: "2026-11-17", link: L(999999999) },
    { title: "noid", date: "2026-11-17", link: "https://example.com/x" }, { title: "c", date: "2026-11-18", link: L(1) }] },
  { paper: "WSJ", items: [{ title: "d", date: "2026-11-17", link: L(3414206003) }, { title: "e", date: "2026-11-17", link: L(3413923745) }] },
]);
eq(mixed.map((i) => i.title), ["c", "d", "e", "a", "b", "noid"], "numeric id desc within each day");
eq(filterItems(mixed, "WSJ").map((i) => i.title), ["d", "e"]);
// Older months appended by feedLists are sorted the same way.
const withOld = combineFeeds(feedLists([{ id: "n", paper: "NYT", items: [{ title: "x", date: "2026-11-02", link: L(500) }] }],
  new Map([["n", new Map([["2026-10", [{ title: "y", date: "2026-10-31", link: L(100) }, { title: "z", date: "2026-10-31", link: L(200) }]]])]])));
eq(withOld.map((i) => i.title), ["x", "z", "y"]);
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
{
  const c = combineFeeds([{ paper: "NYT", items: [{ title: "t", date: "2026-11-18", ts: "2026-11-19T00:21:56.000Z", link: L(9) },
    { title: "u", date: "2026-11-18", link: L(8) }, { title: "v", date: "2026-11-18", ts: "nope", link: L(7) }] }]);
  ok(c.every((i) => !("ts" in i)), "Worker ts (ProQuest batch time) is not passed to cards");
  eq(c.map((i) => i.date), ["2026-11-18", "2026-11-18", "2026-11-18"]);
}

// end to end: Worker parser output -> page list
const xml = (paper) => `<rss><channel><item><title>ProQuest:${paper} A; sub</title><pubDate>Nov 18, 2026</pubDate><link>https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/${paper === "NYT" ? 111 : 222}?accountid=57895</link></item></channel></rss>`;
const e2e = combineFeeds(FEEDS.map((f) => ({ id: f.id, paper: f.paper, ok: true, items: parseProquest(xml(f.paper), f) })));
eq(e2e.map((i) => [i.paper, i.title, i.date, i.link]), [["WSJ", "WSJ A", "2026-11-18", L(222)], ["NYT", "NYT A; sub", "2026-11-18", L(111)]], "docview 222 before 111");

// history months: recent first, "Load older" adds the next older month across both feeds
{
  const recent = [
    { id: "nyt-proquest", paper: "NYT", older: ["2026-09", "2026-08"], items: [{ paper: "NYT", title: "Nov", date: "2026-11-18", link: L(1) }] },
    { id: "wsj-proquest", paper: "WSJ", older: ["2026-09"], items: [{ paper: "WSJ", title: "WNov", date: "2026-11-18", link: L(2) }] },
  ];
  const extra = new Map();
  eq(nextOlderMonth(recent, extra), "2026-09");
  extra.set("nyt-proquest", new Map([["2026-09", [{ paper: "NYT", title: "Sep", date: "2026-09-30", link: L(3) }]]]));
  eq(nextOlderMonth(recent, extra), "2026-09", "WSJ still needs September");
  extra.set("wsj-proquest", new Map([["2026-09", [{ paper: "WSJ", title: "WSep", date: "2026-09-29", link: L(4) }]]]));
  eq(nextOlderMonth(recent, extra), "2026-08");
  extra.get("nyt-proquest").set("2026-08", [{ paper: "NYT", title: "Aug", date: "2026-08-01", link: L(5) }]);
  eq(nextOlderMonth(recent, extra), "", "nothing older left");
  eq(combineFeeds(feedLists(recent, extra)).map((i) => i.title), ["WNov", "Nov", "Sep", "WSep", "Aug"], "days newest first, ids descending within a day");
  eq(feedLists(recent, new Map())[0].items.length, 1);
  eq(nextOlderMonth([{ id: "x", older: ["../x", "2026-07"] }]), "2026-07", "only YYYY-MM months");
  eq(monthLabel("2026-09"), "September 2026");
}

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
ok(/id="older"/.test(html) && /\/feed\/\$\{encodeURIComponent\(res\.id\)\}\/\$\{month\}/.test(app), "Load older button fetches month shards");
ok(/connect-src https:\/\/news-feeds-relay\.johnlichtenberg\.workers\.dev;/.test(html), "CSP limits fetches to the relay");

console.log(`page tests: ${n} passed`);
