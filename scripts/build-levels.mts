// npm run build:levels [-- <id>...]: runs the Level Builder for each building
// and writes data/levels/<id>.json (the manifest) and <id>.trace.json.
//
// With no ids it builds every building the CoStar adapter lists, skipping
// (and saying so) any that fake mode has no recorded script for. A building
// named on the command line that fails to build fails the command.
import { getCoStar } from "@/adapters/costar";
import { safeErrorMessage } from "@/adapters/llm";
import { buildLevel, writeCachedLevel } from "@/agents/builder";
import { City } from "@/domain";

const requested = process.argv.slice(2).filter((arg) => arg !== "--");
const ids =
  requested.length > 0
    ? requested
    : (await Promise.all(City.options.map((city) => getCoStar().adapter.listBuildings(city)))).flat().map((b) => b.id);

let failed = 0;
for (const id of ids) {
  try {
    const level = await buildLevel(id);
    const written = await writeCachedLevel(level);
    const counts = (kind: string) => level.trace.events.filter((e) => e.kind === kind).length;
    console.log(
      `${id}: ${level.summary || "built"} [${counts("todo")} todos, ${counts("subagent")} subagent tasks, ` +
        `${counts("tool")} tool calls, ${level.turns.length} model calls] → ${written.map((p) => p.slice(process.cwd().length + 1)).join(", ")}`,
    );
  } catch (error) {
    const message = safeErrorMessage(error);
    if (requested.length === 0 && /no recorded builder script/.test(message)) {
      console.log(`${id}: skipped, ${message}`);
      continue;
    }
    failed += 1;
    console.error(`${id}: failed: ${message}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
