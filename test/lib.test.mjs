// node test/lib.test.mjs
import assert from "node:assert/strict";
import { mergeItems, filterItems, sectionsFor, sectionLabel, relTime, etTime, linkKey } from "../docs/lib.js";
import { parseRss } from "../worker/parse.js";

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const res = [
  { id: "nyt-top", paper: "NYT", section: "Top Stories", ok: true, items: [
    { paper: "NYT", section: "Top Stories", title: "A", description: "", link: "https://www.nytimes.com/2026/11/17/us/politics/a.html", published: "2026-11-18T06:00:00.000Z" },
    { paper: "NYT", section: "Top Stories", title: "No date", description: "d", link: "https://www.nytimes.com/nd.html", published: null } ] },
  { id: "nyt-politics", paper: "NYT", section: "Politics", ok: true, items: [
    { paper: "NYT", section: "Politics", title: "A", description: "Desc A", link: "https://www.nytimes.com/2026/11/17/us/politics/a.html?smid=x", published: "2026-11-18T06:05:00.000Z" } ] },
  { id: "wsj-markets", paper: "WSJ", section: "Markets", ok: true, items: [
    { paper: "WSJ", section: "Markets", title: "B", description: "Desc B", link: "https://www.wsj.com/b-1", published: "2026-11-18T05:00:00.000Z" },
    { paper: "WSJ", section: "Markets", title: "C newest", description: "", link: "https://www.wsj.com/c", published: "2026-11-18T06:30:00.000Z" } ] },
  { id: "wsj-business", paper: "WSJ", section: "Business", ok: true, items: [
    { paper: "WSJ", section: "Business", title: "B", description: "", link: "https://wsj.com/b-1/", published: "2026-11-18T05:00:00.000Z" },
    { paper: "WSJ", section: "Business", title: "b!", description: "", link: "https://www.wsj.com/other-url-same-title", published: "2026-11-18T04:00:00.000Z" } ] },
  { id: "bad", ok: false, items: [] }, null,
];
const items = mergeItems(res);
eq(items.map((i) => i.title), ["C newest", "A", "B", "No date"], "newest first, dupes removed, undated last");
eq(items[1].sections, ["Top Stories", "Politics"]);
eq(items[1].description, "Desc A", "fills description from the duplicate");
eq(items[1].published, "2026-11-18T06:05:00.000Z", "keeps latest time");
eq(items[2].sections, ["Business", "Markets"], "WSJ dup by link (www/trailing slash) and by title");
eq(linkKey("https://www.wsj.com/b-1/?mod=x#y"), "wsj.com/b-1");
eq(sectionLabel(items[1]), "Politics");
eq(sectionLabel(items[3]), "Top Stories");
eq(filterItems(items, { paper: "WSJ" }).length, 2);
eq(filterItems(items, { paper: "NYT", section: "Politics" }).map((i) => i.title), ["A"]);
eq(filterItems(items, { section: "Markets" }).map((i) => i.title), ["C newest", "B"]);
eq(filterItems(items, {}).length, 4);
eq(sectionsFor(items), ["Top Stories", "Politics", "Business", "Markets"]);
eq(sectionsFor(items, "WSJ"), ["Business", "Markets"]);
eq(mergeItems([]), []);

const now = Date.parse("2026-11-18T06:35:00Z");
eq(relTime(now - 20e3, now), "just now");
eq(relTime(now - 5 * 60e3, now), "5 min ago");
eq(relTime(now - 3 * 3600e3, now), "3 hr ago");
eq(relTime(now - 30 * 3600e3, now), "yesterday");
eq(relTime(now - 80 * 3600e3, now), "3 days ago");
eq(relTime(NaN, now), "");
// 06:21 UTC Nov 18 = 1:21 AM ET Nov 18 (EST, UTC-5)
eq(etTime(Date.parse("2026-11-18T06:21:20Z"), now), "1:21 AM ET");
eq(etTime(Date.parse("2026-11-18T03:00:00Z"), now), "Nov 17, 10:00 PM ET", "previous ET day");
eq(etTime(Date.parse("2026-07-04T16:00:00Z"), now), "Jul 4, 12:00 PM ET", "EDT in summer");

// end to end: worker parser output feeds the page helpers
const xml = `<rss><channel><item><title>X &amp; Y</title><link>https://www.nytimes.com/x.html</link>
<description>&lt;b&gt;Hi&lt;/b&gt;</description><pubDate>Wed, 18 Nov 2026 06:00:00 +0000</pubDate></item></channel></rss>`;
const merged = mergeItems([{ items: parseRss(xml, { paper: "NYT", section: "World" }) }]);
eq(merged[0].title, "X & Y"); eq(merged[0].description, "Hi"); eq(merged[0].sections, ["World"]);

// page safety checks on the static files
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../docs/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(app), "DOM built with textContent only");
ok(/rel = "noopener noreferrer"/.test(app), "story links use rel=noopener");
for (const m of html.matchAll(/<a [^>]*>/g)) ok(/rel="noopener noreferrer"/.test(m[0]), "header link rel " + m[0]);
ok(/connect-src https:\/\/news-feeds-relay\.johnlichtenberg\.workers\.dev;/.test(html), "CSP limits fetches to the relay");

console.log(`page tests: ${n} passed`);
