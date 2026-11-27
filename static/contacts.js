// contacts: one address book shared by every board. ws.contacts holds people
// ({ id, name, email, note }), ws.contactLists named groups of them
// ({ id, name, members: [contactId] }; a contact can be in several lists).
// A task's n.contacts holds ids of contacts and of lists.
//
// Loaded before app.js: only declarations and event listeners here, so the
// globals they use (ws, settings, ICON, popMenu, modal, …) exist by the time
// anything runs.
"use strict";

const contactById = id => ws.contacts.find(c => c.id === id);
const contactListById = id => ws.contactLists.find(l => l.id === id);
// a contact or a list, by id
function ctItem(id) {
  const c = contactById(id); if (c) return { kind: "contact", x: c };
  const l = contactListById(id); return l ? { kind: "list", x: l } : null;
}
const listMembers = l => (l.members || []).map(contactById).filter(Boolean);
const ctName = c => c.name || c.email || "(no name)";
// each list has its own colour: the one picked for it, else one from its id
function listColor(l) {
  if (!l) return "var(--people)";
  if (l.color) return l.color;
  let h = 0; for (const ch of String(l.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
// a new list gets a colour no other list has yet, while there are some left
const freeListColor = () => PALETTE.find(c => !ws.contactLists.some(l => listColor(l) === c)) || PALETTE[ws.contactLists.length % PALETTE.length];
const listIcon = l => `<span class="lc-ic" style="color:${listColor(l)}">${ICON.users}</span>`;
const ctLabel = it => it.kind === "list" ? it.x.name || "(unnamed list)" : ctName(it.x);
const ctEmails = it => (it.kind === "list" ? listMembers(it.x).map(c => c.email) : [it.x.email]).filter(Boolean);
const tasksWithContact = id => ws.notes.filter(n => (n.contacts || []).includes(id));
// every address a task's contacts and lists add up to, once each
const taskEmails = n => [...new Set((n.contacts || []).map(ctItem).filter(Boolean).flatMap(ctEmails))];
const validEmail = s => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s);
// searchable text for a task's contacts
// the extra fields' names used across contacts (for suggestions), and a
// contact's fields as "Name: value" text
const fieldNames = () => [...new Set(ws.contacts.flatMap(c => Object.keys(c.fields || {})))].sort((a, b) => a.localeCompare(b));
const fieldText = c => Object.entries(c.fields || {}).map(([k, v]) => `${k}: ${v}`).join(" · ");
const contactText = n => (n.contacts || []).map(ctItem).filter(Boolean).map(it => `${ctLabel(it)} ${ctEmails(it).join(" ")}`).join(" ");

// ---------- sending email ----------
// Settings › Email picks the app (nothing until you pick one). Each app has
// a link for To, CC and BCC, which you can edit there; your edits are kept in
// settings.emailLinks[app][kind]. In a link:
//   {addresses}  the addresses, comma separated
//   {subject}    the subject (the task's title)
//   {mailto}     a whole mailto: address with them in the right field,
//                encoded to sit inside another link
const OUTLOOK = "https://outlook.cloud.microsoft/mail/deeplink/compose";
const GMAIL = "https://mail.google.com/mail/?view=cm&fs=1";
const EMAIL_APPS = [
  { id: "", name: "Not set" },
  { id: "outlook", name: "Outlook (web)", links: {
    // the compose deeplink only reads "to"; CC and BCC ride in a mailto: address
    to: `${OUTLOOK}?to={addresses}&subject={subject}`,
    cc: `${OUTLOOK}?mailtouri={mailto}`,
    bcc: `${OUTLOOK}?mailtouri={mailto}` } },
  { id: "gmail", name: "Gmail (web)", links: {
    to: `${GMAIL}&to={addresses}&su={subject}`,
    cc: `${GMAIL}&cc={addresses}&su={subject}`,
    bcc: `${GMAIL}&bcc={addresses}&su={subject}` } },
  { id: "mailto", name: "Default mail app", links: {
    to: "mailto:{addresses}?subject={subject}",
    cc: "mailto:?cc={addresses}&subject={subject}",
    bcc: "mailto:?bcc={addresses}&subject={subject}" } },
];
const emailApp = () => EMAIL_APPS.find(a => a.id && a.id === settings.emailApp) || null;
const emailLink = (app, kind) => settings.emailLinks?.[app.id]?.[kind] || app.links[kind];
// as: "to", "cc" or "bcc"
function composeUrl(emails, as = "to", subject = "") {
  const app = emailApp(); if (!app) return null;
  // keep @ and , readable; everything else encoded
  const enc = s => encodeURIComponent(s).replace(/%40/g, "@").replace(/%2C/g, ",");
  const addresses = emails.map(enc).join(",");
  const mailto = as === "to" ? `mailto:${addresses}?subject=${enc(subject)}` : `mailto:?${as}=${addresses}&subject=${enc(subject)}`;
  return emailLink(app, as).replace(/\{(addresses|subject|mailto)\}/g, (m, k) =>
    k === "addresses" ? addresses : k === "subject" ? enc(subject) : encodeURIComponent(mailto));
}
// as: "to", "cc" or "bcc"
function emailTo(emails, as = "to", subject = "") {
  if (!emails.length) { toast("No email address there yet."); return; }
  const url = composeUrl(emails, as, subject);
  if (!url) {
    const t = toast(`Choose how to send email in Settings first. <button>Settings</button>`, 8000);
    $("button", t).onclick = () => { t.classList.remove("show"); openSettings(); };
    return;
  }
  if (/^mailto:/i.test(url)) location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
  // a web app may leave CC or BCC empty: have the addresses ready to paste
  if (as !== "to" && !/^mailto:/i.test(url))
    copyText(emails.join(", ")).then(() => toast(`Also copied ${emails.length === 1 ? "the address" : `the ${emails.length} addresses`} — paste ${emails.length === 1 ? "it" : "them"} into ${as.toUpperCase()} if the field is empty.`, 8000));
}

// ---------- chips on tasks ----------
function contactChipList(n) {
  return (n.contacts || []).map(id => {
    const it = ctItem(id); if (!it) return "";
    const emails = ctEmails(it);
    const title = it.kind === "list" ? `list: ${emails.length} address${emails.length === 1 ? "" : "es"}` : it.x.email || "no email";
    return `<span class="ct-wrap ${it.kind}" data-ct="${id}" data-ct-note="${n.id}" title="${esc(title)}"${it.kind === "list" ? ` style="--people:${listColor(it.x)}"` : ""}>${it.kind === "list" ? ICON.users : ICON.user}`
      + `<span class="ct-n">${esc(ctLabel(it))}</span><button class="ct-more" title="Contact menu" draggable="false">${ICON.more}</button></span>`;
  }).filter(Boolean);
}
const contactChips = n => contactChipList(n).join("");

// ---------- the contact / list menu ----------
// From a task (n) it can take the contact off the task and uses the task's
// title as the subject; elsewhere it deletes the contact itself (undoable).
// details: a card on top with who it is (a left-click on a chip on a task)
function contactCard(it) {
  if (it.kind === "list") {
    const m = listMembers(it.x), MAX = 8;
    return `<div class="ct-card" style="--lc:${listColor(it.x)}">
      <div class="ct-card-head"><span class="av list">${ICON.users}</span><span class="who"><b>${esc(ctLabel(it))}</b>
        <span class="u">${m.length} contact${m.length === 1 ? "" : "s"}</span></span></div>
      ${m.length ? `<div class="ct-card-mem">${m.slice(0, MAX).map(c => `<div><span class="nm">${esc(ctName(c))}</span><span class="u">${esc(c.email || "")}</span></div>`).join("")}
        ${m.length > MAX ? `<div class="u">and ${m.length - MAX} more</div>` : ""}</div>` : `<div class="u ct-card-none">No members yet.</div>`}
    </div>`;
  }
  const c = it.x;
  const items = [...(c.note ? [["Note", c.note]] : []), ...Object.entries(c.fields || {})];
  const inLists = ws.contactLists.filter(l => (l.members || []).includes(c.id));
  return `<div class="ct-card">
    <div class="ct-card-head"><span class="av">${esc(initials(c.name || c.email))}</span><span class="who"><b>${esc(ctName(c))}</b>
      <span class="u">${esc(c.email || "no email")}</span></span></div>
    ${items.length ? `<div class="ct-details">${items.map(([k, v]) => `<span class="ct-dk">${esc(k)}</span><span class="ct-dv">${esc(v)}</span>`).join("")}</div>` : ""}
    ${inLists.length ? `<div class="ct-lists">${inLists.map(l => `<span class="ct-lchip" style="--lc:${listColor(l)}">${ICON.users}${esc(l.name)}</span>`).join("")}</div>` : ""}
  </div>`;
}
function contactMenu(id, anchor, n, { details = false } = {}) {
  const it = ctItem(id); if (!it) return;
  const emails = ctEmails(it), subject = n?.title || "";
  const ov = anchor.closest?.(".overlay");
  const info = it.kind === "list" ? `${listMembers(it.x).length} contact${listMembers(it.x).length === 1 ? "" : "s"}` : it.x.email || "no email";
  popMenu(anchor, `
    ${details ? contactCard(it) : `<div class="menu-label">${esc(ctLabel(it))} · ${esc(info)}</div>`}
    <button data-m="to">${ICON.mail} New email</button>
    <button data-m="cc">${ICON.mail} New email, as CC</button>
    <button data-m="bcc">${ICON.mail} New email, as BCC</button>
    <button data-m="copy">${ICON.copy} Copy address${emails.length === 1 ? "" : "es"}</button>
    <hr><button data-m="edit">${ICON.edit} Edit…</button>
    ${n ? `<button data-m="remove" class="danger">${ICON.x} Remove from task</button>`
        : `<button data-m="delete" class="danger">${ICON.x} Delete ${it.kind}</button>`}`, d => {
    switch (d.m) {
      case "to": case "cc": case "bcc": emailTo(emails, d.m, subject); break;
      case "copy":
        if (!emails.length) { toast("No email address there yet."); break; }
        copyText(emails.join(", ")).then(() => toast(emails.length === 1 ? "Address copied." : `${emails.length} addresses copied.`));
        break;
      case "edit": (it.kind === "list" ? editContactList : editContact)(id, { after: () => ov?._refresh?.() }); break;
      case "remove": {
        const snapshot = JSON.stringify(ws);
        n.contacts = (n.contacts || []).filter(x => x !== id); n.updated = nowSec();
        save(); render(); ov?._refresh?.();
        offerUndo(`Removed “${esc(ctLabel(it))}” from “${esc(n.title || "task")}”.`, snapshot);
        break;
      }
      case "delete": deleteContact(id); break;
    }
  });
}
function deleteContact(id) {
  const it = ctItem(id); if (!it) return;
  const snapshot = JSON.stringify(ws);
  if (it.kind === "contact") {
    ws.contacts = ws.contacts.filter(c => c !== it.x);
    for (const l of ws.contactLists) l.members = (l.members || []).filter(m => m !== id);
  } else ws.contactLists = ws.contactLists.filter(l => l !== it.x);
  for (const n of ws.notes) if (n.contacts?.includes(id)) n.contacts = n.contacts.filter(x => x !== id);
  save(); render();
  offerUndo(`Deleted ${it.kind} “${esc(ctLabel(it))}”.`, snapshot);
}

// the ⋯ or a click on a chip, the ⋯ on a Contacts view row, or a right-click
// on any of them. Caught before the card and task panel handlers.
function contactMenuFrom(el, at, opts) {
  const host = el.closest("[data-ct]"); if (!host) return false;
  const n = host.dataset.ctNote ? note(host.dataset.ctNote) : null;
  contactMenu(host.dataset.ct, at || host.querySelector(".ct-more") || host, n, opts);
  return true;
}
// a left-click on a chip on a task opens its details with the menu under
// them; its ⋯ and a right-click open the menu alone
document.addEventListener("click", e => {
  const el = e.target.closest?.(".ct-wrap, .ct-row .ct-more");
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  const more = e.target.closest(".ct-more");
  contactMenuFrom(el, more || el, { details: !more });
}, true);
document.addEventListener("contextmenu", e => {
  const el = e.target.closest?.(".ct-wrap, .ct-row");
  if (!el) return;
  const at = { getBoundingClientRect: () => ({ left: e.clientX, bottom: e.clientY }), closest: s => el.closest(s) };
  if (contactMenuFrom(el, at)) { e.preventDefault(); e.stopPropagation(); }
}, true);

// ---------- editing ----------
// after(c): called with the saved contact (used to attach a new one to a task)
function editContact(id, { after, name = "", email = "" } = {}) {
  const c = id ? contactById(id) : null;
  const lists = ws.contactLists;
  const o = modal(`<h3>${c ? "Edit contact" : "New contact"}</h3>
    <div class="ct-form">
      <label class="f">Name<input type="text" id="cName"></label>
      <label class="f">Email<input type="text" id="cEmail" placeholder="name@example.com"></label>
      <label class="f wide"><span>Note <span class="opt">· optional</span></span><input type="text" id="cNote" placeholder="role, company, phone…"></label>
    </div>
    <div class="section-f"><span class="lbl">Fields <span class="opt">· phone, company, school… (pasted spreadsheet columns land here)</span></span>
      <div class="cf-list" id="cFields"></div>
      <datalist id="cFieldNames">${fieldNames().map(k => `<option value="${esc(k)}">`).join("")}</datalist>
      <div><button class="ghost cf-add" id="cAddField">${ICON.plusSm} field</button></div></div>
    ${c ? "" : pasteHtml("cb", "Or add several at once")}
    ${lists.length ? `<div class="section-f"><span class="lbl">Lists${c ? "" : ` <span class="opt">· for everyone you add</span>`}</span><div class="tog-chips">${lists.map(l =>
      `<label class="tog"><input type="checkbox" data-l="${l.id}" ${c && (l.members || []).includes(c.id) ? "checked" : ""}><span style="--lc:${listColor(l)}">${ICON.users}${esc(l.name)}</span></label>`).join("")}</div></div>` : ""}
    <div id="cErr" class="due-preview bad"></div>
    <div class="foot"><div class="spacer"></div><button id="cCancel">Cancel</button><button class="primary" id="cOk">${c ? "Save" : "Add contact"}</button></div>`, "wide");
  $("#cName", o).value = c?.name ?? name;
  $("#cEmail", o).value = c?.email ?? email;
  $("#cNote", o).value = c?.note || "";
  // extra fields: a name and a value per row
  const fieldRow = (k = "", v = "") => {
    const d = document.createElement("div");
    d.className = "cf-row";
    d.innerHTML = `<input type="text" class="cf-k" list="cFieldNames" placeholder="field"><input type="text" class="cf-v" placeholder="value">`
      + `<button class="ghost icon cf-x" title="Remove this field">${ICON.x}</button>`;
    $(".cf-k", d).value = k; $(".cf-v", d).value = v;
    $("#cFields", o).appendChild(d);
    return d;
  };
  for (const [k, v] of Object.entries(c?.fields || {})) fieldRow(k, v);
  $("#cAddField", o).onclick = () => $(".cf-k", fieldRow()).focus();
  $("#cFields", o).addEventListener("click", e => { const x = e.target.closest(".cf-x"); if (x) x.closest(".cf-row").remove(); });
  $(c || !name ? "#cName" : "#cEmail", o).focus();
  // a new contact can also take pasted rows: the button says how many
  const countOk = () => {
    const k = pastedRows().length + ($("#cEmail", o).value.trim() ? 1 : 0);
    $("#cOk", o).textContent = k > 1 ? `Add ${k} contacts` : "Add contact";
  };
  const pastedRows = c ? () => [] : pasteBox(o, "cb", countOk);
  if (!c) $("#cEmail", o).addEventListener("input", countOk);
  const okMany = () => {
    const rows = pastedRows();
    if (!rows.length) return false;
    // the single form too, when it was filled in
    const em = $("#cEmail", o).value.trim();
    if (em && !validEmail(em)) { $("#cErr", o).textContent = "The email above doesn't look like an address — clear it to add only the pasted ones."; return true; }
    if (em) rows.unshift({ name: $("#cName", o).value.trim(), email: em, note: $("#cNote", o).value.trim() || undefined });
    const fresh = rows.filter(r => !byEmail(r.email)).length;
    const added = rows.map(upsertPasted);
    for (const b of $$("[data-l]", o)) {
      const l = contactListById(b.dataset.l); if (!l || !b.checked) continue;
      l.members ||= [];
      for (const x of added) if (!l.members.includes(x.id)) l.members.push(x.id);
    }
    save(); closeModal(); render();
    toast(`Added ${added.length} contact${added.length === 1 ? "" : "s"}${fresh < added.length ? ` (${added.length - fresh} ${added.length - fresh === 1 ? "was" : "were"} already in your contacts)` : ""}.`);
    for (const x of added) after?.(x);
    return true;
  };
  const ok = () => {
    if (!c && okMany()) return;
    const nm = $("#cName", o).value.trim(), em = $("#cEmail", o).value.trim(), nt = $("#cNote", o).value.trim();
    if (!validEmail(em)) { $("#cErr", o).textContent = em ? "That doesn't look like an email address." : "An email address is needed."; return; }
    const dup = ws.contacts.find(x => x !== c && x.email.toLowerCase() === em.toLowerCase());
    if (dup) { $("#cErr", o).textContent = `Already a contact: ${ctName(dup)}.`; return; }
    const x = c || { id: uid() };
    Object.assign(x, { name: nm, email: em });
    if (nt) x.note = nt; else delete x.note;
    const fields = {};
    for (const r of $$(".cf-row", o)) {
      const k = $(".cf-k", r).value.trim(), v = $(".cf-v", r).value.trim();
      if (k && v) fields[k] = v;
    }
    if (Object.keys(fields).length) x.fields = fields; else delete x.fields;
    if (!c) ws.contacts.push(x);
    $$("[data-l]", o).forEach(b => {
      const l = contactListById(b.dataset.l); if (!l) return;
      l.members ||= [];
      if (b.checked && !l.members.includes(x.id)) l.members.push(x.id);
      if (!b.checked) l.members = l.members.filter(m => m !== x.id);
    });
    save(); closeModal(); render();
    after?.(x);
  };
  $("#cOk", o).onclick = ok;
  $("#cCancel", o).onclick = closeModal;
  o.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("input[type=text]:not(.cf-k):not(.cf-v)")) ok(); });
}
// ---------- pasting contacts from a spreadsheet ----------
// Reads rows copied from a spreadsheet (tabs), a CSV (commas or semicolons,
// quotes respected), "|" tables, one address per line, or an email's To line
// ("Ada <ada@x.com>; alan@y.org"). A header row with name / email columns
// (also first + last name, in English or Portuguese) says which column is
// which; without one, each row's email is found and the name taken from the
// cells beside it. Returns { rows: [{ name, email }], skipped, sep }.
const EMAIL_RE = /[^\s<>"'();,:|]+@[^\s<>"'();,:|]+\.[^\s<>"'();,:|]{2,}/;
function splitCells(line, d) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && !cur.trim()) { q = true; cur = ""; }
    else if (ch === d) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
