const { test } = require("node:test");
const assert = require("node:assert/strict");
const iconv = require("iconv-lite");

const { EscPosEncoder } = require("../src/escpos");

const widths = [30, 6, 12];
const arabicName = "ساندوتش فراخ مشوية بالجبنة الرومي";

function renderColumns(cells) {
  const encoder = new EscPosEncoder({ columns: 48, codepage: "cp864" });
  encoder.columns(cells, widths);
  return iconv.decode(encoder.encode(), "cp864").replace(/\n$/, "");
}

for (const quantity of ["1", "10"]) {
  test(`CP864 columns preserve name | qty | price for quantity ${quantity}`, () => {
    const rendered = renderColumns([arabicName, quantity, "1234.50"]);

    assert.equal(rendered.length, 48);
    assert.equal(rendered.slice(0, 12).trim(), "1234.50");
    assert.equal(rendered.slice(12, 18).trim(), quantity);
    assert.match(rendered.slice(18), /[\uFE70-\uFEFF]/);
    assert.doesNotMatch(rendered, /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/);
  });
}

test("CP864 header uses the same physical columns and keeps the 48-column width", () => {
  const rendered = renderColumns(["الصنف", "الكمية", "السعر"]);

  assert.equal(rendered.length, 48);
  assert.match(rendered.slice(0, 12), /[\uFE70-\uFEFF]/);
  assert.match(rendered.slice(12, 18), /[\uFE70-\uFEFF]/);
  assert.match(rendered.slice(18), /[\uFE70-\uFEFF]/);
});
