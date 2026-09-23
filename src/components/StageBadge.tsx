"use client";

import { Badge } from "@/components/ui/Badge";
import { Stage, STAGE_LABEL, STAGE_LABEL_ES, STAGE_TONE } from "@/lib/pipeline";
import { useLanguage } from "@/context/LanguageContext";

export function StageBadge({ stage }: { stage: Stage | string }) {
  const { language } = useLanguage();
  const s = stage as Stage;
  const labelMap = language === "es" ? STAGE_LABEL_ES : STAGE_LABEL;
  const label = labelMap[s] ?? stage;
  const tone = STAGE_TONE[s] ?? "gray";
  return <Badge tone={tone}>{label}</Badge>;
}
