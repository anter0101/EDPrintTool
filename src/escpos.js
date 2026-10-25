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

// Common code pages: id → ESC t argument
const CODEPAGES = {
  cp437:  0,  // US (default on most printers)
  cp850:  2,  // Multilingual Latin I
  cp858: 19,  // Latin I + Euro sign
  cp860:  3,  // Portuguese
  cp863:  4,  // Canadian French
  cp865:  5,  // Nordic
  cp1252: 16, // Windows Latin 1
  cp864:  22, // Arabic (Epson ESC t argument 22)
};

// Paper width → default character columns (Font A, 12x24)
const COLUMNS = {
  '80mm': 48,
  '72mm': 42,
  '58mm': 32,
};

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

class EscPosEncoder {
  /**
   * @param {object} [options]
   * @param {string} [options.paperWidth='80mm'] - '80mm', '72mm', or '58mm'
   * @param {number} [options.columns] - override character columns
   * @param {string} [options.codepage] - default code page name
   */
  constructor(options = {}) {
    this._parts = [];
    this._columns = options.columns || COLUMNS[options.paperWidth] || 48;
    this._codepage = options.codepage || null;
    // Tracks the currently active codepage name so text methods can
    // auto-convert Arabic Unicode → CP864 bytes when cp864 is active.
    this._activeCodepage = this._codepage;
    // Use latin1 encoding — maps 1:1 to the lower 256 Unicode codepoints
    // which covers all cp1252/ISO-8859-1 printable characters (á, é, ñ, etc.)
    this._textEncoding = 'latin1';
  }

  // ─── Printer control ──────────────────────────────────────

  /** ESC @ — Reset printer to defaults + FS . — Cancel Chinese/Kanji double-byte mode */
  initialize() {
    // ESC @ (Reset) + FS . (Cancel Chinese/Kanji mode so 0x80-0xFF bytes are not grouped as Chinese chars)
    this._parts.push(Buffer.from([0x1B, 0x40, 0x1C, 0x2E]));
    if (this._codepage && CODEPAGES[this._codepage] !== undefined) {
      this.codepage(this._codepage);
    }
    return this;
  }

  /** FS . — Cancel Chinese / Kanji character mode */
  cancelKanji() {
    this._parts.push(Buffer.from([0x1C, 0x2E]));
    return this;
  }

  /** ESC t n — Select character code page */
  codepage(name) {
    const n = typeof name === 'number' ? name : (CODEPAGES[name] ?? 0);
    // Send FS . (0x1C 0x2E) before ESC t to ensure Chinese mode is disabled
    this._parts.push(Buffer.from([0x1C, 0x2E, 0x1B, 0x74, n & 0xFF]));
    // For Arabic CP864, automatically set right-side character spacing to 0 (ESC SP 0)
    // so cursive connecting strokes connect seamlessly without any gaps
    if (name === 'cp864' || n === 22) {
      this.charSpacing(0);
    }
    // Track the active codepage name for auto-conversion (e.g. Arabic cp864)
    if (typeof name === 'string') this._activeCodepage = name;
    return this;
  }

  /** ESC SP n — Set right-side character spacing in dots (0 removes gaps between letters) */
  charSpacing(dots = 0) {
    this._parts.push(Buffer.from([0x1B, 0x20, Math.max(0, Math.min(255, dots))]));
    return this;
  }

  // ─── Text formatting ──────────────────────────────────────

  /** ESC a n — Set justification (0=left, 1=center, 2=right) */
  align(mode) {
    const n = mode === 'center' ? 1 : mode === 'right' ? 2 : 0;
    this._parts.push(Buffer.from([0x1B, 0x61, n]));
    return this;
  }

  /** ESC E n — Bold on/off */
  bold(on = true) {
    this._parts.push(Buffer.from([0x1B, 0x45, on ? 1 : 0]));
    return this;
  }

  /** ESC - n — Underline (0=off, 1=thin, 2=thick) */
  underline(on = true) {
    this._parts.push(Buffer.from([0x1B, 0x2D, on === true ? 1 : (on || 0)]));
    return this;
  }

  /** ESC M n — Select font (0=Font A 12x24, 1=Font B 9x17) */
  font(n = 0) {
    this._parts.push(Buffer.from([0x1B, 0x4D, n & 1]));
    return this;
  }

  /**
   * GS ! n — Character size multiplier.
   * @param {number} width  1-8 (multiplier)
   * @param {number} height 1-8 (multiplier)
   */
  textSize(width = 1, height = 1) {
    const w = Math.max(0, Math.min(7, width - 1));
    const h = Math.max(0, Math.min(7, height - 1));
    this._parts.push(Buffer.from([0x1D, 0x21, (w << 4) | h]));
    return this;
  }

