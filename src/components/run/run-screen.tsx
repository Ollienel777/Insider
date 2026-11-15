"use client";

import Link from "next/link";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getMatterport, insideViewFor, scanMeshModelFor } from "@/adapters/matterport";
import { buildingHref } from "@/lib/building-href";
import { useMissionId } from "@/lib/use-mission-id";
import { LayerDot } from "@/components/shell/layer-dot";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Building, FloorGraph, LateChief, LevelManifest } from "@/domain";
import { act, applyChiefOrders, createRun, withPursuit, type Action, type Pursuit, type RunState } from "@/engine";
import { placeLevel, type PlacedLevel } from "@/level/placer";
import { objectiveNoun } from "@/lib/objective-noun";
import { floorLabel, placedFloor, RECORD_LABEL, recordLabel } from "@/lib/record-label";
import { cn } from "@/lib/utils";
import { AlarmBanner } from "./alarm-banner";
import {
  actionForKey,
  canTake,
  choices as choicesOf,
  crewPlanSteps,
  describeTurn,
  guardOrders,
  planSteps,
  roomName,
  toggleSprint,
  WALK_STATUS,
  zoneName,
  type Choice,
  type Mode,
} from "./board";
import { BoardView } from "./board-view";
import { LensLegend, LensToggle, useLayerLens } from "./layer-lens";
import { LiveControls } from "./live-controls";
import { panelsOpen, RunLayout, useDetails } from "./live-layout";
import { endNote, usePlayHud } from "./play-hud";
import { usePlayMode } from "./play-mode";
import { LIVE_TURN_MS, useTurnClock } from "./turn-clock";
import { realTimePursuit } from "./pursuit";
import { FirstMoveHint } from "./fp/first-move-hint";
import { ChiefPanel, hiddenRoutes, useChiefStream, type ChiefState } from "./chief-panel";
import { askChief, chiefRequest, chiefZones, toEngineOrders, type ChiefAnswer } from "./chief-request";
import { ChiefCalls, askDelay, afterFailure, type AskedAbout } from "./chief-calls";
import { loadCrewPlan, PLAN_HEADING, planSourceOf, type StoredCrewPlan } from "./crew-plan-store";
import { clearRunLog, keepRunLogInMemory, runLogOf, saveRunLog } from "./run-log-store";
import { appendRunHistory, chiefHistory, clearRunHistory, loadRunHistory, postureOf, runRecordOf, type RunRecord } from "./run-history";
import { MuteToggle, useRunSound } from "./run-sound";
import { RunStage } from "./run-stage";
import { placeOrFixture } from "./scan-fallback";
import { ScanWait, useWaitsOnScan } from "./scan-wait";
import { fullscreenStep } from "./fp/fullscreen";
import { FIRST_PERSON_TURN_MS, firstPersonPace, firstPersonOn, FirstPersonView, FP_UNAVAILABLE, FullscreenToggle, scanLookOf, useBark, useStageFullscreen, useRunView, useScanPreload, ViewSwitch, type HeldAction } from "./fp/run-view";

export type RunBuilding = Pick<Building, "id" | "name" | "matterportModelId">;

/**
 * What the status line says as a run opens at `entry`: how to move, in the
 * controls of the view the run is played in. On the board, the numbers; in
 * first person, W to walk and the mouse to look, as its first-move hint says.
 */
export function openingLine(entry: string, firstPerson: boolean): string {
  return `You're in at the ${entry.toLowerCase()}. ${firstPerson ? "W to walk, the mouse to look." : "Pick a number to move."}`;
}

/** The seed every run of the demo uses, so a rehearsed run plays the same way in front of judges. */
export const RUN_SEED = 7;

/** Where the run's log is kept for the Debrief (SPEC §4.1: run logs live in localStorage). */
export { runLogKey } from "./run-log-store";

/**
 * The level placed on `floor`, whether the floor is a live scan, and whether
 * the runs on it stay out of browser storage (`inMemory`). A board from the
 * scan names its sweeps (SPEC §4.5), and a CoStar kit building's level is
 * derived from its real record, which stays in memory (#93), on any floor
 * (#95). So for either, before any run writes its log, the log is kept in
 * memory, and no run joins the stored history. Call this before `startRun`.
 */
export function boardOn(
  buildingId: string,
  manifest: LevelManifest,
  floor: FloorGraph,
  posture: Parameters<typeof placeLevel>[4] | undefined,
  missionId: string | null | undefined,
  // Required: a caller that left it out would store a kit building's runs.
  source: Building["source"],
): { placed: PlacedLevel; live: boolean; inMemory: boolean } {
  const live = floor.source === "matterport";
  const inMemory = live || source === "costar";
  keepRunLogInMemory(buildingId, inMemory, undefined, missionId);
  return { placed: placeLevel(manifest, floor, RUN_SEED, undefined, posture), live, inMemory };
}

type Load =
  | { status: "loading" }
  | { status: "ready"; placed: PlacedLevel; floor: FloorGraph; live: boolean; inMemory: boolean; history: readonly RunRecord[] }
  | { status: "no-floor" }
  | { status: "error"; message: string };

/**
 * The Run screen (SPEC §2 beat 5, DESIGN.md the hero screen): the isometric
 * board on the left, the alarm, the objective, the plan and the guards'
 * orders on the right. The floor comes from the Matterport adapter in the
 * browser (SPEC §4.5), the placer turns the cached manifest into a level on
 * it, and the engine plays it. Keys: 1–9 a neighbour, W wait, Space take,
 * S sprint (the numbers then mark nodes two open hops away; S or Esc walks).
 * In Live (issue 99) a turn the player lets run out is played by the clock; P pauses it.
 * Live also changes what shows (issue 100, live-layout.tsx): the objective line, the danger
 * meter and the radio line around the board, and the rest closed until Details (D) opens it.
 */
