# Pitch: CoStar, "Inside and Out: AI for the Built World" (2 minutes)

The largest prize. Its published weights
([`tracks/prizes.md`](../../tracks/prizes.md)):

| weight | criterion |
|---|---|
| 30% | use of the data: layers combined intelligently, not as decoration |
| 30% | agentic depth: reasons, plans and acts, beyond chat and summaries |
| 25% | usefulness: "would someone want this switched on Monday?" |
| 15% | demo and polish |

So this pitch names all three layers and what each one does:

- **CoStar's record** sets the level's rules, with provenance.
- **Matterport's scan** is the board and the ground in first person.
- **Vexcel** is Scout's aerial.

It shows the agents doing the work, and gives Owner Mode, the Monday answer,
three times DEMO.md's time.

This builds on [`DEMO.md`](../DEMO.md), which stays the home for the setup,
each beat's detail, the fallbacks and the checklist. The beat numbers below
are DEMO.md's. Brackets are read off the screen, or off the printed answer
key, as in DEMO.md.

## Cue card

| # | at | click | say | if it breaks |
|---|---|---|---|---|
| 1 | 0:00 | **Take the job** yourself: **The Romaine Street Papers** is open by default | "Hobbs: agents turn a real building's CoStar record, Matterport scan and Vexcel aerial into a heist level." | Another job is open: click the Romaine tab, then **Take the job**. |
| 2 | 0:07 | Point at the funnel, then the showcase card; **Scout it** | "A deep agent runs a location scout's search, filter by filter: era, class, a floor on the market, a scan. For now, on our fixture inventory. Tonight's cast is a real kit building, [name]: each row checks its CoStar record against a need." | Slow: **Skip**. No card, or not built: [the F1 path](../DEMO.md#if-the-showcase-building-is-out-the-f1-path). |
| 3 | 0:25 | **Plan the job** | "Vexcel, from above, aimed from the record's location and size." | No aerial: "No aerial for this one yet." Then **Plan the job**. |
| 4 | 0:30 | Point at **Data → Level** as it fills, then **Brief the crew** | "CoStar sets the rules. A second deep agent built this level live, from the record: built [year], so key locks and sweeping cameras; class [X], [N] guards; the vacant floor is the stage. The security is fiction." | Stalls: **Skip**. The banner doesn't say "on live data": drop "live". |
| 5 | 0:46 | Paste the order, **Enter**. Click a camera on the board, then **Esc**. **Start the run** as the plan shows | "This board is the Matterport scan, its own positions and rooms. Each camera's card names the CoStar field behind it." Then: "The crew answers, pushes back, and the board checks its plan on the scan." | **No crew reply**: "The model was slow, so the board worked out this plan, with no model." Greyed order box: the F1 tab. |
| 6 | 1:01 | Click the view once; hand over. At **1:22**, the Owner tab | "You're walking the scan's own mesh, painted from its panoramas. W to move, the mouse to look. Stand in that camera's light." At the alarm: "The Chief re-plans the guards live, and the engine clamps its orders to legal moves." | At 1:22, caught or not: "Caught." or "The Chief is still hunting you." Then the Owner tab. Scan fails: the F1 tab. |
| 8 | 1:22 | The **last browser tab**, the Owner tab you prepared. **Show on the board** under A | "Monday's user is a building's security lead. Owner Mode, on the same scan, with a made-up setup: fifty break-ins on each setup, from the crew's strategies. Turn one camera: open windows, the moments a crew gets in and out unseen, drop from [before] to [after]." After the click: "The way most got out. A first pass before the site visit; and casting is a location scout's search." | Result gone: scroll to **Compare two setups**, then **Compare**; fill its 4.2 s: "The crew tries fifty ways in, on each." The crew chip reads **Rule-based**: add "here rule-based, as the tag says." |

Ends at **1:52**, with 8 s spare. The spare covers three things: beat 5's
crew reply, which wasn't measured live; the **Rule-based** line; or a
compare re-run.

Against DEMO.md's clock:

- Missions: 10 s → 7 s. The presenter clicks, not the judge.
- Cast: 20 s → 18 s.
- Scout: 3 s → 5 s.
- Dossier: 14 s → 16 s.
- Plan: 13 s → 15 s.
- The run: 30 s → 21 s. It is cut at 1:22, caught or not.
- The Debrief is dropped.
- Owner Mode: 10 s → 30 s.

The run's alarm and the Chief's first line fit in 21 s. On the rehearsal's
timings, the alarm comes 3–6 s after **Start the run**, and the Chief 2.5–5.7
s after that. The capture often won't land, and the beat doesn't need it.

## What each beat answers

| # | beat | data use (30%) | agentic depth (30%) | usefulness (25%) |
|---|---|---|---|---|
| 1 | Missions | names the three layers | | |
| 2 | Cast | the card checks the kit's own record, need by need | the Casting Director: a deep agent with a `location-scout` subagent and five tools | **Monday, second answer:** the location scout's search |
| 3 | Scout | two layers combined: Vexcel aimed from CoStar's location and size | | |
| 4 | Dossier | CoStar's record → the rules table → the level, each piece with its provenance | the Level Builder: a deep agent with two subagents, which ran live on the real record | |
| 5 | Plan | Matterport is the board, and CoStar's provenance is on each piece of it: layers combined, not side by side | the crew pushes back, and the board checks its plan | |
| 6 | Run | Matterport's mesh is the ground; spatial and visual, not only text | the Chief re-plans the guards; the engine clamps its orders | |
| 8 | Owner Mode | coverage and open windows, worked out from the scan's floor plan | the crew's strategies, played 50 times by the engine | **Monday, first answer:** a building's security lead |

The 15% for demo and polish is in every beat: a run that doesn't stall, and a
screen that says what is live.

## Skip at this table

- **Beat 7, the Debrief.** Its replay is the Entertainment beat. The Chief's
  re-plan is narrated in beat 6 instead.
- **The judge picking the mission.** The presenter clicks, to save 3 s.
- **Owner Mode's counts out of 50**, as in DEMO.md: say the open windows.
- **"Ask the Chief for a fix"** on the showcase. On #206's live walk, the
  Chief's lock fix changed nothing on the generated setup. The compare is the
  beat that shows a change.
- **Any claim that the agent found the real building.** It didn't (below).

## Before this table

Nothing beyond [DEMO.md's checklist](../DEMO.md#demo-machine-checklist): the
F1 tab, the Owner tab on the showcase building, and the scan loaded from Plan
last.

Optionally, read the showcase card's need rows once on the machine. Then you
know which of the seven needs it fits before a judge asks.

**If the crew is slow in beat 5, there is a filler.** Click **Layer lens** at
the top of the Plan board, or press **L** outside the order box. Then say:
"C marks what the record placed; M, the scan's own rooms."

- This was not walked on the showcase scan.
- Its legend counts each layer. Vexcel's count may be zero on this building,
  because a live aerial tags no ways in.
- If a judge points at it, use the second answer below.

## Judge questions

**Most likely: "Did your agent pick this building from our data?"**
"No, we chose it from the kit for this mission. The casting search runs on a
61-building fixture inventory today, as the replay's banner says. The card's
checks are from the building's real record. Pointing the search at the kit is
next."

**Also ready: "Is Vexcel only a picture?"**
"On a kit building, yes for now. It's aimed from the record's location and
size, but a live aerial tags no ways in, so the level offers the roof hatch
and the street lobby. On our fixture buildings, the aerial's tagged entries
are the level's ways in."

## Checked against `main`

Checked at 105d812.

- **Beat 2:**
  - The card's heading **Cast · this mission's showcase building** is in
    `cast-screen.tsx`, and "Picked from the showcase list · …" is in
    `showcase-card.tsx`.
  - The trace header begins "Scripted run" (`castRunHeader` in
    `cast-screen.tsx`). Its banner is "A replay of a run recorded on fixtures.
    Nothing on this screen calls a model."
  - In live mode, Cast replays a shortlist from `.heist/casting/` instead, if
    `npm run cast` was run live on that machine (`readShortlist` in
    `src/app/m/[missionId]/cast/page.tsx`). Its header then begins "Recorded
    replay". Its search still read the fixture inventory.
  - The search reads only the fixture inventory, in live mode too
    (`src/adapters/costar/live.ts`).
  - The showcase building comes from a list the team set
    (`src/lib/showcase-cast.ts`).
- **Beat 3:** the aerial is aimed from the record's coordinates and size
  (`src/adapters/vexcel/derived-massing.ts`).
- **Beat 4:**
  - The level is built when the server starts (`warm-showcase.ts`), only
    with a live model.
  - On a live record the banner reads "A replay of a run recorded on live
    data, with model turns from [model]. Nothing on this screen calls a
    model." (`traceBanner` in `src/components/dossier/replay.ts`).
- **Beat 5:**
  - On a kit building, the Why card adds "From its real CoStar record:
    [fields]" (`recordNote` in `src/lib/record-label.ts`).
  - The label **The crew pushes back** is in `crew-reply.tsx`, and the crew's
    prompt asks for the order's one real weakness.
  - The board's warning heading is **Checked on the board**.
  - The **Layer lens** toggle is on Plan's board (`plan-screen.tsx`), and `L`
    is left alone in a text field (`layer-lens.tsx`).
- **Beat 6:**
  - The engine clamps the Chief's orders to legal moves
    (`src/engine/orders.ts`).
  - #207 merged after DEMO.md was written. At Lockdown the Chief is now asked
    once per zone, at most once every 10 s, and the radio reads each re-plan
    in full. That wasn't rehearsed on the scan; narrate it as the cue card
    says.
- **Beat 8:**
  - These strings are in `owner-screen.tsx`, `derived-demo.ts`,
    `compare-panel.tsx` and `owner-ready.tsx`:
    - "A made-up setup for the demo, not this building's real security.";
    - **Two setups, side by side**;
    - **Compare two setups**;
    - **Show on the board**;
    - "Demo: generated security";
    - the caption "The way most got out is drawn.", or "No way out to draw."
  - A side with nobody out draws no route. So if A's count is 0, skip the
    click.
- **Not confirmed from the code:** anything live, as in DEMO.md. That covers
  the showcase card, the aerial, the live Level Builder's trace, the crew,
  the Chief, Owner Mode's figures and its 4.2 s. It also covers the Layer
  lens on the scan.
