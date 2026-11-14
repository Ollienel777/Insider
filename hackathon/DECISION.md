# Decision: Heist Anywhere (v3)

## The builder's notes, verbatim

> Run the build loop on the Heist anywhere idea. Just have it complete as much as possible for now even though I don't have API keys set up.

Nelson, in chat, 2026-11-13 07:25 UTC.

> hacking has started, dont go plan mode, go build mode

Nelson, in chat, 2026-11-13 07:55 UTC, repeating the note above. `hacking
starts` in `EVENT.md` is set to that moment. These notes override the one-pager
wherever the two conflict. The builder's Nov 13 clarifications, also verbatim,
are inside the one-pager below.

## What was chosen

**Heist Anywhere, v3**: the team's own idea, as adjusted by the builder's
clarifications on Nov 13. It is not round 5's repair (R5-01 Stand-In) and not
R5-05 Case Files. The builder named Heist Anywhere after reading round 5's
packet, which scored it as written at 47.7, last of 12.

Round 5's reasons are risks the spec must answer. They do not change what is
built:

1. **CoStar's data only sets difficulty**, so it reads as decoration, and
   CoStar weights data use at 30%. The spec should make CoStar's fields
   visibly drive the level, as the one-pager's "Why is this guard here?" card
   intends.
2. **Matterport's standard terms** forbid caching scan data outside the
   platform and feeding it to an outside AI (Services Agreement §12(e)(v) and
   §8(c)(xi); `round-5/research-heist-access.md`, fact 4). The event keys may
   carry different terms; that is unverified until the sponsor answers in
   writing.
3. **A full agent loop every turn takes about 20 s** on stage, and LLM guards
   can be talked past.
4. **No usefulness answer yet** for CoStar's 25% "would someone switch this on
   Monday?". Drill Mode duplicates an existing product (RSET).
5. **AI Game Master stories are a saturated archetype** (about 80 projects in
   past galleries).

## Defaults recorded overnight

The builder was asleep when the build loop started. These defaults are
Claude's, not the builder's. The spec adopts each one and lists it as an open
question; the builder can overrule any of them.

1. **Model provider:** the Anthropic API is primary (team decision, Nov 13).
   AWS Bedrock (Claude Opus 4.6 and Sonnet 4.6, us-east-1) sits behind the same
   adapter, switched off, because the account cannot make calls yet. Every
   model call also has a fake.
2. **Latency on the live path:** guards move deterministically each turn. The
   AI Security Chief makes one structured model call, and only when the alarm
   state changes; the game shows its reasoning. The demo also has a recorded
   fallback.
3. **Matterport terms:** until the sponsor says yes in writing, nothing
   derived from Matterport scan data is cached outside the platform or sent to
   an outside model. Work that needs that data runs in the browser, or is
   hand-authored on fixtures.
4. **Prize targets** stay as in the one-pager: Entertainment as the main
   track, plus CoStar, LangChain `deepagents` and Amazon Practical AI.
5. **The judged slot is 2 minutes**, not 3. The one-pager's demo is already a
   2-minute script.

## Sources

Everything here is local and gitignored. The build loop runs where
`hackathon/ideation/` may not exist, so this file stands alone; the paths are
for depth.

- `hackathon/ideation/external/heist-anywhere.md`: the one-pager below.
- `hackathon/ideation/round-5/research-heist-access.md`: what Matterport,
  Vexcel, CoStar and Bedrock expose, and under which terms.
- `hackathon/ideation/round-5/research-heist-fit.md`: historical missions,
  field and track fit.
- `hackathon/ideation/round-5/PACKET.md` and `verdict.md`: round 5's verdict.
- `hackathon/ideation/round-5/shortlist/R5-01.md`: Stand-In, the repair. Its
  engineering fixes (deterministic guards, three terms tiers) apply here too.
- `hackathon/ideation/brief.md`: the intake research digest (sponsors, field,
  saturation).

---

# The chosen one-pager, in full

# Heist Anywhere: the team's idea, adjusted (v3)

Source: the team's brief "Heist Anywhere" (Draft plan v2, Nov 12, 2026), a
review of it, and the builder's clarifications on Nov 13. This file is the
idea to score. It is an input, not a rule.

