// How the Run stage is laid out on a live scan (issue 117): the board and the
// scan side by side, the board alone, or the scan alone. The choice is kept
// per browser, for every building: it is a preference about the screen, and
// it names nothing from a scan (SPEC §4.5). Storage can be blocked or full, so
// every read and write may quietly do nothing: even reaching `localStorage`
// throws when site data is blocked, so it is reached inside the `try`.

export const STAGE_MODES = ["split", "board", "scan"] as const;
export type StageMode = (typeof STAGE_MODES)[number];

/** What a browser with no stored choice shows: both, so each hop is seen in the scan. */
export const DEFAULT_STAGE_MODE: StageMode = "split";

export const STAGE_MODE_KEY = "heist:run-stage";

/** The browser's storage, read inside the caller's `try`: the getter itself throws when site data is blocked. */
const browserStorage = (): Storage | undefined => globalThis.localStorage;

export const isStageMode = (value: unknown): value is StageMode =>
  typeof value === "string" && (STAGE_MODES as readonly string[]).includes(value);

/** The stored choice, or Split when there is none, it is not a mode, or storage is blocked. */
export function loadStageMode(storage?: Pick<Storage, "getItem">): StageMode {
  try {
    const raw = (storage ?? browserStorage())?.getItem(STAGE_MODE_KEY);
    return isStageMode(raw) ? raw : DEFAULT_STAGE_MODE;
  } catch {
    return DEFAULT_STAGE_MODE;
  }
}

export function saveStageMode(mode: StageMode, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? browserStorage())?.setItem(STAGE_MODE_KEY, mode);
  } catch {
    // The stage still switches; only the next visit forgets the choice.
  }
}
