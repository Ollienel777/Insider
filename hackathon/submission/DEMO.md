# The demo script (2 minutes)

The live demo, written against `main` at 9531d91 and walked there in fake mode
on 2026-11-14. SPEC §2 is the target. Where `main` cannot do a beat yet, the
beat is listed under **Open items** and is not in the script.

Rules on stage:

- Say only what the screen shows. The chip top right reads `FIXTURES`: every
  building, aerial and floor on screen is invented fixture data, not a CoStar,
  Vexcel or Matterport record. Never call it real data while the chip says
  `FIXTURES`.
- Never click **Drill** (top right of the step rail). Drill Mode is on hold
  (SPEC Q8) and off the script.
- If a beat breaks, say its fallback line, do its fallback click, and move
  on. Do not debug on stage.

## The beats on `main` today

SPEC §2 has seven beats. Beat 2 (casting) is not on `main` (Open items 1–3),
so today's script runs beats 1 and 3–7, each with its SPEC length. That ends
at **1:38**. Do not stretch other beats to fill the 22 s; casting takes them
back when it merges.

| # | SPEC slot | today | length | screen |
|---|---|---|---|---|
| 1 | 0:00–0:10 | 0:00–0:10 | 10 s | Map (`/`) |
| 2 | 0:10–0:32 | not run | 22 s | Cast: not on `main` |
| 3 | 0:32–0:42 | 0:10–0:20 | 10 s | Scout (`/b/F1/scout`) |
| 4 | 0:42–0:57 | 0:20–0:35 | 15 s | Dossier (`/b/F1/dossier`) |
| 5 | 0:57–1:10 | 0:35–0:48 | 13 s | Plan (`/b/F1/plan`) |
| 6 | 1:10–1:40 | 0:48–1:18 | 30 s | Run (`/b/F1/run`) |
| 7 | 1:40–2:00 | 1:18–1:38 | 20 s | Debrief (`/b/F1/debrief`) |

The machine's own waits, measured on the walk: the Dossier replay 5.8 s; the
crew's recorded reply 0.1 s; the Chief's re-plan finished streaming 2.3 s
after the alarm. Everything else is your talking and clicking. The spoken
lines are sized to fit each slot at about 2.5 words a second, but have not
been rehearsed aloud against a timer: do that once (checklist) and cut words,
not beats.

## The script

### Beat 1 · 0:00–0:10 · Map

Screen: the map at `/`, Los Angeles tab open, nothing selected.

1. Say: **"Every heist in history needed a building. We build the level from
   the building's own data."**
2. Click the row **Halvorsen Tower** (Bunker Hill · 1974 · Class A · 42
   stories). Its pin turns amber.
3. Say: **"Halvorsen Tower. A fixture building, shaped like a CoStar record."**
4. Click **Scout this building**.

Fallback: if the map or the row does not respond, type
`localhost:<port>/b/F1/scout` in the address bar. Say: **"Straight to the
building."**

### Beat 2 · casting

Not on `main`. Skip it. See Open items 1–3.

### Beat 3 · 0:10–0:20 · Scout

Screen: the aerial, from the north, with five tagged entries: Loading dock,
Garage ramp, Main lobby, Stair B exit, Roof hatch.

1. Press **→** three times (E, S, W). The fourth **→** goes to Ortho.
2. Say: **"The aerial gives the ways in: the dock, the garage ramp, the roof
   hatch."**
3. Click **Plan the job**.

Fallback: if the arrows do nothing, click the **E**, **S**, **W** buttons
at the bottom left of the view. If the view is blank, click **Plan the job** anyway and say:
**"On fixtures the aerial is a massing render. The entries are what
matter."**

### Beat 4 · 0:20–0:35 · Dossier

Screen: the Level Builder replays its recorded run (about 6 s) beside the
**Data → Level** table, then the mission briefing, *The Romaine Street
Papers*.

1. While it fills, say: **"A deep agent reads the record and builds the
   level. Built 1974: analog era, key locks, sweeping cameras. Class A: four
   guards. Floor 22 mostly vacant: quiet suites. The dock on the aerial: the
   way in."**
