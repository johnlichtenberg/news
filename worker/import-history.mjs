// One-off import of a day's ProQuest headlines into the News KV history.
//   node import-history.mjs <lines.txt> <YYYY-MM-DD> [--write]
// Input lines: "PAPER|<docview id>|<headline>" or "PAPER|<docview id>|<source>|<headline>" (PAPER is NYT or WSJ;
// other lines ignored). NYT en Español rows are skipped: a source containing "Español"/"en Espanol", or (any format)
// a NYT headline the Spanish detector in lang.js flags.
// Stores headline, paper, date and the library docview link only. Existing items are never overwritten.
// Without --write it is a dry run. With --write it does one `wrangler kv key put` per month key.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { plainText } from "./parse.js";
import { LIBRARY_LOGIN, PROQUEST_ACCOUNT } from "./feeds.js";
import { isSpanishTitle, isSpanishSource } from "./lang.js";

const NS = "64d4a2262065442ca10a11f79c670480";
const FEED = { NYT: "nyt-proquest", WSJ: "wsj-proquest" };
const [file, date, flag] = process.argv.slice(2);
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) { console.error("usage: node import-history.mjs <lines.txt> <YYYY-MM-DD> [--write]"); process.exit(2); }
const month = date.slice(0, 7);
const seen = Date.parse(date + "T12:00:00-05:00");

export function cleanTitle(paper, raw) {
  let t = plainText(raw, 600).replace(/^ProQuest:\s*/i, "");
  if (paper === "WSJ" && t.includes("; ")) t = t.slice(0, t.indexOf("; ")).trim();
  if (paper === "NYT" && t.includes(": [")) t = t.slice(0, t.indexOf(": [")).trim();
  if (t.length > 300) t = t.slice(0, 299).replace(/\s+\S*$/, "") + "\u2026";
  return t;
}

const byPaper = { NYT: [], WSJ: [] };
let bad = 0, spanish = 0;
export function parseLine(line) {
  const parts = line.trim().split("|");
  if (parts.length < 3 || !/^(NYT|WSJ)$/.test(parts[0]) || !/^\d{3,15}$/.test(parts[1])) return null;
  // 3 columns: PAPER|ID|TITLE. 4+ columns: PAPER|ID|SOURCE|TITLE (a "|" inside the title is kept).
  const four = parts.length >= 4;
  return { paper: parts[0], id: parts[1], source: four ? parts[2] : "", raw: (four ? parts.slice(3) : parts.slice(2)).join("|") };
}
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const row = parseLine(line);
  if (!row) { bad++; continue; }
  const title = cleanTitle(row.paper, row.raw);
  if (!title) { bad++; continue; }
  if (isSpanishSource(row.source) || (row.paper === "NYT" && isSpanishTitle(title))) { spanish++; continue; }
  byPaper[row.paper].push({ paper: row.paper, title, date, link: `${LIBRARY_LOGIN}https://www.proquest.com/docview/${row.id}?accountid=${PROQUEST_ACCOUNT}`, id: row.id, seen });
}

const wr = (args) => execFileSync("npx", ["-y", "wrangler@3", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
for (const paper of ["NYT", "WSJ"]) {
  const key = `hist:${FEED[paper]}:${month}`;
  let cur = { items: [] };
  try { cur = JSON.parse(wr(["kv", "key", "get", key, "--namespace-id", NS, "--text"]).trim() || '{"items":[]}'); } catch (e) {
    if (!/not found|404/i.test(String(e.stderr || e.message))) throw e;
  }
  const items = Array.isArray(cur.items) ? cur.items : [];
  const have = new Set(items.map((i) => i.id));
  const add = [];
  for (const it of byPaper[paper]) if (!have.has(it.id)) { have.add(it.id); add.push(it); }
  console.log(`${key}: stored ${items.length}, input ${byPaper[paper].length}, new ${add.length}, total ${items.length + add.length}`);
  if (flag === "--write" && add.length) {
    const out = `/tmp/${FEED[paper]}-${month}.json`;
    writeFileSync(out, JSON.stringify({ updated: new Date().toISOString(), items: [...items, ...add] }));
    wr(["kv", "key", "put", key, "--path", out, "--namespace-id", NS]);
    console.log(`  wrote ${key}`);
  }
}
if (spanish) console.log(`skipped ${spanish} NYT en Español row(s)`);
if (bad) console.log(`ignored ${bad} malformed line(s)`);
