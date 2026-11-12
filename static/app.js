// taskwise - groups of boards (columns) with sections and notes, plus a table
// view, over one board.json (see main.py).
//
// Each group and each board can be:
//   collapsed   - stays in place, folded to a narrow strip
//   hidden      - off the board view, but its notes still show in the table,
//                 search and due filters
//   hibernating - put to sleep: gone from everything (board, table, search,
//                 filters, counts) until you wake it from the sidebar
"use strict";

const PALETTE = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#64748b", "#84cc16", "#f97316"];
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const nowSec = () => Math.floor(Date.now() / 1000);

// small line icons (stroke = currentColor), so nothing depends on emoji fonts
const svg = (d, w = 16) => `<svg class="ic" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  plusSm: svg('<path d="M12 5v14M5 12h14"/>', 14),
  more: svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>', 14),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', 14),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>', 14),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', 14),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 12),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 12),
  link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>', 12),
  grip: svg('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>', 14),
  bookmark: svg('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>', 13),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 14),
  eyeOff: svg('<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M2 2l20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 14),
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>', 14),
  file: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>', 14),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 14),
  fold: svg('<path d="M4 12h6m0 0-3-3m3 3-3 3M20 12h-6m0 0 3-3m-3 3 3 3"/>', 14),
  unfold: svg('<path d="M10 12H3m0 0 3-3m-3 3 3 3M14 12h7m0 0-3-3m3 3-3 3"/>', 14),
};

let ws = { groups: [], boards: [], notes: [], tags: [] };   // the whole board.json
let rev = null;
let settings = {};
const DEFAULT_UI = { view: "board", q: "", tags: {}, due: "all", board: "", section: "", bookmark: null, sort: { key: "due", dir: 1 }, vopt: {} };
let ui = structuredClone(DEFAULT_UI);

// ---------- server ----------

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function loadBoard() {
  const { status, data } = await api("GET", "/api/board");
  if (status === 409) { location.reload(); return; }   // no folder yet -> setup page
  if (status !== 200) { setStatus(data.error || "can't read board", true); return; }
  ws = data.board;
  rev = data.rev;
  ws.groups ||= []; ws.boards ||= []; ws.notes ||= []; ws.tags ||= [];
  let changed = false;
  // boards from the first version used pastel defaults; swap those for the
  // current palette (colours you picked yourself are left alone)
  const OLD = { "#7dd3fc": "#3b82f6", "#cba6f7": "#8b5cf6", "#a6e3a1": "#10b981", "#f9e2af": "#eab308", "#fab387": "#f97316",
    "#f38ba8": "#ef4444", "#94e2d5": "#06b6d4", "#b4befe": "#6366f1", "#f5c2e7": "#ec4899", "#bac2de": "#64748b" };
  for (const x of [...ws.tags, ...ws.boards, ...ws.groups]) if (OLD[x.color]) { x.color = OLD[x.color]; changed = true; }
  // every board belongs to an existing group
  for (const b of ws.boards) {
    b.sections ||= [];
    for (const f of bmFolders(b)) if (f.parentId && !bmFolder(b, f.parentId)) { f.parentId = null; changed = true; }
    for (const x of b.bookmarks || []) if (x.folderId && !bmFolder(b, x.folderId)) { x.folderId = null; changed = true; }
    if (!group(b.groupId)) { b.groupId = (ws.groups[0] || newGroup("General")).id; changed = true; }
  }
  for (const n of ws.notes) if (n.sectionId && !section(boardOf(n), n.sectionId)) { n.sectionId = null; changed = true; }
  if (data.board.version !== 2) { ws.version = 2; changed = true; }
  const merged = mergeDuplicateBookmarks();
  if (merged) changed = true;
  if (sinkDone()) changed = true;
  render();
  if (merged) toast(`Merged ${merged} duplicate link${merged === 1 ? "" : "s"} — notes that linked them now share one.`, 7000);
  if (changed) save();
}

let saveTimer = null, saving = false, dirty = false;
function save() {
  sinkDone();
  dirty = true;
  setStatus("unsaved…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 350);
}
async function flush(force = false) {
  clearTimeout(saveTimer);
  if (!dirty && !force) return;
  if (saving) { saveTimer = setTimeout(() => flush(force), 200); return; }
  saving = true;
  dirty = false;
  setStatus("saving…");
  try {
    const { status, data } = await api("PUT", "/api/board", { board: ws, rev, force });
    if (status === 200) { rev = data.rev; setStatus("saved"); }
    else if (status === 409) { dirty = true; $("#conflict").classList.add("show"); setStatus("not saved", true); }
    else { dirty = true; setStatus(data.error || "save failed", true); }
  } catch {
    dirty = true; setStatus("save failed - offline?", true);
  } finally { saving = false; }
}
$("#takeTheirs").onclick = async () => { $("#conflict").classList.remove("show"); dirty = false; await loadBoard(); setStatus("loaded from disk"); };
$("#keepMine").onclick = async () => { $("#conflict").classList.remove("show"); await flush(true); };

// pick up changes made elsewhere (synced folder, another tab) when nothing is pending here
async function checkExternal() {
  if (dirty || saving || $("#conflict").classList.contains("show") || colDrag?.started) return;
  try {
    const { data } = await api("GET", "/api/rev");
    if (data.rev && data.rev !== rev && !dirty && !saving && !$(".overlay")) await loadBoard();
  } catch {}
}
window.addEventListener("focus", checkExternal);
setInterval(checkExternal, 20000);
window.addEventListener("beforeunload", e => { if (dirty) { flush(); e.preventDefault(); } });

function setStatus(text, err = false) {
  const el = $("#status");
  el.textContent = text;
  el.classList.toggle("err", err);
}

let settingsTimer = null;
function saveSettings() {
  settings.ui = { view: ui.view, q: ui.q, tags: ui.tags, due: ui.due, board: ui.board, section: ui.section, sort: ui.sort, vopt: ui.vopt };
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => api("PUT", "/api/settings", settings), 400);
}
function applyLook() {
  document.documentElement.dataset.theme = settings.theme === "light" ? "light" : "dark";
  document.documentElement.style.setProperty("--ui-scale", settings.scale || 1);
  document.documentElement.style.setProperty("--col-min", `${settings.colMin || 280}px`);
  document.body.classList.toggle("sidebar-open", !!settings.sidebar);
}

function toast(html, ms = 5000) {
  const t = $("#toast");
  t.innerHTML = html;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), ms);
  return t;
}

// ---------- lookups and states ----------

const group = id => ws.groups.find(g => g.id === id);
const boardById = id => ws.boards.find(b => b.id === id);
const boardOf = n => boardById(n.boardId);
const section = (b, id) => (b?.sections || []).find(s => s.id === id);
const note = id => ws.notes.find(n => n.id === id);
const tagInfo = name => ws.tags.find(t => t.name === name) || { name, color: "#64748b" };
const boardsIn = g => ws.boards.filter(b => b.groupId === g.id);
function bookmark(id) {
  for (const b of ws.boards) { const x = (b.bookmarks || []).find(x => x.id === id); if (x) return { b: x, board: b }; }
  return null;
}
// one bookmark per address: "https://Example.org/" and "example.org" are the
// same link, so adding it again links the bookmark that's already there
function urlKey(u) {
  if (isLocal(u)) return u.replace(/\/+$/, "/");
  try {
    const x = new URL(u);
    const host = x.hostname.toLowerCase().replace(/^www\./, "");
    const port = x.port && !((x.protocol === "http:" && x.port === "80") || (x.protocol === "https:" && x.port === "443")) ? ":" + x.port : "";
    const path = x.pathname.replace(/\/+$/, "");
    return `${x.protocol === "http:" ? "https:" : x.protocol}//${host}${port}${path}${x.search}${x.hash}`;
  } catch { return (u || "").trim(); }
}
// the bookmark for this address, if there is one: this board's first, then
// any other board's (skip = a bookmark id to leave out, e.g. the one being edited)
function findBookmarkByUrl(url, preferBoard, skip = null) {
  const k = urlKey(url);
  const boards = [preferBoard, ...ws.boards.filter(b => b !== preferBoard)].filter(Boolean);
  for (const b of boards) { const x = (b.bookmarks || []).find(y => y.id !== skip && urlKey(y.url) === k); if (x) return { b: x, board: b }; }
  return null;
}
const bmWhere = f => `${esc(f.board.name)}${f.b.folderId ? " › " + esc(folderPath(f.board, f.b.folderId).join(" › ")) : ""}`;
// add bookmarks to a board, skipping addresses that are bookmarked already;
// returns how many were skipped
function addBookmarks(b, items, folderId = null) {
  b.bookmarks ||= [];
  let skipped = 0;
  for (const it of items) {
    if (findBookmarkByUrl(it.url, b)) { skipped++; continue; }
    b.bookmarks.push({ id: uid(), url: it.url, title: it.title, folderId });
  }
  return skipped;
}
const skippedMsg = n => (n ? ` ${n} already in Links, not added again.` : "");

// merge bookmarks that point to the same address (made before taskwise checked
// for that): keep the first, point every note's link at it. Returns true if
// anything changed.
function mergeDuplicateBookmarks() {
  const keep = new Map(), remap = new Map();
  for (const b of ws.boards) {
    b.bookmarks = (b.bookmarks || []).filter(x => {
      const k = urlKey(x.url);
      const first = keep.get(k);
      if (!first) { keep.set(k, x); return true; }
      remap.set(x.id, first.id);
      return false;
    });
  }
  if (!remap.size) return 0;
  for (const n of ws.notes) if (n.links?.length) n.links = [...new Set(n.links.map(id => remap.get(id) || id))];
  return remap.size;
}

// bookmark folders: b.bmFolders = [{ id, name, parentId, collapsed }] and
// each bookmark's folderId (null = top level); folders can nest
const bmFolders = b => (b.bmFolders ||= []);
const bmFolder = (b, id) => (b.bmFolders || []).find(f => f.id === id);
function folderPath(b, id) {
  const out = [];
  for (let f = bmFolder(b, id), guard = 0; f && guard < 50; f = bmFolder(b, f.parentId), guard++) out.unshift(f.name);
  return out;
}
function folderDescendants(b, id) {
  const set = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of bmFolders(b)) if (f.parentId && set.has(f.parentId) && !set.has(f.id)) { set.add(f.id); grew = true; }
  }
  return set;
}
const bmCountIn = (b, id) => { const set = folderDescendants(b, id); return (b.bookmarks || []).filter(x => set.has(x.folderId)).length; };
const isDone = n => (n.tags || []).includes("done");
// marking a note done also drops the tags that only matter while it's open
const OPEN_ONLY_TAGS = ["urgent", "waiting"];
function markDone(n) {
  n.tags = (n.tags || []).filter(t => !OPEN_ONLY_TAGS.includes(t));
  if (!n.tags.includes("done")) { ensureTags(["done"]); n.tags.push("done"); }
}
const notesLinkedTo = bmId => ws.notes.filter(n => (n.links || []).includes(bmId));
const asleep = b => !b || b.hibernated || group(b.groupId)?.hibernated;
const hiddenB = b => !asleep(b) && (b.hidden || group(b.groupId)?.hidden);
const awakeNotes = () => ws.notes.filter(n => !asleep(boardOf(n)));

function newGroup(name) {
  const g = { id: uid(), name, color: PALETTE[(ws.groups.length + 7) % PALETTE.length] };
  ws.groups.push(g);
  return g;
}
let HOME = "";   // from /api/config, to turn ~/… into a full path
const fileUrl = (path, folder = false) =>
  "file://" + path.replace(/\/+$/, "").split("/").map(encodeURIComponent).join("/") + (folder ? "/" : "");
