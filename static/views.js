// taskwise - more ways to look at the same notes, next to Board and Table:
//
//   agenda     notes in lanes by when they're due; drop a card on a lane to
//              give it that due ("next week", "this month"…)
//   focus      one short list: overdue, due today and tagged urgent
//   tags       one column per tag; dragging a card swaps the tag (Ctrl adds it)
//   sections   same-named sections of every board side by side
//   bookmarks  every board's bookmarks in one tree, with the notes linked to each
//   list       one dense line per note, grouped by board
//
// All of them use the filter bar like Board and Table do. Loaded after
// app.js and uses its state and helpers (ws, ui, matches, cardHtml…).
"use strict";

// per-view options (saved with the other UI settings)
const vopt = (k, d) => (ui.vopt && k in ui.vopt ? ui.vopt[k] : d);
function setVopt(k, v) { ui.vopt ||= {}; ui.vopt[k] = v; saveSettings(); }
// folded lanes / blocks, keyed per view; some start folded
const isFolded = (key, dflt = false) => vopt("fold:" + key, dflt);
const toggleFold = (key, dflt = false) => setVopt("fold:" + key, !isFolded(key, dflt));

// board order: groups top to bottom, then boards within each group
const boardRank = b => ws.groups.indexOf(group(b?.groupId)) * 1e4 + ws.boards.indexOf(b);
const byPlace = (a, b) => boardRank(boardOf(a)) - boardRank(boardOf(b)) || ws.notes.indexOf(a) - ws.notes.indexOf(b);
const byDue = (a, b) => (a.due?.target || "9999").localeCompare(b.due?.target || "9999") || byPlace(a, b);

// "Board › Section", so a card still says where it lives
function whereHtml(n, { showBoard = true, showSection = true } = {}) {
  const b = boardOf(n), s = section(b, n.sectionId);
  const parts = [];
  if (showBoard) parts.push(`<span class="dot" style="background:${b?.color || "var(--faint)"}"></span>${esc(b?.name || "?")}`);
  if (showSection && s) parts.push(esc(s.name));
  return parts.length ? `<div class="where">${parts.join('<span class="sep">›</span>')}</div>` : "";
}
function vCard(n, opts = {}) {
  return `<div class="card ${isDone(n) ? "is-done" : ""} ${opts.big ? "big" : ""}" draggable="${opts.drag === false ? "false" : "true"}" data-note="${n.id}">
    <button class="check" data-act="done" title="${isDone(n) ? "not done" : "mark done"}">${ICON.check}</button>
    ${whereHtml(n, opts)}
    <div class="title">${esc(n.title || "(untitled)")}</div>
    ${n.body ? `<div class="body">${esc(n.body)}</div>` : ""}
    <div class="meta">${dueBadge(n)}${tagPills(n)}${linkChips(n)}</div>
  </div>`;
}
// a one-line note row (List and Bookmarks views)
function rowHtml(n, { showBoard = false } = {}) {
  const b = boardOf(n), s = section(b, n.sectionId), first = (n.body || "").split("\n")[0];
  const nl = (n.links || []).filter(id => bookmark(id)).length;
  return `<div class="crow ${isDone(n) ? "is-done" : ""}" data-note="${n.id}">
    <button class="check" data-vact="done" title="${isDone(n) ? "not done" : "mark done"}">${ICON.check}</button>
    <span class="t"><span class="tt">${esc(n.title || "(untitled)")}</span>${first ? `<span class="sub">${esc(first)}</span>` : ""}</span>
    ${showBoard ? `<span class="where-chip"><span class="dot" style="background:${b?.color || "var(--faint)"}"></span>${esc(b?.name || "?")}</span>` : ""}
    ${s ? `<span class="sec-chip">${esc(s.name)}</span>` : ""}
    <span class="rmeta">${tagPills(n)}${dueBadge(n)}${nl ? `<span class="nlinks" title="${nl} link${nl === 1 ? "" : "s"}">${ICON.link}${nl}</span>` : ""}</span>
  </div>`;
}

