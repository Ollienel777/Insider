# Build spec: Heist Anywhere

The source is `hackathon/DECISION.md` (Heist Anywhere, v3). Where this spec and
the builder's notes at the top of that file disagree, the notes win. The
builder's standing instruction is to **build as much as possible with no API
keys**. So everything below runs keyless on fixture-backed fakes, and live
mode is something extra that switches on per service once a key exists.

Clock (from `hackathon/EVENT.md`, converted with `harness utc`):

| moment | local | UTC |
|---|---|---|
| hacking started | 2026-11-13 02:55 America/New_York | 2026-11-13T07:55Z |
| feature freeze | 2026-11-15 01:48 America/New_York | 2026-11-15T06:48Z |
| submission deadline (estimate) | 2026-11-15 09:00 America/New_York | 2026-11-15T14:00Z |

---

## 1. The product

**One-liner.** A turn-based stealth game in which an AI agent casts a real
Houston or LA building for each heist from history, then builds the level from
it. You pick the mission; the agent searches CoStar's market data for a
stand-in of the right era and class with a floor empty tonight, a Matterport
scan and a way in on Vexcel's aerial, and shows you three finalists. From the
building you choose, CoStar's record sets the security era, the guard force
and the quiet and crowded zones, Vexcel's aerials set the ways in and out, and
Matterport's scan points are the board. Click any guard, camera or locked door
to see which data put it there.

