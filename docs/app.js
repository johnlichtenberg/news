import { mergeItems, filterItems, sectionsFor, sectionLabel, relTime, etTime, etDay, libraryLink, publisherLabel } from "./lib.js";

const RELAY = "https://news-feeds-relay.johnlichtenberg.workers.dev";
const PAGE = 120;
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const state = { results: new Map(), items: [], paper: "All", section: "All", shown: PAGE, loading: false, loadedAt: 0, failed: [], total: 0 };

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.paper = ["NYT", "WSJ"].includes(p.get("paper")) ? p.get("paper") : "All";
  state.section = p.get("section") || "All";
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.paper !== "All") p.set("paper", state.paper);
  if (state.section !== "All") p.set("section", state.section);
  const h = p.toString();
  history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
}

function renderTabs() {
  for (const b of document.querySelectorAll("#papers button")) b.setAttribute("aria-pressed", String(b.dataset.paper === state.paper));
  const box = $("#sections");
  const secs = sectionsFor(state.items, state.paper);
  if (state.section !== "All" && !secs.includes(state.section) && state.items.length && !state.loading) state.section = "All";
  box.replaceChildren(...["All", ...secs].map((s) => {
    const b = el("button", "chip", s === "All" ? "All sections" : s);
    b.type = "button"; b.dataset.section = s; b.setAttribute("aria-pressed", String(s === state.section));
    return b;
  }));
  // Keep the selected chip visible in the horizontally scrolling row (phones).
  const on = box.querySelector('[aria-pressed="true"]');
  if (on && box.scrollWidth > box.clientWidth) {
    const l = on.offsetLeft - box.offsetLeft, r = l + on.offsetWidth;
    if (l < box.scrollLeft || r > box.scrollLeft + box.clientWidth) box.scrollLeft = Math.max(0, l - 24);
  }
}

function card(it, now) {
  const a = el("article", "story " + it.paper.toLowerCase());
  const meta = el("div", "meta");
  meta.append(el("span", "paper", it.paper));
  const sec = sectionLabel(it);
  if (sec) meta.append(el("span", "sec", sec));
  if (Number.isFinite(it.time) && it.dateOnly) {
    const t = el("time", "when", etDay(it.time, now));
    t.dateTime = new Date(it.time).toISOString().slice(0, 10);
    meta.append(t);
  } else if (Number.isFinite(it.time)) {
    const t = el("time", "when", relTime(it.time, now));
    t.dateTime = new Date(it.time).toISOString();
    t.title = etTime(it.time, now);
    meta.append(t, el("span", "clock", etTime(it.time, now)));
  }
  const h = el("h2");
  const link = el("a", "pq", it.title);
  link.href = it.pqLink || libraryLink(it.paper, it.title) || it.link;
  link.target = "_blank"; link.rel = "noopener noreferrer";
  if (!it.pqLink) link.dataset.title = it.title; // exact ProQuest article: nothing to paste
  link.title = it.pqLink ? "Open this article in ProQuest (Arlington library sign-in)" : "Search ProQuest for this headline (Arlington library sign-in)";
  h.append(link);
  a.append(meta, h);
  if (it.description) a.append(el("p", "desc", it.description));
  const foot = el("div", "links");
  foot.append(el("span", "via", it.pqLink ? "Library \u00b7 ProQuest article" : "Library \u00b7 ProQuest search"));
  if (it.link) {
    const pub = el("a", "pub", publisherLabel(it.paper) + " \u2197");
    pub.href = it.link; pub.target = "_blank"; pub.rel = "noopener noreferrer";
    foot.append(pub);
  }
  a.append(foot);
  return a;
}

function renderList() {
  const now = Date.now();
  const list = filterItems(state.items, state);
  const box = $("#list");
  box.replaceChildren(...list.slice(0, state.shown).map((it) => card(it, now)));
  const more = $("#more");
  more.hidden = list.length <= state.shown;
  more.textContent = `Show more (${list.length - state.shown} left)`;
  $("#empty").hidden = list.length > 0 || state.loading;
  $("#count").textContent = list.length ? `${list.length} stories` : "";
}

function renderStatus() {
  const s = $("#status");
  const done = state.results.size;
  if (state.loading) { s.textContent = `Loading feeds\u2026 ${done}/${state.total || "?"}`; return; }
  if (!state.loadedAt) { s.textContent = ""; return; }
  let t = `Updated ${etTime(state.loadedAt, state.loadedAt)} (${relTime(state.loadedAt)})`;
  if (state.failed.length) t += ` \u00b7 couldn't load: ${state.failed.join(", ")}`;
  s.textContent = t;
}

function render() { renderTabs(); renderList(); renderStatus(); }

let raf = 0;
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; state.items = mergeItems([...state.results.values()]); render(); }); };

async function getJSON(path, fresh) {
  const r = await fetch(RELAY + path, { cache: fresh ? "no-cache" : "default", mode: "cors", credentials: "omit" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function load(fresh = false) {
  if (state.loading) return;
  state.loading = true; state.failed = [];
  const btn = $("#refresh"); btn.disabled = true; btn.classList.add("spin");
  const next = new Map();
  try {
    const { feeds } = await getJSON("/feeds", false);
    state.total = feeds.length;
    renderStatus();
    await Promise.all(feeds.map(async (f) => {
      let res;
      try { res = await getJSON("/feed/" + encodeURIComponent(f.id), fresh); } catch (e) { res = { ...f, ok: false, items: [] }; }
      if (!res.ok) {
        state.failed.push(`${f.paper} ${f.section}`);
        const old = state.results.get(f.id); if (old) res = old; // keep what we had
      }
      next.set(f.id, res);
      state.results.set(f.id, res);
      schedule();
    }));
    state.loadedAt = Date.now();
  } catch (e) {
    state.failed = ["all feeds (" + e.message + ")"];
  } finally {
    state.loading = false; btn.disabled = false; btn.classList.remove("spin");
    for (const k of [...state.results.keys()]) if (!next.has(k) && next.size) state.results.delete(k);
    state.items = mergeItems([...state.results.values()]);
    render();
  }
}

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function init() {
  readHash();
  $("#papers").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-paper]"); if (!b) return;
    state.paper = b.dataset.paper; state.section = "All"; state.shown = PAGE; writeHash(); render(); scrollTo(0, 0);
  });
  $("#sections").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-section]"); if (!b) return;
    state.section = b.dataset.section; state.shown = PAGE; writeHash(); render(); scrollTo(0, 0);
  });
  // Tapping a headline also copies it, so it can be pasted into ProQuest's search box
  // if ProQuest doesn't pre-fill the search (e.g. after signing in).
  $("#list").addEventListener("click", (e) => {
    const a = e.target.closest("a.pq"); if (!a) return;
    const t = a.dataset.title; // only set for search links, not exact ProQuest articles
    if (t && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(() => toast("Headline copied \u2014 paste it into ProQuest search if needed"), () => {});
    }
  });
  $("#more").addEventListener("click", () => { state.shown += PAGE; renderList(); });
  $("#refresh").addEventListener("click", () => load(true));
  addEventListener("hashchange", () => { readHash(); state.shown = PAGE; render(); });
  // Coming back to the tab after a while: refresh, and keep relative times current.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - state.loadedAt > 5 * 60 * 1000) load(true); else render();
  });
  setInterval(() => { if (document.visibilityState === "visible" && !state.loading) { renderList(); renderStatus(); } }, 60 * 1000);
  render();
  load(false);
}

init();