2. Point at the briefing's "Inspired by" line: the Summa Corporation
   burglary, June 5, 1974.
3. Click **Brief the crew**.

Fallback: if the replay stalls, click **Skip** (top of the Level Builder
panel). The table fills at once. Say: **"Here is the finished level."**

### Beat 5 · 0:35–0:48 · Plan

Screen: the board and the order box. Have the order on the clipboard before
the demo (checklist).

1. Click the **Your order** box, paste (**Cmd+V**):
   `Go in through the dock, wait for the 2 am round to pass, take the records room.`
2. Press **Enter**.
3. The crew's four-step plan appears, drawn on the board, with the
   **Recorded** chip. Say: **"The crew answers with a plan, checks it on the
   board, and pushes back: camera C2 catches us in the dock corridor on the
   way out."**
4. Click **Start the run**.

Fallback: if no plan appears within 4 s, click **Start the run** anyway. The
run carries the level's own four-step plan. Say: **"The level ships with a
plan of its own."**

### Beat 6 · 0:48–1:18 · Run, the wow beat

Screen: the isometric board. You start at the freight lift. Numbered rings
mark the moves.

1. Hand the judge the mouse. Say: **"Your move. Click 1."** (Freight lift
   lobby.)
2. Say: **"Now 1 again."** (The Dock Corridor, in C2's cone.) Keys **1**, **1**
   do the same.
3. The alarm jumps to **Alert**. The status line reads "C2 saw you in the
   Dock Corridor. The guards are converging."
4. The Security Chief's orders stream into the side panel (about 2 s). Say:
   **"The AI security chief re-plans, and you can read why. The guards'
   routes follow its orders."**
5. Click the guard **G4** on the board. The Why card opens. Say: **"Every
   guard says which data put it there: the dock on the aerial, and Class A
   gives the fourth guard."**
6. Press **Esc**, then **W** twice. You are caught.
7. Click **See the debrief**.

Fallback: if the judge clicks the wrong ring, click **Restart** (top of the
board) and press **1**, **1**. If the Chief's panel stays empty, point at the
status line and say: **"The guards never wait for the model. They are already
converging."**

### Beat 7 · 1:18–1:38 · Debrief

Screen: grade **D**, "Caught in the Dock Corridor.", turns, noise and
detections, the replay with a turn slider, and the Chief's decisions as a
timeline.

1. Drag the **Turn** slider back to the start, then forward.
2. Say: **"The debrief replays every move, yours and the guards', with each
   of the Chief's decisions and its reason."**
3. Close: **"Every guard, camera and lock you saw came from a rule on the
   building's data, and the Why card shows which."**

Fallback: if the Debrief says "No run yet" (the browser lost the run log), do
not replay the run, and do not press Back: the Run screen starts again at
turn 0. Say: **"The debrief replays the run turn by turn; you just saw how it
ended."** Then the close line.

Do not say SPEC §2's Monday line (the location scout's search) until casting
is on `main` (Open item 4).

## Reset: `npm run demo:reset`

Run it in the repo between rehearsals and right before the pitch, then
reload the browser:

```sh
npm run demo:reset
```

It puts `data/levels/` back to the committed levels (moved files go to
`.heist/trash/`) and writes a new demo epoch. On its next page load the
browser drops earlier run logs, crew plans and services forced to fixtures.
No server restart. Seen on the walk: after the reset, a reload of the Debrief
shows "No run yet" and the Run starts at turn 0.

## Pre-demo checklist

Sunday morning, on the demo laptop:

- [ ] `git checkout main && git pull`, then `npm ci`.
- [ ] Build and start in fake mode. `NEXT_PUBLIC_*` is fixed at build time,
      so set every mode for both:

      ```sh
      export HEIST_MODE=fake LLM_MODE=fake COSTAR_MODE=fake VEXCEL_MODE=fake NEXT_PUBLIC_MATTERPORT_MODE=fake
      npm run build && npm start
      ```

      `npm start` serves on port 3000 unless `PORT` is set.
