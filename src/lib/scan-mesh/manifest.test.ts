// Made-up data throughout: no scan, id or link here is real.
import { describe, expect, it } from "vitest";
import { buildManifest, faceResolutions, isAllowedAssetUrl, MANIFEST_QUERY, MODEL_ID } from "./manifest";

const CDN = "https://cdn-2.matterport.com/models/aaaa/assets";
const face = (res: string, i: number) => `${CDN}/pan/${res}/~/sky${i}.jpg?t=sig`;
const faces = (res: string) => [0, 1, 2, 3, 4, 5].map((i) => face(res, i));

function pano(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    position: { x: 1, y: 2, z: 1.35 },
    rotation: { x: 0, y: 0, z: 0, w: 2 },
    anchor: { id: `a-${id}`, position: { x: 1, y: 2, z: 0 }, neighbors: ["a-p2", 7, "a-p9"] },
    skyboxes: [
      { status: "available", resolution: "low", children: faces("low"), validUntil: "2026-01-01T00:30:00Z" },
      { status: "available", resolution: "high", children: faces("high"), validUntil: "2026-01-01T00:10:00Z" },
      { status: "available", resolution: "2k", children: faces("2k"), validUntil: "2026-01-01T00:09:00Z" },
    ],
    ...over,
  };
}

function model(over: Record<string, unknown> = {}) {
  return {
    assets: {
      meshes: [
        { status: "available", format: "obj", resolution: "500k", url: `${CDN}/big.obj?t=sig`, validUntil: "2026-01-01T00:20:00Z" },
        { status: "available", format: "obj", resolution: "50k", url: `${CDN}/small.obj?t=sig`, validUntil: "2026-01-01T00:08:00Z" },
      ],
    },
    panoLocations: [pano("p1"), pano("p2")],
    bundles: [
      { name: "BIM", availability: "unavailable", assets: [] },
      {
        name: "Matterpak",
        availability: "unlocked",
        assets: [{ format: "zip", status: "available", url: `${CDN}/bundles/pak.zip?t=sig`, validUntil: "2026-01-02T00:00:00Z" }],
      },
    ],
    ...over,
  };
}

describe("model ids", () => {
  it("accepts 6 to 20 letters and digits and nothing else", () => {
    expect(MODEL_ID.test("abcDEF12345")).toBe(true);
    expect(MODEL_ID.test("abc12")).toBe(false);
    expect(MODEL_ID.test("a".repeat(21))).toBe(false);
    expect(MODEL_ID.test("abc/../def")).toBe(false);
    expect(MODEL_ID.test('abc"){x}')).toBe(false);
    expect(MODEL_ID.test("abcdef\n")).toBe(false);
  });
});

describe("the asset allow-list", () => {
  it("allows https links under /models/ on the scan CDN", () => {
    expect(isAllowedAssetUrl(`${CDN}/small.obj?t=sig`)).toBe(true);
    expect(isAllowedAssetUrl("https://cdn-1.matterport.com/models/x/y.jpg")).toBe(true);
    expect(isAllowedAssetUrl("https://cdn.matterport.com/models/x/y.jpg")).toBe(true);
  });

  it.each([
    ["another host", "https://example.com/models/x.obj"],
    ["a look-alike host", "https://cdn-2.matterport.com.example.com/models/x.obj"],
    ["a host that only ends the same", "https://evilcdn-2.matterport.com/models/x.obj"],
    ["a different subdomain", "https://my.matterport.com/models/x.obj"],
    ["plain http", "http://cdn-2.matterport.com/models/x.obj"],
    ["a port", "https://cdn-2.matterport.com:8443/models/x.obj"],
    ["credentials", "https://user:pw@cdn-2.matterport.com/models/x.obj"],
    ["another path", "https://cdn-2.matterport.com/other/x.obj"],
    ["a data link", "data:text/plain,hello"],
    ["a relative link", "/models/x.obj"],
    ["not a string", 42],
    ["nothing", null],
  ])("refuses %s", (_what, url) => {
    expect(isAllowedAssetUrl(url)).toBe(false);
  });
});

