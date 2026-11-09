// Fuzzy due dates: "next week", "3 days", "2w", "next month", "before the 15th",
// "friday", "tomorrow"... A real date is still accepted (2026-12-01, 15/12).
//
// A due is stored as { text, target, set }: the words you typed, the last
// day it resolves to (YYYY-MM-DD, used for sorting/filtering/overdue) and
// the day you set it. The board shows it relative to today ("in 5 days",
// "overdue 2d"), never as a calendar date.

const Due = (() => {
  const DAY = 86400000;
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const WD_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const NUMWORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };

  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fromIso = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const diffDays = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / DAY);
  // weeks run Monday-Sunday; "this week" ends on the coming Sunday
  const endOfWeek = d => addDays(d, (7 - d.getDay()) % 7);
  const addMonths = (d, n) => {
    const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
    return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), daysInMonth(first.getFullYear(), first.getMonth())));
  };
  const ordinal = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
  const num = s => (s in NUMWORDS ? NUMWORDS[s] : parseInt(s, 10));
  const weekdayIndex = s => { s = s.toLowerCase(); let i = WEEKDAYS.indexOf(s); if (i < 0) i = WD_SHORT.indexOf(s.slice(0, 3)); return i; };

  // Returns { text, target } (text = tidied-up words), null if not understood,
  // or "" for an empty input (= no due).
  function parse(input, now = new Date()) {
    const today = startOfDay(now);
    let s = (input || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!s) return "";
    s = s.replace(/^(due|by end of|end of|in|within)\s+/, m => (m.startsWith("end of") || m.startsWith("by end of") ? "end of " : ""));
    let m;
    const r = (text, date) => ({ text, target: iso(date) });

    // "by the 15th", "until 15": the 15th itself is the last day
    if ((m = s.match(/^(by|until|till|on) (the )?(day )?(\d{1,2})(st|nd|rd|th)?$/))) {
      const n = parseInt(m[4], 10);
      if (n < 1 || n > 31) return null;
      let mo = today.getMonth() + (n < today.getDate() ? 1 : 0);
      const first = new Date(today.getFullYear(), mo, 1);
      return r(`by the ${ordinal(n)}`, new Date(first.getFullYear(), first.getMonth(), Math.min(n, daysInMonth(first.getFullYear(), first.getMonth()))));
    }
    s = s.replace(/^(by|until|till|on)\s+/, "");

    if (/^(today|tonight|now|asap)$/.test(s)) return r("today", today);
    if (/^(tomorrow|tmr|tmrw|tomorow)$/.test(s)) return r("tomorrow", addDays(today, 1));
    if (/^(day after tomorrow|overmorrow)$/.test(s)) return r("in 2 days", addDays(today, 2));

    if ((m = s.match(/^(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)( of)? ?(d|day|days)$/)))
      { const n = num(m[1]); return r(n === 1 ? "in 1 day" : `in ${n} days`, addDays(today, n)); }
    if ((m = s.match(/^(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)( of)? ?(w|wk|wks|week|weeks)$/)))
      { const n = num(m[1]); return r(n === 1 ? "in 1 week" : `in ${n} weeks`, addDays(today, 7 * n)); }
    if ((m = s.match(/^(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)( of)? ?(m|mo|month|months)$/)))
      { const n = num(m[1]); return r(n === 1 ? "in 1 month" : `in ${n} months`, addMonths(today, n)); }

    if (/^(this week|end of (the )?week|eow|this weekend|weekend)$/.test(s)) return r("this week", endOfWeek(today));
    if (/^next week$/.test(s)) return r("next week", addDays(endOfWeek(today), 7));
    if (/^(week after next|the week after next)$/.test(s)) return r("week after next", addDays(endOfWeek(today), 14));
    if (/^(this month|end of (the )?month|eom)$/.test(s)) return r("this month", new Date(today.getFullYear(), today.getMonth() + 1, 0));
    if (/^next month$/.test(s)) return r("next month", new Date(today.getFullYear(), today.getMonth() + 2, 0));
    if (/^(this year|end of (the )?year|eoy)$/.test(s)) return r("this year", new Date(today.getFullYear(), 11, 31));
    if (/^next year$/.test(s)) return r("next year", new Date(today.getFullYear() + 1, 11, 31));

    // "before 15", "before the 15th", "before day 15": the last day before
    // the next 15th (this month if it's still ahead, otherwise next month)
    if ((m = s.match(/^before (the )?(day )?(\d{1,2})(st|nd|rd|th)?$/))) {
      const n = parseInt(m[3], 10);
      if (n < 1 || n > 31) return null;
      let y = today.getFullYear(), mo = today.getMonth();
      if (n <= today.getDate()) mo += 1;
      const first = new Date(y, mo, 1);
      y = first.getFullYear(); mo = first.getMonth();
      const day = new Date(y, mo, Math.min(n, daysInMonth(y, mo)));
      return r(`before the ${ordinal(n)}`, addDays(day, -1));
    }

    // weekdays: "friday", "next friday", "before friday"
    if ((m = s.match(/^(next |this |before )?([a-z]+)$/)) && weekdayIndex(m[2]) >= 0 && m[2].length >= 3) {
      const wd = weekdayIndex(m[2]);
      let n = (wd - today.getDay() + 7) % 7 || 7;
      if (m[1] === "next " && n < 7 && endOfWeek(addDays(today, n)) <= endOfWeek(today)) n += 7;
      const name = WEEKDAYS[wd][0].toUpperCase() + WEEKDAYS[wd].slice(1);
      if (m[1] === "before ") return r(`before ${name}`, addDays(today, n - 1));
      return r((m[1] === "next " ? "next " : "") + name, addDays(today, n));
    }

    // real dates still work: 2026-12-01, 15/12, 15/12/2026, 15.12.
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      return d.getMonth() === +m[2] - 1 ? r(s, d) : null;
    }
    if ((m = s.match(/^(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\.?$/))) {
      let y = m[3] ? +m[3] : today.getFullYear();
      if (y < 100) y += 2000;
      let d = new Date(y, +m[2] - 1, +m[1]);
      if (d.getMonth() !== +m[2] - 1) return null;
      if (!m[3] && d < today) d = new Date(y + 1, +m[2] - 1, +m[1]);
      return r(`${+m[1]} ${MONTHS[+m[2] - 1]}`, d);
    }
    return null;
  }

  // Relative label for a target day: { label, cls, days }
  function status(target, now = new Date()) {
    if (!target) return null;
    const today = startOfDay(now);
    const t = fromIso(target);
    const days = diffDays(t, today);
    let label, cls;
    if (days < 0) { label = days === -1 ? "overdue 1 day" : `overdue ${-days} days`; cls = "overdue"; }
    else if (days === 0) { label = "today"; cls = "today"; }
    else if (days === 1) { label = "tomorrow"; cls = "soon"; }
    else if (t <= endOfWeek(today)) { label = `this week · ${days}d`; cls = "soon"; }
    else if (t <= addDays(endOfWeek(today), 7)) { label = `next week · ${days}d`; cls = "week"; }
    else if (days < 56) { const w = Math.round(days / 7); label = `in ${w} weeks`; cls = "later"; }
    else { const mo = Math.round(days / 30.4); label = mo <= 1 ? "in a month" : `in ${mo} months`; cls = "later"; }
    return { label, cls, days };
  }

  // For tooltips only (you asked not to see dates on the board)
  function describe(due) {
    if (!due || !due.target) return "";
    const t = fromIso(due.target);
    const wd = WEEKDAYS[t.getDay()].slice(0, 3);
    return `“${due.text}” → last day ${wd[0].toUpperCase() + wd.slice(1)} ${t.getDate()} ${MONTHS[t.getMonth()]}` + (due.set ? ` (set ${fromIso(due.set).getDate()} ${MONTHS[fromIso(due.set).getMonth()]})` : "");
  }

  // Due filter buckets
  function inBucket(due, bucket, now = new Date()) {
    if (bucket === "all") return true;
    if (bucket === "none") return !due || !due.target;
    if (!due || !due.target) return false;
    const today = startOfDay(now), t = fromIso(due.target), days = diffDays(t, today);
    switch (bucket) {
      case "any": return true;
      case "overdue": return days < 0;
      case "today": return days <= 0;
      case "week": return t <= endOfWeek(today);
      case "nextweek": return t <= addDays(endOfWeek(today), 7);
      case "month": return t <= new Date(today.getFullYear(), today.getMonth() + 1, 0);
    }
    return true;
  }

  // Which agenda lane a target day falls in
  function lane(target, now = new Date()) {
    if (!target) return "none";
    const today = startOfDay(now), t = fromIso(target), days = diffDays(t, today);
    if (days < 0) return "overdue";
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (t <= endOfWeek(today)) return "week";
    if (t <= addDays(endOfWeek(today), 7)) return "nextweek";
    if (t <= new Date(today.getFullYear(), today.getMonth() + 1, 0)) return "month";
    return "later";
  }

  const todayIso = () => iso(startOfDay(new Date()));
  return { parse, status, describe, inBucket, lane, todayIso };
})();
