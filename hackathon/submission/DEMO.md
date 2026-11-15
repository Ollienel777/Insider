# Hobbs: the demo script (2 minutes)

The product is **Hobbs**; #183 renamed it from Heist Anywhere. The demo plays
`romaine-1974` on its showcase building, a real building from the kit.

- **Beat 6 is a GO.** The run plays in first person inside the building's own
  Matterport scan. The full rehearsal confirmed it, at about 05:00 UTC on 15
  November, on `main`, all live, in a production build with the demo env. Its
  findings are written into beats 3 to 7. First person on F1, the fixture
  building, is the marked fallback. On the night, the checklist's
  [go / no-go rule](#go--no-go-decided-before-the-pitch) still checks this
  machine, never on stage.
- **Owner Mode** gets its own beat after the Debrief (Q9, decided on status
  issue #1), trimmed to 10 s.

Written against `main` as of about 09:30 UTC on 15 November, after #167 (the
numbered tabs), #192, #193 (no Shift walk) and #201. These still have to land
before the rehearsal; re-check the lines they touch then:

- #202, the scan floor fill;
- #195, the Hobbs header and page titles;
- #206, Owner Mode on the showcase building. Beat 8 plays on it, with F1's
  prepared pair as the fallback.

## Pitches per judging table

Each table scores different things, so each gets its own 2-minute cue card.
They reuse this file's beats by number. This file stays the home for the
setup, the fallbacks, the checklist and each beat's detail.

| table | pitch | what changes from this script |
|---|---|---|
| Entertainment, our main track, and Best Overall | [`pitches/entertainment.md`](pitches/entertainment.md) | The story leads, and the data stays light. Charity comes from the `prevent` missions and Owner Mode. |
| CoStar, "AI for the Built World" | [`pitches/costar.md`](pitches/costar.md) | All three layers are named. Owner Mode gets 30 s. No Debrief. |
| LangChain, "Best use of deepagents" | [`pitches/langchain.md`](pitches/langchain.md) | The two agents' traces, with a prepared F1 Dossier tab for their payloads. No crew order, Debrief or Owner Mode. |
| Amazon, "Best Practical AI Innovation" (optional) | [`pitches/amazon.md`](pitches/amazon.md) | Owner Mode first. The Chief adapts within a run, and between runs on F1, which needs one F1 run played after the reset. No beats 1–4 or 7. |

Before each table, run the checklist's
[last few minutes](#demo-machine-checklist) again, starting with the reset,
plus that pitch's own additions. The cue card below is the general pitch.

## Cue card

One line per beat. The detail and the fallbacks are in the beats below.
Brackets are read off the screen, or off the printed answer key, which stays
out of this public repo.

| # | at | click | say | if it breaks |
|---|---|---|---|---|
| 1 | 0:00 | Judge: **The Romaine Street Papers** (open by default), then **Take the job** | "This is Hobbs. Every heist in history needed a building. Our agent finds one that's empty tonight. Pick a heist." | Click Romaine yourself, then **Take the job**. |
| 2 | 0:10 | Point at the showcase card, then **Scout it** | "The agent searches CoStar's inventory for this heist: the right era and class, a floor on the market tonight, a 3D scan. For this mission, a real building: [name]. Each row checks it against a need, from its CoStar record." | Slow: **Skip**. No card, or not built: the F1 path. |
| 3 | 0:30 | **Plan the job** | "The building from above, from Vexcel." | No aerial: "No aerial for this one yet." Then **Plan the job**. |
| 4 | 0:33 | **Brief the crew** | "Its real CoStar record. A deep agent built the level from it: built [year], so key locks and sweeping cameras. Class [X]: [N] guards. Its vacant floor is the stage. The security is game fiction." | Stalls: **Skip**. |
| 5 | 0:47 | Paste the order, **Enter**. Click a camera on the board, then **Esc**. **Start the run** as the plan shows | "Every guard, camera and lock says which data put it there." Then: "The crew answers in plain English, and the board checks its plan." | **No crew reply**: "The model was slow, so the board worked out this plan, with no model." Greyed order box: the F1 tab. |
| 6 | 1:00 | Click the view once; hand over. **See the debrief** on the end card | "You're in the real building, its own scan. W to move, the mouse to look, hold E at a door. That light is a camera: stand in it for a second." At the alarm: "That camera has you. The Chief is re-planning live: watch the guards converge on you. Keep going, towards the guards." At the catch: "Caught. The debrief shows how." | No capture by **1:30**: "The Chief is still hunting you. Here's the replay." Then tab **7 Debrief**. Scan fails: the F1 tab. |
| 7 | 1:30 | Drag **Turn**; point at the Chief's decisions | "The debrief replays every move. And here's why: every decision the Chief made, with its reason. And that search, era, class, a floor on the market tonight, is the one a location scout runs on Monday, on CoStar's own availability." | "No run yet": "The debrief replays the run turn by turn; you just saw how it ended." |
| 8 | 1:45 | The **last browser tab**, the Owner tab you prepared (not the app's tab 8) | Showcase (#206): "And for the owner, a made-up setup: turn one camera, and its open windows drop from [before] to [after]." (figures on the printed note) F1's pair instead: "And for the owner: their own security, here made up. Seven get out; move C2, one in fifty." | Result gone: scroll to **Compare two setups**, then **Compare**. On the showcase, fill its 4.2 s: "The crew tries fifty ways in, on each." |

Ends at **1:55**, with 5 s spare for beat 5's crew reply, which wasn't
measured live.

- **What was walked:** on c08ae94, in fake mode (a production build with every
  service on `fake`, at 1440×900):
  - every F1 step;
  - first person on F1, as it played then;
  - the kit-building screens, on the fictional test building
    (`HEIST_TEST_KIT=1`).
- **What changed since:** these merged after the walk. Their screens are
  quoted from `main`'s code and smoke tests, not walked:
  - #142: the board's own plan when the crew has no reply ("The board's plan",
    chip **No crew reply**);
  - #143: the board waits up to 30 s for a scan's rooms;
  - #144 and #170: open windows in Owner Mode;
  - #155: "Loading the scan", with **Use the stand-in floor plan** after 15 s;
  - #157: first person on a live scan;
  - #159: a hidden tab pauses a scan's load and says so;
  - #174: the clock starts when the player moves;
  - #181: the cameras drawn in first person, the end card, and one scan per
    tab, started from Plan;
  - #179: cameras and rounds on a scan floor leave the route passable;
  - #150: first person in real time, the controls card, a readable HUD and the
    suspicion meter;
  - #178: a live aerial on kit buildings (beat 3);
  - #183 and #167: the product is "Hobbs", in the prompts, the README, the
    wordmark and the page title;
  - #173: the Chief uses the scan's real room names;
  - #167: the screens as a case file, with numbered tabs (1 Missions, 2 Cast,
    3 Scout, 4 Dossier, 5 Plan, 6 Run, 7 Debrief, 8 Owner Mode). A tab past
    the one reached is locked, except that Run also opens Debrief;
  - #193: first person drops the Shift walk.
- **What needs keys:** none were used here, so every step that needs live
  CoStar, Matterport, Vexcel or a model says **live only, not walked here**.

## On stage

- One presenter. A judge picks the mission (beat 1) and makes the fatal move
  (beat 6).
- **Say only what the screen shows.** The chip top right reads `LIVE` or
  `FIXTURES`. A **Recorded**, **Rule-based** or **No crew reply** tag means no
  model wrote that answer. Never narrate one of those as live.
- The showcase building is real, so read its name off the cast card; this
  file doesn't name it. The guards, cameras and locks in it are game fiction.
  Beat 4 says so.
- **The play mode stays on Tactical**, its default, throughout. Its switch
  (**Tactical** / **Live**) is at the bottom right of the Run board, and
  doesn't show in first person. Never click **Live**.
- **Do not reload the showcase page.** Its crew plan and run log live in the
  tab's memory only, so a reload empties the Debrief. **Plan, Run and Debrief
  happen in ONE browser tab; do not switch browser tabs or reload between
  them.** Move with the app's numbered tab row and the buttons, with a plain
  click. If the Run's label says **stand-in floor plan**, don't reload and
  don't wait: switch to the prepared F1 browser tab (beat 6's fallback).
