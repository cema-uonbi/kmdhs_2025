// ==================================================================================
// Get past data — live DHS API explorer
// ==================================================================================
(function () {
  "use strict";

  var API = "https://api.dhsprogram.com/rest/dhs", COUNTRY = "KE", PAGE_SIZE = 300, MAX_PAGES = 80;
  var CATALOG_FIELDS = "IndicatorId,Label,ShortName,Definition,Level1,Level2,MeasurementType";
  var TABLE = null, CHART = null, MAP = null, TREND = null;
  var STARTERS = [
    ["FP_CUSM_W_MOD", "Modern contraceptive use (married women)", "%"],
    ["FP_NADA_W_UMT", "Unmet need for modern family planning (all women)", "%"],
    ["FP_NADA_W_PDM", "Demand for family planning satisfied by modern methods", "%"],
    ["FE_FRTR_W_TFR", "Total fertility rate", "births per woman"],
    ["CM_ECMR_C_U5M", "Under-five mortality rate", "per 1,000 live births"],
    ["CM_ECMR_C_NNR", "Neonatal mortality rate", "per 1,000 live births"],
    ["MM_MMRO_W_MMR", "Maternal mortality ratio", "per 100,000 live births"],
    ["RH_DELA_C_SKP", "Births assisted by a skilled provider", "%"],
    ["RH_DELP_C_DHF", "Births delivered in a health facility", "%"],
    ["RH_ANCP_W_SKP", "Antenatal care from a skilled provider", "%"],
    ["CN_NUTS_C_HA2", "Children stunted (height-for-age)", "%"],
    ["CN_IYCB_C_EXB", "Children exclusively breastfed (under 6 months)", "%"],
    ["AN_ANEM_W_ANY", "Women with any anaemia", "%"],
    ["ED_LITR_W_LIT", "Women who are literate", "%"]
  ].map(function (r) { return { id: r[0], label: r[1], unit: r[2], hay: (r[0] + " " + r[1]).toLowerCase() }; });
  var PROVINCES = {
    "Nairobi": ["Nairobi"], "Central": ["Kiambu", "Kirinyaga", "Murang'a", "Nyandarua", "Nyeri"],
    "Coast": ["Kilifi", "Kwale", "Lamu", "Mombasa", "Taita Taveta", "Tana River"],
    "Eastern": ["Embu", "Isiolo", "Kitui", "Machakos", "Makueni", "Marsabit", "Meru", "Tharaka-Nithi"],
    "North Eastern": ["Garissa", "Mandera", "Wajir"], "Nyanza": ["Homa Bay", "Kisii", "Kisumu", "Migori", "Nyamira", "Siaya"],
    "Rift Valley": ["Baringo", "Bomet", "Elgeyo-Marakwet", "Kajiado", "Kericho", "Laikipia", "Nakuru", "Nandi", "Narok", "Samburu", "Trans Nzoia", "Turkana", "Uasin Gishu", "West Pokot"],
    "Western": ["Bungoma", "Busia", "Kakamega", "Vihiga"]
  }, COUNTY_NAMES = { "Trans-Nzoia": "Trans Nzoia", "Elgeyo Marakwet": "Elgeyo-Marakwet" };
  var LINE_COLORS = ["#AA6340", "#E7A83E", "#6E402A", "#0D465E", "#C0834F", "#635A46", "#7C6E51", "#CDBF9A"];
  var STATE = { indicator: STARTERS[0], catalog: [], catalogById: {}, catalogStatus: "idle", rows: [], request: 0, trendRegions: [], table: null };

  function el(id) { return document.getElementById(id); }
  function ready() { return !!el("past-results"); }
  function esc(v) { return String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function palette() { return (window.KDHS && window.KDHS.index && window.KDHS.index.palette) || { blue: "#AA6340", orange: "#E7A83E", ink: "#221C13", inkSoft: "#635A46", grid: "#D6C9A6", gridSoft: "#EAE3CE" }; }
  function say(message, warn) { var node = el("past-status"); if (node) { node.className = "past-status" + (warn ? " past-status--warn" : ""); node.textContent = message || ""; } }
  function request(path, params) { var q = new URLSearchParams(params || {}); return fetch(API + path + (q.toString() ? "?" + q.toString() : ""), { mode: "cors", headers: { Accept: "application/json" } }).then(function (r) { if (!r.ok) throw new Error("The DHS service answered " + r.status + "."); return r.json(); }); }
  function level() { return (el("past-level") || {}).value || "national"; }
  function breakdown() { return level() === "national" ? "national" : "subnational"; }
  function selectedId() { var c = el("past-custom-id"); return c && c.value.trim() ? c.value.trim().toUpperCase() : STATE.indicator.id; }
  function selectedLabel() { var c = el("past-custom-id"); return c && c.value.trim() ? c.value.trim().toUpperCase() : STATE.indicator.label; }
  function unit() { return (STATE.catalogById[selectedId()] || STARTERS.find(function (r) { return r.id === selectedId(); }) || STATE.indicator || {}).unit || ""; }
  function buildUrl(id, requestedBreakdown, page) { var q = new URLSearchParams({ countryIds: COUNTRY, indicatorIds: id, breakdown: requestedBreakdown, perpage: String(PAGE_SIZE), f: "json" }); if (page) q.set("page", String(page)); return API + "/data?" + q.toString(); }
  function updateQuery() { var node = el("past-query"); if (node) node.innerHTML = "<b>Live query</b> " + esc(buildUrl(selectedId() || "…", breakdown(), 1)); }

  // ---- searchable Kenya indicator catalog --------------------------------------
  function normalizeIndicator(raw) { var label = raw.Label || raw.ShortName || raw.IndicatorId, type = String(raw.MeasurementType || "").toLowerCase(); return { id: raw.IndicatorId, label: label, level1: raw.Level1 || "", unit: type === "percent" ? "%" : (type === "rate" || type === "ratio" ? type : ""), hay: [raw.IndicatorId, label, raw.ShortName, raw.Definition, raw.Level1, raw.Level2].join(" ").toLowerCase() }; }
  function words(q) { return q.toLowerCase().trim().split(/\s+/).filter(Boolean); }
  function score(row, q) { var ws = words(q), hay = row.hay || "", label = String(row.label || "").toLowerCase(), n = hay.indexOf(q.toLowerCase()) >= 0 ? 30 : 0; ws.forEach(function (w) { if (label.indexOf(w) >= 0) n += 8; else if (hay.indexOf(w) >= 0) n += 2; }); return n; }
  function searchIndicators(q) {
    var seen = {}, hits = [];
    STARTERS.concat(STATE.catalog).forEach(function (row) { if (!row || !row.id || seen[row.id]) return; seen[row.id] = true; var n = score(row, q); if (!q.trim() || n) hits.push({ row: row, score: n }); });
    return hits.sort(function (a, b) { return b.score - a.score || a.row.label.localeCompare(b.row.label); }).slice(0, 40).map(function (x) { return x.row; });
  }
  function renderOptions() {
    var input = el("past-indicator-search"), box = el("past-indicator-options"); if (!input || !box) return;
    var q = input.value.trim(), results = searchIndicators(q), html = q ? "" : '<p class="past-options__note">Start typing to search all Kenya DHS indicators. A verified starting list is shown first.</p>';
    html += results.length ? results.map(function (r) { return '<button type="button" class="past-option" role="option" data-id="' + esc(r.id) + '"><span class="past-option__label">' + esc(r.label) + '</span><span class="past-option__meta">' + esc(r.id + (r.level1 ? " · " + r.level1 : "")) + '</span></button>'; }).join("") : '<p class="past-options__note">No match has loaded yet. You can enter an exact DHS indicator ID instead.</p>';
    if (STATE.catalogStatus === "loading") html += '<p class="past-options__note">Loading the full Kenya indicator catalog…</p>';
    else if (STATE.catalogStatus === "ready" && q) html += '<p class="past-options__note">Searched ' + STATE.catalog.length.toLocaleString("en-US") + ' Kenya DHS indicators.</p>';
    box.innerHTML = html;
  }
  function closeOptions() { var input = el("past-indicator-search"), box = el("past-indicator-options"); if (box) box.hidden = true; if (input) input.setAttribute("aria-expanded", "false"); }
  function openOptions() { var input = el("past-indicator-search"), box = el("past-indicator-options"); if (!input || !box) return; box.hidden = false; input.setAttribute("aria-expanded", "true"); renderOptions(); loadCatalog(); }
  function chooseIndicator(id, refetch) { var row = STATE.catalogById[id] || STARTERS.find(function (r) { return r.id === id; }); if (!row) return; STATE.indicator = row; el("past-indicator-search").value = row.label; el("past-custom-id").value = ""; el("past-indicator-selection").textContent = row.id + (row.level1 ? " · " + row.level1 : ""); closeOptions(); updateQuery(); if (refetch) { STATE.rows = []; STATE.round = null; STATE.trendRegions = []; clearCharts(); fetchData(); } }
  function loadCatalog() {
    if (STATE.catalogStatus === "loading" || STATE.catalogStatus === "ready") return;
    STATE.catalogStatus = "loading"; renderOptions();
    request("/indicators", { countryIds: COUNTRY, returnFields: CATALOG_FIELDS, perpage: "200", page: "1", f: "json" }).then(function (first) {
      var pages = Math.min(Number(first.TotalPages) || 1, MAX_PAGES), next = 2;
      function ingest(data) { (data || []).forEach(function (raw) { var row = normalizeIndicator(raw); if (row.id && !STATE.catalogById[row.id]) { STATE.catalogById[row.id] = row; STATE.catalog.push(row); } }); }
      ingest(first.Data);
      function worker() { if (next > pages) return Promise.resolve(); var page = next++; return request("/indicators", { countryIds: COUNTRY, returnFields: CATALOG_FIELDS, perpage: "200", page: String(page), f: "json" }).then(function (d) { ingest(d.Data); renderOptions(); }).then(worker); }
      return Promise.all([worker(), worker(), worker(), worker()]);
    }).then(function () { STATE.catalog.sort(function (a, b) { return a.label.localeCompare(b.label); }); STATE.catalogStatus = "ready"; renderOptions(); }).catch(function () { STATE.catalogStatus = "error"; renderOptions(); });
  }

  // ---- data retrieval and normalisation ---------------------------------------
  function fetchAll(id, requestedBreakdown) {
    var all = [], page = 1;
    function next() { return fetch(buildUrl(id, requestedBreakdown, page)).then(function (r) { if (!r.ok) throw new Error("The DHS service answered " + r.status + "."); return r.json(); }).then(function (json) { var rows = Array.isArray(json.Data) ? json.Data : [], total = Number(json.TotalPages) || 1; all = all.concat(rows); if (page < total && rows.length && page < MAX_PAGES) { page += 1; return next(); } if (page < total) throw new Error("The DHS response was unusually large and was not complete."); return all; }); }
    return next();
  }
  function validRows(rows) { return rows.filter(function (r) { return r && r.Value !== null && r.Value !== "" && isFinite(Number(r.Value)); }); }
  function isCounty(row) { var label = String(row.CharacteristicLabel || ""); return label.indexOf("..") === 0 || label === "Nairobi"; }
  function cleanName(row) { var label = String(row.CharacteristicLabel || "").replace(/^\.\./, ""); return COUNTY_NAMES[label] || label; }
  function rowsForLevel(rows, wanted) { return wanted === "county" ? rows.filter(isCounty) : wanted === "province" ? rows.filter(function (r) { return String(r.CharacteristicLabel || "").indexOf("..") !== 0; }) : rows; }
  function roundsFor(rows, wanted) { var counts = {}; rowsForLevel(rows, wanted).forEach(function (r) { var id = r.SurveyId || String(r.SurveyYear); if (!counts[id]) counts[id] = { id: id, year: r.SurveyYear, label: r.SurveyYearLabel || r.SurveyYear, count: 0 }; counts[id].count += 1; }); var min = wanted === "county" ? 8 : 3; return Object.keys(counts).map(function (k) { return counts[k]; }).filter(function (r) { return r.count >= min; }).sort(function (a, b) { return Number(a.year) - Number(b.year); }); }
  function onePerRound(rows) { var by = {}; rows.forEach(function (r) { var id = r.SurveyId || String(r.SurveyYear); if (!by[id] || r.IsTotal || (!by[id].IsTotal && r.ByVariableLabel === "")) by[id] = r; }); return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return Number(a.SurveyYear) - Number(b.SurveyYear); }); }
  function indicatorTitle(rows) { return (rows[0] && rows[0].Indicator) || selectedLabel(); }
  function value(row) { return Number(row.Value); }
  function fmt(n, row) { var p = Number(row && row.Precision); return Number(n).toFixed(isFinite(p) && p >= 0 ? p : 1); }

  // ---- visualisation ------------------------------------------------------------
  function clearCharts() { [CHART, MAP, TREND].forEach(function (c) { if (c) c.destroy(); }); CHART = MAP = TREND = null; if (TABLE) { TABLE.destroy(); TABLE = null; } STATE.table = null; }
  function chartBase() { var p = palette(); return { chart: { backgroundColor: "transparent", style: { fontFamily: "inherit" } }, credits: { enabled: false }, title: { style: { color: p.ink, fontWeight: "bold" } }, xAxis: { lineColor: p.grid, tickLength: 0, labels: { style: { color: p.inkSoft } } }, yAxis: { title: { text: "" }, gridLineColor: p.grid, labels: { style: { color: p.inkSoft } } }, tooltip: { valueSuffix: unit() ? " " + unit() : "" } }; }
  function summary(items) { return '<div class="past-summary">' + items.map(function (i) { return '<div class="past-summary__item"><span class="past-summary__label">' + esc(i.label) + '</span><strong class="past-summary__value">' + esc(i.value) + '</strong></div>'; }).join("") + "</div>"; }
  function actionBar(rawUrl, table) { STATE.table = table; return '<div class="table-block"><div class="table-block__head"><span class="table-block__title">Returned records</span><div class="table-block__tools"><a class="dl-btn" href="' + esc(rawUrl) + '" target="_blank" rel="noopener">Open raw API query</a><button type="button" id="past-download" class="dl-btn">Download this (CSV)</button></div></div><div class="past-table-wrap"><table id="past-table" class="display"></table></div><p class="past-raw-link"><a href="' + esc(rawUrl) + '" target="_blank" rel="noopener">Open raw API query in a new tab ↗</a></p></div>'; }
  function drawTable() { var table = STATE.table; if (!table || !table.rows.length || !window.DataTable) return; TABLE = new DataTable(el("past-table"), { data: table.rows, columns: table.columns.map(function (title) { return { title: title }; }), pageLength: 15, lengthMenu: [10, 15, 25, 50], autoWidth: false, order: [] }); }
  function renderNational(rows, rawUrl) {
    var points = onePerRound(rows), latest = points[points.length - 1], title = indicatorTitle(points), p = palette();
    el("past-results").innerHTML = '<div class="past-result-head"><div><h3>' + esc(title) + '</h3><p class="past-result-note">Kenya nationally · ' + points.length + ' survey round' + (points.length === 1 ? "" : "s") + ' returned by DHS</p></div></div><div class="past-layout past-layout--national"><div><div class="past-map-frame"><div id="past-map" class="past-map" aria-label="Map of Kenya showing the national estimate"></div><div class="past-national-badge" aria-hidden="true"><strong>' + esc(fmt(value(latest), latest) + (unit() ? " " + unit() : "")) + '</strong><span>Kenya · ' + esc(latest.SurveyYearLabel || latest.SurveyYear) + '</span></div></div><p class="past-map-note">A national figure applies to every county equally. Choose Province or County above for a geographic breakdown.</p></div><div class="past-layout__data">' + summary([{ label: "Latest value (" + (latest.SurveyYearLabel || latest.SurveyYear) + ")", value: fmt(value(latest), latest) + (unit() ? " " + unit() : "") }, { label: "Survey", value: latest.SurveyId || "—" }, { label: "Unweighted N", value: latest.DenominatorUnweighted === null || latest.DenominatorUnweighted === undefined ? "—" : latest.DenominatorUnweighted }]) + '<div id="past-chart" class="past-chart"></div></div></div>' + actionBar(rawUrl, { columns: ["Survey", "Year", "Value", "Unweighted N"], rows: points.map(function (r) { return [r.SurveyId || "", r.SurveyYearLabel || r.SurveyYear || "", fmt(value(r), r) + (unit() ? " " + unit() : ""), r.DenominatorUnweighted === null || r.DenominatorUnweighted === undefined ? "" : r.DenominatorUnweighted]; }) });
    drawNationalMap(latest); CHART = Highcharts.chart("past-chart", Highcharts.merge(chartBase(), { chart: { type: "line", height: 410 }, title: { text: title }, legend: { enabled: false }, xAxis: { categories: points.map(function (r) { return r.SurveyYearLabel || r.SurveyYear; }) }, yAxis: { min: unit() === "%" ? 0 : null }, series: [{ name: "Kenya", color: p.blue, lineWidth: 3, marker: { enabled: true, radius: 5 }, data: points.map(function (r) { return value(r); }) }] })); drawTable();
  }
  function regionRows(rows, wanted, round) { var seen = {}, out = []; rowsForLevel(rows, wanted).filter(function (r) { return (r.SurveyId || String(r.SurveyYear)) === round.id; }).forEach(function (r) { var name = cleanName(r); if (!seen[name]) { seen[name] = true; out.push({ name: name, row: r, value: value(r) }); } }); return out.sort(function (a, b) { return b.value - a.value; }); }
  function geographicValues(rows, wanted) { var out = {}; if (wanted === "county") rows.forEach(function (r) { out[r.name] = r.value; }); else rows.forEach(function (r) { (PROVINCES[r.name] || []).forEach(function (c) { out[c] = r.value; }); }); return out; }
  function drawMap(rows, wanted, title) {
    var mapData = window.Highcharts && Highcharts.maps && Highcharts.maps.county, p = palette();
    if (!mapData) { el("past-map").innerHTML = '<p class="past-empty">The county map is still loading. The ranking and table remain available.</p>'; return; }
    var values = geographicValues(rows, wanted), points = Object.keys(values).map(function (county) { return { county: county, value: values[county] }; }), vals = points.map(function (r) { return r.value; });
    MAP = Highcharts.mapChart("past-map", Highcharts.merge(chartBase(), { chart: { map: mapData, height: 475, spacingTop: 8 }, title: { text: "" }, legend: { enabled: true, align: "center", verticalAlign: "bottom" }, colorAxis: { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals), stops: [[0, "#FAF3EC"], [0.25, "#EBD4BE"], [0.5, "#D2A379"], [0.75, "#AA6340"], [1, "#5E351F"]] }, tooltip: { pointFormat: "<b>{point.properties.county}</b><br>{point.value}" + (unit() ? " " + unit() : "") }, series: [{ mapData: mapData, data: points, joinBy: ["county", "county"], nullColor: "#FFFFFF", borderColor: p.ink, borderWidth: .5, states: { hover: { borderWidth: 1.2 } } }] }));
  }
  function drawNationalMap(latest) {
    var mapData = window.Highcharts && Highcharts.maps && Highcharts.maps.county, p = palette(), latestValue = value(latest);
    if (!mapData) { el("past-map").innerHTML = '<p class="past-empty">The Kenya map is still loading.</p>'; return; }
    var points = (mapData.features || []).map(function (feature) { return { county: feature.properties.county, value: latestValue, color: p.blue }; });
    MAP = Highcharts.mapChart("past-map", Highcharts.merge(chartBase(), { chart: { map: mapData, height: 475, spacingTop: 8 }, title: { text: "" }, legend: { enabled: false }, tooltip: { formatter: function () { return "<b>" + this.point.properties.county + "</b><br>National estimate: <b>" + fmt(this.point.value, latest) + (unit() ? " " + unit() : "") + "</b>"; } }, series: [{ mapData: mapData, data: points, joinBy: ["county", "county"], color: p.blue, nullColor: p.blue, borderColor: p.paper || "#FFFFFF", borderWidth: .7, states: { hover: { borderColor: p.ink, borderWidth: 1.2 } } }] }));
  }
  function trendMarkup(rows, wanted, rounds) {
    if (rounds.length < 2) return '<p class="figure-note">Only one survey round has enough ' + (wanted === "county" ? "county" : "province") + '-level data to show a trend.</p>';
    var names = {}; rowsForLevel(rows, wanted).forEach(function (r) { names[cleanName(r)] = true; }); var available = Object.keys(names).sort();
    if (!STATE.trendRegions.length) { var now = regionRows(rows, wanted, rounds[rounds.length - 1]), n = Math.min(3, Math.ceil(now.length / 2)); STATE.trendRegions = now.slice(0, n).concat(now.slice(-n)).map(function (r) { return r.name; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 8); }
    var remaining = available.filter(function (name) { return STATE.trendRegions.indexOf(name) < 0; });
    return '<section class="past-trends"><div class="past-trends__head"><div><span class="eyebrow">Across survey rounds</span><p class="past-result-note">Compare up to eight ' + (wanted === "county" ? "counties" : "provinces") + ' with published data.</p></div><div class="past-field"><label for="past-region-add">Add a ' + (wanted === "county" ? "county" : "province") + '</label><select id="past-region-add" class="form-control"' + (STATE.trendRegions.length >= 8 ? " disabled" : "") + '><option value="">Choose one…</option>' + remaining.map(function (name) { return '<option value="' + esc(name) + '">' + esc(name) + '</option>'; }).join("") + '</select></div></div><div class="past-tags">' + STATE.trendRegions.map(function (name, i) { return '<span class="past-tag" style="border-color:' + LINE_COLORS[i % LINE_COLORS.length] + '">' + esc(name) + '<button type="button" data-past-remove="' + esc(name) + '" aria-label="Remove ' + esc(name) + '">×</button></span>'; }).join("") + '</div><div id="past-trend" class="past-chart"></div></section>';
  }
  function drawTrend(rows, wanted, rounds) {
    var host = el("past-trend"); if (!host) return; var history = {};
    rowsForLevel(rows, wanted).forEach(function (r) { var name = cleanName(r), id = r.SurveyId || String(r.SurveyYear); (history[name] || (history[name] = {}))[id] = value(r); });
    TREND = Highcharts.chart(host, Highcharts.merge(chartBase(), { chart: { type: "line", height: 360 }, title: { text: "" }, xAxis: { categories: rounds.map(function (r) { return r.label || r.year; }) }, yAxis: { min: unit() === "%" ? 0 : null }, series: STATE.trendRegions.map(function (name, i) { return { name: name, color: LINE_COLORS[i % LINE_COLORS.length], data: rounds.map(function (r) { return history[name] && history[name][r.id] !== undefined ? history[name][r.id] : null; }), connectNulls: false }; }) }));
  }
  function renderGeo(rows, rawUrl) {
    var wanted = level(), rounds = roundsFor(rows, wanted); if (!rounds.length) { el("past-results").innerHTML = '<p class="past-empty">DHS returned data for this indicator, but not enough ' + esc(wanted === "county" ? "county" : "province") + '-level records to display a geographic comparison.</p>'; return; }
    if (!STATE.round || !rounds.some(function (r) { return r.id === STATE.round; })) STATE.round = rounds[rounds.length - 1].id;
    var round = rounds.find(function (r) { return r.id === STATE.round; }), selected = regionRows(rows, wanted, round), title = indicatorTitle(selected.map(function (r) { return r.row; })), highest = selected[0], lowest = selected[selected.length - 1], label = wanted === "county" ? "county" : "former province";
    el("past-results").innerHTML = '<div class="past-result-head"><div><h3>' + esc(title) + '</h3><p class="past-result-note">Kenya by ' + esc(label) + ' · live DHS data</p></div><div class="past-field"><label for="past-round">Survey round</label><select id="past-round" class="form-control">' + rounds.map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === round.id ? " selected" : "") + '>' + esc((r.label || r.year) + " (" + r.id + ")") + '</option>'; }).join("") + '</select></div></div><div class="past-layout past-layout--geographic"><div id="past-map" class="past-map"></div><div class="past-layout__data">' + summary([{ label: "Highest · " + highest.name, value: fmt(highest.value, highest.row) + (unit() ? " " + unit() : "") }, { label: "Lowest · " + lowest.name, value: fmt(lowest.value, lowest.row) + (unit() ? " " + unit() : "") }, { label: (wanted === "county" ? "Counties" : "Provinces") + " reporting", value: selected.length }]) + '<div id="past-chart" class="past-chart"></div></div></div>' + trendMarkup(rows, wanted, rounds) + actionBar(rawUrl, { columns: [wanted === "county" ? "County" : "Province", "Value", "Unweighted N"], rows: selected.map(function (r) { return [r.name, fmt(r.value, r.row) + (unit() ? " " + unit() : ""), r.row.DenominatorUnweighted === null || r.row.DenominatorUnweighted === undefined ? "" : r.row.DenominatorUnweighted]; }) });
    el("past-round").addEventListener("change", function (event) { STATE.round = event.target.value; clearCharts(); renderGeo(rows, rawUrl); }); drawMap(selected, wanted, title);
    var p = palette(); CHART = Highcharts.chart("past-chart", Highcharts.merge(chartBase(), { chart: { type: "bar", height: Math.max(400, selected.length * 26 + 110) }, title: { text: (round.label || round.year) + " ranking" }, legend: { enabled: false }, xAxis: { categories: selected.map(function (r) { return r.name; }) }, yAxis: { min: unit() === "%" ? 0 : null }, series: [{ name: title, color: p.blue, data: selected.map(function (r) { return r.value; }) }] })); drawTrend(rows, wanted, rounds); drawTable();
  }
  function toCSV(columns, rows) { function quote(v) { v = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; } return [columns.map(quote).join(",")].concat(rows.map(function (r) { return r.map(quote).join(","); })).join("\n"); }
  function download() { if (!STATE.table || !STATE.table.rows.length) return; var blob = new Blob([String.fromCharCode(0xFEFF) + toCSV(STATE.table.columns, STATE.table.rows)], { type: "text/csv;charset=utf-8" }), link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "DHS Program - Kenya - " + selectedLabel().replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() + ".csv"; document.body.appendChild(link); link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 1000); }
  function render() { clearCharts(); var rows = validRows(STATE.rows), rawUrl = buildUrl(selectedId(), breakdown(), 1); if (!rows.length) { el("past-results").innerHTML = '<p class="past-empty">DHS returned no usable Kenya records for this indicator and level.</p>'; return; } if (level() === "national") renderNational(rows, rawUrl); else renderGeo(rows, rawUrl); }
  function fetchData() {
    var id = selectedId(), ticket = ++STATE.request, button = el("past-fetch"); if (!id) { say("Choose an indicator or enter an exact DHS indicator ID.", true); return; }
    button.disabled = true; say("Fetching live Kenya data from The DHS Program…"); el("past-results").innerHTML = "";
    fetchAll(id, breakdown()).then(function (rows) { if (ticket !== STATE.request) return; STATE.rows = rows; STATE.round = null; STATE.trendRegions = []; say(rows.length ? "Loaded " + rows.length + " record" + (rows.length === 1 ? "" : "s") + " from The DHS Program." : ""); render(); }).catch(function (error) { if (ticket === STATE.request) say("Could not reach The DHS Program: " + error.message + " Everything else on this site works without a connection.", true); }).finally(function () { if (ticket === STATE.request) button.disabled = false; });
  }

  function start() {
    if (!ready()) return; chooseIndicator(STATE.indicator.id); updateQuery();
    el("past-indicator-search").addEventListener("focus", openOptions);
    el("past-indicator-search").addEventListener("input", function () { openOptions(); renderOptions(); });
    el("past-indicator-search").addEventListener("keydown", function (event) { if (event.key === "Enter") { var first = el("past-indicator-options").querySelector(".past-option"); if (first) { event.preventDefault(); chooseIndicator(first.dataset.id, true); } } else if (event.key === "Escape") closeOptions(); });
    el("past-indicator-options").addEventListener("mousedown", function (event) { var option = event.target.closest(".past-option"); if (option) { event.preventDefault(); chooseIndicator(option.dataset.id, true); } });
    document.addEventListener("click", function (event) { var field = el("past-indicator-search").closest(".past-field"); if (field && !field.contains(event.target)) closeOptions(); });
    el("past-custom-id").addEventListener("input", updateQuery);
    el("past-level").addEventListener("change", function () { updateQuery(); STATE.rows = []; STATE.round = null; STATE.trendRegions = []; clearCharts(); fetchData(); });
    el("past-fetch").addEventListener("click", fetchData);
    document.addEventListener("click", function (event) { if (event.target.id === "past-download") download(); var remove = event.target.closest("[data-past-remove]"); if (remove) { STATE.trendRegions = STATE.trendRegions.filter(function (name) { return name !== remove.dataset.pastRemove; }); clearCharts(); renderGeo(STATE.rows, buildUrl(selectedId(), "subnational", 1)); } });
    document.addEventListener("change", function (event) { if (event.target.id === "past-region-add" && event.target.value && STATE.trendRegions.length < 8) { STATE.trendRegions.push(event.target.value); clearCharts(); renderGeo(STATE.rows, buildUrl(selectedId(), "subnational", 1)); } });
    // A populated default makes the live explorer useful on first arrival;
    // the button remains available for every subsequent query.
    fetchData();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