const isLocal = u => /^file:/i.test(u || "");
const pathOf = u => { try { return decodeURIComponent(new URL(u).pathname); } catch { return u; } };
const isFolderUrl = u => /\/$/.test(u) || !/\.[^/.]{1,8}$/.test(pathOf(u));
const baseName = u => pathOf(u).replace(/\/+$/, "").split("/").pop() || "/";
function safeUrl(u) {
  u = (u || "").trim();
  if (!u) return "";
  if (u.startsWith("~/") && HOME) u = HOME + u.slice(1);
  if (u.startsWith("/")) return fileUrl(u, u.endsWith("/"));
  if (/^(https?|file|mailto|ftp):/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return "";   // javascript: and friends
  return "https://" + u;
}
// the site's icon (fetched and cached by the server, see /api/favicon), with
// the given fallback icon shown when the site has none
const fav = (url, fallback = ICON.bookmark) => isLocal(url)
  ? `<span class="fav none local">${isFolderUrl(url) ? ICON.folder : ICON.file}</span>`
  : `<span class="fav"><img src="/api/favicon?url=${esc(encodeURIComponent(url))}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('none')">${fallback}</span>`;
const hostOf = u => { if (isLocal(u)) return pathOf(u); try { return new URL(u).hostname.replace(/^www\./, "") || u; } catch { return u; } };

// insert note n at the end of (board, section) in the global note order
function placeAtEnd(n) {
  const i = ws.notes.indexOf(n);
  if (i >= 0) ws.notes.splice(i, 1);
  let at = -1;
  ws.notes.forEach((x, j) => { if (x.boardId === n.boardId && (x.sectionId || null) === (n.sectionId || null)) at = j; });
  if (at < 0) ws.notes.forEach((x, j) => { if (x.boardId === n.boardId) at = j; });
  ws.notes.splice(at < 0 ? ws.notes.length : at + 1, 0, n);
}

// insert note n at the top of (board, section) in the global note order
function placeAtStart(n) {
  const i = ws.notes.indexOf(n);
  if (i >= 0) ws.notes.splice(i, 1);
  let at = ws.notes.findIndex(x => x.boardId === n.boardId && (x.sectionId || null) === (n.sectionId || null));
  if (at < 0) at = ws.notes.findIndex(x => x.boardId === n.boardId);
  ws.notes.splice(at < 0 ? ws.notes.length : at, 0, n);
}

// done notes live at the bottom of their section: within each (board, section)
// the open notes come first, each group keeping its order. Done here in the
// saved order, not at render time, so dropping a card next to another still
// lands where it looks like it will. Returns true if anything moved.
function sinkDone() {
  const places = new Map();
  ws.notes.forEach((n, i) => {
    const key = `${n.boardId}|${n.sectionId || ""}`;
    if (!places.has(key)) places.set(key, []);
    places.get(key).push(i);
  });
  let moved = false;
  for (const slots of places.values()) {
    const list = slots.map(i => ws.notes[i]);
    const sorted = [...list.filter(n => !isDone(n)), ...list.filter(isDone)];
    sorted.forEach((n, j) => { if (n !== list[j]) { ws.notes[slots[j]] = n; moved = true; } });
  }
  return moved;
}

// "Call Bob #urgent !next week" -> title, tags, due
function parseQuick(text) {
  let due = null;
  const bang = text.match(/(^|\s)!([^\n#]+)\s*$/);
  if (bang) {
    const d = Due.parse(bang[2]);
    if (d) { due = { ...d, set: Due.todayIso() }; text = text.slice(0, bang.index); }
  }
  const tags = [];
  text = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (m, sp, t) => { tags.push(t.toLowerCase()); return sp; });
  text = text.replace(/[ \t]+$/gm, "").trim();
  const nl = text.indexOf("\n");
  return { title: nl < 0 ? text : text.slice(0, nl).trim(), body: nl < 0 ? "" : text.slice(nl + 1).trim(), tags, due };
}
function ensureTags(names) {
  for (const name of names) {
    if (!ws.tags.some(t => t.name === name)) ws.tags.push({ name, color: PALETTE[ws.tags.length % PALETTE.length] });
  }
}

// ---------- filtering ----------

function matches(n) {
  const b = boardOf(n);
  if (asleep(b)) return false;
  if (ui.board && n.boardId !== ui.board) return false;
  if (ui.section && sectionKey(sectionName(n)) !== ui.section) return false;
  if (ui.bookmark && !(n.links || []).includes(ui.bookmark)) return false;
  if (!Due.inBucket(n.due, ui.due)) return false;
  const tags = n.tags || [];
  for (const [t, mode] of Object.entries(ui.tags)) {
    if (mode === 1 && !tags.includes(t)) return false;
    if (mode === -1 && tags.includes(t)) return false;
  }
  if (ui.q) {
    const words = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
    const linkText = (n.links || []).map(id => { const x = bookmark(id); return x ? x.b.title + " " + x.b.url : ""; }).join(" ");
    const sec = section(b, n.sectionId)?.name || "";
    const hay = `${n.title} ${n.body} ${tags.join(" ")} ${b?.name || ""} ${group(b?.groupId)?.name || ""} ${sec} ${linkText}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) return false;
  }
  return true;
}
// sections with the same name on different boards belong together in filters and sorting
const sectionName = n => section(boardOf(n), n.sectionId)?.name || "General";
const sectionKey = name => name.trim().toLowerCase();
const filtersActive = () => ui.q || ui.due !== "all" || ui.board || ui.section || ui.bookmark || Object.keys(ui.tags).length;

function boardOptions(selected, { includeAll = false, allowAsleep = false } = {}) {
  let html = includeAll ? `<option value="">All boards</option>` : "";
  for (const g of ws.groups) {
    const bs = boardsIn(g).filter(b => allowAsleep || !asleep(b) || b.id === selected);
    if (!bs.length) continue;
    html += `<optgroup label="${esc(g.name)}">` + bs.map(b =>
      `<option value="${b.id}" ${b.id === selected ? "selected" : ""}>${esc(b.name)}${asleep(b) ? " (hibernating)" : hiddenB(b) ? " (hidden)" : ""}</option>`).join("") + `</optgroup>`;
  }
  return html;
}

function renderFilters() {
  $("#search").value = ui.q;
  $("#dueFilter").value = ui.due;
  if (ui.board && (!boardById(ui.board) || asleep(boardById(ui.board)))) ui.board = "";
  $("#boardFilter").innerHTML = boardOptions(ui.board, { includeAll: true });
  $("#boardFilter").value = ui.board;
  // one entry per section name, however many boards have it
  const names = new Map();
  for (const n of awakeNotes()) { const nm = sectionName(n); if (!names.has(sectionKey(nm))) names.set(sectionKey(nm), nm); }
  for (const b of ws.boards) if (!asleep(b)) for (const x of b.sections) if (!names.has(sectionKey(x.name))) names.set(sectionKey(x.name), x.name);
  if (ui.section && !names.has(ui.section)) ui.section = "";
  $("#sectionFilter").innerHTML = `<option value="">All sections</option>` +
    [...names].sort((a, b) => (a[0] === "general" ? -1 : b[0] === "general" ? 1 : a[1].localeCompare(b[1]))).map(([k, nm]) => {
      const boards = new Set(ws.boards.filter(b => !asleep(b) && (k === "general" ? true : b.sections.some(x => sectionKey(x.name) === k))).map(b => b.name));
      return `<option value="${esc(k)}">${esc(nm)}${k !== "general" && boards.size > 1 ? ` (${boards.size} boards)` : ""}</option>`;
    }).join("");
  $("#sectionFilter").value = ui.section;

  const used = new Set(awakeNotes().flatMap(n => n.tags || []));
  $("#tagFilters").innerHTML = ws.tags.filter(t => used.has(t.name) || ui.tags[t.name]).map(t => {
    const mode = ui.tags[t.name];
    const cls = mode === 1 ? "inc" : mode === -1 ? "exc" : "";
    const title = mode === 1 ? "showing only notes with this tag - click to hide them instead" : mode === -1 ? "hiding notes with this tag - click to clear" : "click: only notes with this tag";
    return `<button class="ftag ${cls}" data-tag="${esc(t.name)}" style="--tc:${t.color}" title="${title}"><span class="sw"></span>${esc(t.name)}</button>`;
  }).join("") || `<span class="hint">tags you add to notes show up here as filters</span>`;

  const chips = [];
  if (ui.bookmark) {
    const x = bookmark(ui.bookmark);
    if (x) chips.push(`<span class="fchip">linked to: ${esc(x.b.title)}<button data-clear="bookmark" title="clear">${ICON.x}</button></span>`);
    else ui.bookmark = null;
  }
  $("#activeChips").innerHTML = chips.join("");
  renderCounts();
  $$("#viewSeg button").forEach(b => b.classList.toggle("on", b.dataset.view === ui.view));
}
function renderCounts() {
  const awake = awakeNotes();
  const shown = awake.filter(matches).length;
  $("#count").textContent = filtersActive() ? `${shown} of ${awake.length} notes` : `${awake.length} notes`;
  $("#clearFilters").style.display = filtersActive() ? "" : "none";
  // what's out of sight, so it's never forgotten
  const hidden = ws.boards.filter(hiddenB).length, sleeping = ws.boards.filter(asleep).length;
  const parts = [];
  if (hidden) parts.push(`${ICON.eyeOff}${hidden} hidden`);
  if (sleeping) parts.push(`${ICON.moon}${sleeping} hibernating`);
  const el = $("#outOfSight");
  el.innerHTML = parts.join('<span class="sep"></span>');
  el.style.display = parts.length ? "" : "none";
}

$("#search").addEventListener("input", e => { ui.q = e.target.value; saveSettings(); renderMain(); renderCounts(); });
$("#dueFilter").onchange = e => { ui.due = e.target.value; saveSettings(); render(); };
$("#boardFilter").onchange = e => { ui.board = e.target.value; saveSettings(); render(); };
$("#sectionFilter").onchange = e => { ui.section = e.target.value; saveSettings(); render(); };
$("#tagFilters").onclick = e => {
  const b = e.target.closest(".ftag"); if (!b) return;
  const t = b.dataset.tag, m = ui.tags[t];
  if (!m) ui.tags[t] = 1; else if (m === 1) ui.tags[t] = -1; else delete ui.tags[t];
  saveSettings(); render();
};
$("#activeChips").onclick = e => { if (e.target.closest("[data-clear]")) { ui.bookmark = null; render(); } };
$("#clearFilters").onclick = () => { ui.q = ""; ui.tags = {}; ui.due = "all"; ui.board = ""; ui.section = ""; ui.bookmark = null; saveSettings(); render(); };
$("#viewSeg").onclick = e => { const v = e.target.closest("[data-view]")?.dataset.view; if (v) { ui.view = v; saveSettings(); render(); } };
$("#outOfSight").onclick = () => { settings.sidebar = true; applyLook(); saveSettings(); renderSidebar(); };
$("#sidebarBtn").onclick = () => { settings.sidebar = !settings.sidebar; applyLook(); saveSettings(); renderSidebar(); };

// ---------- local files ----------

async function openLocal(url) {
  try {
    const res = await fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) toast(esc(data.error || "Couldn't open it."), 7000);
  } catch { toast("Taskwise isn't running."); }
}
document.addEventListener("click", e => {
  const a = e.target.closest('a[href^="file:"]');
  if (!a) return;
  e.preventDefault();
  e.stopPropagation();
  openLocal(a.getAttribute("href"));
}, true);

// the desktop's file dialog, shown by the server; returns full paths ([] if cancelled)
async function pickPaths(kind, multiple) {
  try {
    const res = await fetch(`/api/pick?kind=${kind}&multiple=${multiple ? "true" : "false"}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(esc(data.error || "Couldn't show the file dialog."), 8000); return []; }
    return data.paths.map(p => ({ url: fileUrl(p, kind === "folder"), title: p.replace(/\/+$/, "").split("/").pop() || p }));
  } catch { toast("Taskwise isn't running."); return []; }
}

// ---------- render ----------

function render() { renderFilters(); renderSidebar(); renderMain(); }

function renderMain() {
  const main = $("#main");
  main.classList.toggle("table-mode", ui.view === "table");
  main.dataset.view = ui.view;
  if (ui.view === "table") renderTable(main);
  else if (typeof VIEWS !== "undefined" && VIEWS[ui.view]) VIEWS[ui.view].render(main);
  else renderBoard(main);
}

function dueBadge(n) {
  if (!n.due || !n.due.target || isDone(n)) return "";
  const s = Due.status(n.due.target);
  return `<span class="due ${s.cls}" title="${esc(Due.describe(n.due))}">${ICON.clock}${esc(s.label)}</span>`;
}
const tagPills = n => (n.tags || []).map(t => `<span class="pill" style="--tc:${tagInfo(t).color}">${esc(t)}</span>`).join("");
const linkChips = n => (n.links || []).map(id => {
  const x = bookmark(id); if (!x) return "";
  return `<span class="lnk-wrap"><a class="lnk" href="${esc(x.b.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.b.url)}">${fav(x.b.url, ICON.link)}<span>${esc(x.b.title)}</span></a><button class="lnk-more" data-lnk="${id}" data-lnk-note="${n.id}" title="Link menu" draggable="false">${ICON.more}</button></span>`;
}).join("");

// the ⋯ on a note's link: open, edit, copy or take it off the note. Caught
// before the board, card and preview handlers, which would open the note.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
}
document.addEventListener("click", e => {
  const btn = e.target.closest?.(".lnk-more");
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  const n = note(btn.dataset.lnkNote), x = bookmark(btn.dataset.lnk);
  if (!n || !x) return;
  const inView = !!btn.closest(".note-view");
  popMenu(btn, `
    <button data-m="open">${ICON.link} Open</button>
    <button data-m="edit">${ICON.edit} Edit…</button>
    <button data-m="copy">${ICON.copy} Copy address</button>
    <hr><button data-m="remove" class="danger">${ICON.x} Remove from note</button>`, d => {
    switch (d.m) {
      case "open":
        if (isLocal(x.b.url)) openLocal(x.b.url);
        else window.open(x.b.url, "_blank", "noopener,noreferrer");
        break;
      case "edit": editBookmark(x.board, x.b.id); break;
      case "copy": copyText(isLocal(x.b.url) ? pathOf(x.b.url) : x.b.url).then(() => toast("Address copied.")); break;
      case "remove": {
        const snapshot = JSON.stringify(ws);
        n.links = (n.links || []).filter(id => id !== x.b.id); n.updated = nowSec();
        save(); render();
        if (inView) viewNote(n);
        offerUndo(`Removed “${esc(x.b.title)}” from “${esc(n.title || "note")}”. It's still in ${esc(x.board.name)}'s Links.`, snapshot);
        break;
      }
    }
  });
}, true);

function cardHtml(n) {
  return `<div class="card ${isDone(n) ? "is-done" : ""}" draggable="true" data-note="${n.id}">
    <button class="check" data-act="done" title="${isDone(n) ? "not done" : "mark done"}">${ICON.check}</button>
    <div class="title">${esc(n.title || "(untitled)")}</div>
    ${n.body ? `<div class="body">${esc(n.body)}</div>` : ""}
    <div class="meta">${dueBadge(n)}${tagPills(n)}${linkChips(n)}</div>
  </div>`;
}

// a board's bookmarks as a flat list of rows, indented by folder depth:
// at each level its folders first, then its bookmarks
function bmTree(b, parentId, depth) {
  const folders = bmFolders(b).filter(f => (f.parentId || null) === parentId);
  const items = (b.bookmarks || []).filter(x => (x.folderId || null) === parentId);
  let html = "";
  for (const f of folders) {
    html += `<li class="bm-folder ${f.collapsed ? "folded" : ""}" data-folder="${f.id}" data-act="bmf-toggle" draggable="true" style="--d:${depth}" title="drag to move · double-click the name to rename">
      <span class="arrow">${ICON.chevron}</span><span class="fic">${ICON.folder}</span><span class="fname">${esc(f.name)}</span>
      <span class="fn">${bmCountIn(b, f.id)}</span>
      <button class="ghost icon" data-act="bmf-add" title="Add to this folder">${ICON.plusSm}</button>
      <button class="ghost icon" data-act="bmf-menu" title="Folder menu">${ICON.more}</button></li>`;
    if (!f.collapsed) html += bmTree(b, f.id, depth + 1);
  }
  for (const x of items) {
    const c = notesLinkedTo(x.id).length;
    html += `<li data-bm="${x.id}" draggable="true" style="--d:${depth}" class="${ui.bookmark === x.id ? "hl" : ""}">
      <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.url)}">${fav(x.url)}<span>${esc(x.title)}</span></a>
      ${c ? `<button class="lc" data-act="filter-bm" title="show the ${c} note(s) linked to this">${c}</button>` : ""}
      <button class="ghost icon" data-act="edit-bm" title="Edit">${ICON.edit}</button></li>`;
  }
  if (parentId && !folders.length && !items.length) html += `<li class="bm-empty" style="--d:${depth}">Empty folder</li>`;
  return html;
}

let quick = null;

// a board's sections in display order, with null standing for General
function orderedSections(b) {
  const list = [...b.sections];
  list.splice(Math.max(0, Math.min(b.generalPos || 0, list.length)), 0, null);
  return list;
}   // { board, section } where the quick-add box is open

function quickHtml(b) {
  const opts = orderedSections(b).map(x => `<option value="${x ? x.id : ""}" ${(x ? x.id : null) === (quick.section || null) ? "selected" : ""}>${x ? esc(x.name) : "General"}</option>`).join("");
  return `<div class="quick">
    <label class="quick-sec">Section <select data-act="quick-pick">${opts}</select></label>
    <textarea placeholder="Note… (#tag, !next week)  Enter adds · Shift+Enter new line · Esc closes"></textarea>
    <div class="row"><button class="primary" data-act="quick-add">Add note</button><button class="ghost" data-act="quick-close">Cancel</button>
    <span class="hint">#tag · !due</span></div></div>`;
}

function columnHtml(b) {
  const notes = ws.notes.filter(n => n.boardId === b.id);
  const shown = notes.filter(matches);
  const bms = b.bookmarks || [];
  const listFor = secId => shown.filter(n => (n.sectionId || null) === secId);
  const flags = `${b.hidden ? `<span class="flag" title="hidden">${ICON.eyeOff}</span>` : ""}`;
  return `<section class="column ${b.collapsed ? "collapsed" : ""}" data-board="${b.id}" style="--pc:${b.color || "var(--border)"}">
    <div class="col-head" title="drag to move the board · double-click the name to rename">
      <span class="grip">${ICON.grip}</span>
      <span class="dot"></span>
      <h2>${esc(b.name)}</h2>${flags}
      <span class="n">${shown.length === notes.length ? notes.length : `${shown.length}/${notes.length}`}</span>
      <button class="ghost icon" data-act="board-menu" title="Board menu">${ICON.more}</button>
    </div>
    <div class="bookmarks ${b.bookmarksOpen ? "open" : ""}">
      <div class="bm-head" data-act="toggle-bm"><span class="arrow">${ICON.chevron}</span><span class="t">Links</span>${bms.length ? `<span class="n">${bms.length}</span>` : ""}
        <button class="ghost icon" data-act="add-bm" title="Add a link">${ICON.plusSm}</button></div>
      <ul class="bm-list">${bms.length || bmFolders(b).length ? bmTree(b, null, 0) : `<li class="bm-empty">No links yet — add one with +</li>`}</ul>
    </div>
    ${quick && quick.board === b.id ? quickHtml(b) : `<button class="board-add" data-act="board-add" title="Add a note or a section">${ICON.plusSm}</button>`}
    <div class="col-body">
      ${orderedSections(b).map(sec => {
        // General = notes outside any other section; it has a place in the
        // order (b.generalPos) but can't be renamed, deleted or moved away
        const id = sec ? sec.id : null;
        const list = listFor(id);
        const total = notes.filter(n => (n.sectionId || null) === id).length;
        const folded = sec ? sec.collapsed : b.generalCollapsed;
        return `<div class="section ${sec ? "" : "general"} ${folded ? "collapsed" : ""}" data-section="${sec ? sec.id : ""}">
          <div class="sec-head" data-act="toggle-sec" draggable="true" title="${sec ? "" : "Notes that aren't in any other section · "}drag to move the section">
            <span class="arrow">${ICON.chevron}</span><span class="sec-name">${sec ? esc(sec.name) : "General"}</span>
            <span class="n">${list.length === total ? total : `${list.length}/${total}`}</span>
            ${sec ? `<button class="ghost icon" data-act="sec-menu" title="Section menu">${ICON.more}</button>` : ""}
          </div>
          <div class="notes" data-section="${sec ? sec.id : ""}">${list.map(cardHtml).join("")}</div>
        </div>`;
      }).join("")}
    </div>
  </section>`;
}

function renderBoard(main) {
  // keep scroll positions across re-renders
  const scrolls = {};
  $$(".column", main).forEach(c => { scrolls[c.dataset.board] = $(".col-body", c)?.scrollTop || 0; });
  const quickDraft = $(".quick textarea", main)?.value;
  const mainScroll = main.scrollLeft;

  if (!ws.boards.length) {
    main.innerHTML = `<div class="empty-board"><h2>No boards yet</h2>
      <p>Boards are the columns, kept in <b>groups</b>. Add a board, then add notes with the <b>+</b> bar inside each section and split it into
      <b>sections</b> if you like. Quick add understands <code>#tags</code> and a due at the end, e.g. <code>Send invoice #urgent !next week</code>.</p>
      <button class="primary" id="firstBoard">${ICON.plus} Create a board</button></div>`;
    $("#firstBoard").onclick = () => addBoard();
    return;
  }

  const only = ui.board ? boardById(ui.board) : null;
  const groups = only ? [group(only.groupId)] : ws.groups.filter(g => !g.hidden && !g.hibernated);
  main.innerHTML = `<div class="canvas">${groups.map(g => {
    const bs = only ? [only] : boardsIn(g).filter(b => !b.hidden && !b.hibernated);
    const away = boardsIn(g).filter(b => b.hidden || b.hibernated).length;
    const count = ws.notes.filter(n => !asleep(boardOf(n)) && boardOf(n)?.groupId === g.id && matches(n)).length;
    return `<section class="group ${g.collapsed && !only ? "collapsed" : ""}" data-group="${g.id}" style="--gc:${g.color}">
      <div class="group-head" title="drag to move the group · double-click the name to rename">
        <span class="grip">${ICON.grip}</span>
        <button class="ghost icon" data-act="group-collapse" title="${g.collapsed ? "Expand group" : "Collapse group"}">${g.collapsed ? ICON.unfold : ICON.fold}</button>
        <span class="gdot"></span>
        <h3>${esc(g.name)}</h3>
        <span class="n" title="notes">${count}</span>
        ${away && !only ? `<button class="away" data-act="open-sidebar" title="boards hidden or hibernating in this group - manage them in the sidebar">${away} out of sight</button>` : ""}
        <span class="spacer"></span>
        <button class="ghost icon" data-act="add-board" title="Add a board to this group">${ICON.plus}</button>
        <button class="ghost icon" data-act="group-menu" title="Group menu">${ICON.more}</button>
      </div>
      <div class="tray">${trayHtml(bs.filter(b => b.collapsed && !only), !only && !bs.some(b => !b.collapsed))}</div>
      <div class="group-cols">${bs.filter(b => !b.collapsed || only).map(columnHtml).join("")}</div>
    </section>`;
  }).join("")}${only ? "" : `<button class="add-group" id="addGroupBtn">${ICON.plus} New group</button>`}</div>`;

  $$(".column", main).forEach(c => { const body = $(".col-body", c); if (body) body.scrollTop = scrolls[c.dataset.board] || 0; });
  main.scrollLeft = mainScroll;
  $("#addGroupBtn")?.addEventListener("click", addGroup);
  const q = $(".quick textarea", main);
  if (q) { if (quickDraft) q.value = quickDraft; q.focus(); }
}

// collapsed boards fold into a row of chips above the group's boards, so
// the open ones get the full width
function trayHtml(folded, empty) {
  const chips = folded.map(b => {
    const n = ws.notes.filter(x => x.boardId === b.id && matches(x)).length;
    return `<button class="fold-chip" data-act="unfold" data-unfold="${b.id}" style="--pc:${b.color}" title="Expand “${esc(b.name)}”">
      <span class="dot"></span>${esc(b.name)}<span class="n">${n}</span>${ICON.unfold}</button>`;
  }).join("");
  const add = empty ? `<button class="ghost" data-act="add-board">${ICON.plusSm} Add a board</button>` : "";
  return (chips ? `<span class="tray-label">Collapsed:</span>${chips}` : "") + add;
}

// ---------- sidebar ----------

function renderSidebar() {
  const sb = $("#sidebar");
  if (!settings.sidebar) { sb.innerHTML = ""; return; }
  const row = (kind, x, extraCls = "") => {
    const isG = kind === "group";
    const sleeping = isG ? x.hibernated : asleep(x);
    const inherited = !isG && !x.hibernated && group(x.groupId)?.hibernated;
    const hid = isG ? x.hidden : x.hidden;
    const n = isG ? ws.notes.filter(m => boardOf(m)?.groupId === x.id).length : ws.notes.filter(m => m.boardId === x.id).length;
    return `<div class="tree-row t-${kind} ${extraCls} ${sleeping ? "sleeping" : ""} ${hid ? "is-hidden" : ""}" data-${kind}="${x.id}">
      <span class="${isG ? "gdot" : "dot"}" style="background:${x.color || "var(--faint)"}"></span>
      <span class="name" title="${isG ? "" : "click to show it on the board"}">${esc(x.name)}</span>
      <span class="n">${n}</span>
      <span class="acts">
        <button class="tg ${x.collapsed ? "on" : ""}" data-t="collapsed" title="${x.collapsed ? "Expand" : "Collapse"}">${x.collapsed ? ICON.unfold : ICON.fold}</button>
        <button class="tg ${hid ? "on" : ""}" data-t="hidden" title="${hid ? "Show" : "Hide (notes stay in table & search)"}">${hid ? ICON.eyeOff : ICON.eye}</button>
        <button class="tg ${x.hibernated ? "on" : ""} ${inherited ? "inherited" : ""}" data-t="hibernated" title="${x.hibernated ? "Wake up" : inherited ? "Its group is hibernating" : "Hibernate (gone everywhere until woken)"}">${ICON.moon}</button>
      </span>
    </div>`;
  };
  sb.innerHTML = `<div class="sb-head"><span>Boards</span><span class="spacer"></span>
      <button class="ghost icon" data-sb="add-group" title="New group">${ICON.plus}</button>
      <button class="ghost icon" data-sb="close" title="Close sidebar">${ICON.x}</button></div>
    <div class="sb-legend"><span>${ICON.fold} collapse</span><span>${ICON.eye} hide</span><span>${ICON.moon} hibernate</span></div>
    <div class="tree">${ws.groups.map(g => `<div class="tree-group">${row("group", g)}
      ${boardsIn(g).map(b => row("board", b)).join("")}
      <button class="tree-add" data-sb="add-board" data-g="${g.id}">${ICON.plusSm} Board</button></div>`).join("")
      || `<div class="hint" style="padding:10px 14px">No groups yet.</div>`}</div>`;
}

$("#sidebar").addEventListener("click", e => {
  const sb = e.target.closest("[data-sb]")?.dataset.sb;
  if (sb === "close") { settings.sidebar = false; applyLook(); saveSettings(); renderSidebar(); return; }
  if (sb === "add-group") { addGroup(); return; }
  if (sb === "add-board") { addBoard(e.target.closest("[data-g]").dataset.g); return; }
  const rowEl = e.target.closest(".tree-row");
  if (!rowEl) return;
  const x = rowEl.dataset.group ? group(rowEl.dataset.group) : boardById(rowEl.dataset.board);
  const t = e.target.closest(".tg")?.dataset.t;
  if (t) { setState(x, t, !x[t]); return; }
  if (e.target.closest(".name") && rowEl.dataset.board) revealBoard(x);
  else if (e.target.closest(".name") && rowEl.dataset.group) revealGroup(x);
});
$("#sidebar").addEventListener("dblclick", e => {
  const name = e.target.closest(".tree-row .name"); if (!name) return;
  const rowEl = name.closest(".tree-row");
  const x = rowEl.dataset.group ? group(rowEl.dataset.group) : boardById(rowEl.dataset.board);
  renameInline(name, x);
});

function setState(x, key, value) {
  x[key] = value;
  if (value && key === "hibernated") x.hidden = false;
  if (value && key === "hidden") x.hibernated = false;
  const isGroup = ws.groups.includes(x);
  if (key !== "collapsed" && value && ui.board && (isGroup ? boardById(ui.board)?.groupId === x.id : ui.board === x.id)) ui.board = "";
  save(); render();
  if (value && key !== "collapsed") {
    const what = isGroup ? "group" : "board";
    const msg = key === "hidden" ? `Hid the ${what} “${esc(x.name)}” — its notes still show in the table.` : `“${esc(x.name)}” is hibernating — wake it from the sidebar.`;
    const t = toast(`${msg} <button>Undo</button>`, 7000);
    $("button", t).onclick = () => { x[key] = false; t.classList.remove("show"); save(); render(); };
  }
}

function flash(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}
function revealBoard(b) {
  const g = group(b.groupId);
  if (asleep(b)) { toast(`“${esc(b.name)}” is hibernating — wake it with ${ICON.moon} first.`); return; }
  let changed = false;
  if (g.hidden) { g.hidden = false; changed = true; }
  if (g.collapsed) { g.collapsed = false; changed = true; }
  if (b.hidden) { b.hidden = false; changed = true; }
  if (b.collapsed) { b.collapsed = false; changed = true; }
  if (ui.board && ui.board !== b.id) ui.board = "";
  ui.view = "board";
  if (changed) save();
  render();
  flash($(`.column[data-board="${b.id}"]`));
}
function revealGroup(g) {
  if (g.hibernated) { toast(`“${esc(g.name)}” is hibernating — wake it with ${ICON.moon} first.`); return; }
  if (g.hidden || g.collapsed) { g.hidden = false; g.collapsed = false; save(); }
  ui.view = "board"; ui.board = "";
  render();
  flash($(`.group[data-group="${g.id}"]`));
}

// ---------- board events ----------

$("#main").addEventListener("click", e => {
  const col = e.target.closest(".column");
  const b = col ? boardById(col.dataset.board) : null;
  const grpEl = e.target.closest(".group");
  const g = grpEl ? group(grpEl.dataset.group) : null;
  const secEl = e.target.closest(".section");
  const sec = secEl ? section(b, secEl.dataset.section) : null;
  const act = e.target.closest("[data-act]")?.dataset.act;
  const card = e.target.closest(".card");
  const row = e.target.closest("tr.row");

  if (act === "done") {
    e.stopPropagation();
    toggleDone(note((card || row).dataset.note));
    return;
  }
  if (e.target.closest("a")) return;   // links open normally
  switch (act) {
    case "board-add":
      e.stopPropagation();
      popMenu(e.target.closest("button"), `
        <button data-m="note">${ICON.plusSm} Note</button>
        <button data-m="sec">${ICON.plusSm} Section</button>`, d => {
        if (d.m === "note") { quick = { board: b.id, section: null }; renderMain(); }
        if (d.m === "sec") addSection(b);
      });
      return;
    case "quick-pick": return;
    case "quick-close": quick = null; renderMain(); return;
    case "quick-add": quickAdd($(".quick textarea", col)); return;
    case "board-menu": boardMenu(b, e.target.closest("button")); return;
    case "group-menu": groupMenu(g, e.target.closest("button")); return;
    case "sec-menu": e.stopPropagation(); sectionMenu(b, sec, e.target.closest("button")); return;
    case "toggle-sec":
      if (sec) sec.collapsed = !sec.collapsed; else b.generalCollapsed = !b.generalCollapsed;
      save(); renderMain(); return;
    case "add-sec": addSection(b); return;
    case "add-board": addBoard(g.id); return;
    case "unfold": { const fb = boardById(e.target.closest("[data-unfold]").dataset.unfold); fb.collapsed = false; save(); render(); flash($(`.column[data-board="${fb.id}"]`)); return; }
    case "group-collapse": g.collapsed = !g.collapsed; save(); render(); return;
    case "open-sidebar": settings.sidebar = true; applyLook(); saveSettings(); renderSidebar(); return;
    case "add-bm": e.stopPropagation(); addBmMenu(b, null, e.target.closest("button")); return;
    case "bmf-add": e.stopPropagation(); addBmMenu(b, e.target.closest("[data-folder]").dataset.folder, e.target.closest("button")); return;
    case "bmf-menu": e.stopPropagation(); folderMenu(b, bmFolder(b, e.target.closest("[data-folder]").dataset.folder), e.target.closest("button")); return;
    case "bmf-toggle": { const f = bmFolder(b, e.target.closest("[data-folder]").dataset.folder); f.collapsed = !f.collapsed; save(); renderMain(); return; }
    case "toggle-bm": b.bookmarksOpen = !b.bookmarksOpen; save(); renderMain(); return;
    case "edit-bm": editBookmark(b, e.target.closest("li").dataset.bm); return;
    case "filter-bm": { const id = e.target.closest("li").dataset.bm; ui.bookmark = ui.bookmark === id ? null : id; render(); return; }
  }
  if (card) { viewNote(note(card.dataset.note)); return; }
  if (row) { viewNote(note(row.dataset.note)); return; }
  // a collapsed board or group opens with a click anywhere on its strip
  if (col?.classList.contains("collapsed") && !act) { b.collapsed = false; save(); renderMain(); return; }
  if (grpEl?.classList.contains("collapsed") && !act) { g.collapsed = false; save(); render(); return; }
  const th = e.target.closest("th[data-sort]");
  if (th) {
    const k = th.dataset.sort;
    ui.sort = ui.sort.key === k ? { key: k, dir: -ui.sort.dir } : { key: k, dir: 1 };
    saveSettings(); renderMain();
  }
});
$("#main").addEventListener("dblclick", e => {
  const fn = e.target.closest(".bm-folder .fname");
  if (fn) { const b = boardById(fn.closest(".column").dataset.board); renameInline(fn, bmFolder(b, fn.closest("[data-folder]").dataset.folder)); return; }
  const h2 = e.target.closest(".col-head h2");
  if (h2 && !h2.closest(".column.collapsed")) { renameInline(h2, boardById(h2.closest(".column").dataset.board)); return; }
  const h3 = e.target.closest(".group-head h3");
  if (h3 && !h3.closest(".group.collapsed")) { renameInline(h3, group(h3.closest(".group").dataset.group)); return; }
  const sn = e.target.closest(".sec-name");
  if (sn && !sn.closest(".section.general")) { const b = boardById(sn.closest(".column").dataset.board); renameInline(sn, section(b, sn.closest(".section").dataset.section)); }
});
$("#main").addEventListener("change", e => {
  if (e.target.matches(".quick select") && quick) quick.section = e.target.value || null;
});
$("#main").addEventListener("keydown", e => {
  if (!e.target.matches(".quick textarea")) return;
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); quickAdd(e.target); }
  if (e.key === "Escape") { quick = null; renderMain(); }
});

