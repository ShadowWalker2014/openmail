import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-all duration-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default:
          "bg-foreground text-background shadow-sm hover:bg-foreground/90 active:scale-[0.98]",
        destructive:
          "bg-destructive/90 text-white hover:bg-destructive active:scale-[0.98]",
        outline:
          "border border-border bg-transparent text-foreground/80 hover:bg-accent hover:text-foreground active:scale-[0.98]",
        secondary:
          "bg-muted text-foreground/80 hover:bg-muted/80 hover:text-foreground active:scale-[0.98]",
        ghost:
          "text-foreground/70 hover:bg-accent hover:text-foreground active:scale-[0.98]",
        link:
          "text-foreground/70 underline-offset-4 hover:underline hover:text-foreground",
      },
      size: {
        default: "h-8 px-3.5 py-1.5",
        sm:      "h-7 px-2.5 py-1 text-xs",
        lg:      "h-9 px-5",
        icon:    "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
