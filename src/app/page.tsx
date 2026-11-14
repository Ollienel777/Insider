import { connection } from "next/server";
import { modeChip, serviceModes } from "@/lib/mode";

// Placeholder root page: the product name and the mode chip. The app shell
// ticket (#4) replaces it with the real top bar.
export default async function Home() {
  // Read the mode per request, not at build time, so the chip reports how
  // the running server is configured.
  await connection();
  const chip = modeChip(serviceModes(process.env));
  const title =
    chip.onFixtures.length > 0 ? `On fixtures: ${chip.onFixtures.join(", ")}` : "All services live";

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface-1 px-6">
      <h1 className="text-base font-semibold">Heist Anywhere</h1>
      <span
        data-testid="mode-chip"
        title={title}
        className="rounded-full border border-border px-2.5 py-0.5 font-mono text-xs tracking-[0.06em] text-text-2"
      >
        {chip.label}
      </span>
    </header>
  );
}
