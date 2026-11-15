# Devpost write-up: Hobbs

Paste each section into the Devpost field of the same name. Links are
absolute, into `Ollienel777/Insider`, which is public, and point at `main`.
Everything below was checked against `main` on 15 November.

---

## Tagline

For Devpost's tagline field:

> A heist game whose levels AI agents build from a real building's data,
> walked in first person on the mesh of that building's own 3D scan.

**Elevator pitch.** Hobbs is a stealth heist game that AI agents build from a
real building. You pick a heist from history. A deep agent reads the
building's CoStar record and turns it into a level: the year built sets the
locks and cameras, the class sets the guards, the floor on the market is where
it is staged. Vexcel shows the building from above, and its Matterport scan is
the floor you walk, in first person. When a camera catches you, an AI security
chief re-plans the guards and says why. Then Owner Mode points the same engine
at a building's own security: the engine plays 50 break-ins from strategies
an AI crew writes, and the chief proposes the fix.

---

## Inspiration

Every building already has a record: when it was built, its class, which
floors stand empty. CoStar's challenge asked what an agent could do with that
record together with aerial imagery and a 3D scan of the inside. A heist crew
reads a building exactly that way. A 1974 tower means key locks and analog
cameras that sweep. Class A means more guards. An empty floor is a dark, quiet
one.

So we built a level designer that reads the record the way a crew would, and
then let you walk the result inside the building's own scan. The missions come
from documented, non-violent corporate history; the first is the 1974 Summa
Corporation burglary on Romaine Street.

The second idea came from turning the board around. If an AI crew can attack a
generated level, it can attack the security a building's owner types in, 50
times, and show which door or camera failed.

## What it does

Hobbs is a stealth game in the browser, played in seven steps.

1. **Missions.** Five missions: two heists, and three where you get there
   first to stop a theft or a cover-up. Four carry an "Inspired by" line with
   the event, its date and a source; the fifth is fiction and says so. Every
   card says the building is a stage cast for its era and that the security
   shown is game fiction.
2. **Cast.** The Casting Director, a `deepagents` agent, replays how it
   narrowed a fixture inventory, filter by filter, beside a map whose pins
   dim: era, class, a floor on the market, a 3D scan, a way in on the aerial.
   That is 61 invented buildings down to three finalists, and the screen
   heads it "Scripted run". In live mode a card above them shows a real
   building from the CoStar kit, checked need by need against its CoStar
   record. The team chose that building for the
   mission; the agent did not find it, and the search does not read the kit
   yet.
3. **Scout.** The building from above. On a kit building this is a live
   Vexcel aerial, aimed from the CoStar record. On a fixture building it is a
   massing drawn from a footprint and height, with tagged ways in.
4. **Dossier.** The Level Builder, a second `deepagents` agent, replays its
   run as a checklist of todos, subagent tasks and tool calls, and the
   **Data → Level** table fills in: year built → the security era, class →
   the guard force, available space → the staged floor and its quiet zones.
   On a real record, the label says "Real CoStar record".
5. **Plan.** Brief the crew in plain English. The crew, a model call, answers
   with a numbered plan and pushes back. The board then checks the plan
   itself and names the camera that would see you.
6. **Run.** Three ways to see the same run, all driven by one engine: an
   isometric board; on a live scan, the board beside the scan; and first
   person, in real time. On a kit building, first person walks the mesh of
   the building's real Matterport scan, which the browser colours from the
   scan's own panoramas. The picture is still rough in places. The game's
   guards and cameras are placed in it, with "Security shown is game
   fiction" on screen. A suspicion meter says who is about to see you. Step
   into a camera's light and the alarm rises, the guards converge, and the
   Security Chief's re-plan arrives. Lines such as "Carrying the files" and
   "Door open" say what just happened. On the board, click any guard, camera
   or lock for its **Why card**: the field that put it there.
7. **Debrief.** A grade, how it ended and who saw you, a replay you can scrub
   turn by turn, and every decision the Chief made with its reason. Play the
   same building again and the level remembers your last run: a guard starts
   posted where you came in, and the Chief, given your history, says why.

**Owner Mode** opens from the Debrief. The same board becomes an editor:
guards and their rounds, cameras, doors as key, badge or open, staffed desks.
**Run 50 attempts** asks the crew for a handful of strategies once, then the
engine plays them across seeds in the browser with no further model call. The
result is a count, the way out the crew used most, the guard or camera that
noticed them first most often, how much of the floor is watched, and the
"open windows" when a crew gets in and out unseen. **Ask the Chief for a fix**
proposes one change; **Apply and rerun** puts before and after side by side.
On the prepared demo pair, played on recorded strategies, moving one camera
takes 7 of 50 escapes to 1 of 50. Owner Mode opens only on fixture buildings, with "Made-up setup on a
fixture building" on screen.

