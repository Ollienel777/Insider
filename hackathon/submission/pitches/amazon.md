# Pitch: Amazon, "Best Practical AI Innovation" (2 minutes)

An optional table, and the smallest prize. Its criteria
([`tracks/prizes.md`](../../tracks/prizes.md)):

- **Weights:** creativity, usefulness, technical implementation and user
  experience, 25% each.
- **The ask:** AI that solves a real problem for real people, and that will
  "reason, plan, take action and adapt".
- **It must include:** a working demo, a clear use case and target user,
  basic documentation, and a pitch.
- **Any tools, APIs, models or frameworks are allowed.**

So Owner Mode leads, as the practical tool, with a named user. Then the pitch
walks reason, plan, act and adapt:

1. The crew plans and pushes back.
2. The run acts.
3. The Chief re-plans within the run.
4. On a fixture building, the next run starts with a changed posture, which
   the Chief names.

**We use no Amazon service.** The models are Claude on Anthropic's API.
Bedrock is wired in as a provider and not used (`src/adapters/llm/bedrock.ts`).
Don't claim AWS.

This builds on [`DEMO.md`](../DEMO.md), which stays the home for the setup,
each beat's detail, the fallbacks and the checklist. The beat numbers below
are DEMO.md's; **6b** is this table's own, on F1. Brackets are read off the
screen, or off the printed note, as in DEMO.md.

## Where the between-runs adaptation holds

**On fixture buildings only, not on the showcase building.** On the showcase
building, no run joins the history, on two counts: it is a CoStar kit
building, and its floor is a live scan.

- `boardOn` in `src/components/run/run-screen.tsx` sets `inMemory` for
  either case (`live || source === "costar"`). A run that ends while
  `inMemory` is set leaves no record (#95, SPEC §4.5).
- For a kit building, `loadRunHistory` in
  `src/components/run/run-history.ts` reads no history, and removes any kept
  from before #95.
- Plan reads the history the same way (`plan-screen.tsx`).

So beat 6b plays on F1, Halvorsen Tower, whose figures may be quoted. Its
history is kept in this browser's `localStorage`, per building and mission
(`heist:run-history:F1:romaine-1974`). It needs one finished run of F1 played
before the pitch.

What the second run shows, as `tests/smoke/adapt.spec.ts` checks it in fake
mode:

- **The bar** shows **Forget 1 earlier run**.
- **Guard G3** starts posted in the secure room off the dock corridor, nearer
  the dock than any guard starts on a first run. Its Why card's **Placer**
  line reads "Posted near the way in the crew used on earlier runs, nearer it
  than any guard starts on a first run, …" (`WATCH_POST_RULE` in
  `src/level/placer.ts`).
- **The same keys as the first run**, 1 and 1, raise the alarm, and G3 is on
  the player that turn. The run ends caught on the spot.
- **The Chief's answer lands after the catch,** so the panel marks it late:
  "Arrived after the run ended. None of these orders reached the guards."
- **Its rationale opens with the changed posture.** The recorded line is
  "They used the loading dock before. G3 starts in the secure room off the
  dock corridor tonight." A live Chief is told the history and asked to open
  that way (`src/agents/chief/prompt.ts`), so its words vary. The rule-based
  stand-in opens "They came in by …" (`template.ts`).

## Cue card