  /** ESC G n — Double-strike on/off */
  doubleStrike(on = true) {
    this._parts.push(Buffer.from([0x1B, 0x47, on ? 1 : 0]));
    return this;
  }

  /** GS B n — Reverse (white on black) on/off */
  invert(on = true) {
    this._parts.push(Buffer.from([0x1D, 0x42, on ? 1 : 0]));
    return this;
  }

  // ─── Content ──────────────────────────────────────────────

  /**
   * Encode a string to bytes using the active codepage.
   * When cp864 is active, Arabic Unicode characters are automatically
   * converted to CP864 bytes with shaping and BiDi reordering.
   * For all other codepages, latin1 (1:1 byte pass-through) is used.
   *
   * @param {string} str
   * @returns {Buffer}
   */
  _encodeStr(str) {
    if (this._activeCodepage === 'cp864') {
      return toCP864(str);
    }
    return Buffer.from(str, this._textEncoding);
  }

  /** Write text without newline */
  text(str) {
    this._parts.push(this._encodeStr(str));
    return this;
  }

  /** Write text followed by newline */
  line(str) {
    this._parts.push(this._encodeStr(str + '\n'));
    return this;
  }

  /** Write a newline */
  newline() {
    this._parts.push(Buffer.from('\n'));
    return this;
  }

  /**
   * Write pre-formatted content (string or Buffer).
   * Use this for raw receipt text from the API.
   */
  raw(content) {
    if (Buffer.isBuffer(content)) {
      this._parts.push(content);
    } else {
      this._parts.push(this._encodeStr(content));
    }
    return this;
  }

  /** Print a horizontal rule filling the full paper width */
  rule(char = '-') {
    this._parts.push(this._encodeStr(char[0].repeat(this._columns) + '\n'));
    return this;
  }

  /**
   * Print a row of columns, auto-spaced to fill the paper width.
   * Last column is right-aligned, others are left-aligned.
   *
   * Example: columns(['Widget A', '2', '$9.99'])
   *          → "Widget A          2     $9.99"
   *
   * @param {string[]} cols - array of column values
   * @param {number[]} [widths] - optional explicit widths (must sum to columns)
   */
  columns(cols, widths) {
    const n = cols.length;
    if (n === 0) return this.newline();
    if (n === 1) return this.line(cols[0]);

    if (!widths) {
      // Auto-distribute: first column gets most space, rest get equal share
      const rightWidth = Math.max(10, Math.floor(this._columns / n));
      const leftWidth = this._columns - rightWidth * (n - 1);
      widths = [leftWidth, ...Array(n - 1).fill(rightWidth)];
    }

    let row = '';
    for (let i = 0; i < n; i++) {
      const val = String(cols[i]);
      const w = widths[i];
      if (i === n - 1) {
        // Last column: right-align
        row += val.length >= w ? val.slice(0, w) : val.padStart(w);
      } else {
        // Other columns: left-align
        row += val.length >= w ? val.slice(0, w) : val.padEnd(w);
      }
    }

    this._parts.push(this._encodeStr(row + '\n'));
    return this;
  }

  /**
   * Print a key-value pair with dots or spaces between.
   * Example: pair('Subtotal', '$37.47') → "Subtotal................$37.47"
   */
  pair(left, right, fill = '.') {
    const gap = this._columns - left.length - right.length;
    const middle = gap > 0 ? fill[0].repeat(gap) : ' ';
    this._parts.push(this._encodeStr(left + middle + right + '\n'));
    return this;
  }

  /** Insert an empty line (line feed) */
  empty() {
    this._parts.push(Buffer.from('\n'));
    return this;
  }

  // ─── Paper handling ───────────────────────────────────────

  /** ESC d n — Feed n lines */
  feed(lines = 1) {
    this._parts.push(Buffer.from([0x1B, 0x64, Math.min(lines, 255)]));
    return this;
  }