// a column of cards. drop: what dropping a card here does (shown as a hint)
function laneHtml({ key, title, color, notes, body, drop, foldKey, foldDefault = false, hint = "", extra = "" }) {
  const folded = foldKey ? isFolded(foldKey, foldDefault) : false;
  return `<section class="lane ${folded ? "folded" : ""}" data-lane="${esc(key)}" ${drop ? `data-drop="1" title="${esc(drop)}"` : ""} style="--pc:${color || "var(--border-strong)"}">
    <div class="lane-head" ${foldKey ? `data-fold="${esc(foldKey)}" data-fold-default="${foldDefault ? 1 : 0}"` : ""}>
      ${foldKey ? `<span class="arrow">${ICON.chevron}</span>` : ""}<span class="dot"></span><h2>${esc(title)}</h2><span class="n">${notes.length}</span>${extra}
    </div>
    ${folded ? "" : `<div class="lane-body">${body ?? notes.map(n => vCard(n)).join("")}${!notes.length && !body ? `<div class="lane-empty">${hint || "Nothing here"}</div>` : ""}</div>`}
  </section>`;
}

function emptyHtml(title, text) {
  return `<div class="empty-board"><h2>${title}</h2><p>${text}</p></div>`;
}
const noNotesYet = () => !awakeNotes().length;
const noBoardsMsg = () => emptyHtml("No notes yet", "Add notes on the <b>Board</b> view; they show up here too.");

// keep the scroll position of the view and of each lane across re-renders
function keepScroll(main, paint) {
  const top = main.scrollTop, left = main.scrollLeft, lanes = {};
  $$(".lane", main).forEach(l => { lanes[l.dataset.lane] = $(".lane-body", l)?.scrollTop || 0; });
  paint();
  $$(".lane", main).forEach(l => { const b = $(".lane-body", l); if (b) b.scrollTop = lanes[l.dataset.lane] || 0; });
  main.scrollTop = top; main.scrollLeft = left;
}
const vbar = html => `<div class="vbar">${html}</div>`;
const optCheck = (k, dflt, label, title = "") =>
  `<label class="vopt" title="${esc(title)}"><input type="checkbox" data-vopt="${k}" ${vopt(k, dflt) ? "checked" : ""}> ${label}</label>`;

// ---------- 1. agenda ----------

const AGENDA = [
  { key: "overdue", label: "Overdue", color: "var(--danger)" },
  { key: "today", label: "Today", set: "today", color: "var(--danger)" },
  { key: "tomorrow", label: "Tomorrow", set: "tomorrow", color: "var(--warn)" },
  { key: "week", label: "Later this week", set: "this week", color: "var(--warn)" },
  { key: "nextweek", label: "Next week", set: "next week", color: "var(--accent)" },
  { key: "month", label: "Later this month", set: "this month", color: "#8b5cf6" },
  { key: "later", label: "Later", set: "next month", color: "#64748b" },
  { key: "none", label: "No due", set: "", color: "var(--border-strong)" },
];
// a lane is only there if some day still falls in it (e.g. no "later this
// week" on a Saturday): its words must land in it today
const agendaLaneLive = l => l.key === "overdue" || l.set === "" || Due.lane(Due.parse(l.set)?.target) === l.key;

function renderAgenda(main) {
  if (noNotesYet()) { main.innerHTML = noBoardsMsg(); return; }
  const showDone = vopt("agendaDone", false);
  const shown = ws.notes.filter(matches);
  const notes = shown.filter(n => showDone || !isDone(n));
  const by = {};
  for (const n of notes) (by[Due.lane(n.due?.target)] ||= []).push(n);
  const doneHidden = shown.length - notes.length;
  keepScroll(main, () => {
    main.innerHTML = `<div class="vwrap">${vbar(`<span class="hint">Drop a card on a lane to give it that due.</span>
      <span class="spacer"></span>${doneHidden ? `<span class="hint">${doneHidden} done not shown</span>` : ""}${optCheck("agendaDone", false, "Show done")}`)}
      <div class="lanes">${AGENDA.filter(l => agendaLaneLive(l) && (l.key !== "overdue" || by.overdue?.length)).map(l => laneHtml({
        key: l.key, title: l.label, color: l.color, notes: (by[l.key] || []).sort(byDue),
        drop: l.key === "overdue" ? "" : l.set ? `Drop here: due “${l.set}”` : "Drop here to clear the due",
        foldKey: l.key === "none" ? "agenda:none" : "",
        hint: l.key === "none" ? "Every note has a due" : "Nothing due",
      })).join("")}</div></div>`;
  });
}
function dropAgenda(n, lane) {
  const l = AGENDA.find(x => x.key === lane.dataset.lane);
  if (!l || l.key === "overdue") return false;
  if (l.set === "") n.due = null;
  else { const d = Due.parse(l.set); if (!d) return false; n.due = { ...d, set: Due.todayIso() }; }
  return true;
}