| # | at | click | say | if it breaks |
|---|---|---|---|---|
| 8 | 0:00 | Start on the **last browser tab**, the Owner tab you prepared. **Show on the board** under A, if time allows | "A building's security lead has one question: how would someone get to the files? Owner Mode is a first answer, before a consultant visits. This setup is made up, on the building's real scan. The engine plays fifty break-ins on each setup, from the crew's strategies. Turn one camera: open windows drop from [before] to [after]." | Result gone: DEMO.md's [beat 8 fallback](../DEMO.md#beat-8--145155--owner-mode). The crew chip reads **Rule-based**: add "here rule-based, as the tag says." |
| 5 | 0:25 | The **first browser tab**, on Plan. Paste `Go in by the roof hatch, straight to the files, and out the way we came.`, **Enter**. The reply: three steps, and one risk under **The crew pushes back**. Point at it. **Start the run** as the plan shows | "How it reasons and plans: brief the crew in plain English. It answers, pushes back on the weak point, and the board checks its plan." | **No crew reply** (2 of 6 tries on 15 Nov, after 4.2 s): "The model was slow, so the board worked out this plan, with no model." Greyed order box: the F1 tab, and go to 6b. |
| 6 | 0:38 | Click the view once; hand over | "It acts: you're in the real building's scan. W to move, the mouse to look; stand in that camera's light." At the alarm: "It adapts within the run: the Chief re-plans the guards live, and says why." | Cut at **1:03**, caught or not: "Caught." or "The Chief is still hunting you." Scan fails: go to 6b. |
| 6b | 1:03 | The **F1 browser tab**. **Board**. Click guard **G3**, then **Esc**. Press **1**, **1** | "And between runs. Before the pitch we played this fixture building once, in by the dock. Tonight G3 starts by the dock; its card says why." After the keys: "Same way in: caught on the spot. The Chief answers after, and opens with why: [its first sentence, off the panel]." Point at the bar: "Forget wipes that memory." | No **Forget 1 earlier run** in the bar: the history is gone. Press 1, 1, then **W** until caught, then **Restart**, and say "One run, and G3 moves." Live words don't name the post: point at G3's card instead. |
| — | 1:36 | Nothing | "Reason, plan, act, adapt: the crew plans, the engine plays, the Chief re-plans, and the level remembers. With no keys at all it still runs, and the screen says what's live." | — |

Ends at **1:48**, with 12 s spare. The spare covers four things:

- beat 5's crew reply: 1.7–4.3 s live on 15 Nov, or the board's plan after
  4.2 s;
- the **Rule-based** line;
- the Chief's word-by-word reveal in 6b;
- 6b's fallback run.

Against DEMO.md's clock:

- Owner Mode moves first: 10 s → 25 s.
- Plan keeps its 13 s.
- The run: 30 s → 25 s. It is cut at 1:03; the alarm and the Chief's first
  line fit in it.
- 6b is new, at 33 s.
- The closing line takes 12 s.
- Beats 1–4 and 7 are dropped.

## What each beat answers

| # | beat | creativity | usefulness | technical implementation | user experience |
|---|---|---|---|---|---|
| 8 | Owner Mode | a game's engine turned into a security test | a real problem and a named user: a building's security lead | fifty attempts played in the browser; coverage and open windows from the floor plan | two setups side by side, in plain words |
| 5 | Plan | | | **reason, plan:** the crew's plan, checked on the board | an order in plain English |
| 6 | Run | first person inside a real building's scan | | **act, adapt:** the Chief re-plans, and the guards never wait for the model | |
| 6b | F1, second run | | | **adapt between runs:** a placement rule and the Chief's history | the memory shows, explains itself on G3's card, and can be forgotten |
| — | Close | | | runs with no keys | labels what is live |

## Skip at this table

- **Beats 1–4**: Missions, Cast, Scout and the Dossier. They are the CoStar
  and deepagents story.
- **Beat 7, the Debrief.**
- **"Ask the Chief for a fix"** on the showcase. On #206's live walk, the
  Chief's lock fix changed nothing on the generated setup.
- **Owner Mode's counts out of 50**, as in DEMO.md: say the open windows.
- **Any claim of AWS, Bedrock or another Amazon service.**

## Before this table

