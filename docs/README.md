# Called It: launch blueprint

Reassessed on **2026-10-07**. The repository is a prototype, not proof that the
game, production infrastructure, or mobile releases work. This blueprint replaces
the earlier "locked decisions" and "fully implemented" claims.

## Decisions confirmed with the owner

| Area | Decision |
| --- | --- |
| Competition | One synchronized global window; start with a regional beta. |
| Identity | Mandatory phone verification **and** Apple or Google sign-in. |
| Clients | One React Native/Expo app, using native development builds for iOS and Android. |
| Rewards | Free, non-redeemable points and achievements; initially no ads, purchases, stakes, or cash prizes. |
| Azure budget | Approximately USD 100-250/month for beta, excluding SMS and developer-account fees; accept beta availability trade-offs. |
| Verification supplier | A managed phone-verification supplier outside Azure is acceptable. Do not establish a new dependency on retiring ACS SMS. |
| Earlier work | Preserve unmerged prototype branches as reference; do not consolidate or deploy them automatically. |

### Owner decisions recorded on 2026-10-08

These decisions supersede conflicting prototype rules and earlier proposals.
They are specifications, **not a claim that the running code implements them**.

| Area | Approved decision / remaining boundary |
| --- | --- |
| D1 audience | United States and Canada, English only. No additional product-imposed age floor; actual app-store requirements, legal age/consent rules and Canadian language requirements remain to be established. D1 is still partial. |
| D2 schedule | One surprise daily opening between 12:00 and 17:00 Eastern, open for one hour; latest close 18:00. Keep the chosen time hidden until opening. Encourage optional notifications and notify opted-in players when live. Lock at least 30 minutes before the earliest event/information cutoff. Actual content-calendar validation remains open. |
| D3 competition | One question per category per day; one point per correct pick. Skip and no accepted choice are neutral. Separate global and category streaks; any wrong pick resets its category and that day's global streak, not the other categories. Lifetime-only beta boards with shared competition ranks; seasons deferred. [Full rules and achievement catalog](product.md) are ratified. |
| D3 finality | Settle automatically when the approved source marks a result final. At 48 hours after lock, unresolved questions become neutral voids; a later final result revives them through correction/replay. Verified corrections have no arbitrary age limit. |
| D4 discovery | Invite links only for beta. Defer contact upload and phone matching; verification does not imply discoverability. Decision complete, implementation still pending. |
| D8 operations | Round-wide neutral void, no same-day replacement, after 10 cumulative minutes of confirmed service-wide submission outage or 2 continuous minutes within the final 5 minutes. CallMeGreg is incident owner; support is best effort with no guaranteed staffed hours. Numerical recovery targets are deferred until capabilities and costs are measured, so D8 remains partial. |

**Still unresolved:** the remaining D1/D2/D8 boundaries above, identity/SMS vendor,
licensed data suppliers, Azure region/SKUs, native/privacy/store readiness and
actual operational capacity. Other recommendations are proposals unless marked
approved; none of these decisions authorizes provisioning or release.

## Read by decision

| Document | Purpose |
| --- | --- |
| [Product and competition](product.md) | Core loop, fairness, content, scoring, seasons, achievements, and growth. |
| [Architecture](architecture.md) | Runtime boundaries, authoritative writes, durable work, identity, API and data design. |
| [UX and UI](ux-ui.md) | Navigation, screen states, onboarding, accessibility, copy, and design-system direction. |
| [Trust and safety](trust-and-safety.md) | Observed risks, abuse controls, privacy, moderation, and release gates. |
| [Operations](operations.md) | Azure sizing, capacity targets, notifications, availability, incidents, and game health. |
| [Delivery and owner actions](delivery-plan.md) | Ordered work, measurable acceptance criteria, app stores, and manual decisions. |
| [Platform evidence](platform-evidence.md) | Official sources, date-sensitive constraints, and unverified assumptions. |
| [Infrastructure implementation](../infra/README.md) | What the Bicep/workflows actually provision, not the entire target architecture. |
| [Client implementation](../clients/README.md) | Current client status and the approved replacement direction. |

## Evidence and status

The starting revision was `3400b4c1267144a49598d91e4e1f03df25f69c8a`.
In this worktree, the full .NET solution built and its 33 existing tests passed
using SDK 10.0.401; the original main Bicep template compiled. This is a new local
observation, not reliance on old documentation. Some existing tests actually
encode unsafe timelines, including resolving questions while picks remain open.

There is **no verified production deployment, store-ready app, real-device push
flow, licensed resolution feed, SQL Server concurrency result, restore drill,
or burst-capacity measurement** established by those checks. Documentation and
individual implementation slices must not be promoted to "launch ready."

Use the delivery plan as the release checklist. Preserve the distinction between
**observed**, **implemented**, **proposed**, and **owner/platform-gated**.

## First implementation progress

| Slice | Current state |
| --- | --- |
| Backend guardrails | Integrated: both hosts reject unsafe deployed configuration; identity ownership and OIDC validation tightened; SQL projections replace Redis/in-memory standings; production startup is read-only; live/ready endpoints added. |
| Azure foundation | Integrated: foundation-only Bicep, separate immutable application rollout, versioned secret references, API-only health/scaling, and opt-in deployment phases. Default/manual-plan/push paths perform local validation only. No Azure resources were created. |
| SQL prerequisites | Separate migration/category-seed executable and real SQL Server CI lane added; see [database lifecycle](database-lifecycle.md). Azure contained identities, network reachability, operator authorization and recovery remain unverified. |
| Competition, native client and public launch | Still gated. The complete timing/outbox/scoring protocol, vendor-backed identity lifecycle, deletion/moderation, notifications and store builds are not delivered by the guardrails slice. |

The first integrated backend passed the full solution build and 158 local tests
(20 domain, 112 application, 26 API). Successful database tests use SQLite, **not
SQL Server**. The new, separately selected provider lane covers migration/seed,
queries, bounded constraint races and contained-user permissions, not production
load, managed identity, cloud capacity or native-device behavior.

Infrastructure verification compiles the foundation, both parameter files and
application template with explicit non-secret fixtures. Its 42 local tests and
workflow lint pass. Azure, Docker and deployed-health execution paths in those
tests are mocked: no provider/CLI deployment compatibility, actual image build,
region/SKU availability or cost result is established. The default SQL firewall
is closed and the vault is empty; networking, schema/bootstrap and secret
population are deliberate prerequisites, not completed deployment tasks.

Deployed SMS and push default to **Disabled**, returning explicit unavailability
when invoked. All three legacy scheduled workers and stub resolution are rejected
outside Development. This is intentionally a safe foundation, not a playable
public service with development adapters hidden behind production configuration.

This completes the initial **planning and first-foundation slices**, not the game.
The next executable milestones and owner decisions remain in the delivery plan.
