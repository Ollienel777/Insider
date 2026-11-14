// Runs once when the server starts (Next.js instrumentation). It builds the
// showcase's levels in the background (#93); the server answers requests
// meanwhile, and a showcase building opened before its level is ready offers
// "Build this level" on its Dossier.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SHOWCASE_LEVELS) return;
  const { warmShowcase } = await import("@/agents/builder/warm-showcase");
  void warmShowcase();
}
