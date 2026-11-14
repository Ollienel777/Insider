import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// shadcn/ui's Button, restyled to DESIGN.md: primary (the accent, one per
// screen), secondary (surface-2 with a border) and ghost. Every size is at
// least 40px tall. The focus ring is the global :focus-visible outline.
// For a link styled as a button, put `buttonVariants(...)` on the <Link>.
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm",
    "text-sm font-medium select-none",
    "transition-colors duration-fast ease-out",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-active",
        secondary:
          "border border-border bg-surface-2 text-text-1 hover:border-border-strong hover:bg-surface-3 active:bg-surface-2",
        ghost: "text-text-2 hover:bg-surface-3 hover:text-text-1 active:bg-surface-2",
      },
      size: {
        default: "h-10 px-4",
        lg: "h-12 px-5 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