export function RunScreen({
  building,
  manifest,
  heistMode,
  source,
}: {
  building: RunBuilding;
  /** The cached manifest; null when the building has no level yet. */
  manifest: LevelManifest | null;
  heistMode?: string;
  /** The building's source: a CoStar kit building is labelled with its real record and its floor, and its runs stay out of storage (#95). */
  source: Building["source"];
}) {
  const [loaded, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  /** The runs stored for this building now: what the Forget button would clear. */
  const [storedRuns, setStoredRuns] = useState(0);
  const [run, setRun] = useState<RunState | null>(null);
  const [status, setStatus] = useState<string>("");
  /** The way in the run opened at, while the status line still says so: first person words it for its own keys. */
  const [opening, setOpening] = useState<string | null>(null);
  const [muted, toggleMute] = useRunSound(run);
  const missionId = useMissionId();
  /** Walking or sprinting (issue 121): `S` switches; any action, and Restart, go back to walking. */
  const [mode, setMode] = useState<Mode>("walk");
  /** The board or first person (issue 115): first person hands its actions to `play`, like a key. */
  const runView = useRunView();

  // The Security Chief: one call per alarm event, answered between turns.
  // Nothing waits on it: the engine already has the guards converging.
  const [chief, setChief] = useState<ChiefState>({ status: "idle" });
  const latestRun = useRef<RunState | null>(null);
  const pendingChief = useRef<AbortController | null>(null);
  const chiefCalls = useRef(new ChiefCalls());
  /** The last event a Chief call went out about, so a Lockdown re-sighting doesn't re-ask on every sweep (issue 190). */
  const askedAbout = useRef<AskedAbout | null>(null);
  /** A Lockdown re-sighting in a new zone that came too soon: asked about once the radio has had its time. */
  const deferredChief = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the turns run on the clock (Live, or first person): only then does a re-plan wait for the radio. */
  const clocked = useRef(false);
  /** Real-time play's longer memory for the guards (pursuit.ts): null on the turn-based board. */
  const pursuit = useRef<Pursuit | null>(null);
  /** Turn number → where the Chief's orders logged on that turn came from, for the Debrief. */
  const chiefSources = useRef(new Map<number, ChiefAnswer["source"]>());
  /** The Chief's answer that landed after the run ended, if one did. */
  const lateChief = useRef<LateChief | null>(null);
  /** The way in the placed level's watch post stands near (#35), logged so the Debrief places the same board. */
  const watchEntry = useRef<string | undefined>(undefined);

  /**
   * Puts a fresh run on the board, on opening and on Restart: no Chief call
   * out, no orders, and its own empty log in storage at once, in place of the
   * last run's, so the Debrief never shows a run the board has left.
   */
  const startRun = useCallback((level: PlacedLevel["level"]) => {
    pendingChief.current?.abort();
    pendingChief.current = null;
    chiefCalls.current.reset();
    askedAbout.current = null;
    if (deferredChief.current) clearTimeout(deferredChief.current);
    deferredChief.current = null;
    chiefSources.current = new Map();
    lateChief.current = null;
    setChief({ status: "idle" });
    const fresh = createRun(level);
    latestRun.current = fresh;
    setRun(fresh);
    setMode("walk");
    saveRunLog(runLogOf(fresh, chiefSources.current, null, watchEntry.current), undefined, missionId);
  }, [missionId]);

  /**
   * Places the level on `floor` from the history stored now and starts a run on it: on opening,
   * and on a Restart after a run ended, which has just joined the history (#35). Throws as the placer does.
   */
  const placeAndStart = useCallback(
    (level: LevelManifest, floor: FloorGraph): PlacedLevel => {
      // Earlier runs here set the guards' starting posture (#35): the placer takes it as an input.
      // A kit building has none stored, and one stored before #95 is removed here.
      const history = loadRunHistory(building.id, undefined, missionId, source === "costar");
      const { placed, live, inMemory } = boardOn(building.id, level, floor, postureOf(history), missionId, source);
      setLoad({ status: "ready", placed, floor, live, inMemory, history });
      setStoredRuns(history.length);
      watchEntry.current = placed.watch?.entryId;
      startRun(placed.level);
      return placed;
    },
    [building.id, startRun, missionId, source],
  );

  // The board needs the room: while Run is open the desk's margins are thinner (globals.css). The game's
  // card, the mode chip and the tabs stay.
  useEffect(() => {
    document.body.classList.add("playing");
    return () => document.body.classList.remove("playing");
  }, []);

  // Full window, for the demo: the Run screen takes the whole window, with no top bar, no tabs and no
  // folder edge, and a tighter HUD (globals.css). Off until switched on; the browser remembers the choice.
  // The end card and the end action still lead to the Debrief; the switch brings the tabs back.
  const [fullWindow, setFullWindow] = useState(false);
  // Read after mount, as the run view is (view-store.ts), so the server's render and the browser's first agree.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setFullWindow(localStorage.getItem(FULL_WINDOW_KEY) === "on");
      } catch {
        // No storage: the switch still works for this page.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const toggleFullWindow = useCallback(() => {
    setFullWindow((on) => {
      try {
        if (on) localStorage.removeItem(FULL_WINDOW_KEY);
        else localStorage.setItem(FULL_WINDOW_KEY, "on");
      } catch {
        // No storage: the choice lasts for this page.
      }
      return !on;
    });
  }, []);
  useEffect(() => {
    if (!fullWindow) return;
    document.body.classList.add("run-full");
    return () => document.body.classList.remove("run-full");
  }, [fullWindow]);

  useEffect(() => {
    if (!manifest) return;
    let live = true;
    // Until the board has its fresh run, there is no run on it: the last one's log goes now.
    clearRunLog(building.id, undefined, missionId);
    const matterport = getMatterport(heistMode);
    const abandon = new AbortController();
    matterport.adapter
      .loadFloor(building, abandon.signal)
      .then(
        async (floor) => {
          if (!live) return;
          if (!floor) return setLoad({ status: "no-floor" });
          // A scan the level can't be placed on falls back to the fixture floor, and the chip says so.
          const placed = await placeOrFixture(building, floor, (on) => (live ? placeAndStart(manifest, on) : null));
          if (!live) return;
          if (!placed) return setLoad({ status: "no-floor" });
          setStatus(openingLine(placed.entries[0].label, false));
          setOpening(placed.entries[0].label);
        },
        (error: unknown) => {
          if (live) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
        },
      )
      .catch((error: unknown) => {
        if (live) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      live = false;
      // Nobody is waiting for this load now (the screen closed, or the stand-in floor plan was taken): a scan stops loading.
      abandon.abort();
    };
  }, [building, manifest, heistMode, attempt, placeAndStart, missionId]);

  const load: Load = manifest ? loaded : { status: "no-floor" };
  // While the floor loads, the bar says "from fixtures" only once the browser knows no scan is loading:
  // on a live scan the skeleton says what it waits for, and before the demo status is in, nobody knows.
  const sourcePending = useWaitsOnScan(building, heistMode) !== false && load.status === "loading";
  const placed = load.status === "ready" ? load.placed : null;
  // The placement and the Chief's summary use `history`, read when the level was placed; the
  // Forget button uses `storedRuns`, which also counts a run that ended since.
  const history = load.status === "ready" ? load.history : null;
  const floor = load.status === "ready" ? load.floor : null;
  const zones = useMemo(() => (placed ? chiefZones(placed) : null), [placed]);
  // The Inside view, on the stage beside the board: only on a floor that came from a live scan (never on fixtures, so the demo path is unchanged).
  const liveScan = load.status === "ready" && load.live;
  // Runs that stay out of storage: on a live scan, and for a kit building on any floor (`boardOn`).
  const inMemory = load.status === "ready" && load.inMemory;
  const openInside = useMemo(() => (liveScan ? insideViewFor(building, heistMode) : null), [liveScan, building, heistMode]);
  // First person on a live scan stands on the scan's own mesh (issue 118): the model id stays in this page's memory.
  const scanModel = useMemo(() => (liveScan ? scanMeshModelFor(building, heistMode) : null), [liveScan, building, heistMode]);
  // Its mesh starts loading as soon as the floor is the scan's, so it is in by the time first person is chosen.
  const scan = useScanPreload(scanModel);
  const scanFailure = scan?.failed ?? null;
  useEffect(() => {
    if (!scanFailure || runView.view === "board") return;
    // The status line says why the board is back, once the failure is in.
    const timer = setTimeout(() => setStatus(scanFailure), 0);
    return () => clearTimeout(timer);
  }, [scanFailure, runView.view]);

  // The crew's plan from the Plan screen, read after mount (storage is the browser's).
  const [crewPlan, setCrewPlan] = useState<StoredCrewPlan | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setCrewPlan(loadCrewPlan(building.id, undefined, missionId, source === "costar")), 0);
    return () => clearTimeout(timer);
  }, [building.id, missionId, source]);

  useEffect(() => {
    latestRun.current = run;
  }, [run]);
  useEffect(
    () => () => {
      pendingChief.current?.abort();
      if (deferredChief.current) clearTimeout(deferredChief.current);
    },
    [],
  );

  // A call out is let finish when the alarm moves again; the newest event that waited is asked about after it (issue 172).
  const callChiefNext = useRef<(state: RunState, seq: number, queued: boolean) => void>(() => {});
  const callChief = useCallback(
    (state: RunState, seq: number, queued = false, force = false) => {
      if (!placed || !zones) {
        // No board to ask about: a queued call must not hold the queue shut.
        if (queued) chiefCalls.current.reset();
        return;
      }
      const event = state.alarmEvents[seq];
      // A Lockdown re-sighting in the same place asks nothing: the orders out still stand. One in a new
      // zone too soon after the last re-plan waits, so the radio reads that re-plan in full (issue 190).
      const now = performance.now();
      // Retry is the player asking: it always goes, whatever was asked about last.
      const delay = event && !force ? askDelay(event, askedAbout.current, now, clocked.current) : 0;
      if (delay !== 0) {
        // A queued call skipped: free the queue, so the next event can ask.
        if (queued) chiefCalls.current.reset();
        if (delay !== null) {
          // Only the newest waits: when its time comes, the run's newest event is asked about, if still worth it.
          if (deferredChief.current) clearTimeout(deferredChief.current);
          deferredChief.current = setTimeout(() => {
            deferredChief.current = null;
            const current = latestRun.current;
            if (current && current.alarmEvents.length > 0) callChiefNext.current(current, current.alarmEvents.length - 1, false);
          }, delay);
        }
        return;
      }
      if (!queued && !chiefCalls.current.ask(seq)) return;
      // Asked about now: a re-sighting waiting for its time has nothing left to ask.
      if (deferredChief.current) clearTimeout(deferredChief.current);
      deferredChief.current = null;
      const before = askedAbout.current;
      const asked: AskedAbout | null = event ? { to: event.to, zone: event.lastKnownZone, at: now } : null;
      if (asked) askedAbout.current = asked;
      // A call that fails counts as not asked, so Retry, or the next re-sighting there, asks again.
      const forget = () => {
        if (asked) askedAbout.current = afterFailure(askedAbout.current, asked, before);
      };
      const controller = new AbortController();
      pendingChief.current = controller;
      // This call is done: the newest event that waited behind it goes next, on the run as it stands now.
      const next = () => {
        const waiting = chiefCalls.current.settled(seq);
        if (waiting === null) return;
        if (latestRun.current) callChiefNext.current(latestRun.current, waiting, true);
        else chiefCalls.current.reset();
      };
      let request: ReturnType<typeof chiefRequest>;
      try {
        // The run's first transition carries the summary of earlier runs, so the Chief's first word can adapt.
        const watch = placed.watch;
        const summary =
          seq === 0 && history
            ? chiefHistory(history, zones, watch ? { guardId: watch.guardId, zoneId: watch.entryId, startZone: watch.startZone } : undefined)
            : null;
        request = chiefRequest({ buildingId: building.id, missionId }, placed, zones, state, state.alarmEvents[seq], summary);
      } catch (error) {
        // A board the request can't carry: the panel says so, and the turn (and its log) goes on.
        setChief({ status: "error", seq, message: error instanceof Error ? error.message : String(error) });
        forget();
        next();
        return;
      }
      // A queued call leaves an answer before it on the panel until its own lands, so that answer is seen;
      // an error before it gives way to "pending", so the panel never reads as failed while a call is out.
      // So does a re-plan at Lockdown: the radio keeps reading the answer on air until the new one lands.
      const reask = event?.from === "lockdown" && event.to === "lockdown";
      setChief((shown) => ((queued || reask) && shown.status === "ready" ? shown : { status: "pending", seq }));
      askChief(request, { signal: controller.signal }).then(
        (answer) => {
          // Aborted by a restart or by leaving the screen, or a call from before a restart: stale.
          if (controller.signal.aborted || !chiefCalls.current.isOut(seq)) return;
          if (!latestRun.current) return next();
          // A newer alarm event may be waiting: its call goes once these orders are on the board.
          queueMicrotask(next);
          const current = latestRun.current;
          const orders = toEngineOrders(answer.orders, zones);
          const result = applyChiefOrders(current, orders);
          if (current.status !== "playing") {
            // The run ended before the answer landed (a sighting on the catching turn): the panel
            // still shows it, marked late, but no guard moves on it. The log keeps it as a late
            // decision, so the Debrief lists every re-plan the player watched.
            lateChief.current = { turn: current.turn, chief: orders, chiefSource: answer.source };
            saveRunLog(runLogOf(current, chiefSources.current, lateChief.current, watchEntry.current), undefined, missionId);
            setChief({ status: "ready", seq, answer, applied: result, late: true });
            return;
          }
          // The next turn's log entry carries these orders, under that turn's number. Until then
          // the log keeps them as pending, so a Debrief opened between turns lists them.
          chiefSources.current.set(result.run.turn, answer.source);
          latestRun.current = result.run;
          setRun(result.run);
          saveRunLog(runLogOf(result.run, chiefSources.current, lateChief.current, watchEntry.current), undefined, missionId);
          setChief({ status: "ready", seq, answer, applied: result });
        },
        (error: unknown) => {
          if (controller.signal.aborted || !chiefCalls.current.isOut(seq)) return;
          setChief({ status: "error", seq, message: error instanceof Error ? error.message : String(error) });
          forget();
          next();
        },
      );
    },
    [placed, zones, history, building.id, missionId],
  );
  useEffect(() => {
    callChiefNext.current = (state, seq, queued) => {
      // A run that has ended asks nothing more.
      if (state.status === "playing") callChief(state, seq, queued);
      else chiefCalls.current.reset();
    };
  }, [callChief]);

  const play = useCallback(
    (action: Action) => {
      if (!placed || !run) return;
      // In real-time play the guards keep after the player for seconds, not three short turns (pursuit.ts).
      const result = act(withPursuit(run, pursuit.current), action);
      if (!result.ok) {
        setStatus(`Not possible: ${result.reason}.`);
        return;
      }
      setMode("walk");
      latestRun.current = result.run;
      setRun(result.run);
      setStatus(describeTurn(placed, run, result.run));
      if (result.run.alarmEvents.length > run.alarmEvents.length) callChief(result.run, result.run.alarmEvents.length - 1);
      // A run that just ended joins the history; the next visit's guards start from it. Not on a
      // live scan (a record names the scan's rooms, and SPEC §4.5 keeps scan data out of storage),
      // nor for a kit building, whose level comes from its real record (#95): `inMemory`.
      try {
        const record = run.status === "playing" && !inMemory ? runRecordOf(result.run) : null;
        if (record) {
          appendRunHistory(building.id, record, undefined, missionId);
          // The Forget button counts what is stored now, not what this run was placed from.
          setStoredRuns(loadRunHistory(building.id, undefined, missionId).length);
        }
      } catch {
        // A board the record can't be read from: the history misses this run, the log below is still saved.
      }
      saveRunLog(runLogOf(result.run, chiefSources.current, lateChief.current, watchEntry.current), undefined, missionId);
    },
    [placed, run, callChief, building.id, missionId, inMemory],
  );

  // Live mode (issue 99): the clock plays its turns through `play`, like a key. A clock turn is
  // not the player's own action, so it leaves them sprinting if they were.
  const [playMode, setPlayMode] = usePlayMode();
  // First person (issue 115) always runs on the clock, at its own pace, and its turn is the view's
  // to choose: the next pick while E is held at a door, otherwise a wait.
  const fpOn = placed !== null && firstPersonOn(runView, placed.level.floor, scan);
  // The opening line names the player's own controls: the numbers on the board, W and the mouse in first person.
  const shownStatus = opening !== null && status === openingLine(opening, false) ? openingLine(opening, fpOn) : status;
  const fpHeld = useRef<HeldAction | null>(null);
  const holdFp = useCallback((held: HeldAction | null) => {
    fpHeld.current = held;
  }, []);
  const fpTurn = useCallback((current: RunState): Action => fpHeld.current?.(current) ?? { kind: "wait" }, []);
  const layoutMode = fpOn ? "live" : playMode;
  useEffect(() => {
    clocked.current = layoutMode === "live";
    pursuit.current = layoutMode === "live" ? realTimePursuit(fpOn ? FIRST_PERSON_TURN_MS : LIVE_TURN_MS) : null;
  }, [layoutMode]);
  // On a scan, the clock waits until first person lets the player loose (the picture around them is in).
  const [fpReady, setFpReady] = useState(false);
  const clock = useTurnClock({
    live: layoutMode === "live",
    hold: fpOn && liveScan && !fpReady,
    turnMs: fpOn ? FIRST_PERSON_TURN_MS : undefined,
    action: fpOn ? fpTurn : undefined,
    // In first person the clock waits for the player's first move, so they can look around (issue 171).
    startOnMove: fpOn,
    run,
    play: (action) => {
      play(action);
      setMode(mode);
    },
  });

  const retryChief = useCallback(() => {
    const current = latestRun.current;
    if (current && current.alarmEvents.length > 0) callChief(current, current.alarmEvents.length - 1, false, true);
  }, [callChief]);

  /** Forgets the earlier runs and places the level again, in its default posture. */
  const forgetHistory = useCallback(() => {
    clearRunHistory(building.id, undefined, missionId);
    setStoredRuns(0);
    // No run on the board until the level is placed again: no key plays the old one meanwhile.
    latestRun.current = null;
    setRun(null);
    setLoad({ status: "loading" });
    setAttempt((a) => a + 1);
  }, [building.id, missionId]);

  const restart = useCallback(() => {
    if (!placed || !run) return;
    if (run.status !== "playing" && manifest && floor) {
      // The run that ended joined the history: place again from it, as a reload would (#35).
      try {
        placeAndStart(manifest, floor);
      } catch (error) {
        latestRun.current = null;
        setRun(null);
        setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
        return;
      }
    } else {
      startRun(placed.level);
    }
    setStatus("Back at the start. The guards are on their rounds.");
  }, [placed, run, manifest, floor, placeAndStart, startRun]);

  const revealed = useChiefStream(chief);
  const hidden = useMemo(() => hiddenRoutes(chief, revealed), [chief, revealed]);

  // Live's layout (issue 100): the HUD around the board, and everything else behind Details.
  const [details, toggleDetails] = useDetails(layoutMode === "live", fpOn ? "i" : "d");
  const open = panelsOpen(layoutMode, details);
  // Fullscreen shows the stage alone, and the side panel is outside it: whichever came last wins
  // (fp/fullscreen.ts). Going fullscreen closes Details; opening the panel leaves fullscreen.
  const stageFull = useStageFullscreen();
  const wasStageFull = useRef(false);
  useEffect(() => {
    const step = fullscreenStep(wasStageFull.current, stageFull, open, layoutMode === "live");
    wasStageFull.current = stageFull;
    if (step === "close-details") toggleDetails();
    else if (step === "leave-fullscreen") void document.exitFullscreen().catch(() => {});
  }, [stageFull, open, layoutMode, toggleDetails]);
  // The lens is put away with the bar: its key does nothing until Details opens it again.
  const [lens, toggleLens] = useLayerLens(open);
  // First person's time left is at the controller's one speed.
  const fpFloor = placed?.level.floor ?? null;
  const pace = useMemo(() => (fpOn && fpFloor ? firstPersonPace(fpFloor) : null), [fpOn, fpFloor]);
  const hud = usePlayHud({
    live: layoutMode === "live",
    placed,
    run,
    mission: manifest?.mission ?? null,
    crewPlan,
    chief,
    revealed,
    status: shownStatus,
    // First person is played in real time: the HUD says seconds and plain words, not hops and turns.
    pace,
  });
  // In first person a guard that hears the player says so on the radio, where the radio's own line lets it (issue 146).
  const bark = useBark(run, fpOn, hud?.radio ?? null);

  useEffect(() => {
    if (!run) return;
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      // An element on the page already acted on this key (a Why piece opening its card): it does one
      // thing. The piece's own check is gone by now: opening the card moved focus off it (#68).
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      // Space and Enter keep their meaning on a focused button or link, and on a board choice. A Why
      // piece (`data-why-target`) keeps them only when Tab put it in focus (`data-tabbed`): after a
      // click, or the focus the board restores, Space still takes the files (R3-C1).
      const owner = target?.closest("button, a, [role=button]");
      const ownsKey = owner && (!owner.hasAttribute("data-why-target") || owner.hasAttribute("data-tabbed"));
      if ((event.key === " " || event.key === "Enter") && ownsKey) return;
      if (event.key === "s" || event.key === "S") {
        const next = toggleSprint(run!, mode);
        if (next) {
          event.preventDefault();
          setMode(next.mode);
          setStatus(next.status);
          return;
        }
      }
      // Esc with a Why card open only closes the card. Either listener can run first: the card's
      // marks the event taken (caught above), and if this one runs first the card is still there.
      if (event.key === "Escape" && mode === "sprint" && !document.querySelector('[data-testid="why-card"]')) {
        setMode("walk");
        setStatus(WALK_STATUS);
        return;
      }
      const action = actionForKey(event.key, run!, mode);
      if (event.key === " ") event.preventDefault();
      if (action) {
        event.preventDefault();
        play(action);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, play, mode]);

  const options = useMemo(() => (run ? choicesOf(run, mode) : []), [run, mode]);
  const over = run !== null && run.status !== "playing";
  // A kit building's label, once the board is placed: it names the scan only when the board stands on it.
  const placedOn = load.status === "ready" ? placedFloor(load.floor.source) : null;
  const label = placedOn ? recordLabel(source, placedOn) : null;
  const record =
    label && placedOn ? (
      <span
        data-testid="record-label"
        title={label}
        className="flex min-w-0 rounded-sm border border-border px-1.5 py-0.5 label-caps text-text-2 md:shrink-0"
      >
        {/* On a narrow screen the record part gives way first: the floor is the part that matters. */}
        <span className="truncate">{RECORD_LABEL}</span>
        <span className="shrink-0 whitespace-pre">{` · ${floorLabel(placedOn)}`}</span>
      </span>
    ) : null;
  /** The board is still being set up. A board that will not come (no floor, an error) is not loading. */
  const settingUp = load.status === "loading" || (load.status === "ready" && !run);

  return (
    <RunLayout
      mode={layoutMode}
      details={details}
      detailsKey={fpOn ? "I" : "D"}
      onDetails={toggleDetails}
      hud={hud}
      bark={bark}
      loading={settingUp}
      onTake={() => play({ kind: "take" })}
      onRestart={restart}
      canRestart={run !== null && run.turn > 0}
      // On a live scan the board shares its area with the scan (issue 117), and the visual grows with them where they stack.
      staged={Boolean(openInside && run && placed)}
      record={record}
      windowToggle={<FullWindowToggle on={fullWindow} onToggle={toggleFullWindow} />}
      bar={
          <div className="flex h-14 shrink-0 items-center gap-3 px-6">
            <span className="flex min-w-0 items-center gap-2 label-caps whitespace-nowrap text-text-2">
              <LayerDot layer="matterport" decorative />
              Matterport
              {/* A kit building's label (below) names its floor, so the line doesn't say it twice. */}
              {source === "costar" ? null : (
                <span className="truncate max-md:hidden">
                  {load.status === "ready" && load.live ? " · floor plan from the scan" : sourcePending ? null : " · floor plan from fixtures"}
                </span>
              )}
            </span>
            {/* Closed with the bar in Live, where the HUD carries it instead: one label on the page. */}
            {open ? record : null}
            <span aria-hidden className="h-4 w-px bg-border" />
            <span className="min-w-0 truncate text-sm text-text-1">{manifest?.mission.title}</span>
            {/* The buttons keep their width: the labels to their left give way first. */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {storedRuns > 0 ? (
                <Button
                  variant="ghost"
                  onClick={forgetHistory}
                  // Mid-run it would throw the run away: it waits for the start or the end.
                  disabled={!run || (run.turn > 0 && run.status === "playing")}
                  data-testid="forget-history"
                >
                  Forget {storedRuns === 1 ? "1 earlier run" : `${storedRuns} earlier runs`}
                </Button>
              ) : null}
              <FullWindowToggle on={fullWindow} onToggle={toggleFullWindow} />
              <LensToggle on={lens} onToggle={toggleLens} disabled={!run} />
              <Button variant="ghost" onClick={restart} disabled={!run || run.turn === 0}>
                <RotateCcw aria-hidden />
                Restart
              </Button>
            </div>
          </div>
      }
      board={
          <div className="relative min-h-0 flex-1">
            {run && placed ? (
              <ViewSwitch
                state={runView}
                floor={placed.level.floor}
                scan={scan}
                // On a live scan the stage's header is the switch's line: it stands under it, over the board's corner.
                className={openInside && !fpOn ? "md:top-[60px] md:right-auto md:left-7" : undefined}
              />
            ) : null}
            {load.status === "loading" ? (
              <>
                <Skeleton data-testid="board-skeleton" className="absolute inset-x-6 inset-y-0 rounded-md bg-surface-1" />
                {/* On a live scan the skeleton says so, and in time offers the stand-in floor plan (issue 145). */}
                <ScanWait building={building} heistMode={heistMode} onStandIn={() => setAttempt((a) => a + 1)} />
              </>
            ) : load.status === "no-floor" ? (
              <BoardMessage
                testId="board-empty"
                label="No floor yet"
                title="This building's level isn't ready yet."
                body="Only the Los Angeles buildings have a board so far. Pick one on the map to play the run."
                action={
                  <Link href="/map" className={buttonVariants({ variant: "secondary" })}>
                    Back to the map
                  </Link>
                }
              />
            ) : load.status === "error" ? (
              <BoardMessage
                testId="board-error"
                label="The level didn't place"
                title="The board couldn't be set up."
                body={load.message}
                action={
                  <Button
                    onClick={() => {
                      setLoad({ status: "loading" });
                      setAttempt((a) => a + 1);
                    }}
                  >
                    Retry
                  </Button>
                }
              />
            ) : run && placed && manifest && fpOn ? (
              <FirstPersonView
                look={scanLookOf(runView)}
                placed={placed}
                run={run}
                objective={manifest.mission.objective}
                lockKind={manifest.securityProfile.lockKind}
                onAct={play}
                onHeld={holdFp}
                paused={clock.state === "paused"}
                scan={scan}
                onReady={setFpReady}
                endAction={
                  over ? (
                    <Link data-testid="fp-debrief" href={buildingHref(building.id, "debrief", missionId)} className={buttonVariants({ variant: "primary" })}>
                      See the debrief
                    </Link>
                  ) : null
                }
                onUnavailable={(why) => {
                  runView.fail(why);
                  setStatus(why ?? FP_UNAVAILABLE);
                }}
              />
            ) : run && placed ? (
              // On a live scan the board shares the stage with the scan (issue 117); on fixtures it is the board alone.
              <RunStage open={openInside} sweepId={run.playerNode} room={roomName(placed.level.floor, run.playerNode)}>
                <BoardView
                  placed={placed}
                  run={run}
                  choices={options}
                  onChoose={(c: Choice) => play(c.action)}
                  hiddenRoutes={hidden}
                  lens={lens && open}
                  source={source}
                />
              </RunStage>
            ) : null}
            {/* Only over a board with a run on it: not over the loading or error state. Below md the
                Live mode switch takes the top-right corner, so the mute button sits under it there. */}
            {run ? (
              <div className="absolute top-2 right-8 flex items-center gap-2 max-md:top-16 max-md:right-6">
                {/* Only where the stage carries the alarm and the clock itself: Live and first person. */}
                <FullscreenToggle available={layoutMode === "live"} />
                <MuteToggle muted={muted} onToggle={toggleMute} />
              </div>
            ) : null}
            {fpOn && clock.awaitingMove ? <FirstMoveHint /> : null}
            {run && !fpOn ? <LiveControls mode={playMode} onChange={setPlayMode} clock={clock} /> : null}
          </div>
      }
      legend={lens && run && placed ? <LensLegend placed={placed} locked={run.locked} /> : null}
      footer={
          <div className="flex h-16 shrink-0 items-center justify-between gap-6 px-6">
            <p data-testid="run-status" aria-live="polite" className="min-w-0 text-sm text-text-1 md:truncate">
              {shownStatus}
            </p>
            <div className={cn("flex shrink-0 items-center gap-4 text-sm text-text-2 max-md:hidden", fpOn ? "hidden" : null)}>
              <span className="flex items-center gap-2">
                <Kbd>1–9</Kbd> {mode === "sprint" ? "sprint" : "move"}
              </span>
              <span className="flex items-center gap-2">
                <Kbd>W</Kbd> wait
              </span>
              <span
                data-testid="sprint-hint"
                data-on={mode === "sprint" ? "true" : undefined}
                className={cn("flex items-center gap-2", mode === "sprint" ? "text-accent" : null)}
              >
                <Kbd>S</Kbd> {mode === "sprint" ? "sprinting" : "sprint"}
              </span>
              <span className={cn("flex items-center gap-2", run && canTake(run) ? "text-text-1" : null)}>
                <Kbd>Space</Kbd> take
              </span>
            </div>
          </div>
      }
      panel={
        <RunPanel
          manifest={manifest}
          placed={placed}
          run={run}
          crewPlan={crewPlan}
          realTime={fpOn}
          loading={settingUp}
          awaiting={hidden}
          chief={<ChiefPanel state={chief} revealed={revealed} zoneName={(id) => (placed ? zoneName(placed, id) : id)} onRetry={retryChief} />}
        />
      }
      // In first person the end card carries "See the debrief": one way on, not two.
      action={
        over && !fpOn ? (
          <Link
            href={buildingHref(building.id, "debrief", missionId)}
            className={buttonVariants({ variant: "primary" })}
          >
            See the debrief
          </Link>
        ) : null
      }
    />
  );
}

/** Where the tab remembers the full-window switch; `demo:reset` clears it with every `heist:` key. */
const FULL_WINDOW_KEY = "heist:run-full-window";

/** Full window on and off: the top bar, the tabs and the folder's edge go on the Run screen. */
function FullWindowToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      aria-pressed={on}
      data-testid="full-window"
      onClick={(event) => {
        event.currentTarget.blur();
        onToggle();
      }}
      className="max-md:hidden"
    >
      {on ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
      <span data-full-label>{on ? "Exit full window" : "Full window"}</span>
    </Button>
  );
}

