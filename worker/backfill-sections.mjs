// One-shot: assign section tabs to already-stored history from public NYT/WSJ
// sitemaps and RSS (free, no paywall). Dry run unless you pass --write.
// Usage: node worker/backfill-sections.mjs [--write]
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FEEDS } from "./feeds.js";
import { parseUrlset, parseRssEntries, indexFromEntries, applyCatalog, catalogMonthUrl, NEWS_SITEMAPS, OFFICIAL_RSS } from "./sections.js";

const NS = "64d4a2262065442ca10a11f79c670480";
const write = process.argv.includes("--write");
const UA = "news-feeds-relay (personal RSS reader)";

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/xml, text/xml, */*" } });
  if (!r.ok) throw new Error(url + " " + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    const { gunzipSync } = await import("node:zlib");
    return gunzipSync(buf).toString("utf8");
  }
  return new TextDecoder().decode(buf);
}

const HERE = fileURLToPath(new URL(".", import.meta.url));
const wr = (args) => execFileSync("npx", ["-y", "wrangler@3", ...args], {
  cwd: HERE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000,
});

const RSS = {
  NYT: [
    "https://rss.nytimes.com/services/xml/rss/nyt/recent.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Africa.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Americas.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Europe.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/MiddleEast.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/US.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/NYRegion.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Education.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Upshot.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/PersonalTech.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Science.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Health.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Climate.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Space.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Weather.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Well.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Opinion.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Sunday-Review.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Arts.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Books.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Books/Review.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/FashionandStyle.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/DiningandWine.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Travel.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/RealEstate.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Well.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Movies.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Theater.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Music.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Dance.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/ArtandDesign.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Television.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Magazine.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/tmagazine.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Obituaries.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/Weddings.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/YourMoney.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/EnergyEnvironment.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/MediaandAdvertising.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/SmallBusiness.xml",
  ],
  WSJ: [
    "https://feeds.content.dowjones.io/public/rss/RSSWorldNews",
    "https://feeds.content.dowjones.io/public/rss/RSSUSnews",
    "https://feeds.content.dowjones.io/public/rss/socialpoliticsfeed",
    "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness",
    "https://feeds.content.dowjones.io/public/rss/socialeconomyfeed",
    "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain",
    "https://feeds.content.dowjones.io/public/rss/RSSWSJD",
    "https://feeds.content.dowjones.io/public/rss/RSSOpinion",
    "https://feeds.content.dowjones.io/public/rss/RSSArtsCulture",
    "https://feeds.content.dowjones.io/public/rss/RSSLifestyle",
    "https://feeds.content.dowjones.io/public/rss/RSSStyle",
    "https://feeds.content.dowjones.io/public/rss/rsssportsfeed",
    "https://feeds.content.dowjones.io/public/rss/socialhealth",
    "https://feeds.content.dowjones.io/public/rss/latestnewsrealestate",
    "https://feeds.content.dowjones.io/public/rss/RSSPersonalFinance",
  ],
};

const monthsFrom = (idx) => {
  try {
    const j = JSON.parse(wr(["kv", "key", "get", idx, "--namespace-id", NS, "--text"]).trim() || "{}");
    return Array.isArray(j.months) ? j.months : [];
  } catch (e) {
    if (/not found|404/i.test(String(e.stderr || e.message))) return [];
    throw e;
  }
};

const entries = { NYT: [], WSJ: [] };
const months = new Set();
for (const feed of FEEDS) {
  for (const m of monthsFrom(`idx:${feed.id}`)) months.add(m);
}
if (!months.size) months.add(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(Date.now()));

console.log("months", [...months].sort().join(", "));
for (const paper of ["NYT", "WSJ"]) {
  const urls = [...new Set([NEWS_SITEMAPS[paper], ...[...months].map((m) => catalogMonthUrl(paper, m)), ...(OFFICIAL_RSS[paper] || []), ...RSS[paper]])];
  for (const url of urls) {
    try {
      const xml = await fetchText(url);
      const got = url.includes("/rss") || url.includes("dowjones") ? parseRssEntries(xml, paper) : parseUrlset(xml, paper);
      entries[paper].push(...got);
      console.log("  ", got.length, url);
    } catch (e) {
      console.log("  FAIL", url, e.message);
    }
  }
}

const catalogs = indexFromEntries(entries.NYT, entries.WSJ);
const counts = { NYT: {}, WSJ: {}, unknown: { NYT: 0, WSJ: 0 }, total: 0, filled: 0 };

for (const feed of FEEDS) {
  for (const month of monthsFrom(`idx:${feed.id}`)) {
    const key = `hist:${feed.id}:${month}`;
    let cur = { items: [] };
    try { cur = JSON.parse(wr(["kv", "key", "get", key, "--namespace-id", NS, "--text"]).trim() || '{"items":[]}'); }
    catch (e) {
      if (!/not found|404/i.test(String(e.stderr || e.message))) throw e;
    }
    const prevSec = new Map((cur.items || []).map((i) => [i.id || i.link, i.section || ""]));
    const before = [...prevSec.values()].filter(Boolean).length;
    const items = applyCatalog(cur.items || [], catalogs);
    const after = items.filter((i) => i && i.section).length;
    const relabeled = items.filter((it) => (it.section || "") !== (prevSec.get(it.id || it.link) || "")).length;
    counts.total += items.length;
    counts.filled += after;
    counts.unknown[feed.paper] += items.length - after;
    for (const it of items) {
      const sec = it.section || "(none)";
      counts[feed.paper][sec] = (counts[feed.paper][sec] || 0) + 1;
    }
    console.log(`${key}: ${items.length} items, ${before} had a section, ${after} after match, ${relabeled} changed`);
    if (write && relabeled) {
      const out = `/tmp/news-${feed.id}-${month}.json`;
      writeFileSync(out, JSON.stringify({ updated: new Date().toISOString(), items }));
      wr(["kv", "key", "put", key, "--path", out, "--namespace-id", NS]);
      console.log("  wrote", key);
    }
  }
}

console.log("\nNYT", counts.NYT);
console.log("WSJ", counts.WSJ);
console.log("unknown", counts.unknown, "filled", counts.filled, "of", counts.total);
if (!write) console.log("dry run; pass --write to update KV");