describe("faceResolutions", () => {
  it("asks for the wanted resolution, then every lower one", () => {
    expect(faceResolutions("2k")).toEqual(["2k", "high", "low"]);
    expect(faceResolutions("low")).toEqual(["low"]);
    expect(faceResolutions("4k")).toEqual(["4k", "2k", "high", "low"]);
  });
});

describe("buildManifest", () => {
  it("is null for no model", () => {
    expect(buildManifest(null, { mesh: "50k", faces: "2k" })).toBeNull();
    expect(buildManifest("nope", { mesh: "50k", faces: "2k" })).toBeNull();
  });

  it("picks the wanted mesh and converts positions to y-up", () => {
    const manifest = buildManifest(model(), { mesh: "50k", faces: "2k" });
    expect(manifest?.mesh).toEqual({ url: `${CDN}/small.obj?t=sig`, resolution: "50k" });
    expect(manifest?.panos).toHaveLength(2);
    const first = manifest!.panos[0];
    expect(first.position).toEqual([1, 1.35, -2]);
    expect(first.floor).toEqual([1, 0, -2]);
    // The rotation comes back unit length.
    expect(first.rotation).toEqual([0, 0, 0, 1]);
    expect(first.resolution).toBe("2k");
    expect(first.faces).toEqual(faces("2k"));
  });

  it("relays the lowest-resolution faces as a preview, and the floor spot with its neighbours", () => {
    const first = buildManifest(model(), { mesh: "50k", faces: "2k" })!.panos[0];
    expect(first.preview).toEqual(faces("low"));
    expect(first.anchor).toBe("a-p1");
    // Only strings survive from the neighbour list.
    expect(first.neighbours).toEqual(["a-p2", "a-p9"]);
  });

  it("has no preview when the faces are already the lowest, or one of its links is off the allow-list", () => {
    expect(buildManifest(model(), { mesh: "50k", faces: "low" })!.panos[0].preview).toBeNull();
    const bad = faces("low");
    bad[0] = "https://example.com/models/sky0.jpg";
    const odd = pano("p1", {
      skyboxes: [
        { status: "available", resolution: "low", children: bad },
        { status: "available", resolution: "2k", children: faces("2k") },
      ],
    });
    const manifest = buildManifest(model({ panoLocations: [odd] }), { mesh: "50k", faces: "2k" });
    expect(manifest!.panos[0].preview).toBeNull();
    expect(manifest!.panos[0].faces).toEqual(faces("2k"));
  });

  it("has no floor spot or neighbours when the scan gives none", () => {
    const loose = pano("p1", { anchor: null });
    const first = buildManifest(model({ panoLocations: [loose] }), { mesh: "50k", faces: "2k" })!.panos[0];
    expect(first.anchor).toBeNull();
    expect(first.neighbours).toEqual([]);
    expect(first.floor).toBeNull();
  });

  it("reports the earliest expiry of what it relays", () => {
    expect(buildManifest(model(), { mesh: "50k", faces: "2k" })?.validUntil).toBe("2026-01-01T00:08:00Z");
    // The 500k mesh and the high faces are not relayed, so their times don't count.
    expect(buildManifest(model(), { mesh: "500k", faces: "2k" })?.validUntil).toBe("2026-01-01T00:09:00Z");
  });

  it("falls back to a lower face resolution a panorama does have", () => {
    const only = pano("p1", { skyboxes: [{ status: "available", resolution: "high", children: faces("high") }] });
    const manifest = buildManifest(model({ panoLocations: [only] }), { mesh: "50k", faces: "4k" });
    expect(manifest?.panos[0].resolution).toBe("high");
    expect(manifest?.panos[0].faces).toEqual(faces("high"));
  });

  it("has no mesh when the scan has none, it is locked, or its link is off the allow-list", () => {
    const want = { mesh: "50k", faces: "2k" } as const;
    expect(buildManifest(model({ assets: { meshes: [] } }), want)?.mesh).toBeNull();
    expect(buildManifest(model({ assets: null }), want)?.mesh).toBeNull();
    const locked = [{ status: "locked", format: "obj", resolution: "50k", url: `${CDN}/small.obj` }];
    expect(buildManifest(model({ assets: { meshes: locked } }), want)?.mesh).toBeNull();
    const elsewhere = [{ status: "available", format: "obj", resolution: "50k", url: "https://example.com/models/a.obj" }];
    expect(buildManifest(model({ assets: { meshes: elsewhere } }), want)?.mesh).toBeNull();
  });

  it("drops a panorama's faces when any link is off the allow-list, and keeps its position", () => {
    const bad = faces("2k");
    bad[3] = "https://example.com/models/sky3.jpg";
    const odd = pano("p1", { skyboxes: [{ status: "available", resolution: "2k", children: bad }] });
    const manifest = buildManifest(model({ panoLocations: [odd] }), { mesh: "50k", faces: "2k" });
    expect(manifest?.panos[0].faces).toBeNull();
    expect(manifest?.panos[0].resolution).toBeNull();
    expect(manifest?.panos[0].position).toEqual([1, 1.35, -2]);
  });

  it("skips a panorama with no position or rotation, and one with five faces has none", () => {
    const want = { mesh: "50k", faces: "2k" } as const;
    const lost = pano("p1", { position: null });
    const spun = pano("p2", { rotation: { x: 0, y: 0, z: 0, w: 0 } });
    expect(buildManifest(model({ panoLocations: [lost, spun, pano("p3")] }), want)?.panos.map((p) => p.id)).toEqual(["p3"]);
    const five = pano("p4", { skyboxes: [{ status: "available", resolution: "2k", children: faces("2k").slice(1) }] });
    expect(buildManifest(model({ panoLocations: [five] }), want)?.panos[0].faces).toBeNull();
  });

  it("relays nothing but what the page needs", () => {
    const manifest = buildManifest({ ...model(), name: "Somewhere", secret: "x" }, { mesh: "50k", faces: "2k" });
    expect(Object.keys(manifest!).sort()).toEqual(["detail", "mesh", "panos", "validUntil"]);
    expect(Object.keys(manifest!.panos[0]).sort()).toEqual([
      "anchor",
      "faces",
      "floor",
      "id",
      "neighbours",
      "position",
      "preview",
      "resolution",
      "rotation",
    ]);
  });
});

