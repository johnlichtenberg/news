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
  if (paper === "WSJ" && t.includes(" --- ")) t = t.slice(0, t.indexOf(" --- ")).trim(); // print-edition deck
  if (paper === "NYT" && t.includes(": [")) t = t.slice(0, t.indexOf(": [")).trim();
  if (t.length > 300) t = t.slice(0, 299).replace(/\s+\S*$/, "") + "\u2026";
  return t;
}

// Print-edition rows (4-column format) often repeat an Online story under another docview id. A print row is
// dropped when its match key equals an Online row's key for the same paper; print-only rows are kept.
const PRINT = /late edition|eastern edition/i, ONLINE = /\(online\)/i;
const SECTION = /^(?:(?:u\.s\.|world|business|tech|politics|personal) news|markets|business & finance|business|tech|technology|politics|opinion|commentary|review & outlook|life & arts|arts in review|heard on the street|personal journal|family & tech|breaking news|the world|the morning|well|quote of the day)(?:\s*--\s*[^:]{1,40})?:\s+/i;
export function matchKey(paper, raw) {
  let t = cleanTitle(paper, raw);
  for (let i = 0; i < 2 && SECTION.test(t); i++) t = t.replace(SECTION, "");
  return t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const byPaper = { NYT: [], WSJ: [] };
let bad = 0, spanish = 0, printDups = 0;
const spanishRows = [], dupRows = [];
export function parseLine(line) {
  const parts = line.trim().split("|");
  if (parts.length < 3 || !/^(NYT|WSJ)$/.test(parts[0]) || !/^\d{3,15}$/.test(parts[1])) return null;
  // 3 columns: PAPER|ID|TITLE. 4+ columns: PAPER|ID|SOURCE|TITLE (a "|" inside the title is kept).
  const four = parts.length >= 4;
  return { paper: parts[0], id: parts[1], source: four ? parts[2] : "", raw: (four ? parts.slice(3) : parts.slice(2)).join("|") };
}
const rows = [];
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const row = parseLine(line);
  if (!row) { bad++; continue; }
  row.title = cleanTitle(row.paper, row.raw);
  if (!row.title) { bad++; continue; }
  row.key = matchKey(row.paper, row.raw);
  rows.push(row);
}
const onlineKeys = new Set(rows.filter((r) => ONLINE.test(r.source)).map((r) => r.paper + "|" + r.key));
for (const row of rows) {
  if (isSpanishSource(row.source) || (row.paper === "NYT" && isSpanishTitle(row.title))) { spanish++; spanishRows.push(row); continue; }
  if (PRINT.test(row.source) && row.key && onlineKeys.has(row.paper + "|" + row.key)) { printDups++; dupRows.push(row); continue; }
  byPaper[row.paper].push({ paper: row.paper, title: row.title, date, link: `${LIBRARY_LOGIN}https://www.proquest.com/docview/${row.id}?accountid=${PROQUEST_ACCOUNT}`, id: row.id, seen });
}
const bySrc = (list) => list.reduce((a, r) => ((a[r.paper + " " + r.source] = (a[r.paper + " " + r.source] || 0) + 1), a), {});
console.log("print duplicates dropped:", printDups, JSON.stringify(bySrc(dupRows)));
console.log("Spanish dropped:", spanish, JSON.stringify(bySrc(spanishRows)));
if (process.env.VERBOSE) { for (const r of spanishRows) console.log("  es:", r.id, r.source, "|", r.title); for (const r of dupRows) console.log("  dup:", r.paper, r.id, "|", r.title); }

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
