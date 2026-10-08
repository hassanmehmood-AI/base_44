import { parseCsv } from "@/lib/csv";

/** Normalized view over a parsed file, whatever its original format. A CSV
 * always has exactly one pseudo-sheet, so a sheet picker in the UI only
 * needs to render when `sheetNames.length > 1` — never for CSV. */
export type SpreadsheetWorkbook = {
  sheetNames: string[];
  getRows: (sheetName: string) => string[][];
};

// Magic-byte signatures, checked against the actual file bytes rather than
// trusting the extension or the browser-reported MIME type (both are just
// labels the uploader's OS attached, not proof of what's inside).
const XLSX_ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — a .xlsx is a zip archive
const XLS_OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .xls container

function startsWithSignature(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((b, i) => bytes[i] === b);
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

/** Reads a .csv, .xlsx, or .xls File into one normalized table interface.
 * CSV is handled exactly as it always was (decode as text, run the existing
 * parseCsv) — Excel support is purely additive via a dynamic `import("xlsx")`
 * so the ~1MB SheetJS bundle only loads for someone who actually picks an
 * Excel file, never for the CSV-only path. */
export async function readSpreadsheetFile(
  file: File,
  t: (en: string, es: string) => string
): Promise<{ workbook?: SpreadsheetWorkbook; error?: string }> {
  const ext = extensionOf(file.name);

  if (ext === "csv") {
    const buffer = await file.arrayBuffer();
    if (startsWithSignature(new Uint8Array(buffer.slice(0, 4)), XLSX_ZIP_SIGNATURE)) {
      return {
        error: t(
          "This looks like an Excel file saved with a .csv name — upload it with its .xlsx extension instead.",
          "Este archivo parece un Excel guardado con nombre .csv: súbelo con su extensión .xlsx."
        ),
      };
    }
    const text = new TextDecoder("utf-8").decode(buffer);
    return { workbook: { sheetNames: ["CSV"], getRows: () => parseCsv(text) } };
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    const header = new Uint8Array(buffer.slice(0, 8));
    const looksValid = startsWithSignature(header, XLSX_ZIP_SIGNATURE) || startsWithSignature(header, XLS_OLE2_SIGNATURE);
    if (!looksValid) {
      return {
        error: t(
          "This doesn't look like a valid Excel file — it may be corrupted or mislabeled.",
          "Este archivo no parece un Excel válido: puede estar dañado o mal etiquetado."
        ),
      };
    }
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buffer, { type: "array" });
      if (wb.SheetNames.length === 0) {
        return { error: t("This Excel file has no sheets.", "Este archivo de Excel no tiene hojas.") };
      }
      return {
        workbook: {
          sheetNames: wb.SheetNames,
          getRows: (sheetName: string) => {
            const sheet = wb.Sheets[sheetName];
            if (!sheet) return [];
            // header:1 -> array-of-arrays (same shape parseCsv produces).
            // raw:false -> cell values come through as their displayed text
            // (so a date or number renders the same way it does in Excel,
            // not as a numeric serial). defval:"" -> an empty cell becomes
            // "" rather than being omitted, so column positions never shift.
            const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as unknown[][];
            return sheetRows.map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
          },
        },
      };
    } catch {
      return {
        error: t(
          "Could not read this Excel file — it may be corrupted or password-protected.",
          "No se pudo leer este archivo de Excel: puede estar dañado o protegido con contraseña."
        ),
      };
    }
  }

  return {
    error: t("Unsupported file type. Upload a .csv, .xlsx, or .xls file.", "Tipo de archivo no compatible. Sube un archivo .csv, .xlsx o .xls."),
  };
}