function quickAdd(ta) {
  const text = ta.value.trim();
  if (!text || !quick) { ta.focus(); return; }
  const pick = ta.closest(".quick")?.querySelector("select");
  if (pick) quick.section = pick.value || null;
  const target = section(boardById(quick.board), quick.section);
  if (target) target.collapsed = false; else if (!quick.section) boardById(quick.board).generalCollapsed = false;
  const q = parseQuick(text);
  ensureTags(q.tags);
  const n = { id: uid(), boardId: quick.board, sectionId: quick.section, title: q.title, body: q.body, tags: q.tags, due: q.due, links: [], created: nowSec(), updated: nowSec() };
  placeAtStart(n);
  ta.value = "";
  quick = null;
  save();
  render();
  if (!matches(n)) toast("Added — but hidden by the current filters.");
}

function toggleDone(n) {
  n.tags ||= [];
  if (isDone(n)) n.tags = n.tags.filter(t => t !== "done");
  else markDone(n);
  n.updated = nowSec();
  placeAtEnd(n);   // done: last of the section; reopened: last of the open ones (save sorts them)
  save(); render();
}

// ---------- drag & drop: notes and bookmarks (HTML drag & drop) ----------

let drag = null;   // { kind: "note"|"bm", id, from }
$("#main").addEventListener("dragstart", e => {
  const card = e.target.closest?.(".card");
  const li = e.target.closest?.("li[data-bm]");
  const fl = e.target.closest?.("li.bm-folder");
  const sh = e.target.closest?.(".sec-head");
  if (fl) { drag = { kind: "bmf", id: fl.dataset.folder, from: fl.closest(".column").dataset.board }; fl.classList.add("dragging"); }
  else if (sh) { const secEl = sh.closest(".section"); drag = { kind: "sec", id: secEl.dataset.section, from: sh.closest(".column").dataset.board }; secEl.classList.add("dragging"); }
  else if (card) { drag = { kind: "note", id: card.dataset.note }; card.classList.add("dragging"); }
  else if (li) { drag = { kind: "bm", id: li.dataset.bm, from: li.closest(".column").dataset.board }; li.classList.add("dragging"); }
  else return;
  e.dataTransfer.effectAllowed = drag.kind === "bm" ? "linkMove" : "move";
  e.dataTransfer.setData("text/plain", drag.id);
});
$("#main").addEventListener("dragend", () => { drag = null; clearDropMarks(); $$(".dragging").forEach(x => x.classList.remove("dragging")); });
function clearDropMarks() {
  $$(".bm-drop-after").forEach(x => x.classList.remove("bm-drop-after"));
  $$(".drop-line").forEach(x => x.remove());
  $$(".drag-over-col").forEach(x => x.classList.remove("drag-over-col"));
  $$(".bm-drop-before").forEach(x => x.classList.remove("bm-drop-before"));
  $$(".bm-drop-into").forEach(x => x.classList.remove("bm-drop-into"));
  $$(".link-drop").forEach(x => x.classList.remove("link-drop"));
}
// a link dragged from a board's Links onto a note card (on any board) links it there
const linkDropCard = e => (drag?.kind === "bm" ? e.target.closest?.(".card[data-note]") : null);
function cardAfter(container, y) {
  // the first card whose middle is below the pointer: drop goes before it
  return [...container.querySelectorAll(":scope > .card:not(.dragging)")].find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
}
// the element of `els` nearest the pointer, if it's within `reach` pixels
// (so a drop in the gap between boards or lanes still counts)
function nearestEl(els, x, y, reach = 56) {
  let best = null, bestD = Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    if (d < bestD) { bestD = d; best = el; }
  }
  return bestD <= reach ? best : null;
}
// the open board a drag is over: the one under the pointer, or the nearest one
function dropCol(e) {
  return e.target.closest(".column:not(.collapsed)") || nearestEl($$("#main .column:not(.collapsed)"), e.clientX, e.clientY);
}
// the notes list a dragged card would land in: the one under the pointer,
// a collapsed section's header (drops at its end), or else the section at
// the pointer's height
function dropList(e, col) {
  const list = e.target.closest(".notes");
  if (list && col.contains(list)) return list;
  const sec = e.target.closest(".section");
  if (sec && col.contains(sec)) return $(".notes", sec);
  const secs = $$(".col-body > .section", col);
  const at = secs.find(x => { const r = x.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; })
    || nearestEl(secs, e.clientX, e.clientY, Infinity);
  return at ? $(".notes", at) : $(".notes", col);
}

