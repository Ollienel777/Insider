// The map page `/map` (#37): with the CoStar fake failing it renders MapError,
// whose Retry reloads into the map once CoStar answers. The failure switch is
// test-only: a production build and a request cannot turn it on.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoStarAdapter } from "@/adapters/costar";
import { createFakeCoStar } from "@/adapters/costar/fake";
import { MapError } from "@/components/map/map-error";
import MapPage from "./page";

/** When set, the adapter `/map` reads; otherwise the real selection. */
let override: CoStarAdapter | null = null;

vi.mock("@/adapters/costar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/adapters/costar")>();
  return {
    ...actual,
    getCoStar: (options?: { forced?: boolean }) =>
      override ? { adapter: override, mode: "fake", reason: "CoStar: test" } : actual.getCoStar(options),
  };
});
// No request scope here, so no cookie: nothing is forced.
vi.mock("@/lib/forced-server", () => ({ forcedServices: async () => new Set() }));

type El = ReactElement<{ children?: ReactNode }>;

/**
 * Renders `/map` as a request would: the page, then the async map data inside
 * its Suspense boundary (the AppShell around it is not rendered).
 */
async function renderMap() {
  const shell = MapPage() as El;
  const suspense = shell.props.children as El;
  const data = suspense.props.children as ReactElement<object, (p: object) => Promise<ReactElement>>;
  const element = await data.type(data.props);
  return { element, html: renderToStaticMarkup(element) };
}

const pins = (html: string) => [...html.matchAll(/data-testid="map-pin"[^>]*data-building="(\w+)"/g)].map((m) => m[1]);

beforeEach(() => {
  override = null;
  // The switch is gated on NODE_ENV; pin it so an exported shell value cannot flip the suite.
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/map with the CoStar fake failing", () => {
  it("shows MapError with the message, and its Retry reloads into the map once CoStar answers", async () => {
    override = createFakeCoStar(undefined, undefined, { failWith: "CoStar timed out" });
    const failed = await renderMap();
    expect(failed.element.type).toBe(MapError);
    expect(failed.html).toContain('data-testid="map-error"');
    expect(failed.html).toContain("CoStar didn&#x27;t answer");
    expect(failed.html).toContain("CoStar timed out");
    expect(failed.html).toMatch(/<button[^>]*>Retry<\/button>/);
    expect(pins(failed.html)).toEqual([]);

    // Retry reloads the page...
    const reload = vi.fn();
    vi.stubGlobal("window", { location: { reload } });
    const screen = MapError((failed.element as ReactElement<{ message: string }>).props) as ReactElement<{ action: ReactNode }>;
    const retry = screen.props.action;
    expect(isValidElement(retry)).toBe(true);
    (retry as ReactElement<{ onClick: () => void }>).props.onClick();
    expect(reload).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();

    // ...and the reloaded page, with CoStar answering, is the map.
    override = null;
    const recovered = await renderMap();
    expect(recovered.html).not.toContain('data-testid="map-error"');
    expect(pins(recovered.html)).toEqual(["F1", "F2", "F3"]);
  });
});

describe("the failure switch", () => {
  it("is ignored in a production build: the fake answers from the fixtures", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const costar = createFakeCoStar(undefined, undefined, { failWith: "CoStar timed out" });
    expect((await costar.listBuildings("LA")).map((b) => b.id)).toEqual(["F1", "F2", "F3"]);
    expect((await costar.getBuilding("F1"))?.id).toBe("F1");
  });

  it("cannot be reached from the URL: `/map` takes no request input, and is the map", async () => {
    // The page declares no searchParams (the city tab is read in the browser),
    // so no query string can reach the adapter it builds.
    expect(MapPage.length).toBe(0);
    const { html } = await renderMap();
    expect(html).not.toContain('data-testid="map-error"');
    expect(pins(html)).toEqual(["F1", "F2", "F3"]);
  });

  it("leaves fake mode as it was when off", async () => {
    const costar = createFakeCoStar();
    expect((await costar.listBuildings("Houston")).map((b) => b.id)).toEqual(["F4", "F5"]);
  });
});
