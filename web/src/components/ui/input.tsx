import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-8 w-full rounded-md border border-border bg-input px-3 py-1 text-[13px] text-foreground shadow-sm transition-colors",
      "placeholder:text-muted-foreground/60",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring/50",
      "disabled:cursor-not-allowed disabled:opacity-40",
      "file:border-0 file:bg-transparent file:text-sm file:font-medium",
      className
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
