# Design direction: Heist Anywhere

Every screen is built and reviewed against this file and the `ui-craft`
skill. The primary path is the seven screens of the demo script in
`SPEC.md` §2: Map, Scout, Dossier, Plan, Run, Debrief, Drill.

## Tone and references

A night-shift operations console that happens to be a game. Calm, exact,
a little cinematic. The data is the star; the game reads it.

- **Linear**: the density of the side panels, keyboard-first control, and
  the restraint of a near-black surface with one accent.
- **Hitman GO**: the board as a tabletop diorama. Discrete nodes, pieces
  that hop, cones you can count. Clear rules you can see.
- **Hitman's mission briefings**, only in the Dossier's typography: a mono
  caps label over one short line of copy. Nothing else borrows from them.

## Theme

**Dark only.** The game is a night heist, a dark board makes cones and
guard pieces readable, and dark reads as premium on the demo video and on
a laptop screen at a judging table. A light theme is not shipped. Every
text token is checked to AA on `--surface-0` and `--surface-1`.

## Tokens

Written as CSS variables in `src/app/globals.css` and mapped into the
Tailwind theme. Components use these names only, never raw values.

### Colour

```css
:root {
  /* neutrals (cool slate) */
  --n-950: #07090c;  --n-900: #0c1015;  --n-850: #11161d;  --n-800: #171d26;
  --n-700: #232b37;  --n-600: #323c4b;  --n-500: #4a5566;  --n-400: #6b7686;
  --n-300: #939caa;  --n-200: #bcc3cd;  --n-100: #e1e5ea;  --n-50:  #f4f6f8;

  /* surfaces */
  --surface-0: var(--n-950);   /* page, board backdrop */
  --surface-1: var(--n-900);   /* panels */
  --surface-2: var(--n-850);   /* raised rows, inputs */
  --surface-3: var(--n-800);   /* hover */
  --border:        var(--n-700);
  --border-strong: var(--n-600);

  /* text */
  --text-1: var(--n-50);    /* primary */
  --text-2: var(--n-300);   /* secondary, AA on surface-0/1 */
  --text-3: var(--n-400);   /* labels only, 12px mono caps, never body */

  /* the one accent: signal amber, the colour of a lit window at night */
  --accent:        #f2a93b;
  --accent-hover:  #f6bb5f;
  --accent-active: #d98f22;
  --accent-ink:    #1a1206;  /* text on accent */
  --accent-wash:   rgb(242 169 59 / 0.12);

  /* semantic, used only for their meaning */
  --success: #3ccf91;   /* objective taken, drill floor clear */
  --warning: #f5d547;   /* Suspicious, crew warning */
  --danger:  #ff5a5f;   /* Alert, Lockdown, detected, blocked stair */

  /* data layers: only on 8px layer dots, the provenance thread, the Layer lens */
  --layer-costar:     #7aa7ff;
  --layer-vexcel:     #c08cff;
  --layer-matterport: #4fd1c5;
}
```

The accent is reserved for the primary action on each screen, the player's
piece and path, and the selected element. Alarm states use the semantic
colours. Layer hues never fill a surface or a button.

### Type

- **Family:** Inter (variable, preloaded via `next/font`), with
  `font-feature-settings: "tnum", "cv11"` on every number.
- **Mono:** JetBrains Mono for data values, ids (G2, C3, Suite 1802), the
  trace and the uppercase labels.
- **Weights:** 400, 500, 600. Nothing else.

| step | size / line height | use |
|---|---|---|
| `xs` | 12 / 16 | mono caps labels (`letter-spacing: 0.06em`), chips |
| `sm` | 14 / 20 | panel body, table rows, trace |
| `base` | 16 / 24 | prose: briefing, rationale, Why card |
| `lg` | 20 / 28 | panel titles |
| `xl` | 24 / 32 | screen titles |
| `2xl` | 32 / 40 | building name on Scout and Dossier |
| `3xl` | 48 / 52 | alarm state banner, the debrief grade, drill time to clear |

### Space

4px base. Steps in use: 4, 8, 12, 16, 24, 32, 48, 64. Panels pad 16; rows
pad 12 × 16; the gap between panels is 16; screen gutters 24.

### Radius, elevation, motion, breakpoints

- **Radius:** `--r-sm: 6px` (chips, inputs, buttons), `--r-md: 10px` (panels,
  cards). No other values; no pills except the mode chip.
- **Elevation:** `--e-1: 0 1px 0 rgb(255 255 255 / 0.04) inset, 0 1px 2px rgb(0 0 0 / 0.4)`
  for panels; `--e-2: 0 12px 32px rgb(0 0 0 / 0.5)` for the Why card and
  menus only. No glows.
