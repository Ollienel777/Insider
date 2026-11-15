# The demo script (2 minutes)

Tonight's plan. The demo plays `romaine-1974` on its showcase building, a real
building from the kit. The team decides at 02:00 UTC on 15 November (21:00 ET
on the 14th) where the run beat plays:

- **Go:** in first person inside the building's own Matterport scan.
- **No-go:** on F1, the fixture building.

Owner Mode gets 15 seconds after the Debrief (Q9, status issue #1).

Written against `main` at c08ae94, at 00:48 UTC on 15 November. Every F1 step
was walked on that tree in fake mode: a production build with every service
on `fake`, at 1440×900. So were first person on F1, and the kit-building screens
on the fictional test building (`HEIST_TEST_KIT=1`). No keys were used here, so
every step that needs live CoStar, Matterport or a model says **live only, not
walked here**.

## On stage

- One presenter. A judge picks the mission (beat 1) and makes the fatal move
  (beat 6).
- **Say only what the screen shows.** The chip top right reads `LIVE` or
  `FIXTURES`. A **Recorded**, **Rule-based** or **Worked out on the board** tag
  means no model wrote that answer. Never narrate one of those as live.
- The showcase building is real, so read its name off the cast card; this
  file doesn't name it. The guards, cameras and locks in it are game fiction.
  Beat 4 says so.
- **Never reload a showcase-building page.** Its crew plan and run log live
  in the tab's memory only, so a reload empties the Debrief. Move with the
  step rail and the buttons.
- **Keep the window in front, and its tab active, while a page loads.** A
  hidden or background tab drops the scan to the fixture floor.
- Never click **Drill** (on hold, Q8). On the board, never press **S**: it arms
  a sprint, and the numbers then mark rooms two hops away.
- If a beat breaks, say its fallback line, do its fallback click, move on.

## The clock

| # | beat | time | length | screen |
|---|---|---|---|---|
| 1 | Missions | 0:00–0:10 | 10 s | `/` |
| 2 | Cast | 0:10–0:30 | 20 s | `/m/romaine-1974/cast` |
| 3 | Scout | 0:30–0:33 | 3 s | Scout |
| 4 | Dossier | 0:33–0:47 | 14 s | Dossier |
| 5 | Plan | 0:47–1:00 | 13 s | Plan |
| 6 | Run, go or no-go | 1:00–1:28 | 28 s | Run |
| 7 | Debrief | 1:28–1:43 | 15 s | Debrief |
| 8 | Owner Mode | 1:43–1:58 | 15 s | the Owner tab |

**1:58**, with 2 s spare. Against SPEC §2's slots, Owner Mode's 15 s and the
2 s spare come from:

- Scout: 10 s → 3 s.
- Debrief: 20 s → 15 s.
- Cast: 22 s → 20 s.
- Dossier: 15 s → 14 s.
- Run: 30 s → 28 s.

The spoken lines are sized at about 2.5 words a second. Rehearse once against
a timer, and cut words, not beats.

The machine's waits, measured on the fake walk:

| wait | time |
|---|---|
| the cast replay | 7.8 s |
| the Dossier replay | 5.6 s |
| first person on F1, ready | 1.8 s |
| F1 in first person, Alert → caught | 1.8 s |
| Owner Mode's Compare | 0.4 s |

Live waits were not measured here: the crew's reply, the Chief's re-plan and
the scan's load.

## Beat 1 · 0:00–0:10 · Missions

Screen: **Pick a mission**, five mission cards.

1. Say: **"Every heist in history needed a building. Our agent finds one
   that's empty tonight. Pick a heist."**
2. The judge clicks **The Romaine Street Papers** (the Summa Corporation
   burglary, 1974). Point at it if they hesitate.

Fallback: if the judge picks another mission, press the browser's Back
button and click **The Romaine Street Papers** yourself. Say: **"Tonight's
building is cast for this one."**

Walked here.

## Beat 2 · 0:10–0:30 · Cast

Screen: the Casting Director's replay, about 8 s: its todos, and the funnel
narrowing filter by filter beside the map. In live mode (PR #124), a card
headed **Cast · this mission's showcase building** sits above the funnel's
finalists, which fold into a closed list under it. The card shows:

- the building's CoStar facts;
- "Picked from the showcase list · fits N of 7 of the mission's needs";
- one row per need, such as `Class B · needs Class A`;
- a line saying where its level stands.

This card is the real building the run uses.

1. While the funnel narrows, say: **"The agent searches CoStar's inventory
   for this heist: the right era and class, a floor on the market tonight, a
   3D scan."**
2. When the card shows, point at it. Say: **"For this mission, a real
   building: [its name, off the card]. Each row checks it against a need,
   from its CoStar record."**
3. Check that the card's level line says the level is **built**.
4. Click **Scout it**. The showcase building is already picked.

Fallbacks:

- The replay is slow: click **Skip**, which shows everything at once.
- No showcase card, or its level isn't built: see
  [If the showcase building is out](#if-the-showcase-building-is-out-the-f1-path).
  This happens when the chip says CoStar is on fixtures, or the level is still
  building.

Live only, not walked here: the showcase card. What was walked: the fixture
replay (61 → 3 on the fixture inventory), **Finalist 1 · F1 Halvorsen Tower**,
**Scout it**.

## Beat 3 · 0:30–0:33 · Scout

Screen: a **No aerial** card, "Vexcel has no imagery for this building yet."
Under **Ways in**: "the roof hatch and the street lobby, which every office
building has."

1. Say: **"No aerial for this one yet."** Click **Plan the job**.

Fallback: if Scout hangs, click **Dossier** in the step rail.

Walked here on the fictional test building, which shows the same card.

## Beat 4 · 0:33–0:47 · Dossier

Screen: the label **Real CoStar record** (PR #111). Beside it, the Level
Builder's run replays (about 6 s) and fills the **Data → Level** table. A kit
building has four rows:

| CoStar field | what it sets |
|---|---|
| year built | the era |
| class | the guard force |
| the vacant floor | where the level is staged, and its quiet suites |
| typical floor size | the crowded zone |

The mission briefing follows.

1. As the rows fill, read them off the table. Say: **"Its real CoStar record.
   A deep agent built the level from it: built [year], so [key locks and
   sweeping cameras]. Class [X]: [N] guards. Its vacant floor is the stage.
   The security is game fiction."**
2. Click **Brief the crew**.

Don't say the staged floor's number. The scan is of a different floor (Open
items, 4).

Fallbacks:

- The replay stalls: click **Skip**. Say: **"Here's the finished level."**
- The Dossier offers to build the level: don't. It takes about 154 s. Go to
  [the F1 path](#if-the-showcase-building-is-out-the-f1-path).

Walked here on the fictional test building: the label and the four rows. The
showcase building's own values are live only.

## Beat 5 · 0:47–1:00 · Plan

Screen: the Plan board and the order box. The order is on the clipboard
(checklist):

`In through the street lobby, straight to the files, and out the way we came.`

It names the way in and the objective, and asks for no wait. An order with a
wait once had the crew wait in a suite on the staged floor, which the scan
doesn't have, and the board struck that step out (Open items, 4).

1. Click the **Your order** box, paste, and press **Enter**.
2. While the crew answers, click camera **C1** on the board. Its Why card
   opens. Say: **"Every guard, camera and lock says which data put it
   there."** Press **Esc**.
3. The crew's plan appears, checked on the board. A live reply carries no
   tag. Say: **"The crew answers in plain English, and the board checks its
   plan."**
4. Click **Start the run**.

Fallbacks:

- A step is struck through, with "Dropped step N: …" under the plan. Say:
  **"That suite isn't on this scan, so the board drops the step."** Click
  **Start the run**.
- "The crew didn't answer": the model was slow, and a kit building has no
  recorded reply.
  - **#142 had not merged** at 00:48 UTC. On `main`, click **Start the run**.
    The Run carries the level's own plan. Say: **"The model's slow
    tonight. The level carries a plan of its own."**
  - If #142 has merged, its plan arrives with the chip **Worked out on the
    board**. Say: **"The model was slow, so this plan is worked out on the
    board, with no model."**

Walked here:

- the Why card on the Plan board (F1 and the test building);
- the Run's own four-step plan on the test building with no crew plan.

Live only, not walked here: this order to the live crew.

## Beat 6 · 1:00–1:28 · Run

The team decides at 02:00 UTC whether the run plays in the scan (SPEC §14,
T7). Play one version.

### Go: first person inside the real scan

**Needs `feat/118-scan-join` merged into `main`.** It had not merged at 00:58
UTC. PR #122, the scan renderer it builds on, merged at 00:52 UTC, but it
doesn't reach the Run screen: on `main`, **First person** still shows only on
fixture floors.

Live only, not walked here.

Screen: the Run, labelled **Real CoStar record · real Matterport scan**.

1. Check that the label says **real Matterport scan**.
2. If the Run didn't open in first person, click **First person** (top right,
   under the scan stage's header). Wait for "Loading the building around you"
   to clear.
3. Hand the judge the keyboard and mouse. Say: **"You're in the real building,
   its own scan. W to walk, the mouse to look, Q to sprint. Get the files."**
4. Camera C1 looks down the corridor from the way in. First person plays a
   turn every 0.7 s, so by about turn 4 to 7 the alarm goes to **Alert**, then
   **Lockdown**. The Chief's re-plan streams onto the radio line at the
   bottom. Say: **"C1 has you. The AI security chief re-plans, live, and the
   guards follow it."**
5. The guards close in. The run usually ends in a capture, and the capture is
   the beat. Say: **"Caught. The debrief shows how."**
6. Click **See the debrief**.

Nobody has won this level on the scan yet. If the judge gets out, say: **"You
beat the Chief. The debrief shows how."**

Fallbacks:

- The label says **stand-in floor plan**, or the scan hasn't loaded in 10 s:
  the page fell back to the fixture floor, and first person still plays on it.
  Say: **"The scan didn't load, so this is the stand-in floor plan."**
- First person fails: the view drops to the board with a line saying why. Play
  the board with its number keys. Say: **"Same run, from above."**
- The Chief's line is tagged **Rule-based**. Say: **"The model was slow, so
  the Chief's rules answered. The guards never wait for it."**

### No-go: first person on F1, or the Tactical board

On `main` (PRs #119 and #138). Walked here. The run moves to Halvorsen Tower
(F1), the fixture building, open in its own tab (checklist).

1. Click the **F1 Run tab**. Say: **"Tonight's run is on our hand-built floor,
   a fixture building."**
2. Click **First person**. It was ready in 1.8 s on the walk.
3. Hand over. Say: **"W to walk, the mouse to look. Through the lobby, then
   left, down the dock corridor."**
4. The judge walks forward into the lobby, turns a quarter left, and walks
   into the Dock Corridor. On the walk, from the turn:
   - Camera C2 saw them about 3 s later. The alarm went to **Alert**, and the
     radio said "C2 sees you in the Dock Corridor."
   - The Chief's line followed on the radio 1.3 s after that.

   Say: **"C2 has you. The security chief re-plans, and the guards follow
   it."**
5. Caught in the Dock Corridor, 1.8 s after the alarm on the walk. Click **See
   the debrief**.

The walk was in fake mode, so the Chief's line was tagged **Recorded**. With a
live model, F1's Chief answers live. Say what the tag says.

Fallbacks:

- First person doesn't come up ("First person needs WebGL…", and the board
  shows). Play the Tactical board instead:
  1. Press **1**, **1**: the Freight Lift Lobby, then the Dock Corridor, in
     C2's view.
  2. The alarm goes to **Alert**, and the Chief's orders fill the side panel.
  3. Click guard **G4** for its Why card ("the 4th guard comes from Class A"),
     then **Esc**.
  4. Press **W** until the outcome shows (twice on the walk).
- The judge wanders off: click **Restart**, and give the directions again.

## Beat 7 · 1:28–1:43 · Debrief

Screen:

- the grade, and how it ended ("Caught in …", who saw you, who reached you);
- turns, noise and detections;
- the replay, with its **Turn** slider;
- the Chief's decisions as a timeline, each with its reason.

1. Drag the **Turn** slider back to the start, then forward. Say: **"The
   debrief replays every move, and each of the Chief's decisions with its
   reason."**
2. The Monday line: **"And that search, era, class, a floor on the market
   tonight, is the one a location scout runs on Monday, on CoStar's own
   availability."**

Don't click either of these:

- **Try again**: it starts a new run.
- **Owner mode: test your own security**: beat 8 uses its prepared tab.

Fallback: the Debrief says "No run yet", because a reload lost the run. Say:
**"The debrief replays the run turn by turn; you just saw how it ended."**
Then the Monday line.

Walked here on F1: grade D, "Caught in the Dock Corridor", two Chief
decisions, the slider. Live only, not walked here: the showcase building's
Debrief.

## Beat 8 · 1:43–1:58 · Owner Mode

Screen: the Owner tab, prepared before the pitch (checklist). It shows Owner
Mode on Halvorsen Tower:

- "Made-up setup on a fixture building";
- **Two setups, side by side**, tagged **Recorded**;
- A, "Demo: night shift": **7 / 50**, 43% watched;
- B, "Demo: night shift, C2 moved": **1 / 50**, 50% watched;
- "C2 moved from the Freight Lift Lobby to the Dock Corridor";
- "7 → 1 of 50: 6 fewer got out.";
- "Coverage 43% → 50%".

1. Click the **Owner tab**.
2. Say: **"And for the owner: enter your own security, here a made-up one.
   The AI crew tries fifty break-ins: seven get out. Move camera C2: coverage
   43 to 50 percent, and one in fifty."**
3. If time allows, click **Show on the board** under B. C2 is ringed, as what
   noticed the crew first most often.

Leave out the open windows. PR #144 had not merged at 00:48 UTC, so no
screen shows "40 of 80 → 20 of 80". Say it only if #144 merges and this tab
shows it.

Fallback: the tab lost its result, because it was reloaded.

1. Scroll the side panel to **Compare two setups**. It starts on the prepared
   pair.
2. Click **Compare**.

Coverage 43% → 50% comes from the floor plan, so it holds. The counts 7 and 1
come from the crew's recorded strategies. With a live model, read the counts
off the screen.

Walked here in fake mode: Compare in 0.4 s, 7 / 50 → 1 / 50, coverage 43% →
50%, and C2 ringed on B. Not walked: forcing the Model in the checklist,
because fake mode locks that switch.

## If the showcase building is out: the F1 path

Use this when the cast card is missing or its level isn't built. Everything
is on F1, Halvorsen Tower, and every step was walked here. Beats 1, 7 and 8
are unchanged, and beat 6 is the no-go version, played in this tab.

Say once: **"Our fixture building, shaped like a CoStar record."**

| beat | do | screen |
|---|---|---|
| 2 | **Finalist 1 · F1 Halvorsen Tower**, then **Scout it** | the three finalists |
| 3 | **→** once, then **Plan the job** | five tagged entries: Loading dock, Garage ramp, Main lobby, Stair B exit, Roof hatch |
| 4 | let it play (5.6 s), then **Brief the crew** | Data → Level, starting with "Cast because: …", then 1974, Class A, floor 22 and the dock |
| 5 | paste `Go in through the dock, wait for the 2 am round to pass, take the records room.`, then **Enter**, then **Start the run** | four steps, and the warning "Camera C2 sees you in the Dock Corridor on turn 12, on the way out." |

Notes:

- **Beat 4:** the Level Builder's run here is the recorded one. Say so: **"A
  deep agent built this level; this is its recorded run."**
- **Beat 5:** on the walk, the crew's reply was **Recorded**. With a live
  model it answers live, in its own words.

## Reset: `npm run demo:reset`

```sh
npm run demo:reset
```

It puts `data/levels/` back to the committed levels and writes a new demo
epoch. On its next page load, the browser drops:

- earlier run logs and crew plans;
- services forced to fixtures in the demo settings;
- the Run's view (first person) and play mode.

It needs no server restart. It doesn't touch the showcase level, which lives
in the server's memory.

## Demo machine checklist

**Setup, once:**

- [ ] **localhost only.** Open `http://localhost:<port>` (3000 unless `PORT`
      is set), never the network address. The Matterport SDK key allows only
      localhost.
- [ ] **`.env.local`** (gitignored; the values never leave the machine). The
      names, not the values, are:
  - `HEIST_MODE=live`, or the per-service `LLM_MODE`, `COSTAR_MODE`,
    `VEXCEL_MODE` and `NEXT_PUBLIC_MATTERPORT_MODE`;
  - the model: `ANTHROPIC_API_KEY`, or Bedrock's `LLM_PROVIDER`,
    `BEDROCK_ENABLED`, `AWS_REGION` and `BEDROCK_MODEL_ID`;
  - CoStar: `COSTAR_KIT_DIR`;
  - Matterport: `NEXT_PUBLIC_MATTERPORT_SDK_KEY`, plus `MATTERPORT_API_KEY`
    and `MATTERPORT_API_TOKEN` for the scan's mesh and panoramas (go only);
  - Vexcel: `VEXCEL_API_KEY`;
  - `SHOWCASE_LEVELS`, pairing the showcase building with `romaine-1974`.
- [ ] **Build after setting them.** `NEXT_PUBLIC_*` is fixed at build time:
      `npm ci`, then `npm run build`, then `npm start`. For go, build a
      `main` that has `feat/118-scan-join` merged.
- [ ] **Start the server at least 3 minutes before the pitch.** The showcase
      level builds when the server starts, which takes about 154 s. When it
      is done, the cast card's level line says it's built.
- [ ] **One browser window**: 1440×900, zoom 100%, notifications off,
      nothing on top of it. Keep it in front during every load.

**The last few minutes, in this order:**

- [ ] `npm run demo:reset`, then reload the browser on `/`. The reset needs
      that reload, so it comes first.
- [ ] **Go: open the showcase building's Run once.** The scan is about 233 MB,
      and this puts it in memory before the pitch.
  1. From the cast card's **Run** link, click **First person**.
  2. Wait until you can walk, then click **Restart**.
  3. Go back to `/` with the **Heist Anywhere** wordmark. Don't reload after
     this.

  If the Run opens mid-run on stage, click **Restart**.

  Live only, not walked here.
- [ ] **No-go: open the F1 Run tab.** In a second tab, open
      `/b/F1/run?m=romaine-1974` on the board. F1 has no scan, so a
      background tab is fine.
- [ ] **Open the Owner tab as the last tab.** It is
      `/b/F1/owner?m=romaine-1974`.
  1. Press **Shift+?** and switch **Model** to fixtures.
  2. Scroll the side panel to **Compare two setups**. A is "Demo: night
     shift" and B is "Demo: night shift, C2 moved".
  3. Click **Compare**. Check for **7 / 50**, **1 / 50** and **Recorded**.
  4. Press **Shift+?**, switch **Model** back, and press **Esc**.
  5. Check that the result is still there and the chip reads `LIVE`.

  Why: with a live model, Compare asks the model for new strategies, and the
  counts are no longer 7 and 1.
- [ ] **Put the order on the clipboard:**
      `In through the street lobby, straight to the files, and out the way we came.`
- [ ] **Back to the first tab, on `/`.** Check that the chip reads `LIVE`.

**Before the event:** one full rehearsal against a timer. Then reset and run
the last-minutes list again.

## The video

Q10, decided on status issue #1 at 23:10 UTC on 14 November: **the public demo
video doesn't show the scan.**

- It shows the run on F1, which is the no-go version of beat 6, in first
  person or on the board.
- Where this script plays the scan, the voice-over describes it instead.

That holds unless the CoStar crew says yes. Nothing from a scan or the kit goes
in the repo or the video's files.

## Open items

1. **Go needs `feat/118-scan-join` on `main`.** Until it merges, `main` offers
   first person only on fixture floors. #122's merge at 00:52 UTC added the
   scan renderer, not the join.
2. **#142, the crew's board fallback, is open.** Until it merges, beat 5's
   slow-model fallback on the showcase building is **Start the run** with the
   level's own plan.
3. **#144, open windows, is open.** Beat 8 leaves its number out.
4. **The crew's floor isn't the scan's floor.**
   - The level is staged on the floor that CoStar lists as vacant, and the scan
     is of a suite on another floor.
   - The live crew plans on the manifest's zones, so it can name a suite on
     the staged floor that the scan doesn't have. The board strikes that step
     out.
   - Beat 5's order asks for no wait, which avoided it on the walk.
   - The fix is #142's review finding M4: send the placed zones with the crew
     request. It has no ticket yet.
5. **Scout has no aerial on the showcase building.** Vexcel has no imagery for
   kit buildings, so the ways in come from rules.
6. **The showcase path was not walked for this script.** That covers the cast
   card, the real record, the scan, the live crew and the Chief. Esun4 walked
   it live three times before this was written. It plays end to end, and the
   run is lost by about turn 7.
7. **Not walked: forcing the Model in the demo settings, to prepare the Owner
   tab.** Fake mode locks the switch. Expect the result to stay on screen when
   you switch it back, since the page re-renders without a reload. The
   checklist checks it.
8. **Whether a reload keeps the warmed scan is not known.** So the checklist
   warms it after the reset's reload, and nothing reloads after that.
