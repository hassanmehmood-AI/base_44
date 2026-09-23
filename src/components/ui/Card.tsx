import { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "ds-card rounded-[var(--radius-card)] border-[length:var(--card-border-width)] border-[color:var(--card-border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-card)] backdrop-blur-[var(--card-blur)]",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("ds-card-title text-[16px] text-text-primary", className)} {...props} />;
}
