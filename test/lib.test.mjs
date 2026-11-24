// node test/lib.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { combineFeeds, filterItems, sectionsFor, SECTION_ORDER, dayLabel, etToday, clockET, feedLists, nextOlderMonth, monthLabel, parseQuery, queryMatches, filterByQuery, snippetAround, mergeSearchHits } from "../docs/lib.js";
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


// --- search: quoted phrases, multi-word AND, case-insensitive ---
eq(parseQuery("  Climate   BILL "), { phrases: [], words: ["climate", "bill"] });
eq(parseQuery('"climate bill" Senate'), { phrases: ["climate bill"], words: ["senate"] });
eq(parseQuery('""   "  " skip'), { phrases: [], words: ["skip"] });
eq(parseQuery(""), { phrases: [], words: [] });
ok(queryMatches("The Climate Bill Passes", parseQuery("climate bill")));
ok(queryMatches("The Climate Bill Passes", parseQuery('"climate bill"')));
ok(!queryMatches("Climate talks; a new bill", parseQuery('"climate bill"')), "phrase must be contiguous");
ok(queryMatches("CLIMATE talks; a new BILL", parseQuery("climate bill")), "AND, case-insensitive");
ok(!queryMatches("Climate talks only", parseQuery("climate bill")));
eq(filterByQuery(items, "").map((i) => i.title), items.map((i) => i.title), "empty query does not filter");
eq(filterByQuery(items, "w3").map((i) => i.title), ["W3"], "headline filter is case-insensitive");
eq(filterByQuery(items, "older w2").map((i) => i.title), ["W2 older"], "multi-word AND");
eq(filterByQuery(items, '"W2 older"').map((i) => i.title), ["W2 older"]);
eq(filterByQuery(items, '"W2 older" missing').map((i) => i.title), []);

{
  const body = "AAAA ".repeat(80) + "the alpha-widget moss grows here only" + " ZZZZ ".repeat(80);
  const sn = snippetAround(body, parseQuery("alpha-widget"), 200);
  ok(sn.toLowerCase().includes("alpha-widget"), "snippet centered on the match");
  ok([...sn].filter((c) => c !== "\u2026").length <= 200, "at most 200 characters of source text");
  ok(sn.length < body.length, "snippet is not the full text");
  eq(snippetAround(body, parseQuery("no-such-term"), 200), "");
}

{
  const LIB2 = (id) => L(id);
  const headlines = filterByQuery([
    { paper: "NYT", title: "Climate Bill Passes", date: "2026-11-18", link: L(30), doc: "30", rank: 0, i: 0 },
    { paper: "WSJ", title: "Markets Rally", date: "2026-11-18", link: L(40), doc: "40", rank: 1, i: 0 },
    { paper: "NYT", title: "Old climate note", date: "2026-10-01", link: L(10), doc: "10", rank: 0, i: 0 },
  ], "climate");
  eq(headlines.map((i) => i.doc), ["30", "10"]);
  const merged = mergeSearchHits(headlines, [
    { id: "30", paper: "NYT", date: "2026-11-18", title: "Climate Bill Passes", snippet: "the chamber passed the climate bill after" },
    { id: "40", paper: "WSJ", date: "2026-11-18", title: "Markets Rally", snippet: "traders cited the climate bill as a reason" },
    { id: "99", paper: "NYT", date: "2026-11-17", title: "Body only hit", link: L(99), snippet: "mentions climate in the article body" },
    { id: "40", paper: "WSJ", date: "2026-11-18", title: "Markets Rally", text: "THIS FULL TEXT MUST NOT BE COPIED" },
  ], "All", LIB2);
  eq(merged.map((i) => i.doc), ["40", "30", "99", "10"], "body-only hit merged in, sorted by date then id");
  eq(merged.find((i) => i.doc === "30").snippet, "the chamber passed the climate bill after");
  eq(merged.find((i) => i.doc === "40").title, "Markets Rally");
  ok(merged.find((i) => i.doc === "40").snippet.includes("traders cited"));
  ok(!merged.some((i) => i.text), "merge never copies a text field");
  eq(mergeSearchHits(headlines, [
    { id: "40", paper: "WSJ", date: "2026-11-18", title: "Markets Rally", snippet: "traders cited the climate bill as a reason" },
    { id: "99", paper: "NYT", date: "2026-11-17", title: "Body only hit", link: L(99), snippet: "mentions climate in the article body" },
  ], "NYT", LIB2).map((i) => i.doc), ["30", "99", "10"], "paper filter applies to merged hits");
}

