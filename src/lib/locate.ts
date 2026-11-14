// Where this module was loaded from. `locate.test.ts` imports it through the
// `@/` alias to prove the alias resolves into this worktree's own src/.
export const moduleUrl: string = import.meta.url;