These change [DEMO.md's checklist](../DEMO.md#demo-machine-checklist), in its
last-few-minutes list.

1. **Seed F1's history after the reset, not before.** `npm run demo:reset`
   and its reload clear every `heist:` key from the browser, run history
   included (`src/lib/demo-epoch.ts`).
   - In the F1 browser tab (`/b/F1/run?m=romaine-1974`), click **Board**,
     then press **1**, **1**. The alarm goes to **Alert**.
   - Press **W** until the run ends caught: twice, on DEMO.md's walk. A run
     restarted before it ends leaves no record.
   - Click **Restart**.
   - Check that the bar shows **Forget 1 earlier run**, and that G3's Why
     card has the **Placer** line above. Then press **Esc**.
   - **Click First person before leaving the tab.** The view is one choice
     per browser (`heist:run-view` in `src/components/run/fp/view-store.ts`),
     so leaving it on Board would open the showcase Run on the board too.
2. **Keep the Owner tab on the showcase building**, as DEMO.md prepares it.
3. **End on Plan.** In the checklist's last item, skip step 6: leave the
   first tab on the showcase Plan, its board drawn, with the window in front.
   At 0:00, click the Owner tab.
   - The first tab then sits in the background for beat 8, about 25 s, with
     its board drawn. DEMO.md's step 5 leaves it briefly too, but this is
     longer, and not rehearsed.
   - If Run then shows "Loading the scan", or the label says **stand-in floor
     plan**, go to 6b.
4. **On the F1 path** (the go / no-go failed), beats 6 and 6b are one:
   - The first tab's F1 run already starts from the seeded history, since it
     is the same building and mission.
   - After **Start the run**, click **Board** and do 6b's clicks there.
   - Beat 8 is F1's pair, as in DEMO.md.
5. **The seeded history also changes DEMO.md's F1 fallback walk.** G3 now
   waits off the dock corridor, so a judge is caught sooner.
6. **Afterwards,** click **Forget 1 earlier run**, or rely on the next
   table's reset, which clears it.

## Judge questions

**Most likely: "Which Amazon services did you use?"**
"None. The models are Claude on Anthropic's API. Bedrock is wired in as a
provider and left off, because Claude 5 on Bedrock answered nothing in our
tests (#165), and the track allows any model."

**Also ready: "Does it actually learn?"**
"Between runs, it remembers, in this browser only. Each finished run leaves a
record: the way in, where you were seen, and how noisy you were. The next
run posts a guard on your usual way in, and the Chief is told your history.
Forget clears it. No model is trained."

## Checked against `main`

Checked at 105d812.

- **Beat 8:** the strings are DEMO.md's, checked again in `owner-screen.tsx`,
  `derived-demo.ts` and `compare-panel.tsx`. The crew stand-in's chip reads
  **Rule-based** (`batch-panel.tsx`, `crew-batch.ts`).
- **Beat 5:**
  - The label **The crew pushes back** is in `crew-reply.tsx`, and the crew's
    prompt asks for the order's one real weakness (`src/agents/crew/prompt.ts`).
  - The board's warning heading is **Checked on the board**.
- **Beat 6:**
  - The Chief is one structured call per alarm transition
    (`src/agents/chief/chief.ts`).
  - The guards move on the engine's decision before it answers.
  - #207 merged after DEMO.md was written. At Lockdown the Chief is now asked
    once per zone, at most once every 10 s, and the radio reads each re-plan
    in full. That wasn't rehearsed on the scan.
- **Beat 6b:**
  - **Forget 1 earlier run** and its rule, disabled mid-run, are in
    `run-screen.tsx`.
  - The Why card's **Placer** line is in `why-card.tsx`.
  - The late note is `LATE_NOTE` in `chief-panel.tsx`.
  - The same move numbers on both runs: `choices` in
    `src/components/run/board.ts` numbers the player's neighbours by bearing
    alone.
  - The rest is `tests/smoke/adapt.spec.ts`, in fake mode.
- **Not confirmed from the code:**
  - a live Chief's words on F1's second run;
  - 6b played on the demo machine with the live model;
  - the first tab's scan surviving 25 s in the background (step 3 above).
