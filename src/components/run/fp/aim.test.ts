// What the player is looking at in first person (issue 115): the watcher the
// Why card opens on with F.
import { describe, expect, it } from "vitest";
import { AIM_RADIUS_PX, aimedAt, whyKeyOf, type DrawnLabel } from "./aim";

const label = (key: string, tone: string, x: number, y: number, inSight = true): DrawnLabel => ({ key, tone, x, y, inSight });
// A 1000 by 600 view: the middle is (500, 300).
const W = 1000;
const H = 600;

describe("the watcher under the crosshair (issue 115)", () => {
  it("picks the guard, cleaner or camera nearest the middle of the view, side to side", () => {
    const labels = [label("p:G1", "guard", 560, 276), label("c:C2", "camera", 510, 270), label("p:N1", "cleaner", 900, 276)];
    expect(aimedAt(labels, W, H)?.key).toBe("c:C2");
    // A camera at the ceiling, high above the crosshair, is still the one looked at.
    expect(aimedAt([label("c:C2", "camera", 520, 20), label("p:G1", "guard", 580, 300)], W, H)?.key).toBe("c:C2");
  });

  it("ignores what is out of sight, too far off the middle, or not a watcher", () => {
    expect(aimedAt([label("p:G1", "guard", 500, 276, false)], W, H)).toBeNull();
    expect(aimedAt([label("p:G1", "guard", 500 + AIM_RADIUS_PX + 1, 276)], W, H)).toBeNull();
    expect(aimedAt([label("p:G1", "guard", 500, -10), label("c:C1", "camera", 500, H + 10)], W, H)).toBeNull();
    expect(aimedAt([label("objective", "objective", 500, 276), label("e:fl-car", "exit", 500, 276)], W, H)).toBeNull();
    expect(aimedAt([], W, H)).toBeNull();
  });

  it("names the Why card each label opens", () => {
    expect(whyKeyOf({ key: "p:G4", tone: "guard" })).toBe("guard:G4");
    expect(whyKeyOf({ key: "p:N1", tone: "cleaner" })).toBe("cleaner:N1");
    expect(whyKeyOf({ key: "c:C2", tone: "camera" })).toBe("camera:C2");
    expect(whyKeyOf({ key: "objective", tone: "objective" })).toBeNull();
    expect(whyKeyOf({ key: "e:fl-car", tone: "exit" })).toBeNull();
  });
});
