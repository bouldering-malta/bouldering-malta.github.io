/* Malta Bouldering — app.js
   Renders the whole page from data/data.json. Nothing is hardcoded per sector.

   Markup generation lives in render.js, which the editor's preview pane also
   imports, so what you see while authoring is what the site renders. */

import {
  decorate, esc, gradeHtml, starsHtml, mediaHtml, sectorHtml, topoList,
  watchBrokenImages
} from "./render.js";
import { FONT_SCALE, V_SCALE } from "../shared/grades.js";

/* The placeholder-image switch lives in render.js, so the site and the
   editor's preview can never disagree about it. */
var CONFIG = { dataUrl: "data/data.json" };

var state = {
  data: null,
  climbs: [],           // flat list, in sector then array order
  scale: "font",        // "font" | "v"
  sort: "default",      // "default" | "asc" | "desc"
  filters: { name: "", from: -1, to: -1, sector: "all", stars: 0 },
  gradeOptions: [],     // grade strings in the active scale, ascending
  lastFocus: null
};

var $ = function (sel) { return document.querySelector(sel); };

function gradeIndex(climb) {
  return state.scale === "font" ? climb._fontIdx : climb._vIdx;
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
      '<span class="jump-name">' + esc(s.name) + "</span>" +
      '<span class="count">' + s._count + "</span></a></li>";
  }).join("");
}

function renderSectors(sectors) {
  $("#sectors").innerHTML = sectors.map(sectorHtml).join("");
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
    var index = parseInt(parts[2], 10) || 0;
    var found = null;
    state.data.sectors.forEach(function (s) {
      s.boulders.forEach(function (b) {
        if (s.id + "--" + b.id === id) found = topoList(b)[index];
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

/* Topos are lazy-loaded, so a sector that has never been scrolled into view has
   never fetched its images. Force-opening its <details> does not load them
   synchronously either, so printing straight away yields a PDF with the topos
   missing. Wait for them first.

   Action photos are skipped: print.css hides them, and they are the heavy ones. */
function topoImagesReady(sectors) {
  var images = [];

  sectors.forEach(function (sector) {
    if (!sector.classList.contains("print-target")) return;
    Array.prototype.forEach.call(sector.querySelectorAll("figure img"), function (img) {
      if (!img.closest(".climb-photos")) images.push(img);
    });
  });

  var loading = images.map(function (img) {
    img.loading = "eager";
    if (img.complete) return null;
    return new Promise(function (resolve) {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    });
  });

  // Never let one wedged image hold the print dialog hostage.
  return Promise.race([
    Promise.all(loading),
    new Promise(function (resolve) { setTimeout(resolve, 10000); })
  ]);
}

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

  topoImagesReady(sectors).then(function () { window.print(); });
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

/* ------------------------------------------------------------------ boot */

function start(data) {
  watchBrokenImages(document);
  state.data = data;
  document.title = data.meta.title;

  state.climbs = decorate(data);
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
