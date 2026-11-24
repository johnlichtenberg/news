// node worker/worker.test.mjs   (no network: global fetch is mocked)
import assert from "node:assert/strict";
import { FEEDS } from "./feeds.js";
import { parseProquest, proquestLink, proquestDate, proquestTs, plainText, decodeEntities } from "./parse.js";
import { isSpanishTitle, isSpanishSource } from "./lang.js";
import { keepItem } from "./parse.js";
import { mergeShard, purgeShard, storeBatch, readShard, readIndex, docviewId, changed, monthOf, prevMonth, isMonth } from "./history.js";
import { normalizeId, normalizeText, TEXT_KEY, timingSafeEqual, rateLimited, SEARCH_LIMIT } from "./search.js";
import { parseResults, parseSearchForm, buildSearchBody, parseCiteDate, classifyPaper, cleanTitle, snippetFrom, mergeLiveHits, looksLikeChallenge, looksLikeLogin, cookieHeader, collectCookies, cacheKey, isAllowedConnect, originAllowed, docviewUrl, libraryLink as libLink, ezproxyConnectTicket } from "./proquest.js";
import { sectionFromUrl, tabFor, titleVariants, prefixSection, bylineSection, parseUrlset, parseRssEntries, matchHeadline, buildIndex, applyCatalog, migrateSection, indexFromEntries, catalogMonthUrl, NEWS_SITEMAPS, _catalog, assignSection } from "./sections.js";

const ORIGIN = "https://johnlichtenberg.github.io";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const LIB = (id) => `https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/${id}?accountid=57895`;

const NYT_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>ProQuest: New York Times (Online)</title>
<item><title>ProQuest:Today<![CDATA[&]]>#39;s Headlines: Senate</title><description> Smith, A New York Times (Online) 18 Nov 2026<![CDATA[<br/>]]>Formats: <![CDATA[<a href="https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/3414243596/fulltext?accountid=57895">]]><![CDATA[<b>]]>Full text<![CDATA[</b>]]><![CDATA[</a>]]></description><pubDate>Nov 18, 2026</pubDate><link>https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/3414243596?accountid=57895</link></item>
<item><title>ProQuest:Second; not split for NYT</title><pubDate>Nov 17, 2026</pubDate><link>https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/3414243500?accountid=57895</link></item>
<item><title>ProQuest:Duplicate</title><pubDate>Nov 17, 2026</pubDate><link>https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/3414243500?accountid=57895</link></item>
<item><title>ProQuest:Evil</title><pubDate>Nov 18, 2026</pubDate><link>https://evil.example/login?url=https://www.proquest.com/docview/1?accountid=57895</link></item>
<item><title>ProQuest:Not docview</title><link>https://library.access.arlingtonva.us/login?url=https://evil.example/docview/123</link></item>
<item><title>View ProQuest search results</title><description>Follow the link</description><link>https://library.access.arlingtonva.us/login?url=https://www.proquest.com/rss/RSSBacktoResult/pub/2310267</link></item>
</channel></rss>`;
const WSJ_XML = `<rss><channel><item><title>ProQuest:Nvidia Reports Faster Growth, Says Jensen Huang Won't Return as CEO; Interim chief says demand is strong</title><pubDate>Nov 18, 2026</pubDate><link>https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/3414244035?accountid=57895</link></item>
<item><title>ProQuest:Corrections <![CDATA[&]]> Amplifications</title><pubDate>Nov 18, 2026</pubDate><link>https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/3414224037?accountid=57895</link></item></channel></rss>`;

// --- parser ---
const nyt = parseProquest(NYT_XML, FEEDS[0]);
eq(nyt, [
  { paper: "NYT", title: "Today's Headlines: Senate", date: "2026-11-18", link: LIB(3414243596) },
  { paper: "NYT", title: "Second; not split for NYT", date: "2026-11-17", link: LIB(3414243500) },
], "headline, date, exact library link only; feed order; dupes, bad links and the results item dropped");
ok(!/Full text|Smith|fulltext|description/.test(JSON.stringify(nyt)), "no description, authors or full-text links kept");
const wsj = parseProquest(WSJ_XML, FEEDS[1]);
eq(wsj.map((i) => i.title), ["Nvidia Reports Faster Growth, Says Jensen Huang Won't Return as CEO", "Corrections & Amplifications"], "WSJ subhead dropped");
ok(!JSON.stringify(wsj).includes("Interim chief"), "subhead not kept");
eq(wsj[0].paper, "WSJ");
eq(parseProquest("<rss>", FEEDS[0]), []);
eq(parseProquest(`<item><title>ProQuest:${"word ".repeat(100)}</title><link>https://www.proquest.com/docview/12345</link></item>`, FEEDS[0])[0].title.length <= 300, true, "long titles truncated");

eq(proquestLink("https://www.proquest.com/docview/4242"), LIB(4242), "bare docview wrapped");
eq(proquestLink("https://library.access.arlingtonva.us/login?url=https%3A%2F%2Fwww.proquest.com%2Fnytimes%2Fdocview%2F7777%3Faccountid%3D1"), LIB(7777), "encoded url= and other accountid normalized");
eq(proquestLink("javascript:alert(1)"), "");
eq(proquestLink("https://www.proquest.com/docview/abc"), "");
eq(proquestLink("https://library.access.arlingtonva.us/login"), "");
eq(proquestDate("Nov 18, 2026"), "2026-11-18"); eq(proquestDate("Sept 3, 2026"), "2026-09-03"); eq(proquestDate("garbage"), null);
eq(proquestDate("Thu, 19 Nov 2026 00:21:56 GMT"), "2026-11-18", "RFC 822 timestamp -> ET day");
eq(proquestDate("Thu, 19 Nov 2026 05:30:00 GMT"), "2026-11-19");
eq(proquestTs("Thu, 19 Nov 2026 00:21:56 GMT"), "2026-11-19T00:21:56.000Z"); eq(proquestTs("Nov 18, 2026"), null, "no time -> no ts");
eq(proquestTs("garbage"), null);
{
  const x = `<rss><channel><item><title>Timed</title><pubDate>Thu, 19 Nov 2026 00:21:56 GMT</pubDate><link>https://www.proquest.com/docview/5001</link></item>` +
    `<item><title>Dated</title><pubDate>Nov 18, 2026</pubDate><link>https://www.proquest.com/docview/5002</link></item></channel></rss>`;
  const p = parseProquest(x, FEEDS[1]);
  eq(p.map((i) => [i.date, i.ts]), [["2026-11-18", "2026-11-19T00:21:56.000Z"], ["2026-11-18", undefined]], "ts only when pubDate has a time");
}
eq(decodeEntities("&amp;lt;&#39;&bogus;"), "&lt;'&bogus;");
eq(plainText("<b>a</b> &amp; b"), "a & b");

// --- NYT en Español detection (headline heuristic; the feed has no language/source field) ---
for (const t of ["Corea del Sur revisará los contratos de la industria del ‘k-pop’ con menores de edad",
  "¿Qué significa la victoria de Peltola?", "El gobierno de Milei enfrenta una nueva crisis",
  "Las elecciones en Chile: lo que hay que saber", "Trump y Xi se reúnen en Shenzhen",
  "Dos jóvenes activistas reflejan la polarización de Francia", "De empresario fallido a presunto conspirador en el magnicidio de Haití",
  "Adiós a los 1,5 grados", "Una pesadilla invernal se avecina en Ucrania mientras Rusia ataca implacablemente",
  "La hija de Jensen Huang sigue teniendo un alto cargo en Nvidia"]) ok(isSpanishTitle(t), "es: " + t);