- **Two kinds of tab.** The app's tab row (1 Missions … 8 Owner Mode) is not
  the browser's tabs. The F1 tab and the Owner tab in this script are browser
  tabs, prepared before the pitch.
- **Keep the window in front, and its tab active, while a page loads.** A
  hidden tab pauses a scan's load. If the load still fails, the board drops to
  the fixture floor, with this toast: "The Matterport scan's viewer didn't
  start (the window was hidden), so the board uses the fixture floor. Open it
  again with the window in front to load the scan." On stage, the rule above
  wins over the toast: don't open it again, switch to the F1 tab.
- On the board, never press **S**: it arms a sprint, and the numbers then mark
  rooms two hops away.
- If a beat breaks, say its fallback line, do its fallback click, move on.

## The clock

| # | beat | time | length | screen |
|---|---|---|---|---|
| 1 | Missions | 0:00–0:10 | 10 s | `/` |
| 2 | Cast | 0:10–0:30 | 20 s | `/m/romaine-1974/cast` |
| 3 | Scout | 0:30–0:33 | 3 s | Scout |
| 4 | Dossier | 0:33–0:47 | 14 s | Dossier |
| 5 | Plan | 0:47–1:00 | 13 s | Plan |
| 6 | Run, in the real scan | 1:00–1:30 | 30 s, cut at 1:30 | Run |
| 7 | Debrief | 1:30–1:45 | 15 s | Debrief |
| 8 | Owner Mode | 1:45–1:55 | 10 s | the Owner browser tab |

**1:55**, with 5 s spare for beat 5's live crew reply, which wasn't measured.
The clock has no room for a wait: the scan is loaded before the pitch
(checklist), and a pitch that would have to wait runs the F1 path instead.
Against SPEC §2's slots, Owner Mode's 10 s and the 5 s spare come from:

- Scout: 10 s → 3 s.
- Debrief: 20 s → 15 s.
- Cast: 22 s → 20 s.
- Dossier: 15 s → 14 s.

The run keeps its 30 s, and is cut at 1:30, caught or not.

