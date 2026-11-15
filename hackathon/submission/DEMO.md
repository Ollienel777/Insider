# The demo script (2 minutes)

Tonight's plan. The demo plays `romaine-1974` on its showcase building, a real
building from the kit.

- **Beat 6 is decided: go.** The run plays in first person inside the
  building's own Matterport scan. First person on F1, the fixture building, is
  the marked fallback. The final call is a full rehearsal at about 05:00 UTC
  on 15 November (00:00 ET).
- **Owner Mode** gets 15 seconds after the Debrief (Q9, status issue #1).

Written against `main` at fd4ab35, at 04:31 UTC on 15 November.

- **What was walked:** on c08ae94, in fake mode (a production build with every
  service on `fake`, at 1440×900):
  - every F1 step;
  - first person on F1;
  - the kit-building screens, on the fictional test building
    (`HEIST_TEST_KIT=1`).
- **What changed since:** #142 and #144 merged after the walk. The screens they
  changed (beat 5's slow-model plan, and beat 8's open windows) are quoted from
  `main`'s code and smoke tests, not walked.
- **What needs keys:** none were used here, so every step that needs live
  CoStar, Matterport or a model says **live only, not walked here**.

## On stage

- One presenter. A judge picks the mission (beat 1) and makes the fatal move
  (beat 6).
- **Say only what the screen shows.** The chip top right reads `LIVE` or
  `FIXTURES`. A **Recorded**, **Rule-based** or **No crew reply** tag means no
  model wrote that answer. Never narrate one of those as live.
- The showcase building is real, so read its name off the cast card; this
  file doesn't name it. The guards, cameras and locks in it are game fiction.
  Beat 4 says so.
- **Never reload a showcase-building page.** Its crew plan and run log live
  in the tab's memory only, so a reload empties the Debrief. Move with the
  step rail and the buttons.
- **Keep the window in front, and its tab active, while a page loads.** A
  hidden or background tab drops the scan to the fixture floor. Since #159 it
  says so: "The Matterport scan's viewer didn't start (the window was hidden),
  so the board uses the fixture floor."
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
| 6 | Run, in the real scan | 1:00–1:28 | 28 s | Run |
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

It names the way in and the objective, and asks for no wait, so the crew has
no reason to stop in a suite (Open items, 3).

1. Click the **Your order** box, paste, and press **Enter**.
2. While the crew answers, click camera **C1** on the board. Its Why card
   opens. Say: **"Every guard, camera and lock says which data put it
   there."** Press **Esc**.
3. The crew's plan appears, checked on the board. A live reply carries no
   tag. Click **Start the run** at once, in this same window. Run is playable
   in about 1 s, because Plan has already started the scan and its board, and
   Run takes them (#181; Open items, 1). Say the Plan line over it: **"The
   crew answers in plain English, and the board checks its plan."**

Fallbacks:

- **A step is struck through**, with "Dropped step N: …" under the plan. Say:
  **"That step isn't on this board, so the board drops it."** Click **Start
  the run**.
- **The model is slow.** A kit building has no recorded reply, so the board
  works out a plan instead (#142, merged). It arrives headed **The board's
  plan**, with the chip **No crew reply**. Say: **"The model was slow, so the
  board worked out this plan, with no model."** Click **Start the run**.
- **"The crew didn't answer"**, with **Retry**: the server couldn't plan at
  all. Click **Start the run**; the Run carries the level's own plan. Say:
  **"The level carries a plan of its own."**

Walked here:

- the Why card on the Plan board (F1 and the test building);
- the Run's own four-step plan on the test building with no crew plan.

Not walked here:

- #142's board plan, which merged after the walk;
- this order to the live crew (live only).

## Beat 6 · 1:00–1:28 · Run, in the real scan

**Decided: go.** Nelson called it at the go/no-go. The run plays in first
person inside the showcase building's own scan. First person on F1 is the
marked fallback below, not a second version. The final call is a full
rehearsal at about 05:00 UTC.

**First person on a live scan is on `main`:** #157 merged at 03:41 UTC. The
beat below is written as it plays with the fixes still open before the 05:00
rehearsal (Open items, 1), mainly #181. Each has a one-line fallback for if it
isn't in, or fails on stage.

Live only, not walked here.

Screen: the Run, labelled **Real CoStar record · real Matterport scan**. It is
playable in about 1 s, because Plan already started the scan and its board
(#181; checklist). If the scan's mesh is still coming, the player waits for
the picture around them: at most 12 s once the mesh is in.

1. Check that the label says **real Matterport scan**.
2. If the Run didn't open in first person, click **First person** (top right,
   under the scan stage's header). Wait for the loading line to clear: it
   says "Loading the building", then "Loading the picture around you".
3. Click the view once: mouse look starts only after that click. The pill
   says "Look around. The clock starts when you move." (#174), so nothing moves
   until the judge does.
4. Hand the judge the keyboard and mouse. Say: **"You're in the real building,
   its own scan. W to move, the mouse to look. That light is Camera C1: step
   into it and see what happens."** Don't promise a win. W runs by default,
   and Shift walks.
5. The cameras are visible (#181). Each is a housing on an arm, with a light
   cone to the floor it watches, and that floor is painted. An outline shows
   where it looks next. Steer the judge away from the corridor door where the
   picture tears (Open items, 2).
6. Camera C1 sees them. The alarm goes to **Alert**, then **Lockdown**, and
   the Chief's re-plan streams onto the radio line. Say: **"C1 has you. The AI
   security chief re-plans, live, and you can read why. The guards follow its
   orders."**

   Don't promise which stretch Camera C1 watches: #179 may move the cameras
   (Open items, 1). Point at its light wherever it is.
7. The guards close in, and the run ends in a capture. The capture is the
   beat: the alarm and the Chief's re-plan are the wow. The view stops taking
   input and frees the mouse. A card says "Caught in the Corridor." with who
   saw the player and who reached them, and **See the debrief** (#181). Say:
   **"Caught. The debrief shows how."**
8. Click **See the debrief** on the card.

Nobody has won this level on the scan. If the judge gets out, say: **"You beat
the Chief. The debrief shows how."**

Fallbacks, one per fix and one per known rough edge:

- **Run is slow to open** (about 13 s without #181). Fill it: **"Every guard,
  camera and lock in there comes from a rule on its CoStar record."**
- **The cameras don't show** (#181 isn't in). Point at the HUD's alarm. Say:
  **"The cameras are game fiction too. The alarm says when one has you."**
- **The suspicion meter isn't there** (#150 isn't in). Read the HUD's alarm
  instead (Calm → Alert).
- **The Chief's live reply doesn't arrive.** A recorded reply stands in, with
  the toast "The model didn't answer in time, so a recorded reply stands in."
  Say: **"The model was slow, so a recorded reply stands in. The guards never
  wait for it."**
- **The Chief's lines still say "Area 1"** (#173 isn't in). Don't read the
  room names out. Say only that it re-plans.
- **The judge tries one of the scan's own doors.** Say: **"Those are the
  scan's real doors. The mission's one door is at the files."**
- **The picture tears.** Say: **"That's where two panoramas meet."** Keep
  walking.
- **The board shows "Loading the scan".** After 15 s it offers **Use the
  stand-in floor plan** (#155). Don't take that before 30 s: the board waits
  that long for a scan's rooms (#143). After 30 s, use the F1 fallback below.
- **The label says stand-in floor plan.** The page fell back to the fixture
  floor, and first person still plays on it. Say: **"The scan didn't load, so
  this is the stand-in floor plan."**
- **First person is refused, or the beat can't run at all.** Use the F1
  fallback below.

### Fallback: first person on F1, or the Tactical board

Use this when the scan beat can't run: the 05:00 rehearsal says so, or first
person on the scan fails on stage.

On `main` (PRs #119 and #138). Walked here. The run moves to Halvorsen Tower
(F1), the fixture building, open in its own tab (checklist).

1. Click the **F1 Run tab**. Say: **"Tonight's run is on our hand-built floor,
   a fixture building."**
2. Click **First person**. It was ready in 1.8 s on the walk.
3. Click the view once, so the mouse looks, then hand over. Say: **"W to move,
   the mouse to look. Through the lobby, then left, down the dock
   corridor."**
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
- A, "Demo: night shift": **7 / 50**, "43% watched · 40/80 open";
- B, "Demo: night shift, C2 moved": **1 / 50**, "50% watched · 20/80 open";
- "C2 moved from the Freight Lift Lobby to the Dock Corridor";
- "7 → 1 of 50: 6 fewer got out.";
- "Coverage 43% → 50%, open windows 40 of 80 → 20 of 80."

1. Click the **Owner tab**.
2. Say: **"And for the owner: their own security, here made up. Fifty AI
   break-ins: seven get out. Move camera C2: coverage 43 to 50 percent, open
   windows 40 to 20 of 80, and one in fifty."**
3. If time allows, click **Show on the board** under B. C2 is ringed, as what
   noticed the crew first most often.

Fallback: the tab lost its result, because it was reloaded.

1. Scroll the side panel to **Compare two setups**. It starts on the prepared
   pair.
2. Click **Compare**.

Coverage and open windows come from the floor plan, so they hold. The counts 7
and 1 come from the crew's recorded strategies. With a live model, read the
counts off the screen.

Walked here in fake mode, on c08ae94: Compare in 0.4 s, 7 / 50 → 1 / 50,
coverage 43% → 50%, and C2 ringed on B. The open windows came with #144 after
the walk. Their numbers are from `main`'s owner smoke test.

Not walked: forcing the Model in the checklist, because fake mode locks that
switch.

## If the showcase building is out: the F1 path

Use this when the cast card is missing or its level isn't built. Everything
is on F1, Halvorsen Tower, and every step was walked here. Beats 1, 7 and 8
are unchanged, and beat 6 is its F1 fallback, played in this tab.

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
- [ ] **`.env.local`** (gitignored; the values never leave the machine). Names
      only, except the two values given here:
  - `HEIST_MODE=live`, or the per-service `LLM_MODE`, `COSTAR_MODE`,
    `VEXCEL_MODE` and `NEXT_PUBLIC_MATTERPORT_MODE`;
  - the model, on the Anthropic API:
    - `ANTHROPIC_API_KEY`;
    - `ANTHROPIC_MODEL_FAST=claude-haiku-5-5`, the bare id, exactly that, for
      the crew and the Chief (Nelson's call, after #165);
    - `ANTHROPIC_MODEL_BUILDER`, left as it is.

    Leave `LLM_PROVIDER` unset, or `anthropic`, and Bedrock off. #165's review
    found Claude 5 on Bedrock answers nothing.
  - CoStar: `COSTAR_KIT_DIR`;
  - Matterport: `NEXT_PUBLIC_MATTERPORT_SDK_KEY`, plus `MATTERPORT_API_KEY`
    and `MATTERPORT_API_TOKEN` for the scan's mesh and panoramas;
  - Vexcel: `VEXCEL_API_KEY`;
  - `SHOWCASE_LEVELS`, pairing the showcase building with `romaine-1974`.
    The showcase building comes through this, so
    `NEXT_PUBLIC_MATTERPORT_MODEL_OVERRIDE` must be **empty** on the demo
    machine.
- [ ] **Build after setting them.** `NEXT_PUBLIC_*` is fixed at build time:
      `npm ci`, then `npm run build`, then `npm start`. Build a `main` that
      has #157 (`feat/118-scan-join`) merged.
- [ ] **Start the server at least 3 minutes before the pitch.** The showcase
      level builds when the server starts, which takes about 154 s. When it
      is done, the cast card's level line says it's built.
- [ ] **One browser window**: 1440×900, zoom 100%, notifications off,
      nothing on top of it. Keep it in front during every load.

**The last few minutes, in this order:**

- [ ] `npm run demo:reset`, then reload the browser on `/`. The reset needs
      that reload, so it comes first.
- [ ] **Open the F1 fallback tab.** In a second tab, open
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
- [ ] **Last: back to the first tab, and load the scan from Plan.** Do this
      last, because switching tabs hides the window and pauses a scan's load
      (#159).
  1. Check that the chip reads `LIVE`.
  2. In this window, in front, open the showcase building's **Plan** from the
     cast card's **Plan** link. Plan starts the scan and its board.
  3. Leave it there, with the window in front, until the pitch.
  4. To start beat 1, go to `/` with the **Heist Anywhere** wordmark. That
     isn't a reload, so the scan survives it. A reload lets the scan go.

  **This needs #181**, which keeps one scan and one board per tab. Without
  it, the scan starts loading when Run opens, in beat 5's step 3.

  Check at the 05:00 UTC rehearsal: time a cold load from Plan, so you know
  how early to open it.

  Live only, not walked here.

**Before the event:** one full rehearsal against a timer. Then reset and run
the last-minutes list again.

## The video

Q10, decided on status issue #1 at 23:10 UTC on 14 November: **the public demo
video doesn't show the scan.**

- It shows the run on F1, which is beat 6's F1 fallback, in first person or
  on the board.
- Where this script plays the scan, the voice-over describes it instead.

That holds unless the CoStar crew says yes. Nothing from a scan or the kit goes
in the repo or the video's files.

## Open items

1. **Fixes still open before the 05:00 UTC rehearsal** (as of 04:31 UTC). Beat
   6 is written as it plays with them, and each has its one-line fallback
   there.
   - **#181**:
     - visible cameras, each with a light cone, its floor painted, and an
       outline of where it looks next;
     - the end card, with **See the debrief**;
     - one scan and one board per tab, started from Plan, so Run is playable
       in about 1 s.
   - **#179**: cameras and guard rounds on a scan floor leave the only route's
     corridor passable. It may move the cameras, so beat 6 doesn't promise
     which stretch Camera C1 watches.
   - **#173**: the Chief's real room names, and a Chief call let finish.
   - **#150**: the suspicion meter.

   Rewalk beat 6 at the rehearsal, and change its lines where the screen
   says otherwise.
2. **The walk route.** Esun4's walk report on #157 says the picture tears at
   one corridor door, but doesn't say which. Pin the route at the rehearsal,
   and write here the door to steer the judge away from.
3. **The live crew can name a zone the board doesn't have.** It plans on the
   manifest's zones, not the placed board's, and the board strikes such a
   step out.
   - Beat 5's order asks for no wait, which avoids it.
   - The fix is #142's review finding M4: send the placed zones with the crew
     request. It has no ticket yet.
4. **Scout has no aerial on the showcase building.** Vexcel has no imagery for
   kit buildings, so the ways in come from rules.
5. **The showcase path was not walked for this script.** That covers the cast
   card, the real record, the scan, the live crew and the Chief, because no
   keys were used here. Esun4's live walks are reported on #157.
6. **Not walked: forcing the Model in the demo settings, to prepare the Owner
   tab.** Fake mode locks the switch. Expect the result to stay on screen when
   you switch it back, since the page re-renders without a reload. The
   checklist checks it.