for (const t of ["Los Angeles Fire Kills 3 in La Cañada Flintridge", "From the Front Page: Spain Moves Toward Democracy on Nov. 18, 1976",
  "El Paso Shooting Trial Opens", "La Niña Is Back. Here Is What That Means for Winter", "Here’s the latest.",
  "A Day at the Del Mar Racetrack With the Que Sera Crowd", "Bad Bunny Says ‘Gracias’ at the Grammys",
  "Taco Bell vs. El Pollo Loco: The Battle for Los Angeles", "Mexico’s Sheinbaum Says No to U.S. Troops",
  "Japan Attempts to Revive an American Industrial Icon", "Del Toro Wins Oscar for Frankenstein", "José Andrés Feeds Gaza",
  "Peña Nieto Arrested", "Despacito Tops Charts Again", "U.S. Watch", "Corrections", ""]) ok(!isSpanishTitle(t), "en: " + t);
ok(isSpanishSource("New York Times en Espanol")); ok(isSpanishSource("The New York Times en ESPAÑOL; New York"));
ok(!isSpanishSource("New York Times (Online)")); ok(!isSpanishSource(""));
{
  const SP = `<rss><channel><item><title>ProQuest:Corea del Sur revisará los contratos de la industria del ‘k-pop’ con menores de edad</title><pubDate>Nov 18, 2026</pubDate><link>https://www.proquest.com/docview/3414243599</link></item>
<item><title>ProQuest:Japan Attempts to Revive an American Industrial Icon</title><pubDate>Nov 18, 2026</pubDate><link>https://www.proquest.com/docview/3414243602</link></item></channel></rss>`;
  eq(parseProquest(SP, FEEDS[0]).map((i) => i.title), ["Japan Attempts to Revive an American Industrial Icon"], "Español item dropped from live NYT feed");
  eq(parseProquest(SP, FEEDS[1]).length, 2, "WSJ feed is not filtered");
  ok(!keepItem(FEEDS[0])({ title: "El gobierno de Milei enfrenta una nueva crisis" })); ok(keepItem(FEEDS[1])({ title: "El gobierno de Milei enfrenta una nueva crisis" }));
}

// --- whitelist: exactly the two ProQuest feeds ---
eq(FEEDS.map((f) => !!f.excludeSpanish), [true, false]);
eq(FEEDS.map((f) => [f.id, f.paper, f.url]), [
  ["nyt-proquest", "NYT", "https://feeds.proquest.com/rss/2310267"],
  ["wsj-proquest", "WSJ", "https://feeds.proquest.com/rss/2310287"],
]);

