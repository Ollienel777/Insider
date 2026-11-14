"use client";

import { CloudOff, X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { Fallback } from "@/lib/fallback";

/** How long a fallback toast stays before it leaves on its own. */
export const TOAST_MS = 8_000;

/**
 * The fallback toasts (DESIGN.md, States): bottom left, over the visual and
 * clear of the side panel's primary action, and lifted 80px so they sit above
 * the screens' bottom control rows (Scout's views, the map's layers, the
 * board's key hints), one line each
 * naming the service that went to fixtures, polite to screen readers. The
 * live region is always mounted so the first toast is announced.
 */
export function ToastStack({ toasts, onDismiss }: { toasts: readonly Fallback[]; onDismiss: (id: string) => void }) {
  return (
    <section
      aria-label="Notifications"
      aria-live="polite"
      data-testid="toasts"
      className="pointer-events-none fixed bottom-20 left-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </section>
  );
}

function Toast({ toast, onDismiss }: { toast: Fallback; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);
  return (
    <div
      data-testid="fallback-toast"
      data-service={toast.service}
      className="pointer-events-auto flex items-start gap-3 rounded-md border border-border-strong bg-surface-2 py-1 pr-1 pl-4 shadow-e-1 duration-base animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
    >
      <CloudOff aria-hidden className="mt-3 size-4 shrink-0 stroke-[1.5] text-text-2" />
      <p className="min-w-0 flex-1 py-2 text-sm text-text-1">{toast.message}</p>
      <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        <X />
      </Button>
    </div>
  );
}
