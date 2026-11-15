# Pitch: LangChain, "Best use of deepagents" (2 minutes)

The ask is one line: build a deepagent, with LangChain's `deepagents`
library, for any use case ([`tracks/prizes.md`](../../tracks/prizes.md)).
No criteria or weights are published.

So this pitch centres on our two `createDeepAgent` agents (`deepagents`
1.16.5), walks their traces on screen, says why a deep agent fits each job,
and then plays the level they built, briefly.

| agent | file | todos | subagents | tools |
|---|---|---|---|---|
| **Casting Director** | `src/agents/casting/director.ts` | yes | `location-scout` (plus deepagents' `general-purpose`, kept read-only) | five: `get_mission`, `search_inventory`, `get_candidate`, `get_aerial_entries`, `write_shortlist` |
| **Level Builder** | `src/agents/builder/builder.ts` | yes | `data-analyst` and `game-master` (plus `general-purpose`) | six: `get_building`, `get_available_space`, `get_aerial_entries`, `derive_security_profile`, `get_mission`, `write_manifest` |

This builds on [`DEMO.md`](../DEMO.md), which stays the home for the setup,
each beat's detail, the fallbacks and the checklist. The beat numbers below
are DEMO.md's; **4b** is this table's own, on F1's Dossier. Brackets are read
off the screen, as in DEMO.md.

## What the traces really show

Three things in the code change what this pitch can say.

- **Cast's rows don't open.** The Casting Director's trace replays on Cast,
  but its rows are plain text there (`expandable={false}` in
  `cast-screen.tsx`). Point at them; don't click them.
- **Cast's run is a recording in every mode, over the 61-building fixture
  inventory.** It is the committed scripted run: its header begins **Scripted
  run**, and its banner is "A replay of a run recorded on fixtures. Nothing on
  this screen calls a model."
  - **One exception:** in live mode, Cast replays a shortlist from
    `.heist/casting/` instead, if `npm run cast` was run live on that machine
    (`readShortlist` in `src/app/m/[missionId]/cast/page.tsx`). Its header
    then begins "Recorded replay".
  - That wasn't tried for this pitch. Read the header, and say "scripted"
    only if it says so.
- **The showcase Dossier's rows open on nothing.** The Level Builder ran live
  on Claude for the showcase building when the server started
  (`warm-showcase.ts`). Its trace on the Dossier keeps no payloads, because
  live data stays out of it (`recordPayloads: !liveData` in `builder.ts`):
  - the todos read "Step 1 of N";
  - the subagent tasks read "Run data-analyst" and "Run game-master";
  - an opened row says "Not recorded: live data stays out of the trace."

So the rows that open on what an agent was given and what it returned are on
a **fixture** building's Dossier: F1's, in a prepared browser tab (beat 4b).

- **F1's header** begins "Recorded replay", with "model turns: scripted
  (builder-F1-romaine-1974), no LLM ran".
- **F1's banner** reads "A replay of a run recorded on fixtures, with scripted
  model turns. Nothing on this screen calls a model."
- **On a scripted run,** the graph, the todos, the subagent dispatch and every
  tool run for real. Only the model's turns are replayed.

## Cue card

| # | at | click | say | if it breaks |
|---|---|---|---|---|
| 1 | 0:00 | **Take the job** yourself: **The Romaine Street Papers** is open by default | "Hobbs is a heist game whose levels two deep agents build from a real building." | Another job is open: click the Romaine tab, then **Take the job**. |
| 2 | 0:06 | Let the replay run. Point at the **Plan** todos, then the `task location-scout` row and the tool calls under it. **Scout it** | "Deep agent one, the Casting Director: createDeepAgent with a todo list, a location-scout subagent and five tools. It writes its plan, then hands the search to the scout, which calls search_inventory once per filter. This run is scripted: the real graph and tools, with the model's turns replayed." | Slow: **Skip**. The header says "Recorded replay": "This run was recorded" instead of "This run is scripted". No showcase card: [the F1 path](../DEMO.md#if-the-showcase-building-is-out-the-f1-path). |
| 3 | 0:28 | **Plan the job** | Nothing. | No aerial, or it hangs: **Plan the job** anyway. |
| 4 | 0:30 | Point at the header, the todos, then the `task data-analyst` and `task game-master` rows. Click one row | "Deep agent two, the Level Builder. It ran live on Claude when the server started, on this building's real record. Todos, then two subagents: a data-analyst that reads the record and calls our rules table as a tool, and a game-master that writes the briefing." After the click: "Live data never enters the trace, so this row says Not recorded." | The banner doesn't say "on live data": don't say "live"; say "a recorded run". Stalls: **Skip**. |
| 4b | 0:53 | The **F1 Dossier browser tab**. Click `task data-analyst`, then `derive_security_profile` under it | "On our fixture building, the trace keeps it all: the data-analyst's brief and its answer, the rules table's input and output. And write_manifest refuses a briefing that isn't the game master's word for word. That's deepagents for us: plan in todos, delegate to narrow subagents, act through tools." | Tab lost: open `/b/F1/dossier?m=romaine-1974` and click **Skip**. |
| 5 | 1:15 | The **first browser tab**: **Brief the crew**, then **Start the run** at once | "Now the level they built." | **Start the run** needs no order: the Run carries the level's own plan. |
| 6 | 1:20 | Click the view once; hand over | "You're in the real building's own scan. W to move, the mouse to look; stand in that camera's light." At the alarm: "The Chief re-plans the guards: one structured model call, not a deep agent, and the engine clamps its orders." | Cut at **1:45**, caught or not: "Caught." or "The Chief is still hunting you." Scan fails: the F1 tab. |
| — | 1:45 | Nothing | "Two deep agents: one runs the casting search, one builds the level from the record, and every step is on screen." | — |

Ends at **1:53**, with 7 s spare.

Against DEMO.md's clock:

- Missions: 10 s → 6 s. The presenter clicks.
- Cast: 20 s → 22 s.
- Scout: 3 s → 2 s.
- Dossier: 14 s → 23 s.
- F1's Dossier is new, at 22 s.
- Plan: 13 s → 5 s. There is no crew order.
- The run: 30 s → 25 s.
- The Debrief and Owner Mode are dropped.

## What each beat answers

| # | beat | answers |
|---|---|---|
| 1 | Missions | the use case |
| 2 | Cast | **Deep agent one:** its todos, its `location-scout` subagent, and its tools called one filter at a time. It says honestly that the run is scripted. |
| 4 | Dossier | **Deep agent two,** run live: its todos, its two subagents and its tools, on a real record |
| 4b | F1's Dossier | **What each step was given and returned.** And **why deepagents:** narrow subagents, and a tool that checks one agent's work against another's. |
| 5–6 | Plan, Run | **The result:** the level the agents built, played. It says plainly that the Chief is not a deep agent. |

## Skip at this table

- **Beat 5's crew order.** The crew is one structured model call, not a deep
  agent, and it saves about 8 s.
- **Beat 7, the Debrief.**
- **Beat 8, Owner Mode.** Its crew strategies and the Chief's fix are single
  model calls too.
- **Reading the Data → Level rows** and the showcase card's needs. Those are
  CoStar's argument.
- **Clicking a row on Cast.** It doesn't open.

## Before this table

Add these to [DEMO.md's checklist](../DEMO.md#demo-machine-checklist), in
its last-few-minutes list.

1. **Open the F1 Dossier browser tab, after the F1 tab.** In a new browser
   tab, open `/b/F1/dossier?m=romaine-1974`. Let its replay finish: 5.6 s on
   the fake walk.
   - Check the banner: "A replay of a run recorded on fixtures, with scripted
     model turns."
   - Click the `task data-analyst` row: it opens on **Brief** and **Answer**.
     Click it again to close it.

   F1 needs no scan, so a background tab is fine.
2. **Check the showcase Dossier's banner once (optional).** On the cast
   card, click its **Dossier** link before its **Plan** link. The banner
   should say "on live data", which shows that the Level Builder ran live.
   Then go on to **Plan**, as the checklist says.
3. **Skip the Owner tab.** This pitch doesn't use it.
4. **The scan still loads last**, from Plan, as in DEMO.md.

**Not rehearsed:** beat 4b leaves the first tab in the background for about
20 s, with the scan loaded. DEMO.md's checklist leaves it briefly too, to
copy the order once the board is drawn, but not for this long. If Run then
shows "Loading the scan", or the label says **stand-in floor plan**, switch
to the F1 tab, as DEMO.md's beat 6 fallback says.

## Judge questions

**Most likely: "Is it really running, or is that a replay?"**
"Both are real createDeepAgent graphs. The Level Builder ran live on Claude
for this building when the server started. Without a key, the same graph,
todos, subagents and tools run on a scripted model that replays only the
model's turns, which is what CI tests."

**Also ready: "Why deep agents, not one prompt?"**
"Because the jobs split. The data-analyst only reads the record and calls the
rules table, and the game-master only writes the story. write_manifest sends
back any briefing that isn't the game master's word for word, runs over 120
words, or doesn't say its security is game fiction."

`npm run cast` and `npm run build:levels` run the two agents (`package.json`).

## Checked against `main`

Checked at 105d812.

- **The agents:**
  - Both call `createDeepAgent` with `todoListMiddleware()`.
  - Each passes deepagents' `GENERAL_PURPOSE_SUBAGENT` explicitly, so a
    dispatch to it shows in the trace. The Casting Director gives it only
    `get_mission`.
- **The tools:**
  - `scoutTools` and `directorTools` are in `src/agents/casting/tools.ts`.
  - `analystTools`, `gameMasterTools` and `builderTools` are in
    `src/agents/builder/tools.ts`.
- **Beat 2:** `data/casting/romaine-1974.json` holds the trace replayed on
  Cast:
  - three todos;
  - `get_mission`;
  - one `location-scout` task, with seven `search_inventory` calls, and three
    each of `get_candidate` and `get_aerial_entries`;
  - `write_shortlist`.
- **Beat 4:**
  - The **Available:** line, listing the three subagents, shows on the
    Dossier only (`trace-list.tsx`).
  - The live labels ("Step 1 of N", "Run data-analyst") and "Not recorded:
    live data stays out of the trace." are in `src/agents/builder/trace.ts`
    and `trace-list.tsx`.
- **Beat 4b:** `data/levels/F1.romaine-1974.trace.json` holds F1's trace:
  - three todos;
  - `task data-analyst`, with `get_building`, `get_available_space`,
    `get_aerial_entries` and `derive_security_profile`;
  - `task game-master`, with `get_mission`;
  - `write_manifest`.

  Every task and tool row carries its input and output.
- **The briefing check:** `write_manifest`'s three refusals are in
  `src/agents/builder/tools.ts`, and `briefingProblems` is in
  `src/domain/manifest.ts`.
- **Beat 5:** **Start the run** is a plain link on Plan (`plan-screen.tsx`).
- **Beat 6:**
  - The Chief is "one structured call per alarm transition"
    (`src/agents/chief/chief.ts`).
  - #207 merged after DEMO.md was written. At Lockdown the Chief is now asked
    once per zone, at most once every 10 s, and the radio reads each re-plan
    in full. That wasn't rehearsed on the scan.
- **Not confirmed from the code:** what the live Level Builder's trace looks
  like on the showcase building, step for step. The model's live turns
  decide the order and number of its rows, so read them off the screen.
