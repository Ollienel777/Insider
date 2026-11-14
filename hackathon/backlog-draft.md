# Backlog draft: Heist Anywhere

Filed as GitHub issues by the build loop's plan lap once the spec PR merges
(`SPEC.md` is the reference for every ticket). Local ids `D1`, `D2`, … are
rewritten to issue numbers when filed. Each ticket lists its labels (type,
priority, area), its milestone, the demo beat it serves (SPEC §2), and any
open question that blocks it (SPEC §11). **A ticket marked "Blocked by Q…"
is filed without the ready label.**

Tickets are listed in demo-beat order within each milestone. File them in
dependency order (D17 before D16, for example), so every "Depends on" names a
ticket that already has a number. M0 tickets go one at a time.

---

## M0 Skeleton

### D1 — chore: scaffold the app, the gate and CI

- **Labels:** `chore` `P0` `area:gate` `area:shell`
- **Milestone:** M0 · **Beat:** all (the base) · **Blocked by:** none

**Size:** M

## What
Create the Next.js (App Router, TypeScript strict) app at the repo root with
Tailwind, shadcn/ui set up, ESLint flat config, Vitest and Playwright, and
`npm run gate` exactly as SPEC §6 describes: `scripts/gate.mjs` (Node
built-ins only) with steps 0 to 6, the CI workflow, `.gitattributes`,
`.env.example` (every name from SPEC §7, empty values), and a placeholder
root page that renders "Heist Anywhere" and a `FIXTURES` mode chip. Delete
`hackathon/backlog-draft.md` in this PR.

## Why
Everything else builds on a green gate that CI runs on every PR.

## Acceptance
- [ ] `npm run gate` from a fresh clone with no `node_modules` runs install, lint, typecheck, test, build and smoke, and exits 0
- [ ] The gate exits non-zero and names the step when any step fails (check by breaking a lint rule locally; not committed)
- [ ] Step 0 fails when the gate is run from a copy of `package.json`'s directory that is not the git top level, and when the `@/` alias resolves outside `top/src/`
- [ ] The gate forces `HEIST_MODE=fake` and every per-service mode to `fake`
- [ ] The smoke test starts the server on `PORT` (default 3100) with `reuseExistingServer: false` and asserts the page shows the text "Heist Anywhere" and the `FIXTURES` chip
- [ ] `.github/workflows/gate.yml` triggers on `pull_request` with no `paths` filter and on `push` to `main`, with the concurrency block from SPEC §6 (cancels on PRs, never on `main`)
- [ ] `.claude/**` is excluded in ESLint `ignores`, `tsconfig.json` `exclude`, Vitest `exclude`, Playwright `testIgnore` and Tailwind `content`
- [ ] `.gitattributes` forces LF for `*.sh` and `*.mjs` and marks `*.png`, `*.jpg`, `*.glb` under `fixtures/` binary
- [ ] `.env.example` lists every variable in SPEC §7 with no values
- [ ] `hackathon/backlog-draft.md` is deleted

