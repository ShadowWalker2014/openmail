import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-foreground/10 text-foreground border border-border",
        secondary:
          "bg-muted text-muted-foreground border border-border",
        destructive:
          "bg-destructive/15 text-destructive border border-destructive/20",
        outline:
          "border border-border text-foreground/70",
        success:
          "bg-emerald-500/12 text-emerald-400 border border-emerald-500/20",
        warning:
          "bg-amber-500/12 text-amber-400 border border-amber-500/20",
        violet:
          "bg-violet-500/12 text-violet-400 border border-violet-500/20",
        blue:
          "bg-blue-500/12 text-blue-400 border border-blue-500/20",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
