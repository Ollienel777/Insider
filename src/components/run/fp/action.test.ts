import { describe, expect, it } from "vitest";
import { actionLabel, announcement, lockOf, lockWords, takeWords } from "./action";

const words = (doorId: string) => lockWords(lockOf({ locks: [] }, doorId, "key"));

describe("lockOf", () => {
  it("takes the floor's kind from the rules table", () => {
    expect(lockOf({ locks: [{ doorId: "d1", zoneId: "z", provenance: [] }] }, "d1", "magstripe")).toBe("magstripe");
  });
  it("prefers an owner's own lock on the door", () => {
    const locks = [{ doorId: "d1", zoneId: "z", provenance: [], lock: "badge" }];
    expect(lockOf({ locks }, "d1", "key")).toBe("badge");
  });
  it("is a key lock when nothing says otherwise", () => {
    expect(lockOf({ locks: [] }, "d9")).toBe("key");
  });
});

describe("the verbs", () => {
  it("says each era's lock in its own words", () => {
    expect(lockWords("key")).toEqual({ prompt: "Pick the lock", doing: "Picking the lock…", done: "Lock picked" });
    expect(lockWords("magstripe").doing).toBe("Cloning the keycard…");
    expect(lockWords("prox").prompt).toBe("Clone the badge");
    expect(lockWords("badge").done).toBe("Badge cloned");
    expect(lockWords("badge-pin").doing).toBe("Spoofing the badge and PIN…");
  });
  it("names the mission's objective when taking it", () => {
    expect(takeWords("files")).toEqual({ prompt: "Take the files", doing: "Taking the files…", done: "Files collected" });
  });
});

describe("actionLabel", () => {
  const pick = { kind: "pick", doorId: "d1", node: "n", done: 0, of: 2 } as const;
  it("prompts while aimed and not held", () => {
    expect(actionLabel(pick, false, words, "files", null)).toMatchObject({ phase: "aim", kind: "pick", words: { prompt: "Pick the lock" } });
  });
  it("says it is happening while E is held, with the engine's count", () => {
    expect(actionLabel({ ...pick, done: 1 }, true, words, "files", null)).toMatchObject({ phase: "hold", done: 1, of: 2 });
  });
  it("prompts the take", () => {
    expect(actionLabel({ kind: "take" }, false, words, "boxes", null)).toMatchObject({ phase: "aim", kind: "take", words: { prompt: "Take the boxes" } });
  });
  it("confirms the door the player opened while there is nothing new to aim at", () => {
    expect(actionLabel(null, false, words, "files", { doorId: "d1" })).toEqual({ phase: "landed", kind: "pick", text: "Lock picked · Door open" });
    expect(actionLabel(pick, false, words, "files", { doorId: "d0" })?.phase).toBe("aim");
  });
  it("says nothing for a far door, an exit, or nothing", () => {
    expect(actionLabel({ kind: "far", doorId: "d1" }, true, words, "files", null)).toBeNull();
    expect(actionLabel({ kind: "exit", nodeId: "x" }, false, words, "files", null)).toBeNull();
    expect(actionLabel(null, true, words, "files", null)).toBeNull();
  });
});

describe("announcement", () => {
  it("says what landed", () => {
    expect(announcement({ kind: "door", doorId: "d1" }, words, "files")).toBe("Lock picked. Door open.");
    expect(announcement({ kind: "take" }, words, "files")).toBe("Files collected. Get to the exit.");
    expect(announcement(null, words, "files")).toBeNull();
  });
});
