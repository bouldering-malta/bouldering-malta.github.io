/* Malta Bouldering — data schema.
   Single source of truth for the shape of data.json. The editor generates its
   forms by iterating this; the site renderer takes field order and optionality
   from it; validation and JSON serialisation both run off it.

   Adding a field is a one-line change here. */

import { FONT_SCALE, V_SCALE } from "./grades.js";

export const SCHEMA = {
  sector: {
    label: "Sector",
    childKey: "boulders",
    childType: "boulder",
    fields: {
      id:          { type: "slug",     required: true,  from: "name", pinned: true },
      name:        { type: "text",     required: true,  label: "Sector name" },
      description: { type: "textarea", required: true },
      approach:    { type: "textarea", required: true },
      parking:     { type: "textarea", required: true },
      coords:      { type: "coords",   required: false },
      mapUrl:      { type: "url",      required: false, label: "Map link",
                     derivedFrom: "coords",
                     hint: "Paste a Google Maps link, including a short maps.app.goo.gl one. Filled in from the coordinates if you leave it blank." }
    }
  },
  boulder: {
    label: "Boulder",
    childKey: "climbs",
    childType: "climb",
    fields: {
      id:          { type: "slug",     required: true, from: "name", pinned: true },
      name:        { type: "text",     required: true },
      description: { type: "textarea", required: true },
      topos:       { type: "imageList", required: false, label: "Topos",
                     rowFields: {
                       startsAt: {
                         type: "number", label: "First problem on this topo",
                         min: 1, ascending: true, withinChildren: true
                       }
                     } }
    }
  },
  climb: {
    label: "Climb",
    fields: {
      name:        { type: "text",      required: true },
      slug:        { type: "slug",      required: true, from: "name", pinned: true },
      project:     { type: "boolean",   required: false, label: "Project (not yet sent)",
                     hint: "An open project has no grade until someone sends it." },
      gradeFont:   { type: "grade",     required: true, scale: "font",
                     exceptWhen: "project" },
      gradeV:      { type: "grade",     required: true, scale: "v", derived: "gradeFont",
                     exceptWhen: "project" },
      stars:       { type: "stars",     required: true, min: 0, max: 3 },
      start:       { type: "enum",      required: true, values: ["sit", "stand"] },
      description: { type: "textarea",  required: false },
      fa:          { type: "group",     required: false,
                     fields: { name: { type: "text" }, year: { type: "year" } } },
      photos:      { type: "imageList", required: false }
    }
  }
};

/* Order of the top-level meta block, so saves stay diff-stable. */
export const META_FIELDS = ["title", "contactEmail", "version", "updated", "githubRepo", "hero"];

export const IMAGE_FIELDS = ["src", "alt", "credit"];

/* Malta's bounding box, generously drawn. Outside it is a warning, not an
   error: a typo in the third decimal place is a very different mistake from
   swapping lat and lng, and only the second is worth blocking a save over. */
export const MALTA_BOUNDS = { minLat: 35.75, maxLat: 36.15, minLng: 14.10, maxLng: 14.65 };

export const MIN_DESCRIPTION = 20;

/* ------------------------------------------------------------------ slugs */

var LETTER_MAP = { "ħ": "h", "ġ": "g", "ż": "z", "ċ": "c", "ø": "o", "đ": "d",
  "ł": "l", "æ": "ae", "œ": "oe", "ß": "ss" };

/* The site resolves anchors with this exact function, so a slug the editor
   pins and a slug the site derives can never drift apart. Both import it. */
