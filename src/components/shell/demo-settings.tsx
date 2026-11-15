"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { setForced, type DemoStatus } from "@/lib/demo-status";
import { SERVICE_IDS, SERVICES, type Service } from "@/lib/mode";
import { cn } from "@/lib/utils";

export interface SettingsRow {
  service: Service;
  label: string;
  /** What the service serves now, in a few words. */
  status: string;
  /** The switch is on: the service is on fixtures. */
  onFixtures: boolean;
  /** Forced here, so the switch can turn it back. */
  forced: boolean;
  /** On fixtures by configuration: there is nothing live to switch off. */
  locked: boolean;
}

/** One row per service, for the demo settings. */
export function settingsRows(status: Pick<DemoStatus, "configured" | "forced" | "fellBack">): SettingsRow[] {
  return SERVICE_IDS.map((service) => {
    const forced = status.forced.has(service);
    const fellBack = status.fellBack.has(service);
    const configuredFake = status.configured[service] === "fake";
    const text = forced
      ? "Forced to fixtures"
      : fellBack
        ? "Fixtures: the live service failed"
        : configuredFake
          ? "Fixtures: no live configuration"
          : "Live";
    return {
      service,
      label: SERVICES[service].label,
      status: text,
      onFixtures: forced || fellBack || configuredFake,
      forced,
      locked: configuredFake && !forced,
    };
  });
}

/** Shift+? anywhere but a text field. */
export function isSettingsKey(event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "target">): boolean {
  if (event.key !== "?" || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  return !target?.closest?.("input, textarea, select, [contenteditable=true]");
}

/**
 * The hidden demo settings (Shift+?): force any service to fixtures for this
 * session, before the pitch or in the middle of it. Not on any screen's path;
 * the presenter opens it from the keyboard. A popover under the mode chip,
 * never a modal: the screen behind stays usable.
 */
export function DemoSettings({ status }: { status: DemoStatus | null }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isSettingsKey(event)) {
        event.preventDefault();
        setOpen((was) => {
          if (!was) opener.current = document.activeElement;
          return !was;
        });
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // An element in fullscreen (the Run screen's stage) covers this popover: leave fullscreen so it can be seen.
  useEffect(() => {
    if (open && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [open]);

  if (!open || !status) return null;
  const close = () => {
    setOpen(false);
    (opener.current as HTMLElement | null)?.focus?.();
  };
  return (
    <DemoSettingsPanel
      rows={settingsRows(status)}
      onToggle={(service, on) => {
        setForced(service, on);
        // Server components (the map's buildings, the building name) read the cookie: render them again.
        router.refresh();
      }}
      onClose={close}
    />
  );
}

export function DemoSettingsPanel({
  rows,
  onToggle,
  onClose,
}: {
  rows: SettingsRow[];
  onToggle: (service: Service, on: boolean) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const first = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      data-testid="demo-settings"
      className="fixed top-16 right-4 z-50 w-[min(340px,calc(100vw-32px))] rounded-md border border-border bg-surface-1 shadow-e-2 duration-base animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border py-1 pr-1 pl-4">
        <h2 id={titleId} className="label-caps text-text-2">
          Demo settings
        </h2>
        <Button variant="ghost" size="icon" aria-label="Close demo settings" onClick={onClose}>
          <X />
        </Button>
      </div>
      <p className="px-4 pt-3 text-sm text-text-2">Put a service on fixtures for this session. Its next request uses them.</p>
      <ul className="px-4 py-2">
        {rows.map((row, i) => (
          <li key={row.service} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-1">{row.label}</div>
              <div data-testid={`demo-settings-status-${row.service}`} className="text-xs text-text-2">
                {row.status}
              </div>
            </div>
            <button
              ref={i === 0 ? first : undefined}
              type="button"
              role="switch"
              aria-checked={row.onFixtures}
              aria-label={`${row.label} on fixtures`}
              disabled={row.locked}
              data-testid={`force-${row.service}`}
              onClick={() => onToggle(row.service, !row.forced)}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-sm disabled:opacity-50"
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-9 items-center rounded-full border p-0.5 transition-colors duration-fast",
                  row.onFixtures ? "border-accent bg-accent" : "border-border-strong bg-surface-3",
                )}
              >
                <span
                  className={cn(
                    "size-3.5 rounded-full transition-transform duration-fast motion-reduce:transition-none",
                    row.onFixtures ? "translate-x-4 bg-accent-ink" : "translate-x-0 bg-text-2",
                  )}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-3 text-xs text-text-2">
        <kbd className="font-mono">Shift ?</kbd> or <kbd className="font-mono">Esc</kbd> closes. <kbd className="font-mono">npm run demo:reset</kbd> clears it.
      </p>
    </div>
  );
}
