// Runs the local vetting page in a headless browser and prints each scan's row
// as it finishes. Usage, from the Insider clone (for its node_modules):
//   node <this file> ID,ID,...
// Nothing is written anywhere: the rows go to stdout only.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(pathToFileURL(`${process.cwd()}/`));
const { chromium } = require("@playwright/test");

const ids = process.argv[2];
if (!ids) throw new Error("pass the model ids, comma separated");
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (error) => console.log(`page error: ${error.message}`));
await page.goto(`http://localhost:3000/spike/vet?ids=${ids}`, { waitUntil: "domcontentloaded" });
const started = Date.now();
let printed = 0;
for (;;) {
  const vet = await page.evaluate(() => {
    const v = window.__vet;
    return v ? { done: v.done, error: v.error, rows: v.rows } : null;
  });
  if (vet?.error) console.log(`error: ${vet.error}`);
  const finished = (vet?.rows ?? []).filter((r) => r.status !== "waiting" && r.status !== "loading");
  for (const r of finished.slice(printed)) {
    console.log(
      [r.id, r.status, `positions ${r.nodes ?? "-"}`, `rooms ${r.rooms ?? "-"} (scan ${r.scanRooms ?? "-"})`, `doors ${r.doors ?? "-"}`, `most hops ${r.maxDegree ?? "-"}`, `hop ${r.hopMetres ?? "-"} m`, `${r.ms ?? "-"} ms`, r.note ?? ""].join(" | "),
    );
  }
  printed = finished.length;
  if (vet?.done || vet?.error) break;
  if (Date.now() - started > 25 * 60 * 1000) {
    console.log("gave up after 25 minutes");
    break;
  }
  await page.waitForTimeout(3000);
}
await browser.close();
console.log("vet run finished");
