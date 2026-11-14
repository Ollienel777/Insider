# Devpost write-up: Heist Anywhere

Paste each section into the Devpost field of the same name. Links are
absolute, so they work from Devpost, but only once the repository is public:
today it is private, and they return 404 to anyone without access. Everything
here describes `main` as it is: the app runs in fake mode, on fixture
buildings and recorded model turns, and no live service has been called.
Change that wording only after a live run.

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
built 1974. The other four fixture buildings are on the map, marked "Level in
prep".

1. **Map.** Five fixture buildings in Los Angeles and Houston, each pin with
   three layer dots: CoStar, Vexcel, Matterport.
2. **Scout.** A massing of the building drawn from its footprint and height,
   with the five tagged ways in: loading dock, garage ramp, main lobby, Stair
   B exit and roof hatch. It is a drawing, not an aerial photo.
3. **Dossier.** The Level Builder's recorded run replays as a checklist of
   todos, subagent tasks and tool calls, and the Data → Level table fills in:
   1974 → Analog era; Class A → 4 guards; the loading dock → entry and exit.
   Then the Game Master's mission briefing.
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
6. **Debrief.** A grade, three stats, a scrubbable replay of the run, and the
   Chief's decisions as a timeline.
7. **Drill.** The same engine on the same floor as an evacuation drill:
   occupants from CoStar's occupied area, one stair blocked as the scenario,
   the time to clear, the bottleneck, and warden posts at the ways out people
   leave their rooms by. The scenario blocks the stair the most occupants
   would use; a tie goes to the stair whose loss cuts off the most people,
   then costs the most time. On floor 22, 6 occupants split 3 and 3 between
   Stair A and Stair B, so the tie is broken on time: Stair B is blocked and
   the floor clears in 54 s, against 47 s without Stair A. The Drill panel
   prints that rule, and says it is a planning aid, not a life-safety
   calculation.

Every model answer on screen is labelled Recorded or Rule-based, and the top
bar's `FIXTURES` chip says the data is fixtures.

