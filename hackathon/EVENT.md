# Event

Fill this in before running `/ideate`. Both loops read it, and nothing here is
a rule. **`TODO` marks a field not filled in yet.** The loops treat it as
unknown, never as a value. Replace it, or write `none`. Every time needs an IANA
timezone, for example `America/Toronto`.

## Basics

- name: HackPrinceton Fall 2026 (Princeton University, Julis Romo Rabinowitz Building)
- url: https://www.hackprinceton.com/
- hacking starts: 2026-11-13 02:55 America/New_York
- feature freeze: 2026-11-15 02:48 America/New_York
- submission deadline: 2026-11-15 09:00 America/New_York
- submit window: 1h
- team: 4 people

<!-- Nelson, in chat, 2026-11-13 07:55 UTC: "hacking has started, dont go plan
     mode, go build mode". `hacking starts` is set to that moment. The feature
     freeze is pinned to where `default` put it under the 36-hour estimate
     (deadline minus 7h12m), so the earlier start does not pull it in. The
     deadline is still the estimate below.
     The start and deadline are ESTIMATES: 36 hours, from past editions
     (Spring 2026 ran 36 hours, Apr 17–19, with judging from 9:30 AM Sunday).
     Replace both with the times in the hacker guide or Discord before the
     build loop starts; the build clock and the feature freeze depend on them.
     Ideation only needs the deadline to be roughly right.
     feature freeze: `default` means the deadline minus 20% of the hacking
     window, and at least 3h before the deadline.
     Nelson, in chat, 2026-11-15 ~06:20 UTC: "push back feature freeze by an
     hour". The freeze moved from 01:48 to 02:48 America/New_York (07:48 UTC). -->

## Judging

- criteria: **creativity, utility, charity, avidity**, unweighted (the
  published HackPrinceton rubric; definitions in `tracks/past-editions.md`).
  Charity means a specific societal need, "in the nation's service and the
  service of humanity". Avidity means visible passion: the pitch, the Devpost
  write-up, future plans, a polished program.
- format: **in-person judging on Sunday, about 9:30 AM–2 PM.** Each team
  presents to judges in **at most 2 minutes**: the problem, then a walkthrough
  of the working product. Best Overall goes through an initial and a final
  round. An optional demo video of at most 2 minutes can be attached.
- sponsor challenges have their own published criteria and weights, in
  `tracks/prizes.md`. CoStar: 30% data use, 30% agentic depth, 25%
  usefulness, 15% demo and polish. Amazon: creativity, usefulness, technical
  implementation and user experience, 25% each.
- judges: not published for this edition. Spring 2026 used about 65 judges,
  mostly industry engineers and product people, plus sponsor staff.

## Tracks and prizes

- **Main tracks, enrol in exactly one:** Healthcare, Sustainability, Business
  and Enterprise, Entertainment, Education, Science + Discovery (new this
  semester). Each has one winner; every team member gets the prize (details in
  `tracks/prizes.md`).
- **Best Overall** (PS5 per member) is automatic. Track winners cannot win it.
- **Optional add-ons:** Best Rookie Hack, Best Hardware Hack (Bambu Lab P1S).
- **Special tracks, which stack:**
  - CoStar "AI for the Built World": $1,500 / $500 / $250 cash, plus
    fast-track interviews with CoStar's AI team. The largest cash prize.
  - LangChain "Best use of deepagents": Switch 2.
  - Amazon "Best Practical AI Innovation": gift cards, per person.
  - Peri "Forward Deployed Challenge": interview introductions at Cognition,
    Edra, Ephemeral, Sea12, Arca and Poetic.
  - Arlequin AI: AI-driven forensics; social network content and
    connectivity analysis.
  - Justin Bojarski "Best Physical AI Hack": $500.
- No MLH prizes are listed in the track documents. MLH usually adds its own
  at the opening ceremony.

## Rules that constrain ideas

- **The submission repo must be a public GitHub repository created during the
  event.** This harness repo predates the event, so it cannot be the
  submission repo. At hacking start, the product is built in a fresh public
  repo with the harness tooling copied in.
- Teams of up to four.
- **CoStar's data covers Houston, TX and Los Angeles, CA only**, and its API
  keys are handed out at the event. An entry must use at least two of the
  three layers (CoStar building data, Matterport 3D scans, Vexcel aerial
  imagery) and show spatial or visual understanding, not only text.
- **Peri requires a real business consulted during the hackathon**, named in
  the submission with the person's name and role and one piece of evidence.
- LangChain's prize requires building on the `deepagents` library.
- Justin Bojarski's prize requires AI in a physical hardware build.

## Submission requirements

- A Devpost submission linking the public GitHub repo created during the
  event.
- The main track chosen, plus any optional and special tracks.
- Discord usernames for every member.
- Optional: a demo video of at most 2 minutes.
- A live, in-person demo of at most 2 minutes on Sunday morning.

## The builder

- skills and interests: "honestly highly competent in everything" (the
  builder's words). All four are strong generalists. Treat this as **no
  skill-based narrowing**: do not rule an idea out, or favour one, for the
  language, framework or domain it needs. Judge feasibility on what the event
  constrains: the 36-hour window, four people, the hard constraints below,
  and how reliably the demo runs live.
- hard constraints: **no prior hardware experience on the team.** Hardware
  ideas (Best Hardware Hack, Best Physical AI Hack) are not excluded, but a
  first-ever hardware build carries real build and live-demo risk for this
  team. That is for the red team to weigh per idea.
- accounts and keys already held: the Anthropic API, the primary model
  provider (team decision, Nov 13). AWS Bedrock with Claude Opus 4.6 and
  Sonnet 4.6 (us-east-1), but the account cannot make calls yet; the Claude
  5.5 models are not available on it. CoStar, Matterport and Vexcel keys are
  issued at the event; plan against fixture-backed fakes until then.
- prize priorities, chosen after reading the tracks (a preference, not a
  rule):
  1. **CoStar**: the largest cash prize, hiring interviews, and data no
     other weekend offers.
  2. **LangChain deepagents**: stack it by building the agent on
     `deepagents`, which accepts MCP tools, so it can drive CoStar's MCP
     servers directly.
  3. **One main track, chosen by fit.** Science + Discovery is new, so
     probably the least crowded. Sustainability and Business fit built-world
     ideas.
  4. **Amazon Practical AI** as a stack for any agent that is genuinely
     useful.
  5. **Peri** only if the project naturally serves a business the team can
     visit or call during the event. With CoStar's data limited to Houston
     and LA, that usually means a business whose problem is the same
     everywhere.
  6. Arlequin and the hardware prizes only if an idea needs them on its own
     merits.

<!-- hard constraints: things the idea must respect, such as no hardware or no
     paid APIs, or `none`.
     accounts and keys: service names only. Never paste a key here. -->

## Ideation settings

- ideation rounds: 4
- ideation budget: 5h
- shortlist size: 4

<!-- Set high on purpose: the builder asked for a thorough run before the
     event, with time to spare. If ideating after hacking has started, a
     quicker pass is rounds 2, budget 90m. -->
