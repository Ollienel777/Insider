# Pitch: Entertainment, and Best Overall (2 minutes)

Our main track. The same pitch goes to Best Overall.

- **The rubric:** creativity, utility, charity and avidity, unweighted
  ([`EVENT.md`](../../EVENT.md#judging)).
- **The track asks** for entertainment and media used "creatively and
  uniquely": story-telling apps and interactive projects
  ([`tracks/prizes.md`](../../tracks/prizes.md)).

So the story leads: a heist from history, cast in a real building, briefed by
a game master, played in first person inside that building's scan, and
replayed in the Debrief. Data provenance stays light.

This builds on [`DEMO.md`](../DEMO.md), which stays the home for the setup,
each beat's detail, the fallbacks and the checklist. The beat numbers below
are DEMO.md's. Brackets are read off the screen, or off the printed answer
key, as in DEMO.md.

## Cue card

| # | at | click | say | if it breaks |
|---|---|---|---|---|
| 1 | 0:00 | Judge: **The Romaine Street Papers** (open by default), then **Take the job**. Point at a green tab as you speak | "This is Hobbs. Every heist in history needed a building; we cast a real one. On the green jobs you stop it. Pick a heist." | Click Romaine yourself, then **Take the job**. |
| 2 | 0:10 | Point at the showcase card, then **Scout it** | "A casting agent runs a location scout's search: the right era, a floor that's empty tonight, a 3D scan. Tonight's set is a real building: [name]." | Slow: **Skip**. No card, or not built: [the F1 path](../DEMO.md#if-the-showcase-building-is-out-the-f1-path). |
| 3 | 0:25 | **Plan the job** | Nothing. | No aerial, or it hangs: **Plan the job** anyway. |
| 4 | 0:27 | Point at **Mission briefing** as it fills, then **Brief the crew** | "Then a game-master agent writes your briefing, for this building and this job. The building is real. The guards and cameras are game fiction." | Stalls: **Skip**. |
| 5 | 0:39 | Paste the order, **Enter**. **Start the run** as the plan shows | "You brief your crew in plain English, and they talk back." Then: "The board checks their plan. Let's go." | **No crew reply**: "The model was slow, so the board worked out this plan." Greyed order box: the F1 tab. |
| 6 | 0:51 | Click the view once; hand over. **See the debrief** on the end card | "You're in the real building, its own scan. W to move, the mouse to look, hold E at a door. That light is a camera: stand in it for a second." At the alarm: "That camera has you. The Chief is re-planning live: watch the guards converge. Keep going, towards the guards." At the catch: "Caught. The debrief shows how." | No capture by **1:24**: "The Chief is still hunting you. Here's the replay." Then tab **7 Debrief**. Scan fails: the F1 tab. |
| 7 | 1:24 | Drag **Turn**; point at the **Security Chief** decisions | "Every heist gets a debrief: the whole run, move by move, and every call the Chief made, with its reason." | "No run yet": "The debrief replays the run move by move; you just saw how it ended." |
| 8 | 1:37 | The **last browser tab**, the Owner tab you prepared | "Turn it around: Owner Mode tests a building's own security, here made up. Turn one camera: open windows drop from [before] to [after]." | DEMO.md's [beat 8 fallback](../DEMO.md#beat-8--145155--owner-mode), or F1's pair: "Seven get out; move C2, one in fifty." |
| — | 1:47 | Nothing | "Next: the agent casts from CoStar's whole inventory, and we make a real building you can beat." | — |

Ends at **1:55**, with 5 s spare for beat 5's crew reply, which wasn't
measured live.

Against DEMO.md's clock:

- Beat 1 is the same 10 s.
- Cast: 20 s → 15 s.
- Scout: 3 s → 2 s, with no line.
- Dossier: 14 s → 12 s.
- Plan: 13 s → 12 s, with no Why card.
- The run gains 3 s: 30 s → 33 s, cut at 1:24.
- Debrief: 15 s → 13 s, with no Monday line.
- Owner Mode keeps its 10 s.
- The closing line takes 8 s.

On the rehearsal's timings, the capture lands 18–37 s after **Start the
run**: about 1:09 to 1:28 here, so the cut at 1:24 still matters.

## What each beat answers

| # | beat | answers |
|---|---|---|
| 1 | Missions | **Creativity:** heists from documented history, as a story. **Interactive:** the judge picks the job. **Charity:** three of the five jobs are `prevent` missions, the green tabs. |
| 2 | Cast | **Creativity:** a real building cast as a set, the way a film's location scout would. |
| 3 | Scout | Nothing at this table. Click through. |
| 4 | Dossier | **Story-telling:** the game master's briefing, written for this building and this job. |
| 5 | Plan | **Interactive:** the crew answers in plain English. |
| 6 | Run | **Creativity and interactivity:** first person inside a real building's own scan, with the Chief re-planning live. This is the wow. |
| 7 | Debrief | **Story-telling:** the run replayed, and the Chief's reasons. |
| 8 | Owner Mode | **Utility and charity:** the same engine tests your own building's security. |
| — | Close | **Avidity:** where it goes next. |

Throughout, **avidity and polish**: a run that doesn't stall, and a team
that obviously plays it.

**Charity, honestly.** It comes from two places only: the `prevent` missions
(beat 1) and Owner Mode (beat 8). This pitch plays a heist, not a `prevent`
mission. Of the three `prevent` missions, only **The Night Desk**, on the
fixture building F3, has a playable level. Don't stretch a beat further.

## Skip at this table

- **The Why card** in beat 5, and its line "Every guard, camera and lock says
  which data put it there."
- **The Data → Level rows** in beat 4. The line names the briefing, not the
  rows.
- **Vexcel** in beat 3: no line at all.
- **The agents' traces**, beyond what plays on its own on Cast and the
  Dossier.
- **The Monday line** in beat 7. That is CoStar's usefulness argument.
- **The counts out of 50** in beat 8, as in DEMO.md.

## Before this table

Nothing beyond [DEMO.md's checklist](../DEMO.md#demo-machine-checklist): the
F1 tab, the Owner tab on the showcase building, and the scan loaded from Plan
last.

## Judge questions

**Most likely: "Is that the building's real security?"**
"No. The building and its scan are real; every guard, camera and lock is game
fiction made from its class and era, and the screen says so."

**Also ready: "Can you win it?"**
"Not yet on the real building: none of us has, and we kept its real floor as
hard as it is."

## Checked against `main`

Checked at 105d812.

- **Beat 1:** the five missions, and which are which, are in
  `fixtures/missions.json`:
  - heists: The Romaine Street Papers and Hole in the Ground;
  - `prevent`: The Night Desk, Paper Trail and Syntactic.

  A `prevent` tab has a green swatch, and a heist tab a red one; an open
  page says "Heist" or "Prevent" (`mission-list.tsx`). The Night Desk's level
  is `data/levels/F3.night-desk.json`.
- **Beat 4:**
  - The heading **Mission briefing · Heist** is in `dossier-screen.tsx`.
  - The briefing shown is the manifest's.
  - `write_manifest` (`src/agents/builder/tools.ts`) refuses a briefing that
    isn't the `game-master` subagent's word for word, runs over 120 words, or
    doesn't say its security is game fiction.
- **Beat 7:** the Debrief's heading **Security Chief**, its "N decisions" and
  the **Turn** slider are in `debrief-screen.tsx`.
- **Beat 6:** #207 merged after DEMO.md was written. At Lockdown the Chief is
  now asked once per zone, at most once every 10 s, and the radio reads each
  re-plan in full; DEMO.md's Lockdown note (#190) predates it. That wasn't
  rehearsed on the scan. Narrate the re-plan as the cue card says, and let the
  radio's line land if it does.
- **Not confirmed from the code:** anything live. That covers the showcase
  briefing's words, the crew's reply time and the rehearsal's run timings.
  They are DEMO.md's.
