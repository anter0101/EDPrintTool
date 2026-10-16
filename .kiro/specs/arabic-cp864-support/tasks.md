# Implementation Plan: Arabic CP864 Support

## Overview

Minimal additions across four JS files and two C# files to register CP864 as a recognized encoding in both encoder layers, expose it in printer settings, and ensure the `printEscPos` action passes the codepage to the encoder.

## Tasks

- [x] 1. Add `cp864: 22` to the JavaScript CODEPAGES registry in `src/escpos.js`
  - Add the entry `cp864: 22` to the `CODEPAGES` constant object with an inline comment `// Arabic (Epson ESC t argument 22)`
  - No logic changes required — `codepage()` and `initialize()` already consume any name present in `CODEPAGES`
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 1.1 Write property test for JS latin1 byte pass-through (Property 1)
    - Set up `fast-check` as a dev dependency (`npm install --save-dev fast-check`)
    - Create `tests/escpos.property.test.js` using Node's built-in `node:test` runner
    - **Property 1: JS latin1 byte pass-through** — for any `Uint8Array` of length 1–200, `Buffer.from(String.fromCharCode(...bytes), 'latin1')` must equal the original bytes
    - **Validates: Requirements 1.4, 4.1**

  - [ ]* 1.2 Write property test for ESC t 22 prefix (Property 2)
    - In `tests/escpos.property.test.js`, add a fast-check property test
    - **Property 2: ESC t 22 prefix for any content** — for any non-empty string, `new EscPosEncoder({ codepage: 'cp864' }).initialize().raw(content).encode()` must contain `[0x1B, 0x74, 0x16]` at a position before any content bytes
    - **Validates: Requirements 1.2, 1.3, 3.2, 5.3**

  - [ ]* 1.3 Write property test for unrecognized codepage (Property 5)
    - In `tests/escpos.property.test.js`, add a fast-check property test
    - **Property 5: Unrecognized codepage does not throw** — for any string not in `CODEPAGES`, `encoder.codepage(unknownName)` must not throw, and the output must not contain an `ESC t` byte sequence
    - **Validates: Requirements 5.4**

- [x] 2. Update printer settings and profiles in JS layer
  - In `src/printer.js`, update the comment on `DEFAULT_SETTINGS.codepage` to include `'cp864'`
  - In `src/printer-profiles.js`, add a comment to the `epson` and `generic` profiles' `defaultCodepage` field noting `'cp864'` as the alternative for Arabic-capable printers
  - _Requirements: 3.1, 3.4_

  - [ ]* 2.1 Write property test for printer settings codepage round-trip (Property 4)
    - In `tests/printer.property.test.js`, add a fast-check property test
    - **Property 4: Printer settings codepage round-trip** — for any value from the set of known valid codepage names (including `'cp864'`), calling `updatePrinterSettings` then `getPrinter` must return the same `codepage` value
    - **Validates: Requirements 5.1**

- [x] 3. Fix `printEscPos` action to pass codepage to the encoder in `src/actions.js`
  - Change `new EscPosEncoder({ paperWidth: s.paperWidth })` to `new EscPosEncoder({ paperWidth: s.paperWidth, codepage: s.codepage || null })`
  - This is the only logic change in `actions.js`
  - _Requirements: 5.3, 3.2_

- [-] 4. Checkpoint — Ensure all JS tests pass
  - Run `node --test tests/` and confirm all tests pass, ask the user if questions arise.

- [~] 5. Add `["cp864"] = (22, 864)` to the C# Codepages dictionary in `EscPosEncoder.cs`
  - Add the entry to the `Codepages` static dictionary with an inline comment `// Arabic (Epson ESC t argument 22)`
  - Wrap the `Encoding.GetEncoding(info.dotnetCp)` call in the constructor (for the `cp864` case) so that if it throws a `NotSupportedException`, it re-throws as `InvalidOperationException` with a message pointing to `System.Text.Encoding.CodePages` registration
  - The `Codepage(string name)` method already uses `Encoding.GetEncoding(info.dotnetCp)`, so it will resolve CP864 automatically
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 5.1 Write property test for C# CP864 encoding round-trip (Property 3)
    - Create a new xUnit + FsCheck test project at `src-native/EDPrintTool.Tests/EDPrintTool.Tests.csproj`
    - Add `FsCheck.Xunit` and `xunit` NuGet references; reference the main project
    - **Property 3: C# CP864 encoding round-trip** — for any string composed of CP864-encodable Arabic characters, encoding via `EscPosEncoder` with `codepage: "cp864"` and decoding with `Encoding.GetEncoding(864)` must produce the original string
    - **Validates: Requirements 4.4**

- [~] 6. Update the `Codepage` property comment in `PrinterSettings.cs`
  - Change the inline comment to include `"cp864"`: `// "" = printer default, or "cp437", "cp850", "cp858", "cp1252", "cp864"`
  - _Requirements: 3.1_

- [~] 7. Final checkpoint — Ensure all tests pass
  - Run `node --test tests/` for JS tests and `dotnet test src-native/EDPrintTool.Tests` for C# tests, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests require `fast-check` (JS) and `FsCheck` (C#) — neither is currently installed
- The JS encoder's `latin1` pass-through is intentional for CP864: callers must pre-convert Arabic Unicode to CP864 byte values before calling `raw()`, `text()`, or `line()`