// ---------- 2. focus ----------

function renderFocus(main) {
  if (noNotesYet()) { main.innerHTML = noBoardsMsg(); return; }
  const tag = vopt("focusTag", "urgent");
  const shown = ws.notes.filter(matches);
  const open = shown.filter(n => !isDone(n));
  const lanes = {};
  const seen = new Set();
  const take = (key, list) => { lanes[key] = list.filter(n => !seen.has(n.id)); lanes[key].forEach(n => seen.add(n.id)); };
  take("overdue", open.filter(n => Due.lane(n.due?.target) === "overdue").sort(byDue));
  take("today", open.filter(n => Due.lane(n.due?.target) === "today").sort(byPlace));
  take("urgent", tag ? open.filter(n => (n.tags || []).includes(tag)).sort(byDue) : []);
  const today = Due.todayIso();
  const doneToday = shown.filter(n => isDone(n) && n.updated && isoDay(n.updated) === today).sort((a, b) => b.updated - a.updated);
  const tomorrow = open.filter(n => !seen.has(n.id) && Due.lane(n.due?.target) === "tomorrow").length;
  const total = seen.size;
  const tagOpts = ws.tags.filter(t => t.name !== "done").map(t => `<option value="${esc(t.name)}" ${t.name === tag ? "selected" : ""}>#${esc(t.name)}</option>`).join("");
  const block = (key, title, cls, list) => list.length ? `<div class="focus-block ${cls}">
      <div class="focus-head"><h2>${title}</h2><span class="n">${list.length}</span></div>
      <div class="focus-list">${list.map(n => vCard(n, { big: true, drag: false })).join("")}</div></div>` : "";
  keepScroll(main, () => {
    main.innerHTML = `<div class="vwrap focus">
      ${vbar(`<span class="focus-sum">${total ? `<b>${total}</b> to do` : "All clear"}${doneToday.length ? ` · <b>${doneToday.length}</b> done today` : ""}</span>
        <span class="spacer"></span>
        <label class="vopt" title="Notes with this tag are in Focus whatever their due">Also tagged <select data-vopt="focusTag"><option value="">(none)</option>${tagOpts}</select></label>`)}
      ${block("overdue", "Overdue", "is-overdue", lanes.overdue)}
      ${block("today", "Today", "is-today", lanes.today)}
      ${tag ? block("urgent", `Tagged #${esc(tag)}`, "is-tag", lanes.urgent) : ""}
      ${total ? "" : `<div class="focus-clear">${ICON.check}<div><b>Nothing overdue, due today${tag ? ` or tagged #${esc(tag)}` : ""}.</b>
        <div class="muted">${tomorrow ? `${tomorrow} note${tomorrow === 1 ? " is" : "s are"} due tomorrow — see the Agenda.` : "Enjoy it."}</div></div></div>`}
      ${doneToday.length ? `<div class="focus-block is-done-today"><div class="focus-head"><h2>Done today</h2><span class="n">${doneToday.length}</span></div>
        <div class="focus-done">${doneToday.map(n => rowHtml(n, { showBoard: true })).join("")}</div></div>` : ""}
    </div>`;
  });
}
const isoDay = sec => { const d = new Date(sec * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// ---------- 3. tags ----------

function renderTags(main) {
  if (noNotesYet()) { main.innerHTML = noBoardsMsg(); return; }
  const shown = ws.notes.filter(matches).sort(byPlace);
  const open = shown.filter(n => !isDone(n));
  const filtered = filtersActive();
  const cols = [];
  for (const t of ws.tags) {
    if (t.name === "done" || ui.tags[t.name] === -1) continue;
    const list = open.filter(n => (n.tags || []).includes(t.name));
    if (!list.length && filtered) continue;
    cols.push(laneHtml({ key: "t:" + t.name, title: "#" + t.name, color: t.color, notes: list,
      drop: `Drop here to tag it #${t.name} (moves it from the column it came from; hold Ctrl to keep that tag too)`, hint: "No open notes with this tag" }));
  }
  const untagged = open.filter(n => !(n.tags || []).some(x => x !== "done"));
  cols.push(laneHtml({ key: "none", title: "No tag", color: "var(--border-strong)", notes: untagged, drop: "Drop here to remove its tags", hint: "Every open note has a tag" }));
  if (ui.tags.done !== -1) {
    const done = shown.filter(isDone);
    cols.push(laneHtml({ key: "done", title: "Done", color: "var(--ok)", notes: done, drop: "Drop here to mark it done (urgent and waiting tags are removed)",
      foldKey: "tags:done", foldDefault: true, hint: "Nothing done yet" }));
  }
  keepScroll(main, () => {
    main.innerHTML = `<div class="vwrap">${vbar(`<span class="hint">A note with several tags shows in each of their columns. Drag a card to another column to swap the tag; hold <b>Ctrl</b> while dropping to add it instead.</span>`)}
      <div class="lanes">${cols.join("")}</div></div>`;
  });
}
function dropTags(n, lane, sub, e) {
  const to = lane.dataset.lane, from = drag.fromLane || "";
  if (to === from) return false;
  n.tags ||= [];
  if (to === "done") { if (!isDone(n)) { markDone(n); placeAtEnd(n); } return true; }
  if (to === "none") { n.tags = n.tags.filter(x => x === "done" && from !== "done"); return true; }
  const name = to.slice(2);
  if (from === "done") n.tags = n.tags.filter(x => x !== "done");
  else if (from.startsWith("t:") && !e.ctrlKey) n.tags = n.tags.filter(x => x !== from.slice(2));
  if (!n.tags.includes(name)) n.tags.push(name);
  return true;
}

// ---------- 4. sections across boards ----------

function sectionColumns() {
  // every section name on an awake board, in the order you first meet it
  // going through the boards; General first
  const cols = new Map([["general", { key: "general", name: "General", boards: [] }]]);
  const boards = ws.boards.filter(b => !asleep(b) && (!ui.board || b.id === ui.board)).sort((a, b) => boardRank(a) - boardRank(b));
  for (const b of boards) for (const s of orderedSections(b)) {
    const key = s ? sectionKey(s.name) : "general";
    if (!cols.has(key)) cols.set(key, { key, name: s.name, boards: [] });
    cols.get(key).boards.push(b);
  }
  return [...cols.values()];
}
function renderSections(main) {
  if (noNotesYet()) { main.innerHTML = noBoardsMsg(); return; }
  const shown = ws.notes.filter(matches).sort(byPlace);
  const filtered = filtersActive();
  const lanes = sectionColumns().map(c => {
    if (ui.section && ui.section !== c.key) return "";
    const notes = shown.filter(n => sectionKey(sectionName(n)) === c.key);
    // General is on every board: only list the boards that have notes there
    const boards = c.boards.filter(b => notes.some(n => n.boardId === b.id) || (c.key !== "general" && !filtered));
    if (!notes.length && (filtered || c.key === "general")) return "";
    const body = boards.map(b => {
      const list = notes.filter(n => n.boardId === b.id);
      const fk = `sections:${c.key}:${b.id}`;
      const folded = isFolded(fk);
      return `<div class="lane-sub ${folded ? "folded" : ""}" data-sub="${b.id}" style="--pc:${b.color || "var(--border)"}" title="Drop here: move it to “${esc(c.name)}” on ${esc(b.name)}">
        <div class="sub-head" data-fold="${esc(fk)}"><span class="arrow">${ICON.chevron}</span><span class="dot"></span><span class="nm">${esc(b.name)}</span>${hiddenB(b) ? `<span class="flag" title="hidden board">${ICON.eyeOff}</span>` : ""}<span class="n">${list.length}</span></div>
        ${folded ? "" : `<div class="sub-body">${list.map(n => vCard(n, { showBoard: false, showSection: false })).join("") || `<div class="lane-empty">Empty</div>`}</div>`}
      </div>`;
    }).join("");
    return laneHtml({ key: c.key, title: c.name, notes, body, color: "var(--accent)",
      drop: `Drop on a board's block to move it to “${c.name}” there, or anywhere else here to keep its board`,
      extra: `<span class="hint lane-boards">${c.boards.length > 1 && c.key !== "general" ? `${c.boards.length} boards` : ""}</span>` });
  }).join("");
  keepScroll(main, () => {
    main.innerHTML = `<div class="vwrap">${vbar(`<span class="hint">Sections with the same name on different boards, side by side. Drag a card onto another section to move it there.</span>`)}
      <div class="lanes">${lanes || `<div class="lane-empty">No notes match the filters.</div>`}</div></div>`;
  });
}
function dropSections(n, lane, sub) {
  const key = lane.dataset.lane;
  const col = sectionColumns().find(c => c.key === key);
  if (!col) return false;
  const b = sub ? boardById(sub.dataset.sub) : boardOf(n);
  if (!b) return false;
  let secId = null;
  if (key !== "general") {
    let s = b.sections.find(x => sectionKey(x.name) === key);
    if (!s) { s = { id: uid(), name: col.name }; b.sections.push(s); toast(`Added a “${esc(col.name)}” section to ${esc(b.name)}.`); }
    secId = s.id;
  }
  if (n.boardId === b.id && (n.sectionId || null) === secId) return false;
  n.boardId = b.id; n.sectionId = secId;
  placeAtEnd(n);
  return true;
}

// ---------- 6. bookmarks ----------

function renderBookmarks(main) {
  const onlyLinked = vopt("bmOnlyLinked", false), showNotes = vopt("bmNotes", true);
  const q = ui.q.toLowerCase().split(/\s+/).filter(Boolean);
  // filters other than search (and board) narrow things down to bookmarks with matching notes
  const noteFilters = ui.due !== "all" || ui.section || ui.bookmark || Object.keys(ui.tags).length;
  // with nothing narrowing it down, empty folders and boards show too, so
  // things can be dragged into them
  const showEmpty = !noteFilters && !q.length && !onlyLinked;
  const boards = ws.boards.filter(b => !asleep(b) && (!ui.board || b.id === ui.board)).sort((a, b) => boardRank(a) - boardRank(b));
  let total = 0;

  const bmRow = (b, x, depth) => {
    const linked = notesLinkedTo(x.id).filter(n => !asleep(boardOf(n)));
    const hits = linked.filter(matches).sort(byPlace);
    const selfHit = q.length && q.every(w => `${x.title} ${x.url}`.toLowerCase().includes(w));
    if (onlyLinked && !linked.length) return "";
    if (noteFilters && !hits.length) return "";
    if (q.length && !selfHit && !hits.length) return "";
    // when the bookmark itself matched the search, show all its notes
    const list = q.length && selfHit && !noteFilters ? linked.filter(n => !asleep(boardOf(n))).sort(byPlace) : hits;
    total++;
    return `<div class="bmv-item" style="--d:${depth}">
      <div class="bmv-row" draggable="true" data-bm="${x.id}" data-board="${b.id}" title="drag to move it">
        <span class="grip">${ICON.grip}</span>
        <a href="${esc(x.url)}" draggable="false" target="_blank" rel="noopener noreferrer" title="${esc(x.url)}">${fav(x.url)}<span class="bt">${esc(x.title)}</span></a>
        <span class="host">${esc(hostOf(x.url))}</span>
        <span class="spacer"></span>
        ${linked.length ? `<span class="lc" title="${linked.length} note(s) linked">${linked.length}</span>` : ""}
        <button class="ghost icon" data-vact="edit-bm" data-board="${b.id}" data-bm="${x.id}" title="Edit">${ICON.edit}</button>
      </div>
      ${showNotes && list.length ? `<div class="bmv-notes">${list.map(n => rowHtml(n, { showBoard: n.boardId !== b.id })).join("")}</div>` : ""}
    </div>`;
  };
  const tree = (b, parentId, depth) => {
    let html = "";
    for (const f of bmFolders(b).filter(f => (f.parentId || null) === parentId)) {
      const inner = tree(b, f.id, depth + 1);
      if (!inner && !showEmpty) continue;
      const fk = "bmf:" + f.id, folded = isFolded(fk);
      html += `<div class="bmv-folder ${folded ? "folded" : ""}" style="--d:${depth}" data-fold="${esc(fk)}" draggable="true" data-folder="${f.id}" data-board="${b.id}" title="drag to move the folder with everything in it">
        <span class="grip">${ICON.grip}</span><span class="arrow">${ICON.chevron}</span>${ICON.folder}<span class="fname">${esc(f.name)}</span><span class="n">${bmCountIn(b, f.id)}</span>${showEmpty ? `<button class="ghost icon bmv-add" data-vact="new-bmf" data-board="${b.id}" data-parent="${f.id}" title="New subfolder" aria-label="New subfolder">${ICON.plus}</button>` : ""}</div>
        ${folded ? "" : inner || `<div class="bmv-empty" style="--d:${depth + 1}">Empty folder</div>`}`;
    }
    for (const x of (b.bookmarks || []).filter(x => (x.folderId || null) === parentId)) html += bmRow(b, x, depth);
    return html;
  };
  const blocks = boards.map(b => {
    const inner = tree(b, null, 0);
    if (!inner && !showEmpty) return "";
    const fk = "bmb:" + b.id, folded = isFolded(fk);
    return `<section class="bmv-board ${folded ? "folded" : ""}" data-board="${b.id}" style="--pc:${b.color || "var(--border)"}">
      <div class="bmv-head" data-fold="${esc(fk)}"><span class="arrow">${ICON.chevron}</span><span class="dot"></span><h2>${esc(b.name)}</h2>
        <span class="hint">${esc(group(b.groupId)?.name || "")}</span>${hiddenB(b) ? `<span class="flag" title="hidden board">${ICON.eyeOff}</span>` : ""}
        <span class="n">${(b.bookmarks || []).length}</span>
        ${showEmpty ? `<button class="ghost bmv-new-folder" data-vact="new-bmf" data-board="${b.id}" title="New folder in this board">${ICON.plus} Folder</button>` : ""}</div>
      ${folded ? "" : `<div class="bmv-body">${inner || `<div class="bmv-empty">No links — drag some here</div>`}</div>`}
    </section>`;
  }).join("");
  const any = ws.boards.some(b => !asleep(b) && (b.bookmarks || []).length);
  keepScroll(main, () => {
    main.innerHTML = `<div class="vwrap bmv">${vbar(`<span class="hint">Every board's links, with the notes linked to each.</span><span class="spacer"></span>
        ${optCheck("bmNotes", true, "Show notes")}${optCheck("bmOnlyLinked", false, "Only links with notes")}`)}
      ${blocks || (any ? `<div class="lane-empty">No links match.</div>` : emptyHtml("No links yet", "Add them from the <b>Links</b> fold-out at the top of each board in the <b>Board</b> view."))}
    </div>`;
  });
  return total;
}

// ---------- 7. compact list ----------

function renderList(main) {
  if (noNotesYet()) { main.innerHTML = noBoardsMsg(); return; }
  const shown = ws.notes.filter(matches).sort(byPlace);
  const boards = ws.boards.filter(b => !asleep(b)).sort((a, b) => boardRank(a) - boardRank(b));
  const blocks = boards.map(b => {
    const list = shown.filter(n => n.boardId === b.id);
    if (!list.length) return "";
    // within a board: its sections in their order
    const order = orderedSections(b).map(s => (s ? s.id : null));
    list.sort((x, y) => order.indexOf(x.sectionId || null) - order.indexOf(y.sectionId || null) || ws.notes.indexOf(x) - ws.notes.indexOf(y));
    const fk = "list:" + b.id, folded = isFolded(fk);
    return `<section class="list-board ${folded ? "folded" : ""}" style="--pc:${b.color || "var(--border)"}">
      <div class="list-head" data-fold="${esc(fk)}"><span class="arrow">${ICON.chevron}</span><span class="dot"></span><h2>${esc(b.name)}</h2>
        <span class="hint">${esc(group(b.groupId)?.name || "")}</span>${hiddenB(b) ? `<span class="flag" title="hidden board">${ICON.eyeOff}</span>` : ""}
        <span class="n">${list.length}</span></div>
      ${folded ? "" : `<div class="list-rows">${list.map(n => rowHtml(n)).join("")}</div>`}
    </section>`;
  }).join("");
  keepScroll(main, () => {
    main.innerHTML = `<div class="vwrap list">${blocks || `<div class="lane-empty">No notes match the filters.</div>`}</div>`;
  });
}

const VIEWS = {
  agenda: { render: renderAgenda, drop: dropAgenda },
  focus: { render: renderFocus },
  tags: { render: renderTags, drop: dropTags },
  sections: { render: renderSections, drop: dropSections },
  bookmarks: { render: renderBookmarks },
  list: { render: renderList },
};

// ---------- events shared by these views ----------

$("#main").addEventListener("click", e => {
  if (!VIEWS[ui.view]) return;
  const act = e.target.closest("[data-vact]");
  if (act) {
    e.stopPropagation();
    switch (act.dataset.vact) {
      case "done": toggleDone(note(act.closest("[data-note]").dataset.note)); return;
      case "edit-bm": editBookmark(boardById(act.dataset.board), act.dataset.bm); return;
      case "new-bmf": newBmFolder(boardById(act.dataset.board), act.dataset.parent || null); return;
    }
    return;
  }
  if (e.target.closest("a, input, select, label.vopt")) return;
  const fold = e.target.closest("[data-fold]");
  if (fold) { toggleFold(fold.dataset.fold, fold.dataset.foldDefault === "1"); renderMain(); return; }
  const row = e.target.closest(".crow");
  if (row) { hidePeek(); openNote(note(row.dataset.note)); }
});
$("#main").addEventListener("change", e => {
  const k = e.target.dataset?.vopt;
  if (!k) return;
  setVopt(k, e.target.type === "checkbox" ? e.target.checked : e.target.value);
  renderMain();
});

// dragging cards between lanes (the card drag itself starts in app.js)
$("#main").addEventListener("dragstart", e => {
  if (drag?.kind === "note" && VIEWS[ui.view]) drag.fromLane = e.target.closest?.(".lane")?.dataset.lane || "";
});
// the lane (and in Sections, the board block) a card would land in: the one
// under the pointer, or the nearest one when the pointer is in a gap
function laneTarget(e) {
  if (!drag || drag.kind !== "note" || !VIEWS[ui.view]?.drop) return null;
  const lane = e.target.closest(".lane[data-drop]") || nearestEl($$("#main .lane[data-drop]"), e.clientX, e.clientY);
  if (!lane) return null;
  let sub = e.target.closest(".lane-sub");
  if (sub && !lane.contains(sub)) sub = null;
  if (!sub && ui.view === "sections" && !e.target.closest(".lane-head")) {
    const subs = $$(".lane-sub", lane);
    sub = subs.find(x => { const r = x.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; })
      || nearestEl(subs, e.clientX, e.clientY, 24);
  }
  return { lane, sub };
}
$("#main").addEventListener("dragover", e => {
  const t = laneTarget(e);
  if (!t) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = ui.view === "tags" && e.ctrlKey ? "copy" : "move";
  clearDropMarks();
  if (t.lane.dataset.lane !== drag.fromLane || t.sub) (t.sub || t.lane).classList.add("drag-over-col");
});
$("#main").addEventListener("drop", e => {
  const t = laneTarget(e);
  if (!t) return;
  e.preventDefault();
  const n = note(drag.id);
  const changed = n && VIEWS[ui.view].drop(n, t.lane, t.sub, e);
  drag = null;
  clearDropMarks();
  if (changed) { n.updated = nowSec(); save(); }
  render();
  if (changed && !matches(n)) toast("Moved — but now hidden by the current filters.");
});

// ---------- organizing bookmarks by dragging (Bookmarks view) ----------
// A bookmark goes before or after another one (taking its folder) or into a
// folder; a folder goes before another folder (top quarter of its row) or
// into it. Dropping on a board's header or empty space puts it at that
// board's top level. Boards can differ: links from notes keep working.

$("#main").addEventListener("dragstart", e => {
  if (ui.view !== "bookmarks") return;
  const row = e.target.closest?.(".bmv-row[data-bm]"), fl = e.target.closest?.(".bmv-folder[data-folder]");
  if (fl) drag = { kind: "bmf", id: fl.dataset.folder, from: fl.dataset.board };
  else if (row) drag = { kind: "bm", id: row.dataset.bm, from: row.dataset.board };
  else return;
  (fl || row.closest(".bmv-item")).classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", drag.id);
});

// where a dragged bookmark/folder would land: { el, mark, board, t } or null
function bmvTarget(e) {
  if (ui.view !== "bookmarks" || !drag || (drag.kind !== "bm" && drag.kind !== "bmf")) return null;
  const boardEl = e.target.closest(".bmv-board") || nearestEl($$("#main .bmv-board"), e.clientX, e.clientY);
  if (!boardEl) return null;
  const dst = boardById(boardEl.dataset.board);
  // a folder can't go inside itself
  const insideSelf = fid => drag.kind === "bmf" && drag.from === dst.id && fid && folderDescendants(dst, drag.id).has(fid);
  const fl = e.target.closest(".bmv-folder");
  if (fl && boardEl.contains(fl)) {
    const f = bmFolder(dst, fl.dataset.folder);
    if (!f || f.id === drag.id) return null;
    const r = fl.getBoundingClientRect();
    if (drag.kind === "bmf" && e.clientY < r.top + r.height / 4) {
      if (insideSelf(f.parentId)) return null;
      return { el: fl, mark: "bm-drop-before", board: dst, t: { folderId: f.parentId || null, beforeFolder: f.id } };
    }
    if (insideSelf(f.id)) return null;
    return { el: fl, mark: "bm-drop-into", board: dst, t: { into: f.id } };
  }
  const row = e.target.closest(".bmv-row");
  if (row && boardEl.contains(row)) {
    const x = (dst.bookmarks || []).find(y => y.id === row.dataset.bm);
    if (!x || insideSelf(x.folderId)) return null;
    const fid = x.folderId || null;
    if (drag.kind === "bmf") return { el: row, mark: "bm-drop-before", board: dst, t: { folderId: fid } };
    if (x.id === drag.id) return null;
    const r = row.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) return { el: row, mark: "bm-drop-before", board: dst, t: { folderId: fid, before: { dataset: { bm: x.id } } } };
    // after it = before the next bookmark in the same folder (or at its end)
    const sibs = dst.bookmarks.filter(y => (y.folderId || null) === fid && y.id !== drag.id);
    const next = sibs[sibs.indexOf(x) + 1];
    return { el: row, mark: "bm-drop-after", board: dst, t: { folderId: fid, before: next ? { dataset: { bm: next.id } } : null } };
  }
  return { el: boardEl, mark: "drag-over-col", board: dst, t: { folderId: null } };
}
$("#main").addEventListener("dragover", e => {
  const tg = bmvTarget(e);
  if (!tg) { if (ui.view === "bookmarks" && drag) clearDropMarks(); return; }
  e.preventDefault();
  clearDropMarks();
  tg.el.classList.add(tg.mark);
});
$("#main").addEventListener("drop", e => {
  const tg = bmvTarget(e);
  if (!tg) return;
  e.preventDefault();
  const src = boardById(drag.from), wasOpen = !!tg.board.bookmarksOpen;
  moveBmOrFolder(src, tg.board, tg.t);
  tg.board.bookmarksOpen = wasOpen;   // don't unfold anything on the Board view
  if (tg.t.into) setVopt("fold:bmf:" + tg.t.into, false);
  drag = null;
  clearDropMarks();
  save(); render();
});
