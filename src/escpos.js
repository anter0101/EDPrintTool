/**
 * Arabic Shaping & BiDi Engine for ESC/POS Thermal Printers (CP864)
 *
 * Fixes vs. the previous version:
 *  1. CP864 table is now generated from iconv-lite (the old hand-written table
 *     was shifted by one for several letters, had the digits/؛/؟ in the wrong
 *     slots, and mapped إ to 0xC5 which is "ع").
 *  2. BiDi no longer reverses numbers/dates ("2:13:39" used to print "39:13:2").
 *     Latin/digit runs such as 2026/10/23 or 14:13 are kept intact.
 *  3. Invisible bidi marks (U+200E / U+200F ...) that toLocaleString("ar-EG")
 *     inserts are stripped; before they were printed as "?".
 *  4. Tashkeel (َ ً ّ ...) is stripped, since it broke letter joining.
 *
 * Requires:  npm i iconv-lite
 */
"use strict";
const iconv = require("iconv-lite");

// [Isolated, Final, Initial, Medial] (Unicode Presentation Forms-B)
const ARABIC_LETTERS = {
  0x0621: [0xfe80, 0xfe80, 0xfe80, 0xfe80],
  0x0622: [0xfe81, 0xfe82, 0xfe81, 0xfe82],
  0x0623: [0xfe83, 0xfe84, 0xfe83, 0xfe84],
  0x0624: [0xfe85, 0xfe86, 0xfe85, 0xfe86],
  0x0625: [0xfe87, 0xfe88, 0xfe87, 0xfe88],
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  0x0627: [0xfe8d, 0xfe8e, 0xfe8d, 0xfe8e],
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94, 0xfe93, 0xfe94],
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4],
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa, 0xfea9, 0xfeaa],
  0x0630: [0xfeab, 0xfeac, 0xfeab, 0xfeac],
  0x0631: [0xfead, 0xfeae, 0xfead, 0xfeae],
  0x0632: [0xfeaf, 0xfeb0, 0xfeaf, 0xfeb0],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4],
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc],
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0],
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640],
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4],
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4],
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec],
  0x0648: [0xfeed, 0xfeee, 0xfeed, 0xfeee],
  0x0649: [0xfeef, 0xfef0, 0xfeef, 0xfef0],
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
};

// Letters that never join to the following letter
const RIGHT_JOINING = new Set([
  0x0622, 0x0623, 0x0624, 0x0625, 0x0627, 0x0629, 0x062f, 0x0630, 0x0631,
  0x0632, 0x0648, 0x0649,
]);

const canJoinFromPrev = (cp) =>
  !!ARABIC_LETTERS[cp] && !RIGHT_JOINING.has(cp) && cp !== 0x0621;
const canJoinToNext = (cp) => !!ARABIC_LETTERS[cp] && cp !== 0x0621;

/** Strip invisible marks + tashkeel, optionally convert Arabic-Indic digits to 0-9 */
function normalize(str, { latinDigits = true } = {}) {
  let s = String(str)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u061C\uFEFF]/g, "") // bidi marks
    .replace(/[\u064B-\u0652\u0670]/g, ""); // tashkeel
  if (latinDigits) {
    s = s
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/\u066A/g, "%")
      .replace(/\u066B/g, ".")
      .replace(/\u066C/g, ",");
  }
  return s;
}

/** Raw Arabic -> connected Presentation Forms-B (with Lam-Alef ligatures) */
function shapeArabic(text) {
  const chars = Array.from(text);
  const out = [];

  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    const prevCp = i > 0 ? chars[i - 1].codePointAt(0) : 0;
    const joinsPrev = canJoinFromPrev(prevCp);

    if (cp === 0x0644 && i + 1 < chars.length) {
      const next = chars[i + 1].codePointAt(0);
      const la = {
        0x0622: [0xfef5, 0xfef6],
        0x0623: [0xfef7, 0xfef8],
        0x0625: [0xfef9, 0xfefa],
        0x0627: [0xfefb, 0xfefc],
      }[next];
      if (la) {
        out.push(String.fromCodePoint(joinsPrev ? la[1] : la[0]));
        i++;
        continue;
      }
    }

    if (!ARABIC_LETTERS[cp]) {
      out.push(chars[i]);
      continue;
    }

    const nextCp = i + 1 < chars.length ? chars[i + 1].codePointAt(0) : 0;
    const joinsNext =
      canJoinToNext(nextCp) && !RIGHT_JOINING.has(cp) && cp !== 0x0621;

    let f = 0; // isolated
    if (joinsPrev && joinsNext)
      f = 3; // medial
    else if (joinsPrev)
      f = 1; // final
    else if (joinsNext) f = 2; // initial
    out.push(String.fromCodePoint(ARABIC_LETTERS[cp][f]));
  }
  return out.join("");
}

