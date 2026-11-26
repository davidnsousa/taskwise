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
const ctLabel = it => it.kind === "list" ? it.x.name || "(unnamed list)" : ctName(it.x);
const ctEmails = it => (it.kind === "list" ? listMembers(it.x).map(c => c.email) : [it.x.email]).filter(Boolean);
const tasksWithContact = id => ws.notes.filter(n => (n.contacts || []).includes(id));
// every address a task's contacts and lists add up to, once each
const taskEmails = n => [...new Set((n.contacts || []).map(ctItem).filter(Boolean).flatMap(ctEmails))];
const validEmail = s => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(s);
// searchable text for a task's contacts
const contactText = n => (n.contacts || []).map(ctItem).filter(Boolean).map(it => `${ctLabel(it)} ${ctEmails(it).join(" ")}`).join(" ");

// ---------- sending email ----------
// Settings › Email with picks the app. Nothing is chosen until you pick one.
const EMAIL_APPS = [
  { id: "", name: "Not set" },
  { id: "outlook", name: "Outlook (web)" },
  { id: "gmail", name: "Gmail (web)" },
  { id: "mailto", name: "Default mail app" },
];
function composeUrl({ to = [], cc = [], bcc = [], subject = "", body = "" }) {
  // keep @ and , readable; everything else encoded
  const enc = s => encodeURIComponent(s).replace(/%40/g, "@").replace(/%2C/g, ",");
  const qs = pairs => pairs.filter(([, v]) => v).map(([k, v]) => `${k}=${enc(v)}`).join("&");
  const j = a => a.join(",");
  const mailto = () => {
    const q = qs([["cc", j(cc)], ["bcc", j(bcc)], ["subject", subject], ["body", body]]);
    return `mailto:${to.map(enc).join(",")}${q ? "?" + q : ""}`;
  };
  switch (settings.emailApp) {
    case "outlook":
      // the compose deeplink only takes "to"; CC and BCC go through the
      // mailto: address Outlook on the web reads when it handles mailto links
      if (!cc.length && !bcc.length) return "https://outlook.cloud.microsoft/mail/deeplink/compose?" + qs([["to", j(to)], ["subject", subject], ["body", body]]);
      return "https://outlook.cloud.microsoft/mail/deeplink/compose?mailtouri=" + encodeURIComponent(mailto());
    case "gmail":
      return "https://mail.google.com/mail/?" + qs([["view", "cm"], ["fs", "1"], ["to", j(to)], ["cc", j(cc)], ["bcc", j(bcc)], ["su", subject], ["body", body]]);
    case "mailto": return mailto();
  }
  return null;
}
// as: "to", "cc" or "bcc"
function emailTo(emails, as = "to", subject = "") {
  if (!emails.length) { toast("No email address there yet."); return; }
  const url = composeUrl({ [as]: emails, subject });
  if (!url) {
    const t = toast(`Choose how to send email in Settings first. <button>Settings</button>`, 8000);
    $("button", t).onclick = () => { t.classList.remove("show"); openSettings(); };
    return;
  }
  if (url.startsWith("mailto:")) location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
  // a web app may leave CC or BCC empty: have the addresses ready to paste
  if (as !== "to" && settings.emailApp !== "mailto")
    copyText(emails.join(", ")).then(() => toast(`Also copied ${emails.length === 1 ? "the address" : `the ${emails.length} addresses`} — paste ${emails.length === 1 ? "it" : "them"} into ${as.toUpperCase()} if the field is empty.`, 8000));
}

// ---------- chips on tasks ----------
function contactChips(n) {
  return (n.contacts || []).map(id => {
    const it = ctItem(id); if (!it) return "";
    const emails = ctEmails(it);
    const title = it.kind === "list" ? `list: ${emails.length} address${emails.length === 1 ? "" : "es"}` : it.x.email || "no email";
    return `<span class="ct-wrap ${it.kind}" data-ct="${id}" data-ct-note="${n.id}" title="${esc(title)}">${it.kind === "list" ? ICON.users : ICON.user}`
      + `<span class="ct-n">${esc(ctLabel(it))}</span><button class="ct-more" title="Contact menu" draggable="false">${ICON.more}</button></span>`;
  }).join("");
}

