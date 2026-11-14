// Plan, Run and Debrief on a cached level that fails its check (#98): each
// shows the error state, as the Dossier does, instead of throwing out of the
// page into Next's generic error page. And the building segment's own error
// boundary renders inside the shell's frame, and its retry really retries.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_BUILDINGS } from "@/adapters/costar/fake";
import BuildingError from "@/app/b/[id]/error";
import DebriefPage from "@/app/b/[id]/debrief/page";
import PlanPage from "@/app/b/[id]/plan/page";
import RunPage from "@/app/b/[id]/run/page";

const building = FIXTURE_BUILDINGS.find((b) => b.id === "F1")!;
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
// Records where each transition starts and ends, so the retry test can tell
// that refresh and reset run inside one transition, not merely in order.
const transitions = vi.hoisted(() => ({ calls: [] as string[] }));
const readCachedLevel = vi.hoisted(() =>
  vi.fn<(buildingId: string, missionId: string) => Promise<never>>(async () => {
    throw new Error("mission.objective: expected string, received undefined");
  }),
);

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  const startTransition = (fn: () => void) => {
    transitions.calls.push("transition:start");
    react.startTransition(fn);
    transitions.calls.push("transition:end");
  };
  return { ...react, default: { ...react, startTransition }, startTransition };
});
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/lib/building", () => ({ findBuilding: async (id: string) => (id === "F1" ? building : null) }));
vi.mock("@/agents/builder/cache", () => ({ readCachedLevel }));

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

/** The first element in a tree (props included) whose own children are `label`. */
function findByText(node: ReactNode, label: string): ReactElement<{ onClick?: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByText(child, label);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  if (props.children === label) return node as ReactElement<{ onClick?: () => void }>;
  for (const value of Object.values(props)) {
    const hit = findByText(value as ReactNode, label);
    if (hit) return hit;
  }
  return null;
}

describe("a bad level file (#98)", () => {
  for (const [step, Page] of [
    ["Plan", PlanPage],
    ["Run", RunPage],
    ["Debrief", DebriefPage],
  ] as const) {
    it(`gives ${step} its error state, with the fix and the way on`, async () => {
      readCachedLevel.mockClear();
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const out = renderToStaticMarkup(
        await Page({ params: Promise.resolve({ id: "F1" }), searchParams: Promise.resolve({ m: "romaine-1974" }) }),
      );
      expect(readCachedLevel).toHaveBeenCalledWith("F1", "romaine-1974");
      expect(out).toContain('data-testid="level-unavailable"');
      expect(text(out)).toContain(`${building.name}'s cached level failed its check`);
      expect(out).toContain(`${step} · F1`);
      expect(out).toContain("npm run build:levels -- F1:romaine-1974");
      // The raw error stays off the screen and goes to the server log.
      expect(out).not.toContain("mission.objective");
      expect(logged).toHaveBeenCalledWith("[level] F1:romaine-1974 failed its check", expect.any(Error));
      logged.mockRestore();
      expect(out).toContain('href="/map"');
    });
  }
});

describe("the building segment's error boundary", () => {
  const error = Object.assign(new Error("boom"), { digest: "abc123" });

  it("says what happened, offers a retry and the way out", () => {
    const out = renderToStaticMarkup(<BuildingError error={error} reset={vi.fn()} />);
    expect(out).toContain('data-testid="building-error"');
    expect(out).toContain("This screen failed to open");
    expect(out).toContain("Error abc123");
    expect(out).toContain(">Try again<");
    expect(out).toContain('href="/map"');
    expect(out).not.toContain("boom");
  });

  it("Try again fetches the screen from the server again, then resets the boundary", () => {
    router.refresh.mockClear();
    transitions.calls = [];
    const calls = transitions.calls;
    router.refresh.mockImplementation(() => calls.push("refresh"));
    const reset = vi.fn(() => calls.push("reset"));
    const button = findByText(BuildingError({ error, reset }), "Try again");
    expect(button?.props.onClick).toBeTypeOf("function");
    button!.props.onClick!();
    expect(calls).toEqual(["transition:start", "refresh", "reset", "transition:end"]);
  });
});
