# Stale: the pre-#119 live recording of the Level Builder on F1

These three files are the live run `npm run record:builds -- F1` saved in #134,
on `anthropic claude-sonnet-4-6`, before the builder took the chosen mission
(#119):

- `builder-F1.json`: the model's turns as a ScriptedChatModel script;
- `F1.json`, `F1.trace.json`: that run's manifest and trace.

**They do not replay any more**, and nothing in the app reads them:

- the game master calls `list_missions`, a tool the builder no longer has
  (it reads the chosen mission with `get_mission`);
- the briefing the builder passed to `write_manifest` is about 143 words with
  no game-fiction line, and `write_manifest` now refuses both (at most 120
  words, and the words "game fiction"), so the run ends with no manifest;
- `F1.json` has no `missionId`.

`src/agents/builder/record.test.ts` keeps them as the run those briefing
rules catch.

To replace them with a live recording that replays, with `ANTHROPIC_API_KEY`
set (`LLM_MODE=live`, CoStar and Vexcel on fixtures):

```
npm run record:builds -- F1:romaine-1974
```

It writes `builder-F1-romaine-1974.json`, `F1.romaine-1974.json` and
`F1.romaine-1974.trace.json` to `fixtures/llm/recorded/` and deletes this
`pre-119/` folder, so the two never sit side by side.
