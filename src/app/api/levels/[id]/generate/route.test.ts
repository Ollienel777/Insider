import { describe, expect, it } from "vitest";
import { POST } from "./route";

const post = (id: string, query = "") =>
  POST(new Request(`http://localhost/api/levels/${id}/generate${query}`, { method: "POST" }), { params: Promise.resolve({ id }) });

describe("POST /api/levels/[id]/generate?m= (#93)", () => {
  it("asks for a mission", async () => {
    expect((await post("F1")).status).toBe(400);
  });

  it("never rebuilds a prepared building: its level is committed", async () => {
    const response = await post("F1", "?m=romaine-1974");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/prepared building/);
  });

  it("answers 404 for a building CoStar does not have", async () => {
    expect((await post("900001", "?m=romaine-1974")).status).toBe(404);
  });
});
