/* Malta Bouldering — data editor.

   Local-only authoring tool for data/data.json. Chrome or Edge, served from
   localhost. Forms are generated from ../shared/schema.js and the preview pane
   calls the site's own renderer, so neither can drift from what ships.

   Autosave writes the file one second after the last change, but only while
   the data validates. When it does not, the write is suppressed and the work
   is mirrored to localStorage instead, so nothing is lost and data.json is
   never left in a broken state. */

import {
  SCHEMA, slugify, keyField, childKey, childType, fieldList, fieldApplies,
  labelFor, singularLabel, blankNode, mapUrlFor, parseCoords, migrate,
  validateData, toJson
} from "../shared/schema.js";
import { FONT_SCALE, V_SCALE, vForFont } from "../shared/grades.js";
import { decorate, boulderHtml, sectorHtml, watchBrokenImages } from "../js/render.js";

var DRAFT_KEY = "mb-editor-draft";
var IDB_NAME = "mb-editor";
var IDB_STORE = "handles";
var HANDLE_KEY = "data.json";
var SAVE_DEBOUNCE = 1000;
var PREVIEW_DEBOUNCE = 120;

var $ = function (sel) { return document.querySelector(sel); };

var state = {
  data: null,
  handle: null,
  mtime: 0,
  selection: null,        // array path: [sector] | [sector, boulder] | [sector, boulder, climb]
  expanded: new Set(),    // path keys that are open in the tree
  renumbered: new Set(),  // boulder path keys whose climbs were reordered this session
  validation: { errors: [], warnings: [], byPath: {} },
  saveTimer: null,
  previewTimer: null,
  previewReady: false
};

/* ------------------------------------------------------------------ paths */

function key(path) { return path.join("."); }

function typeAt(path) {
  return ["sector", "boulder", "climb"][path.length - 1];
}

function siblingsAt(path) {
  if (path.length === 1) return state.data.sectors;
  var parent = nodeAt(path.slice(0, -1));
  return parent[childKey(typeAt(path.slice(0, -1)))];
}

function nodeAt(path) {
  var node = { boulders: state.data.sectors };
  var type = null;
  for (var i = 0; i < path.length; i++) {
    var ck = type ? childKey(type) : "boulders";
    node = node[ck][path[i]];
    type = type ? childType(type) : "sector";
  }
  return node;
}

function labelOf(node) {
  return node.name || "(unnamed)";
}