The spoken lines are sized at about 2.5 words a second. Rehearse once against
a timer, and cut words, not beats.

The machine's waits, measured on the fake walk:

| wait | time |
|---|---|
| the cast replay | 7.8 s |
| the Dossier replay | 5.6 s |
| Owner Mode's Compare | 0.4 s |

Live waits were not measured here: the crew's reply, the Chief's re-plan, the
scan's load, and first person since it went real time (#150). The rehearsal
measured the run beat, live:

| what | time |
|---|---|
| Run playable | 1.2–2.3 s after **Start the run** |
| the first camera's label in sight | about 2 s after **Start the run** |
| the alarm | 3–6 s after **Start the run**, with the judge moving at once |
| the Chief's first line | 2.5–5.7 s after the alarm |
| a capture, walking on towards the guards | 15–31 s after the alarm |

The clock starts on the judge's first move (#174), so the alarm row includes
any time the judge spends looking around first. The last two rows were
re-timed on `main` at about 06:00 UTC.

## What the judge should notice

The judging criteria (`hackathon/EVENT.md`): creativity, utility, charity and
avidity; and CoStar's own, 30% data use, 30% agentic depth, 25% usefulness and
15% demo and polish.

- **Beat 2, Cast:** utility and CoStar usefulness. An agent runs a real
  location search over CoStar's inventory.
- **Beat 4, Dossier:** CoStar data use and agentic depth. Each row of the
  level traces to a field of the record.
- **Beat 5, Plan:** agentic depth. The crew answers a plain-English order, and
  the board checks it.
- **Beat 6, Run:** creativity, and agentic depth. The building is its own scan,
  and the Chief re-plans live as the guards converge.
- **Beat 7, Debrief:** agentic depth, as the Chief's decisions are listed with
  their reasons; and CoStar usefulness, through the Monday line.
- **Beat 8, Owner Mode:** utility for the owner. The judge sees a before and
  after on their own security.
- **Throughout:** avidity and polish, shown by a run that doesn't stall.

Charity isn't argued by this mission, a heist. Don't stretch a beat to claim
it.

## Beat 1 · 0:00–0:10 · Missions

Screen: **Pick a mission**, the case file: one tab per job, and **The Romaine
Street Papers** (the Summa Corporation burglary, 1974) is open by default.

1. Say: **"This is Hobbs. Every heist in history needed a building. Our agent
   finds one that's empty tonight. Pick a heist."**
2. The judge clicks **The Romaine Street Papers** tab, then the **Take the
   job** stamp. Clicking a job's tab only opens its page; **Take the job**
   opens Cast. Point at both if they hesitate.

Fallback: if the judge opens another job, click **The Romaine Street Papers**
tab yourself, then **Take the job**. No Back button is needed. Say:
**"Tonight's building is cast for this one."**

Walked here.

## Beat 2 · 0:10–0:30 · Cast

