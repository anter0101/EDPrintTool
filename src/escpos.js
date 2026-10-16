/**
 * ESC/POS Encoder — chainable command builder for thermal receipt printers.
 *
 * Architecture follows ReceiptPrinterEncoder / node-thermal-printer patterns:
 *   1. Encoder builds a byte buffer (no I/O)
 *   2. Transport layer sends it (printer.js handles that)
 *
 * Text is encoded using 'latin1' (ISO-8859-1) by default, which matches
 * cp1252 for all printable characters. This ensures accented characters
 * like é, ñ, í are sent as single bytes that match the printer's codepage.
 * Sending UTF-8 would produce multi-byte sequences that thermal printers
 * cannot interpret.
 *
 * Usage:
 *   const data = new EscPosEncoder({ columns: 48 })
 *     .initialize()
 *     .align('center').bold(true).line('MY STORE').bold(false)
 *     .rule()
 *     .align('left').line('Item              Qty   Price')
 *     .rule()
 *     .columns(['Widget A', '2', '$9.99'])
 *     .cut()
 *     .encode();
 */

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

/**
 * Arabic Shaping & BiDi Engine for ESC/POS Thermal Printers
 *
 * Thermal printers print strictly Left-to-Right and lack built-in Arabic
 * shaping or BiDi engines. This module handles:
 *   1. Letter shaping (converting raw Unicode 0x0600 to Presentation Forms B)
 *   2. Lam-Alef ligatures (لا, لأ, لإ, لآ)
 *   3. BiDi reordering (Right-to-Left for Arabic words, Left-to-Right for numbers)
 *   4. Direct byte encoding into CP864 (ESC t 22)
 */

// Presentation Forms B mappings for standard Arabic letters [Isolated, Final, Initial, Medial]
const ARABIC_LETTERS = {
  0x0621: [0xFE80, 0xFE80, 0xFE80, 0xFE80], // ء
  0x0622: [0xFE81, 0xFE82, 0xFE81, 0xFE82], // آ (R)
  0x0623: [0xFE83, 0xFE84, 0xFE83, 0xFE84], // أ (R)
  0x0624: [0xFE85, 0xFE86, 0xFE85, 0xFE86], // ؤ (R)
  0x0625: [0xFE87, 0xFE88, 0xFE87, 0xFE88], // إ (R)
  0x0626: [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C], // ئ (D)
  0x0627: [0xFE8D, 0xFE8E, 0xFE8D, 0xFE8E], // ا (R)
  0x0628: [0xFE8F, 0xFE90, 0xFE91, 0xFE92], // ب (D)
  0x0629: [0xFE93, 0xFE94, 0xFE93, 0xFE94], // ة (R)
  0x062A: [0xFE95, 0xFE96, 0xFE97, 0xFE98], // ت (D)
  0x062B: [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C], // ث (D)
  0x062C: [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0], // ج (D)
  0x062D: [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4], // ح (D)
  0x062E: [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8], // خ (D)
  0x062F: [0xFEA9, 0xFEAA, 0xFEA9, 0xFEAA], // د (R)
  0x0630: [0xFEAB, 0xFEAC, 0xFEAB, 0xFEAC], // ذ (R)
  0x0631: [0xFEAD, 0xFEAE, 0xFEAD, 0xFEAE], // ر (R)
  0x0632: [0xFEAF, 0xFEB0, 0xFEAF, 0xFEB0], // ز (R)
  0x0633: [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4], // س (D)
  0x0634: [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8], // ش (D)
  0x0635: [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC], // ص (D)
  0x0636: [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0], // ض (D)
  0x0637: [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4], // ط (D)
  0x0638: [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8], // ظ (D)
  0x0639: [0xFEC9, 0xFECA, 0xFECB, 0xFECC], // ع (D)
  0x063A: [0xFECD, 0xFECE, 0xFECF, 0xFED0], // غ (D)
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640], // ـ
  0x0641: [0xFED1, 0xFED2, 0xFED3, 0xFED4], // ف (D)
  0x0642: [0xFED5, 0xFED6, 0xFED7, 0xFED8], // ق (D)
  0x0643: [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC], // ك (D)
  0x0644: [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0], // ل (D)
  0x0645: [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4], // م (D)
  0x0646: [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8], // ن (D)
  0x0647: [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC], // ه (D)
  0x0648: [0xFEED, 0xFEEE, 0xFEED, 0xFEEE], // و (R)
  0x0649: [0xFEEF, 0xFEF0, 0xFEEF, 0xFEF0], // ى (R)
  0x064A: [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4], // ي (D)
};

// Letters that only join to the right (never to the left/following character)
const RIGHT_JOINING = new Set([
  0x0622, 0x0623, 0x0624, 0x0625, 0x0627, 0x0629,
  0x062F, 0x0630, 0x0631, 0x0632, 0x0648, 0x0649
]);

