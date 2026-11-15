import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// shadcn/ui's Button, restyled to DESIGN.md: primary (the accent, one per
// screen), secondary (surface-2 with a border) and ghost. Every size is at
// least 40px tall. The focus ring is the global :focus-visible outline.
// For a link styled as a button, put `buttonVariants(...)` on the <Link>.
export const buttonVariants = cva(
  [
    // The game look (issue 166): a chunky, outlined button on a hard shadow that presses down on click.
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm border-2 border-border-strong",
    "font-display text-base font-normal tracking-wider select-none",
    "shadow-[inset_0_2px_0_var(--key-sheen),inset_0_-3px_0_var(--key-shade),0_4px_0_var(--ink-shadow)] transition-[transform,box-shadow,background-color,color] duration-fast ease-out",
    "hover:-translate-y-px active:translate-y-[3px] active:shadow-[inset_0_2px_0_var(--key-shade),0_1px_0_var(--ink-shadow)]",
    "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[2.25]",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-active",
        secondary: "bg-surface-3 text-text-1 hover:bg-n-700 active:bg-surface-3",
        ghost: "border-transparent bg-transparent text-text-2 shadow-none hover:bg-surface-3 hover:text-text-1 active:shadow-none",
      },
      size: {
        default: "h-11 px-5",
        lg: "h-14 px-6 text-lg",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
