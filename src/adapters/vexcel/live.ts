// The live Vexcel adapter: transport and an in-memory cache. What it requests
// and how the answers map onto `Aerial` lives in mapping.ts.
//
// A live aerial is the hand-made massing (footprint, height and the entries
// placed by hand) with Vexcel's real imagery in place of the render: the
// ortho plus whichever oblique directions the `urban` layer has there. The
// images are fetched once per building and held in memory, never written
// anywhere (SPEC §10, open question Q3); each view's `url` points at the
// image route, which serves them from here, so the key never reaches the
// browser and the browser never talks to Vexcel.
import { Aerial, type AerialView, type ViewDir } from "@/domain";
import { imageSize } from "./image-size";
import {
  centreOf,
  collectionsRequest,
  obliqueBufferM,
  obliqueRequest,
  orthoBounds,
  orthoRequest,
  placeOnOrtho,
  toObliques,
  type VexcelRequest,
} from "./mapping";
import type { AerialImage, VexcelAdapter } from "./types";

export interface LiveVexcelConfig {
  base?: string;
  key?: string;
  /**
   * The building's hand-made massing, or `null` when the id is unknown. Its
   * footprint says where to look; its entries are placed on the imagery.
   */
  massing: (buildingId: string) => Promise<Aerial | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** How long a building's imagery stays in memory. */
  cacheMs?: number;
  /** How many buildings' imagery stay in memory at once. */
  cacheSize?: number;
  now?: () => number;
  warn?: (message: string) => void;
}

export class VexcelNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Vexcel live adapter not configured: ${missing.join(" and ")} missing`);
    this.name = "VexcelNotConfiguredError";
  }
}

/** The order views are listed in, as the Scout steps through them. */
const ORDER: readonly ViewDir[] = ["N", "E", "S", "W", "ortho"];

/** Where the browser asks for a view's image: the image route, never Vexcel. */
export const imageUrl = (buildingId: string, dir: ViewDir) =>
  `/api/buildings/${encodeURIComponent(buildingId)}/aerial/${dir}`;

interface Held {
  aerial: Aerial;
  images: Map<ViewDir, AerialImage>;
  at: number;
}

export function createLiveVexcel(config: LiveVexcelConfig): VexcelAdapter {
  const { base: rawBase, key, massing } = config;
  if (!rawBase || !key) {
    const missing = [!rawBase && "VEXCEL_API_BASE", !key && "VEXCEL_API_KEY"];
    throw new VexcelNotConfiguredError(missing.filter((m): m is string => Boolean(m)));
  }

  const base = rawBase.replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 8_000;
  const cacheMs = config.cacheMs ?? 30 * 60_000;
  const cacheSize = config.cacheSize ?? 6;
  const now = config.now ?? Date.now;
  const warn = config.warn ?? ((message: string) => console.warn(message));

  const held = new Map<string, Held>();
  const loading = new Map<string, Promise<Held>>();

  async function get(request: VexcelRequest): Promise<Response> {
    const response = await doFetch(`${base}/${request.path}?${request.params}`, {
      headers: { "X-API-KEY": key! },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Vexcel: GET ${request.path} answered ${response.status}`);
    return response;
  }

  async function image(dir: ViewDir, request: VexcelRequest) {
    const bytes = await (await get(request)).arrayBuffer();
    const size = imageSize(new Uint8Array(bytes));
    if (!size) throw new Error(`Vexcel: ${request.path} for ${dir} is not a JPEG or PNG`);
    return { dir, bytes, ...size };
  }

  async function load(buildingId: string, shape: Aerial): Promise<Held> {
    const at = centreOf(shape.footprint);
    const obliques = toObliques(await (await get(collectionsRequest(at))).json());
    const box = orthoBounds(shape.footprint);
    const bufferM = obliqueBufferM(shape);

    const wanted: [ViewDir, VexcelRequest][] = [
      ["ortho", orthoRequest(box)],
      ...obliques.map((o): [ViewDir, VexcelRequest] => [o.dir, obliqueRequest(o, at, bufferM)]),
    ];
    const settled = await Promise.allSettled(wanted.map(([dir, request]) => image(dir, request)));

    const got = new Map<ViewDir, Awaited<ReturnType<typeof image>>>();
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") got.set(result.value.dir, result.value);
      else warn(`Vexcel: ${wanted[i][0]} view of ${buildingId} skipped (${(result.reason as Error)?.message ?? result.reason})`);
    });
    if (got.size === 0) throw new Error(`Vexcel: no imagery for ${buildingId}`);

    const views: AerialView[] = ORDER.filter((dir) => got.has(dir)).map((dir) => {
      const { width, height } = got.get(dir)!;
      return { dir, url: imageUrl(buildingId, dir), width, height };
    });
    const ortho = got.get("ortho");
    let entries = shape.entries;
    if (ortho) {
      entries = placeOnOrtho(entries, box, ortho, warn);
    } else {
      if (entries.length) warn(`Vexcel: ${entries.length} entries of ${buildingId} dropped (no ortho to place them on)`);
      entries = [];
    }

    const aerial = Aerial.parse({ views, entries, footprint: shape.footprint, heightM: shape.heightM, source: "vexcel" });
    const images = new Map([...got].map(([dir, v]) => [dir, { bytes: v.bytes, contentType: v.contentType }]));
    return { aerial, images, at: now() };
  }

  /** The building's imagery, from memory when it is fresh, else fetched once however many ask. */
  async function hold(buildingId: string): Promise<Held | null> {
    const fresh = held.get(buildingId);
    if (fresh && now() - fresh.at < cacheMs) return fresh;
    held.delete(buildingId);

    let pending = loading.get(buildingId);
    if (!pending) {
      const shape = await massing(buildingId);
      if (!shape) return null;
      // Checked again: another caller may have started while the massing loaded.
      pending = loading.get(buildingId);
      if (!pending) {
        pending = load(buildingId, shape).finally(() => loading.delete(buildingId));
        loading.set(buildingId, pending);
      }
    }
    const result = await pending;
    held.set(buildingId, result);
    // Least recently loaded goes first.
    while (held.size > cacheSize) held.delete(held.keys().next().value!);
    return result;
  }

  return {
    async getAerial(buildingId) {
      const result = await hold(buildingId);
      return result ? structuredClone(result.aerial) : null;
    },
    async getImage(buildingId, dir) {
      const result = await hold(buildingId);
      return result?.images.get(dir) ?? null;
    },
  };
}
