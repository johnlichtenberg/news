// node worker/worker.test.mjs   (no network: global fetch is mocked)
import assert from "node:assert/strict";
import { FEEDS } from "./feeds.js";
import { parseProquest, proquestLink, proquestDate, plainText, decodeEntities } from "./parse.js";

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

// --- worker ---
let calls = [];
let upstream = (url) => new Response(url.endsWith("2310287") ? WSJ_XML : NYT_XML, { status: 200 });
globalThis.fetch = async (url, init) => { calls.push(String(url)); return upstream(String(url), init); };
const { default: worker, _test } = await import("./worker.js");
const env = { ALLOWED_ORIGIN: ORIGIN };
const req = (path, { origin = ORIGIN, method = "GET" } = {}) =>
  new Request("https://news-feeds-relay.example.workers.dev" + path, { method, headers: origin ? { Origin: origin } : {} });

let r = await worker.fetch(req("/feeds"), env);
eq(r.status, 200); eq(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
let j = await r.json();
eq(j.feeds, [{ id: "nyt-proquest", paper: "NYT" }, { id: "wsj-proquest", paper: "WSJ" }]);
eq(calls.length, 0, "/feeds does no upstream fetch");

r = await worker.fetch(req("/feed/nyt-proquest"), env); j = await r.json();
eq(r.status, 200); eq(j.ok, true); eq(j.paper, "NYT"); eq(j.items.length, 2);
eq(calls, ["https://feeds.proquest.com/rss/2310267"]);
ok(/max-age=300/.test(r.headers.get("Cache-Control")), "5-minute cache header");
await worker.fetch(req("/feed/nyt-proquest"), env);
eq(calls.length, 1, "second request served from 5-minute cache");
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

// upstream failure: reported, not cached
_test.memo.clear();
upstream = () => new Response("nope", { status: 503 });
r = await worker.fetch(req("/feed/wsj-proquest"), env); j = await r.json();
eq(r.status, 200); eq(j.ok, false); eq(j.items, []); ok(/503/.test(j.error));
ok(/max-age=30\b/.test(r.headers.get("Cache-Control")), "failures cached only briefly");
ok(!_test.memo.has("wsj-proquest"), "failure not memoized");
upstream = () => { throw new Error("network down"); };
r = await worker.fetch(req("/feed/nyt-proquest"), env); j = await r.json(); eq(j.ok, false);

console.log(`worker tests: ${n} passed`);
