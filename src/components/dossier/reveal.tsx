import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface RevealProps {
  shown: boolean;
  children: ReactNode;
  /** `bar`: one skeleton bar inset like a row's text; `lines`: bars on the 24px prose rhythm. */
  skeleton?: "bar" | "block" | "lines";
  className?: string;
  /** The element that wraps the content; `div` by default. */
  as?: "div" | "span";
}

/**
 * Holds a block's final height before it fills (DESIGN.md, States): the
 * content is laid out from the start but hidden, with a skeleton over it, so
 * nothing below moves when it appears. Hidden content is `visibility:
 * hidden`, so it is neither seen nor read out until it shows.
 */
export function Reveal({ shown, children, skeleton = "block", className, as: Tag = "div" }: RevealProps) {
  return (
    <Tag data-shown={shown} className={cn("relative", Tag === "span" && "inline-block", className)}>
      <Tag
        className={cn(
          "block transition-[opacity,visibility] duration-base ease-out",
          shown ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        {children}
      </Tag>
      {shown ? null : (
        <Tag
          aria-hidden
          data-testid="skeleton"
          className={cn(
            "pointer-events-none absolute inset-x-0 block animate-pulse rounded-sm",
            skeleton === "bar" && "top-1/2 h-4 -translate-y-1/2 bg-surface-3",
            skeleton === "block" && "inset-y-0 bg-surface-3",
            skeleton === "lines" && "inset-y-0 rounded-none bg-[repeating-linear-gradient(to_bottom,transparent_0_4px,var(--surface-3)_4px_20px,transparent_20px_24px)]",
          )}
        />
      )}
    </Tag>
  );
}