function pathExists(path) {
  if (!path || !state.data) return false;
  try {
    return !!nodeAt(path);
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ IndexedDB */

function idb() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function idbPut(value) {
  return idb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function idbGet() {
  return idb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, "readonly");
      var req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

/* ------------------------------------------------------------------ file access */

function openFile() {
  return window.showOpenFilePicker({
    id: "mb-data",
    types: [{ description: "Guide data", accept: { "application/json": [".json"] } }],
    multiple: false
  }).then(function (handles) {
    state.handle = handles[0];
    // Remembering the handle is a convenience. If the store refuses it, you
    // just pick the file again next session — no reason to block this one.
    return idbPut(state.handle).catch(function (err) {
      console.warn("Could not remember the file handle:", err);
    });
  }).then(function () {
    return loadFromDisk();
  }).catch(function (err) {
    if (err && err.name === "AbortError") return;
    console.error(err);
    setSaveState("Could not open the file: " + err.message, "error");
  });
}

function reconnect() {
  return state.handle.requestPermission({ mode: "readwrite" }).then(function (result) {
    if (result !== "granted") {
      setSaveState("Permission denied — click Reconnect to try again.", "error");
      return;
    }
    $("#reconnect").hidden = true;
    return loadFromDisk();
  });
}

function loadFromDisk() {
  return state.handle.getFile().then(function (file) {
    state.mtime = file.lastModified;
    $("#file-name").textContent = file.name;
    return file.text();
  }).then(function (text) {
    var onDisk = JSON.parse(text);
    var draft = readDraft();

    if (draft && draft.json !== text) {
      return offerDraft(draft, mtimeLabel()).then(function (choice) {
        adopt(choice === "restore" ? JSON.parse(draft.json) : onDisk);
        if (choice !== "restore") clearDraft();
      });
    }
    clearDraft();
    adopt(onDisk);
  }).catch(function (err) {
    console.error(err);
    setSaveState("Could not read the file: " + err.message, "error");
  });
}

function mtimeLabel() {
  return new Date(state.mtime).toLocaleString();
}

function adopt(data) {
  state.data = migrate(data);
  state.selection = data.sectors && data.sectors.length ? [0] : null;
  if (state.selection) state.expanded.add(key(state.selection));

  $("#panes").hidden = false;
  $("#statusbar").hidden = false;
  $("#empty-state").hidden = true;
  $("#open-file").textContent = "Open a different file";

  revalidate();
  renderAll();

  if (state.validation.errors.length) {
    setSaveState(errorCountLabel() + " — not saved to disk", "error");
  } else {
    setSaveState("Loaded — no changes yet", "");
  }
}

/* Writes only when the data is valid. Returns a promise resolving to true if
   the file was written. */
function saveNow(fromShortcut) {
  if (!state.data || !state.handle) return Promise.resolve(false);

  if (state.validation.errors.length) {
    writeDraft();
    if (fromShortcut) {
      setSaveState("Not saved — " + errorCountLabel() + " to fix first", "error");
    }
    return Promise.resolve(false);
  }

  return state.handle.getFile().then(function (file) {
    if (file.lastModified > state.mtime + 1) {
      return confirmStale(file).then(function (choice) {
        if (choice !== "overwrite") {
          return loadFromDisk().then(function () { return false; });
        }
        return writeFile();
      });
    }
    return writeFile();
  }).catch(function (err) {
    console.error(err);
    if (err && err.name === "NotAllowedError") {
      $("#reconnect").hidden = false;
      setSaveState("Write permission lapsed — click Reconnect", "error");
    } else {
      setSaveState("Save failed: " + err.message, "error");
    }
    writeDraft();
    return false;
  });
}

function writeFile() {
  var now = new Date();
  state.data.meta.version = now.toISOString().replace(/\.\d+Z$/, "Z");
  state.data.meta.updated = now.toISOString().slice(0, 10);

  var text = toJson(state.data);

  return state.handle.createWritable().then(function (writable) {
    return writable.write(text).then(function () { return writable.close(); });
  }).then(function () {
    return state.handle.getFile();
  }).then(function (file) {
    state.mtime = file.lastModified;
    clearDraft();
    if (clearNewFlags()) pinKeyField();
    setSaveState("Saved " + new Date().toLocaleTimeString(), "saved");
    renderStatus();
    return true;
  });
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  if (state.validation.errors.length) {
    writeDraft();
    setSaveState(errorCountLabel() + " — not saved to disk", "error");
    return;
  }
  setSaveState("Saving…", "");
  state.saveTimer = setTimeout(function () { saveNow(false); }, SAVE_DEBOUNCE);
}

/* Opens a dialog and resolves with the value of the button used to close it,
   or "cancel" for Esc. Driven off the form's submit rather than the dialog's
   close event, which does not fire reliably in every engine. */
function askDialog(dialog) {
  var form = dialog.querySelector("form");

  return new Promise(function (resolve) {
    var done = function (value) {
      form.removeEventListener("submit", onSubmit);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      resolve(value);
    };
    var onSubmit = function (e) { done(e.submitter ? e.submitter.value : dialog.returnValue); };
    var onCancel = function () { done("cancel"); };
    var onClose = function () { done(dialog.returnValue || "cancel"); };

    form.addEventListener("submit", onSubmit);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

/* ------------------------------------------------------------------ draft */

function writeDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      json: toJson(state.data),
      at: Date.now()
    }));
  } catch (e) { /* quota or private mode — the file is still the source of truth */ }
}

function readDraft() {
  try {
    var raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to clear */ }
}

function offerDraft(draft, diskLabel) {
  var dialog = $("#draft-dialog");
  $("#draft-times").textContent =
    "Draft last touched " + new Date(draft.at).toLocaleString() +
    ". File on disk last written " + diskLabel + ".";
  return askDialog(dialog);
}

function confirmStale(file) {
  var dialog = $("#stale-dialog");
  $("#stale-body").textContent =
    "data.json was written by something else at " +
    new Date(file.lastModified).toLocaleString() +
    " — after this editor loaded it. Overwriting replaces those changes with what is on screen.";
  return askDialog(dialog);
}

/* ------------------------------------------------------------------ mutation */

/* Every edit funnels through here: validate, redraw what the change can
   affect, then restart the save clock. `structural` also rebuilds the form,
   which would otherwise steal focus from the field being typed into. */
function changed(structural) {
  revalidate();
  renderTree();
  renderStatus();
  renderErrorBanner();
  if (structural) renderForm();
  applyFieldMessages();
  schedulePreview();
  scheduleSave();
}

function revalidate() {
  state.validation = validateData(state.data);
}

function clearNewFlags() {
  var cleared = false;
  walk(function (node) {
    if (node._new) cleared = true;
    delete node._new;
    delete node._unlocked;
  });
  return cleared;
}

function walk(fn) {
  (state.data.sectors || []).forEach(function (sector, i) {
    fn(sector, [i], "sector");
    (sector.boulders || []).forEach(function (boulder, j) {
      fn(boulder, [i, j], "boulder");
      (boulder.climbs || []).forEach(function (climb, k) {
        fn(climb, [i, j, k], "climb");
      });
    });
  });
}

function countClimbs() {
  var n = 0;
  walk(function (node, path) { if (path.length === 3) n++; });
  return n;
}

/* ------------------------------------------------------------------ tree */

function renderTree() {
  var tree = $("#tree");
  tree.innerHTML = "";
  (state.data.sectors || []).forEach(function (sector, i) {
    tree.appendChild(treeNode(sector, [i]));
  });
}

function treeNode(node, path) {
  var type = typeAt(path);
  var ck = childKey(type);
  var k = key(path);
  var open = state.expanded.has(k);

  var wrap = document.createElement("div");
  wrap.className = "tree-node";

  var row = document.createElement("div");
  row.className = "tree-row" + (isSelected(path) ? " is-selected" : "");
  row.setAttribute("role", "treeitem");
  row.dataset.path = k;
  row.draggable = true;
  if (ck) row.setAttribute("aria-expanded", String(open));

  var twisty = document.createElement("button");
  twisty.type = "button";
  twisty.className = "tree-twisty" + (ck ? "" : " is-leaf");
  twisty.textContent = open ? "▾" : "▸";
  twisty.tabIndex = -1;
  twisty.setAttribute("aria-label", (open ? "Collapse " : "Expand ") + labelOf(node));
  twisty.addEventListener("click", function (e) {
    e.stopPropagation();
    toggleExpanded(k);
  });
  row.appendChild(twisty);

  var label = document.createElement("span");
  label.className = "tree-label";
  label.textContent = labelOf(node);
  row.appendChild(label);

  if (ck) {
    var count = document.createElement("span");
    count.className = "tree-count";
    count.textContent = (node[ck] || []).length;
    row.appendChild(count);
  }

  var flag = flagFor(path);
  if (flag) {
    var mark = document.createElement("span");
    mark.className = "tree-flag" + (flag === "warn" ? " is-warn" : "");
    mark.textContent = flag === "warn" ? "!" : "●";
    mark.title = flag === "warn"
      ? "Climb numbers changed — check the topo"
      : "Has validation errors";
    row.appendChild(mark);
  }

  row.addEventListener("click", function () { select(path); });
  wireDrag(row, path);
  wrap.appendChild(row);

  if (ck && open) {
    var kids = document.createElement("div");
    kids.className = "tree-children";
    kids.setAttribute("role", "group");
    (node[ck] || []).forEach(function (child, i) {
      kids.appendChild(treeNode(child, path.concat(i)));
    });

    var add = document.createElement("button");
    add.type = "button";
    add.className = "add-btn";
    add.textContent = "+ Add " + SCHEMA[childType(type)].label.toLowerCase();
    add.addEventListener("click", function (e) {
      e.stopPropagation();
      addChild(path);
    });
    kids.appendChild(add);

    wrap.appendChild(kids);
  }

  return wrap;
}

function flagFor(path) {
  var k = key(path);
  if (state.renumbered.has(k)) return "warn";

  var hasError = false;
  Object.keys(state.validation.byPath).forEach(function (p) {
    if (hasError) return;
    if (p === k || p.indexOf(k + ".") === 0) {
      hasError = state.validation.byPath[p].some(function (i) { return i.level === "error"; });
    }
  });
  return hasError ? "error" : null;
}

function isSelected(path) {
  return state.selection && key(state.selection) === key(path);
}

function toggleExpanded(k) {
  if (state.expanded.has(k)) state.expanded.delete(k);
  else state.expanded.add(k);
  renderTree();
}

function select(path) {
  state.selection = path;

  // Reveal the ancestors, and open the node itself so its children are one
  // click away. Selecting a boulder should put its climbs on screen — they are
  // the thing you came to edit. The twisty still collapses it again.
  for (var i = 1; i < path.length; i++) state.expanded.add(key(path.slice(0, i)));
  if (childKey(typeAt(path))) state.expanded.add(key(path));

  renderTree();
  renderForm();
  applyFieldMessages();
  schedulePreview();
}

/* ------------------------------------------------------------------ drag and drop */

var dragPath = null;

function wireDrag(row, path) {
  row.addEventListener("dragstart", function (e) {
    dragPath = path;
    row.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key(path));
  });

  row.addEventListener("dragend", function () {
    dragPath = null;
    row.classList.remove("is-dragging");
    renderTree();
  });

  row.addEventListener("dragover", function (e) {
    if (!dragPath || !sameLevel(dragPath, path) || key(dragPath) === key(path)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    row.classList.add("is-drop-target");
  });

  row.addEventListener("dragleave", function () { row.classList.remove("is-drop-target"); });

  row.addEventListener("drop", function (e) {
    row.classList.remove("is-drop-target");
    if (!dragPath || !sameLevel(dragPath, path)) return;
    e.preventDefault();
    moveWithinLevel(dragPath, path);
  });
}

/* Same depth and same parent. A climb can only be dragged among its own
   boulder's climbs; crossing boulders is the "Move to…" action's job. */
function sameLevel(a, b) {
  return a.length === b.length && key(a.slice(0, -1)) === key(b.slice(0, -1));
}

function moveWithinLevel(from, to) {
  var list = siblingsAt(from);
  var node = list[from[from.length - 1]];
  list.splice(from[from.length - 1], 1);
  list.splice(to[to.length - 1], 0, node);

  var newPath = to.slice();
  state.selection = newPath;

  if (from.length === 3) {
    var boulderPath = from.slice(0, 2);
    state.renumbered.add(key(boulderPath));
    showNotice("Climb numbers changed — topo image for " +
      labelOf(nodeAt(boulderPath)) + " may now be wrong.");
  }

  changed(true);
}

/* ------------------------------------------------------------------ add, delete, move */

function addChild(parentPath) {
  var parent = parentPath.length ? nodeAt(parentPath) : { boulders: state.data.sectors };
  var type = parentPath.length ? childType(typeAt(parentPath)) : "sector";
  var ck = parentPath.length ? childKey(typeAt(parentPath)) : "boulders";

  var node = blankNode(type);
  node.name = "New " + SCHEMA[type].label.toLowerCase();
  node[keyField(type)] = uniqueKey(parent[ck], type, slugify(node.name));
  node._new = true;

  parent[ck].push(node);

  var path = parentPath.concat(parent[ck].length - 1);
  if (parentPath.length) state.expanded.add(key(parentPath));
  select(path);
  changed(true);
}

function uniqueKey(list, type, base) {
  var kf = keyField(type);
  var candidate = base || "new";
  var n = 1;
  while (list.some(function (s) { return s[kf] === candidate; })) {
    candidate = (base || "new") + "-" + (++n);
  }
  return candidate;
}

function deleteSelected() {
  var path = state.selection;
  var node = nodeAt(path);
  var type = typeAt(path);

  var takes = [];
  if (type === "sector") {
    var climbs = (node.boulders || []).reduce(function (n, b) { return n + (b.climbs || []).length; }, 0);
    takes.push((node.boulders || []).length + " boulders", climbs + " climbs");
  } else if (type === "boulder") {
    takes.push((node.climbs || []).length + " climbs");
  }

  $("#confirm-title").textContent = "Delete " + SCHEMA[type].label.toLowerCase();
  $("#confirm-body").textContent = "Delete " + SCHEMA[type].label.toLowerCase() +
    ' "' + labelOf(node) + '"?' +
    (takes.length ? " This also deletes its " + takes.join(" and ") + "." : "");

  askDialog($("#confirm-dialog")).then(function (choice) {
    if (choice !== "delete") return;

    var list = siblingsAt(path);
    list.splice(path[path.length - 1], 1);

    state.selection = list.length
      ? path.slice(0, -1).concat(Math.min(path[path.length - 1], list.length - 1))
      : (path.length > 1 ? path.slice(0, -1) : (state.data.sectors.length ? [0] : null));

    changed(true);
  });
}

function moveSelected() {
  var path = state.selection;
  var type = typeAt(path);
  if (type === "sector") return;

  var node = nodeAt(path);
  var targets = [];

  if (type === "climb") {
    state.data.sectors.forEach(function (s, i) {
      s.boulders.forEach(function (b, j) {
        if (key([i, j]) !== key(path.slice(0, 2))) {
          targets.push({ path: [i, j], label: s.name + " / " + b.name });
        }
      });
    });
  } else {
    state.data.sectors.forEach(function (s, i) {
      if (i !== path[0]) targets.push({ path: [i], label: s.name });
    });
  }

  if (!targets.length) {
    showNotice("Nowhere to move it to — there is only one " +
      (type === "climb" ? "boulder" : "sector") + ".");
    return;
  }

  $("#move-body").textContent = 'Move "' + labelOf(node) + '" to another ' +
    (type === "climb" ? "boulder" : "sector") + ". It keeps its " +
    keyField(type) + ", so existing links to it change only in their parent segment.";

  var select_ = $("#move-target");
  select_.innerHTML = targets.map(function (t, i) {
    return '<option value="' + i + '">' + t.label.replace(/</g, "&lt;") + "</option>";
  }).join("");

  askDialog($("#move-dialog")).then(function (choice) {
    if (choice !== "move") return;

    var target = targets[Number(select_.value)];
    var destination = nodeAt(target.path);
    var ck = childKey(typeAt(target.path));

    siblingsAt(path).splice(path[path.length - 1], 1);
    destination[ck].push(node);

    state.selection = target.path.concat(destination[ck].length - 1);
    state.expanded.add(key(target.path));
    changed(true);
  });
}

/* ------------------------------------------------------------------ form */

function renderForm() {
  var form = $("#form");
  form.innerHTML = "";

  if (!state.selection || !pathExists(state.selection)) {
    $("#breadcrumb").textContent = "";
    form.innerHTML = '<p class="hint">Nothing selected.</p>';
    return;
  }

  var path = state.selection;
  var type = typeAt(path);
  var node = nodeAt(path);

  renderBreadcrumb(path);

  fieldList(type).forEach(function (f) {
    if (!fieldApplies(f.spec, node)) return;
    form.appendChild(buildField(type, node, path, f.name, f.spec));
  });

  var actions = document.createElement("div");
  actions.className = "form-actions";

  if (type !== "sector") {
    var move = document.createElement("button");
    move.type = "button";
    move.className = "btn";
    move.textContent = "Move to…";
    move.addEventListener("click", moveSelected);
    actions.appendChild(move);
  }

  var del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn-danger";
  del.textContent = "Delete " + SCHEMA[type].label.toLowerCase();
  del.addEventListener("click", deleteSelected);
  actions.appendChild(del);

  form.appendChild(actions);
}

function renderBreadcrumb(path) {
  var crumb = $("#breadcrumb");
  crumb.innerHTML = "";
  for (var i = 1; i <= path.length; i++) {
    var sub = path.slice(0, i);
    if (i > 1) {
      var sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "/";
      crumb.appendChild(sep);
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = labelOf(nodeAt(sub));
    (function (target) {
      btn.addEventListener("click", function () { select(target); });
    })(sub);
    crumb.appendChild(btn);
  }
}

function fieldShell(type, name, spec) {
  var wrap = document.createElement("div");
  wrap.className = "field";
  wrap.dataset.field = name;

  var label = document.createElement("label");
  label.className = "field-label";
  label.textContent = labelFor(type, name);
  if (spec.required) {
    var req = document.createElement("span");
    req.className = "req";
    req.textContent = " *";
    label.appendChild(req);
  }
  wrap.appendChild(label);
  return wrap;
}

function buildField(type, node, path, name, spec) {
  var wrap = fieldShell(type, name, spec);
  var label = wrap.querySelector(".field-label");
  if (spec.type === "boolean") label.remove();
  var control;

  switch (spec.type) {
    case "text":
      control = textInput(node[name], function (v) {
        node[name] = v;
        if (name === "name" && node._new) {
          node[keyField(type)] = uniqueKey(siblingsAt(path), type, slugify(v));
          var slugInput = $('.field[data-field="' + keyField(type) + '"] input');
          if (slugInput) slugInput.value = node[keyField(type)];
        }
        changed(false);
      });
      break;

    case "textarea":
      control = textArea(node[name], function (v) { node[name] = v; changed(false); });
      break;

    case "slug":
      control = slugControl(node, path, type, name, wrap);
      break;

    case "grade":
      control = gradeControl(node, name, spec, label);
      break;

    case "stars":
      control = starsControl(node, name);
      break;

    case "boolean":
      control = checkbox(node, name, spec);
      break;

    case "enum":
      control = radioGroup(node, name, spec);
      break;

    case "coords":
      control = coordsControl(node, name);
      break;

    case "url":
      control = urlControl(node, name, spec);
      break;

    case "image":
      control = imageControl(node[name] || (node[name] = { src: "", alt: "", credit: "" }), null);
      break;

    case "imageList":
      control = imageListControl(node, name, type, spec);
      break;

    case "group":
      control = groupControl(node, name, spec);
      break;

    default:
      control = textInput(node[name], function (v) { node[name] = v; changed(false); });
  }

  wrap.appendChild(control);
  return wrap;
}

function textInput(value, onChange, opts) {
  var input = document.createElement("input");
  input.type = (opts && opts.type) || "text";
  input.value = value == null ? "" : value;
  if (opts && opts.readonly) input.readOnly = true;
  if (opts && opts.placeholder) input.placeholder = opts.placeholder;
  input.addEventListener("input", function () { onChange(input.value); });
  return input;
}

function textArea(value, onChange) {
  var area = document.createElement("textarea");
  area.value = value == null ? "" : value;
  area.rows = 2;
  var grow = function () {
    area.style.height = "auto";
    area.style.height = area.scrollHeight + 2 + "px";
  };
  area.addEventListener("input", function () { grow(); onChange(area.value); });
  requestAnimationFrame(grow);
  return area;
}

function slugControl(node, path, type, name, wrap) {
  var row = document.createElement("div");
  row.className = "slug-row";

  var input = textInput(node[name], function (v) {
    node[name] = v;
    changed(false);
  }, { readonly: !node._new && !node._unlocked });

  row.appendChild(input);
  if (!node._new) row.appendChild(unlockButton(node));

  var hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = slugHint(node, type);

  var holder = document.createElement("div");
  holder.appendChild(row);
  holder.appendChild(hint);
  return holder;
}

function unlockButton(node) {
  var unlock = document.createElement("button");
  unlock.type = "button";
  unlock.className = "btn btn-quiet shrink";
  unlock.textContent = node._unlocked ? "Lock" : "Unlock";
  unlock.addEventListener("click", function () {
    node._unlocked = !node._unlocked;
    renderForm();
    applyFieldMessages();
  });
  return unlock;
}

function slugHint(node, type) {
  if (node._new) return "Derived from the name until this is first saved, then fixed.";
  if (node._unlocked) {
    return "Changing this breaks any existing link to this " + SCHEMA[type].label.toLowerCase() + ".";
  }
  return "Pinned. Renaming will not change it, so shared links keep working.";
}

/* The first save pins a new node's slug. Reflect that on the field that is
   already on screen without rebuilding the form around the user's cursor. */
function pinKeyField() {
  if (!state.selection || !pathExists(state.selection)) return;

  var type = typeAt(state.selection);
  var node = nodeAt(state.selection);
  var field = document.querySelector('#form .field[data-field="' + keyField(type) + '"]');
  if (!field) return;

  var input = field.querySelector("input");
  var row = field.querySelector(".slug-row");
  if (!input || !row) return;

  input.readOnly = true;
  if (!row.querySelector("button")) row.appendChild(unlockButton(node));
  field.querySelector(".hint").textContent = slugHint(node, type);
}

/* gradeV auto-fills from gradeFont, but only while it still matches the
   mapping. Once you have overridden it by hand, a later Font change leaves it
   alone rather than silently clobbering the override. */
function gradeControl(node, name, spec, label) {
  var scale = spec.scale === "font" ? FONT_SCALE : V_SCALE;

  var select_ = document.createElement("select");
  select_.innerHTML = '<option value=""></option>' + scale.map(function (g) {
    return '<option value="' + g + '"' + (node[name] === g ? " selected" : "") + ">" + g + "</option>";
  }).join("");

  select_.addEventListener("change", function () {
    var previous = node[name];
    node[name] = select_.value;

    if (name === "gradeFont") {
      var wasCanonical = !node.gradeV || node.gradeV === vForFont(previous);
      if (wasCanonical) {
        node.gradeV = vForFont(select_.value) || node.gradeV;
        var vSelect = $('.field[data-field="gradeV"] select');
        if (vSelect) vSelect.value = node.gradeV;
      }
      markOverride(node);
    }
    if (name === "gradeV") markOverride(node);

    changed(false);
  });

  if (name === "gradeV") {
    var tag = document.createElement("span");
    tag.className = "override-tag";
    tag.textContent = "overridden";
    tag.hidden = !isOverridden(node);
    tag.title = "Not the canonical V grade for " + node.gradeFont +
      ". Changing the Font grade will leave this alone.";
    label.appendChild(tag);
  }

  return select_;
}

function isOverridden(node) {
  var canonical = vForFont(node.gradeFont);
  return !!canonical && !!node.gradeV && node.gradeV !== canonical;
}

function markOverride(node) {
  var tag = document.querySelector('.field[data-field="gradeV"] .override-tag');
  if (tag) tag.hidden = !isOverridden(node);
}

function starsControl(node, name) {
  var group = document.createElement("div");
  group.className = "stars-picker";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Stars");

  var paint = function () {
    Array.prototype.forEach.call(group.querySelectorAll("button"), function (b, i) {
      var on = i < node[name];
      b.classList.toggle("on", on);
      b.textContent = on ? "★" : "☆";
      b.setAttribute("aria-pressed", String(on));
    });
    count.textContent = node[name] + " of 3";
  };

  for (var i = 1; i <= 3; i++) {
    (function (n) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", n + (n === 1 ? " star" : " stars"));
      btn.addEventListener("click", function () {
        node[name] = node[name] === n ? n - 1 : n;   // clicking the last lit star clears it
        paint();
        changed(false);
      });
      group.appendChild(btn);
    })(i);
  }

  var count = document.createElement("span");
  count.className = "tree-count";
  group.appendChild(count);

  paint();
  return group;
}

/* Ticking this can add or remove other fields — a project has no grades — so
   it rebuilds the form rather than just updating in place. */
function checkbox(node, name, spec) {
  var holder = document.createElement("div");

  var label = document.createElement("label");
  label.className = "check";

  var input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!node[name];
  input.addEventListener("change", function () {
    if (input.checked) node[name] = true;
    else delete node[name];

    changed(true);
    var again = document.querySelector('#form .field[data-field="' + name + '"] input');
    if (again) again.focus();
  });

  label.appendChild(input);
  label.appendChild(document.createTextNode(spec.label || labelFor("climb", name)));
  holder.appendChild(label);

  if (spec.hint) {
    var hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = spec.hint;
    holder.appendChild(hint);
  }

  return holder;
}

function radioGroup(node, name, spec) {
  var group = document.createElement("div");
  group.className = "radio-group";
  var groupName = "radio-" + name + "-" + Math.random().toString(36).slice(2, 8);

  spec.values.forEach(function (value) {
    var label = document.createElement("label");
    var input = document.createElement("input");
    input.type = "radio";
    input.name = groupName;
    input.value = value;
    input.checked = node[name] === value;
    input.addEventListener("change", function () {
      if (input.checked) { node[name] = value; changed(false); }
    });
    label.appendChild(input);
    label.appendChild(document.createTextNode(value));
    group.appendChild(label);
  });

  return group;
}

function coordsControl(node, name) {
  var holder = document.createElement("div");
  var coords = node[name] || (node[name] = { lat: null, lng: null });

  var row = document.createElement("div");
  row.className = "row";

  /* Only refresh the map link while it is still the one we derived. A link you
     pasted yourself is yours, and moving the pin should not silently bin it. */
  var sync = function (previous) {
    var derivedBefore = mapUrlFor(previous || {});
    var ownsLink = !node.mapUrl || node.mapUrl === derivedBefore;

    if (ownsLink) {
      node.mapUrl = mapUrlFor(coords);
      if (!node.mapUrl) delete node.mapUrl;
      var urlField = $('.field[data-field="mapUrl"] input');
      if (urlField) urlField.value = node.mapUrl || "";
    }
    changed(false);
  };

  var num = function (which, placeholder) {
    var input = document.createElement("input");
    input.type = "number";
    input.step = "0.0001";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", which === "lat" ? "Latitude" : "Longitude");
    input.value = coords[which] == null ? "" : coords[which];
    input.addEventListener("input", function () {
      var previous = { lat: coords.lat, lng: coords.lng };
      coords[which] = input.value === "" ? null : Number(input.value);
      sync(previous);
    });
    return input;
  };

  var lat = num("lat", "35.8206");
  var lng = num("lng", "14.5461");
  row.appendChild(lat);
  row.appendChild(lng);
  holder.appendChild(row);

  var paste = textInput("", function (v) {
    var parsed = parseCoords(v);
    if (!parsed) return;
    var previous = { lat: coords.lat, lng: coords.lng };
    coords.lat = parsed.lat;
    coords.lng = parsed.lng;
    lat.value = parsed.lat;
    lng.value = parsed.lng;
    sync(previous);
  }, { placeholder: "…or paste a Google Maps link or “35.8206, 14.5461”" });
  paste.style.marginTop = "0.4rem";
  holder.appendChild(paste);

  return holder;
}

/* Paste any map link here. If it happens to carry coordinates and none are set
   yet, they get filled in for free — a short maps.app.goo.gl link does not, and
   that is fine: the link alone is enough to navigate by. */
function urlControl(node, name, spec) {
  var holder = document.createElement("div");

  var input = textInput(node[name] || "", function (v) {
    var trimmed = v.trim();
    if (trimmed) node[name] = trimmed;
    else delete node[name];

    /* Only the field that stands in for the coordinates may fill them in. A
       parking link points at the car park, not at the sector. */
    var parsed = spec && spec.derivedFrom === "coords" ? parseCoords(trimmed) : null;
    var coords = node.coords || (node.coords = { lat: null, lng: null });
    var empty = coords.lat == null && coords.lng == null;
    if (parsed && empty) {
      coords.lat = parsed.lat;
      coords.lng = parsed.lng;
      var fields = document.querySelectorAll('.field[data-field="coords"] input');
      if (fields[0]) fields[0].value = parsed.lat;
      if (fields[1]) fields[1].value = parsed.lng;
    }
    changed(false);
  }, { type: "url", placeholder: "https://maps.app.goo.gl/…" });

  holder.appendChild(input);

  if (spec && spec.hint) {
    var hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = spec.hint;
    holder.appendChild(hint);
  }
  return holder;
}

function imageControl(img, rowFields) {
  var holder = document.createElement("div");

  var thumb = document.createElement("div");
  thumb.className = "thumb";

  var paint = function () {
    thumb.innerHTML = "";
    if (!img.src) { thumb.textContent = "No image path"; return; }
    var el = new Image();
    el.alt = img.alt || "";
    el.addEventListener("error", function () {
      thumb.textContent = "Not found: " + img.src;
    });
    el.src = "../" + img.src.replace(/^\.?\//, "");
    thumb.appendChild(el);
  };

  ["src", "alt", "credit"].forEach(function (part) {
    var label = document.createElement("label");
    label.className = "hint";
    label.textContent = part === "src" ? "Path" : part.charAt(0).toUpperCase() + part.slice(1);
    holder.appendChild(label);

    var input = textInput(img[part], function (v) {
      img[part] = v;
      if (part === "src") paint();
      changed(false);
    }, { placeholder: part === "src" ? "images/topos/sector-boulder.jpg" : "" });
    input.style.marginBottom = "0.35rem";
    holder.appendChild(input);
  });

  paint();
  holder.appendChild(thumb);

  /* Extra per-row fields declared by the schema — for topos, the problem
     number the image starts at, which is what splits the list. */
  Object.keys(rowFields || {}).forEach(function (part) {
    var rf = rowFields[part];

    var label = document.createElement("label");
    label.className = "hint";
    label.textContent = rf.label;
    holder.appendChild(label);

    var input = textInput(img[part], function (v) {
      if (v === "") delete img[part];
      else img[part] = rf.type === "number" ? Number(v) : v;
      changed(false);
    }, { type: rf.type === "number" ? "number" : "text" });
    if (rf.min !== undefined) input.min = rf.min;
    input.style.marginTop = "0.35rem";
    holder.appendChild(input);
  });

  return holder;
}

function imageListControl(node, name, type, spec) {
  var holder = document.createElement("div");
  var list = node[name] || [];
  var one = singularLabel(type, name);
  var rowFields = spec.rowFields;

  list.forEach(function (img, i) {
    var row = document.createElement("div");
    row.className = "photo-row";

    var head = document.createElement("div");
    head.className = "photo-row-head";

    var title = document.createElement("span");
    title.textContent = one + " " + (i + 1);
    head.appendChild(title);

    var buttons = document.createElement("span");
    [["↑", -1], ["↓", 1]].forEach(function (pair) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-quiet";
      btn.textContent = pair[0];
      btn.disabled = (i + pair[1]) < 0 || (i + pair[1]) >= list.length;
      btn.addEventListener("click", function () {
        var moved = list.splice(i, 1)[0];
        list.splice(i + pair[1], 0, moved);
        renderForm();
        applyFieldMessages();
        changed(false);
      });
      buttons.appendChild(btn);
    });

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-quiet";
    remove.textContent = "Remove";
    remove.addEventListener("click", function () {
      list.splice(i, 1);
      if (!list.length) delete node[name];
      renderForm();
      applyFieldMessages();
      changed(false);
    });
    buttons.appendChild(remove);
    head.appendChild(buttons);

    row.appendChild(head);
    row.appendChild(imageControl(img, rowFields));
    holder.appendChild(row);
  });

  var add = document.createElement("button");
  add.type = "button";
  add.className = "add-btn";
  add.textContent = "+ Add " + one.toLowerCase();
  add.addEventListener("click", function () {
    if (!node[name]) node[name] = [];

    var row = { src: "", alt: "", credit: "" };
    if (rowFields && rowFields.startsAt) {
      var ck = childKey(type);
      row.startsAt = node[name].length ? (node[ck] || []).length + 1 : 1;
    }
    node[name].push(row);
    renderForm();
    applyFieldMessages();
    changed(false);
  });
  holder.appendChild(add);

  if (spec.hint) {
    var hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = spec.hint;
    holder.appendChild(hint);
  }

  return holder;
}

function groupControl(node, name, spec) {
  var holder = document.createElement("div");
  var set = document.createElement("fieldset");
  var legend = document.createElement("legend");
  legend.textContent = labelFor("climb", name);
  set.appendChild(legend);

  var value = node[name];

  if (!value) {
    var add = document.createElement("button");
    add.type = "button";
    add.className = "add-btn";
    add.textContent = "+ Add " + labelFor("climb", name).toLowerCase();
    add.addEventListener("click", function () {
      node[name] = { name: "", year: "" };
      renderForm();
      applyFieldMessages();
      changed(false);
    });
    set.appendChild(add);
    holder.appendChild(set);
    return holder;
  }

  Object.keys(spec.fields).forEach(function (part) {
    var label = document.createElement("label");
    label.className = "hint";
    label.textContent = part.charAt(0).toUpperCase() + part.slice(1);
    set.appendChild(label);

    var input = textInput(value[part], function (v) {
      value[part] = spec.fields[part].type === "year" && v !== "" ? Number(v) : v;
      changed(false);
    }, { type: spec.fields[part].type === "year" ? "number" : "text" });
    input.style.marginBottom = "0.35rem";
    set.appendChild(input);
  });

  var clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn btn-quiet";
  clear.textContent = "Clear";
  clear.addEventListener("click", function () {
    delete node[name];
    renderForm();
    applyFieldMessages();
    changed(false);
  });
  set.appendChild(clear);

  holder.appendChild(set);
  return holder;
}

/* ------------------------------------------------------------------ messages */

/* Runs on every keystroke, so it rewrites a field only when that field's
   messages actually changed. Blindly removing and re-adding them all reflows
   the pane under the cursor on each character. */
function applyFieldMessages() {
  var wanted = {};

  if (state.selection && pathExists(state.selection)) {
    (state.validation.byPath[key(state.selection)] || []).forEach(function (issue) {
      (wanted[issue.field] = wanted[issue.field] || []).push(issue);
    });
  }

  document.querySelectorAll("#form .field").forEach(function (field) {
    var issues = wanted[field.dataset.field] || [];
    var shown = field.querySelectorAll(".field-msg");

    var unchanged = shown.length === issues.length &&
      Array.prototype.every.call(shown, function (msg, i) {
        return msg.className === "field-msg is-" + issues[i].level &&
          msg.textContent === issues[i].message;
      });

    if (unchanged) return;

    shown.forEach(function (m) { m.remove(); });
    issues.forEach(function (issue) {
      var msg = document.createElement("p");
      msg.className = "field-msg is-" + issue.level;
      msg.textContent = issue.message;
      field.appendChild(msg);
    });
  });

  document.querySelectorAll("#form .field").forEach(function (field) {
    var hasError = (wanted[field.dataset.field] || []).some(function (i) {
      return i.level === "error";
    });
    field.classList.toggle("has-error", hasError);
  });
}

function errorCountLabel() {
  var n = state.validation.errors.length;
  return n + (n === 1 ? " error" : " errors");
}

function renderErrorBanner() {
  var errors = state.validation.errors;
  var banner = $("#error-banner");
  var list = $("#error-list");

  banner.hidden = !errors.length;
  list.hidden = !errors.length;
  if (!errors.length) {
    list.innerHTML = "";        // hidden is not the same as emptied
    return;
  }

  $("#error-count").textContent = errorCountLabel();
  list.innerHTML = "";

  errors.forEach(function (issue) {
    var li = document.createElement("li");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = issue.key + " — " + labelFor(issue.type, issue.field) + ": " + issue.message;
    btn.addEventListener("click", function () {
      select(issue.path);
      var field = document.querySelector('#form .field[data-field="' + issue.field + '"]');
      if (!field) return;
      field.scrollIntoView({ block: "center" });
      var input = field.querySelector("input, textarea, select");
      if (input && !input.readOnly) input.focus();
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function setSaveState(text, kind) {
  var el = $("#st-save");
  el.textContent = text;
  el.className = "st" + (kind ? " is-" + kind : "");
}

function renderStatus() {
  var errors = state.validation.errors.length;
  var warnings = state.validation.warnings.length;

  var e = $("#st-errors");
  e.textContent = errors + (errors === 1 ? " error" : " errors") + ", " +
    warnings + (warnings === 1 ? " warning" : " warnings");
  e.className = "st" + (errors ? " is-error" : warnings ? " is-warn" : "");

  $("#st-version").textContent = "version " + state.data.meta.version;
  $("#st-climbs").textContent = countClimbs() + " climbs";
}

function showNotice(text) {
  $("#notice-text").textContent = text;
  $("#notice").hidden = false;
}

/* ------------------------------------------------------------------ preview */

/* srcdoc resolves relative URLs against this page, so image paths written the
   way the site uses them ("images/topos/x.png") would look for /editor/images/.
   The base tag points the preview at the site root instead, which is also why
   the stylesheet hrefs below are written from there. */
var PREVIEW_DOC =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<base href="../">' +
  '<link rel="stylesheet" href="css/style.css">' +
  '<link rel="stylesheet" href="editor/preview.css">' +
  '</head><body class="grade-font"></body></html>';

function initPreview() {
  var frame = $("#preview");
  frame.addEventListener("load", function () {
    state.previewReady = true;
    watchBrokenImages(frame.contentDocument);
    renderPreview();
  });
  frame.srcdoc = PREVIEW_DOC;
}

function schedulePreview() {
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(renderPreview, PREVIEW_DEBOUNCE);
}

function renderPreview() {
  if (!state.previewReady || !state.data) return;

  var doc = $("#preview").contentDocument;
  if (!doc || !doc.body) return;

  if (!state.selection || !pathExists(state.selection)) {
    doc.body.innerHTML = '<p class="preview-empty">Nothing selected.</p>';
    return;
  }

  decorate(state.data);

  var path = state.selection;
  var type = typeAt(path);
  var html;
  var focusId = null;

  if (type === "sector") {
    html = sectorHtml(nodeAt(path));
  } else if (type === "boulder") {
    var sector = nodeAt(path.slice(0, 1));
    html = boulderHtml(sector, nodeAt(path));
  } else {
    // A climb only makes sense inside its boulder's numbered list.
    var s = nodeAt(path.slice(0, 1));
    var boulder = nodeAt(path.slice(0, 2));
    html = boulderHtml(s, boulder);
    focusId = nodeAt(path)._anchor;
  }

  doc.body.innerHTML = html;

  doc.querySelectorAll("details").forEach(function (d) { d.open = true; });

  if (focusId) {
    var target = doc.getElementById(focusId);
    if (target) {
      target.classList.add("preview-focus");
      target.scrollIntoView({ block: "center" });
    }
  }
}

/* ------------------------------------------------------------------ keyboard */

function visibleRows() {
  return Array.prototype.slice.call(document.querySelectorAll("#tree .tree-row"))
    .map(function (row) {
      return row.dataset.path.split(".").map(Number);
    });
}

function wireKeyboard() {
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      clearTimeout(state.saveTimer);
      saveNow(true);
      return;
    }

    if (!state.selection) return;
    if (!$("#tree").contains(document.activeElement) && document.activeElement !== $("#tree")) return;

    var rows = visibleRows();
    var index = rows.findIndex(function (p) { return key(p) === key(state.selection); });
    if (index === -1) return;

    var type = typeAt(state.selection);
    var k = key(state.selection);

    if (e.key === "ArrowDown" && index < rows.length - 1) {
      e.preventDefault();
      select(rows[index + 1]);
    } else if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      select(rows[index - 1]);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (childKey(type) && !state.expanded.has(k)) { state.expanded.add(k); renderTree(); }
      else if (index < rows.length - 1) select(rows[index + 1]);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (childKey(type) && state.expanded.has(k)) { state.expanded.delete(k); renderTree(); }
      else if (state.selection.length > 1) select(state.selection.slice(0, -1));
    }
  });
}

/* ------------------------------------------------------------------ boot */

function renderAll() {
  renderTree();
  renderForm();
  renderStatus();
  renderErrorBanner();
  applyFieldMessages();
  schedulePreview();
}

function boot() {
  var isLocal = ["localhost", "127.0.0.1", "[::1]"].indexOf(location.hostname) !== -1;
  $("#remote-banner").hidden = isLocal;

  if (!window.showOpenFilePicker) {
    $("#unsupported").hidden = false;
    $("#open-file").disabled = true;
    return;
  }

  $("#open-file").addEventListener("click", openFile);
  $("#reconnect").addEventListener("click", reconnect);
  $("#notice-dismiss").addEventListener("click", function () {
    $("#notice").hidden = true;
    state.renumbered.clear();
    if (state.data) renderTree();
  });
  document.querySelectorAll('[data-add="sector"]').forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (state.data) addChild([]);
    });
  });

  initPreview();
  wireKeyboard();

  idbGet().then(function (handle) {
    if (!handle) return;
    state.handle = handle;
    return handle.queryPermission({ mode: "readwrite" }).then(function (permission) {
      if (permission === "granted") return loadFromDisk();
      $("#reconnect").hidden = false;
      setSaveState("Reconnect to edit data.json", "warn");
      $("#empty-state").textContent =
        "Chrome drops write permission between sessions. Click Reconnect to grant it again — " +
        "no need to pick the file a second time.";
    });
  }).catch(function (err) {
    console.warn("Could not restore the file handle:", err);
  });
}

boot();
