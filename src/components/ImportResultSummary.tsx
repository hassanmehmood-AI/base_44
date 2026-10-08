"use client";

import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useLanguage } from "@/context/LanguageContext";

export type ImportResultSummary = {
  totalRows: number;
  created: number;
  duplicatesInFile: number;
  duplicatesExisting: number;
};

/** Post-import result screen shared by the CRM contacts import and the
 * Campaigns member import — same underlying contactsService.importContacts()
 * result either way, so a user sees exactly what happened: how many of the
 * rows they uploaded actually became new contacts versus were skipped and
 * why (duplicate within the file, already in the CRM, or missing a required
 * field before the row was even sent). */
export function ImportResultSummaryView({
  result,
  invalidCount,
  onDone,
}: {
  result: ImportResultSummary;
  invalidCount: number;
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const totalDuplicates = result.duplicatesInFile + result.duplicatesExisting;

  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
        <CheckCircle2 className="h-6 w-6" />
      </div>
      <p className="text-[15px] font-semibold text-text-primary">
        {t(
          `${result.created} contact${result.created === 1 ? "" : "s"} imported.`,
          `${result.created} contacto${result.created === 1 ? "" : "s"} importado${result.created === 1 ? "" : "s"}.`
        )}
      </p>
      <div className="flex flex-col gap-1 text-[12.5px] text-text-secondary">
        <p>{t(`${result.totalRows} row(s) processed.`, `${result.totalRows} fila(s) procesadas.`)}</p>
        {totalDuplicates > 0 && (
          <p>
            {t(
              `${totalDuplicates} duplicate${totalDuplicates === 1 ? "" : "s"} skipped (${result.duplicatesInFile} repeated in the file, ${result.duplicatesExisting} already in the CRM).`,
              `${totalDuplicates} duplicado${totalDuplicates === 1 ? "" : "s"} omitido${totalDuplicates === 1 ? "" : "s"} (${result.duplicatesInFile} repetido(s) en el archivo, ${result.duplicatesExisting} ya en el CRM).`
            )}
          </p>
        )}
        {invalidCount > 0 && (
          <p>
            {t(
              `${invalidCount} row(s) skipped for missing required fields.`,
              `${invalidCount} fila(s) omitidas por falta de campos obligatorios.`
            )}
          </p>
        )}
      </div>
      <Button onClick={onDone}>{t("Done", "Listo")}</Button>
    </div>
  );
}