- **Motion:** `--t-fast: 150ms`, `--t-base: 200ms`, `--t-slow: 300ms`,
  easing `cubic-bezier(0.2, 0, 0, 1)` (ease-out, no bounce). A guard's hop is
  `--t-slow`; the player's hop `--t-base`; panel enter `--t-base`. Under
  `prefers-reduced-motion`, hops become instant and streams appear whole.
- **Breakpoints:** `md 768`, `lg 1024`, `xl 1280`, `2xl 1440`. Designed at
  1440×900, checked at 1280×720 (video) and 390×844 (mobile, where side
  panels stack under the board and the board stays usable by tap).

## Layout

- **App shell.** A 56px top bar: the wordmark "Heist Anywhere" left; the
  building name and city centre once one is picked; the **mode chip** right
  (`FIXTURES` in `--text-2` mono, or `LIVE` with a 6px `--success` dot; when
  mixed, it lists the services on fixtures in its tooltip). Under it, on
  building screens, a **step rail**: Scout · Dossier · Plan · Run · Debrief, with Drill
  set apart at the right end after a divider. The current step is
  `--text-1` with a 2px accent underline; done steps show a check.
- **Content.** Full width. Building screens use a two-column grid: the
  visual (aerial, board, drill view) takes the remaining width; a 400px side
  panel on the right holds the text and the one primary action, pinned to the
  panel's bottom edge. The Dossier is the exception: a 720px reading column
  with the data table at full column width.
- **One primary action per screen**, always an accent button at the bottom
  of the side panel: Map "Scout this building", Scout "Plan the job",
  Dossier "Brief the crew", Plan "Start the run", Run (none until the end;
  then "See the debrief"), Debrief "Run the drill", Drill "Print drill plan".
- **Keyboard.** Arrow keys orbit on Scout; on Run, number keys pick a
  neighbouring node (each neighbour shows its number), `W` waits, `Space`
  confirms; `?` shows the keys; `Esc` closes the Why card.

## Components

shadcn/ui (Radix) restyled to the tokens: Button (primary = accent,
secondary = `--surface-2` with `--border`, ghost), Input/Textarea, Tooltip,
Popover (the Why card), Tabs, Table, Slider (the replay scrubber), Skeleton,
Toast (errors, fallbacks). Icons: `lucide-react` at 16px with 1.5 stroke;
no emoji anywhere. Custom: `LayerDot`, `ModeChip`, `AlarmBanner`,
`TraceList`, `ProvenanceRow`.

## The signature element: the provenance thread

Click any guard, camera, lock or zone on the board and a 1px line in that
element's layer colour draws (`--t-slow`) from the piece to the Why card,
which opens beside it. The card lists each input as a `ProvenanceRow`:
layer dot, layer name, the field in mono, its value, then the rule in plain
words, then the result:

```
● CoStar   yearBuilt   1974    → before 1980: analog era → key lock, 2 turns to pick
● Vexcel   entry       dock-N  → only truck-height door → guard posted here
● CoStar   class       A       → 4 guards (this is G4)
```

The same three layer colours appear as dots on the map pins, as the
Dossier's Data → Level table's first column, and in the Layer lens (a
toggle on the Run board that tints every element by its source). That
thread, from a piece to a field, is the product's picture in a gallery.

## The hero screen: Run, at the wow beat

```
┌ top bar ─ Heist Anywhere ───── Halvorsen Tower · Los Angeles ───── FIXTURES ┐
├ Scout ✓ · Dossier ✓ · Plan ✓ · Run · Debrief                       │ Drill  ┤
│                                                     │ ALERT          (48px, │
│        isometric board (orthographic camera,        │  danger)  turn 14     │
│        rooms as low dark tiles, nodes as discs,     │───────────────────────│
│        guards as pawns, cones as translucent        │ SECURITY CHIEF        │
│        wedges, player in accent with its path)      │ Lost them by the      │
│                                                     │ freight lift. G3 holds│
│     G1 ◢◤ ─ ─ ●player ─ ─ C2 ◣                       │ the dock. G1 and G2   │
│                                                     │ sweep east to west.▍  │
│                                                     │ ─ orders ─            │
│                                                     │ G1 sweep  Open office │
│ [1][2][3] neighbour keys    Layer lens ○            │ G3 block  Dock        │
└─────────────────────────────────────────────────────┴───────────────────────┘
```

What happens at each step:

1. **Calm.** The board is quiet: cones are `--n-500` at 20% opacity; the
   panel shows the objective and the crew's plan steps, the next one
   highlighted.
