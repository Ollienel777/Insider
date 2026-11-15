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
        // The rubber stamp: a walnut block with a red handle on top, the screen's one action (issue 166).
        primary: cn(
          "relative mt-5 -rotate-2 bg-walnut text-n-950 hover:-rotate-1 hover:bg-[var(--walnut-3)] active:bg-walnut",
          "before:absolute before:bottom-[calc(100%+2px)] before:left-1/2 before:h-5 before:w-8 before:-translate-x-1/2 before:rounded-t-full before:border-2 before:border-border-strong",
          "before:bg-[image:var(--stamp-handle)] before:content-['']",
        ),
        secondary: "bg-n-950 text-text-1 hover:bg-surface-2 active:bg-surface-3",
        ghost: "border-transparent bg-transparent text-text-2 shadow-none hover:bg-surface-3 hover:text-text-1 active:shadow-none",
      },
      size: {
        default: "h-10 px-5",
        lg: "h-14 px-6 text-lg",
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
