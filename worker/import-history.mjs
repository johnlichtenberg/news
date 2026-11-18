// One-off import of a day's ProQuest headlines into the News KV history.
//   node import-history.mjs <lines.txt> <YYYY-MM-DD> [--write]
// Input lines: "NYT|<docview id>|<headline>" or "WSJ|<docview id>|<headline>" (other lines ignored).
// Stores headline, paper, date and the library docview link only. Existing items are never overwritten.
// Without --write it is a dry run. With --write it does one `wrangler kv key put` per month key.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { plainText } from "./parse.js";
import { LIBRARY_LOGIN, PROQUEST_ACCOUNT } from "./feeds.js";

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
let bad = 0;
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = /^(NYT|WSJ)\|(\d{3,15})\|(.+)$/.exec(line.trim());
  if (!m) { if (line.trim()) bad++; continue; }
  const title = cleanTitle(m[1], m[3]);
  if (!title) { bad++; continue; }
  byPaper[m[1]].push({ paper: m[1], title, date, link: `${LIBRARY_LOGIN}https://www.proquest.com/docview/${m[2]}?accountid=${PROQUEST_ACCOUNT}`, id: m[2], seen });
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
if (bad) console.log(`ignored ${bad} malformed line(s)`);
