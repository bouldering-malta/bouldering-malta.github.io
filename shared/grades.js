/* Malta Bouldering — grade ladder.
   Shared by the site renderer and the editor. ES module, no dependencies.

   GRADES is the ordered Font ladder, each entry carrying its canonical V
   equivalent. Array index is the sort order used by the catalog's grade
   sorting and its from/to dropdowns.

   The V mapping is a default, not a law: the editor auto-fills gradeV from it
   and then leaves the field editable, because plenty of problems carry a V
   grade that is genuinely out of step with their Font grade. */

export const GRADES = [
  { font: "3",   v: "V0"  },
  { font: "4",   v: "V0"  },
  { font: "4+",  v: "V1"  },
  { font: "5",   v: "V1"  },
  { font: "5+",  v: "V2"  },
  { font: "6A",  v: "V3"  },
  { font: "6A+", v: "V3"  },
  { font: "6B",  v: "V4"  },
  { font: "6B+", v: "V4"  },
  { font: "6C",  v: "V5"  },
  { font: "6C+", v: "V5"  },
  { font: "7A",  v: "V6"  },
  { font: "7A+", v: "V7"  },
  { font: "7B",  v: "V8"  },
  { font: "7B+", v: "V8"  },
  { font: "7C",  v: "V9"  },
  { font: "7C+", v: "V10" },
  { font: "8A",  v: "V11" },
  { font: "8A+", v: "V12" },
  { font: "8B",  v: "V13" },
  { font: "8B+", v: "V14" },
  { font: "8C",  v: "V15" },
  { font: "8C+", v: "V16" },
  { font: "9A",  v: "V17" }
];

export const FONT_SCALE = GRADES.map(function (g) { return g.font; });

/* The full V ladder, not just the values GRADES maps onto. V0+ and VB never
   come out of the mapping but do get set by hand, and the catalog still has to
   sort them into the right place. */
export const V_SCALE = [
  "VB", "V0", "V0+", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8",
  "V9", "V10", "V11", "V12", "V13", "V14", "V15", "V16", "V17"
];

export function fontIndex(font) {
  return FONT_SCALE.indexOf(font);
}

export function vIndex(v) {
  return V_SCALE.indexOf(v);
}

/* Canonical V for a Font grade, or "" if the Font grade is unknown. */
export function vForFont(font) {
  var hit = GRADES.filter(function (g) { return g.font === font; })[0];
  return hit ? hit.v : "";
}

/* Five-step colour ramp, easy to hard. Keyed off the Font index so the ramp
   does not shift when the reader flips the display toggle to V. */
export function gradeBand(fontIdx) {
  if (fontIdx <= 4) return "g1";
  if (fontIdx <= 8) return "g2";
  if (fontIdx <= 12) return "g3";
  if (fontIdx <= 16) return "g4";
  return "g5";
}