// static page checks
const app = readFileSync(new URL("../docs/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(app), "DOM built with textContent only");
ok(/link\.rel = "noopener noreferrer"/.test(app), "article links use rel=noopener");
ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|clipboard/.test(app), "nothing stored or copied");
ok(!/nytimes\.com|wsj\.com/.test(app + html), "no publisher links on the page");
ok(/id="sections"/.test(html), "section chips under the paper chips");
ok(/class="tabs sections"/.test(html), "section row is a scrollable tabs strip");
ok(/data-section/.test(app) && /renderSectionTabs/.test(app), "section chips are rendered from stored sections");
ok(/h\.set\("section"/.test(app) && /h\.get\("section"\)/.test(app), "selected section is remembered in the URL hash");
ok(/el\("span", "section"/.test(app), "cards show the section next to paper and date");
for (const p of ["All", "NYT", "WSJ"]) ok(html.includes(`data-paper="${p}"`), "paper filter " + p);
for (const m of html.matchAll(/<a [^>]*>/g)) ok(/rel="noopener noreferrer"/.test(m[0]), "header link rel " + m[0]);
ok(/Library \(sign in with card &amp; PIN\)/.test(html), "library sign-in note kept");
ok(/id="older"/.test(html) && /\/feed\/\$\{encodeURIComponent\(res\.id\)\}\/\$\{month\}/.test(app), "Load older button fetches month shards");
ok(/connect-src https:\/\/news-feeds-relay\.johnlichtenberg\.workers\.dev;/.test(html), "CSP limits fetches to the relay");


ok(/id="q"/.test(html) && /type="search"/.test(html), "search box at the top of the page");
ok(/\/search\?q=/.test(app), "page calls /search for body-text matches");
ok(/el\("p", "snippet"/.test(app), "snippets are rendered with textContent");
ok(!/TEXT_TOKEN|Authorization:/.test(app + html), "page has no ingest token");
ok(/state\.notice/.test(app) && /j\.notice/.test(app), "page shows the Worker search notice");
ok(!/LIB_PIN|LIB_USER/.test(app + html), "page has no library secrets");
ok(/\/go\?id=/.test(app) && /articleHref/.test(app), "headline and search links go through /go");
ok(/referrerPolicy = "no-referrer"/.test(app), "article links send no referrer");
ok(!/localStorage|sessionStorage/.test(readFileSync(new URL("../docs/lib.js", import.meta.url), "utf8")), "lib stores nothing");


// --- sections ---
{
  eq(SECTION_ORDER[0], "World");
  eq(SECTION_ORDER.includes("Other"), true);
  const listed = combineFeeds([
    { paper: "NYT", items: [
      { title: "A", date: "2026-11-23", link: L(30), section: "Politics" },
      { title: "B", date: "2026-11-23", link: L(20), section: "Business" },
      { title: "C", date: "2026-11-22", link: L(10) },
    ]},
    { paper: "WSJ", items: [
      { title: "D", date: "2026-11-23", link: L(25), section: "Business" },
      { title: "E", date: "2026-11-23", link: L(15), section: "Markets" },
    ]},
  ]);
  eq(listed.map((i) => i.section || ""), ["Politics", "Business", "Business", "Markets", ""]);
  eq(filterItems(listed, "All", "Business").map((i) => i.doc), ["25", "20"]);
  eq(filterItems(listed, "NYT", "Business").map((i) => i.doc), ["20"]);
  eq(filterItems(listed, "NYT", "Politics").map((i) => i.doc), ["30"]);
  eq(filterItems(listed, "All", "World"), [], "empty section hidden by sectionsFor, and filters to none");
  eq(filterItems(listed, "WSJ", "All").map((i) => i.doc), ["25", "15"]);
  eq(filterItems(listed, "All", "Business").every((i) => i.section === "Business"), true);
  // items with no section only appear under All
  eq(filterItems(listed, "All", "All").map((i) => i.doc).includes("10"), true);
  eq(filterItems(listed, "All", "Politics").map((i) => i.doc).includes("10"), false);
  eq(sectionsFor(listed, "All"), ["Politics", "Business", "Markets"]);
  eq(sectionsFor(listed, "NYT"), ["Politics", "Business"]);
  eq(sectionsFor(listed, "WSJ"), ["Business", "Markets"]);
  eq(sectionsFor([], "All"), []);
  const merged = mergeSearchHits(filterItems(listed, "All", "Business"), [
    { id: "20", paper: "NYT", date: "2026-11-23", title: "A business story", snippet: "in the body" },
    { id: "99", paper: "NYT", date: "2026-11-21", title: "Remote only, no section", snippet: "mentions business" },
    { id: "88", paper: "WSJ", date: "2026-11-21", title: "Remote with section", section: "Business", snippet: "also business" },
  ], "All", L, "Business");
  eq(merged.map((i) => i.doc), ["25", "20", "88"], "full-text hits without a section stay off a section tab");
  ok(merged.find((i) => i.doc === "20").snippet.includes("in the body"));
}


console.log(`page tests: ${n} passed`);
