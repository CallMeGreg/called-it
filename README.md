# Called It

A daily prediction-game prototype: make binary calls, follow real outcomes, and
compete through streaks, points, leaderboards and achievements.

**Status: being redesigned for a regional beta, not ready for public release.**
Existing code and infrastructure are implementation evidence, not validated
product decisions. The previous claims of a fully implemented production backend,
complete push delivery and deploy-ready platform have been withdrawn.

## Start with the blueprint

[Launch blueprint and decision register](docs/README.md) is the entry point.

| Topic | Document |
| --- | --- |
| Game rules, fairness, progression, content and growth | [Product](docs/product.md) |
| Runtime, data, durable jobs, identity and API design | [Architecture](docs/architecture.md) |
| Screens, state transitions, accessibility and visual direction | [UX/UI](docs/ux-ui.md) |
| Security, abuse, privacy and moderation | [Trust and safety](docs/trust-and-safety.md) |
| Azure cost, availability, notifications and incident handling | [Operations](docs/operations.md) |
| Implementation sequence, app stores and manual owner tasks | [Delivery plan](docs/delivery-plan.md) |
| Current official platform constraints and unresolved checks | [Platform evidence](docs/platform-evidence.md) |

Confirmed direction: one global submission window with a **regional beta**;
mandatory **phone verification plus Apple/Google sign-in**; a shared
**React Native/Expo** client for iOS and Android; free, non-redeemable rewards and
no initial ads/purchases. Azure beta spending should be designed toward
**USD 100-250/month**, excluding SMS and store accounts. This is not a price quote.

Exact geography, ages, UTC schedule, season rules, SMS/data suppliers and Azure
region/SKUs remain owner decisions. Earlier unmerged prototypes are preserved as
reference rather than silently imported into this branch.

## Repository

```text
src/CalledIt.Domain/          Entities and pure scoring calculations
src/CalledIt.Application/     Identity, competition, scoring and social use cases
src/CalledIt.Infrastructure/  Persistence and external adapters
src/CalledIt.Api/             ASP.NET Core HTTP API
src/CalledIt.Workers/         Existing scheduled worker host
tests/                       Domain, application and API tests
infra/                       Bicep and deployment configuration
clients/shared/              Existing OpenAPI contract
clients/ios/                 Legacy SwiftUI reference, not the approved launch client
docs/                        Reassessed design and delivery gates
```

The target remains a .NET 10 modular monolith plus workers, Azure SQL as the
authoritative store, and a lean single-region Azure deployment. SQL-backed
leaderboards avoid making Redis a prerequisite before measured load warrants it.
Durable scheduling/outbox processing and a store-ready mobile app are delivery
work, not completed capabilities implied by the architecture diagram.

The first backend slice is integrated: strict deployed configuration, phone/social
ownership checks, SQL-backed standings, and separate liveness/readiness. Deployed
hosts no longer migrate/seed the database at startup; a separate approved
bootstrap is required. SMS, push and legacy scheduled jobs remain intentionally
disabled by default, so these guardrails do not make the app public-beta ready.

## Local backend development

Install the **.NET 10 SDK**. Local Development uses SQLite and deliberately
non-production authentication/messaging adapters; never expose it publicly.

```bash
dotnet restore CalledIt.sln
dotnet build CalledIt.sln -c Release --no-restore
dotnet test CalledIt.sln -c Release --no-build
dotnet run --project src/CalledIt.Api --launch-profile http
```

Inspect `src/CalledIt.Api/Properties/launchSettings.json` for the local URL.
Use the development API/Swagger surface and existing tests to explore the
prototype contract. Development OTPs and fake social tokens are test mechanisms,
not a production login flow.

The baseline solution built locally and its 33 existing tests passed during the
2026-10-07 reassessment. Those tests do **not** establish correct SQL Server races,
fair timing, native behavior, cloud capacity or store readiness; some fixtures
resolve outcomes while picks are still open and must be replaced in the
competition-integrity phase.

See [current implementation progress](docs/README.md#first-implementation-progress)
for the guardrail coverage and its remaining validation limits.

## Infrastructure and clients

Read [infra/README.md](infra/README.md) before any Azure action. Compilation is not
a deployment, subscription/SKU availability check, restore exercise or cost quote.
No cloud provisioning or store publication is authorized by this plan.

Read [clients/README.md](clients/README.md) for the cross-platform direction.
The checked-in SwiftUI scaffold has no production sign-in, secure token storage
or complete notifications. Do not follow the old client-pepper/contact-hashing
approach as a privacy design.

Microsoft has announced ACS SMS retirement; the new verification supplier is an
explicit owner selection. Phone verification remains required by product choice,
but a non-Azure managed verification provider is permitted.

## License

See [LICENSE](LICENSE). Review server, mobile and dependency distribution
obligations before release; this redesign does not change the repository license.