## The idea

A story-driven stealth game set inside real Houston and LA buildings. Think
GTA-style "heist levels": each level is a mission with a larger objective,
staged in a real building chosen from CoStar's data.

- **Mission types (builder's clarification):**
  - prevent a bad historical event, or
  - run a heist recreated from a past, documented corporate heist, such as
    stealing a company secret.
- **No tenants, no public.** Nothing in the game is about a building's current
  tenants or anyone in the general public. Buildings are stages. Story,
  characters and objectives are fictional or drawn from historical public
  record.
- **Core loop:** Scout (Vexcel aerial: orbit the real building, tag entries,
  roof, loading dock) → Plan (brief an AI crew in plain English on the floor
  plan; crew agents plan their steps and push back on risky plans) → Run
  (turn-based hops between Matterport scan points like Hitman GO; guards move
  after you; vision cones, noise, alarm states; an AI Security Chief re-plans
  live and shows its reasoning) → Debrief (grade, replay of your path, guard
  paths and the Chief's decisions).
- **Data drives the level, never the story's targets:** year built sets the
  security era (keys and old cameras in 1978, badge readers in 2019); class
  sets difficulty; vacancy by floor sets quiet and crowded zones; Vexcel
  entries, roof and docks set the routes in and out; Matterport rooms, doors
  and sightlines are the movement graph. Security layout is labelled as game
  fiction derived from building class and era, not a claim about the real
  building.
- **Signature feature:** click any guard, camera or locked door to see which
  data shaped it ("Why is this guard here?").
- **Modes, in priority order:** solo heist level (must); co-op Inside +
  Overwatch, where one player sees the 3D interior and the other the aerial
  and data intel (should); Drill Mode, the same engine running an evacuation
  drill that produces a report (should); a linked campaign (stretch).
- **Agents:** a Level Builder (scan → room graph, entries, difficulty,
  objectives; cached per building), crew agents, a Security Chief commanding
  guards, a Game Master writing briefings and story. All on LangChain
  `deepagents` (Python). Game: React + Three.js on the Matterport viewer or
  mesh.
- **Models:** the team now has AWS Bedrock access to Claude Opus 4.6 and
  Sonnet 4.6 (Nov 13). The 5.5 family is not available on that account.
- **Prize targets:** Entertainment (main track), CoStar, LangChain deepagents,
  Amazon Practical AI.
- **Demo (2 minutes):** a map of LA showing the prepared buildings with all
  three layers; a judge picks one; the aerial zooms to the real roof, lot and
  dock; a mission briefing from the Game Master; one plain-English order to
  the crew, answered with a plan and a warning; the run, where the judge trips
  a sightline and the Chief re-plans; debrief and replay; switch to Drill Mode.
- **Fallback if kickoff checks fail (team's brief):** "Living Tabletop", an
  overhead camera tracking miniatures with an AI dungeon master and a
  projector. Hardware; the team has no hardware experience.

## Review notes the clarifications respond to

The builder's numbering refers to these three critical notes from the review.

1. **Data access.** The room graph and guard paths need room-level Matterport
   data, which the public API gates to Enterprise, and Matterport's terms may
   restrict indexing and caching scans. *Builder: this can be refuted once we
   test and build at kickoff; treat it as a feasibility assumption to verify,
   not a settled blocker.*
2. **Real tenants and security framing.** The v2 demo used a real tenant
   ("a law firm on 14 moves out Friday") and "why" cards that read like a
   security layout of a real building. *Builder: reframed as story-driven
   heist levels with historical objectives; nothing about tenants or the
   general public.*
3. **Usefulness.** Drill Mode was v2's answer to CoStar's 25% "would someone
   want this switched on Monday?". An evacuation report built on partial scans,
   generated hallways and parking-based headcounts may not survive an engineer
   judge. *Not addressed yet.* An alternative raised in the review: every
   vacant suite becomes a playable level that markets the space for brokers.

## The builder's clarifications, verbatim (Nov 13)

> For the flagged criticals, 1 can be refuted once we do some actual testing and building to see if its feasible right.
> For 2, since entertainment wants to focus on story telling, Im thinking about making it almost like GTA with "heist levels" with larger objectives like preventing a bad historical event or just running an actual heist like stealing a company secret (recreated from a past historical company heist). I don't plan on it being on tenants or like anything to do with the general public.

## Open questions for the loop

- Which historical events and documented corporate heists in Houston and LA
  make good, tasteful missions? Violent tragedies are likely off-limits in a
  game; corporate and fraud history may suit better.
- What is the strongest usefulness answer for CoStar's 25%?
- What can be cut so the core loop is solid by hour 16 of 36?

---

# Data feasibility, and the kickoff go / no-go

From the team's notes on round 5's research (`round-5/research-heist-access.md`).

| question | status |
|---|---|
| Turn-based movement graph | Settled: the public SDK's scan points with neighbours, `Sweep.createGraph()` with A* |
| Rooms | Settled: the SDK's room label and bounding box; labels may be blank |
| Doors, walls, sightlines | Infer or hand-author; no API exposes them |
| Free first-person movement | Out: the mesh is a paid add-on, and floor-plan geometry is Enterprise-only |
| Event key scope | Ask: normal keys start in sandbox mode (the owner's demo model only) |
| **Terms** | **Blocker until a written yes:** no caching outside the platform, no content database, no feeding Matterport data to an outside AI |

**Go / no-go in hours 0–2:** at least 5 buildings with all three layers; at
least about 25 connected scan points on one floor of each; guard markers
placeable in the scene; and a written yes on terms, or a design that fits
them. If any one fails, switch that same hour.

**Questions for CoStar's Discord:**

- Are the Matterport keys scoped to the real Houston and LA scans?
- Which buildings have all three layers, and how many?
- Is the Bundle SDK allowed? Property Intelligence, or the mesh?
- May we cache derived graphs and send scan-derived data to an external LLM?
- May scans and imagery appear in a public repo and video?
- Does CoStar have vacancy by floor? Lease and availability history?

# Runner-up options, as fallbacks

| id | name | one-liner | round-5 board |
|---|---|---|---|
| R5-01 | Stand-In | The heist, repaired. An agent casts a real, empty Houston or LA building to play each historical scene, and the player's pick among three finalists changes the level. | 71.3 |
| R5-05 | Case Files | A noir detective game whose cases are real contradictions between CoStar, Vexcel and Matterport. Solved cases become corrections for CoStar's researchers. | 73.1 |
| R4-12 | Chairs Above Water | Houston's dialysis network as capacity in a flood. An agent re-plans shifts and routes, and reports the treatments still unplaced. | 74.3 |
| R4-01 | Lock-in | NYC Local Law 97 reframed citywide: the buildings that pass today and fail in 2030. It cannot enter CoStar. | 77.8 |

The team's own fallback, "Living Tabletop" (an overhead camera tracking
miniatures, with an AI dungeon master and a projector), is hardware, and the
team has none.

# Human actions still outstanding

1. **Confirm the clock.** `hacking starts` (2026-11-13 21:00) and the
   deadline (2026-11-15 09:00, America/New_York) in `hackathon/EVENT.md` are
   estimates from past editions. Correct them from the hacker guide or
   Discord before the build loop starts in build mode.
   https://www.hackprinceton.com/
2. **Create the public submission repo at hacking start, not before**, then
   push this folder and create the loop's labels (`harness labels`).
3. **Anthropic API key** into `.env.local` and the repo's GitHub Actions
   secrets, under the name the spec's `.env.example` gives.
   https://console.anthropic.com/
4. **AWS Bedrock**, if it is wanted later: check the applied quota under
   Service Quotas in us-east-1, and open the support case.
   https://console.aws.amazon.com/servicequotas/home?region=us-east-1
5. **CoStar, Matterport and Vexcel keys** are handed out at the event. Ask the
   Discord questions above in hour 0. Matterport SDK docs:
   https://matterport.github.io/showcase-sdk/
6. **A written yes on Matterport's terms** for caching derived data, sending
   scan-derived data to an outside model, and showing scans in a public repo
   and video.
7. **Devpost**: register the project, choose the main track (Entertainment)
   and the special tracks, and collect every member's Discord username.
8. **LangChain `deepagents`**: nothing to sign up for.
   https://docs.langchain.com/oss/python/deepagents
