# The first-person spike

A sandbox for epic #98: walking a real Matterport scan in first person, with a guard drawn over it. It is not part of the product and is not meant to merge. Its job is to get the feel right before the scan view is built into the Run screen.

## Run it

1. `.env.local` needs `NEXT_PUBLIC_MATTERPORT_SDK_KEY`. The key works on localhost only.
2. `npm run dev`, then open `http://localhost:3000/spike?m=MODEL_ID`. Take a `MatterportModelId` from the kit's `commercial-properties.csv`. Never commit a model id: kit data stays out of this repo.
3. Click the view to lock the mouse, then move it to look. Esc lets go. Where the lock is refused, drag to look.
4. Hold W to walk toward the blue ring. S steps back, A and D step to a side, all without turning. Q and E, or the left and right arrows, turn. N toggles the night filter.

`/spike/vet?ids=ID,ID,...` loads each scan through the app's own adapter and tries to place the F1 level on it. Use it to find scans the game can play on.

## What to tune: `controls.ts`

Everything about looking and walking is in `controls.ts`, and nothing else is. The real scan view will import that file as it is, so work done there carries over.

The embed player has no free walking. A camera stands on a scan position and travels to another one. "Smooth" here means travel that feels continuous.

Every number is in `DEFAULT_TUNING`, with a comment saying what it does. Four of them change while the sandbox runs, and the line at the top of the screen shows their values:

| Keys | Value | What it changes |
|---|---|---|
| `[` `]` | `walkMetresPerSecond` | Walking speed |
| `-` `=` | `lookDegreesPerPixel` | Mouse sensitivity with the pointer locked |
| `,` `.` | `steerShare` | How far a held W turns the view toward each hop. 0 is off |
| `;` `'` | `bobPixels` | How far the view dips on each hop. 0 is off |

`0` puts all four back. `?speed=`, `?look=`, `?steer=` and `?bob=` set them from the address. When a set of values feels right, write them on issue #109 with the scan they were tuned on, then change `DEFAULT_TUNING`.

What the controls do, and what is still worth trying by hand:

- **Which position a key picks.** `pickTarget` scores every legal hop by how far it is from the middle of the view, by how far its length is from `strideMetres`, and, while walking, by how much it turns away from the last hop. The aim is measured as a bearing on the floor, not on the screen, so a position 1 m ahead can be walked to while looking level. `aimDegrees`, `walkAimDegrees`, `strideMetres` and `momentumWeight` are the ones to try.
- **Not stopping between hops.** While a key is held, the next hop starts on arrival: 0 to 1 ms later, measured. Hops cannot overlap, because the player drops a `moveTo` sent mid-flight. A key tapped during a hop still buys one more hop. A held key with nothing in aim waits, and goes the moment the view turns to a position.
- **Walking speed.** `stepMs` asks for the hop's length over the walking speed, less the 35 ms the player adds. `minStepMs` and `maxStepMs` bound it.
- **Steering.** Walking forward turns the view part of the way to each hop, so a held W follows a corridor's bends. It stops for 250 ms whenever the mouse moves, so it never fights the hand.
- **Looking.** Mouse movement is added up and sent as one `Camera.rotate` a frame. It works during a hop. The pointer lock asks for raw input where the browser has it.
- **The footstep dip.** Each hop eases in and out, so the camera is still for an instant at every position. The dip makes that pulse read as a step. It needs a person's eye: turn it off with `;` if it is worse than nothing.
- **Still to try.** `sdk.Sweep.Transition` also has `INSTANT`, `FADEOUT` and `MOVEFADE`. A scan whose positions are 1.5 to 3 m apart walks far more smoothly than one where they are 4 to 5 m apart: note which scans feel good.

## The contract to keep

`attachScanControls` takes two functions from the page:

- `target(intent?)` returns the position a walk key would travel to now, or null. With no intent it answers for W. The intent says which way (`heading`: 0 forward, 180 back, -90 and 90 to the sides) and whether the hop follows straight on from another (`chained`).
- `step(sweepId, intent?)` travels there and resolves on arrival.

In this spike `step` flies the camera. In the game `step` will play the engine's move, and the camera will follow the player's node. So `controls.ts` must not call `Sweep.moveTo` itself, and must not decide which hops are legal: the game owns both. `pickTarget` only chooses among the hops it is given.

Three more options are there to use or leave out: `bearingTo` turns steering on, `bob` names the element that dips, and `onState` reports the pointer lock, the walk, and a held key with nowhere to go.

`createWalker` is the walk with no DOM in it, and `controls.test.ts` covers it along with the geometry, `stepMs` and `pickTarget`.

## What the first spike measured

- The player's own steps take 1.5 to 2.8 s. `Sweep.moveTo` with a 500 ms travel time takes 0.7 to 1.1 s end to end.
- The camera pose streams at about 55 updates a second while moving.
- Between positions already seen, `Sweep.moveTo` takes its `transitionTime` plus about 35 ms. A position seen for the first time can stall one frame for 60 to 190 ms, and now and then a hop for half a second, while its images load.
- Forward is (-sin yaw, -cos yaw) on x and z, with `pose.rotation.y` as yaw in degrees. `Camera.rotate(+h, +v)` turns right and looks up, and works during a flight.
- A `moveTo` sent while another is in flight resolves at once and does nothing.
- `Conversion.worldToScreen` is synchronous. Projected floor points land 2 to 13 cm from the scan's own surface at 4 to 11 m.
- The embed SDK has no `Scene` namespace, so guards are drawn on a layer over the player.
- Use a position's `puckPosition` for its floor point. `position` is the camera, about 1.5 m up.
