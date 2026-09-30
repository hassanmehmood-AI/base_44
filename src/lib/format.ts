const RTF_EN = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const RTF_ES = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

export function formatRelativeTime(date: Date | string | null | undefined, language: "en" | "es" = "en") {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = (d.getTime() - Date.now()) / 1000;
  const rtf = language === "es" ? RTF_ES : RTF_EN;

  for (const [unit, secondsInUnit] of UNITS) {
    if (Math.abs(seconds) >= secondsInUnit) {
      return rtf.format(Math.round(seconds / secondsInUnit), unit);
    }
  }
  return rtf.format(Math.round(seconds), "second");
}

export function formatDateTime(date: Date | string | null | undefined, language: "en" | "es" = "en") {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(language === "es" ? "es-ES" : "en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
