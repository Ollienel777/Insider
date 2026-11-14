# Working in this repo

This repository is the HackPrinceton Fall 2026 submission. The build loop that
runs it comes from the harness plugin (`Ollienel777/claude-harness`, installed
as `harness@nelson-harness`); ideation ran beforehand in `Ollienel777/Solo_Hack`.
This repo holds the event and the product. This file is loaded into every
session, so it covers only what is easy to get wrong.

| question | read |
|---|---|
| This repo's harness settings | `.claude/harness/profile.md` (`node PLUGIN/bin/harness.mjs profile`) |
| Running the ideation loop | `/harness:ideate` |
| Running the build loop | `/harness:build-loop` |
| The loops' rules | the plugin's `brief/` (the skills print its path) |
| What we are building, and its gate commands | `hackathon/SPEC.md` (exists once the build starts) |
| The design direction | `hackathon/DESIGN.md`, and the `ui-craft` skill |
| The event: clock, judging, prizes | `hackathon/EVENT.md` |

## Branches and PRs

- **Never commit to `main` once the harness is pushed.** All work goes through
  PRs, which are squash-merged.
- **Name branches `type/NUM-slug`**, for example `feat/12-live-transcript`.
- **Title PRs `type(area): what`.**
- **Put a bare `Closes #NUM` in the PR body.** A squash merge carries commit
  bodies onto `main`, so a wrong `Closes` in a commit message closes the wrong
  issue.
- **Never rebase or force-push a pushed branch.** Merge `main` into it instead.
  **A conflict in generated output** — a fixture, a snapshot, a lockfile — has
  no correct hand resolution: git may already have auto-merged part of it
  before stopping. Regenerate it with its own command and commit the result.
- **The gate is the one in `hackathon/SPEC.md`**, and CI runs the same
  commands. Run all of them before opening a PR. Never report a step as passing
  when it could not run — and a pipe is the easy way to: `gate | tail -3 &&
  git commit` commits a red suite, because the pipeline's status is `tail`'s.
  Write the output to a file and read it separately.

## Working alongside the build loop

The loop and you post as the same GitHub account, so it relies on conventions to
tell its work from yours.

- **It touches only PRs labelled `loop`.** Your own PRs are left alone unless
  you add that label.
- **`hold` is your veto.** On a PR or an issue, it stops the loop acting on it
  until you remove the label.
- **Its comments start with a machine prefix**: `cold:`, `semi-cold:`, `fix:`,
  `checks:`, `settled:`, `unsettled:`, `reopened:`, `claimed:`, `released:` or
  `loop:`. **A comment without one is read as yours, and acted on.** Never start
  a comment of your own with one of those prefixes.
- **To answer a decision**, comment, then remove `needs-decision` from the
  issue, or `unsettled` from the PR.
- **Changes to the harness wait for your merge**: `.claude/`, this file,
  `.github/`, and the profile's `harness paths`. The loop cannot relax its own
  rules — and its rules are not in this repo at all.
- **Merge with `--match-head-commit`, as the loop does.** A squash-merge from
  the UI takes the head as it stands; a commit still being pushed lands on the
  branch afterwards, off `main`, and nothing flags it.
  `gh pr merge NUM --squash --match-head-commit FULL_SHA` refuses instead.

## Things that bite

- **No product code before `hacking starts`** (see `hackathon/EVENT.md`). Many
  events disqualify pre-written code. The harness itself is tooling.
- **The repository is public.** `hackathon/ideation/`, `hackathon/DECISION.md`
  and `hackathon/draft/` are gitignored so that nothing publishes the idea
  early. The build loop's spec PR adds `DECISION.md` deliberately, once hacking
  has started. From then on, the tracked copy is the real one: the next pull
  silently replaces your local file with it. Change the decision through a
  comment on the status issue, not by editing the local file.
- **Secrets never enter the repo.** `.env.local` is gitignored, and
  `.env.example` holds names only. Every external service sits behind an
  adapter with a fixture-backed fake, so the app, CI and the demo fallback all
  run without keys.
- **Convert event times with `node PLUGIN/bin/harness.mjs utc DAY HH:MM ZONE`.**
  Git Bash's `date` on Windows has no timezone data and silently treats every
  zone as UTC. In PowerShell, a bare `date` prints local time.
- **No attribution stamps.** No "Generated with…", `Co-Authored-By` or session
  links in commits, PRs, reviews, comments or issues.
- **Git Bash on Windows rewrites arguments that look like paths.** Write
  `gh api` paths without a leading slash (`repos/{owner}/{repo}/…`). And a
  `rev:path` argument such as `git show origin/main:.claude/x` is mangled into
  `origin\main;.claude\x`; set `MSYS_NO_PATHCONV=1` for that command.

## Changing the loops' briefs

The briefs live in the harness repo, not here, so a running loop can never
edit the rules it follows. Change them there, through a PR, after loading the
`harness:prompt-writing` skill. A run records what it learned under
**lessons** in its report; carry each one to the harness repo's `LESSONS.md`.
