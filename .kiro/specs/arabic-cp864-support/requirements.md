# Requirements Document

## Introduction

This feature adds Arabic text support to the ESC/POS printing pipeline by registering CP864 (code page 864) as a supported encoding in both the JavaScript encoder (`src/escpos.js`) and the C# native encoder (`src-native/EDPrintTool/EscPosEncoder.cs`). CP864 is the Arabic code page used by Epson and Star thermal printers (ESC t argument: 22). The feature also exposes `cp864` as a selectable codepage in printer settings, mirrors it in the C# `PrinterSettings` model, and ensures the `printEscPos` action dispatcher correctly passes the codepage through to the encoder.

## Glossary

- **CP864**: Code Page 864 — the IBM/MS-DOS Arabic character encoding. Covers Arabic script glyphs in the range 0x80–0xFF. Used by Epson TM and Star TSP thermal printers via ESC t argument 22.
- **ESC t**: The ESC/POS command `ESC t n` (bytes `0x1B 0x74 n`) that selects the active character code table on the printer. `n = 22` selects CP864.
- **EscPosEncoder (JS)**: The JavaScript encoder class in `src/escpos.js` responsible for building ESC/POS byte streams.
- **EscPosEncoder (CS)**: The C# encoder class in `src-native/EDPrintTool/EscPosEncoder.cs` responsible for building ESC/POS byte streams in the native Windows tool.
- **CODEPAGES (JS)**: The `CODEPAGES` constant object in `src/escpos.js` that maps codepage names to ESC t argument values.
- **Codepages (CS)**: The `Codepages` static dictionary in `EscPosEncoder.cs` that maps codepage names to `(escArg, dotnetCp)` tuples.
- **PrinterSettings**: The `DEFAULT_SETTINGS` object in `src/printer.js` (JS) and `PrinterSettings.cs` (C#) that defines valid values for the `codepage` field.
- **Printer_Profile**: An entry in `src/printer-profiles.js` that declares a printer's capabilities, including its `defaultCodepage`.
- **Arabic_Text**: Unicode text composed of Arabic script characters (U+0600–U+06FF) that must be re-encoded into CP864 single bytes before transmission to the printer.

---

## Requirements

### Requirement 1: Register CP864 in the JavaScript Encoder

**User Story:** As a developer integrating with an Epson or Star thermal printer that handles Arabic text, I want CP864 to be a recognized codepage in the JS encoder, so that I can select it by name and have the correct ESC t byte sent to the printer.

#### Acceptance Criteria

1. THE `EscPosEncoder (JS)` SHALL include an entry `cp864: 22` in the `CODEPAGES` constant.
2. WHEN `codepage('cp864')` is called on an `EscPosEncoder (JS)` instance, THE `EscPosEncoder (JS)` SHALL emit the bytes `0x1B 0x74 0x16` (ESC t 22) into the output buffer.
3. WHEN an `EscPosEncoder (JS)` is constructed with `{ codepage: 'cp864' }` and `initialize()` is called, THE `EscPosEncoder (JS)` SHALL emit `ESC @` followed by `ESC t 22`.
4. WHEN `raw()` or `line()` is called after selecting `cp864`, THE `EscPosEncoder (JS)` SHALL encode the provided string using the `'latin1'` buffer encoding so that pre-mapped CP864 byte values pass through unchanged.

### Requirement 2: Register CP864 in the C# Native Encoder

**User Story:** As a developer using the native Windows tool (EDPrintTool), I want CP864 to be a recognized codepage in the C# encoder, so that Arabic text prints correctly on Epson/Star printers without relying on the JS layer.

#### Acceptance Criteria

1. THE `EscPosEncoder (CS)` SHALL include the entry `["cp864"] = (22, 864)` in the `Codepages` static dictionary.
2. WHEN `Codepage("cp864")` is called on an `EscPosEncoder (CS)` instance, THE `EscPosEncoder (CS)` SHALL emit the bytes `0x1B 0x74 0x16` into the output stream and update the internal `_encoding` to `Encoding.GetEncoding(864)`.
3. WHEN an `EscPosEncoder (CS)` is constructed with `codepage: "cp864"`, THE `EscPosEncoder (CS)` SHALL initialize `_encoding` to `Encoding.GetEncoding(864)`.
4. IF `Encoding.GetEncoding(864)` is not available on the host .NET runtime, THEN THE `EscPosEncoder (CS)` SHALL throw an `InvalidOperationException` with a descriptive message indicating that the `System.Text.Encoding.CodePages` NuGet package or `CodePagesEncodingProvider.Instance` registration is required.

### Requirement 3: Expose CP864 as a Valid Codepage in Printer Settings

**User Story:** As an operator configuring a printer via the UI or API, I want to be able to select `cp864` as the codepage for an ESC/POS printer, so that all print jobs sent to that printer automatically activate Arabic mode.

#### Acceptance Criteria

1. THE `Printer_Profile` system SHALL accept `'cp864'` as a valid value for the `codepage` field in `DEFAULT_SETTINGS` (JS) and the `Codepage` property in `PrinterSettings` (C#).
2. WHEN a printer is configured with `codepage: 'cp864'` and a print job is dispatched via the `print` action, THE `EscPosEncoder (JS)` SHALL be constructed with `codepage: 'cp864'` and SHALL emit `ESC t 22` before the job content.
3. WHEN a printer is configured with `codepage: 'cp864'` and `buildEscPosPayload` is called, THE `Printer_Profile` system SHALL pass `'cp864'` to the `EscPosEncoder (JS)` constructor so that the codepage selection byte is included in the output.
4. THE `Printer_Profile` for `'epson'` and `'generic'` SHALL document `'cp864'` in a comment as a valid `defaultCodepage` alternative for Arabic-capable printers.

### Requirement 4: Arabic Text Encoding Conversion

**User Story:** As a developer sending Arabic Unicode strings to the printer, I want the encoder to correctly convert Arabic Unicode characters to their CP864 byte equivalents, so that legible Arabic text appears on the receipt.

#### Acceptance Criteria

1. WHEN a string containing Arabic Unicode characters (U+0600–U+06FF) is passed to `line()` or `text()` in `EscPosEncoder (JS)` while `cp864` is active, THE `EscPosEncoder (JS)` SHALL encode each character using `latin1` byte mapping, preserving the pre-converted CP864 byte values supplied by the caller.
2. THE `EscPosEncoder (JS)` documentation SHALL state that callers are responsible for converting Arabic Unicode strings to CP864-mapped byte values before passing them to `raw()`, `text()`, or `line()`, because Node.js does not ship a native CP864 encoder.
3. WHEN a string is passed to `WriteText()` in `EscPosEncoder (CS)` while `_encoding` is `Encoding.GetEncoding(864)`, THE `EscPosEncoder (CS)` SHALL encode the string using the CP864 encoding, producing valid single-byte Arabic character sequences.
4. FOR ALL Arabic strings that can be encoded in CP864, encoding via `EscPosEncoder (CS)` with codepage `cp864` and then decoding the resulting bytes with `Encoding.GetEncoding(864)` SHALL produce a string equivalent to the original input (round-trip property).

### Requirement 5: API and Configuration Validation

**User Story:** As an API consumer calling `updateSettings` or `addPrinter`, I want the system to accept `cp864` as a valid codepage value without error, so that I can configure Arabic printers programmatically.

#### Acceptance Criteria

1. WHEN `updateSettings` is called with `{ codepage: 'cp864' }` for an ESC/POS printer, THE `Printer_Profile` system SHALL persist `'cp864'` in the printer's settings and return the updated printer object.
2. WHEN `addPrinter` is called with `settings.codepage: 'cp864'`, THE `Printer_Profile` system SHALL store `'cp864'` in `DEFAULT_SETTINGS` without throwing an error.
3. WHEN the `printEscPos` action is dispatched for a printer whose settings include `codepage: 'cp864'`, THE `EscPosEncoder (JS)` constructed inside the dispatcher SHALL receive the codepage and emit the appropriate `ESC t 22` command.
4. IF `codepage` is set to an unrecognized value (not a key in `CODEPAGES`), THEN THE `EscPosEncoder (JS)` SHALL silently omit the `ESC t` command rather than throwing, preserving backward compatibility.
