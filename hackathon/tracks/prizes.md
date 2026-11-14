# HackPrinceton Fall 2026: tracks and prizes

Transcribed from the two official track documents in this folder
(`f26-main-tracks.pdf`, `f26-special-tracks.pdf`), released Nov 12, 2026. The
PDFs are the source if anything here disagrees.

## How enrolment works

- **Every project must enrol in exactly one main track** (the six below).
- **Optional tracks on top**, as many as apply: Best Rookie Hack, Best Hardware
  Hack.
- **Every submission is automatically considered for Best Overall Hack.**
  Track winners cannot also win Best Overall.
- **Each team member receives the prize.** The document's example: a 4-person
  team that wins Best Overall gets 4 PS5s. It is stated next to Best Overall;
  it most likely applies to every main and optional track prize, but that is
  not confirmed.
- **Special tracks** (sponsor challenges) are separate. CoStar's says
  explicitly that it stacks with any other prize.

## Main tracks (enrol in exactly one)

| track | description | prize |
|---|---|---|
| Best Overall Hack | The best project through initial and final judging, excelling in all four rubric areas (creativity, utility, charity, avidity). Track does not matter. Track winners cannot win it. Automatic. | PlayStation 5 Disc Edition |
| Best Healthcare Hack | Improve healthcare delivery, promote wellness, or tackle public health challenges. Examples: telehealth, AI-driven diagnostics, mental health tools, fitness tracking. | Apple Watch SE 3 |
| Best Sustainability Hack | Use technology to address environmental challenges or promote eco-friendly habits. Examples: carbon tracking apps, smart waste management, renewable energy tools. | DJI Neo Fly More Combo |
| Business and Enterprise | Improve the efficiency of financial tools and streamline business management. Examples: financial tools for startups, B2B billing, dashboards, analytics, cybersecurity, privacy. | AirPods Pro 3 |
| Entertainment | Creatively and uniquely incorporate entertainment and media. Examples: story-telling apps, interactive projects, media-literacy apps. | Ray-Ban Meta Glasses Gen 2 (Wayfarer) |
| Education | Make learning more interactive, accessible, or personalized. Examples: e-learning platforms, tools for virtual experiences. | Instax Mini EVO |
| Science + Discovery | Turn curiosity into discovery. Examples: research accelerators, data models, innovative tools to aid scientific processes and methods. **New this semester.** | GoPro Hero12 |

## Optional tracks (any number)

| track | description | prize |
|---|---|---|
| Best Rookie Hack | Best project by hackers at their first hackathon. | JBL Charge 6 |
| Best Hardware Hack | Creatively integrates hardware: IoT, robotics, wearables, or any physical computing. | Bambu Lab P1S 3D printer |

## Special tracks and company prizes

### Inside and Out: AI for the Built World — CoStar Group

**Prize:** 1st $1,500, 2nd $500, 3rd $250, cash. Finalists get fast-track
interviews with CoStar's AI team; winning projects get a roadmap review.
**Stacks with any other prize.**

**The ask.** Build an AI agent that uses CoStar's data layers together to do
something new with the built world. Users can be the people who open CoStar
every morning (brokers, investors, lenders, developers, appraisers) or anyone
else: a city planner, a delivery robot, a game, an accessibility tool, a
classroom. Real estate problems are welcome but not required; **the data is
required.** "The best projects will make us say 'we didn't know you could do
that with our data.'"

**The data.** The real dataset, not a sample, for **Houston, TX and Los
Angeles, CA** only:
- **CoStar building data**: proprietary data on 8.5M commercial properties
  (leases, sales, tenants, available space), researched census-style.
- **Matterport 3D scans**: digital twins of the inside of real buildings.
- **Vexcel aerial imagery**: sharp enough to count parking spaces from the sky.

All three cover the same buildings. Teams get their own API keys and a toolkit
exposing everything through SDKs, MCP servers and OpenAPI services. CoStar,
Matterport and Vexcel engineers are on site and in the Discord all weekend.

**What they look for:**
- uses **at least two of the three layers** and gets something out of the
  combination
- **agentic**: reasons, plans and takes action; not a chat wrapper over a
  property record
- solves a real problem for a real person, in real estate or anywhere the
  built world matters
- **spatial and visual understanding, not only text**

**Criteria:** 30% use of the data (combines layers intelligently, not as
decoration); 30% agentic depth (reasons, plans, acts; beyond chat and
summaries); 25% usefulness ("would someone want this switched on Monday?");
15% demo and polish.

### Best Practical AI Innovation — Amazon

**Prize:** Amazon gift cards. 1st $125, 2nd $75, 3rd $50, per person, up to 4
team members.

**The ask.** AI that solves a real problem for real people and goes beyond
demos: applications that reason, plan, take action and adapt. Any domain.

**Focus areas:** agentic behaviour (multi-step actions); real-world impact;
adaptive intelligence (learns from context, feedback or preferences);
user-friendly design; creative innovation.

**Example directions they list:** a shopping comparison agent; logistics or
delivery optimisation on real-time data; an accessibility tool using voice,
vision or gesture; a sustainability platform turning satellite, sensor or
public-record data into actions; an agentic learning sandbox; a personal
finance or trading coach; a group coordination agent; a creative workflow
turning raw inputs into polished content; an AI layer over messaging,
scheduling or browsing; a multi-agent system comparing options in a domain
(housing, courses, jobs, travel, energy).

**Criteria:** creativity 25%, usefulness 25%, technical implementation 25%,
user experience 25%.

**Must include:** a working prototype or demo, a clear use case and target
user, basic documentation, a presentation or pitch. Any tools, APIs, models or
frameworks are allowed.

### Forward Deployed Challenge — Peri

**Prize:** 1st–3rd place. Direct introductions to the hiring teams at Peri's
partner companies (Cognition, Edra, Ephemeral, Sea12, Arca, Poetic) for a
chance to interview, plus an introduction to Peri's private talent network.
No cash.

**The ask.** Act like a forward deployed engineer: go to a real business,
learn how it actually operates, find where its workflow breaks, and build
what it needs. A project for **any** HackPrinceton track qualifies. "The ideal
entry starts with walking into the laundromat down the street." Local shops,
family businesses, restaurants, startups, student organisations and clubs all
count.

**Eligibility (hard):** the submission must include the business's name, the
name and role of the person consulted, and one piece of evidence (a
screenshot of the conversation, a photo, a short video, or a direct quote).
**The consultation must happen during the hackathon.**

**Criteria:** real-world need (does it address a problem the business
actually has); usability (could the business adopt it immediately);
execution (complete and functional end to end). Judged by Peri, co-founded by
two former Palantir forward deployed engineers.

### Best use of deepagents — LangChain

**Prize:** Nintendo Switch 2 for winners.

**The ask.** Build a deepagent (LangChain's `deepagents` library) for any use
case.

### Arlequin AI

**Prize:** one winner per track; prize not stated.

- **Track 1, AI-Driven Forensics.** Use AI (ML, DL, GenAI) to uncover illegal
  and criminal patterns in forensic data. A dataset is optionally provided.
- **Track 2, Social media analysis: combining content and connectivity.**
  Build a pipeline that explores and analyses networks, combining the
  semantic content of messages with the connectivity patterns between actors.

### Best Physical AI Hack — Justin Bojarski

**Prize:** $500 to the winning team, split between members.

**The ask.** The winner must incorporate AI into a physical hardware build.
