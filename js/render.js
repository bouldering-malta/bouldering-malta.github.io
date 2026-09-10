/* Malta Bouldering — rendering.
   Pure HTML-string builders, no DOM access and no page state, so the editor's
   preview pane can call exactly the same code the site does. app.js owns the
   page; this file only ever turns data into markup. */

import { slugify } from "../shared/schema.js";
import { FONT_SCALE, V_SCALE, gradeBand } from "../shared/grades.js";

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
          // A project has no grade by definition, and a blank grade elsewhere
          // is a half-written entry the editor already flags. Only shout about
          // a real typo.
          if (!climb.project && (climb.gradeFont || climb.gradeV)) {
            console.warn("Unknown grade on \"" + climb.name + "\": " +
              climb.gradeFont + " / " + climb.gradeV);
          }
          // Ungraded sorts to the end of the ladder in either direction.
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
  /* An open project has no grade, so it shows ??? in the grade's place rather
     than an empty column. The label spells it out, because three question
     marks read as nothing at all to a screen reader. */
  if (climb.project) {
    return '<span class="grade grade-project" aria-label="Project, ungraded">???</span>';
  }

  var fontIdx = climb._fontIdx == null ? FONT_SCALE.indexOf(climb.gradeFont) : climb._fontIdx;
  return '<span class="grade ' + gradeBand(fontIdx) + '">' +
    '<span class="g-font">' + esc(climb.gradeFont) + "</span>" +
    '<span class="g-v">' + esc(climb.gradeV) + "</span>" +
    "</span>";
}

/* A file that fails to load falls back to its own alt text in a plain outlined
   box (see img.is-missing in style.css) rather than the browser's broken-image
   glyph, so a not-yet-added topo still reads as something deliberate.

   The is-missing class is applied by watchBrokenImages() rather than an inline
   onerror, which does not reliably fire for markup inserted via innerHTML. */
export function mediaHtml(img, cls) {
  if (!img || !img.src) return "";
  return '<img' + (cls ? ' class="' + cls + '"' : "") +
    ' src="' + esc(img.src) + '" alt="' + esc(img.alt) + '" loading="lazy">';
}

/* Error events do not bubble, but they do fire on the way down, so one
   capturing listener catches every image in the document — including ones
   rendered long after this runs. */
