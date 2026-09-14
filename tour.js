
// ==================================================================================
// The tour
// ==================================================================================
//
// A first visit lands on fifteen chapters, a hundred and sixty seven topics and
// a search box, with nothing saying which of them to touch first. So the first
// visit gets walked through it once, and only once. Every step can be left at
// any point, leaving is remembered exactly as finishing is, and the footer
// carries a link for anyone who wants it again.
//
// No library. A dimmed page with a hole cut in it, a card beside the hole and
// four keys that work. Everything it needs is already in the page.

(function () {
  var SEEN = "kdhs-tour-v1";

  var steps = [
    {
      sel: ".chapter-bar--inline, .chapter-bar--top",
      title: "Fifteen chapters",
      body: "The survey arrives as fifteen chapters and each one is a tab. This row is the whole of the navigation, so whatever you are reading you are one click from anywhere else."
    },
    {
      sel: ".hero-search",
      title: "Or go straight to a topic",
      body: "Type what you are after and the list narrows as you go. Choosing one opens its chapter and scrolls to it."
    },
    {
      sel: ".chapter-index",
      title: "Start from a chapter",
      body: "If you would rather browse, every chapter says what is in it before you open it."
    },
    {
      page: "ch2",
      sel: ".rail",
      title: "Topics down the side",
      body: "Inside a chapter the topics sit here and follow you as you scroll, so you always know where in the chapter you are.",
      wait: true
    },
    {
      page: "ch2",
      sel: ".area-stats",
      title: "The headline figures",
      body: "Each topic opens with its main figures and how each one has moved since the last round."
    },
    {
      page: "ch2",
      sel: ".controls",
      title: "The pickers",
      body: "Every picker sits with the thing it changes. This one chooses which column of the published table everything below is drawn from."
    },
    {
      page: "ch2",
      sel: ".table-block",
      title: "The published table",
      body: "Under every topic is the table as the report prints it, searchable and ready to download as a CSV or an Excel file."
    }
  ];

  var i = 0;
  var scrim, card, hole;

  function seen() {
    try { return localStorage.getItem(SEEN) === "yes"; } catch (e) { return true; }
  }
  function remember() {
    try { localStorage.setItem(SEEN, "yes"); } catch (e) { /* private window */ }
  }

  function build() {
    scrim = document.createElement("div");
    scrim.className = "tour-scrim";
    hole = document.createElement("div");
    hole.className = "tour-hole";
    card = document.createElement("div");
    card.className = "tour-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-live", "polite");
    document.body.appendChild(scrim);
    document.body.appendChild(hole);
    document.body.appendChild(card);
    scrim.addEventListener("click", stop);
    document.addEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (!card) return;
    if (e.key === "Escape") { stop(); }
    else if (e.key === "ArrowRight" || e.key === "Enter") { go(1); }
    else if (e.key === "ArrowLeft") { go(-1); }
  }

  function stop() {
    remember();
    document.removeEventListener("keydown", onKey);
    [scrim, hole, card].forEach(function (el) { if (el && el.parentNode) el.remove(); });
    scrim = hole = card = null;
    document.body.classList.remove("tour-open");
    goHome();
  }

  // The tour walks into a chapter to show what a chapter looks like, so leaving
  // it anywhere else would strand a first visit three quarters of the way down
  // a page about housing. Whether it was finished or left early, it ends where
  // it began. Anyone already on the opening page is left where they are rather
  // than having it scrolled out from under them.
  function goHome() {
    var tab = document.querySelector(".chapter-tab.is-active");
    var here = tab ? tab.getAttribute("data-page") : "overview";
    if (here === "overview") return;
    var home = null;
    document.querySelectorAll('.chapter-bar [data-page="overview"]').forEach(function (b) {
      if (!home && b.getBoundingClientRect().width > 0) home = b;
    });
    if (!home) home = document.querySelector('.chapter-bar [data-page="overview"]');
    if (home) home.click(); else window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function go(by) {
    var next = i + by;
    if (next < 0) return;
    if (next >= steps.length) { stop(); return; }
    i = next;
    show();
  }

  // The chapter panes are all in the page already, so switching to one is the
  // same click the tab bar makes. The element is there either way; it is being
  // visible that has to be waited for.
  function openPage(page, then) {
    var btn = document.querySelector('.chapter-bar [data-page="' + page + '"]');
    if (!btn) { then(); return; }
    btn.click();
    setTimeout(then, 420);
  }

  function find(sel, tries, then) {
    var el = null;
    document.querySelectorAll(sel).forEach(function (c) {
      if (el) return;
      var r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) el = c;
    });
    if (el || tries <= 0) { then(el); return; }
    setTimeout(function () { find(sel, tries - 1, then); }, 220);
  }

  function show() {
    var step = steps[i];
    var run = function () {
      find(step.sel, 8, function (el) {
        if (!el) { go(1); return; }
        place(el, step);
      });
    };
    var tab = document.querySelector(".chapter-tab.is-active");
    var onPage = tab ? tab.getAttribute("data-page") : "overview";
    if (step.page && step.page !== onPage) openPage(step.page, run); else run();
  }

  function place(el, step) {
    var pinned = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--pinned"), 10) || 0;
    var r = el.getBoundingClientRect();
    var top = window.scrollY + r.top - pinned - 120;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });

    setTimeout(function () {
      var b = el.getBoundingClientRect();
      var pad = 10;
      hole.style.top = (b.top - pad) + "px";
      hole.style.left = (b.left - pad) + "px";
      hole.style.width = (b.width + pad * 2) + "px";
      hole.style.height = (b.height + pad * 2) + "px";

      card.innerHTML =
        '<p class="tour-card__step">Step ' + (i + 1) + ' of ' + steps.length + '</p>' +
        '<h4 class="tour-card__title"></h4>' +
        '<p class="tour-card__body"></p>' +
        '<div class="tour-card__row">' +
        '<button type="button" class="tour-skip">Skip the tour</button>' +
        '<span class="tour-card__spacer"></span>' +
        (i > 0 ? '<button type="button" class="tour-back">Back</button>' : '') +
        '<button type="button" class="tour-next">' +
        (i === steps.length - 1 ? 'Done' : 'Next') + '</button>' +
        '</div>';
      card.querySelector(".tour-card__title").textContent = step.title;
      card.querySelector(".tour-card__body").textContent = step.body;
      card.querySelector(".tour-skip").addEventListener("click", stop);
      card.querySelector(".tour-next").addEventListener("click", function () { go(1); });
      var back = card.querySelector(".tour-back");
      if (back) back.addEventListener("click", function () { go(-1); });

      var cw = Math.min(400, window.innerWidth - 32);
      card.style.width = cw + "px";
      var below = b.bottom + 18;
      var room = window.innerHeight - below;
      var ch = card.offsetHeight || 220;
      card.style.top = (room > ch + 20 ? below : Math.max(16, b.top - ch - 18)) + "px";
      card.style.left = Math.min(
        Math.max(16, b.left), window.innerWidth - cw - 16) + "px";
      card.querySelector(".tour-next").focus();
    }, 420);
  }

  function start() {
    if (card) return;
    i = 0;
    document.body.classList.add("tour-open");
    build();
    show();
  }

  window.kdhsTour = start;

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-tour-start]")) { e.preventDefault(); start(); }
  });

  // Only a first visit, and only once the page has settled enough to point at
  // something. Anyone who has been here before is left alone.
  window.addEventListener("load", function () {
    if (seen()) return;
    setTimeout(start, 900);
  });
})();
