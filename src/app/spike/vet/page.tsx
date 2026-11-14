"use client";
// Scan vetting for the first-person spike (epic #98). See ../README.md.
// Open /spike/vet?ids=<model id>,<model id>,... Each scan is opened in a visible
// player, turned into a board with the app's own mapping, and the F1 level is
// placed on it, one scan at a time. Nothing is stored: results live in this
// page's memory only. Never commit a model id.
import { useEffect, useRef, useState } from "react";
import { SHOWCASE, toFloorGraph } from "@/adapters/matterport/mapping";
import { LevelManifest } from "@/domain";
import { placeLevel } from "@/level/placer";
import { RUN_SEED } from "@/components/run/run-screen";
import cached from "../../../../data/levels/F1.romaine-1974.json";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Row {
  id: string;
  status: "waiting" | "loading" | "placed" | "unplaceable" | "failed";
  nodes?: number;
  rooms?: number;
  doors?: number;
  maxDegree?: number;
  /** Median length of an edge, in metres: small means the scan walks smoothly. */
  hopMetres?: number;
  ms?: number;
  note?: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The first snapshot of an SDK collection that has anything in it, or what there is after `ms`. */
function collect(collection: any, ms: number): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let latest: Record<string, unknown> = {};
    let settle: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(limit);
      clearTimeout(settle);
      queueMicrotask(() => subscription.cancel());
      resolve(latest);
    };
    const limit = setTimeout(done, ms);
    const subscription = collection.subscribe({
      onCollectionUpdated(items: Record<string, unknown>) {
        latest = { ...items };
        // The player fills a collection over a few callbacks: take it once it has been quiet for a moment.
        clearTimeout(settle);
        if (Object.keys(latest).length > 0) settle = setTimeout(done, 700);
      },
    });
  });
}

async function readScan(host: HTMLElement, modelId: string, sdkKey: string) {
  const w = window as any;
  if (!w.MP_SDK) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SHOWCASE.sdkScript;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("the SDK script did not load"));
      document.head.appendChild(script);
    });
  }
  const iframe = document.createElement("iframe");
  iframe.allow = "xr-spatial-tracking";
  Object.assign(iframe.style, { width: "100%", height: "100%", border: "0" });
  host.replaceChildren(iframe);
  try {
    const loaded = new Promise<void>((resolve) => iframe.addEventListener("load", () => resolve(), { once: true }));
    iframe.src = SHOWCASE.embedUrl(modelId, sdkKey);
    await loaded;
    const sdk = await Promise.race([
      w.MP_SDK.connect(iframe, sdkKey, SHOWCASE.sdkVersion),
      wait(25_000).then(() => {
        throw new Error("the player did not connect within 25 s");
      }),
    ]);
    try {
      const sweeps = await collect(sdk.Sweep.data, 30_000);
      const rooms = await collect(sdk.Room.data, 4_000);
      return { sweeps, rooms };
    } finally {
      sdk.disconnect?.();
    }
  } finally {
    iframe.remove();
  }
}

export default function Vet() {
  const [rows, setRows] = useState<Row[]>([]);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = window as any;
    if (w.__vetStarted) return;
    w.__vetStarted = true;
    const ids = (new URLSearchParams(location.search).get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const key = process.env.NEXT_PUBLIC_MATTERPORT_SDK_KEY;
    const all: Row[] = ids.map((id) => ({ id, status: "waiting" }));
    w.__vet = { rows: all, done: false };
    setRows([...all]);
    if (!key) {
      w.__vet.error = "NEXT_PUBLIC_MATTERPORT_SDK_KEY is not set";
      return;
    }
    const manifest = LevelManifest.parse(structuredClone(cached));
    (async () => {
      for (const row of all) {
        row.status = "loading";
        setRows([...all]);
        const t = performance.now();
        try {
          const { sweeps, rooms } = await readScan(host.current!, row.id, key);
          row.ms = Math.round(performance.now() - t);
          if (Object.keys(sweeps).length === 0) throw new Error("the scan sent no positions");
          const floor = toFloorGraph(sweeps, rooms);
          const at = new Map(floor.nodes.map((n) => [n.id, n]));
          const lengths = floor.edges.map((e) => Math.hypot(at.get(e.a)!.x - at.get(e.b)!.x, at.get(e.a)!.y - at.get(e.b)!.y)).sort((a, b) => a - b);
          const degree = new Map<string, number>();
          for (const e of floor.edges) {
            degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
            degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
          }
          row.nodes = floor.nodes.length;
          row.rooms = floor.rooms.length;
          row.doors = floor.edges.filter((e) => e.door).length;
          row.maxDegree = Math.max(0, ...degree.values());
          row.hopMetres = lengths.length ? Math.round(lengths[Math.floor(lengths.length / 2)] * 10) / 10 : 0;
          try {
            placeLevel(manifest, structuredClone(floor), RUN_SEED);
            row.status = "placed";
          } catch (error: any) {
            row.status = "unplaceable";
            row.note = String(error?.message ?? error).slice(0, 160);
          }
        } catch (error: any) {
          row.ms = Math.round(performance.now() - t);
          row.status = "failed";
          row.note = String(error?.message ?? error).slice(0, 160);
        }
        setRows([...all]);
      }
      w.__vet.done = true;
    })();
  }, []);
  const cell = { paddingRight: 16 };
  return (
    <main style={{ padding: 24, font: "13px ui-monospace, monospace", color: "white", background: "black", minHeight: "100vh" }}>
      <p>
        Scan vetting: the F1 level placed on each scan. {rows.filter((r) => r.status === "placed").length} placed of {rows.length}.
      </p>
      <div ref={host} style={{ width: 640, height: 360, margin: "12px 0", background: "#111" }} />
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={cell}>{r.id}</td>
              <td style={cell}>{r.status}</td>
              <td style={cell}>{r.nodes ?? ""} positions</td>
              <td style={cell}>{r.rooms ?? ""} rooms</td>
              <td style={cell}>{r.doors ?? ""} doors</td>
              <td style={cell}>most hops {r.maxDegree ?? ""}</td>
              <td style={cell}>hop {r.hopMetres ?? ""} m</td>
              <td style={cell}>{r.ms ?? ""} ms</td>
              <td>{r.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
