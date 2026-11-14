import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui's Skeleton on the tokens: a placeholder block shaped like the content it stands for. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-sm bg-surface-2", className)} {...props} />;
}
