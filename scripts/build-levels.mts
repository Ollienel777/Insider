// npm run build:levels [-- <id>[:<missionId>]...]: runs the Level Builder for
// each building and mission and writes data/levels/<id>.<missionId>.json (the
// manifest) and <id>.<missionId>.trace.json (#119). A building named without
// a mission builds its own mission, the one it stages with no `?m=`.
//
// With no ids it builds every building the CoStar adapter lists, for its own
// mission, skipping (and saying so) any that has none or that fake mode has
// no recorded script for. A building named on the command line that fails to
// build fails the command.
import { getCoStar } from "@/adapters/costar";
import { safeErrorMessage } from "@/adapters/llm";
import { buildLevel, defaultMissionId, writeCachedLevel } from "@/agents/builder";
import { City } from "@/domain";

const requested = process.argv.slice(2).filter((arg) => arg !== "--");
const ids =
  requested.length > 0
    ? requested
    : (await Promise.all(City.options.map((city) => getCoStar().adapter.listBuildings(city)))).flat().map((b) => b.id);

let failed = 0;
for (const arg of ids) {
  const [id, named] = arg.split(":");
  const missionId = named ?? defaultMissionId(id);
  if (!missionId) {
    console.log(`${id}: skipped, no mission casts it; name one as ${id}:<missionId>`);
    if (requested.length > 0) failed += 1;
    continue;
  }
  try {
    const level = await buildLevel(id, missionId);
    const written = await writeCachedLevel(level);
    const counts = (kind: string) => level.trace.events.filter((e) => e.kind === kind).length;
    console.log(
      `${id} × ${missionId}: ${level.summary || "built"} [${counts("todo")} todos, ${counts("subagent")} subagent tasks, ` +
        `${counts("tool")} tool calls, ${level.turns.length} model calls] → ${written.map((p) => p.slice(process.cwd().length + 1)).join(", ")}`,
    );
  } catch (error) {
    const message = safeErrorMessage(error);
    if (requested.length === 0 && /no recorded builder script/.test(message)) {
      console.log(`${id} × ${missionId}: skipped, ${message}`);
      continue;
    }
    failed += 1;
    console.error(`${id} × ${missionId}: failed: ${message}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