// --- history (monthly shards, kept forever) ---
const L2 = (id) => LIB(id);
const T = Date.parse("2026-11-18T07:30:00Z"); // 2:30 AM ET Nov 18
const it = (id, date, title = "T" + id) => ({ paper: "NYT", title, date, link: LIB(id) });
{
  eq(docviewId(LIB(123456)), "123456"); eq(docviewId("x"), "");
  eq(monthOf(T), "2026-11"); eq(monthOf(Date.parse("2026-12-01T03:00:00Z")), "2026-11", "ET month, not UTC");
  eq(prevMonth("2026-11"), "2026-10"); eq(prevMonth("2026-01"), "2025-12");
  ok(isMonth("2026-11")); ok(!isMonth("2026-13")); ok(!isMonth("../x"));
  const h1 = mergeShard([], [it(111, "2026-11-18"), it(112, "2026-11-18")], [], T);
  eq(h1.map((i) => [i.id, i.seen]), [["111", T], ["112", T]]);
  const h2 = mergeShard(h1, [it(113, "2026-11-18"), it(111, "2026-11-18", "T111 fixed")], [], T + 3600e3);
  eq(h2.map((i) => i.id), ["113", "111", "112"], "live batch first, older kept");
  eq(h2[1].title, "T111 fixed"); eq(h2[1].seen, T, "first-seen kept");
  ok(changed(h1, h2)); ok(!changed(h2, mergeShard(h2, [it(113, "2026-11-18"), it(111, "2026-11-18", "T111 fixed")], [], T)), "same batch -> no write");
  eq(mergeShard([], [it(1, "2025-01-01")], [], T).length, 1, "old dates are never dropped");
  // ts: filled from the live feed when it has one, kept once stored, never invented
  const ts = "2026-11-19T00:21:56.000Z";
  const t1 = mergeShard(h2, [{ ...it(112, "2026-11-18"), ts }], [], T);
  eq(t1.find((i) => i.id === "112").ts, ts, "ts filled for an already stored item still in the feed");
  ok(!("ts" in t1.find((i) => i.id === "113")), "no ts invented for items without one");
  ok(changed(h2, t1), "filling ts triggers a write");
  eq(mergeShard(t1, [it(112, "2026-11-18")], [], T).find((i) => i.id === "112").ts, ts, "stored ts kept");
  eq(mergeShard([], [it(5, "2026-10-31"), it(6, "2026-11-01")], [{ id: "5" }], T).map((i) => i.id), ["6"], "items already in last month's shard are not duplicated");
  eq(mergeShard([], [{ paper: "NYT", title: "x", date: "2026-11-18", link: "bad" }], [], T), [], "items without docview id ignored");
  eq(mergeShard([], [it(5, "2026-11-18"), it(5, "2026-11-18")], [], T).length, 1, "dedupe by docview id");
}
{ // storeBatch against a mock KV: only the current month's shard (+ index once per month) is written
  const store = new Map(); const puts = [];
  const kv = { async get(k, t) { const v = store.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
    async put(k, v) { puts.push(k); store.set(k, v); } };
  let r1 = await storeBatch(kv, "nyt-proquest", [it(1, "2026-10-31"), it(2, "2026-10-31")], Date.parse("2026-10-31T20:00:00Z"));
  eq(puts, ["hist:nyt-proquest:2026-10", "idx:nyt-proquest"]); eq(r1.months, ["2026-10"]);
  await storeBatch(kv, "nyt-proquest", [it(1, "2026-10-31"), it(2, "2026-10-31")], Date.parse("2026-10-31T21:00:00Z"));
  eq(puts.length, 2, "unchanged -> no writes");
  // new month: batch still lists item 2 (already in October) plus new item 3
  const nov = Date.parse("2026-11-01T14:00:00Z");
  r1 = await storeBatch(kv, "nyt-proquest", [it(3, "2026-11-01"), it(2, "2026-10-31")], nov);
  eq(puts.slice(2), ["hist:nyt-proquest:2026-11", "idx:nyt-proquest"], "writes only November's shard + index (new month)");
  eq((await readShard(kv, "nyt-proquest", "2026-11")).map((i) => i.id), ["3"], "October item not duplicated");
  eq((await readShard(kv, "nyt-proquest", "2026-10")).map((i) => i.id), ["1", "2"], "October shard untouched");
  eq(await readIndex(kv, "nyt-proquest"), ["2026-11", "2026-10"], "index newest first");
  eq(r1.current.map((i) => i.id), ["3"]); eq(r1.previous.map((i) => i.id), ["1", "2"]);
  await storeBatch(kv, "nyt-proquest", [it(4, "2026-11-02"), it(3, "2026-11-01")], nov + 86400e3);
  eq(puts.slice(4), ["hist:nyt-proquest:2026-11"], "same month -> shard only, no index write");
  await storeBatch(kv, "nyt-proquest", null, nov + 2 * 86400e3);
  eq(puts.length, 5, "failed fetch -> no writes");
  // an Español item already stored: removed from the current shard on the next refresh, even if the fetch fails
  const keep = keepItem(FEEDS[0]);
  const shardNow = JSON.parse(store.get("hist:nyt-proquest:2026-11"));
  shardNow.items.push({ paper: "NYT", title: "Corea del Sur revisará los contratos de la industria del k-pop", date: "2026-11-02", link: L2(9), id: "9", seen: 1 });
  store.set("hist:nyt-proquest:2026-11", JSON.stringify(shardNow));
  const rr = await storeBatch(kv, "nyt-proquest", null, nov + 3 * 86400e3, keep);
  eq(rr.current.map((i) => i.id), ["4", "3"], "stored Español item removed"); eq(puts.length, 6, "one write for the purge");
  eq((await readShard(kv, "nyt-proquest", "2026-11")).map((i) => i.id), ["4", "3"]);
  await storeBatch(kv, "nyt-proquest", [{ paper: "NYT", title: "Las elecciones en Chile: lo que hay que saber", date: "2026-11-05", link: L2(10) }], nov + 4 * 86400e3, keep);
  eq(puts.length, 6, "live Español item never stored");
  // older months: purgeShard
  const oct = JSON.parse(store.get("hist:nyt-proquest:2026-10"));
  oct.items.push({ paper: "NYT", title: "¿Qué significa la victoria de Peltola?", date: "2026-10-30", link: L2(11), id: "11", seen: 1 });
  store.set("hist:nyt-proquest:2026-10", JSON.stringify(oct));
  eq(await purgeShard(kv, "nyt-proquest", "2026-10", keep), 1);
  eq(await purgeShard(kv, "nyt-proquest", "2026-10", keep), 0, "second purge removes nothing and doesn't write");
  eq(puts.length, 7);
}

// --- worker ---
let calls = [];
const pqCallsOf = (arr = calls) => arr.filter((u) => /feeds\.proquest\.com/.test(u));
const publicSectionUrl = (u) => /feeds\.proquest\.com|nytimes\.com\/sitemaps\/|rss\.nytimes\.com\/|wsj\.com\/(sitemaps|wsjsitemaps)\/|feeds\.content\.dowjones\.io\/public\/rss\//.test(u);
let upstream = (url) => new Response(url.endsWith("2310287") ? WSJ_XML : NYT_XML, { status: 200 });
globalThis.fetch = async (url, init) => { calls.push(String(url)); return upstream(String(url), init); };
const { default: worker, _test } = await import("./worker.js");
// in-memory KV mock
const kvStore = new Map(); let kvPuts = 0;
const KV = { async get(k, type) { const v = kvStore.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
  async put(k, v) { kvPuts++; kvStore.set(k, v); } };
const TOKEN = "test-ingest-token-not-for-production";
const env = { ALLOWED_ORIGIN: ORIGIN, NEWS_HISTORY: KV, TEXT_TOKEN: TOKEN };
const req = (path, { origin = ORIGIN, method = "GET", headers = {}, body } = {}) => {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  return new Request("https://news-feeds-relay.example.workers.dev" + path, { method, headers: h, body });
};

let r = await worker.fetch(req("/feeds"), env);
eq(r.status, 200); eq(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
let j = await r.json();
eq(j.feeds, [{ id: "nyt-proquest", paper: "NYT" }, { id: "wsj-proquest", paper: "WSJ" }]);
eq(calls.length, 0, "/feeds does no upstream fetch");

r = await worker.fetch(req("/feed/nyt-proquest"), env); j = await r.json();
eq(r.status, 200); eq(j.ok, true); eq(j.paper, "NYT"); eq(j.items.length, 2); eq(j.latest, 2);
eq(Object.keys(j.items[0]).sort(), ["date", "link", "paper", "title"], "public items: paper, headline, date, link only");
const M = monthOf(Date.now());
eq(kvPuts, 2, "first fetch stores this month's shard + index"); ok(kvStore.has(`hist:nyt-proquest:${M}`));
eq(JSON.parse(kvStore.get(`hist:nyt-proquest:${M}`)).items.map((i) => i.id), ["3414243596", "3414243500"]);
eq(j.months, [M]); eq(j.loaded, [M, prevMonth(M)]); eq(j.older, []);
eq(pqCallsOf(calls), ["https://feeds.proquest.com/rss/2310267"]);
ok(calls.every(publicSectionUrl), "feed refresh only fetches ProQuest, public sitemaps, and official section RSS");
ok(/max-age=300/.test(r.headers.get("Cache-Control")), "5-minute cache header");
await worker.fetch(req("/feed/nyt-proquest"), env);
eq(pqCallsOf(calls).length, 1, "second request served from 5-minute cache");
eq(kvPuts, 2, "no write from cache hit");
r = await worker.fetch(req("/feed/wsj-proquest"), env); j = await r.json();
eq(j.paper, "WSJ"); eq(j.items[0].title, "Nvidia Reports Faster Growth, Says Jensen Huang Won't Return as CEO");
eq(pqCallsOf(calls).at(-1), "https://feeds.proquest.com/rss/2310287");

for (const p of ["/feed/nyt-top", "/feed/wsj-world", "/feed/evil", "/feed/https%3A%2F%2Fevil.example", "/feed?url=https://evil.example", "/"]) {
  r = await worker.fetch(req(p), env); eq(r.status, 404, p);
}
eq(pqCallsOf(calls).length, 2, "only the two ProQuest feeds are fetched (section sitemaps may also be loaded)");
ok(calls.every(publicSectionUrl), "no fetches outside ProQuest, public sitemaps, and official section RSS");

r = await worker.fetch(req("/feeds", { origin: "https://evil.example" }), env); eq(r.status, 403);
eq(r.headers.get("Access-Control-Allow-Origin"), ORIGIN, "never echoes other origins");
r = await worker.fetch(req("/feeds", { origin: null }), env); eq(r.status, 403);
r = await worker.fetch(req("/feeds", { method: "POST" }), env); eq(r.status, 405);
r = await worker.fetch(req("/feeds", { method: "OPTIONS" }), env); eq(r.status, 204);
r = await worker.fetch(req("/feeds", { method: "OPTIONS", origin: "https://evil.example" }), env); eq(r.status, 403);

// cron: refreshes both feeds (bypassing the 5-minute memo); unchanged feeds are not rewritten
const putsBefore = kvPuts, callsBefore = calls.length;
await worker.scheduled({}, env, { waitUntil() {} });
eq(pqCallsOf(calls).length - pqCallsOf(calls.slice(0, callsBefore)).length, 2, "cron fetched both feeds");
eq(kvPuts - putsBefore, 0, "unchanged feeds -> no KV writes");
// a newer batch that no longer lists the old items: history keeps them
const NYT_XML2 = `<rss><channel><item><title>ProQuest:Brand New</title><pubDate>Nov 19, 2026</pubDate><link>https://www.proquest.com/docview/3414299999</link></item></channel></rss>`;
upstream = (url) => new Response(url.endsWith("2310287") ? WSJ_XML : NYT_XML2, { status: 200 });
await worker.scheduled({}, env, { waitUntil() {} });
eq(kvPuts - putsBefore, 1, "only the changed feed's current shard is written");
_test.memo.clear();
r = await worker.fetch(req("/feed/nyt-proquest"), env); j = await r.json();
eq(j.latest, 1); eq(j.items.map((i) => i.title), ["Brand New", "Today's Headlines: Senate", "Second; not split for NYT"], "history keeps yesterday's items");

// month endpoint and "older" months: seed an old shard + index directly
kvStore.set("hist:nyt-proquest:2026-01", JSON.stringify({ items: [{ paper: "NYT", title: "January story", date: "2026-01-05", link: LIB(5555), id: "5555", seen: 1 },
  { paper: "NYT", title: "Undated", date: null, link: LIB(5556), id: "5556", seen: Date.parse("2026-01-07T03:00:00Z") }] }));
kvStore.set("idx:nyt-proquest", JSON.stringify({ months: [M, "2026-01"] }));
_test.memo.clear();
r = await worker.fetch(req("/feed/nyt-proquest"), env); j = await r.json();
eq(j.older, ["2026-01"], "older months listed for Load older");
ok(!j.items.some((i) => i.title === "January story"), "old months not in the first response");
const callsM = calls.length;
r = await worker.fetch(req("/feed/nyt-proquest/2026-01"), env); j = await r.json();
eq(r.status, 200); eq(j.month, "2026-01"); eq(j.items, [{ paper: "NYT", title: "January story", date: "2026-01-05", link: LIB(5555) },
  { paper: "NYT", title: "Undated", date: "2026-01-06", link: LIB(5556) }], "undated stored item falls back to its first-seen ET day");
ok(/max-age=3600/.test(r.headers.get("Cache-Control")), "past months cached longer");
eq(calls.length, callsM, "month endpoint never fetches upstream");
r = await worker.fetch(req("/feed/nyt-proquest/2025-02"), env); j = await r.json(); eq(j.items, [], "empty month");
for (const p of ["/feed/nyt-proquest/2026-13", "/feed/evil/2026-01", "/feed/nyt-proquest/2026-1"]) { r = await worker.fetch(req(p), env); eq(r.status, 404, p); }
r = await worker.fetch(req("/feed/nyt-proquest/2026-01", { origin: "https://evil.example" }), env); eq(r.status, 403);

// Español items stored in an old month are hidden when served and purged by the cron
kvStore.set("hist:nyt-proquest:2026-01", JSON.stringify({ items: [{ paper: "NYT", title: "January story", date: "2026-01-05", link: LIB(5555), id: "5555", seen: 1 },
  { paper: "NYT", title: "El gobierno de Milei enfrenta una nueva crisis", date: "2026-01-06", link: LIB(5556), id: "5556", seen: 1 }] }));
r = await worker.fetch(req("/feed/nyt-proquest/2026-01"), env); j = await r.json();
eq(j.items.map((i) => i.title), ["January story"], "Español hidden when serving a month");
upstream = (url) => new Response(url.endsWith("2310287") ? WSJ_XML : NYT_XML2, { status: 200 });
await worker.scheduled({}, env, { waitUntil() {} });
eq(JSON.parse(kvStore.get("hist:nyt-proquest:2026-01")).items.map((i) => i.id), ["5555"], "cron purged Español from an old month");

// upstream failure: stored history is still served (ok:false), nothing written
_test.memo.clear();
upstream = () => new Response("nope", { status: 503 });
const putsFail = kvPuts;
r = await worker.fetch(req("/feed/nyt-proquest"), env); j = await r.json();
eq(j.ok, false); eq(j.items.length, 3, "stale history served"); eq(kvPuts, putsFail);
ok(/max-age=30\b/.test(r.headers.get("Cache-Control")));

// upstream failure: reported, not cached
_test.memo.clear();
upstream = () => new Response("nope", { status: 503 });
r = await worker.fetch(req("/feed/wsj-proquest"), env); j = await r.json();
eq(r.status, 200); eq(j.ok, false); eq(j.items.length, 2, "WSJ history still served"); ok(/503/.test(j.error));
ok(/max-age=30\b/.test(r.headers.get("Cache-Control")), "failures cached only briefly");
ok(!_test.memo.has("wsj-proquest"), "failure not memoized");
upstream = () => { throw new Error("network down"); };
r = await worker.fetch(req("/feed/nyt-proquest"), env); j = await r.json(); eq(j.ok, false);

// works without a KV binding (no history)
_test.memo.clear();
upstream = (url) => new Response(NYT_XML, { status: 200 });
r = await worker.fetch(req("/feed/nyt-proquest"), { ALLOWED_ORIGIN: ORIGIN }); j = await r.json();
eq(j.ok, true); eq(j.items.length, 2);


// --- private article text + /search (full text never appears in the response) ---
eq(normalizeId("3414243596"), "3414243596"); eq(normalizeId("12"), ""); eq(normalizeId("abc"), "");
eq(normalizeText("  <p>Hello   world</p>\n\n\n<script>x()</script> "), "Hello world", "markup and script stripped");
ok(timingSafeEqual("abcd", "abcd")); ok(!timingSafeEqual("abcd", "abce")); ok(!timingSafeEqual("abcd", "abc")); ok(!timingSafeEqual("", ""));
_test.rate.reset();
eq(rateLimited("ip-a", 1).limited, false);
for (let i = 0; i < SEARCH_LIMIT - 1; i++) rateLimited("ip-a", 1);
eq(rateLimited("ip-a", 1).limited, true, "31st request in the window is limited");
eq(rateLimited("ip-b", 1).limited, false, "a different client is not limited");
eq(rateLimited("ip-a", 1 + 60_000).limited, false, "window reset");
_test.rate.reset();

const auth = (tok = TOKEN) => ({ Authorization: "Bearer " + tok });
const postText = (body, hdrs = auth(), origin = null) =>
  worker.fetch(req("/text", { method: "POST", origin, headers: hdrs, body: typeof body === "string" ? body : JSON.stringify(body) }), env);

r = await postText({ id: "3414299999", text: "hello" }, {}); eq(r.status, 401, "POST /text needs a token");
r = await postText({ id: "3414299999", text: "hello" }, auth("wrong-token")); eq(r.status, 401);
r = await postText({ id: "3414299999", text: "hello" }, auth(), ORIGIN); eq(r.status, 200, "token works even with a browser Origin");
r = await postText("not-json"); eq(r.status, 400);
r = await postText({ id: "nope", text: "hello" }); eq(r.status, 400);
r = await postText({ id: "3414299999", text: "   " }); eq(r.status, 400);
r = await worker.fetch(req("/text", { method: "GET" }), env); eq(r.status, 405);

const BODY = "PADSTART " + "lorem ".repeat(80) + "UNIQUE_MOSS_PHRASE grows on the test boulder only and nowhere else in this fixture " + "lorem ".repeat(80) + "PADEND";
r = await postText({ id: "3414299999", text: BODY }, auth(), null);
eq(r.status, 200); j = await r.json();
eq(j.ok, true); eq(j.id, "3414299999"); ok(j.found, "headline looked up from history");
ok(!JSON.stringify(j).includes("UNIQUE_MOSS_PHRASE"), "POST response has no article text");
ok(kvStore.has(TEXT_KEY("3414299999")), "stored under text:<id>");
ok([...kvStore.keys()].some((k) => k.startsWith("textm:")), "monthly text index written");
const stored = JSON.parse(kvStore.get(TEXT_KEY("3414299999")));
ok(stored.text.includes("UNIQUE_MOSS_PHRASE"));

// body-text search: snippet only, never the full stored text
r = await worker.fetch(req("/search?q=" + encodeURIComponent("UNIQUE_MOSS_PHRASE")), env);
eq(r.status, 200); ok(/no-store/.test(r.headers.get("Cache-Control")));
j = await r.json();
eq(j.ok, true); eq(j.items.length, 1); eq(j.items[0].id, "3414299999");
eq(j.items[0].title, "Brand New"); eq(j.items[0].paper, "NYT");
ok(j.items[0].snippet.includes("UNIQUE_MOSS_PHRASE"));
ok([...j.items[0].snippet].filter((c) => c !== "\u2026").length <= 200, "snippet cap");
ok(!JSON.stringify(j).includes(BODY), "/search never returns the full text");
ok(!j.items.some((i) => "text" in i), "no text field on hits");
eq(Object.keys(j.items[0]).sort(), ["date", "id", "link", "paper", "snippet", "title"]);

// headline-only search (no stored text needed)
r = await worker.fetch(req("/search?q=Senate"), env); j = await r.json();
ok(j.items.some((i) => i.title.includes("Senate")));
ok(j.items.every((i) => !i.snippet), "headline-only hits have no body snippet");

// quoted AND: moss phrase plus a word that is only in this body
r = await worker.fetch(req("/search?q=" + encodeURIComponent('"UNIQUE_MOSS_PHRASE" boulder')), env);
j = await r.json(); eq(j.items.map((i) => i.id), ["3414299999"]);
r = await worker.fetch(req("/search?q=" + encodeURIComponent('"UNIQUE_MOSS_PHRASE" missingword')), env);
j = await r.json(); eq(j.items, []);

// short query rejected; missing origin rejected; rate limit
r = await worker.fetch(req("/search?q=ab"), env); eq(r.status, 400);
r = await worker.fetch(req("/search?q=Senate", { origin: "https://evil.example" }), env); eq(r.status, 403);
r = await worker.fetch(req("/search?q=Senate", { origin: null }), env); eq(r.status, 403);
_test.rate.reset();
let limited = 0;
for (let i = 0; i < SEARCH_LIMIT + 2; i++) {
  r = await worker.fetch(req("/search?q=Senate", { headers: { "CF-Connecting-IP": "203.0.113.9" } }), env);
  if (r.status === 429) limited++;
}
ok(limited >= 1, "excess /search requests are rate limited");
eq(r.headers.get("Retry-After") != null, true);
_test.rate.reset();

// Español headlines are not searchable, even if text was stored under their id
kvStore.set("hist:nyt-proquest:2026-01", JSON.stringify({ items: [
  { paper: "NYT", title: "January story", date: "2026-01-05", link: LIB(5555), id: "5555", seen: 1 },
  { paper: "NYT", title: "El gobierno de Milei enfrenta una nueva crisis", date: "2026-01-06", link: LIB(5556), id: "5556", seen: 1 },
] }));
r = await postText({ id: "5556", text: "ES_BODY_MARKER hidden spanish body" });
eq(r.status, 200); j = await r.json(); eq(j.found, false, "Español headline is not used as metadata");
r = await worker.fetch(req("/search?q=ES_BODY_MARKER"), env); j = await r.json();
eq(j.items, [], "Español items never appear in /search");
r = await worker.fetch(req("/search?q=January"), env); j = await r.json();
ok(j.items.some((i) => i.id === "5555"));
ok(!j.items.some((i) => i.id === "5556"));

// POST /feeds is still rejected
r = await worker.fetch(req("/feeds", { method: "POST" }), env); eq(r.status, 405);



// --- live ProQuest result parsing (synthetic HTML; no article text from ProQuest) ---
eq(cleanTitle("Democrats Fortify Legal Shield: [National Desk]"), "Democrats Fortify Legal Shield");
eq(parseCiteDate("New York Times ; New York (Nov 22, 2026): 6-8."), "2026-11-22");
eq(parseCiteDate("Wall Street Journal, Eastern edition; 22 Nov 2026: A1."), "2026-11-22");
eq(classifyPaper("New York Times Magazine ; New York", "NYT"), "NYT");
eq(classifyPaper("Wall Street Journal (Online)", "WSJ"), "WSJ");
eq(classifyPaper("New York Times en Español ; New York", "NYT"), "", "Español source dropped");
eq(looksLikeLogin('<form><input name="pass" type="password"></form>'), true);
ok(!looksLikeChallenge("<html>Search Results</html>"));

const FIXTURE = `<html><title>Search Results</title><ul class="resultItems">
<li class="resultItem ltr "><div class="truncatedResultsTitle">Climate Bill Passes: [National Desk]</div>
<span>New York Times (Online); New York (Nov 21, 2026): n/a.</span>
<span class="snippet"><p>The <em><span class="hit">climate</span></em> bill passed after late talks in the chamber...</p></span>
<a href="/nytimes/docview/3410001111/ABC/1?accountid=57895">Full Text</a></li>
<li class="resultItem ltr "><div class="truncatedResultsTitle">Markets Rally on Rate Cut</div>
<span>Wall Street Journal (Online); New York (Nov 20, 2026).</span>
<span class="snippet"><p>Traders cited the <em>climate</em> bill as a reason markets rallied...</p></span>
<a href="/wallstreetjournal/docview/3410002222/ABC/2?accountid=57895">Full Text</a></li>
<li class="resultItem ltr "><div class="truncatedResultsTitle">El gobierno anuncia una nueva crisis climática</div>
<span>New York Times en Español; New York (Nov 19, 2026).</span>
<span class="snippet"><p>Una nota en español about climate.</p></span>
<a href="/nytimes/docview/3410003333/ABC/3?accountid=57895">Full Text</a></li>
</ul></html>`;
const parsed = parseResults(FIXTURE, "NYT");
eq(parsed.map((i) => i.id), ["3410001111", "3410002222"], "Español result dropped");
eq(parsed[0].paper, "NYT"); eq(parsed[0].date, "2026-11-21");
eq(parsed[0].title, "Climate Bill Passes", "desk suffix stripped");
eq(parsed[1].paper, "WSJ"); eq(parsed[1].date, "2026-11-20");
ok(parsed[0].snippet.toLowerCase().includes("climate"));
ok(parsed[0].snippet.length <= 201);
ok(parsed[0].link.includes("/docview/3410001111"));
ok(!JSON.stringify(parsed).includes("en Español"), "Español cite not in public items");
eq(mergeLiveHits([parsed, [{ id: "3410001111", paper: "NYT", date: "2026-11-21", title: "dup", link: LIB(3410001111) }]]).map((i) => i.id),
  ["3410001111", "3410002222"], "merged unique, date then id");

const formHtml = `<form id="searchForm" action="https://www-proquest-com.library.access.arlingtonva.us/index.searchform" method="post">
<input type="hidden" name="_csrf" value="abc"/>
<input type="hidden" name="site" value="nytimes"/>
<input type="hidden" name="t:formdata" value="one"/>
<textarea name="searchTerm"></textarea>
<input type="hidden" name="t:formdata" value="two"/>
<input type="checkbox" name="fullTextLimit" checked="checked"/>
</form>`;
const form = parseSearchForm(formHtml);
eq(form.action.endsWith("/index.searchform"), true);
const body = buildSearchBody(form, "climate bill");
ok(body.includes("searchTerm=climate") && body.includes("fullTextLimit="), "search posts term and full-text flag");
ok(body.includes("t%3Aformdata=one") && body.includes("t%3Aformdata=two"), "both tapestry formdata fields kept");

const jar = collectCookies([], { headers: { getSetCookie: () => ["ezproxy=zzz; Path=/; Domain=.library.access.arlingtonva.us"] } },
  "https://library.access.arlingtonva.us/login");
eq(jar[0].name, "ezproxy");
ok(cookieHeader(jar, "https://www-proquest-com.library.access.arlingtonva.us/nytimes/").includes("ezproxy=zzz"));
ok(!cookieHeader(jar, "https://evil.example/").includes("ezproxy"));
eq(snippetFrom("x".repeat(500), 200).replace(/\u2026$/, "").length <= 200, true);
eq(cacheKey("  Climate   Bill "), "pqcache:climate bill");

// /search without library secrets falls back to headlines and adds a quiet notice
_test.live.lastLive.at = 0;
r = await worker.fetch(req("/search?q=Senate"), env); j = await r.json();
eq(j.source, "headlines");
ok(typeof j.notice === "string" && /headline/i.test(j.notice), "fallback notice");
ok(j.items.some((i) => i.title.includes("Senate")));

// live path: mocked EZproxy + both publication searches
const prevFetch = globalThis.fetch;
const liveHtml = {
  login: { status: 302, headers: { location: "https://login.library.access.arlingtonva.us/connect?session=abc&qurl=https://www.proquest.com/nytimes/", "set-cookie": "ezproxy=tok; Path=/; Domain=.library.access.arlingtonva.us" }, body: "" },
  connect: { status: 302, headers: { location: "https://www-proquest-com.library.access.arlingtonva.us/nytimes/?accountid=57895" }, body: "" },
  page: { status: 200, body: formHtml.replace("id=\"searchForm\"", "id=\"searchForm\"") + "<title>Basic Search</title>" },
  results: { status: 200, body: FIXTURE, headers: { "content-type": "text/html" } },
};
function mockRes(spec) {
  const headers = new Headers();
  const h = spec.headers || {};
  for (const [k,v] of Object.entries(h)) if (k !== "set-cookie") headers.set(k, v);
  if (h["set-cookie"]) {
    headers.set("set-cookie", h["set-cookie"]);
    headers.getSetCookie = () => [h["set-cookie"]];
  } else headers.getSetCookie = () => [];
  return new Response(spec.body || "", { status: spec.status || 200, headers });
}
let pqCalls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  pqCalls.push((init && init.method) || "GET", u.split("?")[0]);
  if (u.includes("library.access.arlingtonva.us/login") && init && init.method === "POST") {
    const body = String(init.body || "");
    ok(!body.includes("LIB_PIN"), "PIN is form-encoded, not a secret name leak");
    // body should have user= and pass= but we do not print it
    ok(/user=/.test(body) && /pass=/.test(body), "login posts user and pass");
    return mockRes(liveHtml.login);
  }
  if (u.includes("/connect")) return mockRes(liveHtml.connect);
  if (/\/(nytimes|wallstreetjournal)\/?\?/.test(u) || /\/(nytimes|wallstreetjournal)\/$/.test(u)) return mockRes(liveHtml.page);
  if (u.includes("index.searchform") || u.includes("/results/")) return mockRes(liveHtml.results);
  return prevFetch(url, init);
};
const liveEnv = { ...env, LIB_USER: "john.lichtenberg", LIB_PIN: "not-the-real-pin" };
_test.live.lastLive.at = 0;
r = await worker.fetch(req("/search?q=climate"), liveEnv); j = await r.json();
eq(r.status, 200); eq(j.source, "proquest"); eq(j.ok, true);
eq(j.items.map((i) => i.id), ["3410001111", "3410002222"]);
ok(!j.items.some((i) => i.id === "3410003333"), "live Español dropped");
ok(!JSON.stringify(j).includes("not-the-real-pin"), "PIN never appears in /search JSON");
ok(!j.items.some((i) => "text" in i));
// second call is served from cache (no extra login)
const callsAfter = pqCalls.length;
_test.live.lastLive.at = 0;
r = await worker.fetch(req("/search?q=climate"), liveEnv); j = await r.json();
eq(j.cached, true); eq(j.items.length, 2);
eq(pqCalls.length, callsAfter, "cached query does not hit ProQuest again");
// A second query arriving during the 3s spacing window used to return
// "busy" and fall back to headlines (often none). It should wait, then search.
const prevSleep = _test.live.sleep;
let slept = 0;
_test.live.sleep = async (ms) => { slept = ms; };
_test.live.lastLive.at = Date.now() - 500;
const callsBeforeWait = pqCalls.length;
r = await worker.fetch(req("/search?q=Reimann"), liveEnv); j = await r.json();
eq(r.status, 200);
eq(j.source, "proquest");
eq(j.ok, true);
ok(!/busy/i.test(j.notice || ""), "spacing no longer returns a busy notice");
ok(slept > 0 && slept <= 3000, "waited out the remaining spacing");
ok(pqCalls.length > callsBeforeWait, "after waiting, the new query is searched");
_test.live.sleep = prevSleep;
globalThis.fetch = prevFetch;
_test.live.lastLive.at = 0;



// --- GET /go?id= : EZproxy connect ticket (PIN never in the response) ---
{
  const id = "3416786144";
  const goodQurl = "https://www.proquest.com/docview/" + id + "?accountid=57895";
  const goodLoc = "https://login.library.access.arlingtonva.us/connect?session=TICKET&qurl=" + encodeURIComponent(goodQurl);
  ok(isAllowedConnect(goodLoc, id));
  ok(isAllowedConnect(goodLoc.replace("https://www.proquest.com", "https://search.proquest.com"), id), "search.proquest.com also allowed");
  ok(!isAllowedConnect(goodLoc, "999"), "qurl id must match");
  ok(!isAllowedConnect("https://evil.example/connect?session=TICKET&qurl=" + encodeURIComponent(goodQurl), id), "host must be EZproxy");
  ok(!isAllowedConnect("https://login.library.access.arlingtonva.us/connect?session=TICKET&qurl=" + encodeURIComponent("https://evil.example/docview/" + id), id));
  ok(!isAllowedConnect("https://login.library.access.arlingtonva.us/login?url=" + encodeURIComponent(goodQurl), id), "only /connect");
  ok(!isAllowedConnect("https://www-proquest-com.library.access.arlingtonva.us/docview/" + id + "?accountid=57895", id), "proxied docview is not a ticket");
  ok(!isAllowedConnect("https://login.library.access.arlingtonva.us/connect?session=TICKET&qurl=" + encodeURIComponent("https://www.proquest.com.evil.example/docview/" + id), id));
  eq(docviewUrl(id), "https://www.proquest.com/docview/" + id + "?accountid=57895");
  ok(originAllowed(new Request("https://relay.example/go?id=1"), "https://johnlichtenberg.github.io"), "missing Origin/Referer allowed");
  ok(originAllowed(new Request("https://relay.example/go?id=1", { headers: { Origin: "https://johnlichtenberg.github.io", Referer: "https://johnlichtenberg.github.io/news/" } }), "https://johnlichtenberg.github.io"));
  ok(!originAllowed(new Request("https://relay.example/go?id=1", { headers: { Origin: "https://evil.example" } }), "https://johnlichtenberg.github.io"));
  ok(!originAllowed(new Request("https://relay.example/go?id=1", { headers: { Referer: "https://evil.example/" } }), "https://johnlichtenberg.github.io"));
}

_test.rate.reset();
r = await worker.fetch(req("/go"), env); eq(r.status, 400, "/go needs a numeric id");
r = await worker.fetch(req("/go?id=abc"), env); eq(r.status, 400);
r = await worker.fetch(req("/go?id=3416786144&url=https://evil.example/"), env); eq(r.status, 302, "extra params ignored; id still valid");
eq(r.headers.get("Location"), LIB("3416786144"), "no secrets and no EZproxy login -> library fallback");
ok(/no-store/.test(r.headers.get("Cache-Control")));
eq(r.headers.get("Referrer-Policy"), "no-referrer");
r = await worker.fetch(req("/go?id=3416786144", { origin: "https://evil.example" }), env); eq(r.status, 403);
r = await worker.fetch(req("/go?id=3416786144", { origin: null, headers: { Referer: "https://evil.example/" } }), env); eq(r.status, 403);

// mocked ticket: 302 to connect, body empty, PIN not in headers
const prevFetchGo = globalThis.fetch;
let goPosts = 0, lastGoBody = "";
globalThis.fetch = async (url, init) => {
  if (String(url).includes("library.access.arlingtonva.us/login") && init && init.method === "POST") {
    goPosts++;
    lastGoBody = String(init.body || "");
    const id = "3416786144";
    const loc = "https://login.library.access.arlingtonva.us/connect?session=TESTSESSION&qurl=" + encodeURIComponent(docviewUrl(id));
    return new Response(null, { status: 302, headers: { Location: loc } });
  }
  return prevFetchGo(url, init);
};
const goEnv = { ...env, LIB_USER: "john.lichtenberg", LIB_PIN: "not-the-real-pin" };
_test.rate.reset();
r = await worker.fetch(req("/go?id=3416786144", { origin: null }), goEnv); // Focus often sends no Origin
eq(r.status, 302);
eq(r.headers.get("Cache-Control").includes("no-store"), true);
eq(r.headers.get("Referrer-Policy"), "no-referrer");
const loc = r.headers.get("Location") || "";
ok(loc.startsWith("https://login.library.access.arlingtonva.us/connect?"), "redirects to EZproxy connect ticket");
ok(loc.includes("qurl=") && loc.includes("3416786144"), "ticket qurl is this docview id");
eq(await r.text(), "", "empty body");
ok(!(r.headers.get("Location") || "").includes("not-the-real-pin"), "PIN not in Location");
ok(!lastGoBody.includes("LIB_PIN"));
ok(/user=/.test(lastGoBody) && /pass=/.test(lastGoBody) && /url=/.test(lastGoBody), "login POST has user, pass, url");
eq(goPosts, 1);

// evil Location from EZproxy is not forwarded
globalThis.fetch = async (url, init) => {
  if (String(url).includes("library.access.arlingtonva.us/login")) {
    return new Response(null, { status: 302, headers: { Location: "https://evil.example/phish" } });
  }
  return prevFetchGo(url, init);
};
_test.rate.reset();
r = await worker.fetch(req("/go?id=3416786144"), goEnv);
eq(r.status, 302);
eq(r.headers.get("Location"), LIB("3416786144"), "unsafe Location falls back to the library docview URL");
globalThis.fetch = prevFetchGo;
_test.rate.reset();



// --- sections: papers' own URL paths, matching, storage ---
{
  eq(sectionFromUrl("https://www.nytimes.com/2026/11/23/technology/openai-engineer-secret-recordings.html", "NYT").raw, "technology");
  eq(tabFor("NYT", "technology"), "Technology");
  eq(sectionFromUrl("https://www.nytimes.com/2026/11/23/us/politics/walter-willett-trump-harvard.html", "NYT").raw, "politics");
  eq(tabFor("NYT", sectionFromUrl("https://www.nytimes.com/2026/11/23/us/politics/x.html", "NYT").raw), "Politics");
  eq(sectionFromUrl("https://www.nytimes.com/2026/11/23/us/elections/new-hampshire-presidential-primary.html", "NYT").raw, "politics");
  eq(sectionFromUrl("https://www.nytimes.com/2026/11/23/nyregion/trump-conviction-appeal-federal-court.html", "NYT").raw, "nyregion");
  eq(tabFor("NYT", "nyregion"), "New York");
  eq(tabFor("NYT", "well"), "Well");
  eq(tabFor("NYT", "climate"), "Climate");
  eq(tabFor("NYT", "dining"), "Food");
  eq(tabFor("NYT", "briefing"), "Other");
  eq(sectionFromUrl("https://www.nytimes.com/athletic/7808248/2026/11/24/bengals-win/", "NYT").raw, "athletic");
  eq(tabFor("NYT", "athletic"), "The Athletic");
  ok(!sectionFromUrl("https://www.nytimes.com/2026/11/23/espanol/foo.html", "NYT"), "NYT en Español URLs are ignored");
  eq(sectionFromUrl("https://www.wsj.com/tech/amazon-leo-starlink-rival-5bb0e6a0", "WSJ").raw, "tech");
  eq(tabFor("WSJ", "tech"), "Tech");
  eq(tabFor("WSJ", "finance"), "Markets & Finance");
  eq(tabFor("WSJ", "us-news"), "U.S.");
  eq(tabFor("WSJ", "arts-culture"), "Arts");
  eq(tabFor("WSJ", "lifestyle"), "Lifestyle");
  eq(tabFor("WSJ", "personal-finance"), "Personal Finance");
  eq(tabFor("WSJ", "articles"), "Other");
  eq(prefixSection("DealBook: Can Huang return to Nvidia?"), "Business");
  eq(prefixSection("N.Y. Today: A councilwoman takes aim at a housing survey"), "New York");
  eq(prefixSection("Daily Briefing: Weil Gotshal Bankruptcy Chief Takes Team to Skadden"), "Other");
  eq(prefixSection("The Evening: Trump pressed for Huang’s return"), "Other");
  eq(prefixSection("Breaking news: House Democrat quits"), "", "breaking news is stripped, not assigned a desk");
  eq(tabFor("WSJ", "economy"), "Economy");
  eq(prefixSection("Climate: A new warning"), "Climate");
  eq(bylineSection("Elon Musk Has Regrets: Michelle Goldberg", "NYT"), "Opinion");
  eq(bylineSection("Elon Musk Has Regrets: Michelle Goldberg", "WSJ"), "", "columnist suffix is NYT Opinion only");
  eq(bylineSection("A letter about the war: letters", "NYT"), "Opinion");

  ok(titleVariants("Breaking news: House Democrat quits").includes("House Democrat quits"));
  ok(titleVariants("Elon Musk Has Regrets: Michelle Goldberg").includes("Elon Musk Has Regrets"));
  eq(NEWS_SITEMAPS.NYT.includes("sitemaps/new/news.xml"), true);
  eq(catalogMonthUrl("NYT", "2026-11"), "https://www.nytimes.com/sitemaps/new/sitemap-2026-11.xml.gz");
  eq(catalogMonthUrl("WSJ", "2026-11"), "https://www.wsj.com/sitemaps/web/wsj/en/sitemap_wsj_en_m11_2026.xml");
  eq(catalogMonthUrl("WSJ", "2026-09"), "https://www.wsj.com/sitemaps/web/wsj/en/sitemap_wsj_en_m9_2026.xml");

  const nytNews = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
    <url><loc>https://www.nytimes.com/2026/11/23/technology/openai-engineer-secret-recordings.html</loc>
      <news:news><news:publication_date>2026-11-23T20:00:00Z</news:publication_date>
      <news:title>OpenAI Engineer Secretly Recorded Dozens of Meetings, Prosecutors Say</news:title></news:news></url>
    <url><loc>https://www.nytimes.com/2026/11/23/us/politics/walter-willett-trump-harvard.html</loc>
      <news:news><news:title>How a Scientist Behind the Mediterranean Diet Got Caught in Trump’s War on Harvard</news:title></news:news></url>
  </urlset>`;
  const parsed = parseUrlset(nytNews, "NYT");
  eq(parsed.length, 2);
  eq(parsed[0].raw, "technology"); eq(parsed[0].slug, "openai-engineer-secret-recordings");
  const idx = buildIndex(parsed);
  eq(matchHeadline("OpenAI Engineer Secretly Recorded Dozens of Meetings, Prosecutors Say", "2026-11-23", "NYT", idx).section, "Technology");
  eq(matchHeadline("How a Scientist Behind the Mediterranean Diet Got Caught in Trump’s War on Harvard", "2026-11-23", "NYT", idx).section, "Politics");
  // slug match when the ProQuest title is close to the URL slug
  const slugIdx = buildIndex(parseUrlset(`<urlset><url><loc>https://www.wsj.com/tech/amazon-leo-starlink-rival-5bb0e6a0</loc><lastmod>2026-11-23T04:00:00Z</lastmod></url></urlset>`, "WSJ"));
  const slugHit = matchHeadline("Why Amazon's Rival to Starlink Is Struggling to Catch Up With SpaceX", "2026-11-23", "WSJ", slugIdx);
  // may be slug-score or no match if too short; exact slug words should score
  // Title has amazon, rival, starlink; slug has amazon, leo, starlink, rival — should match.
  eq(slugHit && slugHit.section, "Tech");
  const rss = parseRssEntries(`<rss><channel><item><title>Gold Rises Amid Risk-on Sentiment Across Markets</title>
    <link>https://www.wsj.com/finance/commodities-futures/gold-rises-amid-risk-on-sentiment-across-markets-abc12def</link>
    <pubDate>Tue, 24 Nov 2026 03:00:00 GMT</pubDate></item></channel></rss>`, "WSJ");
  eq(rss[0].raw, "finance");
  eq(tabFor("WSJ", rss[0].raw), "Markets & Finance");

  eq(migrateSection("Tech", "NYT"), "Technology");
  eq(migrateSection("Markets", "WSJ"), "Markets & Finance");
  eq(migrateSection("Life & Arts", "WSJ"), "Lifestyle");
  eq(migrateSection("U.S.", "NYT"), "U.S.", "ambiguous NYT U.S. is not assumed to be New York");
  const cat = { NYT: idx, WSJ: slugIdx };
  const rematch = applyCatalog([
    { paper: "NYT", title: "OpenAI Engineer Secretly Recorded Dozens of Meetings, Prosecutors Say", date: "2026-11-23", section: "Tech" },
    { paper: "NYT", title: "A leftover U.S. item with no catalog hit", date: "2026-11-23", section: "U.S." },
    { paper: "WSJ", title: "Gold leftover", date: "2026-11-23", section: "Markets" },
  ], cat);
  eq(rematch[0].section, "Technology", "official URL match overwrites the old shared Tech label");
  eq(rematch[1].section, "U.S.", "unmatched ambiguous label is kept");
  eq(rematch[2].section, "Markets & Finance", "unambiguous Markets rename when no URL match");

  // mergeShard keeps and fills section; change detection includes it
  const withSec = mergeShard([], [{ ...it(200, "2026-11-18"), section: "Tech" }], [], T);
  eq(withSec[0].section, "Tech");
  const kept = mergeShard(withSec, [it(200, "2026-11-18")], [], T);
  eq(kept[0].section, "Tech", "stored section kept when the live item has none yet");
  const filled = mergeShard(kept, [{ ...it(200, "2026-11-18"), section: "Tech" }], [], T);
  ok(!changed(kept, filled), "same section is not a write");
  const added = mergeShard([{ ...it(201, "2026-11-18"), id: "201", seen: T }], [{ ...it(201, "2026-11-18"), section: "World" }], [], T);
  eq(added[0].section, "World");
  ok(changed([{ ...it(201, "2026-11-18"), id: "201", seen: T }], added), "newly assigned section triggers a write");
}

// /feed items expose section and never a publisher URL
{
  _catalog.reset();
  _test.memo.clear();
  const NYT_SM = `<?xml version="1.0"?><urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
    <url><loc>https://www.nytimes.com/2026/11/18/us/politics/senate-vote.html</loc>
      <news:title>Today's Headlines: Senate</news:title></url>
  </urlset>`;
  const prevUp = upstream;
  upstream = (url) => {
    if (url.includes("nytimes.com/sitemaps/")) return new Response(NYT_SM, { status: 200 });
    if (url.includes("wsj.com/")) return new Response("<urlset></urlset>", { status: 200 });
    return prevUp(url);
  };
  const env2 = { ALLOWED_ORIGIN: ORIGIN, NEWS_HISTORY: KV };
  const rSec = await worker.fetch(req("/feed/nyt-proquest"), env2);
  const jSec = await rSec.json();
  ok(jSec.items.some((i) => i.title.includes("Senate") && i.section === "Politics"), "live item gets Politics from the NYT URL path");
  ok(!JSON.stringify(jSec).includes("nytimes.com"), "public feed JSON has no publisher URLs");
  ok(!JSON.stringify(jSec).includes("wsj.com"), "public feed JSON has no WSJ URLs");
  upstream = prevUp;
  _catalog.reset();
  _test.memo.clear();
}


console.log(`worker tests: ${n} passed`);