**Fixtures and live.** With no keys the whole game runs on fixtures: five
invented buildings, three of them with a floor and a level, a 61-building
inventory, and recorded model turns. The chip in the top bar reads `FIXTURES`
or `LIVE`, and every model answer is tagged when no model wrote it
(**Recorded**, **Rule-based**, **No crew reply**). With the event's keys, the
path from Cast to Debrief has been played end to end on a real Los Angeles
office building from the CoStar kit, with live Vexcel, its live Matterport
scan as the floor, and Claude answering live (the casting replay itself is
still the recorded fixture run; the building comes from our showcase list).

## How we built it

One Next.js app. The engine and the boards run in the browser. Server route
handlers hold the keys, read the CoStar kit and call Vexcel and the model.

- **A rules table decides the numbers, and the agent calls it as a tool.**
  [`deriveSecurityProfile`](https://github.com/Ollienel777/Insider/blob/main/src/level/rules.ts)
  maps year built, class and available space to the security era, the guard
  force, the staged floor and its zones. Every output carries a provenance
  entry naming its layer, field, value and rule. The Why card and the Layer
  lens (`L`) read those entries, so nothing on the board is unexplained.
- **Two `deepagents` agents.** The
  [Casting Director](https://github.com/Ollienel777/Insider/blob/main/src/agents/casting/director.ts)
  and the
  [Level Builder](https://github.com/Ollienel777/Insider/blob/main/src/agents/builder/builder.ts)
  are both `createDeepAgent` agents with a todo list, subagents and their own
  tools (`location-scout` and five tools; `data-analyst`, `game-master` and
  six tools). With no key the real agent still runs, graph, todos, subagent
  dispatch and tools included, and only the model's turns are replayed from a
  script. With a key the same code runs on Claude: for a kit building, the
  Level Builder builds the level live when the server starts, and holds it in
  memory.
- **The engine is the authority.**
  [`src/engine/`](https://github.com/Ollienel777/Insider/blob/main/src/engine/index.ts)
  is pure, seeded TypeScript. Crew plans and Chief orders are parsed against a
  zod schema and clamped to legal moves; an order naming a zone or a door the
  floor does not have is dropped, and the screen says so. Guards move on the
  engine's own decision before any model answers, so a slow model never
  stalls a run. Crew and Chief calls are single structured calls with a 4 s
  default timeout and a fallback that is labelled as one.
- **Every service sits behind an adapter with a fake.**
  [CoStar](https://github.com/Ollienel777/Insider/blob/main/src/adapters/costar/kit.ts)
  is read from the event's data kit on disk, and only its property, listing
  and scan-link files, never its tenant files.
  [Vexcel](https://github.com/Ollienel777/Insider/blob/main/src/adapters/vexcel/live.ts)
  imagery is proxied at request time and never stored.
  [Matterport](https://github.com/Ollienel777/Insider/blob/main/src/adapters/matterport/live.ts)
  runs in the browser: the scan's positions and rooms become the board's
  nodes, doors and sightlines, held in the tab's memory only. For first
  person, the server relays signed links to the scan's mesh and panoramas
  and stores nothing; the browser fetches them itself.
- **First person inside a scan.** The first-person view has one walker and
  one set of rules, and two grounds to stand on: a fixture floor built from
  room rectangles, or a live scan's own mesh
  ([`scan-ground.ts`](https://github.com/Ollienel777/Insider/blob/main/src/components/run/fp/scan-ground.ts)),
  where walls, sight and doors come from the mesh. On a scan, a shader paints
  the mesh from the scan's panoramas, up to four at a time
  ([`projection.ts`](https://github.com/Ollienel777/Insider/blob/main/src/app/spike/mesh/projection.ts));
  the picture is still rough in places. The body and the engine's node are
  kept in step, so the log and the replay stay exact.
- **The gate.** Lint, typecheck, more than 2,800 unit tests, a production
  build and more than 25 Playwright smoke specs, all in fake mode, on every
  ready pull request. One spec walks the demo path from the mission picker to
  the Debrief.

## Challenges we ran into

- **A real building is not a level.** A real floor was not laid out to be
  fair: on the real building the way to the files is long and the cameras
  cover it. Nobody on the team has won that run, and we don't expect a win in
  two minutes. We did not bend the level to fake a win. In the demo the
  run on the real building is expected to end in a capture: you see which
  camera had you, the Chief's re-plan, and the Debrief's reasons. First person
  on a hand-built fixture floor is the rehearsed fallback.
- **A scan arrives late, and not at all in a hidden tab.** In the first live
  play-tests the board kept falling back to the stand-in floor, with a
  message that blamed the scan. The cause was the scan's room data arriving
  after we stopped waiting, and a background tab never starting the viewer.
  Now the board waits for the rooms, a hidden tab pauses the load instead of
  failing it and says so, a loading line shows what is happening, and one
  scan is loaded per tab and kept across Plan and Run.
- **Agents that speak about a floor they cannot see.** By our own rule the
  model never receives the scan's coordinates or layout. So the Chief's first
  live orders named "Area 2" on a board whose rooms had names of their own.
  It now gets the scan's room names and which named area each guard is in,
  never coordinates or layout. The crew
  still plans on the level's zones, so it can name a suite the scanned floor
  does not have; the board strikes that step out and says why. That one is
  open.
- **A kit building has no recording to fall back on.** When the model is
  slow on a fixture building, a recorded reply stands in. A real building
  has none, so the board now works a plan out itself and labels it "The
  board's plan".
- **First person nobody could read.** Early on you were caught by a camera
  you could not see. Cameras now show the floor they watch, a suspicion meter
  rises before the alarm, the clock waits for your first move, and an end
  card says who saw you and who reached you.
- **Licensed data, public repo.** The kit is licensed for the event, and the
  repo had to be public. No kit record, scan asset or id is committed; real
  levels are built in memory; tests run on a fictional kit of the same shape.
  Late in the build we found a kit id on two screens and took it off.
- **Latency.** The Chief is asked once at a time and its answer is let
  finish, after we found that cancelling a call for a newer alarm threw
  answers away: 4 of 10 never landed. The crew and the Chief can run on a faster model than the
  Level Builder.

**Known limits on `main`.** The casting search runs on the fixture
inventory even in live mode. At Lockdown in first person the radio mostly
repeats the last sighting instead of reading the Chief's orders (#190); the
orders still apply and the Debrief lists them. Live aerials tag no ways in
on a kit building, so its level offers the roof hatch and the street lobby.
Amazon Bedrock is wired in and not used.

## Accomplishments that we're proud of

- You can walk the mesh of a real building's 3D scan in first person, as a
  game level, with guards and cameras that the building's own CoStar record
  put there.
- Two real `deepagents` agents whose runs replay in the product, down to
  each tool call's input and output.
- The Why card: every guard, camera and lock answers "which data put you
  here?".
- Owner Mode: 50 simulated break-ins, the weak point, one proposed fix, and a
  before and after, on one model call for the attempts and one for the fix.
- It runs with no keys, the screen always says what is live and what is
  recorded, and a model answer that fails is replaced in the open.
- When the real building turned out to be hard, we kept it hard.

## What we learned

- Put a deterministic table under the agent. The agent chooses, justifies
  and writes; the table decides the numbers, so they are stable and every one
  can be traced.
- Build the fakes first and label them. The whole product existed before the
  first key, and the labels made the switch to live honest.
- Real data is harder than fixtures in ways fixtures cannot show: dozens of
  neighbours to one position, rooms with no names, data that arrives late.
- Play it. The problems that mattered on the last night were found by
  walking the real building, not by a test.
- Review prose like code. Reviewers kept finding claims in our own docs that
  the code did not bear out.

## What's next

- **Casting on the real inventory.** The search reads only the fixture
  inventory today. Map the kit's records into it, so the Casting Director
  finds the building instead of us choosing it.
- **A real building you can win.** Place the objective, cameras and rounds
  on a scanned floor so that a careful player has a route.
- **Send the crew the placed board's zones**, so it never plans on a suite
  the scan does not have.
- **Owner Mode on a real building**, unlocked only for its verified owner,
  which CoStar's ownership records could allow. Today it is fixtures only.
- **More buildings and missions**: floors and levels for the two Houston
  fixtures, and for more of the kit.
- **Ways in from the aerial** on real buildings, tagged from Vexcel imagery.

---

## Built with

next.js, react, typescript, tailwindcss, three.js, langchain, deepagents,
langgraph, zod, vitest, playwright, lucide, openstreetmap, costar, vexcel,
matterport, anthropic, claude, claude-code

Amazon Bedrock is wired in as an alternative model provider and not used, so
it is not in the list.

## Tracks and prizes

Main track: **Entertainment**. Special tracks: CoStar, LangChain, Amazon.

- **Entertainment:** a playable heist with a story: a mission from history,
  a building cast for it, a briefing, the run in three views, and a debrief.
- **CoStar "AI for the Built World":** the CoStar record builds the level,
  the Matterport scan is the floor, and Vexcel is the view from above; two
  `deepagents` agents plan and act, and the Security Chief, a single model
  call, re-plans live. Owner Mode is the "switched on Monday" answer for a
  building's security lead; casting, a location scout's search, runs on
  fixture data only.
- **LangChain "Best use of deepagents":** two `createDeepAgent` agents, the
  Casting Director and the Level Builder, each with todos, subagents and
  tools, and both traces shown in the product.
- **Amazon "Best Practical AI Innovation":** the Security Chief reasons,
  re-plans and acts within a run; between runs it is given the player's
  history and explains the changed posture. It runs on Claude through
  Anthropic's API, not on Bedrock.

Each requirement, its evidence and an honest status:
[`prizes.md`](https://github.com/Ollienel777/Insider/blob/main/hackathon/submission/prizes.md).
In short: Entertainment, LangChain and Owner Mode's rows are met in the repo;
CoStar's real-data row is met only live, at the table; CoStar's "real person"
row is partly met, because casting searches fixture data; Amazon's "adapt"
row is met with no Amazon service used.

**On the four judged criteria.** Creativity: a real building's record and
scan as a game level. Utility: Owner Mode, a first pass at "how would someone
get to the records room?" before a consultant's site visit; and casting, the
search a location scout runs for an empty floor of a given era, shown on
fixture data. Charity: this is a game first, and we do not claim more than
this: three of the five missions put the player on the side of stopping a
theft or a cover-up (one of them is playable today), and Owner Mode is for
testing your own building's security, not someone else's. The public game
never shows a real building's security, only fiction generated from its class
and era, and no tenant data is read or shown. Avidity: the repo.

## Use of AI

AI wrote most of this project, and people directed it.

**The idea.** The idea is ours: a one-pager the team wrote before the event.
An autonomous Claude ideation loop in a separate repository scored and
red-teamed it against its own candidates. It ranked ours last of twelve and
proposed a repair; we kept our idea, and its critique became the risks the
spec had to answer
([`DECISION.md`](https://github.com/Ollienel777/Insider/blob/main/hackathon/DECISION.md)).
No product code was written before hacking started; the loop's tooling
predates the event.

**The build.** Most of the code, tests and docs, this write-up included, were
written by Claude coding agents:

- an autonomous build loop from a Claude Code harness plugin, running on one
  teammate's VM and in cloud jobs, which took tickets, opened pull requests,
  had separate reviewer agents review them, fixed what they found, and merged
  on a green gate;
- each teammate's own Claude Code sessions, building, reviewing and fixing
  beside the loop;
- an AI review tool, CodeRabbit, on some pull requests.

The team's decisions, and who was working on what, were recorded and looked
up through a shared tool, Skein, which the agents' sessions connect to.

The four of us wrote the idea, set the scope and the order of work, answered
every decision the loop raised, obtained the keys, asked the sponsors about
data terms and made the calls they could not confirm (recorded in SPEC §4.5
and §11), reviewed and merged what the loop may not merge itself, play-tested
the game live on the real building, and made the calls that followed, such as
letting the real run end in a capture.

**In the product.** Anthropic's Claude is the model behind the Level Builder,
the crew and the Security Chief. In fake mode, and in CI, they answer from
recordings or rules, and the screen says so. The Casting Director's run shown
on Cast is a recording in every mode, live included.

## How to run it

Node 22.12 or later. No keys, no `.env.local`, no database.

```sh
git clone https://github.com/Ollienel777/Insider.git
cd Insider
npm ci
npm run dev
```

Open <http://localhost:3000>, pick **The Romaine Street Papers**, and follow
the primary button on each screen. The top bar shows `FIXTURES`. The Run
opens in first person: WASD and the mouse to walk, hold E to open or pick a
door. **Board** switches to the board view, which a phone-width screen gets
instead. From the Debrief, **Owner mode** opens the editor and the 50
attempts.

Live mode needs the event's keys and data kit, which are not public. Copy
`.env.example` to `.env.local`, set `HEIST_MODE=live` (keys alone leave every
service on fixtures), and fill in what you have. Each service goes live on
its own, and the rest stay on fixtures. A real building also needs
`COSTAR_KIT_DIR` and a `SHOWCASE_LEVELS` entry pairing it with a mission.
