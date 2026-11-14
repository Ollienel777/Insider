// npm run record:builds -- <id>...: runs the Level Builder live on the model
// and saves the run so fake mode can replay it (#31). For each building it
// writes, to fixtures/llm/recorded/:
//
// - builder-<id>.json, the model's turns as a ScriptedChatModel script;
// - <id>.json and <id>.trace.json, the live run's manifest and trace.
//
// The demo replays fixtures/llm/scripts/builder-<id>.json, not these: copy a
// recording there deliberately to change what the demo shows.
//
// It refuses to run unless the model is live and CoStar and Vexcel are on
// fixtures: a recording is committed to a public repository, so it must hold
// fixture building data only.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getChatModelSelection, safeErrorMessage } from "@/adapters/llm";
import { buildLevel, LevelBuildError, scriptName, writeCachedLevel } from "@/agents/builder";
import { RECORDED_DIR, scriptFromTurns } from "@/agents/builder/record";
import { configuredModes } from "@/lib/mode";

const ids = process.argv.slice(2).filter((arg) => arg !== "--");
if (ids.length === 0) {
  console.error("usage: npm run record:builds -- <building id>...");
  process.exit(2);
}

const modes = configuredModes(process.env);
if (modes.costar !== "fake" || modes.vexcel !== "fake") {
  console.error("record:builds: set COSTAR_MODE=fake and VEXCEL_MODE=fake; a recording may hold fixture data only");
  process.exit(2);
}
if (getChatModelSelection("builder").mode !== "live") {
  console.error("record:builds: the builder model is not live; set LLM_MODE=live and ANTHROPIC_API_KEY");
  process.exit(2);
}

let failed = 0;
for (const id of ids) {
  const recordedAt = new Date();
  try {
    const level = await buildLevel(id, { recordedAt });
    const model = level.trace.model ?? "unknown model";
    const script = scriptFromTurns(scriptName(id), level.turns, { model, recordedAt: recordedAt.toISOString() });
    await mkdir(RECORDED_DIR, { recursive: true });
    const scriptPath = path.join(RECORDED_DIR, `${scriptName(id)}.json`);
    await writeFile(scriptPath, `${JSON.stringify(script, null, 2)}\n`);
    const written = await writeCachedLevel(level, RECORDED_DIR);

    const perAgent = script.agents.map((a) => `${a.agent} ${a.turns.length}`).join(", ");
    const failedTools = level.trace.events.filter((e) => e.status === "failed").map((e) => `${e.agent}/${e.label}`);
    console.log(`${id}: ${level.summary || "built"}`);
    console.log(`  model: ${model}; ${level.turns.length} model calls (${perAgent})`);
    console.log(`  failed tool calls: ${failedTools.length === 0 ? "none" : failedTools.join(", ")}`);
    console.log(`  → ${[scriptPath, ...written].map((p) => path.relative(process.cwd(), p)).join(", ")}`);
  } catch (error) {
    failed += 1;
    console.error(`${id}: failed: ${safeErrorMessage(error)}`);
    if (error instanceof LevelBuildError) {
      for (const e of error.trace.events) console.error(`  ${e.kind} ${e.agent}/${e.label}: ${e.status}`);
    }
  }
}
process.exit(failed > 0 ? 1 : 0);
