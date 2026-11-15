// The case file's cover, before the first paint (issue 166). The root layout
// puts this script in <head>, so it runs before anything is drawn: a file
// already opened this visit, or a reader who asked for reduced motion, never
// sees the cover flash. It is a server-rendered script on purpose: React does
// not run a <script> it renders in the browser, so it cannot live in the
// cover's own (client) component.

/** Session storage: set once the cover has opened in this tab. */
export const COVER_KEY = "heist:cover-opened";

/** Marks <html data-cover-done="1"> when the cover should not show; globals.css hides the cover on it. */
export const COVER_PRE_PAINT = `try{if(sessionStorage.getItem("${COVER_KEY}")||matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.dataset.coverDone="1"}catch(e){document.documentElement.dataset.coverDone="1"}`;
