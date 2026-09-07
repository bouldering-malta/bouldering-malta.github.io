/* Malta Bouldering — app.js
   Renders the whole page from data/data.json. Nothing is hardcoded per sector. */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ config */

  var CONFIG = {
    dataUrl: "data/data.json",
    // Swap to false once real topos and photos are in /images/.
    // true renders baby-blue placeholder boxes carrying the alt text.
    placeholderImages: true
  };

  var FONT_SCALE = ["3","4","4+","5","5+","6A","6A+","6B","6B+","6C","6C+",
    "7A","7A+","7B","7B+","7C","7C+","8A","8A+","8B","8B+","8C","8C+","9A"];
  var V_SCALE = ["VB","V0","V0+","V1","V2","V3","V4","V5","V6","V7","V8","V9",
    "V10","V11","V12","V13","V14","V15","V16","V17"];

  var state = {
    data: null,
    climbs: [],           // flat list, in sector then array order
    scale: "font",        // "font" | "v"
    sort: "default",      // "default" | "asc" | "desc"
    filters: { name: "", from: -1, to: -1, sector: "all", stars: 0 },
    gradeOptions: [],     // grade strings in the active scale, ascending
    lastFocus: null
  };

  /* ------------------------------------------------------------------ helpers */

  var $ = function (sel) { return document.querySelector(sel); };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var LETTER_MAP = { "ħ":"h","ġ":"g","ż":"z","ċ":"c","ø":"o","đ":"d","ł":"l",
    "æ":"ae","œ":"oe","ß":"ss" };

  function slugify(s) {
    return String(s).toLowerCase()
      .replace(/[ħġżċøđłæœß]/g, function (c) { return LETTER_MAP[c]; })
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function gradeIndex(climb) {
    return state.scale === "font" ? climb._fontIdx : climb._vIdx;
  }

  function gradeBand(fontIdx) {
    if (fontIdx <= 4) return "g1";
    if (fontIdx <= 8) return "g2";
    if (fontIdx <= 12) return "g3";
    if (fontIdx <= 16) return "g4";
    return "g5";
  }

  function starsHtml(n) {
    var out = "";
    for (var i = 1; i <= 3; i++) {
      out += '<span class="' + (i <= n ? "on" : "off") + '">' + (i <= n ? "★" : "☆") + "</span>";
    }
    return '<span class="stars" aria-label="' + n + ' of 3 stars">' + out + "</span>";
  }

  function gradeHtml(climb) {
    return '<span class="grade ' + gradeBand(climb._fontIdx) + '">' +
      '<span class="g-font">' + esc(climb.gradeFont) + "</span>" +
      '<span class="g-v">' + esc(climb.gradeV) + "</span>" +
      "</span>";
  }

  // Baby-blue stand-in, or the real image once placeholderImages is off.
  function mediaHtml(img, cls) {
    if (!img) return "";
    if (CONFIG.placeholderImages) {
      return '<div class="ph-box ' + (cls || "") + '"><span>' + esc(img.alt) + "</span></div>";
    }
    return '<img src="' + esc(img.src) + '" alt="' + esc(img.alt) + '" loading="lazy">';
  }

  /* ------------------------------------------------------------------ model */

  function buildModel(data) {
    state.climbs = [];

    data.sectors.forEach(function (sector) {
      sector._count = 0;

      sector.boulders.forEach(function (boulder) {
        var seen = {};

        boulder.climbs.forEach(function (climb, i) {
          var base = climb.slug ? slugify(climb.slug) : slugify(climb.name);
          var slug = base;
          if (seen[base]) {
            slug = base + "-" + (seen[base] + 1);
            console.warn("Slug collision on " + boulder.name + ": \"" + climb.name +
              "\" resolved to \"" + slug + "\". Set an explicit slug to pin it.");
          }
          seen[base] = (seen[base] || 0) + 1;

          climb._slug = slug;
          climb._anchor = sector.id + "--" + boulder.id + "--" + slug;
          climb._number = i + 1;
          climb._fontIdx = FONT_SCALE.indexOf(climb.gradeFont);
          climb._vIdx = V_SCALE.indexOf(climb.gradeV);

          if (climb._fontIdx < 0 || climb._vIdx < 0) {
            console.warn("Unknown grade on \"" + climb.name + "\": " +
              climb.gradeFont + " / " + climb.gradeV);
            if (climb._fontIdx < 0) climb._fontIdx = FONT_SCALE.length;
            if (climb._vIdx < 0) climb._vIdx = V_SCALE.length;
          }

          sector._count++;
          state.climbs.push({
            climb: climb,
            sectorId: sector.id,
            sectorName: sector.name,
            boulderName: boulder.name,
            order: state.climbs.length
          });
        });
      });
    });
  }

  /* ------------------------------------------------------------------ render */

  function renderHero(meta) {
    if (!meta.hero) return;
    $("#hero").innerHTML =
      mediaHtml(meta.hero) +
      (meta.hero.credit ? '<p class="hero-credit"><small>' + esc(meta.hero.credit) + "</small></p>" : "");
  }

  function renderContact(meta) {
    var mail = meta.contactEmail;
    var link = $("#contact-email");
    link.textContent = mail;
    link.href = "mailto:" + mail;
    document.querySelectorAll('a[href^="mailto:"]').forEach(function (a) {
      a.href = "mailto:" + mail;
      if (a.id !== "contact-email" && a.textContent.indexOf("@") > -1) a.textContent = mail;
    });

    var repo = meta.githubRepo;
    var issue = $("#issue-link");
    if (repo) {
      issue.href = "https://github.com/" + repo +
        "/issues/new?template=new-problem.yml&title=" + encodeURIComponent("New problem: ");
    } else {
      issue.closest("p").hidden = true;
    }
  }

  function renderIndex(sectors) {
    $("#sector-index-list").innerHTML = sectors.map(function (s) {
      return '<li><a href="#' + esc(s.id) + '">' +
        '<span class="sector-index-name">' + esc(s.name) + "</span>" +
        '<span class="count">' + s._count + " problems</span></a></li>";
    }).join("");
  }

  function climbHtml(climb) {
    var html = '<li class="climb" id="' + esc(climb._anchor) + '">' +
      '<div class="climb-line">' +
        '<span class="climb-num">' + climb._number + ".</span>" +
        '<span class="climb-main"><span class="climb-name">' + esc(climb.name) + "</span>" +
        '<span class="climb-start">(' + esc(climb.start) + ")</span></span>" +
        '<span class="climb-meta">' + gradeHtml(climb) + starsHtml(climb.stars) +
          '<button type="button" class="copy-link" data-anchor="' + esc(climb._anchor) +
          '" aria-label="Copy a link to ' + esc(climb.name) + '">link</button>' +
        "</span>";

    if (climb.description) html += '<p class="climb-desc">' + esc(climb.description) + "</p>";
    if (climb.fa) html += '<p class="climb-fa">FA: ' + esc(climb.fa.name) + ", " + esc(climb.fa.year) + "</p>";

    if (climb.photos && climb.photos.length) {
      html += '<div class="climb-photos">' + climb.photos.map(function (p, i) {
        return '<figure><button type="button" class="topo-btn" data-img="' +
          esc(climb._anchor) + ":" + i + '">' + mediaHtml(p) + "</button>" +
          '<figcaption>' + esc(p.credit) + "</figcaption></figure>";
      }).join("") + "</div>";
    }

    return html + "</div></li>";
  }

  function boulderHtml(sector, boulder) {
    var html = '<section class="boulder" id="' + esc(sector.id + "--" + boulder.id) + '">' +
      "<h3>" + esc(boulder.name) + "</h3>";

    if (boulder.description) html += "<p>" + esc(boulder.description) + "</p>";

    if (boulder.topo) {
      html += '<figure><button type="button" class="topo-btn" data-img="topo:' +
        esc(sector.id + "--" + boulder.id) + '">' + mediaHtml(boulder.topo) + "</button>" +
        "<figcaption>" + esc(boulder.topo.credit) + "</figcaption></figure>";
    }

    html += '<ol class="climbs">' + boulder.climbs.map(climbHtml).join("") + "</ol>";
    return html + "</section>";
  }

  function renderSectors(sectors) {
    $("#sectors").innerHTML = sectors.map(function (s) {
      var coords = s.coords.lat.toFixed(4) + ", " + s.coords.lng.toFixed(4);
      return '<details class="sector" id="' + esc(s.id) + '">' +
        "<summary>" +
          '<span class="sector-name">' + esc(s.name) + "</span>" +
          '<span class="sector-count">' + s._count + " problems</span>" +
          '<button type="button" class="btn print-sector" data-sector="' + esc(s.id) +
          '">Download PDF</button>' +
        "</summary>" +
        '<div class="sector-body">' +
          "<p>" + esc(s.description) + "</p>" +
          '<dl class="sector-notes">' +
            "<dt>Approach</dt><dd>" + esc(s.approach) + "</dd>" +
            "<dt>Parking</dt><dd>" + esc(s.parking) + "</dd>" +
            "<dt>Coordinates</dt><dd class=\"coords\">" + coords +
              ' <a href="' + esc(s.mapUrl) + '" rel="noopener">Open in maps</a></dd>' +
          "</dl>" +
          s.boulders.map(function (b) { return boulderHtml(s, b); }).join("") +
        "</div></details>";
    }).join("");
  }

  function renderFooter(meta) {
    var updated = new Date(meta.updated || meta.version);
    var pretty = isNaN(updated) ? meta.version : updated.toLocaleDateString("en-GB",
      { day: "numeric", month: "long", year: "numeric" });
    $("#footer-meta").textContent = "Data version " + meta.version + ". Last updated " + pretty + ".";
  }

  /* ------------------------------------------------------------------ catalog */

  function buildGradeOptions() {
    var seen = {};
    var list = state.climbs.map(function (row) {
      return state.scale === "font" ? row.climb.gradeFont : row.climb.gradeV;
    }).filter(function (g) {
      if (seen[g]) return false;
      seen[g] = true;
      return true;
    });

    var scale = state.scale === "font" ? FONT_SCALE : V_SCALE;
    list.sort(function (a, b) { return scale.indexOf(a) - scale.indexOf(b); });
    state.gradeOptions = list;

    ["#f-grade-from", "#f-grade-to"].forEach(function (sel) {
      $(sel).innerHTML = '<option value="-1">Any</option>' + list.map(function (g) {
        return '<option value="' + scale.indexOf(g) + '">' + esc(g) + "</option>";
      }).join("");
      $(sel).value = "-1";
    });
    state.filters.from = -1;
    state.filters.to = -1;
  }

  function buildSectorOptions() {
    $("#f-sector").innerHTML = '<option value="all">All</option>' +
      state.data.sectors.map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.name) + "</option>";
      }).join("");
  }

  function filteredRows() {
    var f = state.filters;
    var needle = f.name.trim().toLowerCase();

    var rows = state.climbs.filter(function (row) {
      var c = row.climb;
      if (needle && c.name.toLowerCase().indexOf(needle) === -1) return false;
      if (f.sector !== "all" && row.sectorId !== f.sector) return false;
      if (f.stars && c.stars < f.stars) return false;
      var idx = gradeIndex(c);
      if (f.from > -1 && idx < f.from) return false;
      if (f.to > -1 && idx > f.to) return false;
      return true;
    });

    if (state.sort !== "default") {
      var dir = state.sort === "asc" ? 1 : -1;
      rows = rows.slice().sort(function (a, b) {
        var d = gradeIndex(a.climb) - gradeIndex(b.climb);
        return d !== 0 ? d * dir : a.order - b.order;
      });
    }
    return rows;
  }

  function renderCatalog() {
    var rows = filteredRows();
    var body = $("#catalog-body");

    body.innerHTML = rows.map(function (row) {
      var c = row.climb;
      return "<tr>" +
        '<td data-label="Name">' + esc(c.name) + "</td>" +
        '<td data-label="Grade">' + gradeHtml(c) + "</td>" +
        '<td data-label="Stars">' + starsHtml(c.stars) + "</td>" +
        '<td data-label="Sector">' + esc(row.sectorName) + "</td>" +
        '<td data-label="Boulder">' + esc(row.boulderName) + "</td>" +
        "</tr>";
    }).join("");

    $("#result-count").textContent = rows.length === 1 ? "1 problem" : rows.length + " problems";
    $("#no-results").hidden = rows.length > 0;
    $("#catalog-table").hidden = rows.length === 0;

    var mark = state.sort === "asc" ? "↑" : state.sort === "desc" ? "↓" : "";
    $(".sort-mark").textContent = mark;
    $("#th-grade").setAttribute("aria-sort",
      state.sort === "asc" ? "ascending" : state.sort === "desc" ? "descending" : "none");
  }

  function wireCatalog() {
    $("#f-name").addEventListener("input", function (e) {
      state.filters.name = e.target.value;
      renderCatalog();
    });
    $("#f-grade-from").addEventListener("change", function (e) {
      state.filters.from = parseInt(e.target.value, 10);
      renderCatalog();
    });
    $("#f-grade-to").addEventListener("change", function (e) {
      state.filters.to = parseInt(e.target.value, 10);
      renderCatalog();
    });
    $("#f-sector").addEventListener("change", function (e) {
      state.filters.sector = e.target.value;
      renderCatalog();
    });
    $("#f-stars").addEventListener("change", function (e) {
      state.filters.stars = parseInt(e.target.value, 10);
      renderCatalog();
    });
    $("#f-clear").addEventListener("click", function () {
      state.filters = { name: "", from: -1, to: -1, sector: "all", stars: 0 };
      $("#f-name").value = "";
      $("#f-grade-from").value = "-1";
      $("#f-grade-to").value = "-1";
      $("#f-sector").value = "all";
      $("#f-stars").value = "0";
      renderCatalog();
    });
    $("#sort-grade").addEventListener("click", function () {
      state.sort = state.sort === "default" ? "asc" : state.sort === "asc" ? "desc" : "default";
      renderCatalog();
    });
  }

  /* ------------------------------------------------------------------ grade toggle */

  function setScale(scale) {
    state.scale = scale;
    document.body.classList.toggle("grade-font", scale === "font");
    document.body.classList.toggle("grade-v", scale === "v");

    $("#scale-font").classList.toggle("is-active", scale === "font");
    $("#scale-v").classList.toggle("is-active", scale === "v");
    $("#scale-font").setAttribute("aria-pressed", String(scale === "font"));
    $("#scale-v").setAttribute("aria-pressed", String(scale === "v"));

    try { localStorage.setItem("mb-scale", scale); } catch (e) { /* private mode */ }

    buildGradeOptions();   // grade filters follow the active scale, and reset
    renderCatalog();
  }

  function wireScaleToggle() {
    $("#scale-font").addEventListener("click", function () { setScale("font"); });
    $("#scale-v").addEventListener("click", function () { setScale("v"); });
  }

  /* ------------------------------------------------------------------ anchors */

  function revealTarget(hash) {
    if (!hash || hash.length < 2) return;
    var el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) return;

    var parent = el.closest("details");
    while (parent) {
      parent.open = true;
      parent = parent.parentElement ? parent.parentElement.closest("details") : null;
    }

    requestAnimationFrame(function () {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.remove("target-flash");
      void el.offsetWidth;
      el.classList.add("target-flash");
    });
  }

  function wireCopyLinks() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".copy-link");
      if (!btn) return;

      var url = location.origin + location.pathname + "#" + btn.dataset.anchor;
      var done = function () {
        var prev = btn.textContent;
        btn.textContent = "copied";
        setTimeout(function () { btn.textContent = prev; }, 1600);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { window.prompt("Copy this link:", url); });
      } else {
        window.prompt("Copy this link:", url);
      }
    });
  }

  /* ------------------------------------------------------------------ lightbox */

  function findImage(key) {
    var parts = key.split(":");
    if (parts[0] === "topo") {
      var id = parts[1];
      var found = null;
      state.data.sectors.forEach(function (s) {
        s.boulders.forEach(function (b) {
          if (s.id + "--" + b.id === id) found = b.topo;
        });
      });
      return found;
    }
    var anchor = parts[0], i = parseInt(parts[1], 10), photo = null;
    state.data.sectors.forEach(function (s) {
      s.boulders.forEach(function (b) {
        b.climbs.forEach(function (c) {
          if (c._anchor === anchor && c.photos) photo = c.photos[i];
        });
      });
    });
    return photo;
  }

  function openLightbox(img) {
    if (!img) return;
    state.lastFocus = document.activeElement;
    $("#lb-stage").innerHTML = mediaHtml(img);
    $("#lb-caption").textContent = [img.alt, img.credit].filter(Boolean).join(" — ");
    $("#lightbox").hidden = false;
    document.body.style.overflow = "hidden";
    $("#lb-close").focus();
  }

  function closeLightbox() {
    $("#lightbox").hidden = true;
    $("#lb-stage").innerHTML = "";
    document.body.style.overflow = "";
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  function wireLightbox() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".topo-btn");
      if (btn) {
        e.preventDefault();
        openLightbox(findImage(btn.dataset.img));
        return;
      }
      if (e.target.id === "lb-close" || e.target.id === "lightbox") closeLightbox();
    });

    document.addEventListener("keydown", function (e) {
      if ($("#lightbox").hidden) return;
      if (e.key === "Escape") { closeLightbox(); return; }
      if (e.key === "Tab") { e.preventDefault(); $("#lb-close").focus(); }  // focus stays trapped
    });
  }

  /* ------------------------------------------------------------------ print */

  function runPrint(target) {
    var sectors = Array.prototype.slice.call(document.querySelectorAll("details.sector"));
    var previous = sectors.map(function (d) { return d.open; });
    var previousTitle = document.title;

    var first = true;
    sectors.forEach(function (d) {
      var hit = target === "all" || d.id === target;
      d.classList.toggle("print-target", hit);
      d.classList.toggle("print-first", hit && first);
      if (hit) { d.open = true; first = false; }
    });

    var name = target === "all" ? "Full Guide" : (function () {
      var s = state.data.sectors.filter(function (x) { return x.id === target; })[0];
      return s ? s.name : target;
    })();

    document.body.dataset.printSector = target;
    document.title = "Malta Bouldering — " + name;
    $("#print-footer").textContent = name + " — data version " + state.data.meta.version;

    var restore = function () {
      document.title = previousTitle;
      delete document.body.dataset.printSector;
      sectors.forEach(function (d, i) {
        d.open = previous[i];
        d.classList.remove("print-target");
        d.classList.remove("print-first");
      });
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);

    window.print();
  }

  function wirePrint() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest(".print-sector");
      if (btn) {
        e.preventDefault();     // keeps the <summary> from toggling
        e.stopPropagation();
        runPrint(btn.dataset.sector);
      }
    });
    $("#print-all").addEventListener("click", function () { runPrint("all"); });
  }

  /* ------------------------------------------------------------------ service worker */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("sw.js").then(function (reg) {
      reg.addEventListener("updatefound", function () {
        var incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener("statechange", function () {
          if (incoming.state === "installed" && navigator.serviceWorker.controller) {
            $("#update-bar").hidden = false;
            $("#update-reload").onclick = function () {
              incoming.postMessage({ type: "SKIP_WAITING" });
            };
          }
        });
      });
    }).catch(function (err) { console.warn("Service worker registration failed:", err); });

    var reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  /* ------------------------------------------------------------------ boot */

  function start(data) {
    state.data = data;
    document.title = data.meta.title;

    buildModel(data);
    renderHero(data.meta);
    renderContact(data.meta);
    renderIndex(data.sectors);
    renderSectors(data.sectors);
    renderFooter(data.meta);

    buildSectorOptions();

    var saved = null;
    try { saved = localStorage.getItem("mb-scale"); } catch (e) { /* private mode */ }
    setScale(saved === "v" ? "v" : "font");

    wireScaleToggle();
    wireCatalog();
    wireCopyLinks();
    wireLightbox();
    wirePrint();

    revealTarget(location.hash);
    window.addEventListener("hashchange", function () { revealTarget(location.hash); });

    registerServiceWorker();
  }

  fetch(CONFIG.dataUrl, { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(start)
    .catch(function (err) {
      console.error("Could not load guide data:", err);
      $("#load-error").hidden = false;
      $("#sector-index").hidden = true;
      $("#catalog").hidden = true;
    });
})();