// scroll whatever is under the pointer (a board, a lane, the page) while
// dragging near its edge, so far-away places can be reached
document.addEventListener("dragover", e => {
  if (!drag) return;
  const edge = 48, step = (dist) => Math.ceil((edge - dist) / 3);
  const scrollers = [e.target.closest?.(".col-body, .lane-body"), $("#main")].filter(Boolean);
  for (const el of scrollers) {
    const r = el.getBoundingClientRect();
    if (el.scrollHeight <= el.clientHeight) continue;
    if (e.clientY < r.top + edge && el.scrollTop > 0) { el.scrollTop -= step(e.clientY - r.top); break; }
    if (e.clientY > r.bottom - edge && el.scrollTop + el.clientHeight < el.scrollHeight) { el.scrollTop += step(r.bottom - e.clientY); break; }
  }
});
$("#main").addEventListener("dragover", e => {
  if (!drag) return;
  const lc = linkDropCard(e);
  if (lc) { e.preventDefault(); e.dataTransfer.dropEffect = "link"; clearDropMarks(); lc.classList.add("link-drop"); return; }
  const col = dropCol(e);
  if (!col) return;
  if (drag.kind === "sec" && drag.id === "" && col.dataset.board !== drag.from) { clearDropMarks(); return; }   // General stays on its board
  e.preventDefault();
  clearDropMarks();
  if (drag.kind === "sec") {
    const at = sectionDropPoint(e, col);
    if (!at) return;
    const line = document.createElement("div");
    line.className = "drop-line sec-line";
    at.body.insertBefore(line, at.before);
    return;
  }
  if (drag.kind === "note") {
    const list = dropList(e, col);
    const sec = list.closest(".section");
    if (sec?.classList.contains("collapsed")) { sec.classList.add("drag-over-col"); return; }
    const line = document.createElement("div");
    line.className = "drop-line";
    list.insertBefore(line, cardAfter(list, e.clientY));
  } else if (drag.kind === "bm" || drag.kind === "bmf") {
    const t = bmDropTarget(e, col);
    if (t.invalid) return;
    if (t.into) t.el.classList.add("bm-drop-into");
    else if (t.before) t.before.classList.add("bm-drop-before");
    else col.classList.add("drag-over-col");
  }
});
$("#main").addEventListener("drop", e => {
  if (!drag) return;
  const lc = linkDropCard(e);
  if (lc) {
    e.preventDefault();
    const n = note(lc.dataset.note), x = bookmark(drag.id);
    drag = null; clearDropMarks();
    if (!n || !x) return;
    n.links ||= [];
    if (n.links.includes(x.b.id)) { toast(`“${esc(n.title || "This note")}” already links “${esc(x.b.title)}”.`); return; }
    n.links.push(x.b.id); n.updated = nowSec();
    save(); render();
    toast(`Linked “${esc(x.b.title)}” to “${esc(n.title || "note")}”.`);
    return;
  }
  const col = dropCol(e);
  if (!col) return;
  e.preventDefault();
  const bid = col.dataset.board;
  if (drag.kind === "sec") {
    const at = sectionDropPoint(e, col);
    if (at) moveSection(drag.id, boardById(drag.from), boardById(bid), at.order);
    drag = null; clearDropMarks(); save(); render();
    return;
  }
  if (drag.kind === "note") {
    const n = note(drag.id);
    const list = dropList(e, col);
    const collapsedSec = list.closest(".section.collapsed");
    const before = collapsedSec ? null : cardAfter(list, e.clientY);
    n.boardId = bid;
    n.sectionId = list.dataset.section || null;
    n.updated = nowSec();
    if (before) {
      ws.notes.splice(ws.notes.indexOf(n), 1);
      ws.notes.splice(ws.notes.indexOf(note(before.dataset.note)), 0, n);
    } else placeAtEnd(n);
  } else if (drag.kind === "bm" || drag.kind === "bmf") {
    // reorder, file into folders, or move to another board (links on notes keep working)
    const t = bmDropTarget(e, col);
    if (!t.invalid) moveBmOrFolder(boardById(drag.from), boardById(bid), t);
  }
  drag = null;
  clearDropMarks();
  save(); render();
});

