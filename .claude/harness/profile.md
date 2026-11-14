# Harness profile — HackPrinceton Fall 2026

A solo hackathon repository, with the hackathon pack (the clock, the spec lap,
milestones, the submission). Ideation ran in `Ollienel777/Solo_Hack`; the
chosen idea is in `hackathon/DECISION.md`.

```harness
tracker: github
labels: yes
pr scope: loop-label
pack: hackathon
merge policy: auto
wip limit: 2                # local slots: the VM (2 vCPUs, 3.7 GB) runs only the orchestrator and local-only work
min version: 0.13.0
dispatch: mixed             # implementers, fixers and review rounds run as cloud jobs, except local-only work
cloud environment: env_01P8m9FjvYdVJEGBt3tmMZsP   # "Insider": CI=1, no secrets; network allows npm, Playwright downloads and Google Fonts
local only: tag:needs-credentials
cloud wip limit: 6
cloud repo cap: 6
commit author: Nelson Kang <155183974+Ollienel777@users.noreply.github.com>
cloud model: claude-opus-5-5
round cap: 7
settle rounds: 1
mediums block: no
areas: labels
self-approve cards: yes
gate: npm run gate          # defined by the spec; the planner makes it exist
branch: type/NUM-slug
ticket line: Closes #NUM
harness paths: hackathon/EVENT.md, hackathon/SPEC.md, hackathon/README.md
status: issue
```

## The product

Filled in from `hackathon/SPEC.md` once it merges: the one-liner.

## What is valuable here

The two-minute live demo: HackPrinceton gives each team at most 2 minutes,
the problem and then a walkthrough of the working product. The pack's "What
wins" section is the rule, read with a 2-minute slot. Weights, from
`hackathon/EVENT.md`:

- Main judging: creativity, utility, charity, avidity, unweighted.
- CoStar: 30% data use, 30% agentic depth, 25% usefulness, 15% demo and
  polish. An entry must use at least two of CoStar, Matterport and Vexcel, and
  show spatial or visual understanding.
- LangChain: the agent must be built on `deepagents`.
- Amazon: creativity, usefulness, technical implementation and user
  experience, 25% each.

## The gate

Cloud jobs run in fake mode only: they have no keys and no CoStar kit, and
none may be given to them. Work that needs either carries the
`needs-credentials` label and runs on the VM.

Keyless: fake mode by default. `.env.local` holds live keys, copied into a
worktree only for the rehearser and an M2 implementer.

## Traps

- The repo is public. Nothing that reveals the idea is pushed before
  `hacking starts`; `hackathon/ideation/` and `DECISION.md` stay gitignored
  until the spec PR adds the decision.
- `.gitattributes` must force LF for `*.sh` and `*.mjs`, and mark fixtures
  binary: CRLF conversion on Windows has corrupted a binary fixture.
- A per-worktree environment for the gate: a shared editable install makes
  every worktree's gate test the main checkout's code.
- The build VM is small (2 vCPUs, 3.7 GB, 2 GB swap). Two gates at once is the
  most it holds; a gate that runs out of memory fails for that reason, not the
  code's.