// "Ada Lovelace <ada@x.com>" / "ada@x.com (Ada)" / "ada@x.com"
function nameAndEmail(s) {
  const m = s.match(EMAIL_RE); if (!m) return null;
  const email = m[0].replace(/^mailto:/i, "");
  const name = s.replace(m[0], "").replace(/[<>()"]/g, " ").replace(/\s+/g, " ").trim();
  return { name, email };
}
const looksLikeName = s => s.length <= 60 && /^[\p{L}][\p{L}\p{M}'’ .-]*$/u.test(s);
function parseContacts(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").map(s => s.trimEnd()).filter(s => s.trim());
  if (!lines.length) return { rows: [], skipped: 0, sep: "" };
  // the column separator: tabs win (a spreadsheet); otherwise the one found
  // the same number of times on most lines
  let sep = "";
  if (lines.some(s => s.includes("\t"))) sep = "\t";
  else for (const d of [";", ",", "|"]) {
    const counts = lines.map(s => splitCells(s, d).length - 1);
    const n = counts.filter(c => c > 0).length;
    if (n && n >= Math.ceil(lines.length / 2) && (lines.length === 1 || new Set(counts.filter(c => c > 0)).size === 1)) { sep = d; break; }
  }
  const SEP_NAMES = { "\t": "tabs", ";": "semicolons", ",": "commas", "|": "vertical bars", "": "one per line" };
  // one line of several addresses (an email's To line): every piece is a contact
  if (lines.length === 1 && (lines[0].match(new RegExp(EMAIL_RE.source, "g")) || []).length > 1) {
    const d = sep && sep !== "\t" ? sep : /;/.test(lines[0]) ? ";" : ",";
    const parts = splitCells(lines[0], d).filter(Boolean);
    const rows = parts.map(nameAndEmail).filter(Boolean);
    return { rows: dedupe(rows), skipped: parts.length - rows.length, sep: SEP_NAMES[d] + ", one line" };
  }
  const table = lines.map(s => sep ? splitCells(s, sep) : [s.trim()]);
  // a header row: the first row has no email but rows under it do (or it
  // names an email column). Its name, email and note columns are used; every
  // other named column is kept as an extra field on the contact.
  let cols = null;
  const head = table[0];
  const headLike = !head.some(c => EMAIL_RE.test(c)) && head.some(c => c.trim())
    && (head.some(c => /e-?mail|correio/i.test(c)) || (sep && table.slice(1).some(r => r.some(c => EMAIL_RE.test(c)))));
  if (headLike && table.length > 1) {
    const find = (re, not = []) => head.findIndex((c, i) => !not.includes(i) && re.test(c.trim()));
    let email = find(/e-?mail|correio/i);
    if (email < 0) {
      // no column called email: the one holding the most addresses
      const hits = head.map((_, i) => table.slice(1).filter(r => EMAIL_RE.test(r[i] || "")).length);
      email = hits.indexOf(Math.max(...hits));
    }
    const last = find(/last|surname|family|apelido|sobrenome/i, [email]);
    const first = find(/first|given|primeiro/i, [email, last]);
    let name = find(/name|nome/i, [email, last, first]);
    // no name column at all: the first other column of short name-like text
    if (name < 0 && first < 0) name = head.findIndex((_, i) => i !== email && i !== last
      && table.slice(1).some(r => r[i] && looksLikeName(r[i])));
    const note = find(/^(notes?|notas?|obs|observa|comment|coment)/i, [email, last, first, name]);
    const used = [email, last, first, name, note];
    const extra = head.map((h, i) => ({ i, label: h.replace(/\s+/g, " ").trim() })).filter(x => x.label && !used.includes(x.i));
    cols = { email, name: first >= 0 ? first : name, last, note, extra };
    table.shift();
  }
  const rows = []; let skipped = 0;
  for (const cells of table) {
    let r = null;
    if (cols) {
      const em = (cells[cols.email] || "").match(EMAIL_RE)?.[0] || cells.map(c => c.match(EMAIL_RE)?.[0]).find(Boolean);
      if (em) {
        r = { email: em, name: [cols.name >= 0 ? cells[cols.name] : "", cols.last >= 0 ? cells[cols.last] : ""].filter(Boolean).join(" ").trim() };
        if (cols.note >= 0 && cells[cols.note]) r.note = cells[cols.note].trim();
        const f = {};
        for (const x of cols.extra) if ((cells[x.i] || "").trim()) f[x.label] = cells[x.i].trim();
        if (Object.keys(f).length) r.fields = f;
      }
    } else {
      const ei = cells.findIndex(c => EMAIL_RE.test(c));
      if (ei >= 0) {
        r = nameAndEmail(cells[ei]);
        if (!r.name) {
          // the name: the first name-like cell, or the first two when they are
          // single words (first and last name in their own columns)
          const names = cells.filter((c, i) => i !== ei && c && looksLikeName(c));
          r.name = names.length >= 2 && !/\s/.test(names[0]) && !/\s/.test(names[1]) ? `${names[0]} ${names[1]}` : names[0] || "";
        }
      }
    }
    if (r) rows.push({ ...r, name: r.name.replace(/\s+/g, " ").trim(), email: r.email.trim() }); else skipped++;
  }
  // what the header said each column is, for the preview
  const columns = cols ? head.map((h, i) => ({ label: h.trim() || `column ${i + 1}`,
    use: i === cols.email ? "email" : i === cols.name || i === cols.last ? "name" : i === cols.note ? "note" : cols.extra.some(x => x.i === i) ? "field" : "" })) : null;
  return { rows: dedupe(rows), skipped, sep: SEP_NAMES[sep] + (cols ? ", with a header row" : ""), columns };
}
// the same address twice: keep the first, with a name if either had one.
// "Lovelace, Ada" (address books) reads "Ada Lovelace"
function dedupe(rows) {
  const by = new Map();
  for (const r of rows) {
    const m = r.name.match(/^([^,]+),\s*([^,]+)$/);
    if (m) r.name = `${m[2].trim()} ${m[1].trim()}`;
    const k = r.email.toLowerCase(), had = by.get(k);
    if (!had) by.set(k, { ...r });
    else {
      if (!had.name && r.name) had.name = r.name;
      if (!had.note && r.note) had.note = r.note;
      if (r.fields) had.fields = { ...r.fields, ...(had.fields || {}) };
    }
  }
  return [...by.values()];
}

// a selectable person card: initials that turn into a tick when chosen
const initials = s => (s || "?").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
const ICON_SEARCH = '<svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const memCard = (attr, checked, name, email, extra = "", tip = "") =>
  `<label class="mem" data-q="${esc((name + " " + email).toLowerCase())}"${tip ? ` title="${esc(tip)}"` : ""}><input type="checkbox" ${attr} ${checked ? "checked" : ""}>`
  + `<span class="av">${esc(initials(name && name !== "(no name)" ? name : email))}</span><span class="av-check">${ICON.check}</span>`
  + `<span class="mem-t"><span class="mem-n">${esc(name)}</span><span class="mem-e">${esc(email)}</span></span>${extra}</label>`;

// ---------- the paste box (New contact and the list editor) ----------
const byEmail = em => ws.contacts.find(c => c.email.toLowerCase() === em.toLowerCase());
const pasteHtml = (id, label) => `<div class="section-f"><span class="lbl">${label}</span>
      <textarea id="${id}Paste" class="paste-zone" rows="2" spellcheck="false" placeholder="Paste rows copied from a spreadsheet, a CSV or an email’s To line"></textarea>
      <div class="hint">Tabs, commas or semicolons are detected. With a header row, the name and email columns are found and the other columns become fields.</div>
      <div class="imp" id="${id}Imp" hidden></div></div>`;
// wires a paste box; returns a function giving the ticked pasted rows
function pasteBox(o, id, onChange) {
  let pasted = [];
  const ta = $(`#${id}Paste`, o), box = $(`#${id}Imp`, o);
  const USE = { email: "email", name: "name", note: "note", field: "new field", "": "not used" };
  const renderImport = () => {
    const p = parseContacts(ta.value);
    pasted = p.rows;
    box.hidden = !ta.value.trim();
    const fresh = pasted.filter(r => !byEmail(r.email)).length;
    const skip = p.skipped ? ` · ${p.skipped} row${p.skipped === 1 ? "" : "s"} without an email skipped` : "";
    box.innerHTML = `<div class="imp-sum">${pasted.length
        ? `<b>${pasted.length}</b> contact${pasted.length === 1 ? "" : "s"} found (${fresh} new, ${pasted.length - fresh} already in your contacts) · separated by ${p.sep}${skip}`
        : `No email addresses found${skip}.`}</div>`
      + (p.columns && pasted.length ? `<div class="imp-cols">${p.columns.map(c =>
          `<span class="imp-col ${c.use || "none"}" title="${esc(c.use === "field" ? `kept on each contact as “${c.label}”` : USE[c.use])}"><b>${esc(c.label)}</b>${USE[c.use]}</span>`).join("")}</div>` : "")
      + (pasted.length ? `<div class="mem-grid imp-rows">${pasted.map((r, i) => {
        const had = byEmail(r.email);
        const tip = Object.entries({ ...(r.note ? { Note: r.note } : {}), ...(r.fields || {}) }).map(([k, v]) => `${k}: ${v}`).join("\n");
        return memCard(`data-imp="${i}"`, true, r.name || had?.name || "(no name)", r.email,
          `<span class="imp-tag ${had ? "" : "new"}">${had ? "existing" : "new"}</span>`, tip);
      }).join("")}</div>` : "");
  };
  ta.addEventListener("input", () => { renderImport(); onChange?.(); });
  box.addEventListener("change", () => onChange?.());
  return () => $$("[data-imp]", box).filter(b => b.checked).map(b => pasted[+b.dataset.imp]).filter(Boolean);
}
// a pasted row as a contact: the same address reuses the contact (filling
// in a name, note and fields it lacks); otherwise a new one
function upsertPasted(r) {
  let c = byEmail(r.email);
  if (!c) { c = { id: uid(), name: r.name, email: r.email }; ws.contacts.push(c); }
  else if (!c.name && r.name) c.name = r.name;
  if (r.note && !c.note) c.note = r.note;
  for (const [k, v] of Object.entries(r.fields || {})) {
    c.fields ||= {};
    if (!c.fields[k]) c.fields[k] = v;
  }
  return c;
}

function editContactList(id, { after } = {}) {
  const l = id ? contactListById(id) : null;
  // the list's members first, then everyone else, each by name
  const isIn = c => (l?.members || []).includes(c.id) ? 0 : 1;
  const sorted = [...ws.contacts].sort((a, b) => isIn(a) - isIn(b) || ctName(a).localeCompare(ctName(b)));
  const o = modal(`<h3>${l ? "Edit list" : "New list"}</h3>
    <label class="f">Name<input type="text" id="clName"></label>
    <div class="section-f"><span class="lbl">Colour</span>${colorRow("")}</div>
    <div class="section-f">
      <div class="mem-head"><span class="lbl">Members</span><span class="mem-count" id="clCount"></span><span class="spacer"></span>
        ${sorted.length ? `<span class="mem-search">${ICON_SEARCH}<input type="search" id="clFilter" placeholder="Search contacts"></span>
        <button class="ghost" id="clAll">Select all</button><button class="ghost" id="clNone">Clear</button>` : ""}</div>
      ${sorted.length ? `<div class="mem-grid" id="clMembers">${sorted.map(c =>
        memCard(`data-c="${c.id}"`, l && (l.members || []).includes(c.id), ctName(c), c.email)).join("")}</div>`
        : `<div class="mem-empty">No contacts yet — paste them below.</div>`}
    </div>
    ${pasteHtml("cl", "Add from a spreadsheet")}
    <div id="clErr" class="due-preview bad"></div>
    <div class="foot"><div class="spacer"></div><button id="clCancel">Cancel</button><button class="primary" id="clOk">${l ? "Save" : "Add list"}</button></div>`, "wide");
  $("#clName", o).value = l?.name || "";
  // the colour: the list's own, or a free one for a new list
  let color = l ? listColor(l) : freeListColor();
  const markColor = () => $$(".colors button", o).forEach(b => b.classList.toggle("on", b.dataset.color === color));
  markColor();
  $(".colors", o).addEventListener("click", e => { const b = e.target.closest("[data-color]"); if (b) { color = b.dataset.color; markColor(); } });
  $("#clName", o).focus();
  const count = () => {
    const all = $$("[data-c]", o), on = all.filter(b => b.checked).length;
    const el = $("#clCount", o); if (el) el.textContent = all.length ? `${on} of ${all.length} selected` : "";
  };
  count();
  $("#clMembers", o)?.addEventListener("change", count);
  $("#clFilter", o)?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    $$("#clMembers .mem", o).forEach(r => { r.hidden = !r.dataset.q.includes(q); });
  });
  // select all / clear: the cards the search shows
  const setShown = on => { $$("#clMembers .mem:not([hidden]) [data-c]", o).forEach(b => { b.checked = on; }); count(); };
  $("#clAll", o)?.addEventListener("click", () => setShown(true));
  $("#clNone", o)?.addEventListener("click", () => setShown(false));
  // pasted contacts: previewed as they will be added, each can be unticked
  const pastedRows = pasteBox(o, "cl");
  const ok = () => {
    const nm = $("#clName", o).value.trim();
    if (!nm) { $("#clErr", o).textContent = "Give the list a name."; return; }
    const x = l || { id: uid() };
    x.name = nm;
    x.color = color;
    x.members = $$("[data-c]", o).filter(b => b.checked).map(b => b.dataset.c);
    // the ticked pasted contacts join the list (existing ones reused)
    for (const r of pastedRows()) {
      const c = upsertPasted(r);
      if (!x.members.includes(c.id)) x.members.push(c.id);
    }
    if (!l) ws.contactLists.push(x);
    save(); closeModal(); render();
    after?.(x);
  };
  $("#clOk", o).onclick = ok;
  $("#clCancel", o).onclick = closeModal;
  $("#clName", o).addEventListener("keydown", e => { if (e.key === "Enter") ok(); });
}

// ---------- the Contacts view ----------
const ctOpen = new Set();   // contacts whose details are shown (until reload)
// the Contacts bar: a search, and a list to show ("" all, "none" no list)
const ctFilter = { q: "", list: "" };
function renderCtFilters(shown, total) {
  const sel = $("#ctListFilter");
  if (ctFilter.list && ctFilter.list !== "none" && !contactListById(ctFilter.list)) ctFilter.list = "";
  sel.innerHTML = `<option value="">All contacts</option><option value="none">Not in any list</option>`
    + [...ws.contactLists].sort((a, b) => a.name.localeCompare(b.name)).map(l => `<option value="${l.id}">In ${esc(l.name)}</option>`).join("");
  sel.value = ctFilter.list;
  if ($("#ctSearch").value !== ctFilter.q) $("#ctSearch").value = ctFilter.q;
  $("#ctSide").checked = !!vopt("ctSide", false);
  $("#ctClear").hidden = !ctFilter.q && !ctFilter.list;
  $("#ctCount").textContent = shown === total ? `${total} contact${total === 1 ? "" : "s"}` : `${shown} of ${total} contacts`;
}
document.getElementById("ctSearch").addEventListener("input", e => { ctFilter.q = e.target.value; renderMain(); });
document.getElementById("ctListFilter").addEventListener("change", e => { ctFilter.list = e.target.value; renderMain(); });
document.getElementById("ctSide").addEventListener("change", e => { setVopt("ctSide", e.target.checked); renderMain(); });
document.getElementById("ctClear").addEventListener("click", () => { ctFilter.q = ""; ctFilter.list = ""; renderMain(); });
function renderContacts(main) {
  const words = ctFilter.q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = s => words.every(w => s.toLowerCase().includes(w));
  // markers for the tasks a contact or list is on: a contact's own tasks,
  // then those it reaches through a list (lighter); click one to open it
  const marks = (id, kind) => {
    const own = tasksWithContact(id).filter(n => !asleep(boardOf(n)));
    const via = kind === "contact" ? ws.contactLists.filter(l => (l.members || []).includes(id))
      .flatMap(l => tasksWithContact(l.id).filter(n => !asleep(boardOf(n)) && !own.includes(n)).map(n => ({ n, l }))) : [];
    const seen = new Set(), items = [...own.map(n => ({ n })), ...via].filter(x => !seen.has(x.n.id) && seen.add(x.n.id));
    if (!items.length) return "";
    const MAX = 3, more = items.length - MAX;
    return `<span class="ct-marks">${items.slice(0, MAX).map(({ n, l }) => {
      const b = boardOf(n);
      return `<button class="ct-mark ${l ? "via" : ""} ${isDone(n) ? "done" : ""}" data-goto-task="${n.id}"
        title="${esc(`${b?.name || ""} › ${n.title || "(untitled)"}${l ? ` · through the list ${l.name}` : ""}${isDone(n) ? " · done" : ""}`)}">`
        + `<span class="dot" style="background:${b?.color || "var(--faint)"}"></span><span class="mt">${esc(n.title || "(untitled)")}</span></button>`;
    }).join("")}${more > 0 ? `<span class="ct-mark-more" title="${esc(items.slice(MAX).map(x => x.n.title || "(untitled)").join(", "))}">+${more}</span>` : ""}</span>`;
  };
  // det: a contact's note and fields, folded under a Details button
  const row = (id, kind, title, sub, det = null, right = "") => `<div class="ct-row ${det?.open ? "open" : ""}" data-ct="${id}" data-kind="${kind}" ${kind === "contact" ? `draggable="true"` : ""}
      title="${kind === "contact" ? "click to edit · drag onto a list to add it there" : "click to edit · drop contacts here to add them"}">
      <span class="ct-ic"${kind === "list" ? ` style="--lc:${listColor(contactListById(id))}"` : ""}>${kind === "list" ? ICON.users : ICON.user}</span>
      <span class="ct-main"><span class="ct-t">${esc(title)}</span><span class="ct-sub">${sub}</span></span>
      ${right}${marks(id, kind)}${det ? `<button class="ghost ct-det-btn" data-ct-det="${id}" title="${det.open ? "Hide details" : "Show details"}" draggable="false">Details<span class="arrow">${ICON.chevron}</span></button>`
        : kind === "contact" ? `<button class="ghost ct-det-btn ph" tabindex="-1" aria-hidden="true">Details<span class="arrow">${ICON.chevron}</span></button>` : ""}
      <button class="ghost icon ct-more" title="Contact menu" draggable="false">${ICON.more}</button></div>`
    + (det?.open ? `<div class="ct-details" data-ct-of="${id}">${det.items.map(([k, v]) =>
      `<span class="ct-dk">${esc(k)}</span><span class="ct-dv">${esc(v)}</span>`).join("")}</div>` : "");
  const lists = [...ws.contactLists].sort((a, b) => a.name.localeCompare(b.name))
    .filter(l => hit(`${l.name} ${listMembers(l).map(c => ctName(c) + " " + c.email).join(" ")}`));
  const people = [...ws.contacts].sort((a, b) => ctName(a).localeCompare(ctName(b)))
    .filter(c => hit(`${c.name} ${c.email} ${c.note || ""} ${Object.entries(c.fields || {}).flat().join(" ")}`))
    .filter(c => !ctFilter.list || (ctFilter.list === "none"
      ? !ws.contactLists.some(l => (l.members || []).includes(c.id))
      : (contactListById(ctFilter.list)?.members || []).includes(c.id)));
  const listRows = lists.map(l => {
    const m = listMembers(l);
    return row(l.id, "list", l.name, m.length ? esc(m.map(ctName).join(", ")) : `<i>no members yet</i>`);
  }).join("");
  const peopleRows = people.map(c => {
    // the lists it is in, as chips after the email
    const inLists = ws.contactLists.filter(l => (l.members || []).includes(c.id));
    // the row shows the email and lists; the note and fields are details,
    // open when asked for, or when a search word is found in them
    const items = [...(c.note ? [["Note", c.note]] : []), ...Object.entries(c.fields || {})];
    const det = items.length ? { items, open: ctOpen.has(c.id) || (words.length > 0 && words.some(w => items.some(([k, v]) => `${k} ${v}`.toLowerCase().includes(w)))) } : null;
    return row(c.id, "contact", ctName(c), esc(c.email), det,
      inLists.length ? `<span class="ct-lists">${inLists.map(l => `<span class="ct-lchip" style="--lc:${listColor(l)}" title="in the list ${esc(l.name)}">${ICON.users}${esc(l.name)}</span>`).join("")}</span>` : "");
  }).join("");
  const none = words.length || ctFilter.list ? "No match." : null;
  // Lists above Contacts, or side by side (a view option); each with a +
  // in its header like a board's sections
  const side = vopt("ctSide", false);
  renderCtFilters(people.length, ws.contacts.length);
  main.innerHTML = `<div class="vwrap ctv">
    <div class="ct-cols ${side ? "side" : ""}">
      <section class="ct-block"><div class="ct-head">${ICON.users}<h2>Lists</h2><span class="n">${ws.contactLists.length}</span><span class="spacer"></span>
        <button class="ghost icon" data-ctv="new-list" title="New list">${ICON.plus}</button></div>
        ${listRows || `<div class="lane-empty">${none || "No lists yet. A list emails several people at once."}</div>`}</section>
      <section class="ct-block"><div class="ct-head">${ICON.user}<h2>Contacts</h2><span class="n">${ws.contacts.length}</span><span class="spacer"></span>
        <button class="ghost icon" data-ctv="new-contact" title="New contact">${ICON.plus}</button></div>
        ${peopleRows || `<div class="lane-empty">${none || "No contacts yet."}</div>`}</section>
    </div></div>`;
}
document.addEventListener("click", e => {
  if (ui.view !== "contacts") return;
  const b = e.target.closest?.("#main [data-ctv]");
  if (b) { (b.dataset.ctv === "new-list" ? editContactList : editContact)(null); return; }
  const d = e.target.closest?.("#main [data-ct-det]");
  if (d) { const id = d.dataset.ctDet; ctOpen.has(id) ? ctOpen.delete(id) : ctOpen.add(id); renderMain(); return; }
  if (e.target.closest?.("#main .ct-details")) return;
  const t = e.target.closest?.("#main [data-goto-task]");
  if (t) { const n = note(t.dataset.gotoTask); if (n) openNote(n); return; }
  const r = e.target.closest?.("#main .ct-row[data-ct]");
  if (r) { const it = ctItem(r.dataset.ct); if (it) (it.kind === "list" ? editContactList : editContact)(it.x.id); }
});

// drag a contact onto a list to add it there (its own drag state, apart
// from the board's cards and links)
let ctDrag = null;
const ctDropList = e => ctDrag && ui.view === "contacts" ? e.target.closest?.("#main .ct-row[data-kind=list]") : null;
const clearCtDrop = () => $$(".ct-row.ct-drop").forEach(x => x.classList.remove("ct-drop"));
document.addEventListener("dragstart", e => {
  if (ui.view !== "contacts") return;
  const r = e.target.closest?.("#main .ct-row[data-kind=contact]"); if (!r) return;
  const c = contactById(r.dataset.ct); if (!c) return;
  ctDrag = c.id;
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData("text/plain", c.email);
  r.classList.add("dragging");
  $("#main .ct-cols")?.classList.add("ct-dragging");
});
document.addEventListener("dragover", e => {
  const l = ctDropList(e);
  if (!l) { if (ctDrag) clearCtDrop(); return; }
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  if (!l.classList.contains("ct-drop")) { clearCtDrop(); l.classList.add("ct-drop"); }
});
document.addEventListener("drop", e => {
  const el = ctDropList(e); if (!el) return;
  e.preventDefault();
  const l = contactListById(el.dataset.ct), c = contactById(ctDrag);
  ctDrag = null; clearCtDrop();
  if (!l || !c) return;
  l.members ||= [];
  if (l.members.includes(c.id)) { toast(`${esc(ctName(c))} is already in ${esc(l.name)}.`); return; }
  const snapshot = JSON.stringify(ws);
  l.members.push(c.id);
  save(); render();
  offerUndo(`Added ${esc(ctName(c))} to ${esc(l.name)}.`, snapshot);
});
document.addEventListener("dragend", () => {
  if (!ctDrag) return;
  ctDrag = null; clearCtDrop();
  $$(".ct-row.dragging").forEach(x => x.classList.remove("dragging"));
  $("#main .ct-cols")?.classList.remove("ct-dragging");
});

// ---------- the task panel: + contact ----------
// Wires the "contacts" panel and the Contacts section of an open task.
function contactPanel(n, o, touch) {
  const filter = $("#nCtFilter", o), pick = $("#nCtPick", o);
  const renderChips = () => {
    const html = contactChips(n);
    $("#nCtChips", o).innerHTML = html;
    $("#nCtSec", o).hidden = !html;
    $("#nCtMail", o).hidden = taskEmails(n).length < 1;
  };
  const renderPick = () => {
    const q = filter.value.toLowerCase();
    const mine = new Set(n.contacts || []);
    const lbl = (id, icon, name, sub) => `<label><input type="checkbox" data-ct-pick="${id}" ${mine.has(id) ? "checked" : ""}>${icon}${esc(name)} <span class="u">${esc(sub)}</span></label>`;
    const ls = ws.contactLists.filter(l => !q || l.name.toLowerCase().includes(q));
    const cs = ws.contacts.filter(c => !q || `${c.name} ${c.email}`.toLowerCase().includes(q));
    let html = "";
    if (ls.length) html += `<div class="grp">Lists</div>` + ls.map(l => lbl(l.id, listIcon(l), l.name, `${listMembers(l).length} contacts`)).join("");
    if (cs.length) html += `<div class="grp">Contacts</div>` + cs.map(c => lbl(c.id, ICON.user, ctName(c), c.email)).join("");
    pick.innerHTML = html || `<div class="none">${ws.contacts.length || ws.contactLists.length ? "no match" : "No contacts yet — add one below."}</div>`;
  };
  filter.style.display = ws.contacts.length + ws.contactLists.length > 8 ? "" : "none";
  filter.oninput = renderPick;
  pick.onchange = e => {
    const id = e.target.dataset.ctPick; if (!id) return;
    n.contacts ||= [];
    n.contacts = e.target.checked ? [...n.contacts, id] : n.contacts.filter(x => x !== id);
    touch(); renderChips();
  };
  const addNew = () => {
    const name = $("#nCtName", o).value.trim(), email = $("#nCtEmail", o).value.trim();
    if (!validEmail(email)) { toast(email ? "That doesn't look like an email address." : "Type an email address."); $("#nCtEmail", o).focus(); return; }
    let c = ws.contacts.find(x => x.email.toLowerCase() === email.toLowerCase());
    if (!c) { c = { id: uid(), name, email }; ws.contacts.push(c); }
    else if (name && !c.name) c.name = name;
    n.contacts ||= [];
    if (!n.contacts.includes(c.id)) n.contacts.push(c.id);
    $("#nCtName", o).value = ""; $("#nCtEmail", o).value = "";
    $("#nCtName", o).focus();
    touch(); renderPick(); renderChips();
  };
  $("#nCtAdd", o).onclick = addNew;
  $("#nCtName", o).onkeydown = $("#nCtEmail", o).onkeydown = e => { if (e.key === "Enter") addNew(); };
  $("#nCtMail", o).onclick = e => taskEmailMenu(n, e.currentTarget);
  renderPick(); renderChips();
  return () => { renderPick(); renderChips(); };
}
// email everyone on a task, as To, CC or BCC
function taskEmailMenu(n, anchor) {
  const emails = taskEmails(n);
  popMenu(anchor, `<div class="menu-label">${emails.length} address${emails.length === 1 ? "" : "es"}</div>
    <button data-m="to">${ICON.mail} New email to all</button>
    <button data-m="cc">${ICON.mail} New email, all as CC</button>
    <button data-m="bcc">${ICON.mail} New email, all as BCC</button>
    <button data-m="copy">${ICON.copy} Copy addresses</button>`, d => {
    if (d.m === "copy") copyText(emails.join(", ")).then(() => toast(`${emails.length} address${emails.length === 1 ? "" : "es"} copied.`));
    else emailTo(emails, d.m, n.title || "");
  });
}
// from the task's right-click menu: tick contacts and lists on or off; the
// menu stays open while you tick, and can add a new contact
function contactPickMenu(n, anchor) {
  const mine = new Set(n.contacts || []);
  const row = (id, icon, name, sub) => `<label class="cpm-row" data-q="${esc((name + " " + sub).toLowerCase())}">`
    + `<input type="checkbox" data-cpm="${id}" ${mine.has(id) ? "checked" : ""}>${icon}<span class="cpm-n">${esc(name)}</span><span class="u">${esc(sub)}</span></label>`;
  const lists = [...ws.contactLists].sort((a, b) => a.name.localeCompare(b.name));
  const people = [...ws.contacts].sort((a, b) => ctName(a).localeCompare(ctName(b)));
  const many = lists.length + people.length > 8;
  popMenu(anchor, `<div class="menu-label">Contacts on “${esc(n.title || "(untitled)")}”</div>
    ${many ? `<input type="search" class="cpm-filter" placeholder="filter…">` : ""}
    <div class="cpm-list">${lists.length ? `<div class="menu-label">Lists</div>` + lists.map(l => row(l.id, listIcon(l), l.name, `${listMembers(l).length} contacts`)).join("") : ""}
    ${people.length ? `<div class="menu-label">Contacts</div>` + people.map(c => row(c.id, ICON.user, ctName(c), c.email)).join("") : ""}
    ${lists.length + people.length ? "" : `<div class="today-empty">No contacts yet.</div>`}</div>
    <hr><button data-m="new">${ICON.plusSm} New contact…</button>`, d => {
    if (d.m === "new") editContact(null, { after: c => { n.contacts ||= []; if (!n.contacts.includes(c.id)) n.contacts.push(c.id); n.updated = nowSec(); save(); render(); } });
  });
  const m = $(".menu"); if (!m) return;
  m.classList.add("cpm");
  m.addEventListener("change", e => {
    const id = e.target.dataset.cpm; if (!id) return;
    n.contacts = e.target.checked ? [...(n.contacts || []), id] : (n.contacts || []).filter(x => x !== id);
    n.updated = nowSec(); save(); render();
  });
  const f = $(".cpm-filter", m);
  if (f) {
    f.focus();
    f.addEventListener("input", () => {
      const q = f.value.toLowerCase();
      $$(".cpm-row", m).forEach(r => { r.style.display = r.dataset.q.includes(q) ? "" : "none"; });
    });
  }
}
