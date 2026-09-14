/* ===========================================================================
   Behaviour for the KDHS dashboard
   ---------------------------------------------------------------------------
     1. move between chapters
     2. land exactly on the section that was asked for, under the pinned bars
     3. light up the theme and the section being read, on the rail
     4. filter one chapter's rail without going back to the server
     5. tell a chart drawn inside a hidden chapter to measure itself again
     6. let the wheel scroll the page when the pointer is over a map

   On (2): the chapter bar wraps, so how much is pinned at the top of the window
   depends on the width of the window and on how many chapters there are. It is
   measured rather than assumed, and written back into the stylesheet so CSS
   anchors and JavaScript scrolls agree.

   On (5): Highcharts fixes a chart's pixel size when it draws, and a chart
   drawn inside a display:none panel measures its container as zero wide.
   Switching to that chapter then shows an empty box. Nothing in Shiny or
   Highcharts fixes this by itself.
   =========================================================================== */

(function () {
  "use strict";

  // --- how much of the top of the window is spoken for ----------------------
  function pinnedHeight() {
    var h = 0;
    var head = document.querySelector("header.app-header");
    if (head && getComputedStyle(head).position === "sticky") h += head.offsetHeight;
    //' The tabs are in the page twice and only one copy is ever shown, so the
    //' hidden one must not be the one that gets measured.
    document.querySelectorAll("nav.chapter-bar").forEach(function (bar) {
      if (bar.offsetParent !== null && getComputedStyle(bar).position === "sticky") {
        h += bar.offsetHeight;
      }
    });
    return h;
  }

  function syncPinned() {
    var h = pinnedHeight();
    //' Nothing is pinned on a narrow screen, where the bars scroll away with
    //' the page, so an anchor only needs to clear a little breathing room.
    document.documentElement.style.setProperty("--pinned", (h > 0 ? h + 22 : 24) + "px");
  }

  //' Scrolling by measurement rather than with scrollIntoView, which knows
  //' nothing about the two bars sitting over the top of the page and drops the
  //' reader into the middle of the section they asked for.
  function scrollToEl(el) {
    if (!el) return;
    var top = el.getBoundingClientRect().top + window.scrollY - pinnedHeight() - 18;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }

  // --- ask every chart on screen to measure itself again --------------------
  function reflowCharts() {
    if (!window.Highcharts || !Highcharts.charts) return;
    Highcharts.charts.forEach(function (chart) {
      if (!chart || !chart.renderTo) return;
      if (chart.renderTo.offsetWidth === 0) return;
      try { chart.reflow(); } catch (e) { /* mid-redraw, it comes round again */ }
    });
  }

  function reflowSoon() {
    window.requestAnimationFrame(function () {
      reflowCharts();
      setTimeout(reflowCharts, 240);
    });
  }

  //' A section in a theme that is not showing does not exist in the page until
  //' Shiny has swapped that theme in, so the scroll waits for it rather than
  //' firing at nothing.
  function scrollWhenReady(anchor, tries) {
    var el = document.getElementById(anchor);
    if (el && el.offsetParent !== null) {
      syncPinned();
      scrollToEl(el);
      setTimeout(reflowSoon, 260);
      return;
    }
    if ((tries || 0) > 30) return;
    setTimeout(function () { scrollWhenReady(anchor, (tries || 0) + 1); }, 60);
  }

  // --- say which theme is showing -------------------------------------------
  function markTheme(theme) {
    document.querySelectorAll(".rail-theme[data-theme]").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-theme") === theme);
    });
    document.querySelectorAll(".rail-links[data-links-for]").forEach(function (d) {
      d.classList.toggle("is-open", d.getAttribute("data-links-for") === theme);
    });
  }

  //' A theme's panel does not exist in the page until Shiny has swapped it in,
  //' so the scroll waits for the panel itself rather than for a timer. Landing
  //' on the theme's own heading, not on the top of the stream, which is several
  //' hundred pixels further up and reads as having gone to the wrong place.
  function scrollToThemeWhenReady(theme, tries) {
    var pane = document.querySelector('.tab-pane[data-value="' + theme + '"]');
    if (pane && pane.offsetParent !== null) {
      syncPinned();
      scrollToEl(pane.querySelector(".theme-open") || pane);
      setTimeout(reflowSoon, 260);
      return;
    }
    if ((tries || 0) > 30) return;
    setTimeout(function () { scrollToThemeWhenReady(theme, (tries || 0) + 1); }, 60);
  }

  // --- the address bar ------------------------------------------------------
  //' So a chapter or a single topic can be sent to someone, or cited. Written
  //' with replaceState rather than pushState: these are the same page, and
  //' filling the back button with every section a reader scrolled past would
  //' make leaving the app a chore.
  function writeUrl(page, topic) {
    if (!window.history || !history.replaceState) return;
    var q = [];
    if (page && page !== "overview") q.push("chapter=" + encodeURIComponent(page));
    if (topic) q.push("topic=" + encodeURIComponent(topic));
    var url = window.location.pathname + (q.length ? "?" + q.join("&") : "");
    try { history.replaceState(null, "", url); } catch (e) { /* file:// and the like */ }
  }

  //' Which page is showing, written on the body so the stylesheet can put the
  //' tabs under the introduction on the opening page and at the top everywhere
  //' else without either copy having to move.
  function markPage(page) {
    document.body.classList.toggle("on-overview", page === "overview");
    document.querySelectorAll(".chapter-tab").forEach(function (tab) {
      tab.classList.toggle("is-active", tab.getAttribute("data-page") === page);
    });
  }

  function currentPage() {
    var tab = document.querySelector(".chapter-tab.is-active");
    return tab ? tab.getAttribute("data-page") : "overview";
  }

  //' Read once, on the way in. Shiny owns which chapter is showing, so the
  //' address is handed to it rather than acted on here.
  function readUrl() {
    var p = new URLSearchParams(window.location.search);
    var chapter = p.get("chapter"), topic = p.get("topic");
    if (!chapter && !topic) return;
    if (window.Shiny) {
      Shiny.setInputValue("deeplink", { chapter: chapter || "", topic: topic || "" },
                          { priority: "event" });
    }
  }

  // --- moving between chapters ----------------------------------------------
  document.addEventListener("click", function (event) {
    var el = event.target.closest("[data-page][data-nav-input]");
    if (!el) return;

    var page = el.getAttribute("data-page");
    if (window.Shiny) {
      Shiny.setInputValue(el.getAttribute("data-nav-input"), page, { priority: "event" });
    }
    markPage(page);
    settleScrollspy();

    //' Chapters scroll, so arriving at a new one part of the way down the last
    //' would drop a reader into the middle of it.
    window.scrollTo({ top: 0, behavior: "smooth" });
    writeUrl(page, null);
    setTimeout(function () { syncPinned(); reflowSoon(); }, 120);
  });

  // --- the rail --------------------------------------------------------------
  document.addEventListener("click", function (event) {
    var el = event.target.closest("[data-theme][data-theme-input]");
    if (!el) return;
    event.preventDefault();

    var theme = el.getAttribute("data-theme");
    var anchor = el.getAttribute("data-anchor");
    if (window.Shiny) {
      Shiny.setInputValue(el.getAttribute("data-theme-input"), theme, { priority: "event" });
    }
    markTheme(theme);
    //' Marked at once rather than waiting for the scroll to settle and the
    //' observer to catch up, or the section you just asked for spends a second
    //' showing some other section as the one you are in.
    if (anchor) {
      document.querySelectorAll(".rail-link").forEach(function (a) {
        a.classList.toggle("is-active", a.getAttribute("data-anchor") === anchor);
      });
    }

    if (anchor) {
      writeUrl(currentPage(), anchor);
      scrollWhenReady(anchor, 0);
    } else {
      writeUrl(currentPage(), null);
      scrollToThemeWhenReady(theme, 0);
    }
    setTimeout(bindScrollspy, 900);
  });

  // --- searching one chapter -------------------------------------------------
  //' Class changes only, on one wrapper per theme. The earlier version set
  //' inline display on a heading and on its list separately, on every keystroke,
  //' which is what made the rail flicker.
  //'
  //' While a search is running every theme is open, or a match three themes down
  //' would sit inside a collapsed group and read as no match at all. A theme
  //' with nothing left in it steps aside whole. When the box is cleared the rail
  //' goes back to showing the theme that is actually on the page.
  function filterRail(rail, q) {
    var query = (q || "").trim().toLowerCase();
    var active = rail.querySelector(".rail-theme.is-active");
    var openTheme = active ? active.getAttribute("data-theme") : null;
    var shown = 0;

    rail.querySelectorAll(".rail-group").forEach(function (g) {
      var hits = 0;
      g.querySelectorAll(".rail-link").forEach(function (a) {
        var hit = !query || a.textContent.toLowerCase().indexOf(query) !== -1;
        a.classList.toggle("is-hidden", !hit);
        if (hit) hits++;
      });
      shown += hits;

      var links = g.querySelector(".rail-links");
      if (query) {
        g.classList.toggle("is-hidden", hits === 0);
        if (links) links.classList.add("is-open");
      } else {
        g.classList.remove("is-hidden");
        if (links) links.classList.toggle("is-open", links.getAttribute("data-links-for") === openTheme);
      }
    });
    rail.classList.toggle("is-empty", query.length > 0 && shown === 0);
  }

  document.addEventListener("input", function (event) {
    var box = event.target.closest(".rail-filter__input");
    if (!box) return;
    filterRail(box.closest(".rail"), box.value);
  });

  //' Escape clears the box and puts the chapter back, which is what a reader
  //' expects and saves them holding backspace.
  document.addEventListener("keydown", function (event) {
    var box = event.target.closest(".rail-filter__input");
    if (!box || event.key !== "Escape") return;
    box.value = "";
    filterRail(box.closest(".rail"), "");
  });

  // --- the search box --------------------------------------------------------
  if (window.Shiny) {
    Shiny.addCustomMessageHandler("kdhs-goto", function (m) {
      markPage(m.page);
      settleScrollspy();
      if (m.themeInput && m.theme) {
        Shiny.setInputValue(m.themeInput, m.theme, { priority: "event" });
        markTheme(m.theme);
      }
      if (m.anchor) {
        writeUrl(m.page, m.anchor);
        scrollWhenReady(m.anchor, 0);
      } else {
        writeUrl(m.page, null);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      setTimeout(bindScrollspy, 500);
    });
  }

  // --- which section am I looking at ----------------------------------------
  //' Driven off scrolling rather than off an IntersectionObserver alone. An
  //' observer only fires when a threshold is crossed, so between two tall
  //' sections - and these run to a thousand pixels each - the rail goes stale,
  //' and a click that scrolls smoothly can finish after the last observer call
  //' and leave the wrong section marked. A throttled scroll handler is cheap
  //' and always tells the truth.
  var spyAreas = [];
  var spyLinks = {};
  var spyQueued = false;
  var lastUrlTopic = null;

  function updateActive() {
    spyQueued = false;
    if (!spyAreas.length) return;

    var edge = pinnedHeight() + 40;
    var current = null;
    for (var i = 0; i < spyAreas.length; i++) {
      var a = spyAreas[i];
      if (a.offsetParent === null) continue;
      if (a.getBoundingClientRect().top <= edge) current = a.id;
      else break;
    }
    if (!current) {
      for (var j = 0; j < spyAreas.length; j++) {
        if (spyAreas[j].offsetParent !== null) { current = spyAreas[j].id; break; }
      }
    }

    Object.keys(spyLinks).forEach(function (id) {
      spyLinks[id].classList.toggle("is-active", id === current);
    });
    if (spyLinks[current]) {
      markTheme(spyLinks[current].getAttribute("data-theme"));
      spyLinks[current].scrollIntoView({ block: "nearest" });
      if (current !== lastUrlTopic) {
        lastUrlTopic = current;
        writeUrl(currentPage(), current);
      }
    }
  }

  function queueUpdate() {
    if (spyQueued) return;
    spyQueued = true;
    window.requestAnimationFrame(updateActive);
  }

  //' Shiny builds a chapter's panel after the tab is clicked, and how long that
  //' takes depends on the chapter. Binding once, at a guessed moment, is why the
  //' rail lit up on some tabs and not on others. So it is bound repeatedly over
  //' the second and a half after a page changes and stops as soon as it finds
  //' something, which makes it the same on every tab regardless of size.
  function settleScrollspy() {
    [0, 150, 400, 900, 1600].forEach(function (t) {
      setTimeout(function () {
        bindScrollspy();
        //' Nothing on the page yet: the panel is still being built, and a later
        //' pass will catch it.
      }, t);
    });
  }

  function bindScrollspy() {
    //' Only the sections of the chapter on the page. The other twelve chapters
    //' are in the document too and would otherwise all be measured on every
    //' frame of every scroll.
    var pane = document.querySelector(".tab-pane.active .area-stream .tab-pane.active") ||
               document.querySelector(".tab-pane.active .area-stream") ||
               document;
    var found = Array.prototype.slice.call(pane.querySelectorAll(".area"));
    //' Nothing on the page yet means Shiny is still building the panel, not that
    //' there is nothing to track. Keeping the previous binding until there is
    //' something to replace it with.
    if (!found.length) return;
    spyAreas = found;
    spyLinks = {};
    document.querySelectorAll(".rail-link").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (href.charAt(0) === "#") spyLinks[href.slice(1)] = a;
    });
    updateActive();
  }

  window.addEventListener("scroll", queueUpdate, { passive: true });

  // --- back to the top, from the footer -------------------------------------
  document.addEventListener("click", function (event) {
    if (!event.target.closest(".top-btn")) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // --- anything Shiny redraws ------------------------------------------------
  //' Guarded. Shiny always brings jQuery with it, but an unguarded call to it
  //' throws at load time if it is ever absent, and everything below this point
  //' in the file - the rail, the search, the scrolling - then never binds.
  if (window.jQuery) {
    jQuery(document).on("shiny:value shiny:visualchange", function () {
      setTimeout(reflowCharts, 70);
    });
    jQuery(document).on("shiny:idle", function () {
      syncPinned();
      bindScrollspy();
    });
  }

  document.addEventListener("shown.bs.tab", reflowSoon, true);
  window.addEventListener("resize", function () { syncPinned(); reflowCharts(); queueUpdate(); });
  document.addEventListener("DOMContentLoaded", function () {
    markPage("overview");
    syncPinned();
    bindScrollspy();
    setTimeout(readUrl, 400);
  });
  //' Measured again once the web fonts have landed: the chapter bar is a row of
  //' words, so its height is not final until they have.
  window.addEventListener("load", function () { syncPinned(); setTimeout(syncPinned, 500); });
})();

// --- let the page scroll through a map, rather than hang on it --------------
// Turning enableMouseWheelZoom off stops the map zooming on a wheel event, but
// Highcharts still binds its own wheel listener on the chart container and
// calls preventDefault() on it regardless, and that is the bit that freezes the
// scroll. Catching the wheel up on the document in the capture phase and
// stopping it propagating means Highcharts never sees it.
document.addEventListener(
  "wheel",
  function (event) {
    if (event.target.closest(".highcharts-container")) event.stopPropagation();
  },
  { capture: true, passive: true }
);

// The county outlines. adm1.geojson is the full resolution file at 9.2MB, and
// hit testing every mouse move against all of those vertices is what makes a
// map feel sluggish. counties.geojson is the same 47 counties simplified to
// about 110KB, close enough that the shapes are indistinguishable on screen.
fetch('counties.geojson')
  .then(function (r) { return r.json(); })
  .then(function (map) {
    if (!window.Highcharts) return;
    Highcharts.maps['county'] = map;
    if (window.Shiny) Shiny.setInputValue('county_map_ready', Date.now());
  })
  .catch(function () { /* not on a page that draws maps */ });
