import { parseCsv } from "@/lib/csv";

export const CONTACTS_IMPORT_TEMPLATE_CSV =
  "Name,Business Name,Phone,Email,Source\nJane Doe,Acme Inc,+1 555 0100,jane@acme.com,Referral\n";

export const MAX_CONTACTS_IMPORT_ROWS = 500;

export type ContactImportRow = {
  name: string;
  businessName: string;
  phone: string;
  email: string;
  leadSource: string;
  valid: boolean;
  reason?: string;
};

function findColumn(header: string[], candidates: string[]): number {
  const normalized = header.map((h) => h.trim().toLowerCase());
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Shared by the CRM contacts import and the Campaigns member import (guide
 * §17 Option B) — same CSV shape, same column-mapping rules. */
export function parseContactImportRows(text: string, t: (en: string, es: string) => string): { rows: ContactImportRow[]; error?: string } {
  const table = parseCsv(text).filter((r) => r.some((cell) => cell.trim() !== ""));
  if (table.length === 0) return { rows: [], error: t("The file is empty.", "El archivo está vacío.") };

  const [header, ...dataRows] = table;
  const nameIdx = findColumn(header, ["name", "nombre"]);
  if (nameIdx === -1) {
    return {
      rows: [],
      error: t('No "Name" column found in the file header.', 'No se encontró la columna "Name" en el encabezado.'),
    };
  }
  const businessIdx = findColumn(header, ["business name", "nombre de empresa", "business", "empresa"]);
  const phoneIdx = findColumn(header, ["phone", "teléfono", "telefono"]);
  const emailIdx = findColumn(header, ["email", "correo"]);
  const sourceIdx = findColumn(header, ["source", "lead source", "origen"]);

  const rows: ContactImportRow[] = dataRows.map((r) => {
    const name = (r[nameIdx] ?? "").trim();
    return {
      name,
      businessName: businessIdx !== -1 ? (r[businessIdx] ?? "").trim() : "",
      phone: phoneIdx !== -1 ? (r[phoneIdx] ?? "").trim() : "",
      email: emailIdx !== -1 ? (r[emailIdx] ?? "").trim() : "",
      leadSource: sourceIdx !== -1 ? (r[sourceIdx] ?? "").trim() : "",
      valid: name.length > 0,
      reason: name.length > 0 ? undefined : t("Missing name", "Falta el nombre"),
    };
  });

  return { rows };
}
