// POST /api/scan-overrides with a JSON body {h: HASH}: a scan's hand-made
// corrections to its first-person plan (issue 118), from a file that stays on
// this machine (`SCAN_OVERRIDES_FILE`, else `.local/scan-overrides.json`, gitignored), keyed by a hash of
// the model id so no id is written there either. No file, or no entry: `{}`.
// The positions in it come from a scan, so the file never enters the repo.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/** Where the file is: `SCAN_OVERRIDES_FILE`, or `.local/scan-overrides.json` (gitignored). Either way, never in the repo. */
const FILE = process.env.SCAN_OVERRIDES_FILE || path.join(process.cwd(), ".local", "scan-overrides.json");
const HASH = /^[0-9a-f]{16,64}$/;

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as { h?: unknown } | null;
  const h = typeof body?.h === "string" ? body.h : "";
  if (!HASH.test(h)) return NextResponse.json({}, { status: 400 });
  try {
    const all = JSON.parse(await readFile(FILE, "utf8")) as Record<string, unknown>;
    const entry = all[h];
    return NextResponse.json(entry && typeof entry === "object" ? entry : {}, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({}, { headers: { "cache-control": "no-store" } });
  }
}
