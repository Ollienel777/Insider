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

/** A non-2xx answer from Vexcel. */
class VexcelHttpError extends Error {
  constructor(
    path: string,
    readonly status: number,
  ) {
    super(`Vexcel: GET ${path} answered ${status}`);
    this.name = "VexcelHttpError";
  }
}

export class VexcelNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Vexcel live adapter not configured: ${missing.join(" and ")} missing`);
    this.name = "VexcelNotConfiguredError";
  }
}

/** The order views are listed in, as the Scout steps through them. */
const ORDER: readonly ViewDir[] = ["N", "E", "S", "W", "ortho"];

/** The largest image Vexcel may send for one view; anything bigger is refused. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** The ortho is asked for at 16:10; an image off that by more than this is not the frame asked for. */
const ORTHO_ASPECT = 1.6;
const ORTHO_ASPECT_TOLERANCE = 0.03;

/** Where the browser asks for a view's image: the image route, never Vexcel. */
export const imageUrl = (buildingId: string, dir: ViewDir) =>
  `/api/buildings/${encodeURIComponent(buildingId)}/aerial/${dir}`;

interface Held {
  /** `null` when Vexcel has no imagery there: that building gets the massing, the service stays live. */
  aerial: Aerial | null;
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
    if (!response.ok) throw new VexcelHttpError(request.path, response.status);
    return response;
  }

  async function image(dir: ViewDir, request: VexcelRequest) {
    const response = await get(request);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_IMAGE_BYTES) throw new Error(`Vexcel: ${request.path} for ${dir} is ${declared} bytes, over the limit`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`Vexcel: ${request.path} for ${dir} is ${bytes.byteLength} bytes, over the limit`);
    const size = imageSize(new Uint8Array(bytes));
    if (!size) throw new Error(`Vexcel: ${request.path} for ${dir} is not a JPEG or PNG`);
    return { dir, bytes, ...size };
  }

  async function load(buildingId: string, shape: Aerial): Promise<Held> {
    const at = centreOf(shape.footprint);
    let collections: Response;
    try {
      collections = await get(collectionsRequest(at));
    } catch (error) {
      // No coverage at this point is about this building, not the service.
      if (error instanceof VexcelHttpError && error.status === 404) return noCoverage(buildingId);
      throw error;
    }
    const obliques = toObliques(await collections.json());
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
    if (got.size === 0) {
      // No obliques here and Vexcel refused the ortho too: nothing is flown at this point.
      const orthoFailure = settled[0].status === "rejected" ? settled[0].reason : null;
      const refused = orthoFailure instanceof VexcelHttpError && orthoFailure.status >= 400 && orthoFailure.status < 500;
      if (obliques.length === 0 && refused) return noCoverage(buildingId);
      throw new Error(`Vexcel: no imagery for ${buildingId}`);
    }

    const views: AerialView[] = ORDER.filter((dir) => got.has(dir)).map((dir) => {
      const { width, height } = got.get(dir)!;
      return { dir, url: imageUrl(buildingId, dir), width, height };
    });
    const ortho = got.get("ortho");
    let entries = shape.entries;
    if (ortho && Math.abs(ortho.width / ortho.height / ORTHO_ASPECT - 1) > ORTHO_ASPECT_TOLERANCE) {
      // Not the frame asked for, so the entries' pixels would land in the wrong place.
      if (entries.length) {
        warn(`Vexcel: ${entries.length} entries of ${buildingId} dropped (the ortho came back ${ortho.width}×${ortho.height}, not 16:10)`);
      }
      entries = [];
    } else if (ortho) {
      entries = placeOnOrtho(entries, box, ortho, warn);
    } else {
      if (entries.length) warn(`Vexcel: ${entries.length} entries of ${buildingId} dropped (no ortho to place them on)`);
      entries = [];
    }

    const aerial = Aerial.parse({ views, entries, footprint: shape.footprint, heightM: shape.heightM, source: "vexcel" });
    const images = new Map([...got].map(([dir, v]) => [dir, { bytes: v.bytes, contentType: v.contentType }]));
    return { aerial, images, at: now() };
  }

  function noCoverage(buildingId: string): Held {
    warn(`Vexcel: no coverage for ${buildingId}; it gets the massing`);
    return { aerial: null, images: new Map(), at: now() };
  }

  /** Marks a building as just used, so its images outlive the page that asked for its aerial. */
  function touch(buildingId: string, entry: Held) {
    entry.at = now();
    held.delete(buildingId);
    held.set(buildingId, entry);
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
    // Least recently used goes first.
    while (held.size > cacheSize) held.delete(held.keys().next().value!);
    return result;
  }

  return {
    async getAerial(buildingId) {
      const result = await hold(buildingId);
      if (!result) return null;
      touch(buildingId, result);
      return result.aerial ? structuredClone(result.aerial) : null;
    },
    // Only what a recent `getAerial` put in memory: never a fetch, never a
    // throw, so a missing image is a 404 and cannot trip the breaker.
    async getImage(buildingId, dir) {
      const result = held.get(buildingId);
      if (!result || now() - result.at >= cacheMs) return null;
      return result.images.get(dir) ?? null;
    },
  };
}
