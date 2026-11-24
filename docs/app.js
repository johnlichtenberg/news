import { combineFeeds, filterItems, filterByQuery, mergeSearchHits, dayLabel, clockET, feedLists, nextOlderMonth, monthLabel, sectionsFor, isKnownSection, resolveSection, canonicalSection } from "./lib.js";

const RELAY = "https://news-feeds-relay.johnlichtenberg.workers.dev";
const LIB_PREFIX = "https://library.access.arlingtonva.us/login?url=https://www.proquest.com/docview/";
const LIB_SUFFIX = "?accountid=57895";
const libraryLink = (id) => LIB_PREFIX + id + LIB_SUFFIX;
const goLink = (id) => RELAY + "/go?id=" + encodeURIComponent(id);
// Prefer the Worker sign-in bounce; fall back to the plain library docview URL when the id is missing.
const articleHref = (it) => {
  const id = it && (it.doc || it.id);
  return id && /^\d{3,15}$/.test(id) ? goLink(id) : (it && it.link) || libraryLink(id || "");
};
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// results: feed id -> latest /feed/<id> response (this month + last month).
// extra: feed id -> Map(month -> items) for months fetched with "Load older" (or all months, when searching).
const state = { results: new Map(), extra: new Map(), items: [], paper: "All", section: "All", q: "", hits: [], notice: "",
  loading: false, loadingOlder: false, loadingAllOlder: false, searching: false,
  loadedAt: 0, failed: [], total: 0 };

function recompute() { state.items = combineFeeds(feedLists([...state.results.values()], state.extra)); }
const olderMonth = () => nextOlderMonth([...state.results.values()], state.extra);

async function loadMonth(month) {
  await Promise.all([...state.results.values()].filter((res) => (res.older || []).includes(month)).map(async (res) => {
    const r = await getJSON(`/feed/${encodeURIComponent(res.id)}/${month}`, false);
    if (!state.extra.has(res.id)) state.extra.set(res.id, new Map());
    state.extra.get(res.id).set(month, r.items || []);
  }));
}

async function loadOlder() {
  const month = olderMonth();
  if (!month || state.loadingOlder || state.loadingAllOlder) return;
  state.loadingOlder = true; render();
  try {
    await loadMonth(month);
  } catch (e) {
    state.failed = ["older articles (" + e.message + ")"];
  } finally {
    state.loadingOlder = false; recompute(); render();
  }
}

// History is small: when a search is active, load every remaining month so headlines are searchable.
async function loadAllOlder() {
  if (state.loadingAllOlder || !olderMonth()) return;
  state.loadingAllOlder = true; render();
  try {
    while (olderMonth()) {
      await loadMonth(olderMonth());
      recompute(); render();
    }
  } catch (e) {
    state.failed = ["older articles (" + e.message + ")"];
  } finally {
    state.loadingAllOlder = false; recompute(); render();
  }
}

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const p = h.get("paper"), s = h.get("section");
  state.paper = p === "NYT" || p === "WSJ" ? p : "All";
  state.section = s && isKnownSection(s) ? (canonicalSection(s, state.paper) || "All") : "All";
}
function writeHash() {
  const h = new URLSearchParams();
  if (state.paper !== "All") h.set("paper", state.paper);
  if (state.section !== "All") h.set("section", state.section);
  const next = h.toString() ? "#" + h.toString() : location.pathname + location.search;
  history.replaceState(null, "", next);
}

function card(it, now) {
  const a = el("article", "story " + it.paper.toLowerCase());
  const meta = el("div", "meta");
  meta.append(el("span", "paper", it.paper));
  if (it.date) { const t = el("time", "when", dayLabel(it.date, now)); t.dateTime = it.date; meta.append(t); }
  if (it.section) meta.append(el("span", "section", it.section));
  const h = el("h2");
  const link = el("a", null, it.title);
  link.href = articleHref(it); link.target = "_blank"; link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.title = "Open in ProQuest (Arlington library sign-in)";
  h.append(link);
  a.append(meta, h);
  if (it.snippet) a.append(el("p", "snippet", it.snippet));
  return a;
}

function visibleList() {
  const q = (state.q || "").trim();
  let list = filterItems(state.items, state.paper, state.section);
  if (q) list = filterByQuery(list, q);
  if (q.length >= 3) list = mergeSearchHits(list, state.hits, state.paper, libraryLink, state.section);
  return list;
}

function renderSectionTabs() {
  const nav = $("#sections");
  if (!nav) return;
  const tabs = sectionsFor(state.items, state.paper);
  if (state.section !== "All" && !tabs.includes(state.section)) {
    state.section = "All";
    writeHash();
  }
  nav.hidden = tabs.length === 0;
  const labels = ["All", ...tabs];
  const have = [...nav.querySelectorAll("button")].map((b) => b.dataset.section);
  if (have.join("|") !== labels.join("|")) {
    nav.replaceChildren(...labels.map((name) => {
      const b = el("button");
      b.type = "button";
      b.dataset.section = name;
      b.textContent = name;
      return b;
    }));
  }
  for (const b of nav.querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.section === state.section));
  }
  const on = nav.querySelector('button[aria-pressed="true"]');
  if (on && typeof on.scrollIntoView === "function") {
    try { on.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "instant" }); } catch { /* ignore */ }
  }
}