**Planned, not built yet.** "Print drill plan" is on the Drill screen but
disabled; the printable plan for a fire safety director is in progress
([#34](https://github.com/Ollienel777/heist-anywhere/issues/34)). Expanding
each tool call in the Dossier's trace to its input and output is planned
([#79](https://github.com/Ollienel777/heist-anywhere/issues/79)), and so is a
Chief that adapts between runs
([#35](https://github.com/Ollienel777/heist-anywhere/issues/35)).

## How we built it

One Next.js app. The game engine and the board run in the browser; server
route handlers talk to CoStar, Vexcel and the model; Matterport runs only in
the browser.

- **The rules table decides the numbers.**
  [`deriveSecurityProfile`](https://github.com/Ollienel777/heist-anywhere/blob/main/src/level/rules.ts)
  maps CoStar's year built, class and available space, and Vexcel's entry
  tags, to the level's security era, guard force, staged floor, zones and
  entries. Every output carries a provenance entry naming its layer, field,
  value and rule, and the Why card and the Layer lens read those entries.
- **The Level Builder is a LangChain `deepagents` agent**
  ([`builder.ts`](https://github.com/Ollienel777/heist-anywhere/blob/main/src/agents/builder/builder.ts)):
  `createDeepAgent` with a todo list, two subagents (`data-analyst`,
  `game-master`) and six tools. It runs ahead of the demo and writes a
  manifest and a trace per building, so the demo never waits on a model.
  Without a key, the real agent runs, graph, todos, subagent dispatch and
  tools included, and only the model's turns are replayed from a recording.
- **The engine is authoritative.** The engine is pure, seeded TypeScript.
  Crew plans and Chief orders are parsed against a zod schema and clamped to
  legal moves, and guards move on the engine's own decision before any model
  answers. Every model call on the demo path is a single structured call with
  a 4 s timeout and a recorded or rule-based fallback.
- **Every external service sits behind an adapter with a fake.** CoStar,
  Vexcel, Matterport and the model each have a live adapter and a
  fixture-backed fake, chosen from the environment. The live adapters are
  written and unit-tested against stubs; none has been run against the real
  service.
- **The gate.** Lint, typecheck, unit tests, a production build and a
  Playwright walk of all seven screens run on every pull request.

The [README](https://github.com/Ollienel777/heist-anywhere#sponsor-technology-and-where-it-lives)
lists each sponsor's technology and the exact files that use it.

## Challenges we ran into

- **No keys.** The event's CoStar, Vexcel and Matterport keys and our
  Anthropic key were not in the build environment. We built every path
  against fixtures, and made the screens say so, rather than let a recording
  pass for a live answer.
- **A live re-plan that never stalls.** A model answer can take seconds; a
  guard cannot wait. The engine moves the guards first and the Chief's orders
  are clamped onto them when they arrive.
- **Making the data visible.** A level that is merely "inspired by" a record
  reads as decoration. Tying every guard, camera, lock and zone to the field
  that produced it, and showing it on a click, took the rules table, the Why
  card and the Layer lens.
- **Saying only what is true.** The README went through seven review rounds
  ([#81](https://github.com/Ollienel777/heist-anywhere/pull/81)), and the
  claims the reviews found untrue against the code were corrected before it
  merged. One, taken from the plan, said the live Vexcel path proxies
  imagery; the code has no proxy, and the README now says it passes Vexcel's
  image URLs through.

## Accomplishments that we're proud of

- A real `deepagents` agent, with subagents and tools, that builds a level
  from a building record and leaves a trace you can read.
- The Why card: click any guard and see the CoStar or Vexcel field behind it.
- One engine, two uses: the same floor runs a heist and an evacuation drill.
- The whole demo runs with no keys, and the gate walks it end to end on every
  change.

## What we learned

- A deterministic rules table under the agent makes its output explainable:
  the agent calls the table as a tool instead of inventing difficulty.
- Fakes that look like the real thing let the whole product be built before
  any key arrives, as long as every screen says which is which.
- Prose about code needs the same review as the code. The README's
  reviewers caught claims taken from the plan that the code did not bear out.

## What's next

- **Live data.** Run each adapter against the real CoStar, Vexcel and
  Matterport services, correct each mapping, and record a live Level Builder
  run on Claude.
- **Aerial photos in Scout**, in place of the massing.
- **More buildings.** Floors and levels for the other four fixture buildings.
- **The printable drill plan** for the fire safety director.
- **A Chief that learns** from the player's earlier runs.
- **Rebuild from the UI**: run the Level Builder live from the Dossier.

---

## Built with

next.js, react, typescript, tailwindcss, langchain, deepagents, langgraph,
zod, vitest, playwright, lucide, openstreetmap, costar, vexcel, matterport,
anthropic, claude, amazon-bedrock, claude-code

CoStar, Vexcel and Matterport are used through adapters that ran on fixtures
only. Anthropic Claude and Amazon Bedrock are wired in as model providers and
have not been called. OpenStreetMap is the data for the static basemap.

## Prizes

- **Entertainment (main track):** a playable, story-driven heist on a
  data-built level, with a mission briefing drawn from a real 1974 burglary.
- **CoStar "AI for the Built World":** all three layers make one level:
  CoStar sets the era, guards and zones, Vexcel the ways in, Matterport the
  board, and the Why card and Layer lens show which made each piece. It runs
  on fixtures; no real CoStar, Vexcel or Matterport data has been read yet.
- **LangChain "Best use of deepagents":** the Level Builder is a
  `createDeepAgent` agent with a todo list, two subagents and six tools, whose
  trace replays in the product. The agent graph, todos, subagent dispatch and
  tools run for real, but the model's turns are replayed from a recording; it
  has not yet run on Claude.
- **Amazon "Best Practical AI Innovation":** the Security Chief re-plans the
  guards on every alarm change and says why, and Drill Mode turns a building
  record into a drill scenario for a fire safety director. The Chief answers
  from recordings or rules, with no live model yet; Amazon Bedrock is wired in
  as an alternative provider but has never been called.

Each prize's requirement, evidence and status:
[`prizes.md`](https://github.com/Ollienel777/heist-anywhere/blob/main/hackathon/submission/prizes.md).

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
Builder, the crew, the Security Chief and the drill narrator). In this repo
those agents answer from recordings or rules, because no API key was
available, and the screens label each answer accordingly.
