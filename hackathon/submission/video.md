# The demo video and the gallery

The optional demo video is at most 2 minutes (`hackathon/EVENT.md`). It walks
the seven beats of SPEC §2 in their order and at their lengths, so it doubles
as a rehearsal of the live demo. The gallery is seven 16:9 screenshots, one
per beat, in `media/`.

## What may be shown

Both questions are answered on the status issue (#1):

- **CoStar records: yes.** "CoStar records may appear on stage and in the
  demo video." ([Q5, 2026-11-14 09:50Z](https://github.com/Ollienel777/Insider/issues/1#issuecomment-6875471280))
- **Vexcel imagery: yes, on screen only.** "Real Vexcel imagery may appear on
  stage and in the public demo video. The repo still never stores Vexcel
  images: they stay proxied at runtime, as SPEC §4.5 says."
  ([Q3, 2026-11-14 10:00Z](https://github.com/Ollienel777/Insider/issues/1#issuecomment-6875592075))

Two consequences:

- **The video file never enters the repo.** Real aerials on screen are fine,
  but a recording that holds them is a stored Vexcel image. Upload it to
  YouTube or Vimeo (unlisted is fine) and link it from the Devpost page only.
- **The gallery is shot in fake mode.** `media/` is committed, so it holds
  only fixture data: the massing render, not an aerial, and fixture buildings,
  not kit records. The chip at the top right of every shot reads `FIXTURES`.

## Which mode to record

Record in the mode the rehearsal proved, as SPEC §2 says for the live demo:
live where a key works on the day, fake everywhere else. Per service, as of
`main` at `79a7a9b`:

| service | live on `main`? | in the video |
|---|---|---|
| Vexcel (beat 3, Scout) | yes (#57) | live if `VEXCEL_API_BASE` and `VEXCEL_API_KEY` load the aerial in rehearsal: real obliques and the ortho. Otherwise the massing render. |
| CoStar (beats 1–4) | not yet (#59 is open) | fixtures, unless #59 merges and is rehearsed |
| Matterport (beats 5–7) | not yet (#58 is open) | fixtures, unless #58 merges and is rehearsed |
| LLM: crew, Chief, agents | yes | the recorded replies, as on stage: they are deterministic and on time |

Set each service with its own variable in `.env.local` (`VEXCEL_MODE=live`,
the rest `fake`), then `npm run build`, `npm start` and `npm run demo:reset`.
The chip at the top right reads `FIXTURES` while every service is on
fixtures, and `LIVE` once any one is live (its tooltip lists those still on
fixtures, but the video doesn't show that). Each screen also names its own source above the board or the aerial (for
example `VEXCEL · MASSING FROM FIXTURES` on Scout). The narration follows
them:

- Say "real" only about what that screen's source label says is live. On a
  screen on fixtures, the narration says "fixture" or says nothing about the
  source, as the gallery does.
- The Cast and Dossier screens replay recorded agent runs ("Scripted run",
  "Recorded replay"), and the crew's reply and the Chief's orders carry
  **Recorded** labels. The narration calls them recorded runs, never live
  work.

## Recording setup

- 1920×1080, the browser full screen at 100% zoom, no extensions or bookmarks
  bar, the system clock hidden.
- `npm run demo:reset` before each take, then open `/`.
- One take per beat is fine. Cut between beats, never inside one: each beat
  shows the screen doing its own work.
- Never click **Drill** (on hold, SPEC Q8), and never press **S** on the Run
  board (sprint mode).

## Shot list and narration (2:00)

The narration is about 2.5 words a second, sized to each beat's slot. Read it
against a timer once and cut words, not beats.

| # | time | screen | on screen | narration |
|---|---|---|---|---|
| 1 | 0:00–0:10 | Missions (`/`) | The five mission cards. Click **The Romaine Street Papers**. | "Every heist in history needed a building. Pick one: the Romaine Street burglary, 1974. Our agent finds a building that fits." |
| 2 | 0:10–0:32 | Cast (`/m/romaine-1974/cast`) | The Casting Director's run replays: its todos, then the funnel, each filter with its count, the map's pins dimming. Three finalist cards. Click **Halvorsen Tower**, then **Scout it**. | "This is the Casting Director's recorded run, one filter at a time: Los Angeles, built by 1974, office, Class A or B, a big floor on the market, a scan, a dock on the aerial. Three finalists, each with its reason. We take Halvorsen Tower." |
| 3 | 0:32–0:42 | Scout (`/b/F1/scout?m=romaine-1974`) | Press **→** through E, S, W and Ortho. The tagged entries ride along. Click **Plan the job**. | "The aerial gives the ways in: the loading dock, the garage ramp, the lobby, the roof hatch." |
| 4 | 0:42–0:57 | Dossier (`/b/F1/dossier?m=romaine-1974`) | The Level Builder's replay fills the Data → Level table, then the briefing. Click **Brief the crew**. | "A deep agent built this level from the data; this is its recorded run. Built 1974: analog era, key locks, sweeping cameras. Class A: four guards. Floor 22 mostly vacant: quiet suites. The dock: the way in." |
| 5 | 0:57–1:10 | Plan (`/b/F1/plan?m=romaine-1974`) | Paste the order, press **Enter**. The crew's four steps, the ghost path, C2's sighting ringed, the pushback. Click **Start the run**. | "One order in plain English. The crew answers with a plan, and pushes back. The board checks it: camera C2 catches us in the dock corridor on the way out." |
| 6 | 1:10–1:40 | Run (`/b/F1/run?m=romaine-1974`) | Press **1**, **1**: into C2's cone. The alarm jumps to **Alert**, the Chief's orders stream in, and the guards' routes turn to match. Click guard **G4**: the Why card. **Esc**, then **W** until caught. Click **See the debrief**. | "Now walk straight in. C2 sees us: Alert. The security chief re-plans, and every order is on the board: G1 and G4 converge, G2 holds the records room, G3 cuts off the dock. Click a guard and it says which data put it there: the dock on the aerial, and Class A gives the fourth guard." |
| 7 | 1:40–2:00 | Debrief (`/b/F1/debrief?m=romaine-1974`) | Grade **D**, caught in the Dock Corridor. Drag the **Turn** slider back and forward. The Chief's decisions as a timeline. | "The debrief replays every move, ours and the guards', with each of the chief's decisions. And the search that cast this heist is the one a location scout runs on Monday: a vacant 1970s floor with a dock." |

The order to paste in beat 5:
`Go in through the dock, wait for the 2 am round to pass, take the records room.`

## The gallery

`media/`, shot on `main` at `79a7a9b` in fake mode at 1920×1080:

| file | beat | screen |
|---|---|---|
| `01-missions.png` | 1 | The mission picker: five missions, their sources and the era each needs |
| `02-cast.png` | 2 | Cast: the funnel at three finalists, Halvorsen Tower picked |
| `03-scout.png` | 3 | Scout: the massing render from the east, its five tagged entries |
| `04-dossier.png` | 4 | Dossier: the Data → Level table and the Level Builder's replay |
| `05-plan.png` | 5 | Plan: the crew's plan as a ghost path, C2's sighting and the pushback |
| `06-run.png` | 6 | Run: Alert, and the Security Chief's re-plan with each guard's order |
| `07-debrief.png` | 7 | Debrief: grade D, the replay, the Chief's decisions |

Shoot them again from the final build: `npm run build`, then `npm run gallery`
(`tests/gallery/gallery.spec.ts`). It starts its own server in fake mode,
walks the demo path, and overwrites `media/`. Update the commit above.