Screen: the Casting Director's replay, about 8 s: its todos, and the funnel
narrowing filter by filter beside the map. In live mode (PR #124), a card
headed **Cast · this mission's showcase building** sits above the funnel's
finalists, which fold into a closed list under it. The card shows:

- the building's CoStar facts;
- "Picked from the showcase list · fits N of 7 of the mission's needs";
- one row per need, the building's value beside what the mission needs;
- a line saying where its level stands.

This card is the real building the run uses. Its pick line reads "Showcase ·
CoStar record", then the name; since #185 it shows no record id.

1. While the funnel narrows, say: **"The agent searches CoStar's inventory
   for this heist: the right era and class, a floor on the market tonight, a
   3D scan."**
2. When the card shows, point at it. Say: **"For this mission, a real
   building: [its name, off the card]. Each row checks it against a need,
   from its CoStar record."**
3. Check that the card's level line says "Its level is built: Plan and Run are
   ready."
4. Click **Scout it**. The showcase building is already picked.

Fallbacks:

- The replay is slow: click **Skip**, which shows everything at once.
- No showcase card, or its level isn't built: see
  [If the showcase building is out](#if-the-showcase-building-is-out-the-f1-path).
  This happens when the chip says CoStar is on fixtures, or the level is still
  building. The go / no-go check catches both before the pitch.

Live only, not walked here: the showcase card. What was walked: the fixture
replay (61 → 3 on the fixture inventory), **Finalist 1 · F1 Halvorsen Tower**,
**Scout it**.

## Beat 3 · 0:30–0:33 · Scout

Screen: a live Vexcel aerial of the building (#178), aimed from its CoStar
facts; its height shows with a `~`, as an estimate. The rehearsal showed it.
Under **Ways in**, the aerial tags no entries: "No entries are tagged for this
building: nothing in its CoStar facts marks a dock or a door. A level built
for it offers the roof hatch and the street lobby, which every office
building has."

1. Say: **"The building from above, from Vexcel."** Click **Plan the job**.

Fallbacks:

- **A No aerial card shows instead**, "Vexcel has no imagery for this
  building yet.". Say: **"No aerial for this one yet."** Click **Plan the
  job**.
- **The aerial hangs.** Click **Plan the job** anyway; it doesn't wait for
  the aerial. Tab 4, Dossier, is locked from Scout ("Finish Scout first").

Walked here on the fictional test building: the **No aerial** card only. The
live aerial is live only, not walked here.

## Beat 4 · 0:33–0:47 · Dossier

Screen: the label **Real CoStar record** (PR #111). Beside it, the Level
Builder's run replays (about 6 s) and fills the **Data → Level** table. On the
showcase building it has three rows, as the rehearsal found:

| CoStar field | what it sets |
|---|---|
| year built | the era: "Analog era: key locks, sweeping CCTV" |
| building class | the guard force: "[N] guards, tight rounds" |
| available space | the floor the level is staged on: "Staged on [floor]; its [N] free suites are quiet zones" (#185) |

The mission briefing follows.

1. As the rows fill, read the three off the table. Say: **"Its real CoStar
   record. A deep agent built the level from it: built [year], so key locks
   and sweeping cameras. Class [X]: [N] guards. Its vacant floor is the
   stage. The security is game fiction."**
2. Click **Brief the crew**.

Fallbacks:

- The replay stalls: click **Skip**. Say: **"Here's the finished level."**
- The Dossier offers to build the level: don't. A build takes minutes. Go to
  [the F1 path](#if-the-showcase-building-is-out-the-f1-path).

Walked here on the fictional test building: the label and its rows (it also
has a fourth row, for the crowded zone). The showcase building's three rows
are live only, as the rehearsal found them.

## Beat 5 · 0:47–1:00 · Plan

Screen: the Plan board and the order box, **Your order**. The board is
already drawn: the checklist loaded this page before the pitch. The order is
on the clipboard (checklist):

`Go in by the roof hatch, straight to the files, and out the way we came.`

The run starts at the roof hatch, so the order names it, and the crew's plan
and the run agree. At the rehearsal, an order naming the street lobby got a
plan beginning "Enter through the street lobby", for a run that started at
the roof hatch. The order also asks for no wait, so the crew should have no
reason to stop in a suite. That is untested live (Open items, 2).

1. Click the **Your order** box, paste, and press **Enter**.
2. While the crew answers, click a camera on the board. Its Why card opens. Say: **"Every guard, camera and lock says which data put it
   there."** Press **Esc**.
3. The crew's plan appears, headed **The crew's plan** and checked on the
   board. A live reply carries no tag. Say: **"The crew answers in plain
   English, and the board checks its plan."** Click **Start the run** at once,
   in this same tab. Plan has already started the scan, and Run takes it
   (#181). At the rehearsal, Run was playable 1.2–2.3 s later.

Fallbacks:

- **The order box is greyed out**: the board hasn't loaded, so the box takes
  no typing. Don't wait. Switch to the prepared F1 tab, and play the rest on
  F1 (beat 6's fallback, then beats 7 and 8).
- **A step is struck through**, with "Dropped step N: … is not a zone on this
  floor." under the plan. Say: **"That step isn't on this board, so the board
  drops it."** Click **Start the run**.
- **The model is slow.** A kit building has no recorded reply, so the board
  works out a plan instead (#142). It arrives headed **The board's plan**, with
  the chip **No crew reply**, and the toast "The model didn't answer in time,
  so the plan is worked out from the board." Say: **"The model was slow, so
  the board worked out this plan, with no model."** Click **Start the run**.
- **The same chip in fake mode.** If the chip's hover begins "Fake mode: no
  model was called.", the model was never asked. Say: **"The model is off for
  this run, so the board worked out this plan itself."** Click **Start the
  run**.
- **"The crew didn't answer"**, with **Retry**: the server couldn't plan at
  all. Click **Start the run**; the Run carries the level's own plan. Say:
  **"The level carries a plan of its own."**

Walked here:

- the Why card on the Plan board (F1 and the test building);
- the Run's own four-step plan on the test building with no crew plan.

Not walked here:

- #142's board plan, which merged after the walk;
- this order to the live crew (live only).

## Beat 6 · 1:00–1:30 · Run, in the real scan

**A GO** at the rehearsal, and on the night if the checklist's go / no-go
passed. The run plays in first person inside the showcase building's own scan.
First person on F1 is the marked fallback below, not a second version.

On `main` (#157, #174, #181, #179, #150, #173). Live only, not walked here.
The timings below are the rehearsal's.

Screen: the Run, labelled **Real CoStar record · real Matterport scan**. In
first person, a note top left says "The building is the real scan. Security
shown is game fiction."

1. Check that the label says **real Matterport scan**.
2. The Run opens in first person, its default (`DEFAULT_RUN_VIEW` in
   `view-store.ts`), playable 1.2–2.3 s after **Start the run**. If a loading
   line shows, wait for it to clear. It runs, in order: "Asking for the
   scan", "Downloading the building", "Building the walls and floor", then
   "Loading the picture around you". If it opens on the board, click **First
   person**: the right button of the **Board** / **First person** pair, at the
   top left of the board, under the scan stage's header.
3. Click the view once: mouse look starts only after that click. The radio
   opens with "You're in at the roof hatch. W to walk, the mouse to look."
   (#185). The pill says "Look around. The clock starts when you move.", so
   nothing moves until the judge does. A controls card at the left lists the
   keys; it fades once the judge has walked and looked around.
4. Hand the judge the keyboard and mouse. Say: **"You're in the real building,
   its own scan. W to move, the mouse to look, hold E at a door. That light is
   a camera: stand in it for a second."** Don't promise a win.
5. Tell the judge, if they need it: **W A S D** move, the arrow keys turn,
   **hold E** at a locked door to pick it and at the files to take them, **P**
   pauses, and **Esc** frees the mouse. The same keys are on the line at the
   bottom of the view.
6. The cameras are visible: each has a light cone to the floor it watches.
   At the rehearsal, the first camera's label was in sight about 2 s in. Which
   camera to stand in, and where, is on the printed answer key (below).
   - The judge stands in its light. The suspicion meter reads "Next to
     [camera]'s sight", then "[camera] has you in view", then "[camera] saw
     you".
   - The alarm goes to **Alert** on the first turn in sight, and to
     **Lockdown** only on a second one: each turn in sight raises it one step
     (`alarm.ts`). A turn is 0.7 s, so "a second" in the light is enough. A
     judge who steps straight through gets Alert, which calms after 3 turns
     unseen.
   - The Chief's first line comes 2.5–5.7 s after the alarm.
   - At **Lockdown**, the radio mostly repeats a short line about where the
     player was last seen, and rarely reads the Chief's orders (#190, left for
     after the freeze). That line is written by the model, so its words vary.
     The orders still apply: the guards converge, and the Debrief lists every
     decision.

   Narrate the re-plan; don't wait for the radio to read it. Say: **"That
   camera has you. The Chief is re-planning live: watch the guards converge on
   you."** The "read why" moment is the Debrief's list of decisions (beat 7).
7. **Steer, because the capture isn't certain within the beat.** As soon as
   the alarm goes, say: **"Keep going, towards the guards."** The answer key
   says which way that is.
   - On `main`, walks that kept heading for the guards were caught 15–31 s
     after the alarm.
   - At the rehearsal, two walks that stopped after the alarm weren't caught
     in 54 turns, because the alarm calmed down.

   On those timings the capture lands between about 1:18 and 1:37. **Cut at
   1:30, caught or not** (fallbacks below). That is this beat's end, so the
   clock holds.
8. The guards close in, and the run ends in a capture. The capture is the
   beat: the alarm and the Chief's re-plan are the wow. The view stops taking
   input and frees the mouse. A card says **Run over**, "Caught in the
   [room].", who saw the player and who reached them, and **See the debrief**.
   Say: **"Caught. The debrief shows how."**
9. Click **See the debrief** on the card.

Nobody has won this level on the scan. If the judge gets out, the card says
"Out with the files.". Say: **"You beat the Chief. The debrief shows how."**

Fallbacks:

- **Run is slow to open.** Fill it: **"Every guard, camera and lock in there
  comes from a rule on its CoStar record."** If the board still shows "Loading
  the scan", switch to the F1 tab.
- **The judge stops after the alarm,** and the alarm starts to calm. Say:
  **"Keep moving. The guards are coming."**
- **No capture by 1:30**, for any reason. Say **"The Chief is still hunting
  you. Here's the replay."** and click tab **7, Debrief**, in the app's tab
  row. Run unlocks that tab (`reachedIndex` in `step-rail-view.tsx`). The
  Debrief shows a run still in progress (`main` handles a playing run; not
  walked here), with the Chief's decisions so far for beat 7.
- **The judge can't pick the lock or take the files.** Say: **"Hold E right at
  it."** If it still won't go, steer them into a camera's light: the capture
  ends the run, and its card has **See the debrief**.
- **The Chief's first line is late.** On current `main` it comes 2.5–5.7 s
  after the alarm; before #173 it took 1.2–14 s. Keep narrating the guards
  meanwhile. If a recorded or rule-based reply stands in, the toast says "The
  model didn't answer in time, so a recorded reply stands in." Say: **"The
  model was slow, so a stand-in reply takes over. The guards never wait for
  it."**
- **The judge tries one of the scan's own doors.** Say: **"Those are the
  scan's real doors. The mission's one door is at the files."**
- **The picture tears.** Say: **"That's where two panoramas meet."** Keep
  walking.
- **The label says stand-in floor plan.** The page fell back to the fixture
  floor. Don't reload. Switch to the F1 tab.
- **First person is refused** ("First person needs WebGL…", or "First person
  couldn't load this scan's mesh. You're on the board."), or the beat can't
  run at all. Use the F1 fallback below.

### Fallback: first person on F1, or the Tactical board

Use this when the scan beat can't run: the go / no-go said so, or first
person on the scan fails on stage.

On `main` (PRs #119, #138 and #150). The run moves to Halvorsen Tower (F1),
the fixture building, open in its own tab (checklist). First person on F1 was
walked on c08ae94, before it went real time; the steps below are written
from `main`.

1. On the showcase path, click the **F1 browser tab**. Say: **"Tonight's run
   is on our hand-built floor, a fixture building."** On
   [the F1 path](#if-the-showcase-building-is-out-the-f1-path), skip this
   step: stay in the first browser tab, where **Start the run** opened the
   Run.
2. The Run is in first person, its default. If it shows the board, click
   **First person**, at the top right of the board, left of the mute button.
3. Click the view once, so the mouse looks, then hand over. Say: **"W to move,
   the mouse to look. Through the lobby, then left, down the dock
   corridor."**
4. The judge walks forward into the lobby, turns a quarter left, and walks
   into the Dock Corridor. A few seconds later Camera C2 sees them. The alarm
   goes to **Alert**, the status line under the view reads "C2 saw you in the
   Dock Corridor. The guards are converging.", and the Chief's line follows
   on the radio.

   Say: **"C2 has you. The security chief re-plans, and the guards follow
   it."**
5. Caught in the Dock Corridor, on the walk, soon after the alarm. Click **See
   the debrief** on the card.

On the walk, in fake mode, the Chief's line was tagged **Recorded**. With a
live model, F1's Chief answers live. Say what the tag says.

Fallbacks:

- First person doesn't come up, or doesn't play. Play the Tactical board
  instead:
  1. If the board isn't showing, click **Board**, the left button of the
     **Board** / **First person** pair. ("First person needs WebGL…" puts
     you on the board already.)
  2. Press **1**, **1**: the Freight Lift Lobby, then the Dock Corridor, in
     C2's view.
  3. The alarm goes to **Alert**, and the Chief's orders fill the side panel.
  4. Click guard **G4** for its Why card ("the 4th guard comes from Class A"),
     then **Esc**.
  5. Press **W** until the outcome shows (twice on the walk).
- The judge wanders off: click **Restart**, and give the directions again.

## Beat 7 · 1:30–1:45 · Debrief

Screen:

- the grade, and how it ended ("Caught in …", who saw you, who reached you);
- turns, noise and detections;
- the replay, with its **Turn** slider;
- the Chief's decisions as a timeline, each with its reason.

1. Drag the **Turn** slider back to the start, then forward. It steps through
   every turn of the run. Say: **"The debrief replays every move."**
2. Point at the Chief's decisions. This is the "read why" moment: in the run,
   the radio rarely reads the orders out (#190). Say: **"And here's why: every
   decision the Chief made, with its reason."**
3. The Monday line: **"And that search, era, class, a floor on the market
   tonight, is the one a location scout runs on Monday, on CoStar's own
   availability."**

Don't click either of these:

- **Try again**: it starts a new run.
- **Owner mode: test your own security**, or tab **8, Owner Mode**: beat 8
  uses the prepared Owner browser tab.

Fallback: the Debrief says "No run yet", because a reload lost the run. Say:
**"The debrief replays the run turn by turn; you just saw how it ended."**
Then the Monday line.

Walked here on F1: grade D, "Caught in the Dock Corridor", two Chief
decisions, the slider. Live only, not walked here: the showcase building's
Debrief. At the rehearsal, it scrubbed through every turn.

## Beat 8 · 1:45–1:55 · Owner Mode

**Needs #206**, which puts Owner Mode on the showcase building. It wasn't
merged at 09:30 UTC. Without it, or if the showcase's Owner tab won't load,
play [F1's pair](#fallback-f1s-prepared-pair) below.

Screen: the Owner browser tab, the last browser tab, prepared before the
pitch (checklist). It is not the app's tab 8, **Owner Mode**: that opens the
Owner page fresh, and its compare would take about 4.2 s on stage. The
prepared tab shows Owner Mode on the showcase building, its real scan as the
board:

- "A made-up setup for the demo, not this building's real security.";
- **Two setups, side by side**, tagged **Rule-based**;
- A, "Demo: generated security", and B, the same setup with one camera
  turned;
- the compare's line: coverage and open windows, before → after;
- the counts out of 50.

The figures come from the real scan's board, so they aren't in this public
repo. The printed note carries them, beside the answer key (checklist).

1. Click the last browser tab, the Owner tab you prepared.
2. Say: **"And for the owner, a made-up setup: turn one camera, and its open
   windows drop from [before] to [after]."** Read the two figures off the
   screen, or the printed note. That's about 7 s.
3. If time allows, click **Show on the board** under B.

Say the open windows, not the counts out of 50. Coverage and open windows
depend only on the board, so they hold on every run. The counts hold only
while the crew model misses its 4 s window and the rule-based stand-in plays,
which it did on every run on #206. If the model answers in time, the counts
change. The Chief's fix changes nothing here, so the beat shows the compare,
not the fix.

Fallback: the tab lost its result, because it was reloaded.

1. Scroll the side panel to **Compare two setups**. It starts on the demo
   pair.
2. Click **Compare**. The result takes about 4.2 s, almost all of it the crew
   call's timeout. Fill it: **"The crew tries fifty ways in, on each."** That
   uses the 5 s spare.

Live only, not walked here. The figures and the timing are #206's, from its
author's live walk.

### Fallback: F1's prepared pair

Use this when #206 isn't merged, or the showcase's Owner tab won't load. The
checklist then prepares the Owner browser tab on F1 instead. It shows Owner
Mode on Halvorsen Tower:

- "Made-up setup on a fixture building. Real setups stay on this device.";
- **Two setups, side by side**, tagged **Recorded**;
- A, "Demo: night shift": **7 / 50**, "43% watched · 40/80 open";
- B, "Demo: night shift, C2 moved": **1 / 50**, "50% watched · 20/80 open";
- "C2 moved from the Freight Lift Lobby to the Dock Corridor";
- "7 → 1 of 50: 6 fewer got out.";
- "Coverage 43% → 50%, open windows 40 of 80 → 20 of 80."

1. Click the last browser tab, the Owner tab you prepared.
2. Say: **"And for the owner: their own security, here made up. Seven get
   out; move C2, one in fifty."** That's about 8 s.
3. If time allows, click **Show on the board** under B. C2 is ringed, as what
   noticed the crew first most often.

If the tab lost its result, scroll to **Compare two setups** and click
**Compare**. Coverage and open windows hold. The counts 7 and 1 come from the
crew's recorded strategies, which the checklist forces; with a live model,
read the counts off the screen.

Walked here in fake mode, on c08ae94: Compare in 0.4 s, 7 / 50 → 1 / 50,
coverage 43% → 50%, and C2 ringed on B. The open windows came with #144 after
the walk. Their numbers are from `main`'s owner smoke test. Not walked:
forcing the Model, because fake mode locks that switch.

## If the showcase building is out: the F1 path

Use this when the go / no-go fails. Everything is on F1, Halvorsen Tower, and
every step was walked here. Beats 1, 7 and 8 are unchanged, and beat 6 is its
F1 fallback. Beats 2 to 7 all play in the first browser tab: **Start the
run** opens the Run there, with the crew's plan just shown. Don't use the
prepared F1 browser tab on this path: it opened before the plan, and a Run
reads the plan only as it opens.

Say once: **"Our fixture building, shaped like a CoStar record."**

| beat | do | screen |
|---|---|---|
| 2 | **Finalist 1 · F1 Halvorsen Tower**, then **Scout it** | the three finalists |
| 3 | **→** once, then **Plan the job** | five tagged entries: Loading dock, Garage ramp, Main lobby, Stair B exit, Roof hatch |
| 4 | let it play (5.6 s), then **Brief the crew** | Data → Level, starting with "Cast because: …", then 1974, Class A, floor 22 and the dock |
| 5 | paste (the checklist put this order on the clipboard) `Go in through the dock, wait for the 2 am round to pass, take the records room.`, then **Enter**, then **Start the run** | four steps, and the warning "Camera C2 sees you in the Dock Corridor on turn N…" |

Notes:

- **Beat 4:** the Level Builder's run here is the recorded one. Say so: **"A
  deep agent built this level; this is its recorded run."**
- **Beat 5:** on the walk, the crew's reply was **Recorded**. With a live
  model it answers live, in its own words. If you moved to this path on
  stage (beat 2 or 4), the clipboard still holds the showcase order: type
  this one instead.

## Reset: `npm run demo:reset`

```sh
npm run demo:reset
```

It puts `data/levels/` back to the committed levels and writes a new demo
epoch. On its next page load, the browser drops:

- earlier run logs and crew plans;
- services forced to fixtures in the demo settings, including a stand-in
  floor plan taken from "Loading the scan";
- the Run's view (first person), the play mode and the mute choice.

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
      `npm ci`, then `npm run build`, then `npm start`, on current `main`.
      Rebuild after #202, #195 and #206 land.
- [ ] **Start the server a few minutes before the pitch.** The showcase level
      builds when the server starts, which takes minutes. When it is done,
      the cast card's level line says "Its level is built: Plan and Run are
      ready."
- [ ] **One browser window**: 1440×900, zoom 100%, notifications off,
      nothing on top of it. Keep it in front during every load.
- [ ] **Sound on.** The system volume is up and checked, and the browser tab
      is not muted. On a Run, the speaker button at the top right of the
      board, marked **M**, is not pressed; **M** toggles it.
- [ ] **Print the answer key**, and keep it by the laptop. It stays out of
      this public repo, because it holds facts from the real scan. It has:
  - which camera to stand in on the run, and where;
  - which way to send the judge after the alarm, towards the guards;
  - which door's picture tears, to steer around;
  - the room the end card names;
  - the showcase building's Owner Mode figures (beat 8): which camera turns,
    and the coverage, open windows and counts out of 50, before and after.

**The last few minutes, in this order:**

- [ ] `npm run demo:reset`, then reload the browser on `/`. The reset needs
      that reload, so it comes first.
- [ ] **Open the F1 fallback browser tab.** In a second browser tab, open
      `/b/F1/run?m=romaine-1974`. It opens in first person, its default, and
      its clock waits for the first move (#174). F1 has no scan, so a
      background tab is fine.
- [ ] **Open the Owner browser tab as the last browser tab, on the showcase
      building (needs #206).** Keep this window in front while it loads: the
      board is the real scan, about 7 s.
  1. In the new browser tab, open `/m/romaine-1974/cast`. Click the showcase
     card's **Scout** link, then the app's tab **8, Owner Mode**. On a
     building page, tab 8 opens that building's Owner page.
  2. Check for "A made-up setup for the demo, not this building's real
     security."
  3. Scroll the side panel to **Compare two setups**. A is "Demo: generated
     security", and B is the same setup with one camera turned.
  4. Click **Compare**, and wait about 4.2 s. Check that the compare shows
     fewer open windows for the turned camera, matching the printed note. The
     counts out of 50 can differ from the note if the model answered in time;
     the beat doesn't say them.
  5. Leave the tab on the result.

  **If #206 isn't merged, or this tab won't load, prepare F1's pair
  instead**, at `/b/F1/owner?m=romaine-1974`, typed in the address bar:
  1. Press **Shift+?** and switch **Model** to fixtures.
  2. Scroll the side panel to **Compare two setups**. A is "Demo: night
     shift" and B is "Demo: night shift, C2 moved".
  3. Click **Compare**. Check for **7 / 50**, **1 / 50** and **Recorded**.
  4. Press **Shift+?**, switch **Model** back, and press **Esc**.
  5. Check that the result is still there and the chip reads `LIVE`.

  Why force the Model on F1: with a live model, Compare asks the model for new
  strategies, and the counts are no longer 7 and 1.
- [ ] **Last: back to the first browser tab, and load the scan from Plan.**
      Do this last, because switching browser tabs hides the window and
      pauses a scan's load (#159).
  1. Check that the chip reads `LIVE`.
  2. In this window, in front, open the showcase building's **Plan** from the
     cast card's **Plan** link. Plan starts the scan and its board, and Run
     takes them from it (#181). Run opens in first person by default, so
     there's nothing to set.
  3. Leave it there, with the window in front, until the board is drawn.
  4. **Decide [go / no-go](#go--no-go-decided-before-the-pitch) now, with
     this Plan on screen.**
  5. **Put that path's order on the clipboard.** The board is drawn, so
     leaving the window now is safe. Come back to it after.
     - Go: `Go in by the roof hatch, straight to the files, and out the way we came.`
     - F1 path: `Go in through the dock, wait for the 2 am round to pass, take the records room.`
  6. To start beat 1, go to `/` with the wordmark top left, or tab **1,
     Missions**. Neither is a reload, so the scan survives it. A reload lets
     the scan go.

  Time a cold load from Plan once on the demo machine, so you know how early
  to open it.

  Live only, not walked here.

### Go / no-go, decided before the pitch

At the checklist's last item, step 4, with the showcase Plan on screen, all
three must hold:

1. The cast card's level line says "Its level is built: Plan and Run are
   ready."
2. The scan is on Plan with the board drawn: no "Loading the scan" over it,
   and no fallback toast. The chip's hover doesn't list Matterport after "On
   fixtures:".
3. The **Your order** box is enabled.

If any fails, the whole pitch runs
[the F1 path](#if-the-showcase-building-is-out-the-f1-path). Decide it here,
not on stage, and never wait on stage.

If "Loading the scan" offers **Use the stand-in floor plan**, don't take it.
It forces Matterport to fixtures for the rest of the session, so every page
after it is on the stand-in until the demo settings or `npm run demo:reset`
switch it back. The F1 browser tab is the better move.

**Before the event:** one full rehearsal against a timer. Then reset and run
the last-minutes list again.

## The video

Q10, per status issue #1 (23:10 UTC on 14 November), and in the SPEC since
#180: **the public demo video doesn't show the scan.**

- It shows the run on F1, which is beat 6's F1 fallback, in first person or
  on the board.
- Where this script plays the scan, the voice-over describes it instead.

That holds unless the CoStar crew says yes. Nothing from a scan or the kit goes
in the repo or the video's files.

## Open items

1. **Beat 6 on the scan was rehearsed, not walked here.** The team's live
   rehearsal on `main`, at about 05:00 UTC with #181, #179, #150 and #173 in,
   called it a GO. Its timings, and the steer towards the guards, are in beat
   6. Which camera has the player, which door tears, and the room on the end
   card are on the printed answer key, out of the repo.
2. **The live crew can name a zone the board doesn't have.** It plans on the
   manifest's zones, not the placed board's, and the board strikes such a
   step out.
   - Beat 5's order asks for no wait, which should avoid it. That is untested
     live.
   - The fix is #142's review finding M4: send the placed zones with the crew
     request. It has no ticket yet.
3. **The showcase path was not walked for this script.** That covers the cast
   card, the real record, the aerial, the scan, the live crew and the Chief,
   because no keys were used here. The team's live rehearsal ran them, and
   Esun4's earlier walks are reported on #157.
4. **The radio repeats one line at Lockdown (#190).** In first person, at
   Lockdown, the Chief is asked on every re-sighting, so the radio mostly
   repeats a short, model-written line about where the player was last seen,
   and rarely reads its orders.
   Nelson's call is to leave the code as it is for the demo, and fix it after
   the freeze. Beat 6 narrates the re-plan instead, and beat 7 reads the
   reasons off the Debrief.
5. **Not walked: forcing the Model in the demo settings, to prepare the Owner
   tab.** Fake mode locks the switch. Expect the result to stay on screen when
   you switch it back, since the page re-renders without a reload. The
   checklist checks it.
6. **Still to land before the rehearsal.** Re-check the lines each one touches
   when it merges:
   - #202, the scan floor fill;
   - #195, the Hobbs header and page titles;
   - #206, Owner Mode on the showcase building. Beat 8 is written for it, with
     about 4.2 s per compare; its figures are on the printed note, not here.
     F1's pair is the marked fallback until it merges, or if the showcase's
     Owner tab won't load.