  /**
   * Cut paper — sends multiple cut command formats for maximum compatibility.
   *
   * Strategy: feed first, then send BOTH legacy Epson cut (ESC i / ESC m)
   * AND standard GS V. The printer responds to whichever it understands
   * and ignores the rest. This covers:
   *   - Epson TM series (GS V)
   *   - Star TSP in ESC/POS emulation (ESC i / ESC m)
   *   - Budget/generic Chinese printers (usually one of the above)
   *
   * @param {'full'|'partial'} [type='partial']
   * @param {number} [feedLines=4] - lines to feed before cutting
   */
  cut(type = 'partial', feedLines = 4) {
    // Feed lines first (ESC d n)
    if (feedLines > 0) {
      this._parts.push(Buffer.from([0x1B, 0x64, Math.min(feedLines, 255)]));
    }
    // GS V Function A — the most standard cut command
    const m = type === 'full' ? 0x00 : 0x01;
    this._parts.push(Buffer.from([0x1D, 0x56, m]));
    return this;
  }

  // ─── Peripheral ───────────────────────────────────────────

  /**
   * ESC p m t1 t2 — Open cash drawer.
   * @param {number} [pin=0] - 0 = pin 2 (drawer 1), 1 = pin 5 (drawer 2)
   */
  openCashDrawer(pin = 0) {
    this._parts.push(Buffer.from([0x1B, 0x70, pin & 1, 25, 250]));
    return this;
  }

  // ─── Images ─────────────────────────────────────────────

  // Max print width in dots per paper size (203 dpi print heads)
  static IMAGE_WIDTHS = { '80mm': 576, '72mm': 512, '58mm': 384 };

  /**
   * GS v 0 — Print a 1-bit raster image.
   *
   * The caller must provide pre-processed 1-bit monochrome pixel data:
   *   - Each bit = 1 pixel (1=black, 0=white), MSB first
   *   - Rows are packed left-to-right, top-to-bottom
   *   - Each row is (width / 8) bytes, padded to byte boundary
   *   - Total data length must equal (width / 8) * height bytes
   *
   * @param {string} data - base64-encoded raw 1-bit pixel data (NOT a PNG/BMP file)
   * @param {object} [options]
   * @param {number} options.width - image width in pixels (must be multiple of 8)
   * @param {number} [options.height] - image height in pixels (auto-calculated if omitted)
   * @param {number} [options.mode=0] - 0=normal, 1=double width, 2=double height, 3=both
   */
  image(data, options = {}) {
    if (!data) throw new Error('image: missing data (base64-encoded 1-bit pixel data)');

    const imageBytes = Buffer.from(data, 'base64');
    if (imageBytes.length === 0) throw new Error('image: data is empty after base64 decode');

    const width = options.width;
    if (!width || width <= 0) throw new Error('image: width is required and must be > 0');
    if (width % 8 !== 0) throw new Error(`image: width must be a multiple of 8, got ${width}`);

    const bytesPerLine = width / 8;
    const height = options.height || Math.floor(imageBytes.length / bytesPerLine);

    if (height <= 0) throw new Error('image: calculated height is 0 — check width and data length');

    const expectedLen = bytesPerLine * height;
    if (imageBytes.length < expectedLen) {
      throw new Error(`image: data too short — expected ${expectedLen} bytes (${width}x${height} at 1bpp), got ${imageBytes.length}`);
    }

    if (width > 4096) throw new Error(`image: width ${width} exceeds maximum of 4096 pixels`);
    if (height > 4096) throw new Error(`image: height ${height} exceeds maximum of 4096 pixels`);

    const mode = Math.max(0, Math.min(3, options.mode || 0));

    // GS v 0 m xL xH yL yH data
    const xL = bytesPerLine & 0xFF;
    const xH = (bytesPerLine >> 8) & 0xFF;
    const yL = height & 0xFF;
    const yH = (height >> 8) & 0xFF;

    this._parts.push(Buffer.from([0x1D, 0x76, 0x30, mode, xL, xH, yL, yH]));
    // Only send exactly the expected bytes (ignore any trailing data)
    this._parts.push(imageBytes.subarray(0, expectedLen));
    return this;
  }

  // ─── Barcodes & 2D codes ─────────────────────────────────