// ---------------------------------------------------------------- BiDi ----
const MIRROR = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
  "«": "»",
  "»": "«",
};

function classify(ch) {
  const c = ch.codePointAt(0);
  if (
    (c >= 0x30 && c <= 0x39) ||
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x61 && c <= 0x7a)
  )
    return "L";
  if (
    (c >= 0x0600 && c <= 0x06ff) ||
    (c >= 0xfb50 && c <= 0xfdff) ||
    (c >= 0xfe70 && c <= 0xfefc)
  )
    return "R";
  return "N";
}

function reorderLine(line) {
  const chars = Array.from(line);
  const types = chars.map(classify);
  if (!types.includes("R")) return line;

  // Neutrals (space, : / . , # -) between two LTR chars stay LTR
  // (dates, times, "25.00", "Developed by: MNA"); every other neutral is RTL.
  for (let i = 0; i < chars.length; i++) {
    if (types[i] !== "N") continue;
    let j = i;
    while (j < chars.length && types[j] === "N") j++;
    const prev = i > 0 ? types[i - 1] : "R";
    const next = j < chars.length ? types[j] : "R";
    const t = prev === "L" && next === "L" ? "L" : "R";
    for (let k = i; k < j; k++) types[k] = t;
    i = j - 1;
  }

  const runs = [];
  chars.forEach((ch, i) => {
    const t = types[i];
    const c = t === "R" && MIRROR[ch] ? MIRROR[ch] : ch;
    const last = runs[runs.length - 1];
    if (last && last.t === t) last.chars.push(c);
    else runs.push({ t, chars: [c] });
  });

  // Visual order for an LTR-only printer: run order reversed,
  // characters reversed only inside Arabic runs.
  return runs
    .reverse()
    .map((r) => (r.t === "R" ? r.chars.reverse() : r.chars).join(""))
    .join("");
}

const bidiReorder = (text) => text.split("\n").map(reorderLine).join("\n");

// --------------------------------------------------------------- CP864 ----
// Built from iconv-lite so every byte is correct for IBM864.
const CP864 = new Map();
for (let b = 0x80; b <= 0xff; b++) {
  const ch = iconv.decode(Buffer.from([b]), "cp864");
  if (ch !== "\uFFFD") CP864.set(ch.codePointAt(0), b);
}

// CP864 has no hamza-below glyphs, so degrade gracefully
const OVERRIDES = {
  0xfe87: 0xfe8d,
  0xfe88: 0xfe8e, // إ -> ا
  0xfef9: 0xfefb,
  0xfefa: 0xfefc, // لإ -> لا
};

// cp -> [iso, final, initial, medial] of the same letter
const FORM_GROUP = new Map();
Object.values(ARABIC_LETTERS).forEach((forms) =>
  forms.forEach((f) => FORM_GROUP.set(f, forms)),
);

function encodeCodePoint(cp) {
  if (cp <= 0x7f) return cp;
  if (CP864.has(cp)) return CP864.get(cp);
  if (OVERRIDES[cp] !== undefined) return encodeCodePoint(OVERRIDES[cp]);

  // CP864 only has some forms of each letter; fall back to the closest one.
  const forms = FORM_GROUP.get(cp);
  if (forms) {
    const idx = forms.indexOf(cp);
    const order = idx >= 2 ? [2, 3, 0, 1] : [0, 1, 2, 3];
    for (const k of order) {
      if (CP864.has(forms[k])) return CP864.get(forms[k]);
    }
  }
  return 0x3f; // '?'
}

/**
 * Unicode string -> CP864 bytes, shaped and visually ordered for an LTR printer.
 * Printer must be set to the CP864 code page (ESC t 22 on most Epson-compatibles).
 */
function toCP864(str, options) {
  const clean = normalize(str, options);
  const visual = bidiReorder(shapeArabic(clean));
  const bytes = [];
  for (const ch of visual) bytes.push(encodeCodePoint(ch.codePointAt(0)));
  return Buffer.from(bytes);
}

module.exports = {
  EscPosEncoder,
  CODEPAGES,
  COLUMNS,
  toCP864,
  UNICODE_TO_CP864: Object.fromEntries(CP864),
};
