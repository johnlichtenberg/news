// Permanent history of ProQuest alert items in Workers KV, sharded by month so no value gets near KV's 25 MB limit.
//   hist:<feed id>:<YYYY-MM>  -> { updated, items: [{ paper, title, date, ts?, section?, link, id, seen }] }
//   idx:<feed id>             -> { updated, months: ["2026-11", "2026-10", ...] }   (newest first)
// An item lives in the shard of the month (ET) it was first seen, so each refresh writes only the current
// month's shard (and the index once, when a new month starts), and only when something changed.
// id is the docview id; seen is when the item was first stored. Nothing is ever pruned.

const etDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const monthOf = (now) => etDayFmt.format(now).slice(0, 7);
export const prevMonth = (m) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
export const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || "");
export const docviewId = (link) => (/\/docview\/(\d+)/.exec(link || "") || [])[1] || "";

const shardKey = (feedId, month) => `hist:${feedId}:${month}`;
const indexKey = (feedId) => `idx:${feedId}`;

// Merge the live batch into the current month's shard. Items already stored in `older` (e.g. last month's
// shard) are not duplicated. Order: the live batch in the feed's own order, then the shard's older items.
export function mergeShard(shard, fresh, older = [], now = Date.now()) {
  const skip = new Set((older || []).map((i) => i.id));
  const prev = new Map((shard || []).map((it) => [it.id, it]));
  const out = [], seen = new Set();
  for (const it of fresh || []) {
    const id = docviewId(it.link);
    if (!id || seen.has(id) || (skip.has(id) && !prev.has(id))) continue;
    seen.add(id);
    const old = prev.get(id);
    const ts = it.ts || (old && old.ts) || null; // filled from the live feed when it has a time; never invented
    const section = it.section || (old && old.section) || "";
    out.push({ paper: it.paper, title: it.title, date: it.date || (old && old.date) || null, ...(ts ? { ts } : {}),
      ...(section ? { section } : {}), link: it.link, id, seen: (old && old.seen) || now });
  }
  for (const it of shard || []) {
    if (!it || !it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

const sig = (items) => JSON.stringify((items || []).map((i) => [i.id, i.title, i.date, i.ts || null, i.section || ""]));
export const changed = (a, b) => sig(a) !== sig(b);

async function getJSON(kv, key) {
  if (!kv) return null;
  try { return await kv.get(key, "json"); } catch { return null; }
}

export async function readShard(kv, feedId, month) {
  const v = await getJSON(kv, shardKey(feedId, month));
  return v && Array.isArray(v.items) ? v.items : [];
}

export async function readIndex(kv, feedId) {
  const v = await getJSON(kv, indexKey(feedId));
  return v && Array.isArray(v.months) ? v.months.filter(isMonth) : [];
}

// Merge a live batch into storage. `keep` drops items that must never be stored (e.g. NYT en Español); stored
// items it rejects are removed from the current month's shard on the next write. Returns { months, current, previous, writes }.
export async function storeBatch(kv, feedId, fresh, now = Date.now(), keep = () => true) {
  const month = monthOf(now), before = prevMonth(month);
  const [months, shard, prevShard] = await Promise.all([readIndex(kv, feedId), readShard(kv, feedId, month), readShard(kv, feedId, before)]);
  const previous = prevShard.filter(keep);
  const current = (fresh ? mergeShard(shard, fresh.filter(keep), prevShard, now) : shard).filter(keep);
  let writes = 0;
  if (kv && (fresh || current.length !== shard.length) && changed(shard, current)) {
    await kv.put(shardKey(feedId, month), JSON.stringify({ updated: new Date(now).toISOString(), items: current }));
    writes++;
  }
  let allMonths = months;
  if (kv && current.length && !months.includes(month)) {
    allMonths = [...new Set([month, ...months])].sort().reverse();
    await kv.put(indexKey(feedId), JSON.stringify({ updated: new Date(now).toISOString(), months: allMonths }));
    writes++;
  }
  return { months: allMonths, month, current, previousMonth: before, previous, writes };
}

// Rewrite one stored month without the items `keep` rejects. Returns how many were removed.
export async function purgeShard(kv, feedId, month, keep, now = Date.now()) {
  const items = await readShard(kv, feedId, month);
  const kept = items.filter(keep);
  if (kept.length !== items.length) {
    await kv.put(`hist:${feedId}:${month}`, JSON.stringify({ updated: new Date(now).toISOString(), items: kept }));
  }
  return items.length - kept.length;
}