function connectsPreceding(cp) {
  return ARABIC_LETTERS[cp] && cp !== 0x0621;
}

function connectsSucceeding(cp) {
  return ARABIC_LETTERS[cp] && !RIGHT_JOINING.has(cp) && cp !== 0x0621;
}

/**
 * Shape raw Arabic characters into connected Presentation Forms
 */
function shapeArabic(text) {
  const chars = Array.from(text);
  const shaped = [];

  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);

    // Lam-Alef ligatures
    if (cp === 0x0644 && i + 1 < chars.length) {
      const nextCp = chars[i + 1].codePointAt(0);
      let la = null;
      if (nextCp === 0x0622) la = [0xFEF5, 0xFEF6];      // لآ
      else if (nextCp === 0x0623) la = [0xFEF7, 0xFEF8]; // لأ
      else if (nextCp === 0x0625) la = [0xFEF9, 0xFEFA]; // لإ
      else if (nextCp === 0x0627) la = [0xFEFB, 0xFEFC]; // لا
      if (la) {
        const prevCp = i > 0 ? chars[i - 1].codePointAt(0) : 0;
        const joinsPrev = connectsSucceeding(prevCp);
        shaped.push(String.fromCodePoint(joinsPrev ? la[1] : la[0]));
        i++; // skip the Alef
        continue;
      }
    }

    if (!ARABIC_LETTERS[cp]) {
      shaped.push(chars[i]);
      continue;
    }

    const prevCp = i > 0 ? chars[i - 1].codePointAt(0) : 0;
    const nextCp = i + 1 < chars.length ? chars[i + 1].codePointAt(0) : 0;

    const joinsPrev = connectsSucceeding(prevCp);
    const joinsNext = connectsPreceding(nextCp) && !RIGHT_JOINING.has(cp);

    let formIdx = 0; // Isolated
    if (joinsPrev && joinsNext) formIdx = 3; // Medial
    else if (joinsPrev) formIdx = 1;         // Final
    else if (joinsNext) formIdx = 2;         // Initial

    const mapped = ARABIC_LETTERS[cp][formIdx];
    shaped.push(String.fromCodePoint(mapped));
  }
  return shaped.join('');
}

/**
 * Reorder text for Left-to-Right thermal printing.
 * Arabic words are reversed so they read Right-to-Left on paper,
 * while numbers and English tokens stay in their natural LTR order.
 */
function bidiReorder(text) {
  const lines = text.split('\n');
  return lines.map(line => {
    if (!/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFC]/.test(line)) return line;

    const tokens = [];
    const re = /([\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFC]+|[0-9]+(?:\.[0-9]+)?|[^\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFC0-9]+)/gu;
    let m;
    while ((m = re.exec(line)) !== null) {
      const s = m[0];
      const isAr = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFC]/.test(s);
      tokens.push({ s, isAr });
    }

    tokens.reverse();
    return tokens.map(t => {
      if (t.isAr) {
        return Array.from(t.s).reverse().join('');
      }
      return t.s;
    }).join('');
  }).join('\n');
}

/**
 * Complete Unicode (Presentation Forms B) → CP864 byte map
 */
