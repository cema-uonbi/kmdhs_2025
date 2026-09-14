// ==================================================================================
// Searchable pickers
// ==================================================================================
//
// Some of these lists are long. The comparison page offers 477 measures and the
// trends page 180, and a native dropdown makes you scroll all of them looking
// for the word you already have in your head.
//
// So every long picker gets a box you can type in, the way RStudio's own
// selectize boxes work: the list narrows as you type, on every word in any
// order, arrows move, Enter takes, Escape puts it back.
//
// The native <select> is not replaced, only covered. It stays in the page with
// its value intact, which is what lets Shiny go on reading and writing it, and
// lets the static site's own listeners go on hearing it. Everything here ends
// with setting that select and telling the page it moved.
//
// No library. The survey is already in the page.

(function () {
  // Below this many options a native dropdown is the better control: there is
  // nothing to search and a text box only puts a step in the way.
  var MIN_OPTIONS = 8;

  var open = null;   // the picker currently showing its list

  function options(sel) {
    var out = [];
    Array.prototype.forEach.call(sel.options, function (o) {
      if (o.disabled) return;
      var group = o.parentNode && o.parentNode.tagName === "OPTGROUP"
        ? o.parentNode.label : "";
      out.push({ value: o.value, text: o.text, group: group });
    });
    return out;
  }

  function currentText(sel) {
    var o = sel.options[sel.selectedIndex];
    return o ? o.text : "";
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Every word typed has to appear somewhere in the entry, in any order. "net
  // household" finds "Household possession of mosquito nets", which the
  // published word order would not.
  function matches(row, words) {
    var hay = (row.text + " " + row.group).toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }

  function build(sel) {
    var box = document.createElement("div");
    box.className = "pick";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "pick__input";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    var label = sel.closest(".shiny-input-container, .field, .form-group");
    var lab = label && label.querySelector("label");
    if (lab) input.setAttribute("aria-label", lab.textContent.trim());

    var list = document.createElement("ul");
    list.className = "pick__list";
    list.hidden = true;

    sel.parentNode.insertBefore(box, sel);
    box.appendChild(input);
    box.appendChild(list);
    box.appendChild(sel);
    sel.classList.add("pick__native");

    var at = -1;
    var shown = [];

    function paint(q) {
      var words = String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
      shown = options(sel).filter(function (r) { return !words.length || matches(r, words); });
      at = -1;
      if (!shown.length) {
        list.innerHTML = '<li class="pick__miss">Nothing matches ' + esc(q) + "</li>";
        return;
      }
      var last = null, html = "";
      shown.forEach(function (r, i) {
        if (r.group && r.group !== last) {
          html += '<li class="pick__group">' + esc(r.group) + "</li>";
          last = r.group;
        }
        html += '<li><button type="button" class="pick__hit' +
                (r.value === sel.value ? " is-current" : "") +
                '" data-i="' + i + '">' + esc(r.text) + "</button></li>";
      });
      list.innerHTML = html;
    }

    // Opening and clearing are two different things. show() only opens, and
    // paints whatever is already typed: called from the input handler it used
    // to wipe the first letter of every search, so typing into a closed box
    // lost the word and reopened on the full list.
    function show() {
      if (open && open !== close) open();
      open = close;
      box.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");
      list.hidden = false;
      input.placeholder = currentText(sel) || "Search";
      paint(input.value);
    }

    // Focus is where the box empties, so a reader can type over the label
    // rather than having to select it first.
    function focused() {
      input.value = "";
      show();
    }

    function close() {
      box.classList.remove("is-open");
      input.setAttribute("aria-expanded", "false");
      list.hidden = true;
      list.innerHTML = "";
      input.value = currentText(sel);
      input.placeholder = "";
      if (open === close) open = null;
    }

    // The one thing this component exists to do. Setting a select's value in
    // script fires nothing on its own, so the event is sent by hand or Shiny
    // and the static site both sit there with a new label over an old chart.
    function take(row) {
      if (!row) return;
      if (sel.value !== row.value) {
        sel.value = row.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      close();
    }

    function move(by) {
      var hits = list.querySelectorAll(".pick__hit");
      if (!hits.length) return;
      at += by;
      if (at < 0) at = hits.length - 1;
      if (at >= hits.length) at = 0;
      hits.forEach(function (h, i) { h.classList.toggle("is-on", i === at); });
      hits[at].scrollIntoView({ block: "nearest" });
    }

    input.addEventListener("focus", focused);
    input.addEventListener("input", function () {
      if (list.hidden) show();
      paint(input.value);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) show(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var hits = list.querySelectorAll(".pick__hit");
        var i = at >= 0 ? at : 0;
        if (hits[i]) take(shown[parseInt(hits[i].dataset.i, 10)]);
      } else if (e.key === "Escape") { e.preventDefault(); close(); input.blur(); }
    });
    list.addEventListener("mousedown", function (e) {
      // mousedown, not click: the input blurs first and the list would be gone
      // before the click landed.
      var hit = e.target.closest(".pick__hit");
      if (!hit) return;
      e.preventDefault();
      take(shown[parseInt(hit.dataset.i, 10)]);
    });
    input.addEventListener("blur", function () { setTimeout(close, 120); });

    // Shiny replaces a picker's options whenever the table behind it changes,
    // and the county page and the trends page both do that. The box follows.
    var watch = new MutationObserver(function () {
      if (list.hidden) input.value = currentText(sel);
      else paint(input.value);
    });
    watch.observe(sel, { childList: true, subtree: true, attributes: true,
                         attributeFilter: ["value"] });
    sel.addEventListener("change", function () { if (list.hidden) input.value = currentText(sel); });

    input.value = currentText(sel);
    sel.dataset.picked = "yes";
  }

  function sweep() {
    document.querySelectorAll(
      ".controls select, .county-pick select, .table-block__head select"
    ).forEach(function (sel) {
      if (sel.dataset.picked === "yes") return;
      if (sel.multiple) return;
      if (sel.options.length < MIN_OPTIONS) return;
      build(sel);
    });
  }

  // A picker can arrive at any time: Shiny builds a chapter's panel when its
  // tab is first opened, and the static site fills two of them from JSON. So
  // the page is watched rather than swept once at the start.
  function start() {
    sweep();
    new MutationObserver(function () { sweep(); })
      .observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", function (e) {
      if (!e.target.closest || !e.target.closest(".pick")) { if (open) open(); }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