  /**
   * GS k — Print a 1D barcode.
   * @param {string} data - barcode data
   * @param {object} [options]
   * @param {string} [options.type='CODE128'] - barcode type
   * @param {number} [options.height=80] - barcode height in dots (1-255)
   * @param {number} [options.width=2] - bar width (2-6)
   * @param {string} [options.hri='below'] - HRI position: 'none','above','below','both'
   */
  barcode(data, options = {}) {
    const type = (options.type || 'CODE128').toUpperCase();
    const height = Math.max(1, Math.min(255, options.height || 80));
    const width = Math.max(2, Math.min(6, options.width || 2));
    const hriMap = { none: 0, above: 1, below: 2, both: 3 };
    const hri = hriMap[options.hri || 'below'] ?? 2;

    const typeMap = {
      'UPC-A': 65, 'UPC-E': 66, 'EAN13': 67, 'EAN8': 68,
      'CODE39': 69, 'ITF': 70, 'CODABAR': 71, 'CODE93': 72,
      'CODE128': 73,
    };
    const m = typeMap[type];
    if (m === undefined) return this;

    // GS h n — set barcode height
    this._parts.push(Buffer.from([0x1D, 0x68, height]));
    // GS w n — set barcode width
    this._parts.push(Buffer.from([0x1D, 0x77, width]));
    // GS H n — set HRI position
    this._parts.push(Buffer.from([0x1D, 0x48, hri]));
    // GS k m n data — print barcode (Function B format)
    const dataBytes = Buffer.from(data, 'ascii');
    this._parts.push(Buffer.from([0x1D, 0x6B, m, dataBytes.length]));
    this._parts.push(dataBytes);
    return this;
  }

  /**
   * GS ( k — Print a QR code.
   * @param {string} data - QR code content
   * @param {object} [options]
   * @param {number} [options.size=6] - module size (1-16)
   * @param {string} [options.errorCorrection='M'] - error correction: 'L','M','Q','H'
   */
  qrcode(data, options = {}) {
    const size = Math.max(1, Math.min(16, options.size || 6));
    const ecMap = { L: 48, M: 49, Q: 50, H: 51 };
    const ec = ecMap[(options.errorCorrection || 'M').toUpperCase()] ?? 49;
    const dataBytes = Buffer.from(data, 'utf8');

    // QR Code: function 165 — select model 2
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, 4, 0, 0x31, 0x41, 50, 0]));
    // QR Code: function 167 — set module size
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x43, size]));
    // QR Code: function 169 — set error correction
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x45, ec]));
    // QR Code: function 180 — store data
    const storeLen = dataBytes.length + 3;
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, storeLen & 0xFF, (storeLen >> 8) & 0xFF, 0x31, 0x50, 0x30]));
    this._parts.push(dataBytes);
    // QR Code: function 181 — print
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, 3, 0, 0x31, 0x51, 0x30]));
    return this;
  }

  /**
   * GS ( k — Print a PDF417 barcode.
   * @param {string} data - PDF417 content
   * @param {object} [options]
   * @param {number} [options.columns=0] - number of columns (0=auto, 1-30)
   * @param {number} [options.rows=0] - number of rows (0=auto, 3-90)
   * @param {number} [options.width=3] - module width (2-8)
   * @param {number} [options.height=3] - row height (2-8)
   * @param {number} [options.errorCorrection=1] - error correction level (0-8)
   */
  pdf417(data, options = {}) {
    const columns = Math.max(0, Math.min(30, options.columns || 0));
    const rows = Math.max(0, Math.min(90, options.rows || 0));
    const width = Math.max(2, Math.min(8, options.width || 3));
    const height = Math.max(2, Math.min(8, options.height || 3));
    const ec = Math.max(0, Math.min(8, options.errorCorrection ?? 1));
    const dataBytes = Buffer.from(data, 'utf8');

    // PDF417: function 65 — set number of columns
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, 3, 0, 0x30, 0x41, columns]));
    // PDF417: function 66 — set number of rows
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, 3, 0, 0x30, 0x42, rows]));
    // PDF417: function 67 — set module width
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, 3, 0, 0x30, 0x43, width]));
    // PDF417: function 68 — set row height
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, 3, 0, 0x30, 0x44, height]));
    // PDF417: function 69 — set error correction level
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, 4, 0, 0x30, 0x45, 48 + ec, 0]));
    // PDF417: function 80 — store data
    const storeLen = dataBytes.length + 3;
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, storeLen & 0xFF, (storeLen >> 8) & 0xFF, 0x30, 0x50, 0x30]));
    this._parts.push(dataBytes);
    // PDF417: function 81 — print
    this._parts.push(Buffer.from([0x1D, 0x28, 0x6B, 3, 0, 0x30, 0x51, 0x30]));
    return this;
  }

  // ─── Low-level ────────────────────────────────────────────

  /** Append raw bytes (array or Buffer) */
  bytes(data) {
    this._parts.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    return this;
  }

  /** Build and return the final Buffer */
  encode() {
    return Buffer.concat(this._parts);
  }

  /** The configured column width */
  get columnWidth() {
    return this._columns;
  }
}

module.exports = {
  EscPosEncoder,
  CODEPAGES,
  COLUMNS,
  toCP864,
  UNICODE_TO_CP864: Object.fromEntries(CP864),
};
