// The short noun for what a mission's objective is: "files", "boxes"... (#70).
// The board's objective marker and the win lines name it. This lookup is its
// settled home, kept apart from the `Mission` schema on purpose: a field there
// would flow into the get_mission tool output and the cached outputs tests
// compare against (data/casting/, data/levels/). If it ever moves into data,
// it goes on the mission in fixtures/missions.json, left out of `BriefedMission`.

/** The objective noun for each library mission that has one, by mission id. */
export const OBJECTIVE_NOUNS: Readonly<Record<string, string>> = Object.freeze({
  "romaine-1974": "files",
  "sunset-1986": "boxes",
  "night-desk": "prototype",
  "paper-trail-2001": "files",
  "syntactic-2019": "samples",
});

/** What every level said before #70, and what a mission without a noun still says. */
export const DEFAULT_OBJECTIVE_NOUN = "files";

/** The mission's objective noun, lower-case; "files" for no mission or one without a noun. */
export function objectiveNoun(missionId: string | null | undefined): string {
  if (!missionId || !Object.hasOwn(OBJECTIVE_NOUNS, missionId)) return DEFAULT_OBJECTIVE_NOUN;
  return OBJECTIVE_NOUNS[missionId];
}

/** The objective marker's label on the board: the noun, upper-case. */
export function objectiveLabel(missionId: string | null | undefined): string {
  return objectiveNoun(missionId).toUpperCase();
}
