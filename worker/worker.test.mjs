// node worker/worker.test.mjs   (no network: global fetch is mocked)
import assert from "node:assert/strict";
import { FEEDS } from "./feeds.js";
import { parseProquest, proquestLink, proquestDate, proquestTs, plainText, decodeEntities } from "./parse.js";
import { isSpanishTitle, isSpanishSource } from "./lang.js";
import { keepItem } from "./parse.js";
import { mergeShard, purgeShard, storeBatch, readShard, readIndex, docviewId, changed, monthOf, prevMonth, isMonth } from "./history.js";
import { normalizeId, normalizeText, TEXT_KEY, timingSafeEqual, rateLimited, SEARCH_LIMIT } from "./search.js";

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
eq(calls, ["https://feeds.proquest.com/rss/2310267"]);
ok(/max-age=300/.test(r.headers.get("Cache-Control")), "5-minute cache header");
await worker.fetch(req("/feed/nyt-proquest"), env);
eq(calls.length, 1, "second request served from 5-minute cache");
eq(kvPuts, 2, "no write from cache hit");
r = await worker.fetch(req("/feed/wsj-proquest"), env); j = await r.json();
eq(j.paper, "WSJ"); eq(j.items[0].title, "Nvidia Reports Faster Growth, Says Jensen Huang Won't Return as CEO");
eq(calls.at(-1), "https://feeds.proquest.com/rss/2310287");

for (const p of ["/feed/nyt-top", "/feed/wsj-world", "/feed/evil", "/feed/https%3A%2F%2Fevil.example", "/feed?url=https://evil.example", "/"]) {
  r = await worker.fetch(req(p), env); eq(r.status, 404, p);
}
eq(calls.length, 2, "only the two ProQuest URLs are ever fetched");

r = await worker.fetch(req("/feeds", { origin: "https://evil.example" }), env); eq(r.status, 403);
eq(r.headers.get("Access-Control-Allow-Origin"), ORIGIN, "never echoes other origins");
r = await worker.fetch(req("/feeds", { origin: null }), env); eq(r.status, 403);
r = await worker.fetch(req("/feeds", { method: "POST" }), env); eq(r.status, 405);
r = await worker.fetch(req("/feeds", { method: "OPTIONS" }), env); eq(r.status, 204);
r = await worker.fetch(req("/feeds", { method: "OPTIONS", origin: "https://evil.example" }), env); eq(r.status, 403);

// cron: refreshes both feeds (bypassing the 5-minute memo); unchanged feeds are not rewritten
const putsBefore = kvPuts, callsBefore = calls.length;
await worker.scheduled({}, env, { waitUntil() {} });
eq(calls.length - callsBefore, 2, "cron fetched both feeds");
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


console.log(`worker tests: ${n} passed`);