const UNICODE_TO_CP864 = {
  0x00A0: 0xA0, 0x00B0: 0x80, 0x00B7: 0x81, 0x00AB: 0x97, 0x00BB: 0x98,
  0x060C: 0xAC, 0x061B: 0xBB, 0x061F: 0xBF, 0x0640: 0xE0,
  0x064B: 0xEB, 0x064C: 0xEC, 0x064D: 0xED, 0x064E: 0xEE, 0x064F: 0xEF,
  0x0650: 0xF0, 0x0651: 0xF1, 0x0652: 0xF2,
  0x0660: 0xB0, 0x0661: 0xB1, 0x0662: 0xB2, 0x0663: 0xB3, 0x0664: 0xB4,
  0x0665: 0xB5, 0x0666: 0xB6, 0x0667: 0xB7, 0x0668: 0xB8, 0x0669: 0xB9, 0x066A: 0x25,
  // Presentation forms B
  0xFE80: 0xC1, // ء
  0xFE81: 0xC2, 0xFE82: 0xA2, // آ
  0xFE83: 0xC3, 0xFE84: 0xA5, // أ
  0xFE85: 0xC4, // ؤ
  0xFE87: 0xC5, 0xFE88: 0xC5, // إ
  0xFE8B: 0xC6, 0xFE8C: 0xC6, // ئ
  0xFE8D: 0xC7, 0xFE8E: 0xA8, // ا
  0xFE8F: 0xA9, 0xFE90: 0xA9, 0xFE91: 0xC8, 0xFE92: 0xC8, // ب
  0xFE93: 0xC9, 0xFE94: 0xC9, // ة
  0xFE95: 0xAA, 0xFE96: 0xAA, 0xFE97: 0xCA, 0xFE98: 0xCA, // ت
  0xFE99: 0xAB, 0xFE9A: 0xAB, 0xFE9B: 0xCB, 0xFE9C: 0xCB, // ث
  0xFE9D: 0xAD, 0xFE9E: 0xAD, 0xFE9F: 0xCC, 0xFEA0: 0xCC, // ج
  0xFEA1: 0xAE, 0xFEA2: 0xAE, 0xFEA3: 0xCD, 0xFEA4: 0xCD, // ح
  0xFEA5: 0xAF, 0xFEA6: 0xAF, 0xFEA7: 0xCE, 0xFEA8: 0xCE, // خ
  0xFEA9: 0xCF, 0xFEAA: 0xCF, // د
  0xFEAB: 0xD0, 0xFEAC: 0xD0, // ذ
  0xFEAD: 0xD1, 0xFEAE: 0xD1, // ر
  0xFEAF: 0xD2, 0xFEB0: 0xD2, // ز
  0xFEB1: 0xBC, 0xFEB2: 0xBC, 0xFEB3: 0xD3, 0xFEB4: 0xD3, // س
  0xFEB5: 0xBD, 0xFEB6: 0xBD, 0xFEB7: 0xD4, 0xFEB8: 0xD4, // ش
  0xFEB9: 0xBE, 0xFEBA: 0xBE, 0xFEBB: 0xD5, 0xFEBC: 0xD5, // ص
  0xFEBD: 0xEB, 0xFEBE: 0xEB, 0xFEBF: 0xD6, 0xFEC0: 0xD6, // ض
  0xFEC1: 0xD7, 0xFEC2: 0xD7, 0xFEC3: 0xD7, 0xFEC4: 0xD7, // ط
  0xFEC5: 0xD8, 0xFEC6: 0xD8, 0xFEC7: 0xD8, 0xFEC8: 0xD8, // ظ
  0xFEC9: 0xDF, 0xFECA: 0xC5, 0xFECB: 0xD9, 0xFECC: 0xEC, // ع
  0xFECD: 0xEE, 0xFECE: 0xED, 0xFECF: 0xDA, 0xFED0: 0xF7, // غ
  0xFED1: 0xBA, 0xFED2: 0xBA, 0xFED3: 0xE1, 0xFED4: 0xE1, // ف
  0xFED5: 0xF8, 0xFED6: 0xF8, 0xFED7: 0xE2, 0xFED8: 0xE2, // ق
  0xFED9: 0xFC, 0xFEDA: 0xFC, 0xFEDB: 0xE3, 0xFEDC: 0xE3, // ك
  0xFEDD: 0xFB, 0xFEDE: 0xFB, 0xFEDF: 0xE4, 0xFEE0: 0xE4, // ل
  0xFEE1: 0xEF, 0xFEE2: 0xEF, 0xFEE3: 0xE5, 0xFEE4: 0xE5, // م
  0xFEE5: 0xF2, 0xFEE6: 0xF2, 0xFEE7: 0xE6, 0xFEE8: 0xE6, // ن
  0xFEE9: 0xF3, 0xFEEA: 0xF3, 0xFEEB: 0xE7, 0xFEEC: 0xF4, // ه
  0xFEED: 0xE8, 0xFEEE: 0xE8, // و
  0xFEEF: 0xE9, 0xFEF0: 0xF5, // ى
  0xFEF1: 0xFD, 0xFEF2: 0xF6, 0xFEF3: 0xEA, 0xFEF4: 0xEA, // ي
  0xFEF5: 0xF9, 0xFEF6: 0xFA, // لأ Madda
  0xFEF7: 0xF9, 0xFEF8: 0xFA, // لأ Hamza
  0xFEF9: 0xF9, 0xFEFA: 0xFA, // لإ Hamza
  0xFEFB: 0x9D, 0xFEFC: 0x9E, // لا
};

/**
 * Convert a Unicode string to a CP864 byte Buffer with full Arabic shaping & BiDi reversal.
 *
 * @param {string} str
 * @returns {Buffer}
 */
function toCP864(str) {
  const shaped = shapeArabic(str);
  const reordered = bidiReorder(shaped);
  const bytes = [];
  for (const ch of reordered) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x7F) {
      bytes.push(cp);
    } else if (UNICODE_TO_CP864[cp] !== undefined) {
      bytes.push(UNICODE_TO_CP864[cp]);
    } else {
      bytes.push(0x3F); // '?'
    }
  }
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
    // Track the active codepage name for auto-conversion (e.g. Arabic cp864)
    if (typeof name === 'string') this._activeCodepage = name;
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
   * converted to their CP864 byte equivalents via the UNICODE_TO_CP864 table.
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

module.exports = { EscPosEncoder, CODEPAGES, COLUMNS, toCP864, UNICODE_TO_CP864 };