export function watchBrokenImages(doc) {
  doc.addEventListener("error", function (e) {
    var el = e.target;
    if (el && el.tagName === "IMG") el.classList.add("is-missing");
  }, true);
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

export function topoList(boulder) {
  var list = boulder.topos || (boulder.topo ? [boulder.topo] : []);
  return list.filter(function (t) { return t && t.src; });
}

/* Splits a boulder into topo-then-its-problems blocks.

   A long wall needs more than one photo, and a topo is only useful next to the
   problems it actually shows. Each topo carries `startsAt`, the problem number
   its coverage begins at, so topo 1 (problems 1-10) renders above problems
   1-10 and topo 2 (11-20) above problems 11-20.

   A topo with no usable startsAt inherits the previous one's, which stacks the
   two together — so a file that sets none at all behaves exactly as before,
   with every topo up front. */
export function topoSegments(boulder) {
  var topos = topoList(boulder);
  var climbs = boulder.climbs || [];

  if (!topos.length) {
    return climbs.length ? [{ topos: [], climbs: climbs, start: 1 }] : [];
  }

  var starts = topos.map(function (topo, i) {
    var n = parseInt(topo.startsAt, 10);
    return (isFinite(n) && n >= 1) ? n : (i === 0 ? 1 : null);
  });
  for (var i = 1; i < starts.length; i++) {
    if (starts[i] === null || starts[i] < starts[i - 1]) starts[i] = starts[i - 1];
  }

  // Topos sharing a start belong to one block and stack above the same problems.
  var blocks = [];
  topos.forEach(function (topo, i) {
    var last = blocks[blocks.length - 1];
    var entry = { topo: topo, index: i };
    if (last && last.start === starts[i]) last.topos.push(entry);
    else blocks.push({ start: starts[i], topos: [entry] });
  });

  var segments = [];

  // Problems numbered below the first topo's start have no topo of their own.
  if (blocks[0].start > 1) {
    segments.push({ topos: [], climbs: climbs.slice(0, blocks[0].start - 1), start: 1 });
  }

  blocks.forEach(function (block, i) {
    var next = blocks[i + 1];
    var from = Math.min(block.start - 1, climbs.length);
    var to = next ? Math.min(next.start - 1, climbs.length) : climbs.length;
    segments.push({
      topos: block.topos,
      climbs: climbs.slice(from, Math.max(from, to)),
      start: block.start
    });
  });

  return segments;
}

export function boulderHtml(sector, boulder) {
  var html = '<section class="boulder" id="' + esc(sector.id + "--" + boulder.id) + '">' +
    "<h3>" + esc(boulder.name) + "</h3>";

  if (boulder.description) html += "<p>" + esc(boulder.description) + "</p>";

  topoSegments(boulder).forEach(function (segment) {
    segment.topos.forEach(function (entry) {
      html += '<figure><button type="button" class="topo-btn" data-img="topo:' +
        esc(sector.id + "--" + boulder.id) + ":" + entry.index + '">' +
        mediaHtml(entry.topo) + "</button>" +
        "<figcaption>" + esc(entry.topo.credit) + "</figcaption></figure>";
    });

    if (segment.climbs.length) {
      html += '<ol class="climbs" start="' + segment.start + '">' +
        segment.climbs.map(climbHtml).join("") + "</ol>";
    }
  });

  return html + "</section>";
}

export function sectorHtml(sector) {
  /* Either half of the location can be missing: coordinates alone, a pasted
     map link alone, or both. A sector with neither simply has no location row
     rather than an em dash standing in for one. */
  var hasCoords = sector.coords &&
    typeof sector.coords.lat === "number" && typeof sector.coords.lng === "number";
  var link = sector.mapUrl
    ? '<a href="' + esc(sector.mapUrl) + '" rel="noopener">Open in maps</a>'
    : "";

  /* Every row of the notes list is optional, so the list is assembled rather
     than templated. A sector with none of them gets no empty <dl>. */
  var notes = [];

  if (sector.approach) notes.push("<dt>Approach</dt><dd>" + esc(sector.approach) + "</dd>");

  var parkingLink = sector.parkingUrl
    ? '<a href="' + esc(sector.parkingUrl) + '" rel="noopener">Open parking in maps</a>'
    : "";
  if (sector.parking || parkingLink) {
    notes.push("<dt>Parking</dt><dd>" + esc(sector.parking || "") +
      (sector.parking && parkingLink ? " " : "") + parkingLink + "</dd>");
  }

  if (hasCoords) {
    notes.push('<dt>Coordinates</dt><dd class="coords">' +
      sector.coords.lat.toFixed(4) + ", " + sector.coords.lng.toFixed(4) +
      (link ? " " + link : "") + "</dd>");
  } else if (link) {
    notes.push('<dt>Location</dt><dd class="coords">' + link + "</dd>");
  }

  return '<details class="sector" id="' + esc(sector.id) + '">' +
    "<summary>" +
      '<span class="sector-name">' + esc(sector.name) + "</span>" +
      '<span class="sector-count">' + sector._count + " problems</span>" +
      '<button type="button" class="btn print-sector" data-sector="' + esc(sector.id) +
      '">Download PDF</button>' +
    "</summary>" +
    '<div class="sector-body">' +
      (sector.description ? "<p>" + esc(sector.description) + "</p>" : "") +
      (notes.length ? '<dl class="sector-notes">' + notes.join("") + "</dl>" : "") +
      (sector.boulders || []).map(function (b) { return boulderHtml(sector, b); }).join("") +
    "</div></details>";
}
