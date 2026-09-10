/* Malta Bouldering — app.js
   Renders the whole page from data/data.json. Nothing is hardcoded per sector.

   Markup generation lives in render.js, which the editor's preview pane also
   imports, so what you see while authoring is what the site renders. */

import {
  decorate, esc, gradeHtml, starsHtml, mediaHtml, sectorHtml, topoList,
  galleryHtml, groupByIsland, watchBrokenImages
} from "./render.js";
import { FONT_SCALE, V_SCALE } from "../shared/grades.js";

/* The placeholder-image switch lives in render.js, so the site and the
   editor's preview can never disagree about it. */
var CONFIG = { dataUrl: "data/data.json" };

var state = {
  data: null,
  climbs: [],           // flat list, in sector then array order
  scale: "font",        // "font" | "v"
  sort: { key: "default", dir: "asc" },   // key: default|name|grade|stars|sector|boulder
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

/* The strap under the ramp counts what the guide actually holds, so it stays
   true as sectors are added rather than being a number typed into the markup. */
function renderMastheadCount(data) {
  var problems = state.climbs.length;
  var sectors = (data.sectors || []).length;
  if (!problems) return;

  $("#masthead-count").textContent =
    problems + (problems === 1 ? " problem" : " problems") +
    " across " + sectors + (sectors === 1 ? " sector" : " sectors");
}

function renderContact(meta) {
  var mail = meta.contactEmail;
  var link = $("#contact-email");
  link.textContent = mail;
  link.href = "mailto:" + mail;
  /* The address comes from data.json, but a link may carry its own subject —
     rebuilding the href blindly would throw that away. */
  document.querySelectorAll('a[href^="mailto:"]').forEach(function (a) {
    var query = (a.getAttribute("href") || "").split("?")[1];
    a.href = "mailto:" + mail + (query ? "?" + query : "");
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

/* The jump bar follows what is on the page, so its order matches the grouped
   sectors rather than the raw file order. */
function orderedSectors(sectors) {
  return groupByIsland(sectors).reduce(function (all, group) {
    return all.concat(group.sectors);
  }, []);
}

/* The whole band stays out of the document unless there are photos, so an
   empty gallery costs nothing and shows nothing. */
function renderSiteGallery(meta) {
  var html = galleryHtml(meta.gallery, "site", "");
  var band = $("#site-gallery");

  band.hidden = !html;
  if (html) $("#site-gallery-body").innerHTML = html;
}

function renderIndex(sectors) {
  $("#sector-index-list").innerHTML = orderedSectors(sectors).map(function (s) {
    return '<li><a href="#' + esc(s.id) + '">' +
      '<span class="jump-name">' + esc(s.name) + "</span>" +
      '<span class="count">' + s._count + "</span></a></li>";
  }).join("");
}

function renderSectors(sectors) {
  var groups = groupByIsland(sectors);
  var named = groups.length > 1;      // one island needs no heading to tell them apart

  $("#sectors").innerHTML = groups.map(function (group) {
    return '<section class="island-group">' +
      (named ? '<h3 class="island-title">' + esc(group.island) + "</h3>" : "") +
      group.sectors.map(sectorHtml).join("") +
      "</section>";
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
  var list = state.climbs.filter(function (row) {
    return !row.climb.project;          // projects contribute no grade
  }).map(function (row) {
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
  var groups = groupByIsland(state.data.sectors);
  var options = function (sectors) {
    return sectors.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + "</option>";
    }).join("");
  };

  // Grouped by island so the filter reads the way the page does.
  $("#f-sector").innerHTML = '<option value="all">All</option>' +
    (groups.length > 1
      ? groups.map(function (g) {
          return '<optgroup label="' + esc(g.island) + '">' + options(g.sectors) + "</optgroup>";
        }).join("")
      : options(state.data.sectors));
}

/* One comparator per sortable column. Each returns 0 for a tie, and every sort
   falls back to guide order, so equal rows keep the order the guide lists them
   in rather than shuffling between renders. */
var COMPARE = {
  name: function (a, b) {
    return a.climb.name.localeCompare(b.climb.name, "en", { sensitivity: "base" });
  },
  sector: function (a, b) {
    return a.sectorName.localeCompare(b.sectorName, "en", { sensitivity: "base" });
  },
  boulder: function (a, b) {
    return a.boulderName.localeCompare(b.boulderName, "en", { sensitivity: "base" });
  },
  stars: function (a, b) {
    return (a.climb.stars || 0) - (b.climb.stars || 0);
  },
  grade: function (a, b) {
    return gradeIndex(a.climb) - gradeIndex(b.climb);
  }
};

function sortRows(rows) {
  var key = state.sort.key;
  if (key === "default" || !COMPARE[key]) return rows;

  var dir = state.sort.dir === "desc" ? -1 : 1;

  return rows.slice().sort(function (a, b) {
    /* Projects have no grade, so they sit after the graded climbs whichever
       way the column is sorted. Letting their index fall off the end of the
       ladder would park them at the top of a hardest-first sort, which reads
       as a claim about how hard they are. */
    if (key === "grade") {
      var ap = !!a.climb.project, bp = !!b.climb.project;
      if (ap !== bp) return ap ? 1 : -1;
      if (ap && bp) return a.order - b.order;
    }

    var d = COMPARE[key](a, b);
    return d !== 0 ? d * dir : a.order - b.order;
  });
}

function filteredRows() {
  var f = state.filters;
  var needle = f.name.trim().toLowerCase();

  var rows = state.climbs.filter(function (row) {
    var c = row.climb;
    if (needle && c.name.toLowerCase().indexOf(needle) === -1) return false;
    if (f.sector !== "all" && row.sectorId !== f.sector) return false;
    if (f.stars && c.stars < f.stars) return false;

    // A project has no grade, so it cannot satisfy a grade range. Narrowing
    // the grades filters projects out rather than showing ungraded lines
    // inside a bounded range.
    if (c.project) return f.from === -1 && f.to === -1;

    var idx = gradeIndex(c);
    if (f.from > -1 && idx < f.from) return false;
    if (f.to > -1 && idx > f.to) return false;
    return true;
  });

  return sortRows(rows);
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

  renderSortIndicators();
}

function renderSortIndicators() {
  var key = state.sort.key;
  var dir = state.sort.dir;

  document.querySelectorAll(".catalog-table th[data-sort]").forEach(function (th) {
    var active = th.dataset.sort === key;
    th.setAttribute("aria-sort", active ? (dir === "asc" ? "ascending" : "descending") : "none");
    th.classList.toggle("is-sorted", active);
    th.querySelector(".sort-mark").textContent = active ? (dir === "asc" ? "↑" : "↓") : "";
  });

  $("#f-sort").value = key === "default" ? "default" : key + ":" + dir;
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
  /* Clicking a heading cycles that column: ascending, descending, then back to
     the guide's own order. */
  document.querySelectorAll(".catalog-table th[data-sort] button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.closest("th").dataset.sort;

      if (state.sort.key !== key) state.sort = { key: key, dir: "asc" };
      else if (state.sort.dir === "asc") state.sort = { key: key, dir: "desc" };
      else state.sort = { key: "default", dir: "asc" };

      renderCatalog();
    });
  });

  $("#f-sort").addEventListener("change", function (e) {
    var parts = e.target.value.split(":");
    state.sort = parts[0] === "default"
      ? { key: "default", dir: "asc" }
      : { key: parts[0], dir: parts[1] };
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

  if (parts[0] === "site") {
    return (state.data.meta.gallery || [])[parseInt(parts[1], 10) || 0];
  }

  if (parts[0] === "gallery") {
    var sector = state.data.sectors.filter(function (s) { return s.id === parts[1]; })[0];
    return sector ? (sector.gallery || [])[parseInt(parts[2], 10) || 0] : null;
  }

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
    var btn = e.target.closest(".topo-btn, .gallery-btn");
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
      // Gallery and action photos are hidden by print.css, so waiting on them
      // would download megabytes that never reach the page.
      if (img.closest(".climb-photos") || img.closest(".gallery")) return;
      images.push(img);
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
  renderMastheadCount(data);
  renderSiteGallery(data.meta);
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
