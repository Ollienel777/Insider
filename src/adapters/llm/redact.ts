// Keeps the model's key out of anything the app writes (#30): the server log
// and every response body. The key is read only from the environment
// (select.ts), and the SDK never puts it in an error message on purpose, but a
// provider or proxy error can echo a request back. So every message that
// leaves the LLM adapter goes through `redactSecrets` first.

type Env = Record<string, string | undefined>;

/** Anthropic key shapes (`sk-ant-api03-…`, `sk-ant-admin01-…`), whatever the environment holds. */
const KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]+/g;

/** The variables whose values never appear in a log line or a response. */
const SECRET_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"];

export const REDACTED = "[redacted]";

/** `text` with every secret from `env`, and anything shaped like an Anthropic key, replaced by `[redacted]`. */
export function redactSecrets(text: string, env: Env = process.env): string {
  let out = text;
  for (const name of SECRET_VARIABLES) {
    const value = env[name];
    // A very short value would redact ordinary words; real keys are long.
    if (value && value.length >= 8) out = out.split(value).join(REDACTED);
  }
  return out.replace(KEY_PATTERN, REDACTED);
}

/** An error's message, redacted, for a log line. Never the error object itself: its request and headers stay out. */
export function safeErrorMessage(error: unknown, env: Env = process.env): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, env);
}
