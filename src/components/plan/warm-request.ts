// The browser's side of POST /api/warm (#90): at most one warm-up per page
// load, and only when the page was rendered with the model live. Its answer
// is ignored, and a failure is silent: no toast, no chip, no note.
let sent = false;

export function warmModel(live: boolean, options: { fetch?: typeof fetch } = {}): void {
  if (!live || sent) return;
  sent = true;
  const doFetch = options.fetch ?? fetch;
  void Promise.resolve()
    .then(() => doFetch("/api/warm", { method: "POST" }))
    .catch(() => {});
}

/** Test seam: a new page load. */
export function resetWarmForTests(): void {
  sent = false;
}