function render() {
  for (const b of document.querySelectorAll("#papers button")) b.setAttribute("aria-pressed", String(b.dataset.paper === state.paper));
  renderSectionTabs();
  const now = Date.now();
  const q = (state.q || "").trim();
  const list = visibleList();
  const box = $("#list");
  box.replaceChildren(...list.map((it) => card(it, now)));
  const empty = $("#empty");
  empty.hidden = list.length > 0 || state.loading;
  empty.textContent = q ? "No matching articles." : "No articles right now.";
  $("#count").textContent = list.length ? `${list.length} ${q ? "match" + (list.length === 1 ? "" : "es") : "article" + (list.length === 1 ? "" : "s")}` : "";
  const older = olderMonth(), btn = $("#older");
  btn.hidden = !older || state.loading || !!q;
  btn.disabled = state.loadingOlder || state.loadingAllOlder;
  btn.textContent = state.loadingOlder ? "Loading\u2026" : older ? `Load older (${monthLabel(older)})` : "";
  const s = $("#status");
  if (state.loading) s.textContent = `Loading feeds\u2026 ${state.results.size}/${state.total || "?"}`;
  else if (state.loadingAllOlder) s.textContent = "Loading older months for search\u2026";
  else if (state.searching) s.textContent = "Searching full text\u2026";
  else if (state.notice) s.textContent = state.notice;
  else if (state.loadedAt) s.textContent = `Updated ${clockET(state.loadedAt)}` + (state.failed.length ? ` \u00b7 couldn't load: ${state.failed.join(", ")}` : "");
  else s.textContent = "";
}

async function getJSON(path, fresh, signal) {
  const r = await fetch(RELAY + path, { cache: fresh ? "no-cache" : "default", mode: "cors", credentials: "omit", signal });
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
    if ((state.q || "").trim()) loadAllOlder();
  } catch (e) {
    state.failed = ["feeds (" + e.message + ")"];
  } finally {
    state.loading = false; btn.disabled = false; btn.classList.remove("spin");
    recompute();
    render();
  }
}

let searchAbort = null, searchGen = 0;
function onQueryInput() {
  state.q = $("#q").value;
  const q = state.q.trim();
  // Typing filters saved headlines only. Full-text results from an earlier query no longer apply.
  if (q !== state.hitsQ) { state.hits = []; state.notice = ""; state.searching = false; searchGen++; if (searchAbort) searchAbort.abort(); }
  render();
  if (q) loadAllOlder();
}

// Full-text (relay) search runs only when the keyboard's Search / Enter key is pressed.
function submitSearch(e) {
  if (e) e.preventDefault();
  const q = ($("#q").value || "").trim();
  state.q = $("#q").value;
  if (q.length < 3) return;
  $("#q").blur();
  remoteSearch(q);
}

async function remoteSearch(q) {
  if (searchAbort) searchAbort.abort();
  const ac = new AbortController();
  searchAbort = ac;
  const gen = ++searchGen;
  state.searching = true; render();
  try {
    const j = await getJSON("/search?q=" + encodeURIComponent(q), true, ac.signal);
    if (gen !== searchGen || state.q.trim() !== q) return;
    state.hits = Array.isArray(j.items) ? j.items : [];
    state.hitsQ = q;
    state.notice = typeof j.notice === "string" ? j.notice : "";
    if (/\bbusy\b/i.test(state.notice)) {
      await new Promise((r) => setTimeout(r, 3000));
      if (gen !== searchGen || state.q.trim() !== q) return;
      const j2 = await getJSON("/search?q=" + encodeURIComponent(q), true, ac.signal);
      if (gen !== searchGen || state.q.trim() !== q) return;
      state.hits = Array.isArray(j2.items) ? j2.items : [];
      state.notice = typeof j2.notice === "string" ? j2.notice : "";
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    if (gen !== searchGen) return;
    // Headline matches stay; body-text hits are skipped when the relay fails.
  } finally {
    if (gen === searchGen) state.searching = false;
    render();
  }
}

function init() {
  readHash();
  $("#papers").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-paper]"); if (!b) return;
    const next = b.dataset.paper;
    state.section = resolveSection(state.section, state.paper, next);
    state.paper = next;
    writeHash(); render(); scrollTo(0, 0);
  });
  $("#sections").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-section]"); if (!b) return;
    state.section = b.dataset.section; writeHash(); render(); scrollTo(0, 0);
  });
  $("#q").addEventListener("input", onQueryInput);
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") submitSearch(e); });
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
