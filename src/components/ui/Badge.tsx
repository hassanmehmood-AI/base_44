import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Tone = "green" | "dark" | "outline" | "amber" | "red" | "blue" | "gray";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const tones: Record<Tone, string> = {
  green: "bg-brand-50 text-brand-700 border border-brand-100",
  dark: "bg-text-primary text-white border border-text-primary",
  outline: "bg-white text-text-primary border border-border",
  amber: "bg-warning-50 text-warning-700 border border-warning-100",
  red: "bg-danger-50 text-danger-700 border border-danger-100",
  blue: "bg-info-50 text-info-700 border border-info-100",
  gray: "bg-surface-muted text-text-secondary border border-border",
};

export function Badge({ tone = "green", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-[12px] font-medium leading-none",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
