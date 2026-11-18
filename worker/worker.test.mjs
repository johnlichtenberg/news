// node worker/worker.test.mjs   (no network: global fetch is mocked)
import assert from "node:assert/strict";
import { FEEDS } from "./feeds.js";
import { parseProquest, proquestLink, proquestDate, plainText, decodeEntities } from "./parse.js";
import { mergeShard, storeBatch, readShard, readIndex, docviewId, changed, monthOf, prevMonth, isMonth } from "./history.js";

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
eq(decodeEntities("&amp;lt;&#39;&bogus;"), "&lt;'&bogus;");
eq(plainText("<b>a</b> &amp; b"), "a & b");

// --- whitelist: exactly the two ProQuest feeds ---
eq(FEEDS.map((f) => [f.id, f.paper, f.url]), [
  ["nyt-proquest", "NYT", "https://feeds.proquest.com/rss/2310267"],
  ["wsj-proquest", "WSJ", "https://feeds.proquest.com/rss/2310287"],
]);

// --- history (monthly shards, kept forever) ---
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
const env = { ALLOWED_ORIGIN: ORIGIN, NEWS_HISTORY: KV };
const req = (path, { origin = ORIGIN, method = "GET" } = {}) =>
  new Request("https://news-feeds-relay.example.workers.dev" + path, { method, headers: origin ? { Origin: origin } : {} });

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
kvStore.set("hist:nyt-proquest:2026-01", JSON.stringify({ items: [{ paper: "NYT", title: "January story", date: "2026-01-05", link: LIB(5555), id: "5555", seen: 1 }] }));
kvStore.set("idx:nyt-proquest", JSON.stringify({ months: [M, "2026-01"] }));
_test.memo.clear();
r = await worker.fetch(req("/feed/nyt-proquest"), env); j = await r.json();
eq(j.older, ["2026-01"], "older months listed for Load older");
ok(!j.items.some((i) => i.title === "January story"), "old months not in the first response");
const callsM = calls.length;
r = await worker.fetch(req("/feed/nyt-proquest/2026-01"), env); j = await r.json();
eq(r.status, 200); eq(j.month, "2026-01"); eq(j.items, [{ paper: "NYT", title: "January story", date: "2026-01-05", link: LIB(5555) }]);
ok(/max-age=3600/.test(r.headers.get("Cache-Control")), "past months cached longer");
eq(calls.length, callsM, "month endpoint never fetches upstream");
r = await worker.fetch(req("/feed/nyt-proquest/2025-02"), env); j = await r.json(); eq(j.items, [], "empty month");
for (const p of ["/feed/nyt-proquest/2026-13", "/feed/evil/2026-01", "/feed/nyt-proquest/2026-1"]) { r = await worker.fetch(req(p), env); eq(r.status, 404, p); }
r = await worker.fetch(req("/feed/nyt-proquest/2026-01", { origin: "https://evil.example" }), env); eq(r.status, 403);

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

console.log(`worker tests: ${n} passed`);
