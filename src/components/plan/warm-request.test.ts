// The browser's warm-up (#90): only when the page was rendered with the model
// live, at most once per page load (strict mode's doubled effect included),
// and a failure is silent: no toast, no fallback, no chip change.
import { afterEach, describe, expect, it } from "vitest";
import { getStatus } from "@/lib/demo-status";
import { resetWarmForTests, warmModel } from "./warm-request";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function countingFetch(fail?: "reject" | "500") {
  const urls: string[] = [];
  const doFetch = (async (url: string) => {
    urls.push(url);
    if (fail === "reject") throw new Error("offline");
    return fail === "500" ? Response.json({ error: "x" }, { status: 500 }) : Response.json({ warmed: true });
  }) as unknown as typeof fetch;
  return { fetch: doFetch, urls };
}

describe("warmModel", () => {
  afterEach(() => resetWarmForTests());

  it("sends nothing when the model is not live (fake mode, or live without a key)", async () => {
    const counted = countingFetch();
    warmModel(false, counted);
    warmModel(false, counted);
    await flush();
    expect(counted.urls).toEqual([]);
  });

  it("sends one POST /api/warm per page load, however often Plan mounts", async () => {
    const counted = countingFetch();
    // React strict mode runs the effect twice; a remount runs it again.
    warmModel(true, counted);
    warmModel(true, counted);
    warmModel(true, counted);
    await flush();
    expect(counted.urls).toEqual(["/api/warm"]);

    resetWarmForTests(); // a new page load
    warmModel(true, counted);
    await flush();
    expect(counted.urls).toEqual(["/api/warm", "/api/warm"]);
  });

  it("a failed warm-up is silent: no throw, no toast, no fallback, no chip change", async () => {
    const before = getStatus();
    for (const fail of ["reject", "500"] as const) {
      resetWarmForTests();
      const counted = countingFetch(fail);
      expect(() => warmModel(true, counted)).not.toThrow();
      await flush();
      expect(counted.urls).toHaveLength(1);
    }
    const after = getStatus();
    expect(after).toBe(before);
    expect(after.toasts).toEqual([]);
    expect(after.fellBack.size).toBe(0);
  });
});
