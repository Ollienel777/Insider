# Devpost write-up: Heist Anywhere

Paste each section into the Devpost field of the same name. Links are
absolute, into `Ollienel777/Insider`, so they work from Devpost, but only once
the repository is public: today it is private, and they return 404 to anyone
without access. EVENT.md requires a public repo before submission. Everything
here describes `main` as it is: the app runs in fake mode by default, on
fixture buildings and recorded model turns; Anthropic is the only service that
has been run live, for the crew, the Security Chief and the Level Builder.
Casting and Owner Mode are in open pull requests and are described as
planned; change that wording only once they merge.

**Tagline.** A heist game whose levels an AI agent builds from a building's
data, and the same floor as a fire drill.

---

## Inspiration

Every building already has a record: when it was built, its class, how much of
it stands empty. CoStar's challenge asked what an agent could do with that data
together with aerial imagery and 3D scans. We wanted a level designer that
reads a building the way a heist crew would: a 1974 tower means key locks and
analog cameras that sweep, Class A means more guards, an empty floor means a
dark and quiet one. The mission draws on a real, non-violent break-in, the 1974
Summa Corporation burglary on Romaine Street.

The second half came from the same floor. LA and Houston fire rules require
regular high-rise evacuation drills, and the data that makes a heist level
also says how many people are on a floor and which stairs they would use.

## What it does

Heist Anywhere is a turn-based stealth game in the browser. On `main` the
demo building is Halvorsen Tower, an invented Class A tower in Bunker Hill,
built 1974, with the mission "The Romaine Street Papers". The other four
fixture buildings are on the map, marked "Level in prep".

1. **Map.** Five fixture buildings in Los Angeles and Houston, each pin with
   three layer dots: CoStar, Vexcel, Matterport.
2. **Scout.** A massing of the building drawn from its footprint and height,
   with the five tagged ways in: loading dock, garage ramp, main lobby, Stair
   B exit and roof hatch. It is a drawing, not an aerial photo.
3. **Dossier.** The Level Builder's recorded run replays as a checklist of
   todos, subagent tasks and tool calls; each task and tool opens to what it
   was given and what it returned. The Data → Level table fills in: why the
   building was cast for the mission (built 1974, Class A, floor 22 on the
   market, dock on the aerial); 1974 → Analog era; Class A → 4 guards; the
   loading dock → entry and exit. Then the Game Master's mission briefing.
