// A stubbed `fetch`: nothing here reaches the Model API, and the key is made up.
import { describe, expect, it, vi } from "vitest";
import { archiveLength, fetchScanModel, MODEL_API_URL, ModelApiError, modelApiRefusal } from "./model-api";

const LIVE = { NEXT_PUBLIC_MATTERPORT_MODE: "live", MATTERPORT_API_KEY: "key-abc", MATTERPORT_API_TOKEN: "token-xyz" };

function answering(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
}

describe("modelApiRefusal", () => {
  it("refuses in fake mode, whatever keys are set", () => {
    expect(modelApiRefusal({ ...LIVE, NEXT_PUBLIC_MATTERPORT_MODE: "fake" })).toBe("fake-mode");
    expect(modelApiRefusal({ ...LIVE, NEXT_PUBLIC_MATTERPORT_MODE: undefined })).toBe("fake-mode");
    // The gate forces every mode to fake over HEIST_MODE=live.
    expect(modelApiRefusal({ ...LIVE, HEIST_MODE: "live", NEXT_PUBLIC_MATTERPORT_MODE: "fake" })).toBe("fake-mode");
  });

  it("refuses without both the key and the token", () => {
    expect(modelApiRefusal({ ...LIVE, MATTERPORT_API_KEY: "" })).toBe("no-key");
    expect(modelApiRefusal({ ...LIVE, MATTERPORT_API_TOKEN: undefined })).toBe("no-key");
  });

  it("allows live mode with both", () => {
    expect(modelApiRefusal(LIVE)).toBeNull();
    expect(modelApiRefusal({ ...LIVE, NEXT_PUBLIC_MATTERPORT_MODE: undefined, HEIST_MODE: "live" })).toBeNull();
  });
});

describe("fetchScanModel", () => {
  it("posts the query to the Model API with basic auth, uncached", async () => {
    const fetchImpl = answering({ data: { model: { id: "x" } } });
    const model = await fetchScanModel("abcDEF12345", "2k", LIVE, fetchImpl);
    expect(model).toEqual({ id: "x" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(MODEL_API_URL);
    expect(init?.method).toBe("POST");
    expect(init?.cache).toBe("no-store");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${Buffer.from("key-abc:token-xyz").toString("base64")}`);
    const sent = JSON.parse(String(init?.body));
    expect(sent.variables).toEqual({ id: "abcDEF12345", faces: ["2k", "high", "low"] });
    // The id travels as a variable, never spliced into the query.
    expect(sent.query).not.toContain("abcDEF12345");
  });

  it("is null when the API has no such model", async () => {
    expect(await fetchScanModel("abcDEF12345", "2k", LIVE, answering({ data: { model: null } }))).toBeNull();
  });

  it.each([
    ["a refused request", answering({ message: "no" }, 401), 401],
    ["an answer with errors and no data", answering({ errors: [{ message: "bad token-xyz" }] }), 200],
    ["an answer that is not JSON", vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 })), 200],
    ["no answer", vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("fetch failed key-abc"))), null],
  ])("throws a ModelApiError for %s, without the key or the API's own words", async (_what, fetchImpl, status) => {
    const failure = await fetchScanModel("abcDEF12345", "2k", LIVE, fetchImpl).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ModelApiError);
    const error = failure as ModelApiError;
    expect(error.status).toBe(status);
    expect(error.message).not.toMatch(/key-abc|token-xyz|abcDEF12345/);
  });
});

describe("archiveLength", () => {
  const url = "https://cdn-2.matterport.com/models/x/archive.zip";

  it("reads the length from a ranged answer", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1]), { status: 206, headers: { "content-range": "bytes 0-0/535000000" } }));
    expect(await archiveLength(url, fetchImpl as unknown as typeof fetch)).toBe(535000000);
  });

  it("drops an answer that ignored the range without reading its body", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 100) throw new Error("read the whole archive");
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    expect(await archiveLength(url, fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(pulled).toBeLessThanOrEqual(1);
  });
});
