import { describe, expect, it } from "vitest";
import ScanMeshPage from "./page";
import { modelFromHash, movedToHash } from "./model-hash";

describe("the sandbox's model id (issue 118)", () => {
  it("reads the id from after the #", () => {
    expect(modelFromHash("#m=Abc123XYZ")).toEqual({ modelId: "Abc123XYZ", given: true });
    expect(modelFromHash("m=Abc123XYZ&x=1")).toEqual({ modelId: "Abc123XYZ", given: true });
  });

  it("tells a missing id from one that isn't a model id", () => {
    expect(modelFromHash("")).toEqual({ modelId: null, given: false });
    expect(modelFromHash("#m=no!")).toEqual({ modelId: null, given: true });
  });

  it("moves an old ?m= into the hash and keeps the other options in the query", () => {
    expect(movedToHash("?m=Abc123XYZ&faces=4k", "")).toBe("?faces=4k#m=Abc123XYZ");
    expect(movedToHash("?m=Abc123XYZ", "")).toBe("#m=Abc123XYZ");
    expect(movedToHash("?faces=4k", "")).toBeNull();
  });

  it("the page never takes the id from the request, so the server never sees it", async () => {
    const element = await ScanMeshPage({ searchParams: Promise.resolve({ m: "Abc123XYZ", faces: "4k" }) });
    expect(JSON.stringify(element.props)).not.toContain("Abc123XYZ");
    expect(element.props).not.toHaveProperty("modelId");
  });
});
