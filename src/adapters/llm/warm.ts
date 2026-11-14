// Warms the live model before the demo's first live call (#90): the first call
// to the provider pays a cold start (about 4.5 s on #88), past the fast
// calls' 4 s budget. One tiny request, sent when Plan opens, takes that cost
// off stage. It never touches a reply, a fallback or the mode chip: in fake
// mode, or live without a key, it sends nothing, and a failure is swallowed.
import { getChatModelSelection, selectChatModel, type SelectOptions } from "./select";
import { safeErrorMessage } from "./redact";

type Env = Record<string, string | undefined>;

/** Long enough for a cold call to finish; nothing waits on it. */
export const WARM_TIMEOUT_MS = 15_000;
const PROMPT = [{ role: "user", content: "Reply with OK." }];

export interface WarmOptions extends SelectOptions {
  /** Defaults to `process.env`. */
  env?: Env;
  timeoutMs?: number;
}

/** True when a warm-up request reached the live model and it answered. */
export async function warmLiveModel(options: WarmOptions = {}): Promise<boolean> {
  try {
    const selection = options.env ? selectChatModel("fast", options.env, options) : getChatModelSelection("fast", options);
    if (selection.mode !== "live") return false;
    await selection.model.invoke(PROMPT, { signal: AbortSignal.timeout(options.timeoutMs ?? WARM_TIMEOUT_MS) });
    return true;
  } catch (error) {
    console.info(`warm-up: skipped (${safeErrorMessage(error, options.env ?? process.env)})`);
    return false;
  }
}