- [ ] `npm run demo:reset`, then reload the browser.
- [ ] The chip top right reads `FIXTURES`.
- [ ] One browser window at 1440×900 (the size the walk and the smoke use),
      zoom 100%, devtools closed, no other tabs, notifications off.
- [ ] The crew order is on the clipboard:
      `Go in through the dock, wait for the 2 am round to pass, take the records room.`
- [ ] One full rehearsal against a timer, then `npm run demo:reset` and
      reload, and leave the browser on `/`.
- [ ] Shift+? opens the hidden demo settings. In fake mode every switch is
      locked ("Fixtures: no live configuration"); it only matters if a
      service is live.
- [ ] Confirm with the team (status issue #1), still open:
  - [ ] Is the demo served from `localhost`? The Matterport SDK key works on
        `localhost` only. Fake mode does not use it.
  - [ ] May Vexcel imagery (Q3) and CoStar records (Q5) appear on stage? Fake
        mode shows neither.
  - [ ] Has the Owner Mode checkpoint (Saturday 4 PM ET) given it a slot? If
        yes, this script changes first (Open item 5).

## Open items

What SPEC §2 asks for that `main` cannot do today. None of it is in the
script.

1. **Beat 1, the mission picker.** `/` on `main` is the building map ("Pick a
   building"), not five mission cards. The mission is fixed per building
   (F1 plays *The Romaine Street Papers*). Closes with #143 (C4).
2. **Beat 2, the cast screen** (`/m/[missionId]/cast`: funnel, pins dimming,
   three finalists). Not on `main`. Needs #135 (C2, inventory search), #141
   (C3, Casting Director) and #143 (C4). Only #133 (C1, missions and the
   fixture inventory) has merged.
3. **`?m=` on every route, and the dossier's "cast because" row.** `main`'s
   routes carry no `?m=`, and its Data → Level table has five rows
   (yearBuilt, buildingClass, availableSpace, typicalFloorSf, entries.kind),
   none of them "cast because". Closes with #142 (C5).
4. **Beat 7's Monday line** ("the search that cast your heist is the one a
   location scout runs on Monday") describes casting, so it is false on
   `main`. Say it only once items 1–3 merge. The smoke walking casting is
   #120 (C6, no PR yet).
5. **Owner Mode** (SPEC §13): open decision. PRs #136, #140, #148, #159.
   Whether it gets about 15 s (from Scout and Debrief) is decided at the
   Saturday 4 PM ET checkpoint (Nelson on #1 and #129). Not scripted.
6. **Drill Mode is on hold** (SPEC §1, Q8): off the demo script; its route
   and the **Drill** link in the step rail are still on `main`.
7. **Wording differs from SPEC §2.** The script quotes `main`, not the SPEC:
   - Beat 5: SPEC has the crew say "Camera C2 covers the dock corridor every
     other turn. Wait one turn at the freight lift." `main` warns "Camera C2
     sees you in the Dock Corridor on turn 12, on the way out." and pushes
     back on the way out.
   - Beat 6: the Chief's recorded orders on `main` are "C2 has them in the
     dock corridor. G1 and G4, up through the elevator lobby and converge. G2
     holds the records room door. G3 cuts off the loading dock. Lock the
     records room.", not SPEC's text. The Why card is on G4 (the dock guard).
   - Beat 7: the stats are turns, noise and detections, not time.
8. **Live mode was not walked.** SPEC §2 runs the demo in whichever mode the
   rehearsal proved. This script is fake mode only; a live demo needs its
   own walk.
9. **Open PRs that change screens on this path**: #100 (night cleaners on the
   demo floor), #101 (Chief orders end at Calm), #108 (the Chief adapts
   between runs), #138, #149, #157 (rubric passes on Plan, Run, Map, Scout,
   Dossier and Debrief), #146 (F2 and F3 levels). After any of them merges,
   walk the script again; the run's moves and on-screen text may change.
