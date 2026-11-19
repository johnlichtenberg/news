import { combineFeeds, filterItems, dayLabel, clockET, feedLists, nextOlderMonth, monthLabel } from "./lib.js";

const RELAY = "https://news-feeds-relay.johnlichtenberg.workers.dev";
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// results: feed id -> latest /feed/<id> response (this month + last month).
// extra: feed id -> Map(month -> items) for months fetched with "Load older".
const state = { results: new Map(), extra: new Map(), items: [], paper: "All", loading: false, loadingOlder: false,
  loadedAt: 0, failed: [], total: 0 };

function recompute() { state.items = combineFeeds(feedLists([...state.results.values()], state.extra)); }
const olderMonth = () => nextOlderMonth([...state.results.values()], state.extra);

async function loadOlder() {
  const month = olderMonth();
  if (!month || state.loadingOlder) return;
  state.loadingOlder = true; render();
  try {
    await Promise.all([...state.results.values()].filter((res) => (res.older || []).includes(month)).map(async (res) => {
      const r = await getJSON(`/feed/${encodeURIComponent(res.id)}/${month}`, false);
      if (!state.extra.has(res.id)) state.extra.set(res.id, new Map());
      state.extra.get(res.id).set(month, r.items || []);
    }));
  } catch (e) {
    state.failed = ["older articles (" + e.message + ")"];
  } finally {
    state.loadingOlder = false; recompute(); render();
  }
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1)).get("paper");
  state.paper = p === "NYT" || p === "WSJ" ? p : "All";
}
function writeHash() {
  history.replaceState(null, "", state.paper === "All" ? location.pathname + location.search : "#paper=" + state.paper);
}

function card(it, now) {
  const a = el("article", "story " + it.paper.toLowerCase());
  const meta = el("div", "meta");
  meta.append(el("span", "paper", it.paper));
  if (it.date) { const t = el("time", "when", dayLabel(it.date, now)); t.dateTime = it.date; meta.append(t); }
  if (it.ts != null) { const t = el("time", "clock", clockET(it.ts)); t.dateTime = new Date(it.ts).toISOString(); meta.append(t); }
  const h = el("h2");
  const link = el("a", null, it.title);
  link.href = it.link; link.target = "_blank"; link.rel = "noopener noreferrer";
  link.title = "Open in ProQuest (Arlington library sign-in)";
  h.append(link);
  a.append(meta, h);
  return a;
}

function render() {
  for (const b of document.querySelectorAll("#papers button")) b.setAttribute("aria-pressed", String(b.dataset.paper === state.paper));
  const now = Date.now();
  const list = filterItems(state.items, state.paper);
  const box = $("#list");
  box.replaceChildren(...list.map((it) => card(it, now)));
  $("#empty").hidden = list.length > 0 || state.loading;
  $("#count").textContent = list.length ? `${list.length} articles` : "";
  const older = olderMonth(), btn = $("#older");
  btn.hidden = !older || state.loading;
  btn.disabled = state.loadingOlder;
  btn.textContent = state.loadingOlder ? "Loading\u2026" : older ? `Load older (${monthLabel(older)})` : "";
  const s = $("#status");
  if (state.loading) s.textContent = `Loading feeds\u2026 ${state.results.size}/${state.total || "?"}`;
  else if (state.loadedAt) s.textContent = `Updated ${clockET(state.loadedAt)}` + (state.failed.length ? ` \u00b7 couldn't load: ${state.failed.join(", ")}` : "");
  else s.textContent = "";
}

async function getJSON(path, fresh) {
  const r = await fetch(RELAY + path, { cache: fresh ? "no-cache" : "default", mode: "cors", credentials: "omit" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function load(fresh = false) {
  if (state.loading) return;
  state.loading = true; state.failed = [];
  const btn = $("#refresh"); btn.disabled = true; btn.classList.add("spin");
  try {
    const { feeds } = await getJSON("/feeds", false);
    state.total = feeds.length;
    render();
    await Promise.all(feeds.map(async (f) => {
      let res;
      try { res = await getJSON("/feed/" + encodeURIComponent(f.id), fresh); } catch { res = { ...f, ok: false, items: [] }; }
      if (!res.ok) { state.failed.push(f.paper); const old = state.results.get(f.id); if (old) res = old; }
      state.results.set(f.id, res);
      recompute();
      render();
    }));
    for (const k of [...state.results.keys()]) if (!feeds.some((f) => f.id === k)) state.results.delete(k);
    state.loadedAt = Date.now();
  } catch (e) {
    state.failed = ["feeds (" + e.message + ")"];
  } finally {
    state.loading = false; btn.disabled = false; btn.classList.remove("spin");
    recompute();
    render();
  }
}

function init() {
  readHash();
  $("#papers").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-paper]"); if (!b) return;
    state.paper = b.dataset.paper; writeHash(); render(); scrollTo(0, 0);
  });
  $("#refresh").addEventListener("click", () => load(true));
  $("#older").addEventListener("click", loadOlder);
  addEventListener("hashchange", () => { readHash(); render(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - state.loadedAt > 5 * 60 * 1000) load(true);
  });
  render();
  load(false);
}

init();
