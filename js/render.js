/* Malta Bouldering — rendering.
   Pure HTML-string builders, no DOM access and no page state, so the editor's
   preview pane can call exactly the same code the site does. app.js owns the
   page; this file only ever turns data into markup. */

import { slugify } from "../shared/schema.js";
import { FONT_SCALE, V_SCALE, gradeBand } from "../shared/grades.js";

/* Swap to false once real topos and photos are in /images/.
   true renders baby-blue placeholder boxes carrying the alt text. */
export const options = { placeholderImages: true };

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------ model */

/* Stamps the derived fields the renderers read (_slug, _anchor, _number,
   _fontIdx, _vIdx, sector._count) and returns the flat climb list in sector
   then array order — the catalog's default sort. Safe to re-run: the editor
   calls it on every keystroke. */
export function decorate(data) {
  var rows = [];

  (data.sectors || []).forEach(function (sector) {
    sector._count = 0;

    (sector.boulders || []).forEach(function (boulder) {
      var seen = {};

      (boulder.climbs || []).forEach(function (climb, i) {
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
          // A blank grade is a half-written entry, which the editor already
          // reports as a validation error. Only shout about a real typo.
          if (climb.gradeFont || climb.gradeV) {
            console.warn("Unknown grade on \"" + climb.name + "\": " +
              climb.gradeFont + " / " + climb.gradeV);
          }
          if (climb._fontIdx < 0) climb._fontIdx = FONT_SCALE.length;
          if (climb._vIdx < 0) climb._vIdx = V_SCALE.length;
        }

        sector._count++;
        rows.push({
          climb: climb,
          sectorId: sector.id,
          sectorName: sector.name,
          boulderName: boulder.name,
          order: rows.length
        });
      });
    });
  });

  return rows;
}

/* ------------------------------------------------------------------ pieces */

export function starsHtml(n) {
  var out = "";
  for (var i = 1; i <= 3; i++) {
    out += '<span class="' + (i <= n ? "on" : "off") + '">' + (i <= n ? "★" : "☆") + "</span>";
  }
  return '<span class="stars" aria-label="' + Number(n || 0) + ' of 3 stars">' + out + "</span>";
}

export function gradeHtml(climb) {
  var fontIdx = climb._fontIdx == null ? FONT_SCALE.indexOf(climb.gradeFont) : climb._fontIdx;
  return '<span class="grade ' + gradeBand(fontIdx) + '">' +
    '<span class="g-font">' + esc(climb.gradeFont) + "</span>" +
    '<span class="g-v">' + esc(climb.gradeV) + "</span>" +
    "</span>";
}

export function mediaHtml(img, cls) {
  if (!img || !img.src) return "";
  if (options.placeholderImages) {
    return '<div class="ph-box ' + (cls || "") + '"><span>' + esc(img.alt) + "</span></div>";
  }
  return '<img src="' + esc(img.src) + '" alt="' + esc(img.alt) + '" loading="lazy">';
}

/* ------------------------------------------------------------------ nodes */

export function climbHtml(climb) {
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
        "<figcaption>" + esc(p.credit) + "</figcaption></figure>";
    }).join("") + "</div>";
  }

  return html + "</div></li>";
}

export function boulderHtml(sector, boulder) {
  var html = '<section class="boulder" id="' + esc(sector.id + "--" + boulder.id) + '">' +
    "<h3>" + esc(boulder.name) + "</h3>";

  if (boulder.description) html += "<p>" + esc(boulder.description) + "</p>";

  if (boulder.topo && boulder.topo.src) {
    html += '<figure><button type="button" class="topo-btn" data-img="topo:' +
      esc(sector.id + "--" + boulder.id) + '">' + mediaHtml(boulder.topo) + "</button>" +
      "<figcaption>" + esc(boulder.topo.credit) + "</figcaption></figure>";
  }

  html += '<ol class="climbs">' + (boulder.climbs || []).map(climbHtml).join("") + "</ol>";
  return html + "</section>";
}

export function sectorHtml(sector) {
  var hasCoords = sector.coords &&
    typeof sector.coords.lat === "number" && typeof sector.coords.lng === "number";
  var coords = hasCoords
    ? sector.coords.lat.toFixed(4) + ", " + sector.coords.lng.toFixed(4)
    : "—";

  return '<details class="sector" id="' + esc(sector.id) + '">' +
    "<summary>" +
      '<span class="sector-name">' + esc(sector.name) + "</span>" +
      '<span class="sector-count">' + sector._count + " problems</span>" +
      '<button type="button" class="btn print-sector" data-sector="' + esc(sector.id) +
      '">Download PDF</button>' +
    "</summary>" +
    '<div class="sector-body">' +
      "<p>" + esc(sector.description) + "</p>" +
      '<dl class="sector-notes">' +
        "<dt>Approach</dt><dd>" + esc(sector.approach) + "</dd>" +
        "<dt>Parking</dt><dd>" + esc(sector.parking) + "</dd>" +
        '<dt>Coordinates</dt><dd class="coords">' + coords +
          (sector.mapUrl ? ' <a href="' + esc(sector.mapUrl) + '" rel="noopener">Open in maps</a>' : "") +
        "</dd>" +
      "</dl>" +
      (sector.boulders || []).map(function (b) { return boulderHtml(sector, b); }).join("") +
    "</div></details>";
}