2. **The trip.** The player hops into a cone. In under 100 ms the cone
   flashes `--danger`, the banner changes to ALERT (`3xl`, `--danger`), and
   guards start moving on the engine's converge rule. Nothing waits.
3. **The re-plan.** The Chief's rationale streams in word by word under its
   mono caps label, then the orders list fills row by row. As each order
   lands, that guard's next three hops draw as a dashed line in
   `--danger` at 60%, so the room sees the plan change.
4. **The Why card.** Clicking a guard draws the provenance thread and opens
   the card at `--e-2`.

The banner, the cones and the guards are readable from three metres: the
board fills at least 65% of the 1440 width and pieces are at least 28px.

## The other demo screens

- **Map.** A dark static basemap of the city, desaturated to `--n-800`
  tones, with five pins. Each pin is a 12px disc with three layer dots
  beneath; hover shows a compact card (name, neighbourhood, built, class,
  stories). The side panel lists the buildings as rows; selecting a row or
  pin highlights both. City switch LA / Houston as Tabs.
- **Scout.** The aerial fills the visual area; four direction chips (N E S
  W) and Ortho under it; entry markers are 24px accent rings with a mono
  label; selecting one shows its note in the panel ("Dock, north face:
  the only truck-height door").
- **Dossier.** Three blocks streamed in order as the trace replays: the
  trace (`TraceList`: todos tick, subagent tasks indent, tool calls in mono
  with their duration), the Data → Level table, then the briefing as `base`
  prose under the mission title with its "Inspired by" line and source link.
  Skeleton rows hold each block's final height before it fills.
- **Plan.** The board at reduced emphasis with the ghost path in accent at
  50%; the panel holds the order Textarea (placeholder: "Tell the crew how
  you want to play it"), the crew's numbered steps, and the warning in a
  `--warning` left-bordered row naming the camera and the turn.
- **Debrief.** The grade in `3xl`, three stats (turns, noise, detections)
  in tabular mono, the replay board with a Slider scrubber, and the Chief's
  decisions as a vertical timeline beside it.
- **Drill.** The same board in a cooler treatment: occupants as small
  `--n-200` dots that flow to stairs, the blocked stair struck through in
  `--danger`; the panel holds the time to clear in `3xl`, the bottleneck,
  per-zone clear times as a table, warden posts, and the disclaimer.

## States

- **Loading:** skeletons shaped like the final layout; the dossier's trace
  is itself the progress view. No spinner alone over a second.
- **Model latency:** the crew panel shows "Crew is planning…" with the
  steps' skeleton; the Chief's panel shows its label and a 1-line skeleton,
  while guards already move.
- **Fallback:** when an adapter falls back to fixtures, a toast says which
  ("CoStar didn't answer, so this building uses fixtures") and the mode
  chip updates. A recorded crew or Chief reply carries a small `recorded`
  chip.
- **Empty:** Map with no buildings in a city says so and offers the other
  city. Debrief with no run offers "Start the run".
- **Error:** what happened and the one recovery action ("Retry", "Use
  fixtures").
- **Success:** objective taken shows a `--success` toast and the exit nodes
  pulse once; drill floor clear ticks each zone row.

## Data and copy voice

- **Fixtures** are the five buildings in `SPEC.md` §7, with suite numbers,
  square feet, timestamps (02:10, 02:14), and room labels a real floor has.
  Never "Building 1", "Guard A" or round placeholder numbers. Guards are
  G1–G4, cameras C1–C6: ids, never names; no people are depicted.
- **Voice:** short, exact, present tense, second person for the player
  ("You're in. The 02:20 round passes the dock in two turns."). The Chief
  speaks in clipped radio style. Sentence case everywhere; mono caps only
  for labels. No exclamation marks, no "Welcome to…", no "AI-powered".
- **Disclaimers** are one calm line in `--text-2`: "Security shown is game
  fiction derived from building class and era." and, on Drill, "A planning
  aid, not a life-safety calculation. Headcount is estimated from CoStar's
  occupied area."

## Don'ts for this product

- No neon "hacker" green, no glitch effects, no scanlines, no terminal
  pastiche.
- No crime-glamour imagery: no guns, masks, money bags or blood. Pieces are
  abstract pawns.
- No real people, tenant names or logos; no imagery of a building's actual
  security.
- Layer colours never fill a surface or a button; the accent never marks an
  alarm.
- No full-screen modals: the Why card is a popover, the briefing is inline.
- No 3D camera fly-throughs that cost demo seconds; the board camera is fixed
  isometric with a gentle 200ms re-centre on the player.
