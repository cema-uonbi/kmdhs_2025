// ==================================================================================
// Get past data — The DHS Program's own service, queried live
// ==================================================================================
//
// Every other page on this site is the published Mini DHS 2025/26 report, built
// once and served as files. This one asks api.dhsprogram.com for Kenya as the
// reader watches, and gets back every survey round DHS holds for whichever
// indicator is picked, nationally or across the 47 counties.
//
// It is written in plain browser JavaScript rather than in R so that the Shiny
// app and the static build behave identically: both load this file, both draw
// the same chart, and neither needs a server of its own to do it.
//
// A note on the name. DHS's Model Context Protocol connector, the one an AI
// assistant would speak to, sits on top of this same REST service. This page
// talks to the service directly, which is the part a browser can do.

(function () {
  var API = "https://api.dhsprogram.com/rest/dhs";
  var COUNTRY = "KE";

  var STATE = { rows: [], label: "", level: "national", open: false };
  var CHART = null;

  function el(id) { return document.getElementById(id); }
  function has() { return !!el("past-indicator"); }

  function say(msg, kind) {
    var s = el("past-status");
    if (!s) return;
    s.className = "past-status" + (kind ? " past-status--" + kind : "");
    s.textContent = msg || "";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // DHS pages its answers. Asking for one big page is one round trip rather
  // than eight, and the service caps it, so the cap is what gets asked for.
  function get(path, params) {
    var q = Object.keys(params || {}).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return fetch(API + path + (q ? "?" + q : ""), { mode: "cors" })
      .then(function (r) {
        if (!r.ok) throw new Error("The DHS service answered " + r.status);
        return r.json();
      });
  }

  // ---- the two pickers ----------------------------------------------------------

  var INDICATORS = null;

  function loadIndicators() {
    if (INDICATORS) return Promise.resolve(INDICATORS);
    say("Asking The DHS Program which indicators it holds for Kenya…");
    return get("/indicators", { countryIds: COUNTRY, returnFields: "IndicatorId,Label,TagIds,Definition", perpage: "2000" })
      .then(function (d) {
        INDICATORS = (d.Data || []).filter(function (r) { return r.IndicatorId && r.Label; });
        // Sorted by what they are about, then by name, so a picker of two
        // thousand entries can be scrolled as well as searched.
        INDICATORS.sort(function (a, b) { return a.Label.localeCompare(b.Label); });
        say("");
        return INDICATORS;
      });
  }

  function fillTopics() {
    var sel = el("past-topic");
    if (!sel) return;
    // The DHS tag list is long and uneven; the ones below are the chapters of
    // this survey, which is what a reader of this dashboard is holding in mind.
    var TOPICS = [
      ["", "Every indicator"],
      ["mortality", "Mortality"],
      ["fertility", "Fertility"],
      ["family planning", "Family planning"],
      ["antenatal|delivery|postnatal|maternal", "Maternal health"],
      ["vaccination|immuniz|child health|diarrh|fever", "Child health"],
      ["nutrition|breastfeed|anaemia|anemia|stunt", "Nutrition"],
      ["malaria|net", "Malaria"],
      ["water|sanitation|toilet", "Water and sanitation"],
      ["education|literacy|media", "Schooling and media"]
    ];
    sel.innerHTML = TOPICS.map(function (t) {
      return '<option value="' + esc(t[0]) + '">' + esc(t[1]) + "</option>";
    }).join("");
  }

  function fillIndicators() {
    var sel = el("past-indicator");
    if (!sel || !INDICATORS) return;
    var rx = el("past-topic") && el("past-topic").value;
    var pool = INDICATORS;
    if (rx) {
      var re = new RegExp(rx, "i");
      pool = INDICATORS.filter(function (r) {
        return re.test(r.Label) || re.test(r.Definition || "");
      });
    }
    pool = pool.slice(0, 900);
    sel.innerHTML = pool.map(function (r) {
      return '<option value="' + esc(r.IndicatorId) + '">' + esc(r.Label) + "</option>";
    }).join("");
    // The searchable-picker component rebuilds itself from the select, so it
    // only has to be told the options changed.
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ---- the data -----------------------------------------------------------------

  function fetchSeries() {
    var ind = el("past-indicator"), lvl = el("past-level");
    if (!ind || !ind.value) return;
    var id = ind.value;
    var level = (lvl && lvl.value) || "national";
    STATE.label = ind.selectedOptions[0] ? ind.selectedOptions[0].text : id;
    STATE.level = level;
    say("Fetching every Kenya round for this indicator…");

    var params = { countryIds: COUNTRY, indicatorIds: id, perpage: "2000",
                   returnFields: "Value,SurveyYear,SurveyId,CharacteristicLabel,ByVariableLabel,Indicator" };
    if (level === "subnational") params.breakdown = "subnational";

    get("/data", params).then(function (d) {
      var rows = (d.Data || []).filter(function (r) { return r.Value !== null && r.Value !== ""; });
      if (level === "subnational") {
        // DHS returns regions at whatever level each survey published. Only the
        // ones whose name matches a county of this survey are kept, so the page
        // never mixes the eight old provinces in among the 47 counties.
        var keep = {};
        (window.KDHS && window.KDHS.index && window.KDHS.index.counties || []).forEach(
          function (c) { keep[c.toLowerCase()] = c; });
        rows = rows.map(function (r) {
          var hit = keep[String(r.CharacteristicLabel || "").toLowerCase().replace(/^\.\s*/, "")];
          return hit ? Object.assign({}, r, { CharacteristicLabel: hit }) : null;
        }).filter(Boolean);
      }
      STATE.rows = rows;
      if (!rows.length) {
        say(level === "subnational"
          ? "The DHS service holds no county figures for this indicator."
          : "The DHS service holds no Kenya figures for this indicator.", "warn");
        draw(); return;
      }
      say("");
      draw();
    }).catch(function (e) {
      say("Could not reach The DHS Program: " + e.message +
          ". Everything else on this site works without a connection.", "warn");
    });
  }

  // ---- drawing ------------------------------------------------------------------

  function palette() {
    var p = (window.KDHS && window.KDHS.index && window.KDHS.index.palette) || {};
    return { ink: p.ink || "#221C13", accent: p.blue || "#AA6340",
             warm: p.orange || "#E7A83E", soft: p.inkSoft || "#635A46",
             grid: p.grid || "#E1D8BD", gridSoft: p.gridSoft || "#EAE3CE" };
  }

  function draw() {
    var host = el("past-chart");
    if (!host) return;
    if (CHART) { CHART.destroy(); CHART = null; }
    host.innerHTML = "";
    if (!STATE.rows.length) { el("past-read").innerHTML = ""; return; }
    var p = palette();

    if (STATE.level === "national") {
      var by = {};
      STATE.rows.forEach(function (r) { by[r.SurveyYear] = r.Value; });
      var years = Object.keys(by).sort(function (a, b) { return a - b; });
      CHART = Highcharts.chart(host, {
        chart: { type: "line", backgroundColor: "transparent" },
        title: { text: STATE.label, align: "center",
                 style: { fontWeight: "bold", color: p.ink } },
        credits: { enabled: false }, legend: { enabled: false },
        xAxis: { categories: years, lineColor: p.grid, tickLength: 0 },
        yAxis: { title: { text: "" }, gridLineColor: p.grid },
        tooltip: { pointFormat: "<b>{point.y}</b>" },
        series: [{ name: "Kenya", color: p.ink, lineWidth: 3,
                   marker: { enabled: true, radius: 6 },
                   dataLabels: { enabled: true, style: { textOutline: "3px #FFFFFF" } },
                   data: years.map(function (y) { return Math.round(by[y] * 10) / 10; }) }]
      });
      readNational(years, by);
    } else {
      var latest = String(Math.max.apply(null, STATE.rows.map(function (r) {
        return +r.SurveyYear; })));
      var rows = STATE.rows.filter(function (r) { return String(r.SurveyYear) === latest; })
        .sort(function (a, b) { return b.Value - a.Value; });
      CHART = Highcharts.chart(host, {
        chart: { type: "bar", height: Math.max(520, rows.length * 24 + 140),
                 backgroundColor: "transparent" },
        title: { text: STATE.label + ", " + latest, align: "center",
                 style: { fontWeight: "bold", color: p.ink } },
        credits: { enabled: false }, legend: { enabled: false },
        xAxis: { categories: rows.map(function (r) { return r.CharacteristicLabel; }),
                 lineColor: p.grid, tickLength: 0 },
        yAxis: { title: { text: "" }, gridLineColor: p.grid },
        tooltip: { pointFormat: "<b>{point.y}</b>" },
        series: [{ color: p.accent, borderWidth: 0, maxPointWidth: 18,
                   data: rows.map(function (r) { return Math.round(r.Value * 10) / 10; }) }]
      });
      readSub(latest, rows);
    }
    if (STATE.open) drawTable();
  }

  function readNational(years, by) {
    var r = el("past-read");
    if (!r || years.length < 2) { if (r) r.innerHTML = ""; return; }
    var a = by[years[0]], b = by[years[years.length - 1]], d = b - a;
    var way = d > 0.05 ? "Up" : d < -0.05 ? "Down" : "Barely moved";
    r.innerHTML = '<div class="trend-read trend-read--' +
      (d > 0.05 ? "up" : d < -0.05 ? "down" : "flat") + '">' +
      '<span class="eyebrow">' + esc("Kenya, " + years[0] + " to " + years[years.length - 1]) +
      "</span>" +
      '<p class="trend-read__big">' + esc(way === "Barely moved" ? way :
        way + " " + (Math.round(Math.abs(d) * 10) / 10)) + "</p>" +
      '<p class="cross-read__fine">' + esc("From " + a + " to " + b + " across " +
        years.length + " survey rounds on file at The DHS Program.") + "</p></div>";
  }

  function readSub(latest, rows) {
    var r = el("past-read");
    if (!r || !rows.length) { if (r) r.innerHTML = ""; return; }
    r.innerHTML = '<p class="figure-note">' + esc(
      rows.length + " counties reported this in " + latest + ". Highest: " +
      rows[0].CharacteristicLabel + " at " + rows[0].Value + ". Lowest: " +
      rows[rows.length - 1].CharacteristicLabel + " at " + rows[rows.length - 1].Value +
      ". Earlier rounds are in the table below.") + "</p>";
  }

  // ---- the table and the download -----------------------------------------------

  function tableData() {
    if (STATE.level === "national") {
      return { columns: ["Survey round", "Value", "Survey"],
               rows: STATE.rows.slice().sort(function (a, b) {
                 return a.SurveyYear - b.SurveyYear; }).map(function (r) {
                 return [r.SurveyYear, r.Value, r.SurveyId || ""]; }) };
    }
    var years = [], seen = {};
    STATE.rows.forEach(function (r) {
      if (!seen[r.SurveyYear]) { seen[r.SurveyYear] = 1; years.push(String(r.SurveyYear)); } });
    years.sort();
    var by = {}, order = [];
    STATE.rows.forEach(function (r) {
      var c = r.CharacteristicLabel;
      if (!by[c]) { by[c] = {}; order.push(c); }
      by[c][r.SurveyYear] = r.Value;
    });
    order.sort();
    return { columns: ["County"].concat(years),
             rows: order.map(function (c) {
               return [c].concat(years.map(function (y) {
                 return by[c][y] === undefined ? "" : by[c][y]; })); }) };
  }

  function drawTable() {
    var box = el("past-table_box");
    if (!box) return;
    var t = tableData();
    box.innerHTML = "";
    if (!t.rows.length) return;
    var tbl = document.createElement("table");
    tbl.className = "display";
    box.appendChild(tbl);
    new DataTable(tbl, {
      data: t.rows, columns: t.columns.map(function (c) { return { title: c }; }),
      pageLength: 15, lengthMenu: [10, 15, 25, 50], autoWidth: false, order: [],
      language: { search: "Search this table", lengthMenu: "Show _MENU_ rows" }
    });
  }

  function toCSV(cols, rows) {
    var q = function (v) {
      v = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return [cols.map(q).join(",")].concat(rows.map(function (r) {
      return r.map(q).join(","); })).join("\n");
  }

  // ---- wiring -------------------------------------------------------------------

  function start() {
    if (!has()) return;
    fillTopics();
    loadIndicators().then(function () {
      fillIndicators();
      var pref = INDICATORS.find(function (r) { return /under-five mortality rate/i.test(r.Label); });
      if (pref) { el("past-indicator").value = pref.IndicatorId; }
      fetchSeries();
    }).catch(function (e) {
      say("Could not reach The DHS Program: " + e.message +
          ". Everything else on this site works without a connection.", "warn");
    });

    document.addEventListener("change", function (e) {
      if (e.target.id === "past-topic") { fillIndicators(); fetchSeries(); }
      else if (e.target.id === "past-indicator" || e.target.id === "past-level") fetchSeries();
    });

    document.addEventListener("click", function (e) {
      if (e.target.id === "past-show_table") {
        STATE.open = !STATE.open;
        e.target.textContent = STATE.open ? "Hide the table" : "Show the table";
        if (STATE.open) drawTable(); else el("past-table_box").innerHTML = "";
      } else if (e.target.id === "past-dl") {
        var t = tableData();
        if (!t.rows.length) return;
        var blob = new Blob([String.fromCharCode(0xFEFF) + toCSV(t.columns, t.rows)],
                            { type: "text/csv;charset=utf-8" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "DHS Program - Kenya - " +
          STATE.label.replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() + ".csv";
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      }
    });
  }

  // The page may not be in the document when this file loads: Shiny builds its
  // panels on demand. So the first sight of it is what starts the fetching.
  function watch() {
    if (has()) { start(); return; }
    var mo = new MutationObserver(function () {
      if (has()) { mo.disconnect(); start(); }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch);
  } else {
    watch();
  }
})();
