// npm run cast [-- <missionId>...]: runs the Casting Director for each
// mission and writes its shortlist and trace. A fake run (fixtures and
// recorded model turns only) goes to data/casting/<missionId>.json; any
// other run goes to <HEIST_STATE_DIR>/casting/, never into the repo.
//
// With no ids it casts every mission in the library. A mission that fails
// to cast fails the command.
import { castMission, CASTING_DIR, liveCastingDir, writeCachedCasting } from "@/agents/casting";
import { MISSIONS } from "@/agents/builder";

const requested = process.argv.slice(2).filter((arg) => arg !== "--");
const ids = requested.length > 0 ? requested : MISSIONS.map((m) => m.id);

let failed = 0;
for (const id of ids) {
  try {
    const { result, summary, fake } = await castMission(id);
    const written = await writeCachedCasting(result, fake ? CASTING_DIR : liveCastingDir());
    const counts = (kind: string) => result.trace.events.filter((e) => e.kind === kind).length;
    const where = written.startsWith(`${process.cwd()}/`) ? written.slice(process.cwd().length + 1) : written;
    console.log(
      `${id}: ${summary || "cast"} [funnel ${result.funnel.map((s) => s.count).join(" → ")}; ` +
        `${counts("todo")} todos, ${counts("subagent")} subagent tasks, ${counts("tool")} tool calls] → ${where}`,
    );
  } catch (error) {
    failed += 1;
    console.error(`${id}: failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
