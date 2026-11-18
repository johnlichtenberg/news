// node worker.test.mjs   (no network: global fetch is mocked)
import assert from "node:assert/strict";
import { FEEDS } from "./feeds.js";
import { parseRss, plainText, cleanLink, decodeEntities } from "./parse.js";

const ORIGIN = "https://johnlichtenberg.github.io";
const NYT_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>NYT &gt; Politics</title>
<item><title>Senate Passes &amp; Signs Bill</title>
<link>https://www.nytimes.com/2026/11/17/us/politics/bill.html</link>
<description>Lawmakers &#x2014; after a long night &#8212; agreed.</description>
<pubDate>Wed, 18 Nov 2026 06:21:20 +0000</pubDate>
<content:encoded><![CDATA[<p>FULL BODY SHOULD NEVER APPEAR</p>]]></content:encoded></item>
<item><title><![CDATA[Quotes “Here” <b>bold</b>]]></title>
<link>https://www.nytimes.com/2026/11/17/x.html?smid=rss&amp;keep=1#frag</link>
<description>&lt;p&gt;Escaped &lt;a href="https://evil.example"&gt;markup&lt;/a&gt; removed&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;</description>
<pubDate>not a date</pubDate></item>
<item><title>Offsite link dropped</title><link>https://evil.example/a</link></item>
<item><title>JS link dropped</title><link>javascript:alert(1)</link></item>
<item><title></title><link>https://www.nytimes.com/no-title.html</link></item>
</channel></rss>`;
const WSJ_XML = `<rss><channel><item><guid isPermaLink="false">WP-1</guid><title>Stocks Rise</title>
<description>Markets  rallied.</description>
<link>https://www.wsj.com/finance/stocks/stocks-rise-abc?mod=rss_markets_main</link>
<pubDate>Wed, 18 Nov 2026 01:12:00 GMT</pubDate><dc:creator>A</dc:creator></item></channel></rss>`;

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// --- parser ---
const nyt = parseRss(NYT_XML, { paper: "NYT", section: "Politics" });
eq(nyt.length, 2, "only valid nytimes.com items kept");
eq(nyt[0].title, "Senate Passes & Signs Bill");
eq(nyt[0].description, "Lawmakers \u2014 after a long night \u2014 agreed.");
eq(nyt[0].published, "2026-11-18T06:21:20.000Z");
eq(nyt[0].section, "Politics");
eq(Object.keys(nyt[0]).sort(), ["description", "link", "paper", "published", "section", "title"], "only feed fields");
ok(!JSON.stringify(nyt).includes("FULL BODY"), "content:encoded never used");
eq(nyt[1].title, "Quotes \u201cHere\u201d bold");
eq(nyt[1].description, "Escaped markup removed");
ok(!/[<>]/.test(JSON.stringify(nyt.map((i) => i.title + i.description))), "no markup survives");
eq(nyt[1].link, "https://www.nytimes.com/2026/11/17/x.html?keep=1", "tracking param + hash stripped");
eq(nyt[1].published, null, "bad date -> null");
const wsj = parseRss(WSJ_XML, { paper: "WSJ", section: "Markets" });
eq(wsj.length, 1);
eq(wsj[0].link, "https://www.wsj.com/finance/stocks/stocks-rise-abc");
eq(wsj[0].description, "Markets rallied.");
eq(parseRss("<rss>", { paper: "NYT" }), []);
eq(parseRss(NYT_XML, { paper: "WSJ", section: "X" }).length, 0, "NYT links rejected for WSJ feed");
eq(cleanLink("http://www.wsj.com/a", "WSJ"), "https://www.wsj.com/a", "upgraded to https");
eq(cleanLink("https://www.wsj.com.evil.io/a", "WSJ"), "");
eq(decodeEntities("&amp;lt;&#39;&bogus;"), "&lt;'&bogus;");
ok(plainText("word ".repeat(300), 50).length <= 50, "truncated");
eq(parseRss(NYT_XML.replace(/<\/channel>/, "<item><title>t</title><link>https://www.nytimes.com/a</link></item>".repeat(100) + "</channel>"), { paper: "NYT", section: "S" }).length, 60, "limit 60");

// --- whitelist sanity ---
const ids = new Set();
for (const f of FEEDS) {
  ok(!ids.has(f.id), "unique id " + f.id); ids.add(f.id);
  ok(/^https:\/\/(rss\.nytimes\.com|feeds\.content\.dowjones\.io)\//.test(f.url), "publisher feed host " + f.url);
  ok(f.paper === "NYT" || f.paper === "WSJ");
}

// --- worker ---
let calls = [];
let upstream = (url) => new Response(url.includes("nytimes") ? NYT_XML : WSJ_XML, { status: 200 });
globalThis.fetch = async (url, init) => { calls.push(String(url)); return upstream(String(url), init); };
const { default: worker, _test } = await import("./worker.js");
const env = { ALLOWED_ORIGIN: ORIGIN };
const req = (path, { origin = ORIGIN, method = "GET" } = {}) =>
  new Request("https://news-feeds-relay.example.workers.dev" + path, { method, headers: origin ? { Origin: origin } : {} });

let r = await worker.fetch(req("/feeds"), env);
eq(r.status, 200); eq(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
let j = await r.json();
eq(j.feeds.length, FEEDS.length); ok(!JSON.stringify(j).includes("http"), "feed list hides upstream URLs");
eq(calls.length, 0, "/feeds does no upstream fetch");

r = await worker.fetch(req("/feed/nyt-politics"), env);
eq(r.status, 200); j = await r.json();
eq(j.ok, true); eq(j.items.length, 2); eq(calls, ["https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml"]);
ok(/max-age=300/.test(r.headers.get("Cache-Control")), "5-minute cache header");
r = await worker.fetch(req("/feed/nyt-politics"), env);
eq(calls.length, 1, "second request served from 5-minute cache");

r = await worker.fetch(req("/feed/wsj-markets"), env); j = await r.json();
eq(j.items[0].title, "Stocks Rise"); eq(calls.length, 2);

r = await worker.fetch(req("/feed/evil"), env); eq(r.status, 404);
r = await worker.fetch(req("/feed/https%3A%2F%2Fevil.example"), env); eq(r.status, 404);
r = await worker.fetch(req("/feed?url=https://evil.example"), env); eq(r.status, 404);
r = await worker.fetch(req("/"), env); eq(r.status, 404);
eq(calls.length, 2, "nothing outside the whitelist fetched");

r = await worker.fetch(req("/feeds", { origin: "https://evil.example" }), env); eq(r.status, 403);
eq(r.headers.get("Access-Control-Allow-Origin"), ORIGIN, "never echoes other origins");
r = await worker.fetch(req("/feeds", { origin: null }), env); eq(r.status, 403);
r = await worker.fetch(req("/feeds", { method: "POST" }), env); eq(r.status, 405);
r = await worker.fetch(req("/feeds", { method: "OPTIONS" }), env); eq(r.status, 204);
r = await worker.fetch(req("/feeds", { method: "OPTIONS", origin: "https://evil.example" }), env); eq(r.status, 403);

// upstream failure: reported, not cached
upstream = () => new Response("nope", { status: 503 });
r = await worker.fetch(req("/feed/wsj-world"), env); j = await r.json();
eq(r.status, 200); eq(j.ok, false); eq(j.items, []); ok(/503/.test(j.error));
ok(/max-age=30\b/.test(r.headers.get("Cache-Control")), "failures cached only briefly");
ok(!_test.memo.has("wsj-world"), "failure not memoized");
upstream = () => { throw new Error("network down"); };
r = await worker.fetch(req("/feed/wsj-us"), env); j = await r.json(); eq(j.ok, false);

console.log(`worker tests: ${n} passed`);
