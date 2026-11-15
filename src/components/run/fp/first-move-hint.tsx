// What first person says while its turn clock waits for the player's first
// move (issue 171): nothing moves until they do. In the view's own hint style.
export const FIRST_MOVE_HINT = "Look around. The clock starts when you move.";

export function FirstMoveHint() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-6">
      <p data-testid="fp-first-move" className="rounded-sm bg-surface-1 px-3 py-2 text-sm text-text-1 shadow-e-1">
        {FIRST_MOVE_HINT}
      </p>
    </div>
  );
}