**Users.**
- **The player** (the Entertainment track's user): someone who wants a
  story-driven heist level set in a real building, played in a browser
  tab in ten minutes.
- **The location scout** (CoStar's "switched on Monday" user): film, TV and
  event location managers, an everyday trade in LA, search for real spaces of
  a given era, class and size that are empty and available. The casting
  search is that search, run on CoStar's own inventory and availability, with
  the interior scan and the aerial attached to every candidate. For the
  owner, a vacant floor that hosts a shoot earns money while it waits for a
  tenant.
- **The building's security lead** (Owner Mode, §13; proposed, Q9): a
  property manager or corporate security lead who enters the security their
  own building really has, lets the AI crew try about 50 ways in, and reads
  the result as the first pass of a physical security review, which today
  takes a consultant's site visit.

**The story a judge hears.** "Pick a heist from history: the 1974 Summa
Corporation burglary. The agent casts the building. It searches CoStar's
3,339 Houston and LA buildings for one built before 1975, Class A or B, with a
floor on the market tonight, a 3D scan and a dock on the aerial, and shows you
three. You pick Halvorsen Tower. 1974 means key locks and analog cameras that
sweep. Class A means four guards. Floor 22 is mostly vacant, so it is dark and
quiet. The dock on the aerial is your way in. Brief your crew in plain
English, they push back. Trip a camera, and the AI security chief re-plans in
front of you, and you can read why. And the search that cast your heist is
the one a location scout runs on Monday."

**Drill Mode is on hold** (the builder, 2026-11-14). Its code stays and its
route works, but it is off the demo script and the cut list's "never cut"
line until the team decides whether it stays (Q8).

**Taste rules (binding).**
- No current tenants and no members of the public appear anywhere. The game
  never shows tenant names, even though CoStar holds them. The CoStar adapter
  reads only the commercial property and commercial listing datasets; it
  never opens location occupancy or company detail, which are tenants.
- Missions are drawn from documented, non-violent corporate history, or are
  fictional and say so. Each mission card carries an "Inspired by" line with
  the date and a source, plus "Staged in a real building cast for its era.
  Security shown is game fiction derived from building class and era, not
  this building's."
- Nothing claims to describe a real building's security. Guard posts, cameras
  and locks are always generated from the rules in §4.3, never from imagery.
  The one exception is Owner Mode (§13): a setup the owner enters by hand.
  It is shown only to them, never in the public game, and on stage it is a
  made-up setup on a fixture building that says so.

## 2. The demo script (2 minutes)

One presenter drives; a judge is invited to pick the mission, choose among
the agent's three finalists, and make the fatal move. The demo runs on `main`
in whichever mode the rehearsal proved: live where keys exist, fake elsewhere.
Fake mode is the fallback for every beat and must look like the real thing
(§7).

| # | time | beat | screen | behaviour | fallback |
|---|---|---|---|---|---|
| 1 | 0:00–0:10 | **The hook: pick a heist.** "Every heist in history needed a building. Our agent finds one that's empty tonight." | Missions (`/`) | Five mission cards, each with its title, its "Inspired by" line (event, date, source), its city and the era it needs. The judge picks one; the demo picks `romaine-1974`. | Missions are fixtures in every mode (§4.6). |
| 2 | 0:10–0:32 | **The agent casts the building.** CoStar's data decides where the heist happens. | Cast (`/m/[missionId]/cast`) | The Casting Director's run replays in about 8 s: its todos, then the funnel it narrows, each step a filter on CoStar's data with its count (3,339 Houston and LA buildings → in LA → built before 1975 → Class A or B office → a floor on the market tonight, from CoStar's listings → a Matterport scan → a dock or service entry on the aerial). Beside it the map's pins dim as each filter applies. Three finalist cards remain: name and address, year built, class, the vacant floor (suites and square feet), the three layer dots, a one-line reason, and an aerial thumbnail. The judge picks one; "Scout it" is the primary action. | Fake mode replays a recorded casting run over the fixture inventory (§7), whose first finalist for `romaine-1974` is F1. Live mode replays the shortlist cast ahead from the kit (§4.4); "Recast live" is off the demo path. |
| 3 | 0:32–0:42 | **Scout.** The aerial turns around the chosen building's roof, lot and dock. | Scout (`/b/[id]/scout?m=…`) | Four oblique views (N, E, S, W) plus the ortho cross-fade as the presenter drags or presses ← →. Tagged entries (dock, garage ramp, roof hatch, lobby) appear as labelled markers. "Plan the job" is the primary action. | Fake Vexcel: a massing render of the building's footprint and height with the same tags. |
| 4 | 0:42–0:57 | **The level is built from the data.** | Dossier (`/b/[id]/dossier?m=…`) | The Level Builder's run replays as a streamed checklist (its todos, subagent tasks and tool calls) in about 6 seconds, and the dossier fills in: CoStar facts, then the **Data → Level** table (first row, cast because: "built 1974, Class A, floor 22 on the market, dock on the aerial"; year built 1974 → "Analog era: key locks, sweeping CCTV"; Class A → "4 guards, tight rounds"; floor 22 mostly available (suites 2202–2210) → "staged on 22, quiet zones"; dock on aerial → "entry and exit"), then the Game Master's briefing for the chosen mission. | The run is a cached manifest plus its recorded trace, so this beat never waits on a model. "Rebuild live" is off the demo path. |
| 5 | 0:57–1:10 | **Brief the crew.** One plain-English order. | Plan (`/b/[id]/plan?m=…`) | The presenter types "Go in through the dock, wait for the 2 am round to pass, take the records room." The crew answers within 3 s with a numbered plan, drawn as a ghost path on the board, and **pushes back**: "Camera C2 covers the dock corridor every other turn. Wait one turn at the freight lift." | Fake LLM: keyword-routed recorded crew replies; timeout at 4 s falls back to them with a "recorded reply" chip. |
| 6 | 1:10–1:40 | **The run, and the wow beat.** | Run (`/b/[id]/run?m=…`) | The isometric board. The player hops node to node; guards move after. The judge is handed the mouse and steps into a camera cone. **WOW:** the alarm jumps to Alert, guards immediately start converging (deterministic), and the Security Chief's re-plan streams into the side panel: "Lost them by the freight lift. G3 holds the dock. G1 and G2 sweep east to west. Lock the records room." Guards visibly change routes to match. The presenter clicks a guard: the **Why card** opens ("Posted at the dock because the aerial shows the only truck-height door; the 4th guard comes from Class A"). | Fake Chief: recorded orders per alarm transition, then a deterministic template. Guards never wait for the model. |
| 7 | 1:40–2:00 | **Debrief, and the Monday answer.** | Debrief (`/b/[id]/debrief?m=…`) | Grade (time, noise, detections), a scrubbable replay of the player's path and every guard's path, and the Chief's decisions as a timeline with each rationale. The presenter closes: "The search that cast your heist is the one a location scout runs on Monday: a vacant 1970s floor with a dock, from CoStar's own availability." | Pure client state; no service involved. |

**Every beat runs on fakes in CI**: the smoke test (§6) walks beats 1 to 7.

## 3. Prize requirements

| prize | requirement (quoted) | source | how it is met, visibly | tickets |
|---|---|---|---|---|
| Entertainment (main track) | "Creatively and uniquely incorporate entertainment and media. Examples: story-telling apps, interactive projects…" | `tracks/prizes.md` | A playable heist loop: a historical mission picked first, a real building cast for it, a Game Master briefing, the run and the debrief (beats 1, 2 and 4 to 7) | C4, D11, D15, D17, D20 |
| Main judging | creativity, utility, charity, avidity, unweighted | `EVENT.md` | Utility: casting is a working location search (beat 2). Charity: the `prevent` missions put the player on the side of exposing wrongdoing; Drill Mode's occupant-safety answer is on hold (Q8). Avidity: polish (M4) and the write-up (M5) | C3, C4, D34–D36, D40 |
| CoStar | "uses at least two of the three layers and gets something out of the combination" | `tracks/prizes.md` | All three, twice. Casting needs all three to pick a building: CoStar's era, class and listings, a Matterport scan, a Vexcel entry (beat 2). Then CoStar sets era, guards and zones; Vexcel sets entries; Matterport sets the board. The Why card and the Layer lens show which layer produced each element | C2, C3, D12, D19, D31 |
| CoStar | "agentic: reasons, plans and takes action; not a chat wrapper over a property record" | same | The Casting Director searching, narrowing and shortlisting CoStar's inventory with its reasons (beat 2); the Level Builder's visible plan and subagent trace (beat 4); the Chief re-planning live (beat 6); the crew pushing back (beat 5) | C3, D11, D15, D16, D18, D30 |
| CoStar | "solves a real problem for a real person"; 25% "would someone want this switched on Monday?" | same | Casting is a location scout's search: real, empty spaces of a given era, class and size, from CoStar's own availability, each with its scan and aerial (beats 2 and 7) | C2, C3, C4 |
| CoStar | "spatial and visual understanding, not only text" | same | The cast map narrowing to three pins, the aerial scout, the isometric board with cones and sightlines | C4, D14, D17 |
| CoStar | "The data is required" (real data) | same | Casting and the levels read CoStar's data kit live; live Vexcel and Matterport adapters; each has a fake | C2, D25, D26, D27 |
| LangChain | "Build a deepagent (LangChain's `deepagents` library) for any use case." | `tracks/prizes.md` | Two `deepagents` agents (`createDeepAgent`), each with planning (todos), subagents and its own tools: the Casting Director and the Level Builder. Both traces are shown in the product, and the README points to the code | C3, D11, D30, D29, D39 |
| CoStar | 25% usefulness and 30% agentic depth (second answer; proposed, Q9) | same | Owner Mode (§13): the owner's own setup, about 50 AI crew attempts, a batch debrief naming the weakest door or camera, and a before-and-after rerun | O1–O5 |
| Amazon | "applications that reason, plan, take action and adapt" | `tracks/prizes.md` | The Chief adapts between runs: it reads a summary of the player's previous runs and changes its posture, saying so in its rationale | D33 |
| Amazon | "Must include: a working prototype or demo, a clear use case and target user, basic documentation, a presentation or pitch" | same | The app; the README's user and use-case section; `DEMO.md`; `devpost.md` | D39, D40, D41 |

## 4. Architecture

One Next.js app (App Router, TypeScript). The game engine runs in the browser.
Server route handlers hold the keys, read CoStar's data kit and talk to
Vexcel and the model. Matterport runs only in the browser (terms, §4.5).

```
browser                                     server (route handlers)
───────                                     ───────────────────────
Missions ─ Cast ─ Scout ─ Dossier ─ Plan ─ Run ─ Debrief   (Drill: on hold, Q8)
   │        │       │       │       │      │        /api/missions            → mission library (fixtures)
   │        │       │       │       │      │        /api/cast/[missionId]    → cached shortlist (+trace)
   │        │       │       │       │      │        /api/cast/[missionId]/run → CastingDirector (deepagents), SSE
   │        │       │       │       │      │        /api/buildings           → CoStarAdapter
   │        │       │       │       │      │        /api/buildings/[id]/aerial → VexcelAdapter
   │        │       │       │       │      │        /api/levels/[id]?m=…     → cached manifest (+trace)
   │        │       │       │       │      │        /api/levels/[id]/build?m=… → LevelBuilder (deepagents), SSE
   │        │       │       │       │      │        /api/crew                → Crew (one structured call)
   │        │       │       │       │      │        /api/chief               → Chief (one structured call)
   │        │       │       │       │      └─ engine (pure TS): turns, guards, detection, alarm, replay
   │        │       │       │       └─ placer: manifest roles → nodes on the FloorGraph
   │        │       │       └─ MatterportAdapter (browser): FloorGraph from Showcase SDK, or fixture
   │        └─ the map, reused: pins dim as the casting funnel narrows
   └─ all LLM calls go through LlmAdapter: fake | anthropic | bedrock (off)
```

The chosen mission rides through the building routes as `?m=<missionId>`,
and a level manifest is keyed by building and mission together.

### 4.1 Data model (`src/domain/`, zod schemas, the single source of types)

- **Building**: `id`, `name`, `city` (`LA` | `Houston`), `neighbourhood`,
  `lat`, `lng`, `yearBuilt`, `buildingClass` (`A` | `B` | `C`), `stories`,
  `rbaSf`, `typicalFloorSf`, `propertyType`, `availableSpace: {floor, suite, sf}[]`
  (live: from the commercial listing dataset, space for lease),
  `layers: {costar, vexcel, matterport: boolean}`, `matterportModelIds: string[]`
  (live: from the kit's `commercial-properties.csv`),
  `source: "costar" | "fixture"`. No tenant fields exist in the type.
- **Mission** (`fixtures/missions.json`): `id`, `city`, `type`, `title`,
  `inspiredBy`, `objective`, `exitCondition`, and **`casting`**: what the
  stand-in must have, as filters the inventory search applies in order
  (`yearBuilt: {min?, max?}`, `buildingClass: ("A"|"B"|"C")[]`,
  `propertyTypes`, `minVacantFloorSf`, `needsScan`, `needsEntry: ("dock"|"service"|"garage")[]`),
  each with a plain-English label for the funnel.
- **CastingResult** (cached, server side, per mission): `missionId`,
  `funnel: {label, count}[]` (one row per filter, starting with the whole
  inventory), `finalists: Candidate[]` (exactly three), `trace`, `source`. A
  **Candidate** is a `Building` summary plus `vacantFloor: {floor, sf, suites}`,
  `fit: {criterion, value}[]` and a one-line `reason` the agent wrote.
- **Aerial**: `views: {dir: "N"|"E"|"S"|"W"|"ortho", url, width, height}[]`,
  `entries: {id, kind: "dock"|"garage"|"lobby"|"roof"|"service", label, view, x, y, note}[]`,
  `footprint: [lng, lat][]`, `heightM`, `source`.
- **FloorGraph** (held in browser memory only in live mode): `nodes: {id, x, y, roomId, tags: ("stair"|"lift"|"entry")[]}[]`,
  `edges: {a, b, door?: {id, lockable}}[]`, `rooms: {id, label, rect}[]`,
  `sightlines: Record<nodeId, nodeId[]>`, `source`.
- **LevelManifest** (cached, server side, keyed by building and mission): `buildingId`, `missionId`, `securityProfile`
  (era, guard count, patrol tempo, camera kind, lock kind), `zones: {role: "quiet"|"crowded"|"secure"|"objective"|"entry", rule, provenance}[]`,
  `entries` (chosen from Vexcel tags), `mission` (title, type `heist` |
  `prevent`, inspiredBy {event, date, sourceUrl}, briefing, objective,
  exitCondition), and **`provenance: {elementRole, layer, field, value, rule}[]`**,
  which is what every Why card reads. It holds CoStar- and Vexcel-derived
  values and fiction only, never Matterport data.
- **RunLog**: every turn's player action, guard positions, alarm state, Chief
  orders and rationale. It feeds Debrief, and the summary the Chief adapts
  from (D33). Kept in `localStorage`.

### 4.2 The hard part: a level that is visibly made of the data, and a live re-plan that never stalls

Two things decide the demo, and both live in deterministic code with the
model on top:

1. **The rules table** (`src/level/rules.ts`, D12). It maps fields to level
   parameters deterministically, and each output carries a provenance entry.
   The deep agent calls it as a tool instead of inventing difficulty, so the
   numbers are stable and explainable, and the agent's job is choosing,
   justifying and writing.
2. **The turn engine** (`src/engine/`, D9, D10). The engine is authoritative.
   Model output (crew plans, Chief orders) is parsed against a schema and
   clamped to legal moves; anything unknown is dropped. Guards are not
   chatbots, so there is nothing to talk past, which answers "can I tell the
   guard I'm the janitor?" (DECISION risk 3).

### 4.3 The rules table (initial values; D12 owns them)

| input (layer, field) | rule | output |
|---|---|---|
| CoStar `yearBuilt` < 1980 | Analog era | key locks (pickable, 2 turns), analog CCTV that sweeps (covers alternate halves each turn), guard rounds on a fixed loop |
| 1980–1999 | Card and coax | magstripe readers (needs a cloned card, found in the level), PTZ cameras on a 3-turn cycle |
| 2000–2014 | Networked | prox badge readers, fixed IP cameras, motion sensors in secure zones |
| ≥ 2015 | Smart | badge plus PIN, IP cameras with analytics (a sighting raises the alarm one extra step), door-held alarms |
| CoStar `buildingClass` A / B / C | guard force | 4 / 3 / 2 guards; patrol tempo 1 / 1 / 2 turns per hop |
| CoStar `availableSpace` on the staged floor | vacancy | available suites become **quiet zones**: dark, unpatrolled, sound carries 1 node further. Occupied suites become **crowded zones**: night cleaners who raise Suspicious if they see the player |
| CoStar `stories` and `availableSpace` across floors | staging floor | the floor with the most available area is staged (the quietest night) and named in the briefing |
| Vexcel entries | routes in and out | each tag becomes an entry node candidate; the dock and the roof are always offered; the lobby carries a desk guard |
| Matterport sweeps and rooms | the board | nodes, edges and rooms; doors where an edge crosses rooms; sightlines from same-room line of sight |

### 4.4 Agents

| agent | how it runs | model calls on the demo path | output |
|---|---|---|---|
| **Casting Director** | `deepagents` (`createDeepAgent`) with todos, the subagent `location-scout` (runs the inventory search and checks candidates), and tools `get_mission`, `search_inventory` (applies one more of the mission's casting filters and returns the count left and the top candidates), `get_candidate` (CoStar facts, the vacant floors from listings, scan count, layer flags), `get_aerial_entries` (Vexcel entries for a candidate), `write_shortlist`. The search itself is deterministic code over the CoStar adapter; the agent chooses the order, judges ties, and writes each finalist's reason | **none**: it runs ahead, per mission, and its shortlist and trace are cached (fake: `data/casting/<missionId>.json` from the fixture inventory; live: in `HEIST_STATE_DIR`, never in the repo) | `CastingResult` and a trace |
| **Level Builder** | `deepagents` (`createDeepAgent`) with todos, the subagents `data-analyst` (reads CoStar and Vexcel through tools, calls `derive_security_profile`) and `game-master` (writes the briefing for the chosen mission, staged in this building), and tools `get_building`, `get_available_space`, `get_aerial_entries`, `derive_security_profile`, `get_mission`, `write_manifest` | **none**: it runs ahead, per building and mission, and its manifest and trace are cached in `data/levels/` (live builds of real buildings go to `HEIST_STATE_DIR`, never in the repo) | `LevelManifest` and a trace (todos, subagent tasks, tool calls, timings) |
| **Crew** | one structured call (`withStructuredOutput`, zod) | one per order, at most 3 s, timeout 4 s | `{steps: {zoneId, action}[], pushback, confidence}`. A deterministic validator (D16) checks the steps against the board and adds the concrete warning (camera, turn) |
| **Security Chief** | one structured call | one per alarm-state change, at most 4 s; guards move deterministically meanwhile | `{orders: {guardId, intent: hold|sweep|converge|block, zoneId}[], lockZones, rationale ≤ 280 chars}` |
| **Drill narrator** | one structured call | one per drill | scenario paragraph and three recommendations |

**`deepagents` in a keyless TypeScript stack (decision).** The Level Builder
uses the JS package `deepagents` (npm; `createDeepAgent`, the port of the
Python library) inside the Next.js server, so there is one deployable and one
gate. Keyless, it runs on **`ScriptedChatModel`** (`src/adapters/llm/scripted.ts`),
a LangChain `BaseChatModel` that supports `bindTools` and replays a recorded
script of assistant messages, tool calls included, per building. The deep
agent's graph, its todos, its subagent dispatch and **its tools all run for
real** against the fake adapters: CI exercises the actual agent, not a
stub. Live, the same code runs on `ChatAnthropic`. The JS port's parity with
Python is unverified (`ideation/research/sponsor-langchain.md`), so D11 opens
with a 30-minute check; if `createDeepAgent` in JS lacks todos or subagents, D11
records it on the ticket and the fallback is a Python `deepagents` sidecar
(FastAPI, one route), the alternative passed over here because it means two
runtimes, two installs and twice the gate memory on a 3.7 GB VM.

### 4.5 External services: every one behind an adapter with a fake

| service | adapter | live implementation | fake (fixtures in `fixtures/`) |
|---|---|---|---|
| Model | `src/adapters/llm/` | Anthropic API via `@langchain/anthropic` (primary). Bedrock via `@langchain/aws` `ChatBedrockConverse`, present but refused unless `BEDROCK_ENABLED=1` | `ScriptedChatModel` for the builder; keyword-routed recorded replies for the crew; per-transition recorded orders and a deterministic template for the Chief; recorded drill narratives |
| CoStar | `src/adapters/costar/` | **CoStar's data kit**, read from `COSTAR_KIT_DIR` at runtime: eight datasets exported from CoStar's data platform, documented in the kit's `index.md`, `models/` and `schemas/`. Only `data/commercial-property.jsonl` (buildings) and `data/commercial-listing-summary.jsonl` (space for lease or sale) are read, joined to Matterport models through `commercial-properties.csv`; field mapping in one file. The kit is licensed for the event only: **no kit record, and nothing derived from one, is ever committed** | five fixture buildings and the fixture inventory for casting, §7 |
| Vexcel | `src/adapters/vexcel/` | `https://api.vexcelgroup.com/v2` with the `X-API-KEY` header: `property/extract` for the parcel, `ortho/extract` and the oblique directions `oriented/collections` reports, and `elements/detect` to tag docks and doors; imagery proxied, never stored in the repo | a massing render per building (footprint polygon plus height, drawn in Three.js) with hand-placed entry tags |
| Matterport | `src/adapters/matterport/` (browser only) | Showcase SDK: `Sweep.data` and `Room.data` → `FloorGraph`, in memory; an "Inside view" panel follows the player's sweep. The SDK key works on `localhost` only. The GraphQL API (`MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN`, server side) also exposes rooms, room types, panoramas, floor plans and meshes; it stays unused until Q2 is answered | a hand-authored floor per building (`fixtures/floors/F*.json`), authored as fiction, so no Matterport content is involved |

**Matterport terms (DECISION risk 2).** Until the sponsor says yes in writing,
in live mode: the `FloorGraph` is built in the browser on each load and never
sent to the server, persisted, or sent to a model. The Crew and the Chief
receive zone ids and the game-fiction names the manifest gave them, the
guard roster and the alarm state, never node coordinates or adjacency. The
placer (D13) maps manifest roles onto nodes in the browser. The cached
manifest holds no Matterport data. A written yes would let the crew see
zone adjacency (Q2).

**Latency (DECISION risk 3).** No model call blocks a frame. The builder runs
ahead; crew and Chief calls are single structured calls with low `max_tokens`
(400) and a 4 s timeout that falls back to the fake with a visible chip.
Guards always move on the engine's own decision first.

### 4.6 Missions (`fixtures/missions.json`, D11, D37 and C1)

| id | city | type | title | inspired by | casting (what the stand-in needs) |
|---|---|---|---|---|---|
| `romaine-1974` | LA | heist | The Romaine Street Papers | Summa Corporation burglary, 7000 Romaine St, June 5, 1974 (https://www.cia.gov/stories/story/the-exposing-of-project-azorian) | office, built 1974 or earlier, Class A or B, a floor with 10,000 SF or more on the market, a scan, a dock or service entry |
| `sunset-1986` | LA | heist | Hole in the Ground | First Interstate Bank tunnel burglary, Sunset Blvd, 1986 (https://lareviewofbooks.org/short-takes/l-four-locations-bank-robbery-capital-world) | office or retail, built in the 1980s, a floor with 10,000 SF or more on the market, a scan, a garage or service entry |
| `night-desk` | LA | prevent | The Night Desk | fictional, labelled as such | office, built 2015 or later, Class A, a floor on the market, a scan, a dock |
| `paper-trail-2001` | Houston | prevent | Paper Trail | the Andersen document shredding, Oct 23 – Nov 9, 2001 (https://en.wikipedia.org/wiki/1400_Smith_Street) | office, built 2001 or earlier, Class A, a floor with 10,000 SF or more on the market, a scan, a dock |
| `syntactic-2019` | Houston | prevent | Syntactic | the Trelleborg syntactic-foam trade-secret case, 2019 (https://worldoil.com/news/2019/7/30/prolific-chinese-theft-ring-targeted-deepwater-drilling-technologies/) | industrial or flex, built 2019 or earlier, any class, space on the market, a scan, a dock |

The casting column is a starting point for C1; tune the thresholds so each
mission's live funnel ends with at least three finalists, and record the
counts on the ticket.

Off-limits: any event with violence or victims (the North Hollywood shootout,
the Norco robbery, the Dunbar Armored robbery).

## 5. Stack, conventions and areas

- **Stack:** Node 22, TypeScript (strict), Next.js (App Router), Tailwind with
  CSS-variable tokens, shadcn/ui, `lucide-react`, `motion`; Three.js through
  `@react-three/fiber` and `@react-three/drei` for the board, the massing
  render and the drill view; MapLibre GL is **not** used: the map is a static
  basemap image with projected pins (no tile server to fail). zod for every
  schema. Vitest for unit tests, Playwright for the smoke. `deepagents`,
  `langchain`, `@langchain/core`, `@langchain/anthropic`, `@langchain/aws`.
  No database: manifests are JSON files in `data/levels/`, run logs in
  `localStorage`.
- **Layout:** `src/app/` routes; `src/domain/` schemas; `src/adapters/<service>/{index,live,fake}.ts`;
  `src/level/` rules and placer; `src/engine/`; `src/agents/` (casting, builder,
  crew, chief, drill); `src/components/<area>/`; `fixtures/`; `data/casting/`; `data/levels/`;
  `scripts/`; `tests/` (unit beside code as `*.test.ts`; smoke in `tests/smoke/`).
- **Conventions:** pure engine code takes a seed and never reads the clock or
  `Math.random`; every adapter's `index.ts` picks live or fake from the
  environment and exports one interface; UI uses tokens only (DESIGN.md);
  no `any` in `src/domain/`; every screen designs its empty, loading and error
  states.
- **Repo hygiene:** `.gitattributes` forces LF for `*.sh` and `*.mjs` and marks
  `fixtures/**/*.png`, `*.jpg` and `*.glb` binary. Each worktree runs its own
  `npm ci`; nothing is installed globally or shared.

**Areas** (one `area:` label per screen or module):

| label | covers |
|---|---|
| `area:gate` | `scripts/gate.mjs`, CI workflow, Playwright smoke, lint and tsconfig |
| `area:shell` | tokens, root layout, top bar, step rail, mode chip |
| `area:missions` | `/`, the mission picker |
| `area:cast` | `/m/[missionId]/cast`: the funnel, the finalist cards |
| `area:map` | the map component (pins, basemap), shown on the cast screen |
| `area:scout` | `/b/[id]/scout` |
| `area:dossier` | `/b/[id]/dossier`, build trace view |
| `area:plan` | `/b/[id]/plan`, crew UI |
| `area:run` | `/b/[id]/run` UI: board render, side panel, Why card |
| `area:debrief` | `/b/[id]/debrief` |
| `area:drill` | `/b/[id]/drill`, drill simulation, report |
| `area:engine` | `src/engine/` |
| `area:level` | `src/level/` rules and placer |
| `area:domain` | `src/domain/` schemas |
| `area:agent-casting` | `src/agents/casting/` |
| `area:agent-builder` | `src/agents/builder/` |
| `area:agent-crew` | `src/agents/crew/` |
| `area:agent-chief` | `src/agents/chief/` |
| `area:adapter-llm` | `src/adapters/llm/` |
| `area:adapter-costar` | `src/adapters/costar/` |
| `area:adapter-vexcel` | `src/adapters/vexcel/` |
| `area:adapter-matterport` | `src/adapters/matterport/` |
| `area:fixtures` | `fixtures/`, `data/levels/` |
| `area:docs` | `README.md`, `hackathon/submission/` |

## 6. The gate

**`npm run gate`** runs `node scripts/gate.mjs`, which uses only Node
built-ins (so it runs before install) and executes these steps in order,
stopping at the first failure with that step's name and exit code:

0. **Locate.** `top = realpath(git rev-parse --show-toplevel)`. The package
   the gate runs is `realpath(dirname(package.json next to scripts/))`; it must
   equal `top`. After install it also resolves the app's own engine entry
   (`src/engine/index.ts`) the way Vitest's `@/` alias does, and fails unless
   its realpath starts with `top + "/src/"` and contains none of
   `/node_modules/`, `/.next/`, `/dist/`, `/.claude/` other than inside `top`
   itself (a worktree's `top` is under `.claude/worktrees/`; the check is on the
   path relative to `top`). This catches a gate that tests the main checkout
   or an installed copy.
1. **Install.** `npm ci`, then `npx playwright install chromium` (CI adds
   `--with-deps`).
2. **Lint.** `npm run lint` (ESLint flat config).
3. **Typecheck.** `npm run typecheck` (`tsc --noEmit`).
4. **Test.** `npm run test` (`vitest run`).
5. **Build.** `npm run build` with `HEIST_MODE=fake` and
   `NODE_OPTIONS=--max-old-space-size=1536` (the VM has 3.7 GB, and two gates
   may run at once).
6. **Smoke.** `npm run smoke`: Playwright starts `next start` on
   `PORT` with `reuseExistingServer: false`, in fake mode (an explicit `PORT`
   wins; on GitHub Actions it is 3100; otherwise the gate picks a free port
   just before the smoke and logs it, so two local gates do not collide), and
   **asserts outcomes on the demo path**: the mission picker lists five
   missions; the cast screen for `romaine-1974` shows a funnel that starts at
   the fixture inventory's size and ends with three finalists, F1 first; the
   demo building's dossier shows "1974" and "Analog era" and four guards; the
   crew's reply contains a warning naming a camera; a scripted move sequence
   on the run screen raises the alarm to Alert and the Chief's rationale
   appears; debrief shows a grade. While Drill Mode stays in the code, its
   route keeps its own assertion (a time to clear) outside the walk. Each
   milestone ticket extends it; D1's version asserts the shell renders the
   product name and the fake-mode chip.

**Fake mode is forced**: the gate sets `HEIST_MODE=fake` and every
per-service mode to `fake`, whatever `.env.local` says.

**`.claude/**` is excluded from every glob**: ESLint `ignores`, `tsconfig.json`
`exclude`, Vitest `exclude`, Playwright `testIgnore`, Tailwind `content`
(it lists `src/**` only), and `next.config` output tracing excludes.

**CI** (`.github/workflows/gate.yml`): `on: pull_request` (no `paths` filter)
and `push: branches: [main]`. One job on `ubuntu-latest`, Node 22, runs
`npm run gate`. Concurrency:

```yaml
concurrency:
  group: gate-${{ github.event_name }}-${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

A superseded PR run is cancelled; a push to `main` never is.

## 7. Environment

Names only; `.env.example` lists every one with an empty value. Nothing is
required: with no `.env.local` the app runs fully in fake mode.

| variable | meaning | default |
|---|---|---|
| `HEIST_MODE` | `live` turns on live mode where keys exist; anything else is fake | `fake` |
| `LLM_MODE`, `COSTAR_MODE`, `VEXCEL_MODE`, `NEXT_PUBLIC_MATTERPORT_MODE` | per-service override, `fake` or `live` | `HEIST_MODE` |
| `LLM_PROVIDER` | `anthropic` or `bedrock` | `anthropic` |
| `ANTHROPIC_API_KEY` | Anthropic key | — |
| `ANTHROPIC_MODEL_FAST` | crew, Chief and drill | `claude-sonnet-4-6` (D28 confirms) |
| `ANTHROPIC_MODEL_BUILDER` | the Level Builder | `claude-sonnet-4-6` |
| `BEDROCK_ENABLED` | `1` allows Bedrock calls | unset |
| `AWS_REGION`, `BEDROCK_MODEL_ID` | Bedrock | `us-east-1`, `us.anthropic.claude-sonnet-4-6` |
| `LLM_TIMEOUT_MS` | crew and Chief timeout before the fake answers | `4000` |
| `COSTAR_KIT_DIR` | the unpacked CoStar data kit, outside the repo | — |
| `VEXCEL_API_BASE`, `VEXCEL_API_KEY` | Vexcel | `https://api.vexcelgroup.com/v2`, — |
| `NEXT_PUBLIC_MATTERPORT_SDK_KEY` | Showcase SDK key (bound to `localhost`, browser) | — |
| `MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN` | Matterport GraphQL API, server only; unused until Q2 | — |
| `HEIST_STATE_DIR` | where live casting results, live manifests and the demo epoch are written; never inside the repo's tracked files | `.heist/` |
| `PORT` | server port, also the smoke test's (a local gate picks a free one unless set) | `3100` |

**How fake mode works.** Each adapter's `index.ts` reads its mode once. In live
mode with a key missing, it uses the fake and the top bar's mode chip says
which service is on fixtures ("CoStar: fixtures"). The chip is always visible,
so a judge is never misled about which data is live.

**Fixtures look real** (judges see them). Five fixture buildings, each an
invented name at a plausible block in a real neighbourhood, with values
typical of its era and class, and `source: "fixture"` shown on screen:

| id | name | city, neighbourhood | built | class | stories | role |
|---|---|---|---|---|---|---|
| F1 | Halvorsen Tower | LA, Bunker Hill | 1974 | A | 42 | **demo building**, `romaine-1974` |
| F2 | Figueroa Exchange | LA, Financial District | 1989 | A | 52 | `sunset-1986` |
| F3 | Meridian on Wilshire | LA, Westlake | 2017 | A | 30 | `night-desk` |
| F4 | Smith Street Center | Houston, Downtown | 1983 | A | 50 | `paper-trail-2001` |
| F5 | Westchase Commons | Houston, Westchase | 2008 | B | 6 | `syntactic-2019` |

Each needs realistic `availableSpace` rows (suite numbers, square feet), a
floor of 24–32 nodes over 8–12 rooms with labels a floor really has (freight
lift lobby, records room, server closet, open office 2210…), and an aerial
with four to five tagged entries. Live keys replace them building by building.

**The fixture inventory** (`fixtures/inventory.json`, C1) is what the casting
search runs on in fake mode: about 60 invented properties across LA and
Houston, with plausible names, neighbourhoods, year built, class, property
type, stories, vacant floors and layer flags, so that every mission's funnel
narrows step by step to exactly three finalists that look like real
candidates. F1 to F5 are in it, and each is the first finalist of its own
mission. Only these five have floors and levels; the other two finalists of
each mission show their card and a "Level in prep" state if picked. The
funnel's first count is the inventory's own size in fake mode and the kit's
(3,339) live.

## 8. Milestones

| milestone | exit criterion | target |
|---|---|---|
| **M0 Skeleton** | the gate green in CI; tokens and the app shell; domain schemas; all four adapters with fakes; the map listing the fixture buildings; the smoke opening the map | hacking start + 5 h (2026-11-13T13:00Z) |
| **M1 Demo path** | beats 1 to 7 work end to end on fakes, and the smoke walks them | + 18 h (2026-11-14T02:00Z) |
| **M2 Wow** | the Chief re-plan and the crew run live on Anthropic within the latency budget; live CoStar, Vexcel and Matterport where keys and answers exist; every fallback still works | + 28 h (2026-11-14T12:00Z) |
| **M3 Prizes** | every row of §3 visibly met | + 36 h (2026-11-14T20:00Z) |
| **M4 Polish** | every demo screen passes the `ui-craft` rubric at 1440×900 | feature freeze (2026-11-15T06:48Z) |
| **M5 Submission** | `SUBMIT.md`'s materials | deadline − 1 h (2026-11-15T13:00Z) |

## 9. The cut list, in order (first cut first)

Cut before anything on this list: §14 (Live mode and the scan view), in its own order (§14, Cuts).

1. Owner Mode's Beat the crew and Defend modes (O6).
2. A linked campaign (stretch in DECISION.md).
3. Co-op Inside + Overwatch ("should" in DECISION.md; not ticketed until M3 is done).
4. Owner Mode as a whole (O1 to O5), if Q9 says no or it is not in by M3.
   Casting stays the Monday answer.
5. Live rebuild of a level, and live recasting, from the UI (the cached
   manifests, shortlists and traces stay).
6. Fixture buildings F2 to F5 and their missions (F1 alone carries the demo;
   the fixture inventory still casts every mission).
7. Live Vexcel (the massing render stays).
8. Drill plan print export (D32).
9. The Chief adapting between runs (D33); this drops the Amazon "adapt" line.
10. Live Matterport (the fixture floor stays the board).

Never cut: casting's funnel and finalists (CoStar's data use and the Monday
answer), the rules table and Why card (CoStar's 30%), the deepagents agents
(LangChain), the Chief re-plan (the wow).

## 10. Risks and spikes

| risk | answer |
|---|---|
| CoStar data reads as decoration (DECISION risk 1) | CoStar's data decides where each heist happens: casting filters its inventory and listings on screen (beat 2). Then the rules table makes each field change a visible thing on the board, the dossier's Data → Level table states the mapping, the Why card ties each guard, camera and lock back to its field, and the Layer lens tints every element by its layer |
| A real building cast for a heist reads as casing it | Casting picks a stage by era, class and vacancy, never by security; security is generated from the rules (§4.3); every mission card says "Staged in a real building cast for its era" and that security is game fiction |
| The kit leaks into the public repo | live casting results and live manifests go to `HEIST_STATE_DIR`, which is gitignored; fixtures are invented; C2's tests use the fixture inventory only |
| Matterport terms (risk 2) | §4.5: browser-only graph, no caching, no scan data to a model; fixture floors are hand-authored fiction |
| A 20 s agent loop on stage; LLM guards talked past (risk 3) | Builder cached ahead; one structured call per crew order and per alarm change, 4 s timeout with fake fallback; deterministic engine authoritative; no talking to guards |
| No usefulness answer (risk 4) | Casting is a location scout's search over CoStar's inventory and availability, with scans and aerials attached (§1). Drill Mode, the earlier answer, is on hold (Q8) |
| AI Game Master is a saturated archetype (risk 5) | The Game Master is one subagent writing a briefing; the product is the data-built level and the re-planning Chief. The pitch never leads with "AI story" |
| deepagents JS lacks parity | D11's first 30 minutes check it; fallback a Python sidecar (§4.4) |
| Event keys late or sandbox-only | everything works on fakes; live is per service |
| Vexcel imagery may not be shown publicly | imagery is proxied at runtime, never committed; fake massing render in the repo and video if needed (Q3) |
| Opus 4.6 weak at tool calls in LangChain's eval | the builder defaults to Sonnet 4.6; D29 measures |
| A 3.7 GB VM | one deployable, `--max-old-space-size=1536`, chromium only |

**Spikes:** D11's parity check (30 min); D29, a live deepagents run on
Anthropic once a key exists (30 min); D26's first step, whether the event's
Matterport key reaches the Houston and LA scans (15 min).

## 11. Open questions

Each blocks only the tickets named; everything else proceeds on fakes.

| # | question | who answers | blocks |
|---|---|---|---|
| Q1 | ~~Which CoStar fields does the toolkit expose, and how?~~ **Answered:** a data kit of eight datasets, not an API (§4.5) | — | — |
| Q2 | The keys reach 14,944 Houston and LA models. Is there a written yes for caching derived graphs, serving panoramas or meshes outside the Showcase viewer, and sending scan-derived data to an outside model? Without it, D26 ships under the §4.5 restrictions, and casting checks only that a scan exists, never what it contains | Matterport/CoStar on site, in writing | D26 |
| Q3 | What do the Vexcel keys include (obliques, ortho, entry detection), and may the imagery appear in a public repo and video? | Vexcel on site | D27; the video plan in D41 |
| Q4 | The Anthropic API key, in `.env.local` and the repo's Actions secrets | the builder | D28, D29 |
| Q5 | May CoStar records appear on screen in a public demo video? | CoStar | D41 |
| Q6 | The overnight defaults in DECISION.md (provider, latency approach, Matterport stance, prize targets, the 2-minute slot) stand unless the builder overrules them. Casting is the builder's choice (2026-11-14) | the builder | none unless overruled |
| Q7 | The real deadline (EVENT.md marks it as an estimate) | the builder, from the hacker guide | none; moves the freeze and M5 |
| Q8 | Does Drill Mode stay? It is on hold: off the demo script, its code kept, #34 and its PR held | the builder and the team | the held drill work |
| Q9 | Does Owner Mode (§13) join casting as a second Monday answer, and does its beat make the 2-minute slot? Until then it is built only as far as O1 to O3 (no demo-script or smoke changes). Also ask CoStar's table whether owners would use it and whether the framing sits well with them | the builder and the team; CoStar | O4, O6 |
| Q10 | May game elements (guards, cameras, rings) be drawn over the Showcase player, the player be shown under a CSS filter, and the scan appear in the demo video (§14)? | CoStar and Matterport on site | T5 to T7: the scan view in the demo and the video. T1 to T4 proceed |

## 12. The casting backlog (C1–C6)

Filed as issues once this section merges, in this order, with `loop-ok` and
milestone M1 unless noted. Dependencies use these ids until filed.

| id | title | area | size | acceptance |
|---|---|---|---|---|
| C1 | feat: missions carry casting needs, and the fixture inventory | `area:domain`, `area:fixtures` | M | `Mission.casting` and `CastingResult` in `src/domain/` (§4.1) with tests; `fixtures/missions.json` carries each mission's casting filters (§4.6); `fixtures/inventory.json` holds about 60 invented LA and Houston properties on which every mission's funnel ends with exactly three finalists, its own fixture building first (a test asserts this for all five) |
| C2 | feat: the inventory search, on the kit and the fixtures | `area:adapter-costar` | M | `searchInventory(filters)` on the CoStar adapter returns, per filter applied in order, the count left and the top candidates. Live, it reads only the two datasets §4.5 names from `COSTAR_KIT_DIR`, takes vacant floors from the listings and scan ids from `commercial-properties.csv`; fake, it reads `fixtures/inventory.json`. Tests run on the fixtures only; no kit record enters the repo. Depends on #27 for the live half |
| C3 | feat: the Casting Director on deepagents | `area:agent-casting` | M | A `createDeepAgent` agent with todos, the `location-scout` subagent and the tools §4.4 lists; keyless on `ScriptedChatModel` with a recorded script per mission; `npm run cast -- <missionId>` writes the shortlist and trace (fake: `data/casting/`; live: `HEIST_STATE_DIR`); `GET /api/cast/[missionId]` serves it; its finalists match C1's expected three in fake mode. Depends on C1, C2 |
| C4 | feat: the mission picker and the cast screen | `area:missions`, `area:cast`, `area:map` | M | `/` lists the five missions (beat 1); `/m/[missionId]/cast` replays the cast trace in about 8 s, shows the funnel with counts beside the map whose pins dim per filter, and three finalist cards with layer dots and reasons (beat 2); picking one opens its scout with `?m=`. Meets the `ui-craft` rubric at 1440×900. Depends on C3 |
| C5 | feat: levels take the chosen mission | `area:agent-builder`, `area:level` | S | The Level Builder takes the mission as input (`get_mission` replaces `list_missions`); manifests are keyed by building and mission; every `/b/[id]/…` route carries `?m=`; the dossier's Data → Level table opens with the cast-because row (beat 4). Depends on C1 |
| C6 | test(gate): the smoke walks casting | `area:gate` | S | The smoke walks beats 1 to 7 as §6 describes, starting from the mission picker; the drill keeps its own assertion outside the walk. Depends on C4, C5 |

After these merge, the demo script (#80) and the Devpost write-up (#86) follow
the new beats.

## 13. Owner Mode (proposed; Q9)

Epic #131. The same heist played against a building's real security instead
of generated security. It changes two things and nothing else: **who sets the
security** (the owner instead of the rules table) and **who plays** (the AI
crew, about 50 times, instead of the player). The missions, cast, scout,
board, crew, Chief, Why cards and replay are unchanged.

**Why beside casting.** Casting answers "would someone switch this on Monday?"
for a location scout. Owner Mode answers it for the person who owns the
building: a property manager or corporate security lead who today pays for a
physical security review and runs tabletop exercises by hand. It also gives
the agents a visible job at scale: the crew plans strategies, the engine
plays them, and the Chief proposes a fix and reruns it to check.

**The flow.**
1. **Setup.** On the Run board, **Use my building's security** opens an editor:
   guards and their rounds, cameras and their kind, doors as key, badge or
   open, staffed desks. Named setups are saved per building in `localStorage`
   (guarded). The floor graph and entries are unchanged, and the floor graph
   stays in the browser (§4.5).
2. **Autoplay.** One structured crew call returns about five strategies
   (entry, timing, route preference, risk), schema-checked and clamped to
   legal entries and zones. It receives zone ids only, never nodes, with a
   recorded fake and the crew's 4 s fallback. The pure, seeded engine plays
   each strategy over about ten seeds with a simple planner. No model call per
   move; 50 runs take under 3 s.
3. **Batch debrief.** Success count and a 50-cell strip, the most common
   successful route on the board, the element that failed most often, the
   Chief's suggested fix (one structured call, recorded fake, deterministic
   template), and any run's replay.
4. **Compare.** Two setups side by side: about 7/50 before moving one camera,
   about 1/50 after.

**Demo beat (only if Q9 says yes).** After the Debrief: "Same building. Now
the owner puts in what they really have." Run 50, move camera C2, run again.
About 15 s, on a fixture building with a setup that says it is made up. Making
room in the 2-minute slot is part of Q9.

**Guardrails.** The public game uses generated, fictional security only.
Owner setups stay with the owner and never reach the server, a model or the
repo. The real product would unlock per building for verified owners; the
hackathon has no accounts.

**Backlog.** Filed without `loop-ok`; the team builds O1 to O3 while the loop
works through casting.

| id | issue | title | area | size | acceptance |
|---|---|---|---|---|---|
| O0 | #124 | docs: add Owner Mode to the spec | `area:docs` | S | this section |
| O1 | #125 | feat: the owner's security editor | `area:run`, `area:level` | M | a setup round-trips (save, reload, play on it); the engine accepts it in place of the generated profile; tests for invalid placements |
| O2 | #126 | feat: the AI crew plays 50 attempts | `area:agent-crew`, `area:engine` | M | deterministic for a fixed seed set; illegal strategies dropped with a reason; 50 runs on F1 in under 3 s |
| O3 | #127 | feat: the batch debrief | `area:debrief`, `area:agent-chief` | M | renders from a recorded batch in fake mode; `ui-craft` rubric at 1440×900. Depends on O2 |
| O4 | #128 | feat: compare two setups, the usefulness beat | `area:debrief` | S | the smoke walks the beat in fake mode with the same result every run. Depends on O1, O3, Q9 |
| O5 | #130 | docs: Owner Mode in the README and Devpost write-up | `area:docs` | S | the user, the practice it replaces and the guardrails. Coordinates with #86 |
| O6 | #129 | feat: beat the crew and defend modes | `area:run` | S | stretch, first to cut (§9) |

## 14. Live mode and the first-person scan view (proposed)

Epic #98. A second way to play the Run screen, beside the board as it is. It
changes two things: **how a turn starts** (a clock, not only a click) and
**what the player looks at** (three HUD elements and, on a scanned building,
the scan itself). The engine, the rules table, the crew, the Chief, the Why
cards, the replay and Owner Mode are unchanged.

**A name, to avoid a collision.** "Live" in this section is the Run screen's
play mode, kept in guarded `localStorage` under `heist:play-mode`. It has
nothing to do with `HEIST_MODE=live` or `NEXT_PUBLIC_MATTERPORT_MODE=live`
(§7), which take a service off its fixtures.

**Why.** Playing the Run screen on 14 November showed three problems. Nothing
moves until the player clicks. The screen shows everything at once and never
says what to do next. The board is abstract and silent. There is a data
reason too: the app reads the Matterport scan and shows it only in the small
Inside view panel (§4.5), so a judge scoring CoStar's data use (30%) barely
sees that layer. In first person the scan is the screen.

**The two modes.** A switch on the Run screen, remembered per browser.

- **Tactical** is §2 beat 6's board, and the default. The smoke walks it.
  Nothing on it changes except that sound plays (below).
- **Live** adds, in the order it is built:
  1. **The turn clock.** A turn ends when the player acts, or after
     `LIVE_TURN_MS` if they don't: the clock then plays a `wait`, or, while a
     pick is in progress (`run.picking`), a `pick` on that door.
     - A pick in progress continues on the clock, so a lock opens after its
       turns without a key press for each. The clock cannot play a `wait`
       there: the engine's `wait` ends a pick (`src/engine/actions.ts`). Any
       other action the player takes ends the pick, as on the board.
     - Arming a sprint (`S`) is not an action. The clock keeps running, and a
       clock turn leaves the sprint armed.
     - Space takes the objective as it does today. It is an action, so it
       restarts the clock.
     - The clock does not hold for the Chief. The guards already converge on
       their own, and the Chief's orders apply on the turn they land, as they
       do today (§4.2).
     - `P` pauses and resumes. The clock also holds while a Why card is open,
       while the tab is hidden, and once the run is over. Tactical is the
       clock switched off.
     - Every clock turn goes through `act`, so the log and the replay stay
       exact.
  2. **The play HUD.** An objective line (the goal, and the hops left along
     the shortest path on the engine's graph), a danger meter (the alarm
     level, and who sees or hears the player), and one radio line (the crew's
     next step, sightings, and the Chief's re-plan as it streams). The
     Chief's panel, the lens and the legends open on demand.
  3. **The scan view**, on a building with a live scan (§4.5). It reuses the
     Inside view's player: in Live that player is the stage and the side
     panel is not shown.
     - Each engine node is a scan position, so a hop is a camera move. The
       engine stays the authority: a step is the engine's `move`, and the
       camera follows the player's node.
     - The page takes the pointer and the keys and drives the camera through
       the SDK (`Camera.rotate`, and `Sweep.moveTo` with a 500 ms travel
       time), because the player's own steps take 1.5 to 2.8 s.
     - A hop takes 0.7 to 1.1 s on screen, end to end. One input is in flight
       at a time: the turn commits when the hop starts, the clock restarts
       when the camera arrives, and input during a hop is dropped.
     - Guards, cleaners, cameras and watched positions are drawn on a layer
       over the player, placed from the camera pose with
       `Conversion.worldToScreen`. A piece is drawn solid if its node is in
       the sightline set of the player's node and its projection lands in the
       frame, as an outline if it is within hearing instead, and not at all
       otherwise. Nothing is hidden by the scan's geometry: the embed SDK
       gives the page no occlusion.
     - A CSS filter gives the scan its after-hours look.
     - The board stays as the minimap. It becomes the stage if the player has
       not opened within 20 s (the Inside view's bound today), reports an
       error, or does not arrive at the player's node. The run state is the
       engine's, so the swap loses nothing.

**Sound.** Separate from the two modes: it plays in Tactical and in Live. It
is made with Web Audio, so there are no audio files. It starts unmuted, makes
no sound before the first click or key press (browser autoplay rules), and
has a mute control whose choice is remembered. The smoke asserts nothing
about it. Whether it is on in Tactical for the demo is part of T7's 02:00
decision, since Tactical carries beat 6 on a no-go; the mute control is the
fallback either way.

**What the demo reset clears.** The mode and the mute choice are stored under
`heist:` keys in the browser's storage, which `npm run demo:reset` clears
(`src/lib/demo-epoch.ts`). So a reset puts the Run screen back to Tactical,
with sound unmuted, before the pitch. T1 and T3 keep them under `heist:` keys
so the reset reaches them.

**Numbers (D12 owns them).** `LIVE_TURN_MS` is 1100. A camera hop asks for a
500 ms travel time.

**A scan's board, and long hops.** A scan's own neighbour lists join most
positions of an open room (up to 46 neighbours in the scans tried), so one
hop can cross a room and every edge between two rooms counts as a door. The
proposal, for the Matterport mapping and its own ticket (T8): drop hops
longer than about 6 m, but keep any edge whose removal would cut a position
off. If the entry, the objective or an exit still cannot be reached, the
level is not placed and the fixture floor is used, as §4.5's fallback does
today.

**What a spike showed (14 November, localhost, one real scan).** These
numbers are from a single scan and one machine. `Sweep.current` reports each
step. The pose streams at about 55 updates a second. Points projected onto
the floor land 2 to 13 cm from the scan's own surface at 4 to 11 m. The embed
SDK has no `Scene` namespace, so nothing can be placed inside the player as a
3D object. The scan is playable about 11 s after the page opens, so the
player should start loading on the Plan screen.

**Terms and guardrails.** §4.5 stands, restated here: nothing read from the
scan goes to the server, into storage or to a model. The scan view adds no
exception. It uses no device camera, microphone or location. The guards and
cameras drawn in a real building's scan are game fiction, so the scan view
keeps the line "Security shown is game fiction" and the source chip on
screen. Whether the sponsor accepts game elements over the player, the CSS
filter, and the scan in the video is Q10 (§11).

**Demo.** Beat 6 stays on the Tactical board unless the team says go by
02:00 UTC on 15 November (T7). A go leaves 4 h 48 min to the 06:48 UTC
freeze. On a go, the run beat plays in Live on a scanned kit building, with
the board as its fallback. No go by 02:00 UTC means Tactical carries beat 6.

**Cuts.** The whole epic is cut before anything in §9. Inside it, first cut
first: the scan view's polish, the scan view (T4 to T6), the HUD, sound. The
clock stays behind the switch.

**Backlog.** Filed without `loop-ok`. T1 to T4 are built in Nelson's session
and reviewed by the loop; T5, T6 and W are open to the team.

| id | issue | title | area | size | acceptance |
|---|---|---|---|---|---|
| T1 | #99 | feat: Live mode and the turn clock | `area:run` | M | Tactical unchanged; in Live a `wait` every `LIVE_TURN_MS` with no input, or a `pick` while a pick is in progress; pause; clock turns in the log; tests under fake timers |
| T2 | #100 | feat: the play HUD and the radio line | `area:run` | M | three elements in Live, the panels behind Details; `ui-craft` rubric at 1440×900 and 390×844. Depends on T1 |
| T3 | #101 | feat: sound cues for the run | `area:run` | S | `cuesFor` pure, with a test per cue; no audio files; mute |
| T4 | #106 | feat: the Inside view reports its pose and takes a look | `area:adapter-matterport` | M | pose, floor points, projection, rotate and a per-move travel time on the adapter; the Inside view as it is unchanged; nothing stored |
| T5 | #107 | feat: the scan as the first-person Run view | `area:run` | L | the page owns look and step; the engine stays in step with the camera; board fallback. Depends on T1, T4, T8 and Q10 |
| T6 | #108 | feat: guards and sight drawn over the scan | `area:run` | M | the overlay tracks the pose; the visibility rule above; the Why card opens. Depends on T4 and Q10 |
| T7 | to file | docs: the Live demo beat and the default mode | `area:docs` | S | the 02:00 decision recorded; the script and the smoke follow it. Depends on Q10 for a go only: a no-go needs no answer to Q10 |
| T8 | #110 | feat: a scan's board drops long hops | `area:adapter-matterport` | S | no position cut off; the entry, the objective and an exit stay reachable, or the fixture floor is used |
| W | #109 | chore: make walking the scan feel smooth | `area:run` | S | by hand, in the sandbox on `chore/98-scan-walk-spike`: holding W walks without a stop between hops; `controls.ts` keeps its `target` and `step` contract |