// where a dragged section would land in a board: the element to insert the
// drop line before, and the board's new section order ("" = General)
function sectionDropPoint(e, col) {
  if (drag.id === "" && col.dataset.board !== drag.from) return null;   // General stays on its board
  const body = $(".col-body", col);
  const secs = $$(":scope > .section", body).filter(x => !(x.classList.contains("dragging")));
  const before = secs.find(x => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; }) || null;
  let order = secs.map(x => x.dataset.section);
  let i = before ? order.indexOf(before.dataset.section) : order.length;
  order.splice(i, 0, drag.id);
  return { body, before, order };
}

function moveSection(id, src, dst, order) {
  if (id === "") {
    src.generalPos = order.indexOf("");
    return;
  }
  const sec = src.sections.find(x => x.id === id);
  if (!sec) return;
  if (src !== dst) {
    src.sections = src.sections.filter(x => x !== sec);
    if ((src.generalPos || 0) > src.sections.length) src.generalPos = src.sections.length;
    // its notes come along, in the same order
    ws.notes.forEach(n => { if (n.sectionId === id) { n.boardId = dst.id; n.updated = nowSec(); } });
    dst.sections.push(sec);
  }
  const ids = order.filter(x => x !== "");
  dst.sections = ids.map(x => dst.sections.find(y => y.id === x)).filter(Boolean);
  dst.generalPos = Math.max(0, order.indexOf(""));
}

// ---------- moving boards and groups (pointer drag on their headers) ----------
// Grab a board by its header, or a group by its header, and drag it: it
// lifts off and the others slide aside to show where it will land. Boards
// can be dropped into another group. Done with pointer events rather than
// HTML drag & drop, so it works the same in every browser and the view
// scrolls when you reach its edge.

let colDrag = null;
$("#main").addEventListener("pointerdown", e => {
  if (e.button !== 0 || ui.view !== "board" || ui.board) return;
  if (e.target.closest("button, input, a")) return;
  if (e.target.closest(".sec-head")) return;
  const head = e.target.closest(".col-head, .group-head");
  if (!head) return;
  const isGroup = head.classList.contains("group-head");
  const el = isGroup ? head.parentElement : head.parentElement;
  if (el.classList.contains("collapsed")) return;   // collapsed strips open on click
  colDrag = { kind: isGroup ? "group" : "board", el, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false };
});
window.addEventListener("pointermove", e => {
  if (!colDrag) return;
  colDrag.x = e.clientX; colDrag.y = e.clientY;
  if (!colDrag.started) {
    if (Math.hypot(e.clientX - colDrag.x0, e.clientY - colDrag.y0) < 6) return;
    startLift(e);
  }
  e.preventDefault();
  colDrag.el.style.left = `${e.clientX - colDrag.dx}px`;
  colDrag.el.style.top = `${e.clientY - colDrag.dy}px`;
  placeLifted();
});
window.addEventListener("pointerup", () => endLift(true));
window.addEventListener("pointercancel", () => endLift(false));
window.addEventListener("keydown", e => { if (e.key === "Escape" && colDrag?.started) endLift(false); });

function startLift(e) {
  const { el } = colDrag;
  const r = el.getBoundingClientRect();
  Object.assign(colDrag, { started: true, dx: e.clientX - r.left, dy: e.clientY - r.top });
  const ph = document.createElement("div");
  ph.className = colDrag.kind === "group" ? "group-placeholder" : "col-placeholder";
  if (colDrag.kind === "group") ph.style.width = `${r.width}px`;   // a board's slot takes its grid cell's width
  ph.style.height = `${r.height}px`;
  el.after(ph);
  colDrag.ph = ph;
  Object.assign(el.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left}px`, top: `${r.top}px` });
  el.classList.add("lifted");
  document.body.classList.add("moving-col");
  window.getSelection()?.removeAllRanges();
  // scroll the view while the pointer is near an edge
  colDrag.scroller = setInterval(() => {
    const main = $("#main"), m = main.getBoundingClientRect(), edge = 70;
    let vx = 0, vy = 0;
    if (colDrag.x > m.right - edge) vx = Math.min(24, (colDrag.x - (m.right - edge)) / 3);
    else if (colDrag.x < m.left + edge) vx = -Math.min(24, ((m.left + edge) - colDrag.x) / 3);
    if (colDrag.y > m.bottom - edge) vy = Math.min(20, (colDrag.y - (m.bottom - edge)) / 3);
    else if (colDrag.y < m.top + edge / 2) vy = -Math.min(20, ((m.top + edge / 2) - colDrag.y) / 3);
    if (vx || vy) { main.scrollLeft += vx; main.scrollTop += vy; placeLifted(); }
  }, 16);
}

function placeLifted() {
  const { x, y, ph, kind } = colDrag;
  const canvas = $(".canvas");
  if (kind === "group") {
    const others = $$(".canvas > .group:not(.lifted)");
    const before = others.find(g => { const r = g.getBoundingClientRect(); return y < r.top + r.height / 2; }) || $("#addGroupBtn");
    if (ph.nextElementSibling !== before) canvas.insertBefore(ph, before);
    return;
  }
  // board: the expanded group under the pointer (or the nearest one), then
  // the slot between that group's boards
  const groups = $$(".canvas > .group:not(.collapsed)");
  const dist = g => { const r = g.getBoundingClientRect(); return y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; };
  const target = groups.reduce((best, g) => (best && dist(best) <= dist(g) ? best : g), null);
  if (!target) return;
  const cols = $(".group-cols", target);
  const others = $$(":scope > .column:not(.lifted)", cols);
  if (!others.length) { if (ph.parentElement !== cols) cols.appendChild(ph); return; }
  // boards wrap onto several rows: take the board nearest the pointer and
  // drop before or after it depending on which half the pointer is over
  let best = null, bestD = Infinity;
  for (const c of others) {
    const r = c.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = c; }
  }
  const r = best.getBoundingClientRect();
  let before = x < r.left + r.width / 2 ? best : best.nextElementSibling;
  if (before === ph) before = ph.nextElementSibling;
  if (ph.parentElement !== cols || ph.nextElementSibling !== before) cols.insertBefore(ph, before);
}

function endLift(commit) {
  if (!colDrag) return;
  const d = colDrag;
  colDrag = null;
  if (!d.started) return;   // a plain click (or the first half of a double-click)
  clearInterval(d.scroller);
  document.body.classList.remove("moving-col");
  if (commit) {
    const next = d.ph.nextElementSibling;
    if (d.kind === "group") {
      const g = group(d.el.dataset.group);
      ws.groups.splice(ws.groups.indexOf(g), 1);
      const nextG = next?.dataset?.group ? group(next.dataset.group) : null;
      ws.groups.splice(nextG ? ws.groups.indexOf(nextG) : ws.groups.length, 0, g);
    } else {
      const b = boardById(d.el.dataset.board);
      const gid = d.ph.closest(".group").dataset.group;
      ws.boards.splice(ws.boards.indexOf(b), 1);
      b.groupId = gid;
      const nextB = next?.dataset?.board ? boardById(next.dataset.board) : null;
      let at;
      if (nextB) at = ws.boards.indexOf(nextB);
      else { at = ws.boards.length; ws.boards.forEach((x, i) => { if (x.groupId === gid) at = i + 1; }); }
      ws.boards.splice(at, 0, b);
    }
    save();
  }
  render();
}

// ---------- groups, boards, sections ----------

function addGroup() {
  const g = newGroup("New group");
  ui.view = "board"; ui.board = "";
  save(); render();
  const h3 = $(`.group[data-group="${g.id}"] .group-head h3`);
  h3?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  if (h3) renameInline(h3, g);
}

function addBoard(groupId) {
  let g = group(groupId) || ws.groups.find(x => !x.hidden && !x.hibernated) || ws.groups[0];
  if (!g) g = newGroup("General");
  g.collapsed = false; g.hidden = false; g.hibernated = false;
  const b = { id: uid(), groupId: g.id, name: "New board", color: PALETTE[ws.boards.length % PALETTE.length], bookmarks: [], sections: [], bookmarksOpen: false };
  let at = ws.boards.length;
  ws.boards.forEach((x, i) => { if (x.groupId === g.id) at = i + 1; });
  ws.boards.splice(at, 0, b);
  ui.board = ""; ui.view = "board";
  save(); render();
  const h2 = $(`.column[data-board="${b.id}"] .col-head h2`);
  h2?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  if (h2) renameInline(h2, b);
}
$("#addBoardBtn").onclick = () => addBoard();

function addSection(b) {
  const s = { id: uid(), name: "New section" };
  b.sections.push(s);
  b.collapsed = false;
  save(); renderMain();
  const el = $(`.column[data-board="${b.id}"] .section[data-section="${s.id}"] .sec-name`);
  el?.scrollIntoView({ block: "nearest" });
  if (el) renameInline(el, s);
}

// rename anything with a .name in place
function renameInline(el, obj) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = obj.name;
  input.className = "rename";
  el.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    if (ok && input.value.trim() && input.value.trim() !== obj.name) { obj.name = input.value.trim(); save(); }
    render();
  };
  input.onkeydown = e => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); e.stopPropagation(); };
  input.onblur = () => finish(true);
  input.onclick = e => e.stopPropagation();
  input.onpointerdown = e => e.stopPropagation();
}

function closeMenu() { $(".menu")?.remove(); }
document.addEventListener("mousedown", e => { if (!e.target.closest(".menu")) closeMenu(); });

function popMenu(anchor, html, onPick) {
  closeMenu();
  const m = document.createElement("div");
  m.className = "menu";
  m.innerHTML = html;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8))}px`;
  m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
  m.onclick = e => {
    const btn = e.target.closest("button"); if (!btn) return;
    closeMenu();
    onPick(btn.dataset);
  };
}
const colorRow = cur => `<div class="colors">${PALETTE.map(c => `<button data-color="${c}" class="${cur === c ? "on" : ""}" style="background:${c}"></button>`).join("")}</div>`;
const stateItems = x => `
  <button data-m="collapsed">${x.collapsed ? ICON.unfold : ICON.fold} ${x.collapsed ? "Expand" : "Collapse"}</button>
  <button data-m="hidden">${ICON.eyeOff} Hide</button>
  <button data-m="hibernated">${ICON.moon} Hibernate</button>`;

function boardMenu(b, anchor) {
  const others = ws.groups.filter(g => g.id !== b.groupId);
  popMenu(anchor, `
    <button data-m="rename">${ICON.edit} Rename</button>
    <button data-m="add-sec">${ICON.plusSm} Add section</button>
    <button data-m="add-bm">${ICON.bookmark} Add link</button>
    <button data-m="add-bmf">${ICON.folder} New link folder</button>
    <button data-m="only">${ICON.eye} Show only this board</button>
    <hr>${stateItems(b)}
    ${others.length ? `<hr><div class="menu-label">Move to group</div>${others.map(g => `<button data-move="${g.id}"><span class="gdot" style="background:${g.color}"></span>${esc(g.name)}</button>`).join("")}` : ""}
    <hr>${colorRow(b.color)}<hr>
    <button data-m="delete" class="danger">Delete board…</button>`, d => {
    if (d.color) { b.color = d.color; save(); render(); return; }
    if (d.move) { b.groupId = d.move; const g = group(d.move); ws.boards.splice(ws.boards.indexOf(b), 1); let at = ws.boards.length; ws.boards.forEach((x, i) => { if (x.groupId === g.id) at = i + 1; }); ws.boards.splice(at, 0, b); save(); render(); return; }
    switch (d.m) {
      case "rename": { const h2 = $(`.column[data-board="${b.id}"] .col-head h2`); if (h2) renameInline(h2, b); break; }
      case "add-sec": addSection(b); break;
      case "add-bm": editBookmark(b, null); break;
      case "add-bmf": newBmFolder(b, null); break;
      case "only": ui.board = b.id; saveSettings(); render(); break;
      case "collapsed": case "hidden": case "hibernated": setState(b, d.m, !b[d.m]); break;
      case "delete": deleteBoard(b); break;
    }
  });
}