describe("the detailed mesh", () => {
  const want = { mesh: "50k", faces: "2k" } as const;
  const pak = (over: Record<string, unknown>) => ({ name: "Matterpak", availability: "unlocked", ...over });

  it("relays the unlocked Matterpak's link", () => {
    expect(buildManifest(model(), want)?.detail).toEqual({ url: `${CDN}/bundles/pak.zip?t=sig`, bytes: null });
  });

  it("has none when the Matterpak is locked, missing, off the allow-list or not ready", () => {
    const zip = { format: "zip", status: "available", url: `${CDN}/bundles/pak.zip` };
    const cases = [
      [],
      [pak({ availability: "locked", assets: [zip] })],
      [pak({ assets: [{ ...zip, url: "https://example.com/models/pak.zip" }] })],
      [pak({ assets: [{ ...zip, status: "locked" }] })],
      [{ name: "Other", availability: "unlocked", assets: [zip] }],
    ];
    for (const bundles of cases) expect(buildManifest(model({ bundles }), want)?.detail).toBeNull();
  });

  it("keeps the earliest expiry when the Matterpak's lasts longer", () => {
    expect(buildManifest(model(), want)?.validUntil).toBe("2026-01-01T00:08:00Z");
  });
});

describe("the query", () => {
  it("asks for links and placement only", () => {
    expect(MANIFEST_QUERY).toContain("meshes(formats: [\"obj\"])");
    expect(MANIFEST_QUERY).toContain("skyboxes(resolutions: $faces)");
    // Only the bundles' names are asked for; the model's own name and address are not.
    expect(MANIFEST_QUERY.replace("bundles { name", "")).not.toMatch(/\bname\b|\baddress\b|downloadUrl/);
  });
});
