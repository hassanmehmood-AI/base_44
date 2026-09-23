import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "dark" | "outline" | "ghost" | "danger-ghost";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-sidebar-active text-white hover:bg-[color-mix(in_srgb,var(--sidebar-active)_82%,black)] shadow-[var(--shadow-button)]",
  dark: "bg-text-primary text-white hover:bg-black shadow-[var(--shadow-button)]",
  outline:
    "bg-white text-text-primary border border-border hover:bg-surface-muted",
  ghost: "bg-transparent text-text-primary hover:bg-surface-muted",
  "danger-ghost": "bg-transparent text-danger hover:bg-danger-50",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-[14px] gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "ds-button inline-flex items-center justify-center rounded-[var(--radius-button)] font-medium transition-colors whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