function groupMenu(g, anchor) {
  popMenu(anchor, `
    <button data-m="rename">${ICON.edit} Rename</button>
    <button data-m="add-board">${ICON.plusSm} Add board</button>
    <hr>${stateItems(g)}
    <button data-m="fold-all">${ICON.fold} Collapse all its boards</button>
    <button data-m="unfold-all">${ICON.unfold} Expand all its boards</button>
    <hr>${colorRow(g.color)}<hr>
    <button data-m="delete" class="danger">Delete group…</button>`, d => {
    if (d.color) { g.color = d.color; save(); render(); return; }
    switch (d.m) {
      case "rename": { const h3 = $(`.group[data-group="${g.id}"] .group-head h3`); if (h3) renameInline(h3, g); break; }
      case "add-board": addBoard(g.id); break;
      case "collapsed": case "hidden": case "hibernated": setState(g, d.m, !g[d.m]); break;
      case "fold-all": boardsIn(g).forEach(b => { b.collapsed = true; }); save(); render(); break;
      case "unfold-all": boardsIn(g).forEach(b => { b.collapsed = false; }); save(); render(); break;
      case "delete": deleteGroup(g); break;
    }
  });
}

function sectionMenu(b, s, anchor) {
  const i = b.sections.indexOf(s);
  popMenu(anchor, `
    <button data-m="rename">${ICON.edit} Rename</button>
    <button data-m="add">${ICON.plusSm} Add a note here</button>
    <button data-m="collapse">${s.collapsed ? ICON.unfold : ICON.fold} ${s.collapsed ? "Expand" : "Collapse"}</button>
    ${i > 0 ? `<button data-m="up">Move up</button>` : ""}
    ${i < b.sections.length - 1 ? `<button data-m="down">Move down</button>` : ""}
    <hr><button data-m="delete" class="danger">Delete section…</button>`, d => {
    switch (d.m) {
      case "rename": { const el = $(`.column[data-board="${b.id}"] .section[data-section="${s.id}"] .sec-name`); if (el) renameInline(el, s); break; }
      case "add": quick = { board: b.id, section: s.id }; s.collapsed = false; renderMain(); break;
      case "collapse": s.collapsed = !s.collapsed; save(); renderMain(); break;
      case "up": case "down": b.sections.splice(i, 1); b.sections.splice(i + (d.m === "up" ? -1 : 1), 0, s); save(); renderMain(); break;
      case "delete": {
        const count = ws.notes.filter(n => n.sectionId === s.id).length;
        confirmBox(`Delete the section “${esc(s.name)}”?`, count ? `Its ${count} note(s) stay on the board, at the top (outside any section).` : "It has no notes.", "Delete", () => {
          const snapshot = JSON.stringify(ws);
          b.sections = b.sections.filter(x => x !== s);
          ws.notes.forEach(n => { if (n.sectionId === s.id) n.sectionId = null; });
          save(); render();
          offerUndo(`Deleted section “${esc(s.name)}”.`, snapshot);
        });
      }
    }
  });
}

function dropBoardData(b) {
  const bmIds = new Set((b.bookmarks || []).map(x => x.id));
  ws.boards = ws.boards.filter(x => x !== b);
  ws.notes = ws.notes.filter(n => n.boardId !== b.id);
  ws.notes.forEach(n => { n.links = (n.links || []).filter(id => !bmIds.has(id)); });
  if (ui.board === b.id) ui.board = "";
}
function deleteBoard(b) {
  const count = ws.notes.filter(n => n.boardId === b.id).length;
  confirmBox(`Delete the board “${esc(b.name)}”?`, `This removes the board, its ${(b.bookmarks || []).length} link(s) and its ${count} note(s). You can undo right after.`, "Delete", () => {
    const snapshot = JSON.stringify(ws);
    dropBoardData(b);
    save(); render();
    offerUndo(`Deleted “${esc(b.name)}”.`, snapshot);
  });
}
function deleteGroup(g) {
  const bs = boardsIn(g);
  const count = ws.notes.filter(n => bs.some(b => b.id === n.boardId)).length;
  confirmBox(`Delete the group “${esc(g.name)}”?`, bs.length ? `This removes its ${bs.length} board(s) and their ${count} note(s). To keep a board, move it to another group first (board menu → Move to group). You can undo right after.` : "The group is empty.", "Delete", () => {
    const snapshot = JSON.stringify(ws);
    bs.forEach(dropBoardData);
    ws.groups = ws.groups.filter(x => x !== g);
    save(); render();
    offerUndo(`Deleted group “${esc(g.name)}”.`, snapshot);
  });
}

function offerUndo(msg, snapshot) {
  const t = toast(`${msg} <button>Undo</button>`, 8000);
  $("button", t).onclick = () => { ws = JSON.parse(snapshot); t.classList.remove("show"); save(); render(); };
}

// ---------- modals ----------

function modal(html, cls = "") {
  closeModal();
  const o = document.createElement("div");
  o.className = "overlay";
  o.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  document.body.appendChild(o);
  o.addEventListener("mousedown", e => { if (e.target === o) o._close?.(); });
  o._close = closeModal;
  return o;
}
function closeModal() { $(".overlay")?.remove(); }
document.addEventListener("keydown", e => {
  const o = $(".overlay");
  if (e.key === "Escape" && o) { e.preventDefault(); o._close?.(); return; }
  if (e.key === "/" && !o && !e.target.matches("input, textarea, select")) { e.preventDefault(); $("#search").focus(); }
  // 1-8 pick a view (in the order of the buttons at the top)
  if (/^[1-9]$/.test(e.key) && !o && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.matches("input, textarea, select, [contenteditable]")) {
    const b = $$("#viewSeg button")[+e.key - 1];
    if (b) { ui.view = b.dataset.view; quick = null; saveSettings(); render(); }
  }
});

function confirmBox(title, text, okLabel, onOk) {
  const o = modal(`<h3>${title}</h3><div class="muted">${text}</div>
    <div class="foot"><div class="spacer"></div><button data-x="no">Cancel</button><button class="danger" data-x="yes">${okLabel}</button></div>`, "small");
  o.onclick = e => { const x = e.target.closest("[data-x]")?.dataset.x; if (x === "yes") { closeModal(); onOk(); } else if (x === "no") closeModal(); };
  $("button.danger", o).focus();
}

// ---------- bookmark folders ----------

function addBmMenu(b, folderId, anchor) {
  popMenu(anchor, `
    <button data-m="bm">${ICON.bookmark} Link…</button>
    <button data-m="files">${ICON.file} Local files…</button>
    <button data-m="folder">${ICON.folder} New folder</button>`, d => {
    if (d.m === "bm") editBookmark(b, null, folderId);
    if (d.m === "folder") newBmFolder(b, folderId);
    if (d.m === "files") pickPaths("file", true).then(items => {
      if (!items.length) return;
      const skipped = addBookmarks(b, items, folderId);
      openBmPath(b, folderId);
      save(); render();
      if (skipped) toast(skipped === items.length ? "Already in Links." : skippedMsg(skipped).trim());
    });
  });
}

// make sure a folder (and the bookmarks list) is open so new things are visible
function openBmPath(b, folderId) {
  b.bookmarksOpen = true;
  for (let f = bmFolder(b, folderId), guard = 0; f && guard < 50; f = bmFolder(b, f.parentId), guard++) f.collapsed = false;
}

function newBmFolder(b, parentId) {
  const f = { id: uid(), name: "New folder", parentId: parentId || null };
  bmFolders(b).push(f);
  const inBookmarksView = ui.view === "bookmarks";
  if (inBookmarksView) {
    // that view has its own folds, and shouldn't unfold anything on the Board view
    setVopt("fold:bmb:" + b.id, false);
    for (let p = bmFolder(b, parentId), guard = 0; p && guard < 50; p = bmFolder(b, p.parentId), guard++) setVopt("fold:bmf:" + p.id, false);
  } else openBmPath(b, parentId);
  save(); renderMain();
  const el = inBookmarksView
    ? $(`.bmv-board[data-board="${b.id}"] .bmv-folder[data-folder="${f.id}"] .fname`)
    : $(`.column[data-board="${b.id}"] .bm-folder[data-folder="${f.id}"] .fname`);
  if (!el) return;
  if (inBookmarksView) el.parentElement.draggable = false;   // so the mouse can select text while naming it
  renameInline(el, f);
}

function folderMenu(b, f, anchor) {
  popMenu(anchor, `
    <button data-m="rename">${ICON.edit} Rename</button>
    <button data-m="bm">${ICON.bookmark} Add link here</button>
    <button data-m="sub">${ICON.folder} New subfolder</button>
    <button data-m="fold">${f.collapsed ? ICON.unfold : ICON.fold} ${f.collapsed ? "Expand" : "Collapse"}</button>
    <hr><button data-m="delete" class="danger">Delete folder…</button>`, d => {
    switch (d.m) {
      case "rename": { const el = $(`.column[data-board="${b.id}"] .bm-folder[data-folder="${f.id}"] .fname`); if (el) renameInline(el, f); break; }
      case "bm": editBookmark(b, null, f.id); break;
      case "sub": newBmFolder(b, f.id); break;
      case "fold": f.collapsed = !f.collapsed; save(); renderMain(); break;
      case "delete": deleteBmFolder(b, f); break;
    }
  });
}

function deleteBmFolder(b, f) {
  const inside = folderDescendants(b, f.id);
  const count = (b.bookmarks || []).filter(x => inside.has(x.folderId)).length;
  const o = modal(`<h3>Delete the folder “${esc(f.name)}”?</h3>
    <div class="muted">${count ? `It holds ${count} link${count === 1 ? "" : "s"}${inside.size > 1 ? `, in ${inside.size - 1} subfolder${inside.size === 2 ? "" : "s"} too` : ""}.` : "It's empty."} You can undo right after.</div>
    <div class="foot"><div class="spacer"></div><button data-x="no">Cancel</button>
      ${count ? `<button data-x="keep">Keep the links</button><button class="danger" data-x="all">Delete with its links</button>` : `<button class="danger" data-x="keep">Delete</button>`}</div>`, "small");
  o.onclick = e => {
    const a = e.target.closest("[data-x]")?.dataset.x;
    if (!a) return;
    closeModal();
    if (a === "no") return;
    const snapshot = JSON.stringify(ws);
    if (a === "keep") {
      // its contents move up one level, where the folder was
      for (const g of bmFolders(b)) if (g.parentId === f.id) g.parentId = f.parentId || null;
      for (const x of b.bookmarks || []) if (x.folderId === f.id) x.folderId = f.parentId || null;
      b.bmFolders = bmFolders(b).filter(g => g !== f);
    } else {
      const gone = new Set((b.bookmarks || []).filter(x => inside.has(x.folderId)).map(x => x.id));
      b.bookmarks = (b.bookmarks || []).filter(x => !gone.has(x.id));
      b.bmFolders = bmFolders(b).filter(g => !inside.has(g.id));
      ws.notes.forEach(n => { n.links = (n.links || []).filter(id => !gone.has(id)); });
      if (gone.has(ui.bookmark)) ui.bookmark = null;
    }
    save(); render();
    offerUndo(`Deleted folder “${esc(f.name)}”.`, snapshot);
  };
}

// where a dragged bookmark or folder would land: into a folder row, before a
// bookmark (in that bookmark's folder), or at the top level of the board
function bmDropTarget(e, col) {
  const dst = boardById(col.dataset.board);
  const fl = e.target.closest("li.bm-folder");
  if (fl && col.contains(fl)) {
    const id = fl.dataset.folder;
    if (drag.kind === "bmf" && drag.from === dst.id && folderDescendants(dst, drag.id).has(id)) return { invalid: true };
    return { into: id, el: fl };
  }
  const li = e.target.closest("li[data-bm]");
  if (li && col.contains(li)) {
    const x = (dst.bookmarks || []).find(y => y.id === li.dataset.bm);
    if (drag.kind === "bmf" && x?.folderId && drag.from === dst.id && folderDescendants(dst, drag.id).has(x.folderId)) return { invalid: true };
    return { before: li, folderId: x?.folderId || null };
  }
  return { folderId: null };
}

function moveBmOrFolder(src, dst, t) {
  const parent = t.into || t.folderId || null;
  dst.bookmarks ||= [];
  if (drag.kind === "bm") {
    const i = src.bookmarks.findIndex(x => x.id === drag.id);
    if (i < 0) return;
    const [x] = src.bookmarks.splice(i, 1);
    x.folderId = parent;
    const at = t.before ? dst.bookmarks.findIndex(y => y.id === t.before.dataset.bm) : -1;
    dst.bookmarks.splice(at < 0 ? dst.bookmarks.length : at, 0, x);
  } else {
    const f = bmFolder(src, drag.id);
    if (!f) return;
    if (src !== dst) {
      // the folder moves with everything inside it (links on notes keep working)
      const inside = folderDescendants(src, f.id);
      const folders = bmFolders(src).filter(g => inside.has(g.id));
      const items = (src.bookmarks || []).filter(x => inside.has(x.folderId));
      src.bmFolders = bmFolders(src).filter(g => !inside.has(g.id));
      src.bookmarks = (src.bookmarks || []).filter(x => !inside.has(x.folderId));
      bmFolders(dst).push(...folders);
      dst.bookmarks.push(...items);
    }
    f.parentId = parent;
    // before the folder it was dropped on, or last among its new siblings
    const rest = bmFolders(dst).filter(g => g !== f);
    const at = t.beforeFolder ? rest.findIndex(g => g.id === t.beforeFolder) : -1;
    rest.splice(at < 0 ? rest.length : at, 0, f);
    dst.bmFolders = rest;
  }
  openBmPath(dst, parent);
}

// ---------- bookmark editor ----------

