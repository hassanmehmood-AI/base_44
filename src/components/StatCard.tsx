import { TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/Card";

export function StatCard({
  label,
  value,
  delta,
  deltaSuffix,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaSuffix?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
      <div className="mt-2.5 flex flex-wrap items-baseline gap-2">
        <span className="ds-metric-value text-[26px] font-semibold tracking-tight text-text-primary">{value}</span>
        {delta && (
          <span className="flex items-center gap-1 text-[12.5px] font-medium text-success">
            <TrendingUp className="h-3.5 w-3.5" /> {delta}
          </span>
        )}
      </div>
      {deltaSuffix && <p className="mt-0.5 text-[12px] text-text-tertiary">{deltaSuffix}</p>}
    </Card>
  );
}