4. **Plan.** Brief the crew in plain English ("Go in through the dock, wait
   for the 2 am round to pass, take the records room"). The crew answers with
   a numbered plan and pushes back, and the board checks the plan and warns
   that camera C2 sees you in the Dock Corridor.
5. **Run.** An isometric board. Walk into C2's cone and the alarm jumps to
   Alert, the guards converge, and the Security Chief's re-plan streams into
   the side panel, saying why. Click a guard, camera, lock or room for its
   **Why card**: guard G4 is at the dock because of a Vexcel entry tag, and the
   4th guard comes from Class A. Press `L` for the **Layer lens**, which tints
   every element by the data layer that produced it.
6. **Debrief.** A grade, three stats, a scrubbable replay of the run, the
   Chief's decisions as a timeline, and Try again for a fresh run.
7. **Drill (on hold).** Off the demo path while the team decides whether it
   stays, but still reachable from the step rail. The same engine on the same
   floor as an evacuation drill:
   occupants from CoStar's occupied area, one stair blocked as the scenario,
   the time to clear, the bottleneck, and warden posts at the ways out people
   leave their rooms by. The scenario blocks the stair the most occupants
   would use; a tie goes to the stair whose loss cuts off the most people,
   then costs the most time. On floor 22, 6 occupants split 3 and 3 between
   Stair A and Stair B, so the tie is broken on time: Stair B is blocked and
   the floor clears in 54 s, against 47 s without Stair A. The Drill panel
   prints that rule, and says it is a planning aid, not a life-safety
   calculation.

Every model answer on screen says where it came from: in fake mode,
Recorded or Rule-based; a live Chief answer says the model wrote it. The top
bar's `FIXTURES` chip says when the data is fixtures.

**Planned, not on `main` yet.** Casting: pick a heist from history first, and
a `deepagents` Casting Director searches CoStar's inventory for a building of
the right era and class with a floor empty tonight, a scan and a way in, and
shows three finalists ([#24](https://github.com/Ollienel777/Insider/issues/24),
[#25](https://github.com/Ollienel777/Insider/issues/25)). Owner Mode: an owner enters their own building's
security and the AI crew tries about 50 ways in
([#34](https://github.com/Ollienel777/Insider/issues/34)). A Chief that adapts between runs
([#7](https://github.com/Ollienel777/Insider/issues/7)). "Print drill plan" is on the Drill screen but disabled
([#6](https://github.com/Ollienel777/Insider/issues/6), held with Drill Mode).

## How we built it

One Next.js app. The game engine and the board run in the browser; server
route handlers talk to CoStar, Vexcel and the model; Matterport runs only in
the browser.

- **The rules table decides the numbers.**
  [`deriveSecurityProfile`](https://github.com/Ollienel777/Insider/blob/main/src/level/rules.ts)
  maps CoStar's year built, class and available space, and Vexcel's entry
  tags, to the level's security era, guard force, staged floor, zones and
  entries. Every output carries a provenance entry naming its layer, field,
  value and rule, and the Why card and the Layer lens read those entries.
- **The Level Builder is a LangChain `deepagents` agent**
  ([`builder.ts`](https://github.com/Ollienel777/Insider/blob/main/src/agents/builder/builder.ts)):
  `createDeepAgent` with a todo list, two subagents (`data-analyst`,
  `game-master`) and six tools. It runs ahead of the demo and writes a
  manifest and a trace per building and mission, so the demo never waits on
  a model. Without a key, the real agent runs, graph, todos, subagent
  dispatch and tools included, and only the model's turns are replayed from
  a script. It has run live on Claude twice on F1, and a live run can be
  saved as a replayable script
  ([`dd0d2ae`](https://github.com/Ollienel777/Insider/commit/dd0d2ae2da3145aa3a9436335b3080d6bec74185)); the demo replays a hand-written one.
- **The engine is authoritative.** The engine is pure, seeded TypeScript.
  Crew plans and Chief orders are parsed against a zod schema and clamped to
  legal moves, and guards move on the engine's own decision before any model
  answers. Every model call on the demo path is a single structured call with
  a 4 s timeout and a recorded or rule-based fallback.
- **Every external service sits behind an adapter with a fake.** CoStar,
  Vexcel, Matterport and the model each have a live adapter and a
  fixture-backed fake, chosen from the environment. The live model path has
  run against Anthropic for the crew, the Chief and the Level Builder; the
  CoStar, Vexcel and Matterport adapters are written and unit-tested against
  stubs, and none has been run against the real service.
- **The gate.** Lint, typecheck, unit tests, a production build and a
  Playwright walk of the demo path, map to Debrief, run on every pull
  request, in fake mode.

The [README](https://github.com/Ollienel777/Insider#sponsor-technology-and-where-it-lives)
lists each sponsor's technology and the exact files that use it.

## Challenges we ran into

- **Building before the keys.** The event's CoStar, Vexcel and Matterport
  data has not reached the build, and the Anthropic key arrived partway
  through. We built every path against fixtures first, and made the screens
  say so, rather than let a recording pass for a live answer. Once the key
  arrived, the crew and the Chief ran live; the crew's median of about 3.6 s
  misses our 3 s target, so a slow call falls back to the recording at 4 s
  ([`40ebd5a`](https://github.com/Ollienel777/Insider/commit/40ebd5a5fdf0508a51d67a793719a06efd6eac97)).
- **A live re-plan that never stalls.** A model answer can take seconds; a
  guard cannot wait. The engine moves the guards first and the Chief's orders
  are clamped onto them when they arrive.
- **Making the data visible.** A level that is merely "inspired by" a record
  reads as decoration. Tying every guard, camera, lock and zone to the field
  that produced it, and showing it on a click, took the rules table, the Why
  card and the Layer lens.
- **Saying only what is true.** The README went through review rounds
  before it merged ([`1de0ea9`](https://github.com/Ollienel777/Insider/commit/1de0ea99ab062321f969124ddc3ee51e31a747c8)), and its claims were cut back to what
  the code does. One, taken from the plan, said the live Vexcel path proxies
  imagery; the code has no proxy, and the README now says it passes Vexcel's
  image URLs through. Another, that the Chief is called on "every alarm
  transition", has since been made exact: it is called once after each
  player action that logs an alarm event, with that action's latest event.
  When the crew and the Chief first ran live, the README's "no live path has
  run" was corrected in the same change ([`40ebd5a`](https://github.com/Ollienel777/Insider/commit/40ebd5a5fdf0508a51d67a793719a06efd6eac97)).

## Accomplishments that we're proud of

- A real `deepagents` agent, with subagents and tools, that builds a level
  from a building record and leaves a trace you can read.
- The Why card: click any guard and see the CoStar or Vexcel field behind it.
- One engine, two uses: the same floor runs a heist and an evacuation drill.
- The whole demo runs with no keys, and the gate walks it end to end on every
  change; with a key, the same agents run live on Claude.

## What we learned

- A deterministic rules table under the agent makes its output explainable:
  the agent calls the table as a tool instead of inventing difficulty.
- Fakes that look like the real thing let the whole product be built before
  any key arrives, as long as every screen says which is which.
- Prose about code needs the same review as the code. The README's
  reviewers caught claims taken from the plan that the code did not bear out.

## What's next

- **Casting**, in review: the Casting Director and the cast screen, so the
  player picks a heist from history and the agent casts the building.
- **Owner Mode**, in review: the owner's own security, about 50 AI crew
  attempts, and the fix that the Chief proposes.
- **Live data.** Run each adapter against the real CoStar, Vexcel and
  Matterport services and correct each mapping. Re-record the live Level
  Builder run for the mission-aware builder, so the demo can replay it.
- **Aerial photos in Scout**, in place of the massing.
- **More buildings.** Floors and levels for the other four fixture buildings.
- **A Chief that learns** from the player's earlier runs.
- **Rebuild from the UI**: run the Level Builder live from the Dossier.

---

## Built with

next.js, react, typescript, tailwindcss, langchain, deepagents, langgraph,
zod, vitest, playwright, lucide, openstreetmap, costar, vexcel, matterport,
anthropic, claude, amazon-bedrock, claude-code

CoStar, Vexcel and Matterport are used through adapters that ran on fixtures
only. Anthropic Claude has run live for the crew, the Security Chief and the
Level Builder; Amazon Bedrock is wired in as a model provider and has not
been called. OpenStreetMap is the data for the static basemap.

## Prizes

- **Entertainment (main track):** a playable, story-driven heist on a
  data-built level, with a mission briefing drawn from a real 1974 burglary.
- **CoStar "AI for the Built World":** all three layers make one level:
  CoStar sets the era, guards and zones, Vexcel the ways in, Matterport the
  board, and the Why card and Layer lens show which made each piece. It runs
  on fixtures; no real CoStar, Vexcel or Matterport data has been read yet.
  Casting, the location scout's search over CoStar's inventory, is in
  review; its search code is on `main`.
- **LangChain "Best use of deepagents":** the Level Builder is a
  `createDeepAgent` agent with a todo list, two subagents and six tools, whose
  trace replays in the product. It has run live on Claude; in the demo the
  agent graph, todos, subagent dispatch and tools run for real while the
  model's turns are replayed from a script. A second deep agent, the Casting
  Director, is in review.
- **Amazon "Best Practical AI Innovation":** the Security Chief re-plans the
  guards once after each player action that logs an alarm event (a change of
  level, or, at Lockdown, a sighting in a new zone or after a turn unseen),
  with that action's latest event, and says why. It has run live on Claude;
  in fake mode it answers from recordings or rules. Amazon Bedrock is wired
  in as an alternative provider but has never been called.

Each prize's requirement, evidence and status:
[`prizes.md`](https://github.com/Ollienel777/Insider/blob/main/hackathon/submission/prizes.md).

## Use of AI

The idea came from an autonomous Claude ideation loop, run before the event in
a separate repository: its Claude agents generated candidate ideas, then
ranked and red-teamed them over several rounds into a shortlist. A person on
the team chose one idea from that shortlist.

The project was then built by an autonomous Claude Code build loop. The person
made the decisions the loop raised, and merged the changes the loop may not
merge itself, such as its CI workflow. The loop's
Claude agents wrote the product's code, tests and docs, as pull requests that
separate Claude reviewer agents reviewed before they merged.

In the product, Anthropic Claude is the model for every agent (the Level
Builder, the crew, the Security Chief and the drill narrator). The crew, the
Chief and the Level Builder have run live on Claude; the drill narrator has
not. The committed demo and CI run in fake mode, where those agents answer
from recordings or rules, and the screens label each answer accordingly.
