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

**Not yet approved:** exact launch countries/ages, drop time/window duration,
season and achievement rules, contact discovery, SMS vendor, data suppliers,
Azure region/SKU, and outage compensation policy. Recommendations below are
explicitly proposals, not user commitments or implemented features.

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
| Azure foundation | Implementation in progress in an isolated workstream; deployment is not authorized. |
| Competition, native client and public launch | Still gated. The complete timing/outbox/scoring protocol, vendor-backed identity lifecycle, deletion/moderation, notifications and store builds are not delivered by the guardrails slice. |

The integrated backend passes the full solution build and 156 local tests
(20 domain, 111 application, 25 API). Successful database tests use SQLite, **not
SQL Server**; no production query-plan/load/concurrency, managed-identity,
least-privilege, migration/seed, cloud capacity or native-device result is implied.

Deployed SMS and push default to **Disabled**, returning explicit unavailability
when invoked. All three legacy scheduled workers and stub resolution are rejected
outside Development. This is intentionally a safe foundation, not a playable
public service with development adapters hidden behind production configuration.
