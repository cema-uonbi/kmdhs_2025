// ==================================================================================
// The pickers on the static site
// ==================================================================================
//
// In the Shiny app every picker is a selectize box: a proper white field with a
// caret, a list that opens under it, and typing that narrows the list. The static
// site has no Shiny and so had the browser's own dropdown, or for long lists the
// home-made box in pick.js, set in the smallest type on the page. They read as
// thin and plain beside the app.
//
// Tom Select is selectize rewritten without jQuery, by the people who kept
// selectize going. It wraps the native select rather than replacing it: the
// select stays in the page with its value, and Tom Select fires a real change
// event on it, which is all the rest of site.js listens for.
//
// Two things the library does not do on its own, and this file does:
//   - site.js refills some lists from the data (the county map, the trends, the
//     comparison), so a list whose options change is read again;
//   - site.js and script.js set a picker in code (a search landing on a topic, a
//     ready-made comparison, the swap button), so setting .value on the select
//     moves the box too.
// ==================================================================================

(function () {
  "use strict";
  if (!window.TomSelect) return;

  var nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

  // The DataTables "Show 15 rows" box keeps the browser's control: it belongs to
  // the table library and is not a choice about the survey.
  function wanted(sel) {
    return sel.tagName === "SELECT" && !sel.multiple && !sel.tomselect &&
      !sel.closest(".dataTables_wrapper, .dt-container") && !sel.dataset.plain;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function enhance(sel) {
    var ts;
    try {
      ts = new TomSelect(sel, {
        create: false,
        allowEmptyOption: true,
        maxOptions: null,
        // Every word typed has to appear somewhere in the entry or its group,
        // in any order, the way the app's boxes behave.
        // "full" is an option's name before it was shortened to fit the box
        // (site.js puts it on the Analytics measures), so a word cut out of the
        // label is still found.
        searchField: ["text", "full", "optgroup"],
        // The box always shows the current choice. Opening it, by a click or by
        // simply starting to type, puts a search field at the top of the list,
        // on every box: a list can be short when the page loads and long a
        // moment later, as the county map's 472 measures are.
        plugins: ["dropdown_input"],
        placeholder: "Type to search",
        render: {
          no_results: function (data) {
            return '<div class="no-results">Nothing matches <b>' + esc(data.input) + "</b></div>";
          }
        },
        // The list opens on the current choice, scrolled within the list only;
        // scrollIntoView would move the page as well.
        onDropdownOpen: function (dd) {
          var cur = dd.querySelector(".option.selected"), box = dd.querySelector(".ts-dropdown-content");
          if (cur && box) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 2);
        }
      });
    } catch (e) { return; }

    // Tom Select keeps the original select up to date by moving its options
    // about, so a change to the list is judged by which options it holds, not
    // by whether the page touched it: otherwise every choice looked like a
    // refill, the list was read again and the choice was lost.
    function keys() {
      return Array.prototype.map.call(sel.options, function (o) { return o.value; })
        .filter(function (v) { return v !== ""; }).sort().join("\u0001");
    }
    var known = keys();
    var busy = false;

    // Read the list again, keeping what the select itself says is chosen.
    function refresh() {
      busy = true;
      try {
        var keep = nativeValue.get.call(sel);
        ts.clearOptions();
        ts.sync();
        if (keep !== "" && ts.options[keep] && ts.getValue() !== keep) ts.setValue(keep, true);
      } finally { busy = false; known = keys(); }
    }

    // Setting the select in code moves the box. The native setter still does
    // the work, so the select is the one record of the choice. A value the box
    // has not heard of means the list was refilled just before it was set,
    // which is how site.js fills the county map and the comparison.
    Object.defineProperty(sel, "value", {
      configurable: true,
      get: function () { return nativeValue.get.call(sel); },
      set: function (v) {
        nativeValue.set.call(sel, v);
        if (busy) return;
        var now = nativeValue.get.call(sel);
        if (keys() !== known || !ts.options[now]) { refresh(); return; }
        busy = true;
        try { ts.setValue(now, true); } finally { busy = false; }
      }
    });

    new MutationObserver(function () {
      if (busy || keys() === known) return;
      refresh();
    }).observe(sel, { childList: true, subtree: true });
  }

  function sweep(root) {
    (root || document).querySelectorAll("select").forEach(function (sel) {
      if (wanted(sel)) enhance(sel);
    });
  }

  function start() {
    sweep();
    // Get past data builds two of its pickers each time it draws a result.
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        r.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.tagName === "SELECT") { if (wanted(n)) enhance(n); }
          else if (n.querySelector && n.querySelector("select")) sweep(n);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
