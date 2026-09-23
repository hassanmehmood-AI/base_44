import { InputHTMLAttributes, forwardRef, TextareaHTMLAttributes } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "ds-input h-10 w-full rounded-[var(--radius-input)] border border-border bg-surface px-3.5 text-[14px] text-text-primary placeholder:text-gray-400 outline-none transition-shadow focus:border-brand focus:ring-2 focus:ring-brand/15",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export function SearchInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("relative flex-1", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
      <input
        className="ds-input h-10 w-full rounded-[var(--radius-input)] border border-border bg-surface pl-10 pr-3.5 text-[14px] text-text-primary placeholder:text-gray-400 outline-none transition-shadow focus:border-brand focus:ring-2 focus:ring-brand/15"
        {...props}
      />
    </div>
  );
}

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "ds-input w-full rounded-[var(--radius-input)] border border-border bg-surface px-3.5 py-2.5 text-[14px] text-text-primary placeholder:text-gray-400 outline-none transition-shadow focus:border-brand focus:ring-2 focus:ring-brand/15 resize-none",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "ds-input h-10 w-full appearance-none rounded-[var(--radius-input)] border border-border bg-surface px-3.5 pr-9 text-[14px] text-text-primary outline-none transition-shadow focus:border-brand focus:ring-2 focus:ring-brand/15 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b7280%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-no-repeat bg-[right_0.75rem_center]",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}
