# EDPrintTool — Frontend ESC/POS Commands & Integration Guide

A complete reference guide for frontend developers integrating thermal receipt printing into web applications (React, Vue, Next.js, Angular, or vanilla JavaScript) using **EDPrintTool**.

---

## Table of Contents
1. [Quick Start & Integration](#1-quick-start--integration)
2. [API Request Format](#2-api-request-format)
3. [Command Reference Table](#3-command-reference-table)
4. [Arabic & Multilingual Printing](#4-arabic--multilingual-printing)
5. [Logo & Image Printing](#5-logo--image-printing)
6. [Complete Production Examples](#6-complete-production-examples)
7. [TypeScript / React Hook Example](#7-typescript--react-hook-example)

---

## 1. Quick Start & Integration

EDPrintTool exposes a local HTTP REST API on port `8765`. Any frontend running in the browser can send print jobs directly via `fetch`.

```javascript
async function printReceipt(printerId, commands) {
  const response = await fetch(`http://localhost:8765/printers/${printerId}/escpos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands })
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Print failed');
  return result;
}
```

---

## 2. API Request Format

### Endpoint
`POST http://localhost:8765/printers/{printerId}/escpos`

### Headers
`Content-Type: application/json`

### Body
```json
{
  "commands": [
    ["initialize"],
    ["align", "center"],
    ["line", "MY STORE"],
    ["cut"]
  ]
}
```

Each command is an array where:
- Index `0` is the **command name** (`string`)
- Subsequent elements are **arguments** passed to that command.

---

## 3. Command Reference Table

### Printer Control & Setup
| Command | Arguments | Description | Example |
|---|---|---|---|
| `initialize` | None | Resets printer to defaults and cancels Chinese double-byte mode (`FS .`). Always call this first. | `["initialize"]` |
| `codepage` | `name` (`string` \| `number`) | Selects character code page. For Arabic, use `"cp864"`. | `["codepage", "cp864"]` |
| `charSpacing` | `dots` (`number`, 0–255) | Sets right-side character spacing. Use `0` for Arabic so letters connect smoothly. | `["charSpacing", 0]` |
| `font` | `0` \| `1` | Selects hardware font: `0` = Font A (12×24 standard), `1` = Font B (9×17 compact). | `["font", 0]` |

### Text Formatting & Layout
| Command | Arguments | Description | Example |
|---|---|---|---|
| `align` | `"left"` \| `"center"` \| `"right"` | Sets line justification. | `["align", "center"]` |
| `bold` | `true` \| `false` | Enables or disables bold text. | `["bold", true]` |
| `underline` | `true` \| `false` \| `1` \| `2` | `1` = thin underline, `2` = thick underline, `false` = off. | `["underline", true]` |
| `textSize` | `width` (1–8), `height` (1–8) | Multiplies character width and height. `(1,1)` is standard, `(2,2)` is double-size. | `["textSize", 2, 2]` |
| `invert` | `true` \| `false` | Prints white text on black background (reverse video). | `["invert", true]` |
| `doubleStrike` | `true` \| `false` | Enables or disables double-strike mode for heavier text. | `["doubleStrike", true]` |

### Text & Table Content
| Command | Arguments | Description | Example |
|---|---|---|---|
| `line` | `text` (`string`) | Prints text followed by a newline. Arabic text is automatically shaped and reordered RTL. | `["line", "فاتورة ضريبية"]` |
| `text` | `text` (`string`) | Prints text without advancing to the next line. | `["text", "Total: "]` |
| `newline` | None | Prints an empty line feed. | `["newline"]` |
| `empty` | None | Alias for `newline`. | `["empty"]` |
| `rule` | `char` (`string`, optional) | Prints a full-width divider using the specified character (default `"-"`). | `["rule", "-"]` |
| `pair` | `left`, `right`, `fill` (`string`) | Prints a key-value row with filler characters (`"."` or `" "`). | `["pair", "15.00 ج.م", "شاورما دجاج", "."]` |
| `columns` | `cols` (`string[]`), `widths?` (`number[]`) | Prints table columns auto-spaced or with explicit column widths (must sum to paper width, e.g. 48). | `["columns", ["15.00", "1", "شاورما"], [12, 6, 30]]` |
| `raw` | `content` (`string` \| `Buffer`) | Sends raw string or buffer directly through encoder. | `["raw", "Preformatted text\n"]` |

### Paper Handling & Cash Drawer
| Command | Arguments | Description | Example |
|---|---|---|---|
| `feed` | `lines` (`number`, 1–255) | Feeds paper by `n` lines. | `["feed", 2]` |
| `cut` | `type?` (`"partial"` \| `"full"`), `feedLines?` (`number`) | Cuts paper. Default: `"partial"`, 4 lines feed. | `["cut", "partial", 4]` |
| `openCashDrawer` | `pin?` (`0` \| `1`) | Triggers the cash drawer kick-out pin (`0` = Drawer 1, `1` = Drawer 2). | `["openCashDrawer", 0]` |

### Graphics, Barcodes & QR Codes
| Command | Arguments | Description | Example |
|---|---|---|---|
| `image` | `base64Data`, `options` | Prints a 1-bit monochrome raster image. `options.width` is required (must be multiple of 8). | `["image", "<BASE64_DATA>", { "width": 256 }]` |
| `qrcode` | `data`, `options?` | Prints a 2D QR Code. Options: `size` (1–16, default 6), `errorCorrection` (`"L"`, `"M"`, `"Q"`, `"H"`). | `["qrcode", "https://example.com/inv/1", { "size": 6 }]` |
| `barcode` | `data`, `options?` | Prints a 1D barcode (`CODE128`, `EAN13`, `UPC-A`, `CODE39`). | `["barcode", "123456789012", { "type": "EAN13", "height": 80 }]` |
| `pdf417` | `data`, `options?` | Prints a PDF417 2D barcode. | `["pdf417", "DataString", { "width": 3, "height": 3 }]` |

---

## 4. Arabic & Multilingual Printing

### 1. Requirements for Arabic
Always include these two commands after `initialize`:
```json
["initialize"],
["codepage", "cp864"],
["charSpacing", 0]
```
- **`cp864`**: Activates Code Page 864 (standard Arabic thermal printer ROM).
- **`charSpacing: 0`**: Removes gaps between letters so Arabic cursive strokes connect seamlessly.
- **Automatic Letter Shaping**: EDPrintTool automatically converts Arabic characters into connected Presentation Forms (Initial, Medial, Final, Isolated) and handles Lam-Alef ligatures (`لا`).
- **Automatic RTL BiDi Reordering**: Words are reversed for Left-to-Right thermal printheads so they read correctly Right-to-Left on paper, while numbers (`12.50`, `#1042`, `2026/10/16`) remain in natural LTR order.

### 2. Column & Pair Orientation in Arabic
Thermal printers print from **physical left to physical right**.
In Arabic receipts, the reader looks at the **right side first** (Item Name) and the **left side second** (Price/Quantity):

#### For `pair`:
```json
["pair", "17.00 ج.م", "ساندوتش جبنة رومى", " "]
// Result on paper:
// [Physical Left]                              [Physical Right]
// 17.00 ج.م                                  ساندوتش جبنة رومى
```

#### For `columns` on 80mm paper (48 total character width):
```json
["columns", ["السعر", "الكمية", "الصنف"], [12, 6, 30]]
// Column 0 (width 12): Left column (Price)
// Column 1 (width 6): Middle column (Quantity)
// Column 2 (width 30): Right column (Item Name)
```

### 3. Font A vs Font B
- **`["font", 0]` (Font A)**: 12×24 dots. Recommended for Arabic — letters are thicker and connecting strokes are bold and smooth.
- **`["font", 1]` (Font B)**: 9×17 dots. More compact (up to 64 columns), good for dense item tables.

---

## 5. Logo & Image Printing

Thermal printers cannot print raw PNG or JPEG files directly. They require **1-bit monochrome raster data** (1 bit per pixel: 1 = black thermal burn, 0 = white paper).

### Browser / Frontend Image Converter Helper
Copy and paste this helper function into your frontend project:

```javascript
/**
 * Convert any image (PNG, JPG, SVG, WebP) to 1-bit monochrome ESC/POS base64 data.
 * @param {string | File | Blob} source - Image URL, Data URL, or File object
 * @param {number} targetWidth - Desired pixel width (must be multiple of 8, e.g. 256, 384, 512)
 * @param {number} threshold - Luminance threshold (0–255, default 180)
 * @returns {Promise<{ base64: string, width: number, height: number }>}
 */
export function convertImageToEscPos(source, targetWidth = 256, threshold = 180) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      // Ensure target width is a multiple of 8
      const width = Math.floor(targetWidth / 8) * 8;
      const scale = width / img.width;
      const height = Math.floor(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // Transparent PNG background to white
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const imgData = ctx.getImageData(0, 0, width, height);
      const rgba = imgData.data;
      const bytesPerLine = width / 8;
      const rasterBytes = new Uint8Array(bytesPerLine * height);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];
          const a = rgba[idx + 3];

          // Luminance formula
          const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

          // If dark pixel and not transparent, set bit to 1 (black dot)
          if (brightness < threshold && a > 50) {
            const byteIdx = y * bytesPerLine + Math.floor(x / 8);
            const bitIdx = 7 - (x % 8);
            rasterBytes[byteIdx] |= (1 << bitIdx);
          }
        }
      }

      // Convert Uint8Array to base64
      let binary = '';
      for (let i = 0; i < rasterBytes.length; i++) {
        binary += String.fromCharCode(rasterBytes[i]);
      }

      resolve({
        base64: btoa(binary),
        width,
        height
      });
    };

    img.onerror = (err) => reject(new Error('Failed to load image for conversion: ' + err));

    if (source instanceof Blob || source instanceof File) {
      img.src = URL.createObjectURL(source);
    } else {
      img.src = source;
    }
  });
}
```

---

## 6. Complete Production Examples

### Example A: Full Arabic Restaurant Order Receipt

```javascript
import { convertImageToEscPos } from './escpos-helpers';

async function printArabicOrder(printerId, order) {
  // Convert logo (or pass cached base64)
  const logo = await convertImageToEscPos('/images/restaurant-logo.png', 256);

  const commands = [
    // 1. Reset and configure Arabic
    ['initialize'],
    ['font', 0],               // Font A (recommended for Arabic)
    ['codepage', 'cp864'],     // Arabic CP864
    ['charSpacing', 0],        // Seamless letter joining

    // 2. Header & Logo
    ['align', 'center'],
    ['image', logo.base64, { width: logo.width }],
    ['feed', 1],
    ['bold', true],
    ['textSize', 2, 2],
    ['line', order.storeName], // e.g. "مطعم البركة"
    ['textSize', 1, 1],
    ['bold', false],
    ['line', `طلب صالة - طاولة رقم ${order.tableNumber}`],
    ['rule', '-'],

    // 3. Order Information
    ['pair', order.date, 'التاريخ', ' '],
    ['pair', `#${order.orderNumber}`, 'رقم الفاتورة', ' '],
    ['pair', order.cashierName, 'الكاشير', ' '],
    ['pair', order.customerName, 'العميل', ' '],
    ['pair', order.customerPhone, 'الهاتف', ' '],
    ['rule', '-'],

    // 4. Items Table (80mm = 48 columns total)
    ['columns', ['السعر', 'الكمية', 'الصنف'], [12, 6, 30]],
    ['rule', '-']
  ];

  // Add line items
  for (const item of order.items) {
    commands.push([
      'columns',
      [`${item.price.toFixed(2)} ج.م`, String(item.qty), item.name],
      [12, 6, 30]
    ]);
  }

  // 5. Totals
  commands.push(
    ['rule', '-'],
    ['pair', `${order.subtotal.toFixed(2)} ج.م`, 'المجموع الفرعي', ' '],
    ['pair', `${order.tax.toFixed(2)} ج.م`, 'ضريبة القيمة المضافة 14%', ' '],
    ['pair', `${order.deliveryFee.toFixed(2)} ج.م`, 'رسوم التوصيل', ' '],
    ['rule', '-'],
    ['bold', true],
    ['textSize', 1, 2], // Tall bold total
    ['pair', `${order.total.toFixed(2)} ج.م`, 'الإجمالي النهائي', ' '],
    ['textSize', 1, 1],
    ['bold', false],
    ['rule', '-'],
    ['pair', order.paymentMethod, 'طريقة الدفع', ' '],
    ['feed', 1],

    // 6. Footer & QR Code
    ['align', 'center'],
    ['qrcode', order.invoiceUrl, { size: 6, errorCorrection: 'M' }],
    ['feed', 1],
    ['line', 'شكراً لزيارتكم!'],
    ['line', 'Powered by: EDPrintTool'],
    ['feed', 2],
    ['cut', 'partial', 4]
  );

  return fetch(`http://localhost:8765/printers/${printerId}/escpos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands })
  });
}
```

---

### Example B: English Retail Receipt with Barcode

```javascript
async function printEnglishReceipt(printerId, sale) {
  const commands = [
    ['initialize'],
    ['font', 0],
    ['codepage', 'cp1252'],
    ['align', 'center'],
    ['bold', true],
    ['textSize', 2, 2],
    ['line', 'TECH STORE LLC'],
    ['textSize', 1, 1],
    ['bold', false],
    ['line', '123 Market St, New York, NY'],
    ['line', 'Tel: (555) 019-2834'],
    ['rule', '='],

    ['align', 'left'],
    ['pair', 'Receipt:', `#${sale.id}`],
    ['pair', 'Date:', sale.date],
    ['pair', 'Cashier:', sale.cashier],
    ['rule', '-'],

    // Table header
    ['columns', ['Item', 'Qty', 'Price'], [28, 6, 14]],
    ['rule', '-'],

    // Items
    ['columns', ['Wireless Mouse', '1', '$24.99'], [28, 6, 14]],
    ['columns', ['USB-C Cable 2m', '2', '$19.98'], [28, 6, 14]],
    ['columns', ['Mechanical Keyboard', '1', '$89.00'], [28, 6, 14]],
    ['rule', '-'],

    ['pair', 'Subtotal', '$133.97'],
    ['pair', 'Tax (8.875%)', '$11.89'],
    ['bold', true],
    ['pair', 'TOTAL', '$145.86'],
    ['bold', false],
    ['rule', '='],

    ['align', 'center'],
    ['barcode', sale.barcode, { type: 'CODE128', height: 60, width: 2, hri: 'below' }],
    ['feed', 1],
    ['line', 'Thank you for shopping with us!'],
    ['line', 'Returns accepted within 30 days.'],
    ['feed', 3],
    ['cut']
  ];

  return fetch(`http://localhost:8765/printers/${printerId}/escpos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands })
  });
}
```

---

## 7. TypeScript / React Hook Example

You can wrap printer calls into a clean React Hook:

```typescript
import { useState, useCallback } from 'react';

export type EscPosCommand = [string, ...any[]];

interface PrintOptions {
  printerId: string;
  commands: EscPosCommand[];
}

export function useThermalPrinter() {
  const [printing, setPrinting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const print = useCallback(async ({ printerId, commands }: PrintOptions) => {
    setPrinting(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:8765/printers/${printerId}/escpos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Printing failed');
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setPrinting(false);
    }
  }, []);

  return { print, printing, error };
}
```

---

## 8. Summary Checklist for Frontend Developers
- [x] Send requests to `http://localhost:8765/printers/:id/escpos`.
- [x] Always begin the `commands` array with `["initialize"]`.
- [x] For Arabic: include `["codepage", "cp864"]` and `["charSpacing", 0]`.
- [x] Use `["font", 0]` for normal wide Arabic letters, or `["font", 1]` for small compact letters.
- [x] For image/logo: pass width as a **multiple of 8** (`128`, `256`, `384`, `512`).
- [x] Always end with `["feed", 2]` and `["cut"]`.