function RunPanel({
  manifest,
  placed,
  run,
  crewPlan,
  realTime,
  loading,
  awaiting,
  chief,
}: {
  manifest: LevelManifest | null;
  placed: PlacedLevel | null;
  run: RunState | null;
  /** The plan briefed on the Plan screen; the level's own steps stand in without one. */
  crewPlan: StoredCrewPlan | null;
  /** First person, played in real time: the panel says how, not how many turns (issue 115). */
  realTime: boolean;
  /** The board is still being set up. A board that will not come (no floor, an error) is not loading. */
  loading: boolean;
  /** Guards whose Chief order is still streaming in: their row waits for it. */
  awaiting: ReadonlySet<string>;
  chief: ReactNode;
}) {
  if (!manifest || !placed || !run) {
    // A skeleton promises content on its way: only while the board loads. With no board coming
    // (the board says why, and offers the way out), the panel says what would be here (#68).
    return loading ? (
      <div className="flex flex-col gap-6" data-testid="panel-skeleton">
        <Skeleton className="h-[112px]" />
        <Skeleton className="h-20" />
        <Skeleton className="h-40" />
      </div>
    ) : (
      <div className="flex flex-col gap-6" data-testid="panel-empty">
        <section aria-labelledby="run-empty-label" className="flex flex-col gap-2">
          <h2 id="run-empty-label" className="label-caps text-text-3">
            No run
          </h2>
          <p className="text-sm text-text-2">
            The alarm, the plan and the guards&apos; orders show here once this building has a board.
          </p>
        </section>
        <p className="text-sm text-text-2">Security shown is game fiction derived from building class and era.</p>
      </div>
    );
  }
  const briefed = crewPlan ? crewPlanSteps(placed, run, crewPlan.plan) : [];
  const fromCrew = briefed.length > 0;
  // A plan worked out from the board when the crew had no reply (issue 140) is said as such (issue 142).
  const source = planSourceOf(crewPlan, briefed.length);
  const steps = fromCrew ? briefed : planSteps(placed, run, manifest.mission.objective, realTime);
  const orders = guardOrders(placed, run);
  const floor = placed.level.floor;

  return (
    <div className="flex flex-col gap-6">
      <AlarmBanner alarm={run.alarm} turn={realTime ? null : run.turn} />

      {run.status !== "playing" ? <Outcome placed={placed} run={run} realTime={realTime} /> : null}

      {chief}

      <section aria-labelledby="objective-label" className="flex flex-col gap-2">
        <h2 id="objective-label" className="label-caps text-text-3">
          Objective
        </h2>
        <p data-testid="objective" className="text-base text-text-1">
          {manifest.mission.objective}
          {run.carrying ? (
            <span className="ml-2 rounded-sm border border-success px-1.5 py-0.5 align-middle label-caps text-success">
              Taken
            </span>
          ) : null}
        </p>
        <p className="text-sm text-text-2">{manifest.mission.exitCondition}.</p>
      </section>

      <section aria-labelledby="plan-label" className="flex flex-col gap-2">
        <h2 id="plan-label" className="label-caps text-text-3">
          {PLAN_HEADING[source]}
        </h2>
        <ol data-testid="plan" data-source={source} className="flex flex-col">
          {steps.map((step, i) => (
            <li
              key={i}
              data-state={step.state}
              aria-current={step.state === "next" ? "step" : undefined}
              className={cn(
                "flex items-baseline gap-3 border-l-2 py-1.5 pl-3 text-sm",
                step.state === "next"
                  ? "border-accent bg-accent-wash text-text-1"
                  : step.state === "done"
                    ? "border-transparent text-text-2 line-through decoration-n-500"
                    : "border-transparent text-text-2",
              )}
            >
              <span className="font-mono text-xs text-text-3">{i + 1}</span>
              {step.label}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="guards-label" className="flex flex-col gap-2">
        <h2 id="guards-label" className="label-caps text-text-3">
          Guards
        </h2>
        <ul data-testid="guard-orders" className="flex flex-col">
          {run.guards.map((guard) => {
            const order = orders.find((o) => o.guardId === guard.id);
            const waiting = awaiting.has(guard.id);
            // A guard the placer posted (the dock post) stands its post until ordered.
            const standing = placed.guards.find((g) => g.id === guard.id)?.post ? "post" : "round";
            return (
              <li
                key={guard.id}
                data-guard={guard.id}
                data-intent={waiting ? "awaiting" : (order?.intent ?? standing)}
                className="grid grid-cols-[32px_88px_minmax(0,1fr)] items-baseline border-b border-border py-1.5 text-sm last:border-b-0"
              >
                <span className="font-mono text-text-1">{guard.id}</span>
                <span className={cn("font-mono text-xs uppercase", order && !waiting ? "text-danger" : "text-text-2")}>
                  {waiting ? "…" : order ? order.intent : standing}
                </span>
                <span className="truncate text-text-2">
                  {waiting ? "Awaiting orders" : order ? order.zone : roomName(floor, guard.nodeId)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-sm text-text-2">Security shown is game fiction derived from building class and era.</p>
    </div>
  );
}

/** The run's outcome line: the win names the mission's objective (#70). Exported for its test. */
export function Outcome({ placed, run, realTime = false }: { placed: PlacedLevel; run: RunState; realTime?: boolean }) {
  const won = run.status === "won";
  return (
    <section
      data-testid="run-outcome"
      data-status={run.status}
      className={cn("rounded-md border bg-surface-2 p-4", won ? "border-success" : "border-danger")}
    >
      <p className={cn("label-caps", won ? "text-success" : "text-danger")}>{won ? "Clean exit" : "Caught"}</p>
      <p className="mt-1 text-lg font-semibold text-text-1">
        {won ? `Out with the ${objectiveNoun(placed.level.missionId)}.` : `Caught in the ${roomName(placed.level.floor, run.playerNode)}.`}
      </p>
      <p className="mt-1 text-sm text-text-2">
        {realTime ? (
          endNote(run, true)
        ) : (
          <>
            {run.turn} turns, {run.alarmEvents.filter((e) => e.cause.kind !== "decay").length} alarm raises. The debrief
            has the replay.
          </>
        )}
      </p>
    </section>
  );
}

function BoardMessage({
  testId,
  label,
  title,
  body,
  action,
}: {
  testId: string;
  label: string;
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="absolute inset-x-6 inset-y-0 flex flex-col items-center justify-center gap-3 rounded-md border border-border bg-surface-1 p-6 text-center"
    >
      <p className="label-caps text-text-3">{label}</p>
      <p className="text-lg font-semibold text-text-1">{title}</p>
      <p className="max-w-md text-sm break-words text-text-2">{body}</p>
      {action}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-border bg-surface-2 px-1.5 font-mono text-xs text-text-1">
      {children}
    </kbd>
  );
}
