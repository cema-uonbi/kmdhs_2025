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
      title: { text: wrapTitle(shortTitle(ind, 70) + " by " + group.toLowerCase(), 64) },
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
    var el = document.getElementById(ns + "-table");
    if (!el) return;
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
      var group = val(ns + "-group") || p.groups[0];
      var year = val(ns + "-year") || p.years[0];

      if (!what || what === "all" || what === "indicator") drawCards(p, ns, indIdx);
      if (!what || what === "all" || what === "indicator" || what === "group") {
        if (p.groups.length) drawBar(p, ns, indIdx, group);
      }
      if (!what || what === "all" || what === "indicator" || what === "year") {
        if (p.ctyRows.length) { drawMap(p, ns, indIdx, year); drawRank(p, ns, indIdx, year); }
      }
      if (!what || what === "all" || what === "indicator" || what === "year" ||
          what === "tview") {
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
    document.querySelectorAll(".pane.is-on .tab-pane.active section.area, " +
                              ".pane.is-on section.area").forEach(function (el) {
      if (SEEN[el.id]) return;
      if (!el.getClientRects().length) return;   // still behind a closed theme
      IO.observe(el);
    });
  }

  // "ch2-a2_1-stats" is the stats div of area a2_1; the namespace is everything
  // before the last dash.
  function nsOf(sectionEl) {
    var probe = sectionEl.querySelector("[id$='-stats'],[id$='-table']");
    if (!probe) return sectionEl.id;
    return probe.id.replace(/-(stats|table)$/, "");
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
      drawCountyTable(d, name);
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

  function drawCountyTable(d, name) {
    var el = document.getElementById("counties-table");
    if (!el) return;
    var t = countyTable(d);
    if (TABLES.counties) { TABLES.counties.destroy(); el.innerHTML = ""; }
    var tbl = document.createElement("table");
    tbl.className = "display";
    el.innerHTML = ""; el.appendChild(tbl);
    TABLES.counties = new DataTable(tbl, {
      data: t.rows,
      columns: t.columns.map(function (c) { return { title: c }; }),
      pageLength: 25, lengthMenu: [10, 25, 50, 100],
      scrollX: true, autoWidth: false, order: [],
      language: { search: "Search this table", lengthMenu: "Show _MENU_ rows" }
    });
    var head = document.getElementById("counties-table_heading");
    if (head) head.textContent = "Every figure published for " + name;
    var count = document.getElementById("counties-table_count");
    if (count) count.textContent = t.rows.length.toLocaleString("en-US") + " figures";
  }

  document.addEventListener("change", function (e) {
    if (!/^counties-(county|chapter|theme)$/.test(e.target.id || "")) return;
    renderCounty(e.target.id.replace("counties-", ""));
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
    if (page === "counties" && !TABLES.counties) renderCounty("county");
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

  // The search on the opening page, and the one in every chapter rail.
  document.addEventListener("change", function (e) {
    if (e.target.id !== "search") return;
    var bits = String(e.target.value).split("|");
    if (bits.length < 3) return;
    goTo("ch" + bits[0], bits[1], bits[2]);
    e.target.value = "";
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

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-theme][data-theme-input]") : null;
    if (!el) return;
    var page = (el.dataset.themeInput || "").split("-")[0];
    showTheme(page, el.dataset.theme);
    if (el.dataset.anchor) {
      setTimeout(function () { scrollTo_(el.dataset.anchor); }, 80);
    }
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
    setTimeout(function () { scrollTo_(anchor); }, 260);
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