## Notes
Files: `package.json`, `scripts/gate.mjs`, `.github/workflows/gate.yml`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tests/smoke/shell.spec.ts`, `src/app/{layout,page}.tsx`. Build with `NODE_OPTIONS=--max-old-space-size=1536`. CI runs `npx playwright install --with-deps chromium`. No dependencies.

### D2 — ui: design tokens and the app shell

- **Labels:** `ui` `P1` `area:shell`
- **Milestone:** M0 · **Beat:** all · **Blocked by:** none

**Size:** S

## What
Put DESIGN.md's tokens into `globals.css` and the Tailwind theme; load Inter
and JetBrains Mono with `next/font`; build the top bar (wordmark, building
slot, `ModeChip`) and the step rail for `/b/[id]/*` routes, plus the
`LayerDot` component. Restyle the shadcn Button to the primary, secondary and
ghost variants.

## Why
Every screen uses these; a shared shell keeps the seven demo screens consistent.

## Acceptance
- [ ] Every colour, radius, shadow and duration in DESIGN.md exists as a CSS variable and a Tailwind theme key
- [ ] The top bar is 56px, shows the wordmark and the mode chip; on `/b/F1/scout` it shows "Halvorsen Tower · Los Angeles" (from a stub until D4 lands, then real)
- [ ] The step rail shows Scout · Dossier · Plan · Run · Debrief and, after a divider, Drill; the current route is underlined in the accent
- [ ] The mode chip reads `FIXTURES` in fake mode and its tooltip lists services on fixtures
- [ ] Focus rings are visible on every control; buttons are at least 40px tall
- [ ] No raw hex values in `src/components/` (a lint rule or a test greps for them)

## Notes
Depends on D1. Files: `src/app/globals.css`, `tailwind.config.ts`, `src/components/shell/*`, `src/components/ui/button.tsx`.

### D3 — feat: domain schemas

- **Labels:** `feat` `P1` `area:domain`
- **Milestone:** M0 · **Beat:** all · **Blocked by:** none

**Size:** S

## What
zod schemas and inferred types for `Building`, `Aerial`, `FloorGraph`,
`LevelManifest` (with `provenance`), `Mission`, `RunLog`, `CrewPlan`,
`ChiefOrders` and `DrillReport`, exactly as SPEC §4.1 and §4.4 define them.

## Why
One source of types for adapters, agents, engine and screens.

## Acceptance
- [ ] Every type in SPEC §4.1 and §4.4 exists in `src/domain/` as a zod schema with an exported inferred type
- [ ] `Building` has no tenant field
- [ ] Unit tests parse one valid and one invalid example of each schema
- [ ] `src/domain/` contains no `any`

## Notes
Depends on D1. Files: `src/domain/*.ts`.

### D4 — feat: CoStar adapter with five fixture buildings

- **Labels:** `feat` `P1` `area:adapter-costar` `area:fixtures`
- **Milestone:** M0 · **Beat:** 1, 3 · **Blocked by:** none

**Size:** S

## What
`CoStarAdapter` interface (`listBuildings(city)`, `getBuilding(id)`,
`getAvailableSpace(id)`), its fake reading `fixtures/costar/buildings.json`,
a `live.ts` stub that throws "not configured" (D25 fills it), and the mode
switch in `index.ts` (falls back to fake when the key is missing). The five
fixture buildings are the table in SPEC §7, with realistic `availableSpace`
rows: F1 has floor 22 mostly available (suites 2202–2210) and a few
scattered suites elsewhere.

## Why
Beat 1 lists these buildings; beat 3's level is built from their fields.

## Acceptance
- [ ] `listBuildings("LA")` returns F1–F3 and `listBuildings("Houston")` F4–F5 in fake mode
- [ ] Each fixture validates against `Building`, has `source: "fixture"`, and plausible suite numbers and square feet (no round placeholders such as 1000)
- [ ] `index.ts` returns the fake when `COSTAR_MODE` is `fake`, and also when it is `live` with no `COSTAR_API_KEY`, and reports which it chose
- [ ] `GET /api/buildings?city=LA` returns the three LA buildings
- [ ] Unit tests cover the mode switch

## Notes
Depends on D3. Files: `src/adapters/costar/*`, `fixtures/costar/buildings.json`, `src/app/api/buildings/route.ts`.

### D5 — feat: Vexcel adapter with a massing-render fake

- **Labels:** `feat` `P1` `area:adapter-vexcel` `area:fixtures`
- **Milestone:** M0 · **Beat:** 2 · **Blocked by:** none

**Size:** S

## What
`VexcelAdapter` (`getAerial(buildingId)` → `Aerial`), a fake that returns a
footprint polygon, a height and four to five tagged entries per building from
`fixtures/vexcel/*.json` with no image URLs (the Scout screen renders the
massing), a `live.ts` stub, and the mode switch. F1's entries: dock on the
north face, garage ramp on the east, lobby on the south, roof hatch.

## Why
Beat 2 shows the routes in; the builder reads the entries.

## Acceptance
- [ ] `GET /api/buildings/F1/aerial` returns an `Aerial` with a footprint, a height and at least four entries, each with a `note`
- [ ] Every fixture building has an aerial fixture that validates
- [ ] No image file from Vexcel is committed
- [ ] Unit tests cover the mode switch

## Notes
Depends on D3. Files: `src/adapters/vexcel/*`, `fixtures/vexcel/*.json`, `src/app/api/buildings/[id]/aerial/route.ts`.

### D6 — feat: Matterport adapter and the F1 floor

- **Labels:** `feat` `P1` `area:adapter-matterport` `area:fixtures`
- **Milestone:** M0 · **Beat:** 3–7 · **Blocked by:** none

**Size:** M

## What
A browser-side `MatterportAdapter` (`loadFloor(building)` → `FloorGraph`)
with a fake that reads `fixtures/floors/F1.json`, and a `live.ts` stub. Hand-
author F1's floor 22 as fiction: 24–32 nodes over 8–12 rooms (freight lift
lobby, dock corridor, records room, server closet, open office 2210, suites
2202–2208, east stair, west stair, elevator lobby), edges with doors where
they cross rooms (records room door lockable), sightlines per node, and node
tags (`stair`, `lift`, `entry`). Add a small validator script that checks
the graph is connected and every sightline target exists.

## Why
The board, the guards, the crew's plan and the drill all run on this graph.

## Acceptance
- [ ] `fixtures/floors/F1.json` validates against `FloorGraph`, has 24–32 nodes, 8–12 rooms, and is connected
- [ ] At least two `stair` nodes and one `entry` node per Vexcel entry that reaches floor 22 (the dock via the freight lift, the roof via the east stair)
- [ ] Every sightline is symmetric or documented as one-way, and every target id exists (unit test)
- [ ] The adapter module is imported only from client components (a test or lint rule fails on a server import)
- [ ] Room labels are realistic floor labels, not "Room 1"

## Notes
Depends on D3. Files: `src/adapters/matterport/*`, `fixtures/floors/F1.json`, `scripts/check-floor.mjs`. The fake is fiction; SPEC §4.5's terms stance applies only to live.

### D7 — feat: LLM adapter and ScriptedChatModel

- **Labels:** `feat` `P1` `area:adapter-llm`
- **Milestone:** M0 · **Beat:** 3, 4, 5, 7 · **Blocked by:** none

**Size:** M

## What
`src/adapters/llm/`: `getChatModel(role: "builder" | "fast")` returning a
LangChain chat model for the mode: `ChatAnthropic` (live, Anthropic),
`ChatBedrockConverse` (refused unless `BEDROCK_ENABLED=1`), or fakes.
`ScriptedChatModel extends BaseChatModel` implements `bindTools` and
`withStructuredOutput`, and replays a script of `AIMessage`s (with
`tool_calls`) loaded from `fixtures/llm/scripts/*.json`. A
`structuredCall(schema, prompt, {fake, timeoutMs})` helper runs one
structured call and, on timeout or error, returns the fake's answer tagged
`recorded: true`.

## Why
Every agent goes through this; the deep agent must run keyless in CI.

## Acceptance
- [ ] With no keys, `getChatModel` returns fakes and makes no network call (a test stubs `fetch` to throw)
- [ ] `ScriptedChatModel` replays a two-step script with a tool call, and a LangChain agent using it calls the tool and finishes (unit test)
- [ ] `structuredCall` returns the fake answer tagged `recorded: true` when the live call exceeds `LLM_TIMEOUT_MS` (test with a delayed stub)
- [ ] `LLM_PROVIDER=bedrock` without `BEDROCK_ENABLED=1` raises a clear configuration error
- [ ] `max_tokens` is 400 for the `fast` role

## Notes
Depends on D3. Files: `src/adapters/llm/{index,anthropic,bedrock,scripted,structured}.ts`. Packages: `langchain`, `@langchain/core`, `@langchain/anthropic`, `@langchain/aws`.

### D8 — feat: the map screen

- **Labels:** `feat` `P1` `area:map` `area:gate`
- **Milestone:** M0 · **Beat:** 1 · **Blocked by:** none

**Size:** M

## What
`/`: a static dark basemap image per city (bundled, desaturated, with
attribution) with the fixture buildings projected as pins from `lat`/`lng`,
three `LayerDot`s per pin, a hover card (name, neighbourhood, built, class,
stories), a side panel listing buildings, LA / Houston tabs, and the primary
action "Scout this building" going to `/b/[id]/scout`. Extend the smoke test
to open the map.

## Why
Beat 1, and M0's exit criterion: a smoke test opening the first demo screen.

## Acceptance
- [ ] `/` shows three LA pins and three rows; the Houston tab shows two
- [ ] Hovering a pin shows its card; selecting a row highlights its pin and enables "Scout this building"
- [ ] Each pin shows three layer dots, dimmed for any layer the building lacks
- [ ] The basemap's attribution is shown
- [ ] The smoke test asserts the map lists "Halvorsen Tower" and navigates to its Scout route
- [ ] Empty city state and loading skeleton exist

## Notes
Depends on D2, D4. Files: `src/app/page.tsx`, `src/components/map/*`, `public/basemaps/{la,houston}.webp` (an openly licensed basemap render, e.g. OpenStreetMap-derived with attribution).

---

## M1 Demo path (on fakes)

### D9 — feat: turn engine core

- **Labels:** `feat` `P1` `area:engine`
- **Milestone:** M1 · **Beat:** 5 · **Blocked by:** none

**Size:** M

## What
A pure, seeded engine in `src/engine/`: state (player node, guards with
patrol loops, turn, alarm), actions (`move` to a neighbour, `sprint` two
hops, `wait`, `pickLock`, `take`), guard movement after each player action
(patrol loop, or toward a target zone by A* one hop per tempo), locked
doors, the objective and exits, win and lose conditions, and a `RunLog`
entry per turn.

## Why
The engine is authoritative; everything the model says is clamped to it.

## Acceptance
- [ ] Given the same seed and actions, two runs produce identical logs (test)
- [ ] Illegal actions (non-neighbour move, locked door without pick) are rejected with a reason
- [ ] Guards follow their patrol loop at the profile's tempo; a guard given a target zone reaches it by shortest path
- [ ] Taking the objective and reaching an exit ends the run as a win; being on a guard's node during Alert ends it as caught
- [ ] The engine imports nothing from React, the DOM, or `Math.random`

## Notes
Depends on D3, D6. Files: `src/engine/{state,actions,guards,path,log}.ts`.

### D10 — feat: detection, noise and the alarm states

- **Labels:** `feat` `P1` `area:engine`
- **Milestone:** M1 · **Beat:** 5 · **Blocked by:** none

**Size:** M

## What
Vision: guards see their node's sightlines in their facing direction;
cameras cover node sets (analog cameras sweep alternate halves each turn,
PTZ on a 3-turn cycle). Noise: sprint and lock-picking emit noise heard
within N hops (+1 in quiet zones). Cleaners in crowded zones see like
guards but only raise Suspicious. The alarm machine Calm → Suspicious →
Alert → Lockdown (Alert held 3 turns), with decay back down, and an event
emitted on every transition with the last-known zone. On Alert, guards
converge on the last-known zone at once, without waiting for the Chief.

## Why
Beat 5's trip and the immediate guard response.

## Acceptance
- [ ] Stepping onto a node in an active camera's cover raises the alarm to Alert on that turn (test on F1)
- [ ] An analog camera's cover alternates every turn (test)
- [ ] A sprint within hearing range raises Suspicious; inside a quiet zone the range is one hop further (test)
- [ ] Every transition emits one event with `from`, `to`, `turn` and `lastKnownZone`
- [ ] On Alert, every guard's next move heads toward the last-known zone before any Chief order exists

## Notes
Depends on D9. Files: `src/engine/{vision,noise,alarm}.ts`.

### D11 — feat: the Level Builder on deepagents

- **Labels:** `feat` `P1` `area:agent-builder`
- **Milestone:** M1 · **Beat:** 3 · **Blocked by:** none

**Size:** M

## What
The Level Builder (SPEC §4.4) on the npm `deepagents` package's
`createDeepAgent`: planning todos, the subagents `data-analyst` and
`game-master`, and the tools `get_building`, `get_available_space`,
`get_aerial_entries`, `derive_security_profile` (D12), `list_missions`,
`write_manifest`. A trace recorder captures todos, subagent tasks and tool
calls with timings. A script `npm run build:levels` runs it for each
building and writes `data/levels/<id>.json` (manifest) and
`<id>.trace.json`. Write F1's `ScriptedChatModel` script and the
`romaine-1974` mission in `fixtures/missions.json`. Start with a 30-minute
check that JS `deepagents` supports todos and subagents; if it does not,
record that on the ticket and stop for a decision (SPEC §4.4 fallback).

## Why
The level is visibly made by an agent from the data (CoStar 30% agentic, LangChain prize).

## Acceptance
- [ ] `package.json` depends on `deepagents`, and `src/agents/builder/` calls `createDeepAgent`
- [ ] In fake mode, `npm run build:levels -- F1` runs the deep agent, whose tools really execute against the fake adapters, and writes a manifest that validates against `LevelManifest`
- [ ] The manifest's `provenance` has an entry for era, guard count, each zone and each entry, naming layer, field, value and rule
- [ ] The trace has at least one todo list, two subagent tasks and five tool calls
- [ ] The manifest contains no Matterport-derived data (it has zone roles, not node ids)
- [ ] `GET /api/levels/F1` returns the cached manifest and trace
- [ ] The `romaine-1974` mission carries its "Inspired by" event, date and source URL

## Notes
Depends on D4, D5, D7, D12. Files: `src/agents/builder/*`, `scripts/build-levels.mts`, `fixtures/llm/scripts/builder-F1.json`, `fixtures/missions.json`, `data/levels/F1*.json`, `src/app/api/levels/[id]/route.ts`.

### D12 — feat: the rules table

- **Labels:** `feat` `P1` `area:level`
- **Milestone:** M1 · **Beat:** 3, 5 · **Blocked by:** none

**Size:** S

## What
`src/level/rules.ts`: `deriveSecurityProfile(building, aerial)` implementing
SPEC §4.3 (era from year built, guard force from class, staging floor and
quiet/crowded zones from available space, entries from Vexcel tags), each
output with a provenance entry.

## Why
Makes CoStar's fields visibly and deterministically drive the level (DECISION risk 1).

## Acceptance
- [ ] F1 (1974, A) yields Analog era, key locks, sweeping analog cameras, 4 guards, staging floor 22
- [ ] Each era boundary (1979/1980, 1999/2000, 2014/2015) has a test
- [ ] Every output field has a provenance entry with layer, field, value and a plain-English rule
- [ ] The function is pure (no I/O)

## Notes
Depends on D3. Files: `src/level/rules.ts`, `src/level/rules.test.ts`.

### D13 — feat: the placer

- **Labels:** `feat` `P1` `area:level`
- **Milestone:** M1 · **Beat:** 4, 5 · **Blocked by:** none

**Size:** S

## What
`placeLevel(manifest, floor, seed)` runs in the browser and maps the
manifest's roles onto the floor: zones onto rooms (quiet = available suites,
objective = records room, secure = server closet), guards onto patrol loops,
cameras onto corridor nodes, locks onto doors, entries onto `entry` nodes.
Each placed element keeps a pointer to its provenance entries.

## Why
Keeps Matterport data in the browser while the manifest drives the level.

## Acceptance
- [ ] F1 places 4 guards, the camera count the profile asks for, a locked records-room door, and the dock and roof entries
- [ ] Same inputs and seed give the same placement (test)
- [ ] Every placed element exposes its provenance entries
- [ ] No guard patrol starts within two hops of an entry node

## Notes
Depends on D6, D9, D11. Files: `src/level/placer.ts`.

### D14 — feat: the scout screen

- **Labels:** `feat` `P1` `area:scout`
- **Milestone:** M1 · **Beat:** 2 · **Blocked by:** none

**Size:** M

## What
`/b/[id]/scout`: in fake mode, a Three.js massing render of the footprint
and height on a dark ground plane, with four fixed camera positions (N, E,
S, W) and a top-down ortho, cross-fading between them on drag, ← → keys or
the direction chips; entry markers as accent rings with mono labels;
selecting one shows its note in the side panel. In live mode the same
controls cross-fade the Vexcel images (D27). Primary action "Plan the job"
→ Dossier.

## Why
Beat 2: the aerial shows the real ways in.

## Acceptance
- [ ] On `/b/F1/scout`, ← and → move between the five views with a 200ms cross-fade
- [ ] Four entry markers are visible and labelled; clicking one shows its note
- [ ] "Plan the job" navigates to `/b/F1/dossier`
- [ ] The view loads with a skeleton the size of the final canvas; no layout shift
- [ ] Respects `prefers-reduced-motion`

## Notes
Depends on D2, D5. Files: `src/app/b/[id]/scout/page.tsx`, `src/components/scout/*`.

### D15 — feat: the dossier screen

- **Labels:** `feat` `P1` `area:dossier`
- **Milestone:** M1 · **Beat:** 3 · **Blocked by:** none

**Size:** M

## What
`/b/[id]/dossier`: replays the cached trace as a `TraceList` over about six
seconds (todos tick, subagent tasks indent, tool calls in mono with
durations), then fills the CoStar facts, the **Data → Level** table (one
`ProvenanceRow` per rule with its layer dot), and the mission briefing with
its "Inspired by" line, source link and the game-fiction disclaimer.
Primary action "Brief the crew" → Plan. A "Skip" control shows everything at
once.

## Why
Beat 3: the judge sees the data become the level.

## Acceptance
- [ ] On `/b/F1/dossier` the trace replays and the table shows rows for year built 1974, class A, floor 22's available suites and the dock entry, each with its result
- [ ] The briefing shows the `romaine-1974` title, date, source link and the disclaimer line from DESIGN.md
- [ ] Skeleton rows hold each block's height before it fills; "Skip" completes it at once
- [ ] No tenant names appear anywhere on the screen
- [ ] The smoke test asserts "1974", "Analog era" and "4 guards" on this screen

## Notes
Depends on D2, D11. Files: `src/app/b/[id]/dossier/page.tsx`, `src/components/dossier/*`.

### D16 — feat: brief the crew

- **Labels:** `feat` `P1` `area:plan` `area:agent-crew`
- **Milestone:** M1 · **Beat:** 4 · **Blocked by:** none

**Size:** M

## What
`/b/[id]/plan`: the board at reduced emphasis and an order textarea.
`POST /api/crew` makes one `structuredCall` with the order, the manifest's
zones (ids and fiction names only) and the guard roster, returning a
`CrewPlan`. The fake routes on keywords (dock, roof, lobby, garage, wait,
quiet) to recorded replies in `fixtures/llm/crew-F1.json`, with a default.
In the browser a deterministic validator walks the plan's zones on the
board, simulating patrols and camera cycles, and attaches warnings naming
the camera or guard and the turn. The plan draws as a ghost path. Primary
action "Start the run".

## Why
Beat 4: the crew answers with a plan and pushes back.

## Acceptance
- [ ] Submitting "Go in through the dock, wait for the 2 am round to pass, take the records room" on F1 shows numbered steps within 3 s on fakes
- [ ] The reply includes a warning that names camera C2 and a turn, computed by the validator (unit test on the validator)
- [ ] The ghost path draws on the board in the accent at 50%
- [ ] Zones in the model's reply that do not exist are dropped and noted
- [ ] A recorded fallback reply shows a `recorded` chip
- [ ] The request body contains no node coordinates or adjacency (test)

## Notes
Depends on D7, D13, D17 for the board component (or a stub until it lands). Files: `src/app/b/[id]/plan/page.tsx`, `src/agents/crew/*`, `src/app/api/crew/route.ts`, `src/level/validate-plan.ts`.

### D17 — feat: the run board

- **Labels:** `feat` `P1` `area:run`
- **Milestone:** M1 · **Beat:** 5 · **Blocked by:** none

**Size:** M

## What
The isometric board with `@react-three/fiber`: rooms as low tiles, nodes as
discs, guards and cameras as pieces with cones, the player in the accent with
its path. Numbered neighbour hints; keys 1–9, `W`, `Space`; click to move.
Hops animate (player 200ms, guards 300ms). The side panel shows the alarm
banner, the objective and the plan's next step. On win or caught, "See the
debrief".

## Why
Beat 5 is the run.

## Acceptance
- [ ] `/b/F1/run` renders F1's floor with 4 guards and its cameras visible
- [ ] Pressing a neighbour's number moves the player and then the guards
- [ ] Cones show the nodes each guard and camera covers this turn
- [ ] The alarm banner shows the current state in the colours DESIGN.md assigns
- [ ] The board fills at least 65% of a 1440px width and pieces are at least 28px
- [ ] The smoke test plays a scripted sequence on F1 that steps into C2's cover and asserts the banner reads "Alert"

## Notes
Depends on D2, D10, D13. Files: `src/app/b/[id]/run/page.tsx`, `src/components/run/*`.

### D18 — feat: the Security Chief

- **Labels:** `feat` `P1` `area:agent-chief` `area:run`
- **Milestone:** M1 · **Beat:** 5 (wow) · **Blocked by:** none

**Size:** M

## What
On each alarm transition, `POST /api/chief` makes one `structuredCall` with
the transition, last-known zone, guard roster, zone list and manifest,
returning `ChiefOrders`. The engine clamps orders (unknown guards or zones
dropped; moves by A* one hop per tempo) and applies them from the next
turn. The fake returns recorded orders per transition from
`fixtures/llm/chief-F1.json`, or a deterministic template built from the
state. The side panel streams the rationale word by word, then the orders
row by row, and each ordered guard's next three hops draw dashed.

## Why
The wow beat: the AI re-plans live and shows its reasoning.

## Acceptance
- [ ] On the smoke test's Alert, the Chief's rationale appears within 4 s on fakes and names at least one guard and zone
- [ ] Guards move toward the last-known zone during the call (no turn waits on it)
- [ ] After the orders land, each ordered guard's path changes to match its order, and the dashed preview shows it
- [ ] An order naming an unknown guard or zone is dropped without error (test)
- [ ] The request body contains no node coordinates or adjacency (test)

## Notes
Depends on D7, D10, D17. Files: `src/agents/chief/*`, `src/app/api/chief/route.ts`, `src/components/run/chief-panel.tsx`.

### D19 — feat: the Why card

- **Labels:** `feat` `P1` `area:run`
- **Milestone:** M1 · **Beat:** 5 · **Blocked by:** none

**Size:** S

## What
Clicking a guard, camera, lock or zone draws the provenance thread in the
element's layer colour and opens the Why card popover with its
`ProvenanceRow`s (DESIGN.md "The signature element"). `Esc` closes it.

## Why
The signature feature, and CoStar's "combines layers" made visible.

## Acceptance
- [ ] Clicking the dock guard on F1 shows rows from both Vexcel (dock entry) and CoStar (class A → 4 guards)
- [ ] Clicking the records-room lock shows the year-built row and the era rule
- [ ] The thread draws in 300ms in the first row's layer colour; `Esc` and outside click close the card
- [ ] Works on Plan's board too

## Notes
Depends on D13, D17. Files: `src/components/run/why-card.tsx`, `src/components/run/provenance-thread.tsx`.

### D20 — feat: the debrief screen

- **Labels:** `feat` `P1` `area:debrief`
- **Milestone:** M1 · **Beat:** 6 · **Blocked by:** none

**Size:** M

## What
`/b/[id]/debrief` from the `RunLog`: a grade (S, A–D from turns, noise and
detections), three stats, a replay board with a Slider that scrubs turns
showing the player's and every guard's path, and the Chief's decisions as a
timeline with each rationale. Primary action "Run the drill".

## Why
Beat 6.

## Acceptance
- [ ] After the smoke run, the debrief shows a grade and the three stats with tabular figures
- [ ] Scrubbing the slider moves every piece to that turn's positions
- [ ] The timeline lists every Chief decision with its turn and rationale
- [ ] With no run in storage, an empty state offers "Start the run"

## Notes
Depends on D17, D18. Files: `src/app/b/[id]/debrief/page.tsx`, `src/components/debrief/*`.

### D21 — feat: the drill simulation

- **Labels:** `feat` `P1` `area:drill`
- **Milestone:** M1 · **Beat:** 7 · **Blocked by:** none

**Size:** S

## What
`src/drill/simulate.ts`: occupants per occupied suite on the staged floor
(occupied area ÷ 250 sf per person, rounded), the scenario blocking the
stair that most occupants would use, each occupant routed to the nearest open
stair, node capacity per tick, walking at 1.2 m/s over node distances.
Output `DrillReport`: time to clear, per-zone clear times, the bottleneck
node, and warden posts (one per crowded zone at its exit door).

## Why
The Monday answer (CoStar 25%, main judging's charity).

## Acceptance
- [ ] F1's headcount equals floor 22's occupied area ÷ 250, and the report says so
- [ ] Blocking a stair increases time to clear versus none blocked (test)
- [ ] The simulation is deterministic and pure (test)
- [ ] Every occupant reaches a stair, or the report lists who cannot

## Notes
Depends on D4, D9. Files: `src/drill/*`.

### D22 — feat: the drill screen

- **Labels:** `feat` `P1` `area:drill`
- **Milestone:** M1 · **Beat:** 7 · **Blocked by:** none

**Size:** M

## What
`/b/[id]/drill`: the board in the drill treatment, occupants as dots flowing
to stairs at speed, the blocked stair struck through; the panel with time to
clear, the bottleneck, per-zone clear times, warden posts, a narrative
paragraph from `POST /api/drill/narrative` (one structured call, recorded
fake), and the disclaimer. Primary action "Print drill plan" (D32 builds
it; a disabled button with a tooltip until then).

## Why
Beat 7.

## Acceptance
- [ ] `/b/F1/drill` plays the evacuation in under 10 seconds and then shows time to clear in `3xl`
- [ ] The blocked stair is marked and named in the report
- [ ] The narrative streams in, and shows a `recorded` chip in fake mode
- [ ] The disclaimer from DESIGN.md is visible
- [ ] The smoke test asserts a time to clear is shown

## Notes
Depends on D2, D7, D21. Files: `src/app/b/[id]/drill/page.tsx`, `src/components/drill/*`, `src/app/api/drill/narrative/route.ts`.

### D23 — test: smoke the whole demo path

- **Labels:** `chore` `P1` `area:gate`
- **Milestone:** M1 · **Beat:** 1–7 · **Blocked by:** none

**Size:** S

## What
One Playwright spec that walks beats 1 to 7 on F1 in fake mode with the
outcome assertions listed in SPEC §6, at 1440×900, saving a screenshot per
beat to `test-results/`.

## Why
M1's exit criterion; keeps the demo path from regressing.

## Acceptance
- [ ] The spec asserts each outcome in SPEC §6 item 6, not just navigation
- [ ] It runs inside `npm run gate` and passes in CI
- [ ] It finishes in under 90 seconds on CI

## Notes
Depends on D8, D14, D15, D16, D17, D18, D20, D22. Files: `tests/smoke/demo-path.spec.ts`.

### D24 — feat: demo safety

- **Labels:** `feat` `P1` `area:shell`
- **Milestone:** M1 · **Beat:** all · **Blocked by:** none

**Size:** S

## What
`npm run demo:reset` clears run logs and restores cached manifests; a
hidden settings popover (`Shift+?`) to force any service to fixtures for
the session; toasts for every fallback (DESIGN.md "States").

## Why
The demo must survive a dead network or key mid-pitch.

## Acceptance
- [ ] Forcing CoStar to fixtures in the popover switches the mode chip and the next request uses the fake
- [ ] `npm run demo:reset` restores a clean state (the debrief shows its empty state)
- [ ] Every adapter fallback produces one toast naming the service

## Notes
Depends on D2, D4, D5, D7. Files: `src/components/shell/demo-settings.tsx`, `scripts/demo-reset.mjs`.

---

## M2 Wow (live where keys exist)

### D25 — feat: live CoStar

- **Labels:** `feat` `P1` `area:adapter-costar`
- **Milestone:** M2 · **Beat:** 1, 3 · **Blocked by:** Q1

**Size:** M

## What
Implement `live.ts` against the event toolkit (OpenAPI or MCP, per Q1's
answer): list buildings with all three layers in each city, fetch the
fields `Building` needs, map them in one file, never request tenant fields.
Add the live buildings to the map next to the fixtures, and run the builder
for at least one live building.

## Why
"The data is required"; CoStar's 30% data use.

## Acceptance
- [ ] With a key, the map shows live buildings marked `source: "costar"`
- [ ] The field mapping lives in one file with a unit test on a recorded response (recorded response committed only if CoStar allows; otherwise a hand-written one of the same shape)
- [ ] No tenant field is requested (test on the request)
- [ ] Without a key, nothing changes from fake mode

## Notes
Depends on D4, D11. Blocked by Q1.

### D26 — feat: live Matterport in the browser

- **Labels:** `feat` `P1` `area:adapter-matterport` `area:run`
- **Milestone:** M2 · **Beat:** 5 · **Blocked by:** Q2

**Size:** M

## What
Start with a 15-minute check that the event key reaches the Houston and LA
scans. Then `live.ts`: load the Showcase SDK, build the `FloorGraph` from
`Sweep.data` (neighbours as edges) and `Room.data` (sweeps assigned to rooms
by bounds), infer doors where an edge crosses rooms, sightlines as
same-room line of sight, and stairs from sweeps with neighbours on other
floors. In memory only. Add an "Inside view" panel on Run that `moveTo`s the
player's sweep.

## Why
The board is the real building's scan (spatial understanding).

## Acceptance
- [ ] With a key and a scanned building, Run plays on a graph built from that scan
- [ ] Nothing derived from the scan is sent to the server, written to storage, or put in a model prompt (tests on the request bodies and storage)
- [ ] The Inside view follows the player's hops
- [ ] Unlabelled rooms get game-fiction labels by size
- [ ] Without a key, F1's fixture floor is used and the mode chip says so

## Notes
Depends on D6, D13, D17. Blocked by Q2 (key scope; the terms stance in SPEC §4.5 holds until a written yes).

### D27 — feat: live Vexcel

- **Labels:** `feat` `P2` `area:adapter-vexcel` `area:scout`
- **Milestone:** M2 · **Beat:** 2 · **Blocked by:** Q3

**Size:** S

## What
`live.ts`: fetch the four obliques and the ortho for a building through a
server proxy route (imagery is never stored), and the entry tags (Custom
Elements if entitled, else the fixture tags placed by hand on the live
images). The Scout screen cross-fades the images.

## Why
The real roof, lot and dock in beat 2.

## Acceptance
- [ ] With a key, Scout shows five real views for a live building
- [ ] No image is written to disk or committed
- [ ] Without a key, the massing render shows

## Notes
Depends on D5, D14. Blocked by Q3.

### D28 — feat: live crew and Chief on Anthropic

- **Labels:** `feat` `P1` `area:adapter-llm` `area:agent-chief` `area:agent-crew`
- **Milestone:** M2 · **Beat:** 4, 5 · **Blocked by:** Q4

**Size:** S

## What
Verify the model id defaults in SPEC §7, run the crew and the Chief live on
F1, tune prompts so replies are in the radio voice and within schema, and
measure latency over ten calls each. Record the numbers in the PR.

## Why
The wow beat for real.

## Acceptance
- [ ] Ten live Chief calls: median under 3 s, p90 under 4 s; ten crew calls the same (numbers in the PR body)
- [ ] All twenty replies validate against their schemas
- [ ] Killing the network mid-run falls back to recorded replies with the chip, and the run continues
- [ ] The key is read only from the environment and never logged

## Notes
Depends on D16, D18. Blocked by Q4. Live calls only from a worktree with `.env.local`; keep to the calls the check needs.

### D29 — feat: live Level Builder run

- **Labels:** `feat` `P2` `area:agent-builder`
- **Milestone:** M2 · **Beat:** 3 · **Blocked by:** Q4

**Size:** S

## What
Run `npm run build:levels -- F1` on Anthropic, compare the live manifest
with the scripted one, and add `npm run record:builds` that saves a live
run as the `ScriptedChatModel` script so fakes match real behaviour.

## Why
Proves the deepagents agent works on a real model (LangChain prize).

## Acceptance
- [ ] A live run writes a valid manifest; its trace has todos and both subagents
- [ ] `record:builds` writes a script that replays to the same manifest in fake mode (test)
- [ ] Tool-call failures, if any, are listed in the PR with the model used

## Notes
Depends on D11. Blocked by Q4.

---

## M3 Prizes

### D30 — feat: the agent trace and live rebuild

- **Labels:** `feat` `P1` `area:dossier` `area:agent-builder`
- **Milestone:** M3 · **Beat:** 3 · **Blocked by:** none

**Size:** M

## What
`POST /api/levels/[id]/build` runs the Level Builder and streams its events
over SSE; the Dossier gains "Rebuild live", which streams the real todos,
subagent tasks and tool calls into the `TraceList` (on fakes, the scripted
model runs for real at its own pace). Each trace row expands to show the
tool's input and output.

## Why
Makes the deepagents planning and subagents visible (LangChain; CoStar agentic depth).

## Acceptance
- [ ] "Rebuild live" on F1 in fake mode streams events as the deep agent produces them and ends with a valid manifest
- [ ] Rows for `task` calls show which subagent ran; tool rows expand to input and output
- [ ] A failed rebuild keeps the cached level and says what failed

## Notes
Depends on D11, D15.

### D31 — feat: the Layer lens

- **Labels:** `feat` `P1` `area:run`
- **Milestone:** M3 · **Beat:** 5 · **Blocked by:** none

**Size:** S

## What
A toggle on the Run and Plan boards that tints every element by its source
layer (CoStar, Vexcel, Matterport), with a legend counting elements per
layer.

## Why
CoStar 30%: the combination of layers, visible at a glance.

## Acceptance
- [ ] With the lens on, every guard, camera, lock, zone and entry carries its layer tint; elements with two sources show both
- [ ] The legend counts match the placed elements (test on the counting function)
- [ ] The lens toggles with `L`

## Notes
Depends on D17, D19.

### D32 — feat: print the drill plan

- **Labels:** `feat` `P2` `area:drill`
- **Milestone:** M3 · **Beat:** 7 · **Blocked by:** none

**Size:** S

## What
A print stylesheet and `/b/[id]/drill/print` page: the building, the date,
the scenario, the floor diagram with stairs and warden posts, time to
clear, per-zone table, and a sign-off block for the fire safety director's
drill record.

## Why
Makes Drill Mode's output the thing a real person files on Monday.

## Acceptance
- [ ] "Print drill plan" opens the print page, which fits on one US Letter page in Chromium's print preview
- [ ] It includes the disclaimer and the headcount method

## Notes
Depends on D22.

### D33 — feat: the Chief adapts between runs

- **Labels:** `feat` `P2` `area:agent-chief`
- **Milestone:** M3 · **Beat:** 5 · **Blocked by:** none

**Size:** S

## What
A deterministic summary of the player's previous runs on the building
(entries used, zones where detected, average noise) from `localStorage`,
passed to the Chief, whose starting posture and rationale adapt ("They used
the dock twice. G3 starts there tonight."). The recorded fake has a variant
for a second run.

## Why
Amazon's "adapt" criterion.

## Acceptance
- [ ] On a second run of F1 entering through the dock, the Chief's first rationale mentions the dock and a guard starts nearer it
- [ ] Clearing history restores the default posture
- [ ] The summary contains no node coordinates (test)

## Notes
Depends on D18, D20.

---

## M4 Polish

### D34 — ui: rubric pass on Map, Scout and Dossier

- **Labels:** `ui` `P2` `area:map` `area:scout` `area:dossier`
- **Milestone:** M4 · **Beat:** 1–3 · **Blocked by:** none

**Size:** S

## What
Capture each screen at 1440×900, 1280×720 and 390×844, review against the
`ui-craft` rubric and DESIGN.md, fix every Medium, and attach before and
after screenshots to the PR.

## Why
Beats 1–3 are a judge's first impression.

## Acceptance
- [ ] No Medium rubric finding remains on these screens at 1440×900
- [ ] Every state (loading, empty, error) is captured once
- [ ] Before and after screenshots are in the PR

## Notes
Depends on D8, D14, D15.

### D35 — ui: rubric pass on Plan and Run

- **Labels:** `ui` `P2` `area:plan` `area:run`
- **Milestone:** M4 · **Beat:** 4, 5 · **Blocked by:** none

**Size:** S

## What
As D34, for Plan and Run, including the wow beat exactly as DESIGN.md's
hero section specifies (banner, cone flash, streamed rationale, dashed
previews).

## Why
The wow beat has to read from across a room.

## Acceptance
- [ ] No Medium rubric finding remains at 1440×900
- [ ] The Alert moment matches DESIGN.md's four steps, checked frame by frame in a Playwright video
- [ ] Before and after screenshots are in the PR

## Notes
Depends on D16, D17, D18, D19.

### D36 — ui: rubric pass on Debrief and Drill

- **Labels:** `ui` `P2` `area:debrief` `area:drill`
- **Milestone:** M4 · **Beat:** 6, 7 · **Blocked by:** none

**Size:** S

## What
As D34, for Debrief and Drill.

## Why
The last 35 seconds of the demo.

## Acceptance
- [ ] No Medium rubric finding remains at 1440×900
- [ ] Before and after screenshots are in the PR

## Notes
Depends on D20, D22.

### D37 — feat: LA fixture buildings F2 and F3

- **Labels:** `feat` `P2` `area:fixtures`
- **Milestone:** M4 · **Beat:** 1 · **Blocked by:** none

**Size:** M

## What
Floors, aerials, builder scripts and cached levels for F2 (1989, card and
coax era, `sunset-1986`) and F3 (2017, smart era, `night-desk`, labelled
fictional), so a judge can pick any LA pin.

## Why
Lets the judge's pick be real, and shows different eras produce different levels.

## Acceptance
- [ ] F2 and F3 play end to end on fakes, and their dossiers show their own eras and guard counts
- [ ] `scripts/check-floor.mjs` passes on both floors
- [ ] Each mission's "Inspired by" line is correct or says fictional

## Notes
Depends on D6, D11, D13.

### D38 — feat: Houston fixture buildings F4 and F5

- **Labels:** `feat` `P3` `area:fixtures`
- **Milestone:** M4 · **Beat:** 1 · **Blocked by:** none

**Size:** M

## What
As D37 for F4 (1983, `paper-trail-2001`, a prevent mission: secure the
audit boxes before the shredding truck at the dock) and F5 (2008, class B,
3 guards, `syntactic-2019`, a prevent mission). Prevent missions need the
engine's win condition to accept "objective secured" as well as "taken"; add
it if D9 did not.

## Why
Both cities, both mission types.

## Acceptance
- [ ] F4 and F5 play end to end on fakes with prevent-type wins
- [ ] The Houston tab shows both with three layer dots each

## Notes
Depends on D37.

---

## M5 Submission

### D39 — docs: the README

- **Labels:** `docs` `P1` `area:docs`
- **Milestone:** M5 · **Beat:** none (submission) · **Blocked by:** none

**Size:** S

## What
Replace `README.md` per `SUBMIT.md`: one-liner, hero screenshot, the problem
through the story, users and use case (the player, the fire safety director),
how it works with a Mermaid diagram, **sponsor technology and where in the
code** (CoStar, Vexcel, Matterport adapters; `deepagents` in
`src/agents/builder/`), how to run it keyless (`npm ci && npm run dev`, fake
by default), the stack, and what is next.

## Why
Prize judges open the repo; Amazon requires basic documentation.

## Acceptance
- [ ] A clean clone following only the README runs the app in fake mode
- [ ] The sponsor section links to the exact files for each sponsor technology
- [ ] The Mermaid diagram renders on GitHub

## Notes
Depends on D23.

### D40 — docs: Devpost write-up and prize evidence

- **Labels:** `docs` `P1` `area:docs`
- **Milestone:** M5 · **Beat:** none (submission) · **Blocked by:** none

**Size:** S

## What
`hackathon/submission/devpost.md` (Devpost's sections, built-with tags, one
line per targeted prize, AI-use disclosure) and
`hackathon/submission/prizes.md` (each prize's requirement, the evidence as
a file or screen, and its status), from SPEC §3.

## Why
Every targeted prize needs its requirement shown to be met.

## Acceptance
- [ ] Every row of SPEC §3 appears in `prizes.md` with evidence and a status
- [ ] `devpost.md` has all seven Devpost sections

## Notes
Depends on D39.

### D41 — docs: demo script, video plan and gallery

- **Labels:** `docs` `P1` `area:docs`
- **Milestone:** M5 · **Beat:** 1–7 · **Blocked by:** Q3, Q5 (for the video only)

**Size:** S

## What
`hackathon/submission/DEMO.md` (final script with timings and talk track, the
fallback per beat, `npm run demo:reset`, the pre-demo checklist),
`video.md` (shot list and narration within 2 minutes, which mode to record
given Q3 and Q5), and 16:9 screenshots of the seven screens in
`hackathon/submission/media/` from the final build in fake mode.

## Why
The 2-minute live demo and the optional video.

## Acceptance
- [ ] `DEMO.md`'s beats and timings match SPEC §2 and total at most 2:00
- [ ] Seven gallery screenshots at 1920×1080 exist and show no live imagery unless Q3 allows it
- [ ] `video.md` states whether live CoStar data and Vexcel imagery may be shown, citing the answer

## Notes
Depends on D23, D34, D35, D36. DEMO.md and the gallery proceed now; only `video.md`'s mode choice waits on Q3 and Q5.

### D42 — chore: submission hygiene

- **Labels:** `chore` `P1` `area:gate` `area:docs`
- **Milestone:** M5 · **Beat:** none (submission) · **Blocked by:** none

**Size:** S

## What
Add an MIT `LICENSE`, check `.env.example` against every `process.env` read
in `src/`, and run `gitleaks` over the full history if available (otherwise
say in the PR that no scan ran).

## Why
SUBMIT.md's hygiene items.

## Acceptance
- [ ] `LICENSE` exists
- [ ] A test fails if `src/` reads an env variable missing from `.env.example`
- [ ] The PR states the secret scan's result or that none ran

## Notes
Depends on D1.
