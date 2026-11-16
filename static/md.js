// A small Markdown renderer for note text: headings, paragraphs, lists
// (nested, numbered, and "- [ ]" task lists), quotes, code, rules, links,
// **bold**, *italic*, ~~strike~~ and `code`. Everything is escaped first,
// so a note can't inject HTML. Task boxes carry the source line they came
// from (data-line), which MD.toggleTask flips.
"use strict";
const MD = (() => {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeHref = u => (/^(https?:\/\/|mailto:|file:\/\/|\/|~\/)/i.test(u) ? u : null);
  const linkHtml = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;

  function inline(src) {
    const keep = [];   // code spans and links, put back after escaping
    const hold = html => `\u0000${keep.push(html) - 1}\u0000`;
    let s = src.replace(/`([^`]+)`/g, (m, c) => hold(`<code>${esc(c)}</code>`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
      const href = safeHref(u);
      return href ? hold(linkHtml(href, inline(t))) : m;
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>]*[^\s<>.,;:!?)'"])/g, (m, p, u) => p + hold(linkHtml(u, esc(u))));
    s = esc(s)
      .replace(/\*\*(?!\s)(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(?!\s)(.+?)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*(?![\s*])(.+?)\*(?!\w)/g, "$1<em>$2</em>")
      .replace(/(^|[^_\w])_(?![\s_])(.+?)_(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~(?!\s)(.+?)~~/g, "<del>$1</del>");
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
  }

  const indentOf = ws => ws.replace(/\t/g, "    ").length;

  function render(src, { tasks = false, offset = 0 } = {}) {
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    let out = "", para = [], prevBlank = true;
    const lists = [];   // open lists, innermost last: { type, indent }
    const flushPara = () => { if (para.length) { out += `<p>${para.map(l => inline(l.trim())).join("<br>")}</p>`; para = []; } };
    const closeLists = () => { while (lists.length) out += `</li></${lists.pop().type}>`; };
    const item = (type, indent, html, cls = "") => {
      flushPara();
      while (lists.length && lists.at(-1).indent > indent) out += `</li></${lists.pop().type}>`;
      const top = lists.at(-1);
      if (top && top.indent === indent && top.type === type) out += "</li>";
      else {
        if (top && top.indent === indent) out += `</li></${lists.pop().type}>`;
        out += `<${type}>`;
        lists.push({ type, indent });
      }
      out += `<li${cls ? ` class="${cls}"` : ""}>${html}`;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (/^\s*```/.test(line)) {
        flushPara(); closeLists();
        const buf = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i]);
        out += `<pre><code>${esc(buf.join("\n"))}</code></pre>`;
        prevBlank = false;
        continue;
      }
      if (!line.trim()) { flushPara(); prevBlank = true; continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        flushPara(); closeLists();
        out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
      } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flushPara(); closeLists();
        out += "<hr>";
      } else if (/^\s{0,3}>/.test(line)) {
        flushPara(); closeLists();
        const start = i, buf = [];
        for (; i < lines.length && /^\s{0,3}>/.test(lines[i]); i++) buf.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i--;
        out += `<blockquote>${render(buf.join("\n"), { tasks, offset: offset + start })}</blockquote>`;
      } else if ((m = line.match(/^(\s*)[-*+]\s+\[([ xX])\](?:\s+(.*))?$/))) {
        const box = `<input type="checkbox" class="md-task" data-line="${offset + i}"${m[2] === " " ? "" : " checked"}${tasks ? "" : " disabled"}>`;
        item("ul", indentOf(m[1]), `${box}<span>${inline(m[3] || "")}</span>`, `task${m[2] === " " ? "" : " checked"}`);
      } else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) {
        item("ul", indentOf(m[1]), inline(m[2]));
      } else if ((m = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) {
        item("ol", indentOf(m[1]), inline(m[3]));
      } else if (lists.length && !prevBlank) {
        out += `<br>${inline(line.trim())}`;   // a wrapped line of the item above
      } else {
        closeLists();
        para.push(line);
      }
      prevBlank = false;
    }
    flushPara(); closeLists();
    return out;
  }

  // flip the "[ ]" / "[x]" on one line of the source
  function toggleTask(src, line) {
    const lines = String(src || "").split("\n");
    if (lines[line] == null) return src;
    lines[line] = lines[line].replace(/^(\s*(?:>\s?)*\s*[-*+]\s+)\[([ xX])\]/, (m, p, c) => `${p}[${c === " " ? "x" : " "}]`);
    return lines.join("\n");
  }

  // how many "- [ ]" boxes the text has and how many are ticked (code blocks
  // skipped, quoted and nested boxes counted, as render shows them)
  function taskCount(src) {
    let done = 0, total = 0, code = false;
    for (const line of String(src || "").split("\n")) {
      if (/^\s*```/.test(line)) { code = !code; continue; }
      if (code) continue;
      const m = line.match(/^\s*(?:>\s?)*\s*[-*+]\s+\[([ xX])\](?:\s|$)/);
      if (m) { total++; if (m[1] !== " ") done++; }
    }
    return { done, total };
  }

  // one line as plain text, for one-line previews
  const plain = line => String(line || "")
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/, "")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .trim();

  return { render, toggleTask, taskCount, plain, inline };
})();