export function slugify(s) {
  return String(s == null ? "" : s).toLowerCase()
    .replace(/[ħġżċøđłæœß]/g, function (c) { return LETTER_MAP[c]; })
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isCleanSlug(s) {
  return typeof s === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}

/* Sectors and boulders are identified by `id`, climbs by `slug`. Nothing else
   about them differs, so this keeps the tree, validation and anchor code from
   special-casing climbs at every turn. */
export function keyField(type) {
  return type === "climb" ? "slug" : "id";
}

export function childKey(type) {
  return SCHEMA[type].childKey || null;
}

export function childType(type) {
  return SCHEMA[type].childType || null;
}

export function fieldList(type) {
  return Object.keys(SCHEMA[type].fields).map(function (name) {
    return { name: name, spec: SCHEMA[type].fields[name] };
  });
}

/* A field with `exceptWhen` drops out entirely while that flag is set on the
   node — the grades of a project being the case this exists for. */
export function fieldApplies(spec, node) {
  return !spec.exceptWhen || !node[spec.exceptWhen];
}

/* "Topos" -> "Topo". Used for the rows of an imageList and its messages. */
export function singularLabel(type, name) {
  return labelFor(type, name).replace(/s$/, "");
}

export function labelFor(type, name) {
  var spec = SCHEMA[type].fields[name];
  if (spec && spec.label) return spec.label;
  var words = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ------------------------------------------------------------------ helpers */

function isFiniteNumber(n) {
  return typeof n === "number" && isFinite(n);
}

function blank(v) {
  return v == null || String(v).trim() === "";
}

export function blankNode(type) {
  var node = {};
  fieldList(type).forEach(function (f) {
    if (f.spec.type === "coords") node[f.name] = { lat: null, lng: null };
    else if (f.spec.type === "image") node[f.name] = { src: "", alt: "", credit: "" };
    else if (f.spec.type === "stars") node[f.name] = 0;
    else if (f.spec.type === "enum") node[f.name] = f.spec.values[0];
    else if (f.spec.type === "group" || f.spec.type === "imageList") { /* omitted until used */ }
    else if (f.spec.type === "boolean") { /* omitted: absent means false */ }
    else node[f.name] = "";
  });
  var ck = childKey(type);
  if (ck) node[ck] = [];
  return node;
}

export function mapUrlFor(coords) {
  if (!coords || !isFiniteNumber(coords.lat) || !isFiniteNumber(coords.lng)) return "";
  return "https://maps.google.com/?q=" + coords.lat + "," + coords.lng;
}

/* Accepts anything you can copy out of Google Maps: a place URL with an
   @lat,lng,zoom segment, a share URL with ?q=, or a bare "35.8206, 14.5461". */
export function parseCoords(input) {
  var text = String(input == null ? "" : input).trim();
  if (!text) return null;

  var at = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };

  var q = text.match(/[?&](?:q|ll|daddr|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };

  var bare = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (bare) return { lat: parseFloat(bare[1]), lng: parseFloat(bare[2]) };

  return null;
}

/* Files written before a boulder could carry more than one topo have a single
   `topo` object. Fold it into the list so there is one shape to reason about. */
export function migrate(data) {
  (data.sectors || []).forEach(function (sector) {
    (sector.boulders || []).forEach(function (boulder) {
      if (boulder.topo && !boulder.topos) boulder.topos = [boulder.topo];
      delete boulder.topo;
    });
  });
  return data;
}

/* ------------------------------------------------------------------ validation */

/* Returns a flat list of { level, type, key, field, message }.
   level "error" blocks the write to disk; level "warning" never does. */
export function validateNode(type, node, siblings) {
  var out = [];
  var kf = keyField(type);
  var self = node[kf];

  var push = function (level, field, message) {
    out.push({ level: level, type: type, key: self || node.name || "(unnamed)",
      field: field, message: message });
  };

  fieldList(type).forEach(function (f) {
    var name = f.name, spec = f.spec, value = node[name];

    if (!fieldApplies(spec, node)) return;

    switch (spec.type) {
      case "slug":
        if (blank(value)) { push("error", name, labelFor(type, name) + " is required."); break; }
        if (!isCleanSlug(value)) {
          push("error", name,
            "Must be lowercase ASCII, hyphen separated — no spaces, accents or trailing hyphens.");
        }
        if (siblings && siblings.filter(function (s) { return s !== node && s[kf] === value; }).length) {
          push("error", name, "Duplicate value — must be unique among its siblings.");
        }
        break;

      case "text":
      case "textarea":
        if (spec.required && blank(value)) push("error", name, labelFor(type, name) + " is required.");
        if (type === "climb" && name === "description" && !blank(value) &&
            String(value).trim().length < MIN_DESCRIPTION) {
          push("warning", name, "Very short description — under " + MIN_DESCRIPTION + " characters.");
        }
        break;

      case "grade": {
        var scale = spec.scale === "font" ? FONT_SCALE : V_SCALE;
        if (blank(value)) { push("error", name, labelFor(type, name) + " is required."); break; }
        if (scale.indexOf(value) === -1) {
          push("error", name, "Not on the " + (spec.scale === "font" ? "Font" : "V") + " scale.");
        }
        break;
      }

      case "stars":
        if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
          push("error", name, "Stars must be a whole number from " + spec.min + " to " + spec.max + ".");
        }
        break;

      case "enum":
        if (spec.values.indexOf(value) === -1) {
          push("error", name, "Must be one of: " + spec.values.join(", ") + ".");
        }
        break;

      case "coords": {
        var hasLat = value && isFiniteNumber(value.lat);
        var hasLng = value && isFiniteNumber(value.lng);

        if (!hasLat && !hasLng) {
          if (spec.required) push("error", name, "Latitude and longitude are both required.");
          break;                       // optional and empty: nothing to check
        }
        if (!hasLat || !hasLng) {
          push("error", name, "Give both latitude and longitude, or neither.");
        } else if (value.lat < -90 || value.lat > 90 || value.lng < -180 || value.lng > 180) {
          push("error", name, "Not a valid latitude/longitude pair.");
        } else if (value.lat < MALTA_BOUNDS.minLat || value.lat > MALTA_BOUNDS.maxLat ||
                   value.lng < MALTA_BOUNDS.minLng || value.lng > MALTA_BOUNDS.maxLng) {
          push("warning", name, "These coordinates fall outside Malta — check lat and lng are the right way round.");
        }
        break;
      }

      case "image":
        if (spec.required && (!value || blank(value.src))) {
          push("error", name, labelFor(type, name) + " image path is required.");
        }
        if (value && !blank(value.src) && blank(value.alt)) {
          push("error", name, "Alt text is required — it is what screen readers and the placeholder box show.");
        }
        if (value && !blank(value.src) && blank(value.credit)) {
          push("warning", name, "No photo credit.");
        }
        break;

      case "imageList": {
        var one = singularLabel(type, name);
        if (spec.required && (!value || !value.length)) {
          push("error", name, "At least one " + one.toLowerCase() + " is required.");
        }
        (value || []).forEach(function (img, i) {
          if (blank(img.src)) push("error", name, one + " " + (i + 1) + " has no path.");
          if (blank(img.alt)) push("error", name, one + " " + (i + 1) + " has no alt text.");
          if (blank(img.credit)) push("warning", name, one + " " + (i + 1) + " has no credit.");
        });

        Object.keys(spec.rowFields || {}).forEach(function (rowName) {
          var rf = spec.rowFields[rowName];
          var childCount = (node[childKey(type)] || []).length;
          var previous = null;

          (value || []).forEach(function (img, i) {
            var label = one + " " + (i + 1) + ": " + rf.label.toLowerCase();
            if (blank(img[rowName])) return;

            var n = Number(img[rowName]);
            if (!Number.isInteger(n) || (rf.min !== undefined && n < rf.min)) {
              push("error", name, label + " must be a whole number of at least " + rf.min + ".");
              return;
            }
            if (rf.ascending && previous !== null && n <= previous) {
              push("error", name, label + " must come after the previous " +
                one.toLowerCase() + " (" + previous + ").");
            }
            if (rf.withinChildren && childCount && n > childCount) {
              push("warning", name, label + " is " + n + ", but there are only " +
                childCount + " problems on this boulder.");
            }
            previous = n;
          });
        });
        break;
      }

      case "group":
        if (value) {
          var keys = Object.keys(spec.fields);
          var filled = keys.filter(function (k) { return !blank(value[k]); });
          if (filled.length && filled.length < keys.length) {
            push("error", name, "Fill in every part of " + labelFor(type, name) + ", or clear it entirely.");
          }
          if (!blank(value.year)) {
            var year = Number(value.year);
            var thisYear = new Date().getFullYear();
            if (!Number.isInteger(year) || year < 1900 || year > thisYear) {
              push("error", name, "Year must be between 1900 and " + thisYear + ".");
            }
          }
        }
        break;

      case "boolean":
        if (value === undefined || value === null || value === "") break;   // unset
        if (typeof value !== "boolean") {
          push("error", name, labelFor(type, name) + " must be true or false.");
        }
        break;

      case "url":
        if (blank(value)) break;
        if (!/^https?:\/\/\S+$/i.test(String(value).trim())) {
          push("error", name, labelFor(type, name) + " must be a full http:// or https:// link.");
        }
        break;

      default:
        break;
    }
  });

  if (type === "boulder" && (!node.topos || !node.topos.length)) {
    push("warning", "topos", "No topo yet — the problems will list without one.");
  }

  /* A sector nobody can find is worth flagging, though not worth blocking. */
  if (type === "sector") {
    var located = (node.coords && isFiniteNumber(node.coords.lat) && isFiniteNumber(node.coords.lng)) ||
      !blank(node.mapUrl);
    if (!located) push("warning", "mapUrl", "No coordinates and no map link — nothing to navigate by.");
  }

  /* An empty container is legal but is almost always a half-finished edit. */
  var ck = childKey(type);
  if (ck && (!node[ck] || !node[ck].length)) {
    push("warning", ck, SCHEMA[type].label + " has no " + ck + " yet.");
  }

  return out;
}

/* Walks the whole file. Every issue carries the tree path of the node it came
   from, so the sidebar can mark the offenders and the error list can jump. */
export function validateData(data) {
  var all = [];

  var visit = function (type, node, siblings, path) {
    validateNode(type, node, siblings).forEach(function (issue) {
      issue.path = path;
      all.push(issue);
    });
    var ck = childKey(type), ct = childType(type);
    if (ck && node[ck]) {
      node[ck].forEach(function (child, i) {
        visit(ct, child, node[ck], path.concat(i));
      });
    }
  };

  (data.sectors || []).forEach(function (sector, i) {
    visit("sector", sector, data.sectors, [i]);
  });

  var byPath = {};
  all.forEach(function (issue) {
    var k = issue.path.join(".");
    (byPath[k] = byPath[k] || []).push(issue);
  });

  return {
    issues: all,
    errors: all.filter(function (i) { return i.level === "error"; }),
    warnings: all.filter(function (i) { return i.level === "warning"; }),
    byPath: byPath
  };
}

/* ------------------------------------------------------------------ serialisation */

/* Rebuilds the file from the schema so key order is fixed, optional empties are
   dropped rather than written as "", and git diffs stay readable. */
export function serializeData(data) {
  var meta = {};
  META_FIELDS.forEach(function (k) {
    if (data.meta[k] !== undefined) meta[k] = data.meta[k];
  });
  Object.keys(data.meta).forEach(function (k) {
    if (meta[k] === undefined) meta[k] = data.meta[k];
  });

  return {
    meta: meta,
    sectors: (data.sectors || []).map(function (s) { return serializeNode("sector", s); })
  };
}

function serializeNode(type, node) {
  var out = {};

  fieldList(type).forEach(function (f) {
    var name = f.name, spec = f.spec, value = node[name];

    // Grades of a project are not written at all, so the file never carries a
    // grade the site refuses to show.
    if (!fieldApplies(spec, node)) return;

    switch (spec.type) {
      case "coords":
        if (value && isFiniteNumber(value.lat) && isFiniteNumber(value.lng)) {
          out[name] = { lat: value.lat, lng: value.lng };
        }
        break;

      case "url":
        if (!blank(value)) out[name] = String(value).trim();
        else if (spec.derivedFrom === "coords") {
          var url = mapUrlFor(node.coords);
          if (url) out[name] = url;
        }
        break;

      case "image":
        if (value && !blank(value.src)) out[name] = pickImage(value);
        break;

      case "imageList":
        if (value && value.length) {
          out[name] = value.map(function (img) { return pickImage(img, spec); });
        }
        break;

      case "group": {
        if (!value) break;
        var keys = Object.keys(spec.fields);
        if (!keys.filter(function (k) { return !blank(value[k]); }).length) break;
        var group = {};
        keys.forEach(function (k) {
          group[k] = spec.fields[k].type === "year" ? Number(value[k]) : value[k];
        });
        out[name] = group;
        break;
      }

      case "stars":
        out[name] = Number(value) || 0;
        break;

      case "boolean":
        if (value) out[name] = true;   // false is the default; omit it
        break;

      default:
        if (spec.required || !blank(value)) out[name] = value;
    }
  });

  var ck = childKey(type), ct = childType(type);
  if (ck) {
    out[ck] = (node[ck] || []).map(function (child) { return serializeNode(ct, child); });
  }

  return out;
}

function pickImage(img, spec) {
  var out = {};
  IMAGE_FIELDS.forEach(function (k) {
    if (!blank(img[k])) out[k] = img[k];
  });
  Object.keys((spec && spec.rowFields) || {}).forEach(function (k) {
    if (blank(img[k])) return;
    var rf = spec.rowFields[k];
    out[k] = rf.type === "number" ? Number(img[k]) : img[k];
  });
  return out;
}

/* Two-space indented with a trailing newline — matches what the repo has. */
export function toJson(data) {
  return JSON.stringify(serializeData(data), null, 2) + "\n";
}