function editBookmark(b, id, folderId = null) {
  const x = id ? b.bookmarks.find(y => y.id === id) : null;
  const curFolder = x ? (x.folderId || null) : folderId;
  const folderOpts = () => {
    const rows = [];
    const walk = (pid, depth) => bmFolders(b).filter(f => (f.parentId || null) === pid).forEach(f => {
      rows.push(`<option value="${f.id}" ${f.id === curFolder ? "selected" : ""}>${"\u2003".repeat(depth)}${esc(f.name)}</option>`);
      walk(f.id, depth + 1);
    });
    walk(null, 0);
    return `<option value="">— top level</option>` + rows.join("");
  };
  const linked = x ? notesLinkedTo(x.id) : [];
  const o = modal(`<h3>${x ? "Edit link" : `New link in ${esc(b.name)}`}</h3>
    <label class="f">Link<input type="text" id="bmUrl" placeholder="https://…  or a path: /home/…, ~/…" value="${esc(x?.url ? (isLocal(x.url) ? pathOf(x.url) : x.url) : "")}"></label>
    <div class="row pick-row"><span class="hint">or a local</span>
      <button data-x="pick-file">${ICON.file} File${x ? "" : "s"}…</button><button data-x="pick-folder">${ICON.folder} Folder…</button></div>
    <label class="f">Name (optional)<input type="text" id="bmTitle" placeholder="defaults to the site name" value="${esc(x?.title || "")}"></label>
    ${bmFolders(b).length ? `<label class="f">Folder<select id="bmFolder">${folderOpts()}</select></label>` : ""}
    ${x ? `<div class="muted">${linked.length ? `Linked from: ${linked.map(n => esc(n.title)).join(", ")}` : "No notes link to this yet — link it from a note."}</div>` : ""}
    <div class="foot">${x ? `<button class="danger" data-x="del">Delete</button>` : ""}<div class="spacer"></div>
      <button data-x="cancel">Cancel</button><button class="primary" data-x="ok">${x ? "Save" : "Add"}</button></div>`, "small");
  const urlIn = $("#bmUrl", o), titleIn = $("#bmTitle", o);
  urlIn.focus();
  const ok = () => {
    const url = safeUrl(urlIn.value);
    if (!url) { urlIn.focus(); urlIn.style.borderColor = "var(--danger)"; return; }
    const title = titleIn.value.trim() || (isLocal(url) ? baseName(url) : hostOf(url));
    const fid = $("#bmFolder", o) ? ($("#bmFolder", o).value || null) : curFolder;
    const dup = findBookmarkByUrl(url, b, x?.id);
    if (dup) {
      urlIn.style.borderColor = "var(--danger)";
      let err = $(".bm-dup", o);
      if (!err) { err = document.createElement("div"); err.className = "bm-dup due-preview bad"; urlIn.closest("label").after(err); }
      err.innerHTML = `Already in Links as “${esc(dup.b.title)}” in ${bmWhere(dup)} — link that one from your notes.`;
      urlIn.focus();
      return;
    }
    if (x) Object.assign(x, { url, title, folderId: fid });
    else { b.bookmarks ||= []; b.bookmarks.push({ id: uid(), url, title, folderId: fid }); }
    openBmPath(b, fid);
    closeModal(); save(); render();
  };
  o.addEventListener("keydown", e => { if (e.key === "Enter") ok(); });
  o.onclick = e => {
    const a = e.target.closest("[data-x]")?.dataset.x;
    if (a === "ok") ok();
    if (a === "cancel") closeModal();
    if (a === "pick-file" || a === "pick-folder") {
      pickPaths(a === "pick-folder" ? "folder" : "file", !x).then(items => {
        if (!items.length) return;
        if (items.length > 1 && !x) {
          // several files picked for a new bookmark: add them all at once
          const fid = $("#bmFolder", o) ? ($("#bmFolder", o).value || null) : curFolder;
          const skipped = addBookmarks(b, items, fid);
          openBmPath(b, fid);
          closeModal(); save(); render();
          toast(`Added ${items.length - skipped} file${items.length - skipped === 1 ? "" : "s"} to ${esc(b.name)}.${skippedMsg(skipped)}`);
          return;
        }
        urlIn.value = pathOf(items[0].url);   // keeps a folder's trailing /
        if (!titleIn.value.trim()) titleIn.value = items[0].title;
        titleIn.focus();
      });
    }
    if (a === "del") {
      closeModal();
      const snapshot = JSON.stringify(ws);
      b.bookmarks = b.bookmarks.filter(y => y !== x);
      ws.notes.forEach(n => { n.links = (n.links || []).filter(l => l !== x.id); });
      if (ui.bookmark === x.id) ui.bookmark = null;
      save(); render();
      offerUndo(`Deleted link “${esc(x.title)}”.`, snapshot);
    }
  };
}

// ---------- note editor ----------
// Edits apply to the note as you make them (and are saved); Esc or a click
// outside just closes.

const DUE_CHIPS = ["today", "tomorrow", "this week", "next week", "2 weeks", "this month", "next month"];

// a note opened from the board or a view: read it whole, with Edit to change it
function viewNote(n) {
  if (!n) return;
  const b = boardOf(n), sec = section(b, n.sectionId);
  const due = n.due?.target ? `${dueBadge(n)}<span class="hint">${esc(Due.describe(n.due))}</span>` : "";
  const links = linkChips(n);
  const o = modal(`
    <div class="nv-where"><span class="dot" style="background:${b?.color || "var(--faint)"}"></span>${esc(b?.name || "")} › ${esc(sec ? sec.name : "General")}</div>
    <h3 class="nv-title ${isDone(n) ? "is-done" : ""}">${esc(n.title || "(untitled)")}</h3>
    ${(n.body || "").trim() ? `<div class="nv-body">${esc(n.body)}</div>` : `<div class="nv-body empty">No details.</div>`}
    ${(n.tags || []).length || due ? `<div class="nv-meta">${due}${tagPills(n)}</div>` : ""}
    ${links ? `<div class="section-f"><span class="lbl">Links</span><div class="nv-links">${links}</div></div>` : ""}
    <div class="foot">
      <button class="ghost" id="vDone">${ICON.check} ${isDone(n) ? "Not done" : "Mark done"}</button>
      <span class="hint">created ${ago(n.created)}${n.updated && n.updated !== n.created ? ` · edited ${ago(n.updated)}` : ""}</span>
      <div class="spacer"></div><button class="ghost" id="vClose">Close</button><button class="primary" id="vEdit" title="Edit (E)">${ICON.edit} Edit</button></div>`, "note-view");
  $("#vClose", o).onclick = closeModal;
  $("#vEdit", o).onclick = () => openNote(n);
  $("#vDone", o).onclick = () => { toggleDone(n); viewNote(n); };
  o.addEventListener("keydown", e => {
    if (e.key.toLowerCase() === "e" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.matches("input, textarea, select")) { e.preventDefault(); openNote(n); }
  });
  o.tabIndex = -1; o.focus();
}