// ---------- the contact / list menu ----------
// From a task (n) it can take the contact off the task and uses the task's
// title as the subject; elsewhere it deletes the contact itself (undoable).
function contactMenu(id, anchor, n) {
  const it = ctItem(id); if (!it) return;
  const emails = ctEmails(it), subject = n?.title || "";
  const ov = anchor.closest?.(".overlay");
  const info = it.kind === "list" ? `${listMembers(it.x).length} contact${listMembers(it.x).length === 1 ? "" : "s"}` : it.x.email || "no email";
  popMenu(anchor, `
    <div class="menu-label">${esc(ctLabel(it))} · ${esc(info)}</div>
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
function contactMenuFrom(el, at) {
  const host = el.closest("[data-ct]"); if (!host) return false;
  const n = host.dataset.ctNote ? note(host.dataset.ctNote) : null;
  contactMenu(host.dataset.ct, at || host.querySelector(".ct-more") || host, n);
  return true;
}
document.addEventListener("click", e => {
  const el = e.target.closest?.(".ct-wrap, .ct-row .ct-more");
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  contactMenuFrom(el, e.target.closest(".ct-more") || el);
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
    <label class="f">Name<input type="text" id="cName" placeholder="Ada Lovelace"></label>
    <label class="f">Email<input type="text" id="cEmail" placeholder="name@example.com"></label>
    <label class="f">Note (optional)<input type="text" id="cNote" placeholder="role, company, phone…"></label>
    ${lists.length ? `<div class="section-f"><span class="lbl">Lists</span><div class="ct-pick">${lists.map(l =>
      `<label><input type="checkbox" data-l="${l.id}" ${c && (l.members || []).includes(c.id) ? "checked" : ""}>${esc(l.name)}</label>`).join("")}</div></div>` : ""}
    <div id="cErr" class="due-preview bad"></div>
    <div class="foot"><div class="spacer"></div><button id="cCancel">Cancel</button><button class="primary" id="cOk">${c ? "Save" : "Add contact"}</button></div>`, "small");
  $("#cName", o).value = c?.name ?? name;
  $("#cEmail", o).value = c?.email ?? email;
  $("#cNote", o).value = c?.note || "";
  $(c || !name ? "#cName" : "#cEmail", o).focus();
  const ok = () => {
    const nm = $("#cName", o).value.trim(), em = $("#cEmail", o).value.trim(), nt = $("#cNote", o).value.trim();
    if (!validEmail(em)) { $("#cErr", o).textContent = em ? "That doesn't look like an email address." : "An email address is needed."; return; }
    const dup = ws.contacts.find(x => x !== c && x.email.toLowerCase() === em.toLowerCase());
    if (dup) { $("#cErr", o).textContent = `Already a contact: ${ctName(dup)}.`; return; }
    const x = c || { id: uid() };
    Object.assign(x, { name: nm, email: em });
    if (nt) x.note = nt; else delete x.note;
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
  o.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("input[type=text]")) ok(); });
}
function editContactList(id, { after } = {}) {
  const l = id ? contactListById(id) : null;
  const sorted = [...ws.contacts].sort((a, b) => ctName(a).localeCompare(ctName(b)));
  const o = modal(`<h3>${l ? "Edit list" : "New list"}</h3>
    <label class="f">Name<input type="text" id="clName" placeholder="Steering committee"></label>
    <div class="section-f"><span class="lbl">Members</span>
      ${sorted.length > 8 ? `<input type="search" id="clFilter" placeholder="filter contacts…">` : ""}
      <div class="link-pick ct-members" id="clMembers">${sorted.map(c =>
        `<label data-q="${esc((ctName(c) + " " + c.email).toLowerCase())}"><input type="checkbox" data-c="${c.id}" ${l && (l.members || []).includes(c.id) ? "checked" : ""}>${esc(ctName(c))} <span class="u">${esc(c.email)}</span></label>`).join("")
        || `<div class="none">No contacts yet. Add the list, then add contacts to it from the Contacts view.</div>`}</div></div>
    <div id="clErr" class="due-preview bad"></div>
    <div class="foot"><div class="spacer"></div><button id="clCancel">Cancel</button><button class="primary" id="clOk">${l ? "Save" : "Add list"}</button></div>`, "small");
  $("#clName", o).value = l?.name || "";
  $("#clName", o).focus();
  $("#clFilter", o)?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    $$("#clMembers label", o).forEach(r => { r.style.display = r.dataset.q.includes(q) ? "" : "none"; });
  });
  const ok = () => {
    const nm = $("#clName", o).value.trim();
    if (!nm) { $("#clErr", o).textContent = "Give the list a name."; return; }
    const x = l || { id: uid() };
    x.name = nm;
    x.members = $$("[data-c]", o).filter(b => b.checked).map(b => b.dataset.c);
    if (!l) ws.contactLists.push(x);
    save(); closeModal(); render();
    after?.(x);
  };
  $("#clOk", o).onclick = ok;
  $("#clCancel", o).onclick = closeModal;
  $("#clName", o).addEventListener("keydown", e => { if (e.key === "Enter") ok(); });
}

