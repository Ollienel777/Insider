"use client";

import { useEffect, useSyncExternalStore } from "react";
import { matterportMode } from "@/adapters/matterport";
import {
  dismissToast,
  getServerStatus,
  getStatus,
  initStatus,
  reportFallback,
  statusChip,
  subscribeStatus,
  type DemoStatus,
  type ServerStatus,
} from "@/lib/demo-status";
import type { Fallback } from "@/lib/fallback";
import { DemoSettings } from "./demo-settings";
import { ModeChip } from "./mode-chip";
import { ToastStack } from "./toasts";

/** The browser's status store, or `null` before it has been initialised (server render, hydration). */
export function useDemoStatus(): DemoStatus | null {
  const status = useSyncExternalStore(subscribeStatus, getStatus, getServerStatus);
  return status.ready ? status : null;
}

/** The status the page was rendered with, before the browser has looked for itself. */
export function renderedStatus(server: ServerStatus): Pick<DemoStatus, "configured" | "forced" | "fellBack"> {
  return { configured: server.configured, forced: new Set(server.forced), fellBack: new Set() };
}

/**
 * The mode chip, kept current: what each service serves after forcing and
 * fallbacks, with Matterport as this browser's own adapter selects it.
 */
export function StatusChip({ status }: { status: ServerStatus }) {
  const live = useDemoStatus();
  return <ModeChip chip={statusChip(live ?? renderedStatus(status))} />;
}

/**
 * Demo safety (SPEC §2, §7; DESIGN.md, States): takes the server's status
 * into the browser's store, toasts each fallback once, and mounts the hidden
 * demo settings (Shift+?).
 */
export function DemoSafety({ status }: { status: ServerStatus }) {
  const key = JSON.stringify(status);
  useEffect(() => {
    const server = JSON.parse(key) as ServerStatus;
    initStatus({
      configured: { ...server.configured, matterport: matterportMode(server.heistMode) },
      forced: server.forced,
      fallbacks: server.fallbacks,
    });
  }, [key]);
  const live = useDemoStatus();
  return (
    <>
      <ToastStack toasts={live?.toasts ?? []} onDismiss={dismissToast} />
      <DemoSettings status={live} />
    </>
  );
}

/** Reports a fallback a server component hit while rendering (the map's CoStar call). */
export function FallbackReport({ fallback }: { fallback?: Fallback | null }) {
  const id = fallback?.id;
  useEffect(() => {
    if (fallback) reportFallback(fallback);
    // The id names the fallback; the object is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return null;
}
