import { ReactNode } from "react";
import { TopBar } from "@/components/TopBar";

/** The one shared page-title row, used at the top of every dashboard page.
 * Renders the global company filter (see TopBar.tsx) alongside any
 * page-specific `actions` on the right, title+subtitle on the left — this is
 * the single place that pairing is assembled, so no page needs to render
 * TopBar itself (which would duplicate the filter). */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="ds-page-title text-[26px] text-text-primary">{title}</h1>
        {subtitle && <p className="ds-page-subtitle mt-1 text-[13.5px] text-text-secondary">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {actions}
        <TopBar />
      </div>
    </div>
  );
}
