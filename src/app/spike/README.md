# The first-person spike

A sandbox for epic #98: walking a real Matterport scan in first person, with a guard drawn over it. It is not part of the product and is not meant to merge. Its job is to get the feel right before the scan view is built into the Run screen.

## Run it

1. `.env.local` needs `NEXT_PUBLIC_MATTERPORT_SDK_KEY`. The key works on localhost only.
2. `npm run dev`, then open `http://localhost:3000/spike?m=MODEL_ID`. Take a `MatterportModelId` from the kit's `commercial-properties.csv`. Never commit a model id: kit data stays out of this repo.
3. Drag to look. Hold W to walk toward the blue ring. N toggles the night filter.

`/spike/vet?ids=ID,ID,...` loads each scan through the app's own adapter and tries to place the F1 level on it. Use it to find scans the game can play on.

## What to tune: `controls.ts`

Everything about looking and walking is in `controls.ts`, and nothing else is. The real scan view will import that file as it is, so work done there carries over.

The embed player has no free walking. A camera stands on a scan position and travels to another one. "Smooth" here means travel that feels continuous. Things worth trying, roughly in order of payoff:

- **Walking speed.** `WALK_METRES_PER_SECOND`, `MIN_STEP_MS` and `MAX_STEP_MS` set how long a hop takes. `Sweep.moveTo` honours `transitionTime` to within about 50 ms.
- **Not stopping between hops.** Holding W already starts the next hop when one arrives. Check whether starting it slightly before arrival is possible, and whether the player refuses a move while one is in flight (the app's `connectInsideView` in `src/adapters/matterport/live.ts` retries on that error).
- **Which position W picks.** `pickTarget` takes the legal hop nearest the centre of the view, inside `AIM_WINDOW`. Preferring nearer positions, or the one best lined up with the last hop, may feel better in a corridor.
- **Looking.** Drag-to-look uses `Camera.rotate`, which answers in under 20 ms. Pointer lock (mouse look without holding a button) would feel more like a game. `LOOK_DEGREES_PER_PIXEL` is the sensitivity.
- **Other transitions.** `sdk.Sweep.Transition` also has `INSTANT`, `FADEOUT` and `MOVEFADE`. `Camera.moveInDirection` is the player's own "walk forward".
- **Scans with close positions.** A scan whose positions are 1.5 to 2 m apart walks far more smoothly than one where they are 4 to 5 m apart. Note which scans feel good.

## The contract to keep

`attachScanControls` takes two functions from the page, and that is the whole interface:

- `target()` returns the position W would travel to now, or null.
- `step(sweepId)` travels there and resolves on arrival.

In this spike `step` flies the camera. In the game `step` will play the engine's move, and the camera will follow the player's node. So `controls.ts` must not call `Sweep.moveTo` itself, and must not decide which hops are legal: the game owns both.

## What the first spike measured

- The player's own steps take 1.5 to 2.8 s. `Sweep.moveTo` with a 500 ms travel time takes 0.7 to 1.1 s end to end.
- The camera pose streams at about 55 updates a second while moving.
- `Conversion.worldToScreen` is synchronous. Projected floor points land 2 to 13 cm from the scan's own surface at 4 to 11 m.
- The embed SDK has no `Scene` namespace, so guards are drawn on a layer over the player.
- Use a position's `puckPosition` for its floor point. `position` is the camera, about 1.5 m up.
