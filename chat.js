// ==================================================================================
// The dashboard assistant
// ==================================================================================
//
// A question box that answers from the survey and then takes you to the page
// the answer came from.
//
// Nothing here calls out to anything. There is no model, no key and no network
// beyond the site's own data files: the whole thing is the survey read by a few
// hundred lines of pattern matching, which is why it works with the wifi off and
// why it can never invent a figure. If it cannot find the measure it says so.
//
// What it will answer:
//   how many indicators / counties / chapters, and hello, thanks, help
//   "show me the county map"                   -> opens that page
//   "skilled birth attendance"                 -> the national figure
//   "fertility in Kisumu"                      -> that county, its rank, Kenya
//   "compare Nairobi and Mombasa on stunting"  -> both, and Kenya
//   "which county is highest on X"             -> the top and bottom five
//   "how has X changed in Kisumu"              -> first round to last
//
// The last two the survey can only answer because the 2014 and 2022 county
// figures were merged in; global.R says where they came from.

(function () {
  var D = { cross: null, ctrends: null, trends: null, index: null };
  var READY = null;
  var MSGS = [];
  var OPEN = false;

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmt(v, unit) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    var s = Math.abs(v - Math.round(v)) < 0.05
      ? Math.round(v).toLocaleString("en-US") : v.toFixed(1);
    return s + (unit || "");
  }

  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function get(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  }

  // Everything is fetched once, on the first question, so a reader who never
  // opens the assistant never pays for it.
  function load() {
    if (READY) return READY;
    READY = Promise.all([
      get("data/index.json"), get("data/cross.json"),
      get("data/ctrends.json").catch(function () { return { counties: [], measures: [] }; }),
      get("data/trends.json").catch(function () { return { catalogue: [], series: {} }; })
    ]).then(function (all) {
      D.index = all[0]; D.cross = all[1]; D.ctrends = all[2]; D.trends = all[3];
      D.cross.measures.forEach(function (m) {
        // Rank once, the same way the comparison page does it.
        var seen = [];
        m.v.forEach(function (x, i) { if (x !== null) seen.push({ i: i, x: x }); });
        seen.sort(function (a, b) { return b.x - a.x; });
        m.rank = new Array(m.v.length); m.n = seen.length;
        var place = 0, last = null;
        seen.forEach(function (e, k) {
          if (last === null || e.x !== last) { place = k + 1; last = e.x; }
          m.rank[e.i] = place;
        });
        m.hay = (m.label + " " + m.chap + " " + m.base).toLowerCase();
        m.leaf = leafOf(m.label);
        m.head = headOf(m.label);
      });
      (D.ctrends.measures || []).forEach(function (m) {
        m.hay = (m.label + " " + m.chap + " " + m.base).toLowerCase();
        m.leaf = leafOf(m.label);
        m.head = headOf(m.label);
      });
      return D;
    });
    return READY;
  }

  // ---- reading the question -----------------------------------------------------

  // Two lists, because they do opposite jobs. ASIDE is everything that says what
  // the reader wants done rather than what they want it done to, and it goes
  // before any matching starts. GLUE is the small words a heading is built out
  // of: "delivered in a health facility" only matches if they survive, so they
  // are kept in the middle of a phrase and trimmed off its ends.
  var ASIDE = new Set(("what whats which who whom how when where why show tell give find get let " +
    "me my you your please can could would should does did do i want wants looking know about " +
    "compare comparison compared versus vs against highest lowest best worst top bottom rank " +
    "ranked ranking change changed changes changing move moved moves moving since trend trends " +
    "improve improved improving worse better rose fell risen fallen county counties kenya data " +
    "figure figures value values many much is are was were been has have had it its this that " +
    "there so also just like up").split(" "));

  var GLUE = new Set("a an the of in on at for to from by with and or be".split(" "));

  // What a reader calls it, against what the report's own column is called.
  // Plain word matching misses these: "skilled birth attendance" shares almost
  // nothing with "delivered by a skilled provider".
  var SYNONYMS = [
    [/\bskilled birth attendance\b/i, "delivered by a skilled provider"],
    [/\bskilled attendance at (birth|delivery)\b/i, "delivered by a skilled provider"],
    [/\bbirth attendance\b/i, "delivered by a skilled provider"],
    [/\bfacility (delivery|births?)\b/i, "delivered in a health facility"],
    [/\bcontraceptive prevalence( rate)?\b/i, "any modern method"],
    [/\bcpr\b/i, "any modern method"],
    [/\bmodern contraception\b/i, "any modern method"],
    [/\bfamily planning\b/i, "modern method family planning"],
    [/\bfully immuni[sz]ed\b/i, "fully vaccinated"],
    [/\bimmuni[sz]ation\b/i, "vaccination"],
    [/\bchild mortality\b/i, "under-5 mortality"],
    [/\bexclusive breastfeeding\b/i, "exclusively breastfed"],
    [/\bunmet need\b/i, "unmet need family planning"],
    [/\bteen(age)? pregnancy\b/i, "ever been pregnant"],
    [/\bitns?\b/i, "insecticide-treated mosquito net"],
    [/\bbed ?nets?\b/i, "mosquito net"],
    [/\bclean water\b/i, "basic drinking water service"],
    [/\bsanitation\b/i, "basic sanitation service"],
    [/\bmmr\b/i, "maternal mortality"],
    [/\btfr\b/i, "total fertility rate"],
    [/\banc\b/i, "antenatal care"]
  ];

  var NAV = [
    [/\b(overview|home|start|front page)\b/i, "overview", "the overview"],
    [/\b(county (performance )?map|choropleth|map tab)\b/i, "map", "the county performance map"],
    [/\b(county (performance )?trends?|county trend)\b/i, "ctrends", "county performance trends"],
    [/\b(national trends?|trends? tab)\b/i, "trends", "national trends"],
    [/\b(cross.?indicator|scatter|correlat|compare indicators)\b/i, "compare", "cross-indicator analysis"],
    [/\b(one county|county profile|single county)\b/i, "counties", "the one-county page"],
    [/\b(past data|older rounds?|dhs api|earlier surveys)\b/i, "past", "get past data"]
  ];

  function counties() { return (D.index && D.index.counties) || []; }

  function matchCounties(text) {
    var lower = " " + text.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").replace(/\s+/g, " ") + " ";
    var found = [];
    // Longest first, so "Trans Nzoia" wins over any shorter accidental hit and
    // "Nairobi" is not found twice.
    counties().slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (c) {
      var at = lower.indexOf(" " + c.toLowerCase() + " ");
      if (at !== -1) found.push({ c: c, at: at });
    });
    // Found longest first so the long names win, then put back in the order they
    // were asked in, because "Nairobi and Mombasa" should answer in that order.
    return found.sort(function (a, b) { return a.at - b.at; })
      .map(function (e) { return e.c; });
  }

  function expand(text) {
    var out = text;
    SYNONYMS.forEach(function (p) { if (p[0].test(out)) out = out.replace(p[0], p[1]); });
    return out;
  }

  // The question, turned into the two things the ranking needs: the phrase to
  // look for whole, and the words to look for one at a time.
  function prep(text, cty) {
    var kill = new Set(ASIDE);
    (cty || []).join(" ").toLowerCase().split(/\s+/).forEach(function (w) { kill.add(w); });
    var toks = expand(String(text || "")).toLowerCase()
      .replace(/[?!.,;:"()]/g, " ").split(/\s+/)
      .filter(function (w) { return w && !kill.has(w); });
    while (toks.length && GLUE.has(toks[0])) toks.shift();
    while (toks.length && GLUE.has(toks[toks.length - 1])) toks.pop();
    return {
      phrase: toks.join(" "),
      words: toks.filter(function (w) { return w.length >= 3 && !GLUE.has(w); })
    };
  }

  // The end of a stacked heading is the column itself. "Current use of
  // contraception · Any modern method" is a measure of modern method use;
  // "Knowledge of contraception · Heard of any modern method" is a measure of
  // having heard of it, and the difference lives entirely in that last piece.
  function leafOf(label) {
    var bits = String(label || "").split("·");
    return bits[bits.length - 1].trim().toLowerCase();
  }

  // And the front of it is the table the column sits in. "Antenatal care" names
  // a table, not a column, so a question that is only the table's name should
  // count for that table as much as a column that happens to repeat the words.
  function headOf(label) {
    return String(label || "").split("·")[0].trim().toLowerCase();
  }

  // A measure scores on what it is before what it mentions. The column's own
  // name carries the most, the whole heading next, single words least, which is
  // what keeps a table that merely says "modern method" in passing from beating
  // the table the reader asked for.
  function rank(pool, asked) {
    var q = asked.phrase, words = asked.words;
    if (!words.length) return [];
    var out = [];
    pool.forEach(function (m) {
      var s = 0, hit = 0;
      var leaf = m.leaf || leafOf(m.label);
      if (leaf === q) s += 9;
      else if (leaf.indexOf(q) !== -1) s += 6;
      if ((m.head || headOf(m.label)) === q) s += 6;
      if (m.hay.indexOf(q) !== -1) s += 5;
      words.forEach(function (w) { if (m.hay.indexOf(w) !== -1) { s += 1; hit += 1; } });
      // A question whose words mostly miss has not named a measure at all. Half
      // the words have to land, or the honest answer is that nothing matched:
      // one word in common with a heading is a coincidence, not a request.
      if (s && (hit / words.length >= 0.5 || m.hay.indexOf(q) !== -1)) {
        out.push({ m: m, s: s, exact: leaf === q });
      }
    });
    out.sort(function (a, b) { return b.s - a.s || a.m.label.length - b.m.label.length; });
    return out;
  }

  // One measure is the answer when nothing else is close to it, or when the
  // question is a column's name outright. A high score on its own settles
  // nothing: a table of twenty columns scores all twenty of them alike, and
  // picking the first is a guess dressed as an answer.
  function sure(hits) {
    if (hits.length === 1) return true;
    if (hits[0].exact && !hits[1].exact) return true;
    return (hits[0].s - hits[1].s) >= 2;
  }

  // ---- answering ----------------------------------------------------------------

  function chips() {
    return [
      { label: "Skilled birth attendance in Kisumu", q: "skilled birth attendance in Kisumu" },
      { label: "Which county is highest on modern contraception", q: "which county is highest on any modern method" },
      { label: "How have facility births changed in Turkana", q: "how has delivered in a health facility changed in Turkana" },
      { label: "Compare Nairobi and Mombasa on facility births", q: "compare Nairobi and Mombasa on delivered in a health facility" },
      { label: "Show the county performance map", q: "show the county performance map" }
    ];
  }

  function openChip(page, id) {
    return { label: "Open in the dashboard →", page: page, measure: id };
  }

  function meta(text) {
    var q = text.toLowerCase();
    if (/^(hi|hello|hey|habari|hujambo)\b/.test(q)) {
      return { html: "Hello. Ask me about any measure, any county, or how something has " +
                     "moved between the rounds.", chips: chips() };
    }
    if (/\b(thanks|thank you|asante)\b/.test(q)) {
      return { html: "You are welcome. Ask me anything else." };
    }
    if (/\b(help|what can you do|examples?)\b/.test(q)) {
      return { html: "I can look up any of the <b>" + D.cross.measures.length + "</b> measures the " +
                     "survey publishes for counties, say where a county stands among the 47, and " +
                     "show what has moved since the earlier rounds. Everything I say comes from " +
                     "the published tables, and I will tell you when I cannot find something. " +
                     "Try one of these:", chips: chips() };
    }
    if (/how many (named )?(indicators|measures)|number of indicators/.test(q)) {
      return { html: "The survey publishes <b>" + D.cross.measures.length + "</b> measures for " +
                     "counties on a comparable scale, and <b>" +
                     ((D.ctrends.measures || []).length) + "</b> of them can be followed across " +
                     "more than one round." };
    }
    if (/how many counties|number of counties/.test(q)) {
      return { html: "All <b>47 counties</b> are covered. Not every measure is published for " +
                     "every one of them, and a county the report did not print is left out " +
                     "rather than shown as a zero." };
    }
    if (/how many chapters|list (the )?chapters|which chapters/.test(q)) {
      var seen = {}, list = [];
      (D.index.chapters || []).forEach(function (c) {
        if (!seen[c.page]) { seen[c.page] = 1; list.push(c); } });
      return { html: "The report has <b>" + list.length + "</b> chapters:",
               chips: list.map(function (c) {
                 return { label: c.chapter + ". " + c.chapter_short, page: c.page }; }) };
    }
    return null;
  }

  function nav(text, leftover) {
    for (var i = 0; i < NAV.length; i++) {
      if (NAV[i][0].test(text)) {
        // "show me the trend for stunting" must answer about stunting rather
        // than short-circuiting to the trends tab, so a navigation phrase only
        // wins when nothing else is left to search on.
        var rest = leftover.replace(
          /\b(trend|trends|map|tab|scatter|compare|correlation|performance|page|view)\b/gi, "").trim();
        if (rest.split(/\s+/).filter(Boolean).length <= 1) {
          return { html: "Opening <b>" + esc(NAV[i][2]) + "</b>…",
                   go: { page: NAV[i][1] } };
        }
      }
    }
    return null;
  }

  // Both of these read intent rather than subject. The word endings have to be
  // allowed for: a reader writes "changed" and "ranking", not "chang" and "rank".
  function sub(text) {
    return /\b(highest|lowest|best|worst|top|bottom|which county|rank\w*)\b/i.test(text);
  }
  function moved(text) {
    return /\b(chang\w*|mov\w*|since|trends?|improv\w*|worse|better|rose|fell|risen|fallen)\b/i
      .test(text);
  }

  function answerOne(m, county) {
    var i = counties().indexOf(county);
    var v = i >= 0 ? m.v[i] : null;
    if (v === null || v === undefined) {
      return { html: "<b>" + esc(m.label) + "</b> was not published for <b>" + esc(county) +
                     "</b>.<br><span class=\"cm-sub\">Kenya: " + fmt(m.nat, m.unit) + "</span>",
               chips: [openChip("map", m.id)] };
    }
    return { html: "<b>" + esc(m.label) + "</b><br>" + esc(county) + ": <b>" + fmt(v, m.unit) +
                   "</b><br><span class=\"cm-sub\">" + ordinal(m.rank[i]) + " of " + m.n +
                   " counties. Kenya: " + fmt(m.nat, m.unit) + "</span>",
             chips: [openChip("map", m.id)] };
  }

  function answerTwo(m, a, b) {
    var ia = counties().indexOf(a), ib = counties().indexOf(b);
    var va = ia >= 0 ? m.v[ia] : null, vb = ib >= 0 ? m.v[ib] : null;
    // The distance between two percentages is points, not per cent, and the
    // difference matters enough to the reader that it is worth the extra word.
    var apart = m.unit === "%" ? fmt(Math.abs(va - vb)) + " percentage points"
                               : fmt(Math.abs(va - vb), m.unit);
    var gap = (va !== null && vb !== null)
      ? "<br><span class=\"cm-sub\">" + apart + " between them. Kenya: " +
        fmt(m.nat, m.unit) + "</span>"
      : "<br><span class=\"cm-sub\">Kenya: " + fmt(m.nat, m.unit) + "</span>";
    return { html: "<b>" + esc(m.label) + "</b><br>" + esc(a) + ": <b>" + fmt(va, m.unit) +
                   "</b><br>" + esc(b) + ": <b>" + fmt(vb, m.unit) + "</b>" + gap,
             chips: [openChip("compare", m.id)] };
  }

  function answerRank(m, wantLow) {
    var rows = [];
    counties().forEach(function (c, i) {
      if (m.v[i] !== null && m.v[i] !== undefined) rows.push({ c: c, v: m.v[i] });
    });
    if (!rows.length) return { html: "<b>" + esc(m.label) + "</b> was not published by county." };
    rows.sort(function (x, y) { return wantLow ? x.v - y.v : y.v - x.v; });
    var five = rows.slice(0, 5).map(function (r, k) {
      return (k + 1) + ". " + esc(r.c) + " <b>" + fmt(r.v, m.unit) + "</b>";
    }).join("<br>");
    return { html: "<b>" + esc(m.label) + "</b><br>" +
                   (wantLow ? "Lowest five:" : "Highest five:") + "<br>" + five +
                   "<br><span class=\"cm-sub\">Kenya: " + fmt(m.nat, m.unit) +
                   ". " + rows.length + " counties reported it.</span>",
             chips: [openChip("map", m.id)] };
  }

  function answerMoved(text, county) {
    var hits = rank(D.ctrends.measures || [], prep(text, county ? [county] : []));
    if (!hits.length) return null;
    if (!sure(hits)) {
      return { html: "More than one table follows something like that across the rounds. " +
                     "Which one:",
               chips: hits.slice(0, 5).map(function (h) {
                 return { label: h.m.label, pickT: h.m.id, text: text }; }) };
    }
    return movedOn(hits[0].m, county);
  }

  function movedOn(m, county) {
    var idx = (D.ctrends.counties || []).indexOf(county);
    if (county && idx < 0) return null;

    if (county) {
      var seen = [];
      m.years.forEach(function (y, k) {
        var v = m.v[k][idx];
        if (v !== null && v !== undefined) seen.push({ y: y, v: v });
      });
      if (seen.length < 2) {
        return { html: "<b>" + esc(m.label) + "</b> was printed for <b>" + esc(county) +
                       "</b> in one round only, so there is nothing to compare it with.",
                 chips: [openChip("ctrends", m.id)] };
      }
      var a = seen[0], b = seen[seen.length - 1], d = b.v - a.v;
      return { html: "<b>" + esc(m.label) + "</b> in <b>" + esc(county) + "</b><br>" +
                     esc(a.y) + ": <b>" + fmt(a.v, m.unit) + "</b><br>" +
                     esc(b.y) + ": <b>" + fmt(b.v, m.unit) + "</b><br>" +
                     "<span class=\"cm-sub\">" +
                     (Math.abs(d) < 0.05 ? "Barely moved"
                       : (d > 0 ? "Up " : "Down ") + fmt(Math.abs(d)) +
                         (m.unit === "%" ? " percentage points" : "")) + "</span>",
               chips: [openChip("ctrends", m.id)] };
    }

    var ups = 0, downs = 0;
    (D.ctrends.counties || []).forEach(function (c, i) {
      var s = [];
      m.years.forEach(function (y, k) {
        var v = m.v[k][i];
        if (v !== null && v !== undefined) s.push(v); });
      if (s.length < 2) return;
      var d = s[s.length - 1] - s[0];
      if (d > 0.05) ups++; else if (d < -0.05) downs++;
    });
    return { html: "<b>" + esc(m.label) + "</b>, between " + esc(m.years[0]) + " and " +
                   esc(m.years[m.years.length - 1]) + "<br><b>" + ups + "</b> counties rose, <b>" +
                   downs + "</b> fell.", chips: [openChip("ctrends", m.id)] };
  }

  function answer(raw) {
    var text = String(raw || "").trim();
    if (!text) return null;

    var m0 = meta(text);
    if (m0) return m0;

    var cty = matchCounties(text);
    var asked = prep(text, cty);
    var n = nav(text, asked.phrase);
    if (n) return n;

    if (!asked.words.length) {
      if (cty.length) {
        return { html: "What would you like to know about <b>" + esc(cty.join(" and ")) +
                       "</b>? Name a measure too, for example “skilled birth attendance in " +
                       esc(cty[0]) + "”." };
      }
      return null;
    }

    if (moved(text)) {
      var mv = answerMoved(text, cty[0] || null);
      if (mv) return mv;
    }

    var hits = rank(D.cross.measures, asked);
    if (!hits.length) {
      return { html: "I could not find a measure matching that. The survey names things the way " +
                     "its tables do, so it may be worth trying the report's own wording, or a " +
                     "county name alongside it.", chips: chips() };
    }
    // Only ask which one they meant when a real rival is close behind. The
    // choice carries the question with it, so picking a column from the list
    // answers what was asked rather than starting the question again: "which
    // county is highest on" survives the choosing.
    if (!sure(hits)) {
      return { html: "The survey publishes that in more than one table. Which one:",
               chips: hits.slice(0, 5).map(function (h) {
                 return { label: h.m.label, pick: h.m.id, text: text }; }) };
    }
    return decide(hits[0].m, text, cty);
  }

  // What to say once the measure is settled, whether it was settled by the
  // ranking or by the reader picking from the list.
  function decide(m, text, cty) {
    if (sub(text)) return answerRank(m, /\b(lowest|worst|bottom)\b/i.test(text));
    if (cty.length >= 2) return answerTwo(m, cty[0], cty[1]);
    if (cty.length === 1) return answerOne(m, cty[0]);
    return { html: "<b>" + esc(m.label) + "</b>: <b>" + fmt(m.nat, m.unit) + "</b> for Kenya as a " +
                   "whole.<br><span class=\"cm-sub\">Published for " + m.n + " counties.</span>",
             chips: [openChip("map", m.id)] };
  }

  // ---- the widget ---------------------------------------------------------------

  function push(role, payload) {
    MSGS.push(Object.assign({ role: role }, payload));
    paint();
  }

  function paint() {
    var body = document.getElementById("kchat-body");
    if (!body) return;
    body.innerHTML = MSGS.map(function (m, i) {
      if (m.role === "user") return '<div class="chat-msg user">' + esc(m.text) + "</div>";
      var c = (m.chips && m.chips.length)
        ? '<div class="chat-chips">' + m.chips.map(function (x, k) {
            return '<button type="button" class="chat-chip" data-chip="' + i + ":" + k + '">' +
                   esc(x.label) + "</button>"; }).join("") + "</div>"
        : "";
      return '<div class="chat-msg bot">' + (m.html || "") + "</div>" + c;
    }).join("");
    body.scrollTop = body.scrollHeight;
  }

  function run(chip) {
    if (!chip) return;
    if (chip.pick || chip.pickT) {
      var pool = chip.pickT ? (D.ctrends.measures || []) : D.cross.measures;
      var id = chip.pickT || chip.pick;
      var m = pool.filter(function (x) { return x.id === id; })[0];
      var text = chip.text || "";
      if (!m) return;
      var r = chip.pickT ? movedOn(m, matchCounties(text)[0] || null)
                         : decide(m, text, matchCounties(text));
      if (r) push("bot", r);
      return;
    }
    if (chip.q) { send(chip.q); return; }
    var nav = window.KDHS && window.KDHS.nav;
    if (!nav) return;
    if (chip.measure) nav.measure(chip.page, chip.measure);
    else nav.page(chip.page);
    close();
  }

  function send(preset) {
    var input = document.getElementById("kchat-input");
    var text = (preset !== undefined ? preset : (input ? input.value : "")).trim();
    if (!text) return;
    if (input && preset === undefined) input.value = "";
    push("user", { text: text });
    load().then(function () {
      var r = answer(text);
      if (!r) {
        push("bot", { html: "I could not make sense of that one. Try naming a measure, " +
                            "a county, or both.", chips: chips() });
        return;
      }
      push("bot", { html: r.html, chips: r.chips });
      if (r.go) {
        var nav = window.KDHS && window.KDHS.nav;
        if (nav) { nav.page(r.go.page); close(); }
      }
    }).catch(function (e) {
      push("bot", { html: "I could not read the survey files: " + esc(e.message) });
    });
  }

  function open() {
    OPEN = true;
    var p = document.getElementById("kchat-panel");
    var f = document.getElementById("kchat-fab");
    if (p) p.hidden = false;
    if (f) f.classList.add("is-open");
    if (!MSGS.length) {
      push("bot", { html: "I am the survey's own assistant. I answer only from the published " +
                          "tables on this site, so I will never make a figure up, and I will " +
                          "say so when I cannot find one. For example:", chips: chips() });
    }
    var i = document.getElementById("kchat-input");
    if (i) setTimeout(function () { i.focus(); }, 60);
    load();
  }

  function close() {
    OPEN = false;
    var p = document.getElementById("kchat-panel");
    var f = document.getElementById("kchat-fab");
    if (p) p.hidden = true;
    if (f) f.classList.remove("is-open");
  }

  function build() {
    if (document.getElementById("kchat-fab")) return;
    var fab = document.createElement("button");
    fab.type = "button"; fab.id = "kchat-fab"; fab.className = "chat-fab";
    fab.setAttribute("aria-label", "Ask about the survey");
    fab.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3a8.4 ' +
      '8.4 0 0 1 9 8.5z"/></svg><span class="chat-fab-dot"></span>';

    var panel = document.createElement("div");
    panel.id = "kchat-panel"; panel.className = "chat-panel"; panel.hidden = true;
    panel.innerHTML =
      '<div class="chat-head"><div class="chat-head-title">' +
      '<span class="chat-head-dot"></span>Ask the survey</div>' +
      '<button type="button" class="chat-close" id="kchat-close" aria-label="Close">&times;</button></div>' +
      '<div class="chat-body" id="kchat-body"></div>' +
      '<form class="chat-input-row" id="kchat-form">' +
      '<input id="kchat-input" class="chat-input" type="text" autocomplete="off" ' +
      'placeholder="A measure, a county, or both">' +
      '<button type="submit" class="chat-send" aria-label="Ask">' +
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 12h15"/><path d="M13 6l6 6-6 6"/></svg></button></form>' +
      '<p class="chat-foot">Answers come from this site’s own published tables. ' +
      'Nothing is sent anywhere.</p>';

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    fab.addEventListener("click", function () { if (OPEN) close(); else open(); });
    document.getElementById("kchat-close").addEventListener("click", close);
    document.getElementById("kchat-form").addEventListener("submit", function (e) {
      e.preventDefault(); send();
    });
    document.getElementById("kchat-body").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-chip]") : null;
      if (!b) return;
      var at = b.getAttribute("data-chip").split(":");
      var msg = MSGS[+at[0]];
      if (msg && msg.chips) run(msg.chips[+at[1]]);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && OPEN) close();
    });
  }

  // The assistant only appears where it can actually answer: it reads the
  // site's data files, so on a page that does not serve them there is no
  // button rather than a button that apologises.
  function start() {
    get("data/cross.json").then(function () { build(); }).catch(function () {});
  }

  // The reading of a question is the part most worth being able to check from
  // outside, so the matching is put where a test can call it.
  window.KCHAT = { answer: answer, prep: prep, rank: rank, load: load, data: D };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