function openNote(n) {
  if (!n) return;
  const sectionOptions = () => {
    const b = boardOf(n);
    return `<option value="">— none (top of the board)</option>` + (b?.sections || []).map(s => `<option value="${s.id}" ${s.id === n.sectionId ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  };
  const o = modal(`
    <input type="text" class="title-in" id="nTitle" value="${esc(n.title)}" placeholder="Title">
    <div class="row">
      <label class="f" style="flex:1.3">Board<select id="nBoard">${boardOptions(n.boardId, { allowAsleep: false })}</select></label>
      <label class="f" style="flex:1">Section<select id="nSection">${sectionOptions()}</select></label>
    </div>
    <label class="f">Notes<textarea class="body-in" id="nBody" placeholder="Details…">${esc(n.body)}</textarea></label>
    <div class="section-f"><span class="lbl">Tags</span><div class="tag-pick" id="nTags"></div></div>
    <div class="section-f"><span class="lbl">Due <span class="hint">— type it the way you'd say it: “3 days”, “next week”, “2 weeks”, “next month”, “before the 15th”, “friday”</span></span>
      <div class="due-row"><input type="text" id="nDue" placeholder="no due" value="${esc(n.due?.text || "")}"><span class="due-preview" id="nDuePrev"></span></div>
      <div class="due-chips">${DUE_CHIPS.map(c => `<button data-due="${c}">${c}</button>`).join("")}<button data-due="before ">before day…</button><button data-due="">clear</button></div>
    </div>
    <div class="section-f"><span class="lbl">Links <span class="hint">— from any board's Links, or drag one onto the note</span></span>
      <input type="search" id="nLinkFilter" placeholder="filter links…" style="display:none">
      <div class="link-pick" id="nLinks"></div>
      <div class="row"><input type="text" id="nNewUrl" placeholder="add a new link: https://… or a path" style="flex:1.4"><input type="text" id="nNewName" placeholder="name (optional)" style="flex:1"><button id="nAddUrl">Add & link</button>
        <button id="nAddFile" title="Choose local files to add to this board's Links and link here">${ICON.file} Files…</button><button id="nAddFolder" title="Choose a local folder">${ICON.folder}</button></div>
    </div>
    <div class="foot"><button class="danger" id="nDelete">Delete note</button>
      <span class="hint">created ${ago(n.created)}${n.updated && n.updated !== n.created ? ` · edited ${ago(n.updated)}` : ""}</span>
      <div class="spacer"></div><button class="primary" id="nClose">Done</button></div>`);

  const touch = () => { n.updated = nowSec(); save(); };
  const titleIn = $("#nTitle", o);
  if (!n.title) titleIn.focus();
  titleIn.oninput = () => { n.title = titleIn.value; touch(); };
  $("#nBody", o).oninput = e => { n.body = e.target.value; touch(); };
  $("#nBoard", o).onchange = e => {
    n.boardId = e.target.value;
    n.sectionId = null;
    placeAtEnd(n);
    $("#nSection", o).innerHTML = sectionOptions();
    touch();
  };
  $("#nSection", o).onchange = e => { n.sectionId = e.target.value || null; placeAtEnd(n); touch(); };

  // tags
  const renderTags = () => {
    $("#nTags", o).innerHTML = ws.tags.map(t => `<button class="pill ${(n.tags || []).includes(t.name) ? "on" : ""}" data-tag="${esc(t.name)}" style="--tc:${t.color}">${esc(t.name)}</button>`).join("")
      + `<input type="text" id="nNewTag" placeholder="+ new tag">`;
  };
  renderTags();
  $("#nTags", o).addEventListener("click", e => {
    const t = e.target.closest("[data-tag]")?.dataset.tag; if (!t) return;
    n.tags ||= [];
    if (n.tags.includes(t)) n.tags = n.tags.filter(x => x !== t);
    else if (t === "done") markDone(n);
    else n.tags = [...n.tags, t];
    touch(); renderTags();
  });
  $("#nTags", o).addEventListener("keydown", e => {
    if (e.target.id !== "nNewTag" || e.key !== "Enter") return;
    e.preventDefault();
    const t = e.target.value.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
    if (!t) return;
    ensureTags([t]);
    n.tags ||= [];
    if (!n.tags.includes(t)) n.tags.push(t);
    touch(); renderTags();
    $("#nNewTag", o).focus();
  });

  // due
  const dueIn = $("#nDue", o), prev = $("#nDuePrev", o);
  const showDue = () => {
    const d = Due.parse(dueIn.value);
    if (d === "") { prev.textContent = "no due"; prev.className = "due-preview"; return d; }
    if (!d) { prev.textContent = "don't understand that one yet — try “5 days”, “next week”, “before 20”"; prev.className = "due-preview bad"; return d; }
    const s = Due.status(d.target);
    prev.innerHTML = `→ <span class="due ${s.cls}">${ICON.clock}${esc(s.label)}</span>`;
    prev.className = "due-preview";
    return d;
  };
  const applyDue = () => {
    const d = showDue();
    if (d === "") { n.due = null; touch(); }
    else if (d && (!n.due || n.due.text !== d.text || n.due.target !== d.target)) { n.due = { ...d, set: Due.todayIso() }; touch(); }
  };
  if (n.due?.target) {
    const s = Due.status(n.due.target);
    prev.innerHTML = `→ <span class="due ${s.cls}" title="${esc(Due.describe(n.due))}">${ICON.clock}${esc(s.label)}</span>`;
  } else prev.textContent = "no due";
  // only re-resolve when the words change: "next week" set last week keeps its day
  dueIn.oninput = applyDue;
  $(".due-chips", o).onclick = e => {
    const v = e.target.closest("[data-due]")?.dataset.due;
    if (v === undefined) return;
    dueIn.value = v;
    if (v === "before ") { dueIn.focus(); showDue(); prev.textContent = "type a day of the month, e.g. before 15"; return; }
    applyDue();
  };

  // links
  const allBms = () => ws.boards.filter(b => !asleep(b) || b.id === n.boardId).flatMap(b => (b.bookmarks || []).map(x => ({ x, b })));
  const linkFilter = $("#nLinkFilter", o);
  if (allBms().length > 8) linkFilter.style.display = "";
  const renderLinks = () => {
    const q = linkFilter.value.toLowerCase();
    const items = allBms().filter(({ x, b }) => !q || (x.title + " " + x.url + " " + folderPath(b, x.folderId).join(" ")).toLowerCase().includes(q));
    // this note's own board first
    items.sort((a, b) => (a.b.id === n.boardId ? 0 : 1) - (b.b.id === n.boardId ? 0 : 1));
    let last = null, html = "";
    for (const { x, b } of items) {
      if (b !== last) { html += `<div class="grp">${esc(group(b.groupId)?.name || "")} › ${esc(b.name)}</div>`; last = b; }
      const fp = folderPath(b, x.folderId).join(" › ");
      html += `<label><input type="checkbox" data-bm="${x.id}" ${(n.links || []).includes(x.id) ? "checked" : ""}>${fav(x.url)}${esc(x.title)} <span class="u">${fp ? `${esc(fp)} · ` : ""}${esc(hostOf(x.url))}</span></label>`;
    }
    $("#nLinks", o).innerHTML = html || `<div class="none">${allBms().length ? "no match" : "No links yet — add one below, or with + in a board's Links."}</div>`;
  };
  renderLinks();
  linkFilter.oninput = renderLinks;
  $("#nLinks", o).onchange = e => {
    const id = e.target.dataset.bm; if (!id) return;
    n.links ||= [];
    n.links = e.target.checked ? [...n.links, id] : n.links.filter(x => x !== id);
    touch();
  };
  const addUrl = () => {
    const url = safeUrl($("#nNewUrl", o).value);
    if (!url) return;
    const b = boardOf(n);
    // the same address already bookmarked (on any board): link that one
    const dup = findBookmarkByUrl(url, b);
    const name = $("#nNewName", o).value.trim();
    const x = dup ? dup.b : { id: uid(), url, title: name || (isLocal(url) ? baseName(url) : hostOf(url)) };
    if (!dup) { b.bookmarks ||= []; b.bookmarks.push(x); }
    n.links ||= [];
    if (!n.links.includes(x.id)) n.links.push(x.id);
    $("#nNewUrl", o).value = "";
    $("#nNewName", o).value = "";
    $("#nNewUrl", o).focus();
    touch(); renderLinks();
    if (dup) toast(`Already in Links (“${esc(x.title)}” in ${bmWhere(dup)}) — linked it.`);
  };
  $("#nAddUrl", o).onclick = addUrl;
  const addPicked = async kind => {
    const items = await pickPaths(kind, kind === "file");
    if (!items.length) return;
    const b = boardOf(n);
    b.bookmarks ||= [];
    n.links ||= [];
    for (const it of items) {
      // reuse a bookmark for the same path (this board's first, then any board's)
      let x = findBookmarkByUrl(it.url, b)?.b;
      if (!x) { x = { id: uid(), url: it.url, title: it.title }; b.bookmarks.push(x); }
      if (!n.links.includes(x.id)) n.links.push(x.id);
    }
    touch(); renderLinks();
  };
  $("#nAddFile", o).onclick = () => addPicked("file");
  $("#nAddFolder", o).onclick = () => addPicked("folder");
  $("#nNewUrl", o).onkeydown = e => { if (e.key === "Enter") addUrl(); };
  $("#nNewName", o).onkeydown = e => { if (e.key === "Enter") addUrl(); };

  o._close = () => { closeModal(); render(); };
  $("#nClose", o).onclick = o._close;
  $("#nDelete", o).onclick = () => {
    const snapshot = JSON.stringify(ws);
    ws.notes = ws.notes.filter(x => x !== n);
    closeModal(); save(); render();
    offerUndo(`Deleted “${esc(n.title || "note")}”.`, snapshot);
  };
}

function ago(sec) {
  if (!sec) return "";
  const d = Math.floor((Date.now() / 1000 - sec) / 86400);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 365) return `${Math.round(d / 30.4)} months ago`;
  return `${Math.round(d / 365)} years ago`;
}

// ---------- table ----------

const COLS = [
  { key: "done", label: "", w: "40px" },
  { key: "title", label: "Note" },
  { key: "section", label: "Section" },
  { key: "board", label: "Board" },
  { key: "tags", label: "Tags" },
  { key: "due", label: "Due" },
  { key: "links", label: "Links" },
  { key: "updated", label: "Edited" },
  { key: "created", label: "Created" },
];

function sortValue(n, key) {
  switch (key) {
    case "done": return isDone(n) ? 1 : 0;
    case "title": return (n.title || "").toLowerCase();
    case "section": {
      // by section name first, so "Formações" of every board sit together; then board order
      const b = boardOf(n);
      const name = sectionKey(sectionName(n));
      const pos = ws.groups.indexOf(group(b?.groupId)) * 1e6 + ws.boards.indexOf(b) * 1e3;
      return `${name === "general" ? "\uffff" : name}|${String(pos).padStart(12, "0")}`;
    }
    case "board": {
      // group order, then board order, then section order
      const b = boardOf(n);
      return ws.groups.indexOf(group(b?.groupId)) * 1e6 + ws.boards.indexOf(b) * 1e3 + ((b?.sections || []).findIndex(s => s.id === n.sectionId) + 1);
    }
    case "tags": return (n.tags || []).slice().sort().join(" ") || "￿";
    case "due": return n.due?.target || null;
    case "links": return (n.links || []).length;
    case "updated": return n.updated || 0;
    case "created": return n.created || 0;
  }
}

function renderTable(main) {
  const { key, dir } = ui.sort;
  const rows = ws.notes.filter(matches).map((n, i) => ({ n, i, v: sortValue(n, key) }));
  rows.sort((a, b) => {
    // notes without a due always go last, whichever way you sort
    if (a.v === null && b.v !== null) return 1;
    if (b.v === null && a.v !== null) return -1;
    if (a.v < b.v) return -dir;
    if (a.v > b.v) return dir;
    return a.i - b.i;
  });
  main.innerHTML = `<div class="table-wrap"><table class="notes-table">
    <thead><tr>${COLS.map(c => `<th data-sort="${c.key}" ${c.w ? `style="width:${c.w}"` : ""}>${c.label} <span class="arr">${key === c.key ? (dir > 0 ? "▲" : "▼") : ""}</span></th>`).join("")}</tr></thead>
    <tbody>${rows.map(({ n }) => {
      const b = boardOf(n), g = group(b?.groupId), s = section(b, n.sectionId);
      return `<tr class="row ${isDone(n) ? "is-done" : ""}" data-note="${n.id}">
        <td><button class="check" data-act="done" title="${isDone(n) ? "not done" : "mark done"}">${ICON.check}</button></td>
        <td class="t"><div>${esc(n.title || "(untitled)")}</div>${n.body ? `<div class="sub">${esc(n.body.split("\n")[0])}</div>` : ""}</td>
        <td><span class="sec-cell" style="--pc:${b?.color || "var(--border)"}"><b>${esc(s ? s.name : "General")}</b> — ${esc(b?.name || "?")}</span></td>
        <td><div class="proj" style="--pc:${b?.color || "var(--border)"}"><i></i>${esc(b?.name || "?")}${hiddenB(b) ? ` <span class="flag" title="hidden board">${ICON.eyeOff}</span>` : ""}</div>
          <div class="sub">${esc(g?.name || "")}</div></td>
        <td class="tags">${tagPills(n)}</td>
        <td>${dueBadge(n) || `<span class="hint">—</span>`}</td>
        <td class="links">${linkChips(n)}</td>
        <td class="dim">${ago(n.updated)}</td>
        <td class="dim">${ago(n.created)}</td></tr>`;
    }).join("")}</tbody></table>
    ${rows.length ? "" : `<div class="table-empty">${ws.notes.length ? "No notes match the filters." : "No notes yet — add them in the Board view."}</div>`}</div>`;
}

// ---------- settings ----------

$("#settingsBtn").onclick = openSettings;

async function openSettings() {
  const { data: cfg } = await api("GET", "/api/config");
  const o = modal(`<h3>Settings</h3>
    <div class="row">
      <label class="f">Theme<select id="sTheme"><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label class="f" style="flex:1">Text size <input type="range" id="sScale" min="0.85" max="1.5" step="0.05"></label>
      <label class="f" style="flex:1" title="Boards are never narrower than this; they stretch to fill the row and wrap onto a new row when they don't fit">Board width (minimum) <input type="range" id="sColMin" min="200" max="480" step="10"></label>
    </div>
    <div class="section-f"><span class="lbl">Data folder</span>
      <div class="muted">Everything is saved as <code>${esc(cfg.board_file || "")}</code> (with a <code>.bak</code> of the previous save next to it).</div>
      <div class="row"><input type="text" id="sDir" value="${esc(cfg.data_dir || "")}" style="flex:1"><button id="sSwitch">Switch</button></div>
      <label class="muted"><input type="checkbox" id="sCopy" checked> if that folder has no board.json yet, copy the current one there (otherwise start empty)</label>
      <div id="sErr" class="due-preview bad"></div>
    </div>
    <div class="section-f"><span class="lbl">Tags</span><div class="tag-manage" id="sTags"></div>
      <div class="row"><input type="text" id="sNewTag" placeholder="new tag" style="flex:1"><button id="sAddTag">Add tag</button></div></div>
    <div class="foot"><span class="hint">Tip: quick add understands <code>#tag</code> and <code>!next week</code></span><div class="spacer"></div><button class="primary" id="sClose">Close</button></div>`);
  $("#sTheme", o).value = settings.theme === "light" ? "light" : "dark";
  $("#sScale", o).value = settings.scale || 1;
  $("#sTheme", o).onchange = e => { settings.theme = e.target.value; applyLook(); saveSettings(); };
  $("#sScale", o).oninput = e => { settings.scale = +e.target.value; applyLook(); saveSettings(); };
  $("#sColMin", o).value = settings.colMin || 280;
  $("#sColMin", o).oninput = e => { settings.colMin = +e.target.value; applyLook(); saveSettings(); };
  o._close = () => { closeModal(); render(); };
  $("#sClose", o).onclick = o._close;

  $("#sSwitch", o).onclick = async () => {
    await flush();
    const { data } = await api("POST", "/api/config", { data_dir: $("#sDir", o).value, copy: $("#sCopy", o).checked });
    if (!data.ok) { $("#sErr", o).textContent = data.error; return; }
    closeModal();
    await loadBoard();
    toast(data.found_existing ? `Opened the board in ${esc(data.data_dir)}` : `Now saving to ${esc(data.data_dir)}`);
  };

  const renderTagList = () => {
    $("#sTags", o).innerHTML = ws.tags.map((t, i) => {
      const uses = ws.notes.filter(n => (n.tags || []).includes(t.name)).length;
      return `<div class="tm" data-i="${i}"><input type="color" value="${t.color}"><input type="text" value="${esc(t.name)}">
        <span class="hint" style="width:60px">${uses} note${uses === 1 ? "" : "s"}</span><button class="ghost icon" data-del="${i}" title="delete tag">${ICON.x}</button></div>`;
    }).join("");
  };
  renderTagList();
  $("#sTags", o).addEventListener("input", e => {
    const t = ws.tags[e.target.closest(".tm").dataset.i];
    if (e.target.type === "color") { t.color = e.target.value; save(); }
  });
  $("#sTags", o).addEventListener("change", e => {
    if (e.target.type !== "text") return;
    const t = ws.tags[e.target.closest(".tm").dataset.i];
    const name = e.target.value.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name || name === t.name) { e.target.value = t.name; return; }
    if (ws.tags.some(x => x.name === name)) ws.tags = ws.tags.filter(x => x !== t);   // renaming onto an existing tag merges them
    ws.notes.forEach(n => { if ((n.tags || []).includes(t.name)) n.tags = [...new Set(n.tags.map(x => (x === t.name ? name : x)))]; });
    if (ui.tags[t.name]) { ui.tags[name] = ui.tags[t.name]; delete ui.tags[t.name]; }
    t.name = name;
    save(); renderTagList();
  });
  $("#sTags", o).addEventListener("click", e => {
    const i = e.target.closest("[data-del]")?.dataset.del; if (i === undefined) return;
    const t = ws.tags[i];
    ws.tags.splice(i, 1);
    ws.notes.forEach(n => { n.tags = (n.tags || []).filter(x => x !== t.name); });
    delete ui.tags[t.name];
    save(); renderTagList();
  });
  const addTag = () => {
    const name = $("#sNewTag", o).value.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
    if (!name) return;
    ensureTags([name]);
    $("#sNewTag", o).value = "";
    save(); renderTagList();
  };
  $("#sAddTag", o).onclick = addTag;
  $("#sNewTag", o).onkeydown = e => { if (e.key === "Enter") addTag(); };
}

// ---------- keep-alive (see /api/alive in main.py) ----------
// One long-lived connection per open page. When taskwise was started from the
// app menu, it stops itself once no page holds one - this also shows a
// notice if taskwise has stopped while the page is still open, and reloads the
// page when it reconnects to an updated taskwise.
(function keepAlive() {
  let offlineTimer = null;
  let version = null;
  const es = new EventSource("/api/alive");
  es.addEventListener("version", async e => {
    if (version === null) { version = e.data; return; }
    if (e.data === version) return;
    await flush();
    location.reload();
  });
  es.onopen = () => {
    clearTimeout(offlineTimer);
    offlineTimer = null;
    document.body.classList.remove("app-offline");
    checkExternal();
    if (dirty) flush();
  };
  es.onerror = () => {
    if (!offlineTimer) offlineTimer = setTimeout(() => document.body.classList.add("app-offline"), 4000);
  };
})();

// ---------- update notice (see /api/update in main.py) ----------
// Asked again soon after load because a server just started by this page's
// own visit is still waiting for GitHub's first answer.
async function checkUpdate() {
  const { data } = await api("GET", "/api/update").catch(() => ({}));
  if (data) $("#updateNotice").hidden = !data.available;
}
checkUpdate();
setTimeout(checkUpdate, 20000);
setInterval(checkUpdate, 3600000);

// re-label dues when the day changes while the page stays open
let lastDay = Due.todayIso();
setInterval(() => { if (Due.todayIso() !== lastDay) { lastDay = Due.todayIso(); render(); } }, 60000);

// ---------- start ----------
(async () => {
  const { data } = await api("GET", "/api/settings");
  settings = data || {};
  ui = { ...structuredClone(DEFAULT_UI), ...(settings.ui || {}), bookmark: null };
  ui.vopt ||= {};
  if (!$(`#viewSeg [data-view="${ui.view}"]`)) ui.view = "board";
  delete ui.project;
  applyLook();
  api("GET", "/api/config").then(r => { HOME = r.data.home || ""; });
  await loadBoard();
})();