// ---------- the Contacts view ----------
function renderContacts(main) {
  const words = (ui.q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hit = s => words.every(w => s.toLowerCase().includes(w));
  const usedIn = id => { const k = tasksWithContact(id).length; return k ? `<span class="ct-tasks" title="on ${k} task${k === 1 ? "" : "s"}">${k} task${k === 1 ? "" : "s"}</span>` : ""; };
  const row = (id, kind, title, sub) => `<div class="ct-row" data-ct="${id}" title="click to edit">
      <span class="ct-ic">${kind === "list" ? ICON.users : ICON.user}</span>
      <span class="ct-main"><span class="ct-t">${esc(title)}</span><span class="ct-sub">${sub}</span></span>
      ${usedIn(id)}<button class="ghost icon ct-more" title="Contact menu">${ICON.more}</button></div>`;
  const lists = [...ws.contactLists].sort((a, b) => a.name.localeCompare(b.name))
    .filter(l => hit(`${l.name} ${listMembers(l).map(c => ctName(c) + " " + c.email).join(" ")}`));
  const people = [...ws.contacts].sort((a, b) => ctName(a).localeCompare(ctName(b)))
    .filter(c => hit(`${c.name} ${c.email} ${c.note || ""}`));
  const listRows = lists.map(l => {
    const m = listMembers(l);
    return row(l.id, "list", l.name, m.length ? esc(m.map(ctName).join(", ")) : `<i>no members yet</i>`);
  }).join("");
  const peopleRows = people.map(c => {
    const inLists = ws.contactLists.filter(l => (l.members || []).includes(c.id)).map(l => l.name);
    return row(c.id, "contact", ctName(c), esc([c.email, c.note, inLists.length ? `in ${inLists.join(", ")}` : ""].filter(Boolean).join(" · ")));
  }).join("");
  const none = words.length ? "No match." : null;
  main.innerHTML = `<div class="vwrap ctv">${vbar(`<span class="hint">One address book for every board. On a task, use <b>+ contact</b> to add people or whole lists.</span><span class="spacer"></span>
      <button data-ctv="new-list">${ICON.users} New list</button><button class="primary" data-ctv="new-contact">${ICON.plusSm} New contact</button>`)}
    <div class="ct-cols">
      <section class="ct-block"><div class="ct-head"><h2>Lists</h2><span class="n">${ws.contactLists.length}</span></div>
        ${listRows || `<div class="lane-empty">${none || "No lists yet. A list emails several people at once."}</div>`}</section>
      <section class="ct-block"><div class="ct-head"><h2>Contacts</h2><span class="n">${ws.contacts.length}</span></div>
        ${peopleRows || `<div class="lane-empty">${none || "No contacts yet."}</div>`}</section>
    </div></div>`;
}
document.addEventListener("click", e => {
  if (ui.view !== "contacts") return;
  const b = e.target.closest?.("#main [data-ctv]");
  if (b) { (b.dataset.ctv === "new-list" ? editContactList : editContact)(null); return; }
  const r = e.target.closest?.("#main .ct-row[data-ct]");
  if (r) { const it = ctItem(r.dataset.ct); if (it) (it.kind === "list" ? editContactList : editContact)(it.x.id); }
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
    if (ls.length) html += `<div class="grp">Lists</div>` + ls.map(l => lbl(l.id, ICON.users, l.name, `${listMembers(l).length} contacts`)).join("");
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
