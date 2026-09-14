// =================================================================================================
// Kenya Mini DHS 2025/26 - the static build
// =================================================================================================
//
// What this file is for, and what it deliberately is not for.
//
// Every judgement about the survey was made in R, by 01_build_site.R, and
// written into the JSON beside this file already decided: which figures earn a
// card, how a caption is read off a stacked header, what counts as a
// denominator, how a figure is printed with its brackets and asterisks. None of
// that is repeated here, because a rule written twice is a rule that will one
// day disagree with itself.
//
// This file arranges and draws. It pivots rows into series, hands them to
// Highcharts, builds the tables, and wires the pickers. If you find yourself
// about to decide something here, it belongs in R.
//
// The markup it works against is the Shiny app's own, rendered to HTML at build
// time, so the ids are Shiny's module namespaces: "ch2-a2_1-indicator" is the
// indicator picker of area a2_1 in chapter 2.
// =================================================================================================

(function () {
  "use strict";

  var INDEX = null;
  var GEO = null;
  var AREA = {};        // aid -> payload, once fetched
  var CHARTS = {};      // element id -> Highcharts instance
  var TABLES = {};      // element id -> DataTable
  var LOADING = {};     // aid -> promise, so a topic is never fetched twice

  var BOM = String.fromCharCode(0xFEFF);
  var DOT = " · ";

  // Fetching -------------------------------------------------------------------------------------

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + " -> " + r.status);
      return r.json();
    });
  }

  function area(aid) {
    if (AREA[aid]) return Promise.resolve(AREA[aid]);
    if (!LOADING[aid]) {
      LOADING[aid] = getJSON("data/area/" + aid + ".json").then(function (p) {
        AREA[aid] = unpack(p);
        return AREA[aid];
      });
    }
    return LOADING[aid];
  }

  // Unpacking ------------------------------------------------------------------------------------

  // The figures travel as a dictionary and a column of small integers per
  // field, which is a quarter of the size of the same rows written out with
  // their field names repeated. One pass turns them back into rows.
  function unpack(p) {
    p.natRows = rows(p.nat, ["g", "c", "y", "f"], ["ii", "v", "rs", "cs"]);
    p.ctyRows = rows(p.cty, ["c", "y", "f"], ["ii", "v", "rs", "cs"]);
    p.countSet = new Set(p.isCount || []);
    p.junkSet = new Set(p.junk || []);
    return p;
  }

  function rows(block, dicts, plain) {
    if (!block || !block.v) return [];
    var n = block.v.length, out = new Array(n);
    for (var i = 0; i < n; i++) {
      var r = {};
      dicts.forEach(function (d) {
        var idx = block[d + "i"];
        r[d] = idx ? block[d][idx[i]] : "";
      });
      plain.forEach(function (k) { r[k] = block[k] ? block[k][i] : null; });
      out[i] = r;
    }
    return out;
  }

  // Printing a figure ----------------------------------------------------------------------------

  // The one piece of formatting that lives here rather than in R, because it is
  // applied to a table that is filtered in the browser. It follows fmt_cell in
  // global.R exactly: a mark where there is no figure, brackets kept where the
  // report printed them, thousands separated, one decimal otherwise.
  function fmtCell(value, flag, isCount) {
    if (value === null || value === undefined || isNaN(value)) return flag || "";
    var num = (isCount || Math.abs(value) >= 1000)
      ? Math.round(value).toLocaleString("en-US")
      : value.toFixed(1);
    return flag === "()" ? "(" + num + ")" : num;
  }

  // Chart sizes ----------------------------------------------------------------------------------

  // The two formulas from fct_charts.R. Kept in step by hand, which is worth a
  // note: they are the only numbers in this file that also exist in R.
  function barHeight(n) { return Math.min(1200, Math.max(700, Math.round(n * 58 + 420))); }
  function barWidth(n) { return Math.min(1500, Math.max(1020, Math.round(n * 66 + 780))); }

  function pctCeiling(unit, values) {
    if (unit !== "%") return null;
    var top = -Infinity;
    values.forEach(function (v) { if (v !== null && v > top) top = v; });
    return (!isFinite(top) || top > 100) ? null : 100;
  }

  // The chart theme ------------------------------------------------------------------------------

  function theme() {
    var p = INDEX.palette;
    return {
      chart: { backgroundColor: "transparent", spacingTop: 14,
               style: { fontFamily: INDEX.fonts.body, fontSize: "16px" } },
      credits: { enabled: false },
      accessibility: { enabled: false },
      title: { align: "center", margin: 30, useHTML: true,
               style: { fontFamily: INDEX.fonts.display, fontSize: "24px",
                        fontWeight: "bold", color: p.ink } },
      subtitle: { text: null },
      legend: { align: "center", verticalAlign: "top", margin: 26, padding: 10,
                itemDistance: 26, symbolRadius: 6, symbolHeight: 12,
                itemStyle: { fontSize: "16px", fontWeight: "normal", color: p.inkSoft } },
      tooltip: { backgroundColor: "rgba(12, 17, 22, 0.95)", borderWidth: 0, borderRadius: 12,
                 shadow: false, useHTML: true,
                 style: { color: "#FFFFFF", fontSize: "17px" } }
    };
  }

  function valueAxis(unit, values) {
    var p = INDEX.palette;
    return {
      title: { text: unit, style: { fontSize: "17px", color: p.inkSoft } },
      gridLineColor: p.grid, gridLineWidth: 1, gridLineDashStyle: "Solid",
      minorGridLineColor: p.gridSoft, minorGridLineWidth: 1,
      minorGridLineDashStyle: "Dot", minorTickInterval: "auto",
      tickPixelInterval: 110, lineWidth: 0, tickLength: 0,
      startOnTick: true, endOnTick: true,
      min: unit === "%" ? 0 : null,
      max: pctCeiling(unit, values),
      labels: { style: { fontSize: "16px", color: p.inkSoft } }
    };
  }

  function categoryAxis(cats, size) {
    var p = INDEX.palette;
    return {
      categories: cats, title: { text: "" },
      lineColor: p.ruleStrong, lineWidth: 1, tickColor: p.ruleStrong,
      tickLength: 0, gridLineWidth: 0,
      labels: { style: { fontSize: size || "15px", color: p.inkSoft } }
    };
  }

  function wrapTitle(text, at) {
    var words = String(text).split(" "), line = "", out = [];
    words.forEach(function (w) {
      if ((line + " " + w).trim().length > at) { out.push(line.trim()); line = w; }
      else line += " " + w;
    });
    if (line.trim()) out.push(line.trim());
    return out.join("<br>");
  }

  // A map is not a chart with a map in it. Highcharts has a separate constructor
  // for it, and passing map options to the ordinary one draws an empty pair of
  // axes with a colour legend above them and no country at all.
  function draw(elId, options, isMap) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (CHARTS[elId]) { CHARTS[elId].destroy(); delete CHARTS[elId]; }
    var make = isMap ? Highcharts.mapChart : Highcharts.chart;
    CHARTS[elId] = make(el, Highcharts.merge(theme(), options));
  }

  function emptyChart(elId, message) {
    var el = document.getElementById(elId);
    if (!el) return;
    if (CHARTS[elId]) { CHARTS[elId].destroy(); delete CHARTS[elId]; }
    el.innerHTML = '<p class="chart-empty">' + message + "</p>";
  }

  // The grouped bars -----------------------------------------------------------------------------

  function drawBar(p, ns, indIdx, group) {
    var box = document.getElementById(ns + "-bar_box");
    if (!box) return;
    var ind = p.ind[indIdx];
    var unit = p.unitOf[indIdx];

    var keep = p.natRows.filter(function (r) {
      return r.ii === indIdx && r.g === group && r.v !== null &&
             !p.junkSet.has(p.nat.c.indexOf(r.c));
    });
    if (!keep.length) {
      box.innerHTML = '<div class="plot" id="' + ns + '-bar"></div>';
      emptyChart(ns + "-bar", "Nothing reported for this breakdown");
      return;
    }

    // Published order, not alphabetical: wealth quintiles run lowest to highest
    // on the page and mean nothing once sorted.
    var seen = {}, cats = [];
    keep.slice().sort(function (a, b) { return a.rs - b.rs || a.cs - b.cs; })
      .forEach(function (r) { if (!seen[r.c]) { seen[r.c] = 1; cats.push(r.c); } });

    var years = ["2014", "2022", INDEX.surveyYear].filter(function (y) {
      return keep.some(function (r) { return r.y === y; });
    });

    var series = years.map(function (y) {
      return {
        name: y,
        color: INDEX.palette.years[y] || INDEX.palette.blue,
        data: cats.map(function (c) {
          var hit = keep.find(function (r) { return r.y === y && r.c === c; });
          return hit ? Math.round(hit.v * 10) / 10 : null;
        })
      };
    });

    var h = barHeight(cats.length), w = barWidth(cats.length);
    box.innerHTML = '<div class="plot" style="max-width:' + w + 'px">' +
                    '<div id="' + ns + '-bar" style="height:' + h + 'px"></div></div>';

    var all = [];
    series.forEach(function (s) { s.data.forEach(function (v) { all.push(v); }); });

    draw(ns + "-bar", {
      chart: { type: "bar", spacingTop: 14 },
      // "by residence" where there is a breakdown, and nothing where there is
      // not: a title reading "Forms of controlling behaviours by " is worse
      // than no qualifier at all.
      title: { text: wrapTitle(shortTitle(ind, 70) +
                               (group ? " by " + group.toLowerCase() : ""), 64) },
      xAxis: categoryAxis(cats.map(function (c) { return wrapLabel(c, 26); })),
      yAxis: valueAxis(unit, all),
      plotOptions: { bar: { groupPadding: 0.14, pointPadding: 0.03, borderWidth: 0,
                            borderRadius: 3, maxPointWidth: 42 } },
      tooltip: { shared: true,
                 pointFormat: '<span style="color:{series.color}">●</span> ' +
                              "{series.name}: <b>{point.y}</b> " + unit + "<br>" },
      series: series
    });
  }

  // The map --------------------------------------------------------------------------------------

  function drawMap(p, ns, indIdx, year) {
    var elId = ns + "-map";
    if (!document.getElementById(elId) || !GEO) return;
    var unit = p.unitOf[indIdx];
    var keep = p.ctyRows.filter(function (r) {
      return r.ii === indIdx && r.y === year && r.v !== null;
    });
    if (!keep.length) { emptyChart(elId, "No county figures for " + year); return; }

    var warm = /malaria|anaemia|stunt|wast|mortality|poverty|unmet|violence/i.test(p.ind[indIdx]);
    // Joined on the county name exactly as the cleaning script wrote it. It
    // already normalises the six counties the workbooks spell more than one way
    // to the spelling in the map file, so nothing is folded or trimmed here;
    // lowercasing them was enough to make every county fall through to
    // nullColor and draw an empty outline of Kenya.
    var data = keep.map(function (r) {
      return { county: r.c, value: Math.round(r.v * 10) / 10 };
    });

    draw(elId, {
      chart: { map: GEO, spacingTop: 14, height: 680 },
      title: { text: wrapTitle(shortTitle(p.ind[indIdx], 70) + ", by county, " + year, 64) },
      mapNavigation: { enabled: false },
      colorAxis: {
        min: 0,
        stops: warm
          ? [[0, "#FFF6EE"], [0.5, "#FEAD67"], [1, "#CB5F01"]]
          : [[0, "#F2FAFE"], [0.5, "#7DCBED"], [1, "#0D465E"]],
        labels: { style: { fontSize: "15px", color: INDEX.palette.inkSoft } }
      },
      legend: { enabled: true, align: "center", verticalAlign: "top", layout: "horizontal" },
      tooltip: { pointFormat: "<b>{point.properties.county}</b><br>{point.value} " + unit },
      series: [{
        data: data, joinBy: ["county", "county"], mapData: GEO,
        // White where a county did not report, with a black outline, so the
        // shape is still read as part of the country.
        nullColor: "#FFFFFF", borderColor: "#0C1116", borderWidth: 0.6,
        states: { hover: { borderWidth: 1.4 } },
        dataLabels: {
          enabled: true, format: "{point.properties.county}",
          style: { fontSize: "11.5px", fontWeight: "600", color: "#0C1116",
                   textOutline: "2.5px rgba(255,255,255,0.92)" }
        }
      }]
    }, true);
  }

  // The county ranking ---------------------------------------------------------------------------

  function drawRank(p, ns, indIdx, year) {
    var elId = ns + "-rank";
    if (!document.getElementById(elId)) return;
    var unit = p.unitOf[indIdx];
    var keep = p.ctyRows.filter(function (r) {
      return r.ii === indIdx && r.y === year && r.v !== null;
    });
    if (!keep.length) { emptyChart(elId, "No county figures for " + year); return; }
    keep = keep.slice().sort(function (a, b) { return b.v - a.v; });

    var warm = /malaria|anaemia|stunt|wast|mortality|poverty|unmet|violence/i.test(p.ind[indIdx]);
    var nat = nationalFor(p, indIdx, year);
    var values = keep.map(function (r) { return Math.round(r.v * 10) / 10; });

    var axis = valueAxis(unit, values);
    if (nat !== null) {
      axis.plotLines = [{
        value: nat, color: INDEX.palette.ink, width: 1.5, dashStyle: "Dash", zIndex: 4,
        label: { text: "Kenya " + nat.toFixed(1) + unit, align: "right", y: -6,
                 style: { color: INDEX.palette.ink, fontSize: "14px" } }
      }];
    }

    draw(elId, {
      chart: { type: "bar", spacingTop: 14, height: 1280 },
      title: { text: wrapTitle(shortTitle(p.ind[indIdx], 70) + ", counties ranked, " + year, 64) },
      xAxis: categoryAxis(keep.map(function (r) { return r.c; }), "14px"),
      yAxis: axis,
      legend: { enabled: false },
      plotOptions: { bar: { maxPointWidth: 18, borderRadius: 2, borderWidth: 0 } },
      tooltip: { pointFormat: "<b>{point.y}</b> " + unit },
      series: [{ name: shortTitle(p.ind[indIdx], 44),
                 color: warm ? INDEX.palette.orange : INDEX.palette.blue,
                 data: values }]
    });
  }

  function nationalFor(p, indIdx, year) {
    var hit = p.natRows.find(function (r) {
      return r.ii === indIdx && r.y === year && /^total/i.test(r.c) && r.v !== null;
    });
    return hit ? hit.v : null;
  }

  // The cards ------------------------------------------------------------------------------------

  var ICONS = {
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20V8"/>',
    people: '<circle cx="9" cy="8" r="3.4"/><path d="M2.6 20c0-3.6 2.9-6 6.4-6s6.4 2.4 6.4 6"/>' +
            '<path d="M16.4 5.2a3.2 3.2 0 0 1 0 6"/><path d="M17.6 14.4c2.4.6 3.8 2.7 3.8 5.6"/>',
    pin: '<path d="M12 21.4c4-4.3 6.2-7.6 6.2-10.6a6.2 6.2 0 1 0-12.4 0c0 3 2.2 6.3 6.2 10.6z"/>' +
         '<circle cx="12" cy="10.6" r="2.4"/>',
    calendar: '<rect x="3.6" y="5.4" width="16.8" height="15" rx="2"/>' +
              '<path d="M3.6 10.2h16.8"/><path d="M8.4 3.4v4M15.6 3.4v4"/>'
  };
  var ARROW = { up: "↑", down: "↓", flat: "→", none: "" };

  function svgIcon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" ' +
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
           (ICONS[name] || ICONS.chart) + "</svg>";
  }

  // Printed exactly as R decided them. Nothing is chosen here.
  function drawCards(p, ns, indIdx) {
    var host = document.getElementById(ns + "-stats");
    if (!host) return;
    var set = p.cards[String(indIdx)];
    if (!set || !set.items || !set.items.length) { host.innerHTML = ""; return; }

    var tiles = set.items.map(function (c) {
      var arrow = ARROW[c.trend] || "";
      return '<div class="stat' + (c.accent ? " stat--accent" : "") + '">' +
             '<div class="stat__icon">' + svgIcon(c.icon) + "</div>" +
             '<div class="stat__body">' +
             '<p class="stat-value">' + esc(c.value) +
             (c.unit ? "<small>" + esc(c.unit) + "</small>" : "") + "</p>" +
             '<span class="stat-label">' + esc(c.label) + "</span>" +
             '<span class="stat-note stat-note--' + c.trend + '">' +
             (arrow ? '<span class="stat-note__arrow">' + arrow + "</span>" : "") +
             '<span class="stat-note__text">' + esc(c.note) + "</span></span>" +
             "</div></div>";
    }).join("");

    host.innerHTML = (set.note ? '<p class="stats-note">' + esc(set.note) + "</p>" : "") +
                     '<div class="area-stats">' + tiles + "</div>";
  }

  // The table ------------------------------------------------------------------------------------

  function tableFor(p, view, year) {
    var src = view === "county" ? p.ctyRows : p.natRows;
    var head = view === "county" ? ["County"] : ["Characteristic"];
    var rowsOut = [], order = [], byKey = {};

    src.forEach(function (r) {
      if (r.y !== year) return;
      var key = view === "county" ? r.c : (r.g ? r.g + DOT + r.c : r.c);
      if (!byKey[key]) { byKey[key] = { key: key, rs: r.rs, cells: {} }; order.push(key); }
      byKey[key].cells[r.ii] = fmtCell(r.v, r.f, p.countSet.has(r.ii));
    });

    var cols = [];
    p.ind.forEach(function (label, i) {
      if (order.some(function (k) { return byKey[k].cells[i] !== undefined; })) {
        cols.push({ i: i, label: label });
      }
    });

    order.sort(function (a, b) { return byKey[a].rs - byKey[b].rs; });
    order.forEach(function (k) {
      var row = [byKey[k].key];
      cols.forEach(function (c) { row.push(byKey[k].cells[c.i] || ""); });
      rowsOut.push(row);
    });

    return {
      columns: head.concat(cols.map(function (c) { return shortTitle(c.label, 60); })),
      rows: rowsOut
    };
  }

  function drawTable(p, ns, view, year) {
    // The table lives in a box that starts empty. It is not hidden with CSS and
    // then revealed: DataTables measures its own columns as it starts, and one
    // started inside a display:none box measures nothing and comes out with
    // every column the same width. So nothing is built until the box is open.
    var box = document.getElementById(ns + "-table_box");
    if (!box || box.dataset.open !== "yes") return;
    var el = box.querySelector(".table-host");
    if (!el) {
      el = document.createElement("div");
      el.className = "table-host";
      box.appendChild(el);
    }
    var t = tableFor(p, view, year);
    if (TABLES[ns]) { TABLES[ns].destroy(); el.innerHTML = ""; }

    var tbl = document.createElement("table");
    tbl.className = "display";
    el.innerHTML = "";
    el.appendChild(tbl);

    TABLES[ns] = new DataTable(tbl, {
      data: t.rows,
      columns: t.columns.map(function (c) { return { title: c }; }),
      pageLength: 25,
      lengthMenu: [10, 25, 50, 100],
      // Only the wide tables get a horizontal scroller. A two column table that
      // scrolls sideways looks broken.
      scrollX: t.columns.length > 8,
      autoWidth: false,
      order: [],
      language: { search: "Search this table", lengthMenu: "Show _MENU_ rows" }
    });
    el.dataset.rows = t.rows.length;
  }

  // Downloads ------------------------------------------------------------------------------------

  function fileStem(title, n) {
    var x = String(title).replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (x.length <= (n || 90)) return x;
    return x.slice(0, n || 90).replace(/\s+\S*$/, "").trim();
  }

  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function toCSV(columns, rows) {
    var q = function (v) {
      v = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return [columns.map(q).join(",")]
      .concat(rows.map(function (r) { return r.map(q).join(","); })).join("\n");
  }

  function downloadCSV(p, meta, view, year) {
    var t = tableFor(p, view, year);
    saveBlob(new Blob(["﻿" + toCSV(t.columns, t.rows)], { type: "text/csv;charset=utf-8" }),
             "KDHS 2025-26 Table " + p.base_id + (view === "county" ? "C" : "") + " - " +
             fileStem(p.title) + " - " + year.replace("/", "-") + ".csv");
  }

  // SheetJS is 860KB and almost nobody clicks the Excel button, so it is
  // fetched the first time somebody does rather than on every page load.
  var xlsxReady = null;
  function withXLSX() {
    if (!xlsxReady) {
      xlsxReady = new Promise(function (done, fail) {
        var s = document.createElement("script");
        s.src = "vendor/xlsx.full.min.js";
        s.onload = done; s.onerror = fail;
        document.head.appendChild(s);
      });
    }
    return xlsxReady;
  }

  function downloadXLSX(p) {
    return withXLSX().then(function () {
      var all = [["Level", "Group", "Characteristic", "Indicator", "Survey", "Value",
                  "As published", "Published table"]];
      p.natRows.forEach(function (r) {
        all.push(["national", r.g, r.c, p.ind[r.ii], r.y, r.v,
                  fmtCell(r.v, r.f, p.countSet.has(r.ii)), p.tableId[0]]);
      });
      p.ctyRows.forEach(function (r) {
        all.push(["county", "County", r.c, p.ind[r.ii], r.y, r.v,
                  fmtCell(r.v, r.f, p.countSet.has(r.ii)), p.tableId[0]]);
      });
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(all), "All figures");
      if (p.footnotes && p.footnotes.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(p.footnotes), "Footnotes");
      }
      XLSX.writeFile(wb, "KDHS 2025-26 Table " + p.base_id + " - " +
                         fileStem(p.title) + " - all figures.xlsx");
    });
  }

  // Small helpers ---------------------------------------------------------------------------------

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function shortTitle(x, n) {
    x = String(x).replace(/\s+/g, " ").trim();
    if (x.length <= n) return x;
    return x.slice(0, n).replace(/\s+\S*$/, "").trim() + "...";
  }

  function wrapLabel(x, at) {
    return wrapTitle(x, at);
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value : null;
  }

  // Waking one topic up ----------------------------------------------------------------------------

  // A topic draws itself the first time it comes into view and then only when
  // one of its own pickers moves. Drawing all 167 at once is what made the
  // Shiny version slow to start, and it would do the same here.
  function render(ns, aid, what) {
    return area(aid).then(function (p) {
      var indSel = val(ns + "-indicator");
      var indIdx = indSel === null ? (p.chartable[0] || 0) : p.ind.indexOf(indSel);
      if (indIdx < 0) indIdx = p.chartable[0] || 0;
      // A table with no heading over its rows has one unnamed block, and "" is
      // what that block is called in the data, so it selects perfectly well.
      var group = val(ns + "-group") || p.groups[0] || "";
      var year = val(ns + "-year") || p.years[0];

      if (!what || what === "all" || what === "indicator") drawCards(p, ns, indIdx);
      if (!what || what === "all" || what === "indicator" || what === "group") {
        if (p.groups.length || p.plain) drawBar(p, ns, indIdx, group);
      }
      if (!what || what === "all" || what === "indicator" || what === "year") {
        if (p.ctyRows.length) { drawMap(p, ns, indIdx, year); drawRank(p, ns, indIdx, year); }
      }
      if (!what || what === "all" || what === "indicator" || what === "year" ||
          what === "tview" || what === "show_table") {
        var view = (document.querySelector('input[name="' + ns + '-tview"]:checked') || {}).value;
        drawTable(p, ns, view === "county" && p.ctyRows.length ? "county" : "national", year);
      }
      var head = document.getElementById(ns + "-table_title");
      if (head) head.textContent = "Table " + p.base_id + ", as published";
      return p;
    });
  }

  // Only what the reader can actually see is drawn, and only once.
  var SEEN = {};
  var IO = null;

  function sweep() {
    if (!IO) {
      IO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var el = e.target;
          if (SEEN[el.id]) return;
          SEEN[el.id] = 1;
          render(nsOf(el), el.id, "all");
        });
      }, { rootMargin: "600px 0px" });
    }
    document.querySelectorAll(".pane.is-on .tab-pane.active .area-page.is-on section.area, " +
                              ".pane.is-on .tab-pane.active section.area, " +
                              ".pane.is-on section.area").forEach(function (el) {
      if (SEEN[el.id]) return;
      if (!el.getClientRects().length) return;   // still behind a closed theme
      IO.observe(el);
    });
  }

  // "ch2-a2_1-stats" is the stats div of area a2_1; the namespace is everything
  // before the last dash.
  function nsOf(sectionEl) {
    var probe = sectionEl.querySelector("[id$='-stats'],[id$='-table_box'],[id$='-table']");
    if (!probe) return sectionEl.id;
    return probe.id.replace(/-(stats|table_box|table)$/, "");
  }

  document.addEventListener("change", function (e) {
    var el = e.target;
    if (!el.id && el.name === undefined) return;
    var section = el.closest ? el.closest("section.area") : null;
    if (!section) return;
    var ns = nsOf(section);
    var kind = el.id ? el.id.replace(ns + "-", "") : String(el.name).replace(ns + "-", "");
    render(ns, section.id, kind);
  });

  // Show the table, hide the table --------------------------------------------------------------

  // Every page that carries a published table carries the same switch. The box
  // remembers whether it is open, the button says which way it will go next,
  // and whatever owns the page is asked to fill the box the first time.
  function toggleTable(btn) {
    var id = btn.id || "";
    var ns = id.replace(/-show_table$/, "");
    var box = document.getElementById(ns + "-table_box");
    if (!box) return null;
    var open = box.dataset.open !== "yes";
    box.dataset.open = open ? "yes" : "no";
    btn.textContent = open ? "Hide the table" : "Show the table";
    if (!open) {
      if (TABLES[ns]) { TABLES[ns].destroy(); delete TABLES[ns]; }
      box.innerHTML = "";
    }
    return { ns: ns, open: open };
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".dl-btn--toggle") : null;
    if (!btn) return;
    e.preventDefault();
    var r = toggleTable(btn);
    if (!r || !r.open) return;
    var section = btn.closest("section.area");
    if (section) { render(r.ns, section.id, "show_table"); return; }
    if (r.ns === "counties") renderCountyTable();
    if (r.ns === "trends") drawTrendTable();
  });

  // The two download links are the app's own, rendered by Shiny's downloadLink
  // with an empty href for the server to fill in. Here the browser makes the
  // file itself, so the click is caught and the empty href never followed.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("a.dl-btn, [data-dl]") : null;
    if (!btn) return;
    var section = btn.closest("section.area");
    if (!section) return;
    e.preventDefault();
    var ns = nsOf(section);
    var wantsExcel = btn.dataset.dl === "xlsx" || /-dl_xlsx$/.test(btn.id || "");
    area(section.id).then(function (p) {
      var view = (document.querySelector('input[name="' + ns + '-tview"]:checked') || {}).value;
      var year = val(ns + "-year") || p.years[0];
      if (wantsExcel) downloadXLSX(p);
      else downloadCSV(p, null, view === "county" && p.ctyRows.length ? "county" : "national", year);
    });
  });

  // The Counties page ------------------------------------------------------------------------------

  // One county read against the country, across every chapter. Its figures are
  // written per county by the generator, already ranked, so this only picks a
  // file and arranges what is in it.
  var CTY = {};

  function countySlug(name) {
    return String(name).toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
  }

  function countyData(name) {
    var slug = countySlug(name);
    if (CTY[slug]) return Promise.resolve(CTY[slug]);
    return getJSON("data/county/" + slug + ".json").then(function (d) {
      CTY[slug] = d;
      return d;
    });
  }

  function countyRows(d) {
    var chapter = val("counties-chapter") || "";
    var theme = val("counties-theme") || "";
    return (d.rows || []).filter(function (r) {
      return (!chapter || r.chapter === chapter) && (!theme || r.section === theme);
    });
  }

  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function renderCounty(what) {
    var name = val("counties-county");
    if (!name) return Promise.resolve();
    return countyData(name).then(function (d) {
      if (what !== "chapter") fillCountyFilters(d, what === "county");
      drawLocator(name);
      drawCountyCards(d, name);
      renderCountyTable();
      return cross().then(function () {
        if (what === "county" || what === undefined || what === "all") fillCountyMeasure(name);
        drawCountyGap(name);
        drawCountyStrip(name);
      });
    });
  }

  // The two filters narrow each other: choosing a chapter leaves only the
  // sections that chapter has.
  function fillCountyFilters(d, reset) {
    var chapSel = document.getElementById("counties-chapter");
    var themeSel = document.getElementById("counties-theme");
    if (!chapSel || !themeSel) return;
    var chapters = [], seen = {};
    (d.rows || []).forEach(function (r) { if (!seen[r.chapter]) { seen[r.chapter] = 1; chapters.push(r.chapter); } });
    if (reset || chapSel.options.length <= 1) {
      chapSel.innerHTML = '<option value="">All chapters</option>' +
        chapters.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");
    }
    var chosen = chapSel.value;
    var themes = [], tseen = {};
    (d.rows || []).forEach(function (r) {
      if (chosen && r.chapter !== chosen) return;
      if (!tseen[r.section]) { tseen[r.section] = 1; themes.push(r.section); }
    });
    var keep = themeSel.value;
    themeSel.innerHTML = '<option value="">All sections</option>' +
      themes.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; }).join("");
    if (themes.indexOf(keep) >= 0) themeSel.value = keep;
  }

  // Where the county is, rather than how it scores. One shape picked out of the
  // forty seven, so a reader who does not know the map still knows where they
  // are looking.
  function drawLocator(name) {
    if (!document.getElementById("counties-locator") || !GEO) return;
    draw("counties-locator", {
      chart: { map: GEO, height: 320, spacingTop: 6 },
      title: { text: "" },
      legend: { enabled: false },
      colorAxis: { visible: false },
      mapNavigation: { enabled: false },
      tooltip: { enabled: false },
      series: [{
        data: GEO.features.map(function (f) {
          return { county: f.properties.county, value: f.properties.county === name ? 1 : 0 };
        }),
        joinBy: ["county", "county"], mapData: GEO,
        borderColor: "#0C1116", borderWidth: 0.5,
        colorAxis: false,
        colorKey: "value",
        states: { hover: { enabled: false } },
        dataLabels: { enabled: false }
      }]
    }, true);
    var c = CHARTS["counties-locator"];
    if (c) {
      c.series[0].points.forEach(function (pt) {
        pt.update({ color: pt.value ? INDEX.palette.orange : "#FFFFFF" }, false);
      });
      c.redraw(false);
    }
  }

  function drawCountyCards(d, name) {
    var host = document.getElementById("counties-headline");
    if (!host) return;
    var rows = countyRows(d).filter(function (r) { return r.value !== null; }).slice(0, 4);
    if (!rows.length) { host.innerHTML = ""; return; }
    var tiles = rows.map(function (r, i) {
      var note = r.national === null
        ? ordinal(r.rank) + " of " + r.n + " counties"
        : ordinal(r.rank) + " of " + r.n + ", Kenya " + r.national.toFixed(1) + "%";
      return '<div class="stat' + (i === 0 ? " stat--accent" : "") + '">' +
             '<div class="stat__icon">' + svgIcon(["chart", "people", "pin", "calendar"][i % 4]) + "</div>" +
             '<div class="stat__body">' +
             '<p class="stat-value">' + esc(fmtCell(r.value, r.flag, false)) + "<small>%</small></p>" +
             '<span class="stat-label">' + esc(shortTitle(r.indicator, 56)) + "</span>" +
             '<span class="stat-note stat-note--none"><span class="stat-note__text">' +
             esc(note) + "</span></span></div></div>";
    }).join("");
    host.innerHTML = '<p class="stats-note">' + esc(name) + " against Kenya in " +
                     esc(INDEX.surveyYear) + "</p>" +
                     '<div class="area-stats">' + tiles + "</div>";
  }

  function countyTable(d) {
    return {
      columns: ["Chapter", "Section", "Topic", "Indicator", "County", "Kenya", "Rank"],
      rows: countyRows(d).map(function (r) {
        return [r.chapter, r.section, r.topic, r.indicator,
                fmtCell(r.value, r.flag, false),
                r.national === null ? "" : r.national.toFixed(1),
                r.rank === null ? "" : ordinal(r.rank) + " of " + r.n];
      })
    };
  }

  function renderCountyTable() {
    var name = val("counties-county");
    if (!name) return;
    countyData(name).then(function (d) {
      var box = document.getElementById("counties-table_box");
      var head = document.getElementById("counties-table_heading");
      if (head) head.textContent = "Every figure published for " + name;
      var t = countyTable(d);
      var count = document.getElementById("counties-table_count");
      if (count) count.textContent = t.rows.length.toLocaleString("en-US") + " figures";
      if (!box || box.dataset.open !== "yes") return;
      if (TABLES.counties) { TABLES.counties.destroy(); delete TABLES.counties; }
      box.innerHTML = "";
      var tbl = document.createElement("table");
      tbl.className = "display";
      box.appendChild(tbl);
      TABLES.counties = new DataTable(tbl, {
        data: t.rows,
        columns: t.columns.map(function (c) { return { title: c }; }),
        pageLength: 25, lengthMenu: [10, 25, 50, 100],
        scrollX: true, autoWidth: false, order: [],
        language: { search: "Search this table", lengthMenu: "Show _MENU_ rows" }
      });
    });
  }

  document.addEventListener("change", function (e) {
    var id = e.target.id || "";
    if (/^counties-(county|chapter|theme)$/.test(id)) {
      renderCounty(id.replace("counties-", ""));
      return;
    }
    if (id === "counties-gap_chapter" || id === "counties-gap_side") {
      drawCountyGap(val("counties-county"));
      return;
    }
    if (id === "counties-strip_measure") drawCountyStrip(val("counties-county"));
  });

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("#counties-dl") : null;
    if (!el) return;
    e.preventDefault();
    var name = val("counties-county");
    countyData(name).then(function (d) {
      var t = countyTable(d);
      saveBlob(new Blob(["\ufeff" + toCSV(t.columns, t.rows)], { type: "text/csv;charset=utf-8" }),
               "KDHS 2025-26 - " + name + " county - every figure.csv");
    });
  });

  // What cuts across the chapters ------------------------------------------------------------------

  // One file behind three pages: the Counties gap chart and strip, and the
  // comparison of two indicators. It is fetched the first time one of those
  // pages is opened rather than at startup, because a reader who only wants
  // chapter four should never pay for it.
  var CROSS = null;
  var CROSS_WAIT = null;
  var CROSS_BY_ID = {};

  function cross() {
    if (CROSS) return Promise.resolve(CROSS);
    if (CROSS_WAIT) return CROSS_WAIT;
    CROSS_WAIT = getJSON("data/cross.json").then(function (d) {
      CROSS = d;
      d.measures.forEach(function (m) {
        // Rank and the number reporting follow from the values, so they are
        // worked out here once rather than sent for all 477 measures.
        var seen = [];
        m.v.forEach(function (x, i) { if (x !== null) seen.push({ i: i, x: x }); });
        seen.sort(function (a, b) { return b.x - a.x; });
        m.rank = new Array(m.v.length);
        m.n = seen.length;
        var place = 0, last = null;
        seen.forEach(function (e, k) {
          if (last === null || e.x !== last) { place = k + 1; last = e.x; }
          m.rank[e.i] = place;
        });
        CROSS_BY_ID[m.id] = m;
      });
      return d;
    });
    return CROSS_WAIT;
  }

  function measureOf(id) { return CROSS_BY_ID[id] || null; }
  function countyIndex(name) { return CROSS ? CROSS.counties.indexOf(name) : -1; }

  // An axis cut to the data rather than to the scale, matching snug_axis() in
  // fct_charts.R. A 0 to 100 box is right for a bar, whose length is the
  // quantity; it is wrong for a scatter, where it pushes every county into one
  // corner and the pattern the chart exists to show becomes a smudge.
  // fromZero keeps the baseline at nought and only brings the top down. A line
  // over three rounds is read as a shape, and cutting the bottom off it turns a
  // three point rise into a cliff. What does not have to stay is the empty top
  // half: a measure that never passes 25 does not need an axis running to 100.
  function snugAxis(unit, values, include, fromZero) {
    var p = INDEX.palette;
    var v = values.concat(include === undefined || include === null ? [] : [include])
      .filter(function (x) { return x !== null && isFinite(x); });
    if (!v.length) return valueAxis(unit, values);
    var hi = Math.max.apply(null, v);
    var lo = fromZero ? 0 : Math.min.apply(null, v);
    var pad = Math.max((hi - lo) * 0.1, 0.5);
    return {
      title: { text: unit, style: { fontSize: "17px", color: p.inkSoft } },
      gridLineColor: p.grid, gridLineWidth: 1, gridLineDashStyle: "Solid",
      minorGridLineColor: p.gridSoft, minorGridLineWidth: 1,
      minorGridLineDashStyle: "Dot", minorTickInterval: "auto",
      tickPixelInterval: 110, lineWidth: 0, tickLength: 0,
      startOnTick: false, endOnTick: false,
      min: fromZero ? 0 : (unit === "%" ? Math.max(0, lo - pad) : lo - pad),
      max: unit === "%" ? Math.min(100, hi + pad) : hi + pad,
      labels: { style: { fontSize: "16px", color: p.inkSoft } }
    };
  }

  // Eight, eleven and eighteen open with a vowel sound however they are spelled,
  // so "a 18% rise" reads as a typo to anyone who says it in their head.
  function anFor(x) {
    // Only the whole-number part decides it: 1.8 is "one point eight".
    var whole = String(x).split(".")[0].replace(/[^0-9]/g, "");
    return (/^(8|11|18)$/.test(whole) || /^(8|18)[0-9]*$/.test(whole)) ? "an" : "a";
  }

  function fmtHeadline(x) {
    if (x === null || x === undefined || !isFinite(x)) return "-";
    if (Math.abs(x - Math.round(x)) < 0.05) return Math.round(x).toLocaleString("en-US");
    return x.toFixed(1);
  }

  function fillMeasureSelect(el, items, keep) {
    if (!el) return;
    var byChap = [], seen = {};
    items.forEach(function (m) {
      if (!seen[m.chap]) { seen[m.chap] = []; byChap.push(m.chap); }
      seen[m.chap].push(m);
    });
    el.innerHTML = byChap.map(function (c) {
      return '<optgroup label="' + esc(c) + '">' + seen[c].map(function (m) {
        return '<option value="' + esc(m.id) + '">' + esc(m.label) + "</option>";
      }).join("") + "</optgroup>";
    }).join("");
    if (keep && items.some(function (m) { return m.id === keep; })) el.value = keep;
  }

  // The Counties page, the part that is a picture ---------------------------------------------------

  // Everything this county can be placed on a common scale, with the distance
  // from the national figure already taken. Signed, never judged: whether being
  // above the country is the good news is a property of the indicator and the
  // published tables do not say.
  function countyMeasures(name) {
    var k = countyIndex(name);
    if (k < 0 || !CROSS) return [];
    return CROSS.measures.map(function (m) {
      var v = m.v[k];
      if (v === null || v === undefined || m.nat === null) return null;
      return { id: m.id, label: m.label, unit: m.unit, chap: m.chap,
               value: v, nat: m.nat, gap: v - m.nat, rank: m.rank[k], n: m.n };
    }).filter(Boolean);
  }

  function fillCountyMeasure(name) {
    var all = countyMeasures(name);
    var chapSel = document.getElementById("counties-gap_chapter");
    if (chapSel) {
      var chaps = [], seen = {};
      all.forEach(function (m) { if (!seen[m.chap]) { seen[m.chap] = 1; chaps.push(m.chap); } });
      var keep = chapSel.value;
      chapSel.innerHTML = '<option value="">Every chapter</option>' +
        chaps.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");
      if (chaps.indexOf(keep) >= 0) chapSel.value = keep;
    }
    // The strip picks from the same pool, largest gap first, because the measure
    // a reader wants to look at closely is usually the one the chart above has
    // just made them curious about.
    var pool = all.slice().sort(function (a, b) { return Math.abs(b.gap) - Math.abs(a.gap); });
    var sel = document.getElementById("counties-strip_measure");
    if (sel) {
      var want = sel.value;
      sel.innerHTML = pool.map(function (m) {
        return '<option value="' + esc(m.id) + '">' + esc(shortTitle(m.label, 76)) + "</option>";
      }).join("");
      if (pool.some(function (m) { return m.id === want; })) sel.value = want;
    }
  }

  function drawCountyGap(name) {
    var box = document.getElementById("counties-gap_box");
    if (!box || !CROSS) return;
    var head = document.getElementById("counties-gap_heading");
    if (head) head.textContent = name + " against Kenya";

    var chapter = val("counties-gap_chapter") || "";
    var side = val("counties-gap_side") || "both";
    var d = countyMeasures(name).filter(function (m) {
      if (chapter && m.chap !== chapter) return false;
      if (side === "above") return m.gap > 0;
      if (side === "below") return m.gap < 0;
      return true;
    });
    d.sort(function (a, b) { return Math.abs(b.gap) - Math.abs(a.gap); });
    d = d.slice(0, 20).sort(function (a, b) { return a.gap - b.gap; });

    box.innerHTML = '<div class="plot"><div id="counties-gap"></div></div>';
    if (!d.length) { emptyChart("counties-gap", "Nothing comparable in that chapter"); return; }
    document.getElementById("counties-gap").style.height =
      Math.min(1000, 240 + d.length * 38) + "px";

    var p = INDEX.palette;
    draw("counties-gap", {
      chart: { type: "bar" },
      title: { text: wrapTitle(name + ", percentage points from the national figure", 64) },
      legend: { enabled: false },
      xAxis: categoryAxis(d.map(function (m) { return shortTitle(m.label, 72); }), "14px"),
      yAxis: Highcharts.merge(valueAxis("percentage points from Kenya", []), {
        min: null, max: null, startOnTick: true, endOnTick: true,
        plotLines: [{ value: 0, color: p.ink, width: 2, zIndex: 5 }]
      }),
      tooltip: {
        headerFormat: "",
        pointFormatter: function () {
          return "<b>" + esc(this.full) + "</b><br>" + esc(name) + ": " + this.countyVal +
                 "%<br>Kenya: " + this.kenyaVal + "%<br>" + this.place + " counties";
        }
      },
      series: [{
        type: "bar", borderWidth: 0, pointPadding: 0.08, groupPadding: 0.08,
        data: d.map(function (m) {
          return {
            y: Math.round(m.gap * 10) / 10,
            // Blue is above the country and orange below it. Neither is called
            // good: on solid cooking fuel, above the country is the bad news.
            color: m.gap >= 0 ? p.blue : p.orange,
            full: m.label, countyVal: Math.round(m.value * 10) / 10,
            kenyaVal: Math.round(m.nat * 10) / 10,
            place: ordinal(m.rank) + " of " + m.n
          };
        })
      }]
    });

    // How this county's ranks are spread, which is the one thing a chart of
    // twenty measures cannot say: whether those twenty are typical of it.
    var all = countyMeasures(name);
    var note = document.getElementById("counties-gap_note");
    if (!note) return;
    var top = all.filter(function (m) { return m.rank <= 10; }).length;
    var bot = all.filter(function (m) { return m.rank > m.n - 10; }).length;
    var tile = function (v, label, sub, accent) {
      return '<div class="stat' + (accent ? " stat--accent" : "") + '">' +
             '<div class="stat__icon">' + svgIcon("chart") + "</div>" +
             '<div class="stat__body"><p class="stat-value">' + v + "</p>" +
             '<span class="stat-label">' + esc(label) + "</span>" +
             '<span class="stat-note stat-note--none"><span class="stat-note__text">' +
             esc(sub) + "</span></span></div></div>";
    };
    note.innerHTML = '<div class="area-stats">' +
      tile(all.length.toLocaleString("en-US"),
           "comparable measures published for this county", "Percentage columns only", true) +
      tile(top.toLocaleString("en-US"),
           "of them it ranks in the top ten counties on", "Highest ten of the 47 reporting") +
      tile(bot.toLocaleString("en-US"),
           "of them it ranks in the bottom ten counties on", "Lowest ten of the 47 reporting") +
      "</div>";
  }

  // Forty seven dots on one line, this county filled in. A rank says a county is
  // twelfth; it does not say whether twelfth is a hair behind eleventh or twenty
  // points behind it, and the strip shows the spacing a rank throws away.
  function drawCountyStrip(name) {
    var id = val("counties-strip_measure");
    var m = id && measureOf(id);
    var note = document.getElementById("counties-strip_note");
    if (!m) { emptyChart("counties-strip", "Pick a measure"); if (note) note.innerHTML = ""; return; }
    var p = INDEX.palette;
    var pts = [];
    CROSS.counties.forEach(function (c, i) {
      if (m.v[i] === null || m.v[i] === undefined) return;
      pts.push({ x: Math.round(m.v[i] * 10) / 10, y: 0, name: c,
                 color: c === name ? p.orange : "#7DCBED",
                 marker: { radius: c === name ? 11 : 9 } });
    });
    draw("counties-strip", {
      chart: { type: "scatter", height: 300 },
      title: { text: wrapTitle(shortTitle(m.label, 68), 56) },
      legend: { enabled: false },
      xAxis: Highcharts.merge(snugAxis(m.unit, pts.map(function (q) { return q.x; }), m.nat), {
        plotLines: m.nat === null ? [] : [{
          value: Math.round(m.nat * 10) / 10, color: p.ink, width: 2, dashStyle: "Dash",
          zIndex: 4, label: { text: "Kenya", style: { color: p.ink, fontWeight: "600" } }
        }]
      }),
      yAxis: { visible: false, min: -1, max: 1 },
      tooltip: {
        headerFormat: "",
        pointFormatter: function () {
          return "<b>" + esc(this.name) + "</b><br>" + this.x + m.unit;
        }
      },
      series: [{ type: "scatter", jitter: { y: 0.6 },
                 marker: { symbol: "circle", lineWidth: 1, lineColor: "#FFFFFF" },
                 data: pts }]
    });
    if (!note) return;
    var k = countyIndex(name);
    var here = m.v[k];
    if (here === null || here === undefined) { note.innerHTML = ""; return; }
    var xs = pts.map(function (q) { return q.x; });
    var spread = Math.max.apply(null, xs) - Math.min.apply(null, xs);
    var gap = here - m.nat;
    note.innerHTML = '<p class="figure-note">' + esc(
      name + " is at " + fmtHeadline(here) + m.unit + ", " + fmtHeadline(Math.abs(gap)) +
      " points " + (gap >= 0 ? "above" : "below") + " Kenya's " + fmtHeadline(m.nat) + m.unit +
      ", and " + ordinal(m.rank[k]) + " of " + m.n + " counties. The 47 counties span " +
      fmtHeadline(spread) + " points on this measure, so a place in the order is worth as much " +
      "or as little as that spread makes it.") + "</p>";
  }

  // Comparison of indicators -------------------------------------------------------------------------

  // Every point is a county, placed by two measures at once. What this adds over
  // a plain scatter is the two national figures as crosshairs: they cut the plot
  // into four, and the quadrant a county sits in is the thing a reader actually
  // wants. A correlation coefficient cannot say it.
  function comparePair() {
    var a = measureOf(val("compare-x")), b = measureOf(val("compare-y"));
    if (!a || !b) return null;
    var out = [];
    CROSS.counties.forEach(function (c, i) {
      if (a.v[i] === null || b.v[i] === null) return;
      if (a.v[i] === undefined || b.v[i] === undefined) return;
      out.push({ county: c, x: a.v[i], y: b.v[i] });
    });
    return { a: a, b: b, rows: out };
  }

  function pearson(xs, ys) {
    var n = xs.length;
    if (n < 3) return NaN;
    var mx = xs.reduce(function (s, v) { return s + v; }, 0) / n;
    var my = ys.reduce(function (s, v) { return s + v; }, 0) / n;
    var sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = xs[i] - mx, dy = ys[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    return (sxx && syy) ? sxy / Math.sqrt(sxx * syy) : NaN;
  }

  function correlationInWords(r) {
    if (!isFinite(r)) return "not enough counties reported both to compare them";
    var a = Math.abs(r);
    var how = a >= 0.7 ? "strong" : a >= 0.4 ? "moderate" : a >= 0.2 ? "weak" : "very weak";
    var way = r >= 0 ? "counties high on one tend to be high on the other"
                     : "counties high on one tend to be low on the other";
    return "A " + how + " relationship across the counties, where " + way;
  }

  function renderCompare() {
    return cross().then(function () {
      var xs = document.getElementById("compare-x"), ys = document.getElementById("compare-y");
      if (xs && !xs.dataset.filled) {
        fillMeasureSelect(xs, CROSS.measures, CROSS.measures[0].id); xs.dataset.filled = "1";
      }
      if (ys && !ys.dataset.filled) {
        fillMeasureSelect(ys, CROSS.measures, (CROSS.measures[1] || CROSS.measures[0]).id);
        ys.dataset.filled = "1";
      }
      var d = comparePair();
      if (!d || d.rows.length < 3) {
        emptyChart("compare-scatter", "Fewer than three counties reported both");
        return;
      }
      var p = INDEX.palette;
      var xn = d.a.nat, yn = d.b.nat;
      draw("compare-scatter", {
        chart: { type: "scatter", zoomType: "xy", height: 660 },
        title: { text: wrapTitle(shortTitle(d.b.label, 52) + " against " +
                                 shortTitle(d.a.label, 52), 56) },
        legend: { enabled: false },
        xAxis: Highcharts.merge(
          snugAxis("%", d.rows.map(function (r) { return r.x; }), xn),
          { title: { text: shortTitle(d.a.label, 60) },
            plotLines: xn === null ? [] : [{
              value: xn, color: p.ink, width: 1.5, dashStyle: "Dash", zIndex: 4,
              label: { text: "Kenya " + fmtHeadline(xn) + "%",
                       style: { color: p.ink, fontSize: "13px" } } }] }),
        yAxis: Highcharts.merge(
          snugAxis("%", d.rows.map(function (r) { return r.y; }), yn),
          { title: { text: shortTitle(d.b.label, 60) },
            plotLines: yn === null ? [] : [{
              value: yn, color: p.ink, width: 1.5, dashStyle: "Dash", zIndex: 4,
              label: { text: "Kenya " + fmtHeadline(yn) + "%", align: "right",
                       style: { color: p.ink, fontSize: "13px" } } }] }),
        tooltip: {
          headerFormat: "",
          pointFormatter: function () {
            return "<b>" + esc(this.name) + "</b><br>" +
                   esc(shortTitle(d.a.label, 40)) + ": " + this.x + "%<br>" +
                   esc(shortTitle(d.b.label, 40)) + ": " + this.y + "%";
          }
        },
        series: [{
          type: "scatter", color: p.blue,
          marker: { radius: 6, symbol: "circle", lineWidth: 1, lineColor: "#FFFFFF" },
          dataLabels: { enabled: true, format: "{point.name}", allowOverlap: false,
                        style: { fontSize: "12px", fontWeight: "500", color: p.inkSoft,
                                 textOutline: "2px #FFFFFF" } },
          data: d.rows.map(function (r) {
            return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
                     name: r.county };
          })
        }]
      });

      var r = pearson(d.rows.map(function (q) { return q.x; }),
                      d.rows.map(function (q) { return q.y; }));
      var reading = document.getElementById("compare-reading");
      if (reading) {
        reading.innerHTML =
          '<div class="cross-card"><span class="eyebrow">What the pattern looks like</span>' +
          '<p class="cross-read__line">' + esc(correlationInWords(r)) + "</p>" +
          '<p class="cross-read__fine">' + esc(
            "Pearson's r is " + (isFinite(r) ? r.toFixed(2) : "-") + ", across " + d.rows.length +
            " of the 47 counties. A pattern across counties is not evidence that one causes " +
            "the other.") + "</p></div>";
      }

      var quad = document.getElementById("compare-quadrants");
      if (!quad) return;
      if (xn === null || yn === null) { quad.innerHTML = ""; return; }
      var below = d.rows.filter(function (q) { return q.x < xn && q.y < yn; })
        .map(function (q) { return q.county; }).sort();
      var above = d.rows.filter(function (q) { return q.x >= xn && q.y >= yn; })
        .map(function (q) { return q.county; }).sort();
      var say = function (v) {
        if (!v.length) return "none";
        return v.slice(0, 6).join(", ") + (v.length > 6 ? " and " + (v.length - 6) + " more" : "");
      };
      quad.innerHTML =
        '<div class="cross-card"><span class="eyebrow">Against Kenya on both</span>' +
        '<p class="cross-read__line">Below on both, ' + below.length + " counties</p>" +
        '<p class="cross-read__fine">' + esc(say(below)) + "</p>" +
        '<p class="cross-read__line">Above on both, ' + above.length + " counties</p>" +
        '<p class="cross-read__fine">' + esc(say(above)) + "</p></div>";
    });
  }

  document.addEventListener("change", function (e) {
    if (e.target.id === "compare-x" || e.target.id === "compare-y") renderCompare();
  });

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("#compare-swap") : null;
    if (!el) return;
    e.preventDefault();
    var xs = document.getElementById("compare-x"), ys = document.getElementById("compare-y");
    if (!xs || !ys) return;
    var keep = xs.value; xs.value = ys.value; ys.value = keep;
    renderCompare();
  });

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("#compare-dl") : null;
    if (!el) return;
    e.preventDefault();
    cross().then(function () {
      var d = comparePair();
      if (!d) return;
      var cols = ["County", d.a.label, d.b.label];
      var rows = d.rows.map(function (q) {
        return [q.county, fmtCell(q.x, "", false), fmtCell(q.y, "", false)];
      });
      saveBlob(new Blob([BOM + toCSV(cols, rows)], { type: "text/csv;charset=utf-8" }),
               "KDHS 2025-26 - " + fileStem(d.a.label, 40) + " against " +
               fileStem(d.b.label, 40) + ".csv");
    });
  });

  // What has moved since 2014 -------------------------------------------------------------------------

  var TRENDS = null;
  var TRENDS_WAIT = null;

  function trends() {
    if (TRENDS) return Promise.resolve(TRENDS);
    if (TRENDS_WAIT) return TRENDS_WAIT;
    TRENDS_WAIT = getJSON("data/trends.json").then(function (d) {
      TRENDS = d;
      TRENDS.byId = {};
      d.catalogue.forEach(function (c) { TRENDS.byId[c.id] = c; });
      return d;
    });
    return TRENDS_WAIT;
  }

  function isTotal(x) { return /^total/i.test(String(x)); }

  // One catalogue entry, unpacked into rows and then into the two shapes the
  // page needs: Kenya's own line, and one line per category of one breakdown.
  function trendRows(id) {
    var s = TRENDS.series[id];
    if (!s) return [];
    return s.y.map(function (y, i) {
      return { g: s.g[i], c: s.c[i], y: y, v: s.v[i] };
    });
  }

  function trendGroups(rows) {
    var out = [], seen = {}, tot = {};
    rows.forEach(function (r) { if (isTotal(r.c)) tot[r.g] = 1; });
    rows.forEach(function (r) { if (!seen[r.g]) { seen[r.g] = 1; out.push(r.g); } });
    // The block that carries the overall figure comes first: it is the one a
    // reader wants before any cut of it.
    return out.filter(function (g) { return tot[g]; })
      .concat(out.filter(function (g) { return !tot[g]; }));
  }

  function trendOverall(rows) {
    var tot = rows.filter(function (r) { return isTotal(r.c); });
    if (!tot.length) return [];
    var g = tot[0].g, seen = {}, out = [];
    tot.forEach(function (r) {
      if (r.g !== g || seen[r.y] || r.v === null) return;
      seen[r.y] = 1; out.push({ y: r.y, v: r.v });
    });
    return out;
  }

  // First and last round for every category of the chosen breakdown, and the
  // distance between them. A category printed in one round only is dropped: it
  // has no movement to show, and a dumbbell of zero length reads as a category
  // that did not change.
  function trendMoves(rows, group) {
    var by = {}, order = [];
    rows.forEach(function (r) {
      if (r.g !== group || r.v === null) return;
      if (!by[r.c]) { by[r.c] = []; order.push(r.c); }
      by[r.c].push(r);
    });
    return order.map(function (c) {
      var v = by[c];
      // The Total row is left out: it is the overall figure, drawn on its own
      // beside this, and repeating it here puts the answer among the groups it
      // is meant to be compared against.
      if (isTotal(c)) return null;
      if (v.length < 2 || v[0].y === v[v.length - 1].y) return null;
      var first = v[0], last = v[v.length - 1];
      return { category: c, firstRound: first.y, lastRound: last.y,
               first: first.v, last: last.v, change: last.v - first.v };
    }).filter(Boolean);
  }

  function renderTrends(what) {
    return trends().then(function () {
      var sel = document.getElementById("trends-indicator");
      var id = (sel && sel.value) || (TRENDS.catalogue[0] && TRENDS.catalogue[0].id);
      if (!id) return;
      var meta = TRENDS.byId[id] || { label: id, unit: "%" };
      var rows = trendRows(id);
      var gsel = document.getElementById("trends-group");
      var groups = trendGroups(rows);
      if (gsel && what !== "group") {
        var keep = gsel.value;
        gsel.innerHTML = groups.map(function (g) {
          return '<option value="' + esc(g) + '">' + esc(g || "All respondents") + "</option>";
        }).join("");
        if (groups.indexOf(keep) >= 0) gsel.value = keep;
      }
      var group = (gsel && gsel.value) || groups[0] || "";

      drawTrendOverall(meta, trendOverall(rows));
      drawTrendSlope(meta, trendMoves(rows, group), group);
      drawTrendTable();
    });
  }

  function drawTrendOverall(meta, d) {
    var read = document.getElementById("trends-overall_read");
    if (!d.length) {
      emptyChart("trends-overall",
                 "This table prints no overall figure, only the breakdowns beside it");
      if (read) read.innerHTML = "";
      return;
    }
    var p = INDEX.palette;
    draw("trends-overall", {
      chart: { type: "line", height: 420 },
      title: { text: wrapTitle("Kenya, " + shortTitle(meta.label, 58), 48) },
      legend: { enabled: false },
      xAxis: categoryAxis(d.map(function (r) { return r.y; })),
      yAxis: snugAxis(meta.unit, d.map(function (r) { return r.v; }), null, true),
      tooltip: { pointFormat: "<b>{point.y}</b> " + meta.unit },
      series: [{
        name: "Kenya", color: p.ink, lineWidth: 3,
        marker: { enabled: true, radius: 7, symbol: "circle" },
        dataLabels: { enabled: true, format: "{point.y}",
                      style: { fontSize: "14px", fontWeight: "600",
                               textOutline: "3px #FFFFFF" } },
        data: d.map(function (r) { return Math.round(r.v * 10) / 10; })
      }]
    });
    if (!read) return;
    if (d.length < 2) { read.innerHTML = ""; return; }

    // The one sentence the line chart is worth. The movement is given in points
    // and both ends are given beside it: saying a percentage "rose by 19%" when
    // it went from 15.6 to 18.5 is true of the relative change and is read by
    // most people as 19 points, which is six times the movement.
    var first = d[0].v, last = d[d.length - 1].v, change = last - first;
    var rel = Math.abs(first) > 0.0001 ? (change / first) * 100 : NaN;
    var way = change > 0.05 ? "Up" : change < -0.05 ? "Down" : "flat";
    var cls = change > 0.05 ? "up" : change < -0.05 ? "down" : "flat";
    read.innerHTML =
      '<div class="trend-read trend-read--' + cls + '">' +
      '<span class="eyebrow">' + esc("Kenya, " + d[0].y + " to " + d[d.length - 1].y) + "</span>" +
      '<p class="trend-read__big">' + esc(
        way === "flat" ? "Barely moved"
          : way + " " + fmtHeadline(Math.abs(change)) +
            (meta.unit === "%" ? " percentage points" : "")) + "</p>" +
      '<p class="cross-read__fine">' + esc(
        "From " + fmtCell(first, "", false) + meta.unit + " to " +
        fmtCell(last, "", false) + meta.unit +
        (way === "flat" || !isFinite(rel) ? "" :
          ", " + anFor(fmtHeadline(Math.abs(rel))) + " " + fmtHeadline(Math.abs(rel)) + "% " +
          (change > 0 ? "rise" : "fall") + " on where it started") + ".") + "</p></div>";
  }

  function drawTrendSlope(meta, m, group) {
    var box = document.getElementById("trends-slope_box");
    var sum = document.getElementById("trends-summary");
    if (!box) return;
    box.innerHTML = '<div id="trends-slope"></div>';
    if (!m.length) {
      emptyChart("trends-slope", "Only one round was printed for this breakdown");
      if (sum) sum.innerHTML = "";
      return;
    }
    // Largest movement at the top, always. It is the only order that makes the
    // chart answer its own question, which is why there is no picker for it.
    m = m.slice().sort(function (a, b) { return Math.abs(b.change) - Math.abs(a.change); });
    document.getElementById("trends-slope").style.height =
      Math.min(1400, 260 + m.length * 52) + "px";

    var p = INDEX.palette;
    draw("trends-slope", {
      chart: { type: "dumbbell", inverted: true },
      title: { text: wrapTitle(shortTitle(meta.label, 60) + ", by " +
                               String(group || "group").toLowerCase(), 48) },
      legend: { enabled: false },
      xAxis: categoryAxis(m.map(function (r) { return r.category; }), "14px"),
      // A dumbbell is a distance between two readings, not a length measured
      // from nought, so nothing is exaggerated by leaving the floor out.
      yAxis: snugAxis(meta.unit,
                      m.map(function (r) { return r.first; })
                       .concat(m.map(function (r) { return r.last; }))),
      tooltip: {
        headerFormat: "",
        pointFormatter: function () {
          return "<b>" + esc(this.name) + "</b><br>" +
                 esc(this.startRound) + ": " + this.startVal + meta.unit + "<br>" +
                 esc(this.endRound) + ": " + this.endVal + meta.unit + "<br><b>" +
                 esc(this.move) + "</b>" + meta.unit + " over the period";
        }
      },
      series: [{
        type: "dumbbell", connectorWidth: 4, connectorColor: p.ruleStrong,
        marker: { radius: 7 }, lowColor: p.ruleStrong,
        data: m.map(function (r) {
          return {
            name: r.category,
            low: Math.round(Math.min(r.first, r.last) * 10) / 10,
            high: Math.round(Math.max(r.first, r.last) * 10) / 10,
            color: r.change >= 0 ? p.blue : p.orange,
            startRound: r.firstRound, endRound: r.lastRound,
            startVal: Math.round(r.first * 10) / 10,
            endVal: Math.round(r.last * 10) / 10,
            move: (r.change >= 0 ? "+" : "") + fmtHeadline(r.change)
          };
        })
      }]
    });

    if (!sum) return;
    var pts = meta.unit === "%" ? " percentage points" : "";
    sum.innerHTML =
      '<div class="trend-read"><span class="eyebrow">' +
      esc("Between " + m[0].firstRound + " and " + m[0].lastRound) + "</span>" +
      '<ul class="trend-list">' + m.map(function (r) {
        var cls = r.change > 0.05 ? "up" : r.change < -0.05 ? "down" : "flat";
        var said = Math.abs(r.change) <= 0.05
          ? " barely moved, " + fmtCell(r.last, "", false) + meta.unit
          : " " + (r.change > 0 ? "rose" : "fell") + " by " +
            fmtHeadline(Math.abs(r.change)) + pts + ", from " +
            fmtCell(r.first, "", false) + meta.unit + " to " +
            fmtCell(r.last, "", false) + meta.unit;
        return '<li class="trend-list__item trend-list__item--' + cls + '"><b>' +
               esc(r.category) + "</b>" + esc(said) + "</li>";
      }).join("") + "</ul>" +
      '<p class="cross-read__fine">Two survey rounds are two readings, not a trajectory. ' +
      "A group that moved by less than its own sampling error has not been shown to have " +
      "moved.</p></div>";
  }

  function trendTable(id) {
    var rows = trendRows(id);
    var years = [], yseen = {};
    rows.forEach(function (r) { if (!yseen[r.y]) { yseen[r.y] = 1; years.push(r.y); } });
    var by = {}, order = [];
    rows.forEach(function (r) {
      var k = r.g + " | " + r.c;
      if (!by[k]) { by[k] = { g: r.g, c: r.c, cells: {} }; order.push(k); }
      by[k].cells[r.y] = fmtCell(r.v, "", false);
    });
    return {
      columns: ["Broken down by", "Group"].concat(years),
      rows: order.map(function (k) {
        var e = by[k];
        return [e.g || "All respondents", e.c].concat(years.map(function (y) {
          return e.cells[y] || "";
        }));
      })
    };
  }

  function drawTrendTable() {
    var box = document.getElementById("trends-table_box");
    if (!box || box.dataset.open !== "yes" || !TRENDS) return;
    var sel = document.getElementById("trends-indicator");
    var id = (sel && sel.value) || TRENDS.catalogue[0].id;
    var t = trendTable(id);
    if (TABLES.trends) { TABLES.trends.destroy(); delete TABLES.trends; }
    box.innerHTML = "";
    var tbl = document.createElement("table");
    tbl.className = "display";
    box.appendChild(tbl);
    TABLES.trends = new DataTable(tbl, {
      data: t.rows,
      columns: t.columns.map(function (c) { return { title: c }; }),
      pageLength: 15, lengthMenu: [10, 15, 25, 50],
      autoWidth: false, order: [],
      language: { search: "Search this table", lengthMenu: "Show _MENU_ rows" }
    });
  }

  document.addEventListener("change", function (e) {
    if (e.target.id === "trends-indicator") renderTrends("indicator");
    else if (e.target.id === "trends-group") renderTrends("group");
  });

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("#trends-dl") : null;
    if (!el) return;
    e.preventDefault();
    trends().then(function () {
      var sel = document.getElementById("trends-indicator");
      var id = (sel && sel.value) || TRENDS.catalogue[0].id;
      var meta = TRENDS.byId[id] || { label: id };
      var t = trendTable(id);
      saveBlob(new Blob([BOM + toCSV(t.columns, t.rows)], { type: "text/csv;charset=utf-8" }),
               "KDHS 2025-26 - " + fileStem(meta.label, 60) + " - across the rounds.csv");
    });
  });

  // Getting about ----------------------------------------------------------------------------------

  // Shiny's navset showed one pane and hid the rest; that job moves here. Every
  // pane stays in the document, which is what lets a link jump straight to a
  // topic in a chapter that is not open yet.
  function showPage(page) {
    var found = false;
    document.querySelectorAll(".pane").forEach(function (el) {
      var on = el.dataset.page === page;
      el.classList.toggle("is-on", on);
      if (on) found = true;
    });
    if (!found) return false;
    if (page === "counties" && !CHARTS["counties-locator"]) renderCounty("county");
    if (page === "compare" && !CHARTS["compare-scatter"]) renderCompare();
    if (page === "trends" && !CHARTS["trends-overall"]) renderTrends("all");
    //' The theme the chapter sits in opens with it. script.js owns the opening
    //' itself; this only says which one, because navigation here is ours.
    var tab = document.querySelector('[data-chapters-for] [data-page="' + page + '"]');
    var row = tab && tab.closest("[data-chapters-for]");
    document.querySelectorAll("[data-chapters-for]").forEach(function (r) {
      r.classList.toggle("is-open", !!row && r === row);
    });
    document.querySelectorAll("[data-theme-group]").forEach(function (b) {
      b.classList.toggle("is-open",
        !!row && String(b.dataset.themeGroup) === String(row.dataset.chaptersFor));
    });
    document.querySelectorAll(".chapter-tab").forEach(function (t) {
      t.classList.toggle("is-active", t.dataset.page === page);
    });
    document.body.classList.toggle("on-overview", page === "overview");
    // Newly shown sections have to be looked at again: an observer does not
    // report an element that was display:none when it was first handed over.
    sweep();
    return true;
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-page][data-nav-input]") : null;
    if (!el) return;
    e.preventDefault();
    if (showPage(el.dataset.page)) window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // The search on the opening page ----------------------------------------------------------------

  // A text field and a list under it. The whole survey is already in the page,
  // so there is nothing to fetch and no library to load: a hundred and eighty
  // titles filter faster than a keystroke.
  //
  // Matching is on every word typed, in any order and anywhere in the entry, so
  // "net household" finds "Household possession of mosquito nets" and does not
  // ask a reader to guess the published word order.
  var SEARCH_AT = -1;

  function searchHits(q) {
    var words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length || !INDEX.search) return [];
    return INDEX.search.filter(function (r) {
      var hay = (r.t + " " + r.c + " " + r.b).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    }).slice(0, 12);
  }

  function paintSearch(q) {
    var list = document.getElementById("search-results");
    if (!list) return;
    var hits = searchHits(q);
    SEARCH_AT = -1;
    if (!hits.length) {
      list.innerHTML = q.trim()
        ? '<li class="site-search__miss">Nothing matches ' + esc(q) + "</li>" : "";
      list.hidden = !q.trim();
      return;
    }
    list.innerHTML = hits.map(function (r, i) {
      return '<li><button type="button" class="site-search__hit" data-i="' + i + '" ' +
             'data-page="' + esc(r.p) + '" data-theme="' + esc(r.th) + '" ' +
             'data-anchor="' + esc(r.a) + '">' +
             '<span class="site-search__title">' + esc(r.t) + "</span>" +
             '<span class="site-search__where">' + esc(r.c) + " \u00b7 Table " +
             esc(r.b) + "</span></button></li>";
    }).join("");
    list.hidden = false;
  }

  function closeSearch() {
    var list = document.getElementById("search-results");
    if (list) { list.hidden = true; list.innerHTML = ""; }
    SEARCH_AT = -1;
  }

  function takeHit(btn) {
    if (!btn) return;
    var box = document.getElementById("search");
    if (box) box.value = "";
    closeSearch();
    goTo(btn.dataset.page, btn.dataset.theme, btn.dataset.anchor);
  }

  document.addEventListener("input", function (e) {
    if (e.target.id !== "search") return;
    paintSearch(e.target.value);
  });

  document.addEventListener("keydown", function (e) {
    if (e.target.id !== "search") return;
    var list = document.getElementById("search-results");
    var hits = list ? list.querySelectorAll(".site-search__hit") : [];
    if (e.key === "Escape") { e.target.value = ""; closeSearch(); return; }
    if (!hits.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      SEARCH_AT += (e.key === "ArrowDown" ? 1 : -1);
      if (SEARCH_AT < 0) SEARCH_AT = hits.length - 1;
      if (SEARCH_AT >= hits.length) SEARCH_AT = 0;
      hits.forEach(function (h, i) { h.classList.toggle("is-on", i === SEARCH_AT); });
      hits[SEARCH_AT].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      takeHit(hits[SEARCH_AT >= 0 ? SEARCH_AT : 0]);
    }
  });

  document.addEventListener("click", function (e) {
    var hit = e.target.closest ? e.target.closest(".site-search__hit") : null;
    if (hit) { e.preventDefault(); takeHit(hit); return; }
    if (!e.target.closest || !e.target.closest(".site-search")) closeSearch();
  });

  // Inside a chapter the themes are panes too, marked the way bslib marks them,
  // and theme.css hides every one without .active. Shiny swapped that class;
  // here the rail does it directly.
  function showTheme(page, tid) {
    var pane = document.querySelector('.pane[data-page="' + page + '"]');
    if (!pane) return;
    pane.querySelectorAll(".tab-content > .tab-pane").forEach(function (el) {
      el.classList.toggle("active", el.dataset.value === tid);
    });
    pane.querySelectorAll("[data-theme]").forEach(function (b) {
      if (b.classList.contains("rail-theme")) {
        b.classList.toggle("is-active", b.dataset.theme === tid);
      }
    });
    pane.querySelectorAll("[data-links-for]").forEach(function (el) {
      el.classList.toggle("is-open", el.dataset.linksFor === tid);
    });
    sweep();
  }

  // One topic on the page at a time. Every topic is in the document, which is
  // what lets a link land on any of them, but only the chosen one is shown, so
  // a chapter of twenty three topics is never twenty three charts deep.
  function showArea(aid) {
    var target = document.querySelector('.area-page[data-area="' + aid + '"]');
    if (!target) return false;
    var scope = target.closest(".tab-pane") || target.parentNode;
    scope.querySelectorAll(".area-page").forEach(function (el) {
      el.classList.toggle("is-on", el === target);
    });
    document.querySelectorAll(".rail-link").forEach(function (a) {
      a.classList.toggle("is-active", a.dataset.anchor === aid);
    });
    sweep();
    return true;
  }

  // Switching part of a chapter lands on the first topic in it, so a click on a
  // theme always shows something rather than a row of buttons and a blank.
  function showFirstArea(tid) {
    var links = document.querySelector('.rail-links[data-links-for="' + tid + '"]');
    var first = links && links.querySelector(".rail-link:not(.is-hidden)");
    if (first) showArea(first.dataset.anchor);
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-theme][data-theme-input]") : null;
    if (!el) return;
    e.preventDefault();
    var page = (el.dataset.themeInput || "").split("-")[0];
    showTheme(page, el.dataset.theme);
    if (el.dataset.anchor) showArea(el.dataset.anchor);
    else showFirstArea(el.dataset.theme);
  });

  function scrollTo_(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var pinned = parseInt(getComputedStyle(document.documentElement)
                          .getPropertyValue("--pinned"), 10) || 0;
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - pinned - 18,
                      behavior: "smooth" });
  }

  function goTo(page, theme, anchor) {
    showPage(page);
    showTheme(page, theme);
    if (!showArea(anchor)) showFirstArea(theme);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // A link to a chapter or one topic, so a finding can be sent to a colleague.
  function fromUrl() {
    var q = new URLSearchParams(location.search);
    var topic = q.get("topic"), chapter = q.get("chapter");
    if (topic) {
      var hit = (INDEX.areas || []).find(function (a) { return a.aid === topic; });
      if (hit) { goTo(hit.page, hit.tid, topic); return; }
    }
    if (chapter && showPage(chapter)) return;
    showPage("overview");
  }

  // Starting up -------------------------------------------------------------------------------------

  function boot() {
    return getJSON("data/index.json").then(function (ix) {
      INDEX = ix;
      window.KDHS = { index: ix, area: area, render: render };
      return getJSON("counties.geojson");
    }).then(function (geo) {
      GEO = geo;
      if (window.Highcharts) Highcharts.maps.county = geo;
      fromUrl();
      document.body.classList.add("site-ready");
      document.dispatchEvent(new CustomEvent("kdhs:ready"));
    }).catch(function (err) {
      console.error("[kdhs] could not start:", err);
      var note = document.createElement("p");
      note.className = "boot-error";
      note.textContent = "The figures could not be loaded. If you opened this file directly, " +
                         "serve the folder over http instead, because a browser will not fetch " +
                         "data files from a file:// page.";
      document.body.prepend(note);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
