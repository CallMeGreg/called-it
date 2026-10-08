# Delivery plan and owner actions

This is a staged rebuild from an unvalidated prototype. The owner has approved
the constraints in [the decision register](README.md), not every proposed rule.
No phase authorizes purchasing services, deploying Azure resources, publishing an
app, deleting old resources, or overwriting another prototype branch.

## Delivery order

| Phase | Work | Exit condition |
| --- | --- | --- |
| 0. Blueprint and safe foundation | Replace misleading docs; enforce production configuration and identity ownership; move boards toward durable SQL; harden IaC/bootstrap and deployment gating. | Documents separate evidence from intent; unsafe defaults are rejected; first slices compile and preserve existing contracts where possible. **Not a public beta.** |
| 1. Competition integrity | Versioned publication/acceptance, realistic event cutoffs, enrollment semantics, outbox/leases, chronological scoring, corrections, SQL concurrency. | Full deterministic round and restart/duplicate/lock tests pass against the production database provider. |
| 2. Identity and privacy | Select managed phone verification; complete phone/social challenge binding, session rotation/recovery, deletion/export, operator roles, block/report. | No bypass/test identity in release; vendor-backed and failure flows exercised on devices; privacy data inventory complete. |
| 3. Cross-platform vertical slice | Expo native development builds; onboarding, Today, receipts, results/history, standings/You, secure storage and deep links. | A real iOS and Android device completes the same round against the API, including offline/late/error states. |
| 4. Retention and operations | Season/achievement rules, content operator UI, licensed feeds/manual evidence, notification preferences/installations/dispatcher, minimal telemetry. | Durable replay/correction works; all push categories honor consent/expiry; two upcoming real rounds are reviewed. |
| 5. Regional closed beta | Named Azure region/SKUs, measured cost/load/recovery, security review, store-account checks, moderated UX sessions. | No unresolved release blocker; owners accept measured limitations and can operate/restore the service. |
| 6. Store release and expansion | Store review, signing, disclosures, staged rollout, support, acquisition limits. | Both stores approved; observed reliability/retention/cost justify expanding cohort or geography. |

Phases may overlap for independent UI/component work, but mock UI completion never
replaces the real-API/native/provider gates. Prefer small reviewable slices; do not
attempt a simultaneous microservice migration or wholesale feature build.

## First implementation slices

The first work should reduce the chance of launching an unsafe or unnecessarily
expensive prototype, not create the appearance that all gameplay is finished.

**Runtime/data guardrails:** remove known-key/permissive production configuration,
enforce social identity ownership and audience checks, replace process-local or
mandatory Redis ranking with reads from authoritative SQL score/streak projections,
bound leaderboard queries, and expose honest live/ready checks. Preserve core
scoring rules in this slice; temporal correctness remains a separate release gate.

**Infrastructure/deployment guardrails:** separate bootstrap from application
rollout, remove placeholder-image redeploys, make optional/retiring services
explicit rather than automatic, wire required configuration and probes, and make
workflow outputs reflect real success. Keep paid deployment disabled by default.
Read-only compilation/validation does not establish Azure deployability.

These slices must agree on config names, health routes and which adapters can be
disabled. An explicitly disabled feature should return an intentional unavailable
response if called, not silently use a development logger or return success.

**Progress:** the backend guardrails/SQL-read slice is integrated. Production
initialization is now read-only as well. A separate [migrator/category-seed command
and SQL Server lane](database-lifecycle.md) now implement the next prerequisites;
authorized Azure bootstrap/network/identity/restore evidence remains an explicit
gate. The lean Azure/bootstrap/application-deployment slice is also
integrated, with local-only defaults and no actual cloud deployment. Neither slice
implements the complete game, privacy flows or native client. See the
[implementation evidence](README.md#first-implementation-progress).

### Next implementation sequence

First ratify D1-D4 and D8; these determine eligibility, content timing and the
competition state machine. Phase 1 now has a **real SQL Server test lane and
separate migrator/category-seed command** for review; retain these checks while
implementing publication/atomic choice receipts, durable outbox/claims and ordered progression.
This closes the correctness gap instead of merely making more screens interactive.

In parallel with that bounded work, the owner can prove the D5 identity-provider
flow and D6 content rights, and commission the Expo UX prototype from the agreed
state specification. Do not deploy the foundation simply to unblock UI design;
a local frozen-clock practice mode can exercise UX without Azure spend.

No actual regional beta until networking, database grants/restore, vendor-backed
identity/privacy, native builds and the other release gates below are satisfied.

### Acceptance matrix for subsequent work

| Area | Required cases |
| --- | --- |
| Publication | Duplicate workers/admin retries, no partial set, one question per category, unique round identity, expired/resolved/event-started content rejected, restart after missed drop. |
| Acceptance | Before drop, just before/at/after lock, transaction stalls across lock, duplicate request ID, conflicting payload reuse, concurrent edits, stale revision, invalid enum, malicious user/set/question ID. |
| Enrollment | Newcomer before drop/during open/at lock, no pre-account penalties, blocked/banned account, no stale today's-round response. |
| Scoring | All correct/wrong/skip/missed/void; mixed categories; delayed earlier outcome; same event twice; crash after outcome commit; conflicting amend; full replay equals projection. |
| Boards | Equal scores, bounded/paginated reads, top plus around-me, accepted-friends scope, block/delete, restart/cache loss, stale projection labeling and deterministic as-of ordering. |
| Achievements | First award, retry, correction/revocation, participation versus result-dependent badge, backfill and definition version. |
| Identity | Wrong audience/issuer/expiry/signature/nonce, identity already owned elsewhere, phone reuse, send/verify limits, atomic OTP/refresh consumption, recovery, logout, deletion and lost credentials. |
| Notifications | Permission denied, device rotation/rebind/logout, forged tags, quiet hours/DST, completed player suppression, retries/duplicates, invalid credentials, TTL expiration, offline delivery and stale deep links. |
| Native UX | VoiceOver/TalkBack, large text, narrow phones, dark mode, reduce motion, interrupted sign-in, OS background/foreground, slow network, real app links and production-style signing. |
| Infrastructure | Missing env/secret, clean bootstrap, redeploy preserves image, SQL user/schema readiness, failed revision rollback, data-plane restrictions, provider/SKU/quota errors, restore and teardown plan. |

## Decisions requiring owner input

| ID | Decision | Recommendation / why it blocks |
| --- | --- | --- |
| D1 | Beta countries, language and age audience | Start narrowly; English-speaking US adults is a proposal, not an approved restriction or official age rating. Determines SMS, content and privacy obligations. |
| D2 | UTC drop, window duration and event cutoff buffer | Test the six-hour hypothesis with the target cohort and actual event calendar. Do not inherit 17:00 UTC unquestioned. |
| D3 | Final scoring/season/achievement rules | Approve Skip/miss/void behavior, newcomer eligibility, season boundaries, tied ranks, correction window and initial badge catalog before implementing versions. |
| D4 | Contact discovery | Defer contact upload/matching; use invite links first. Mandatory phone verification need not imply discoverability. |
| D5 | Identity/phone-verification supplier | Compare managed CIAM with managed verification plus app-owned sessions. Prove phone/social binding, phone evidence/uniqueness, re-verification cadence, country support, anti-fraud, recovery and pricing. See the sourced candidate comparison; no vendor is selected. |
| D6 | Content/feed licenses and editorial owner | Choose dependable sports/finance/culture sources, fallback evidence and a human daily operator/backup. "API exists" is not a commercial license. |
| D7 | Azure region/SKUs and actual estimate | Check the subscription's real constraints and quote within the USD 100-250 envelope, with headroom; accept measured availability trade-offs explicitly. |
| D8 | Outage fairness and operational coverage | Approve objective void/replacement thresholds, escalation owner, support hours and recovery objectives. |
| D9 | Store/legal/privacy readiness | Confirm publishing entity, target audience, phone-data necessity, policies, licenses and data retention with appropriate advice. |

## Manual setup and launch checklist

Legacy setup [#1](https://github.com/CallMeGreg/called-it/issues/1) is superseded
by this checklist and the current infrastructure guide, not a source of commands
to rerun. Read-only GitHub metadata revalidation on **2026-10-08** found:

| Previously checked claim | Current evidence / disposition |
| --- | --- |
| `dev` and `prod` environments exist / approvals configured | Both exist, but both have **no protection rules and no deployment-branch policy**. Deployment approval remains blocked. |
| Azure OIDC IDs and resource groups configured | Repository ID secret names and environment resource-group variable names exist. No secret values, Entra app/federation, Azure groups, roles or actual connectivity were verified. |
| Signing key, pepper and SQL password configured | Legacy secret names exist in both environments. Their presence is not proof of current versioned Key Vault values, correct runtime wiring or rotation. SQL password fallback is retired. |
| Automatic deployment enabled | The old repository `AZURE_DEPLOY_ENABLED` variable remains `true`; it is not approval. Current push/default-plan paths are local-only, and required protected-environment acknowledgments are absent. No settings were changed by this read-only revalidation. |

Retire the old ACS purchase/dev-OTP fallback, runtime `db_ddladmin`/startup-DDL,
optional approvals, old App Configuration/admin-phone bootstrap, and automatic
deployment instructions. Do not delete or rotate old resources/secrets without
an authorized adoption/cleanup plan. Apple-only SwiftUI setup is not the approved
shared iOS/Android release path. Product rules and all Azure/native/legal claims
without fresh evidence remain unverified.

Status for every item below starts **not verified**. Prior work, existing Azure
objects or old GitHub issues are not proof that the current design is configured.
No passwords, tokens, private keys or verification codes belong in documentation.

| Owner | Action | Evidence required before release |
| --- | --- | --- |
| Product owner | Ratify D1-D4 and D8; write player-facing rules and support commitments. | Signed-off rule/version table and cohort schedule. |
| Azure owner | Select subscription/resource groups, naming/tags, allowed region and provider registrations; inspect policies, quotas and actual SKU availability. | Recorded read-only validation plus current calculator estimate. |
| Azure owner | Configure cost/forecast alerts and a named budget responder; separately cap verification spend. | Alert delivery exercised, provider/compute/query limits documented. |
| Azure + GitHub owner | Establish environment-scoped OIDC federation and minimum deploy roles; separate role-assignment bootstrap from ordinary deployment where possible. | No long-lived Azure password; correct repository/environment subject and protected prod environment. |
| Database owner | Configure Entra admin, contained runtime users and a dedicated migrator; choose backup retention/redundancy. | Runtime lacks DDL; schema and seed setup work independently of API startup; restore drill recorded. |
| Security owner | Own signing keys, verification/hub secrets, rotation and emergency revocation; review origin and database access. | Least-privilege access and a tested rotation/recovery procedure. |
| Verification owner | Select/vendor-onboard supported countries and sender requirements; configure fraud controls, billing alerts and support/recovery. | Real-device verification and failure tests; no ACS-new-account dependency assumed. |
| Apple owner | Enroll/verify the developer entity, app/bundle identifiers and distribution ownership; configure Apple sign-in and associated domains. | Native signed build, correct audiences/redirects, signing recovery and App Store Connect access. |
| Google owner | Enroll/verify the Play account/entity; create application ID and Play App Signing/upload-key ownership; configure Google OAuth clients. | Verified account/device/test eligibility; release signing and provider fingerprints work. |
| Push owner | Configure APNs key/team/bundle/environment and Firebase FCM v1 credentials, then server-side hub installations. | Physical iOS and Android devices receive correctly expiring notifications; denied permission is harmless. |
| Domain owner | Provision privacy, terms, support, status, deletion and link-fallback pages; publish AASA/assetlinks documents over HTTPS. | Universal Links/App Links and external deletion requests work without developer tooling or reinstall. |
| Privacy/legal owner | Complete retention/deletion/export rules and vendor disclosures; review phone necessity, age/privacy obligations and repository/dependency distribution rights. | Public policies match implementation; source/license obligations and store terms reviewed on the exact release revision. |
| Content owner | Contract licensed sources, define cancellation/correction semantics, prepare the next two approved rounds and an emergency supply. | Human-readable outcome evidence, provider quota/latency checks, and named backup operator. |
| Moderation owner | Set conduct rules, blocked-user behavior, report/appeal queue and escalation. | End-to-end report, block and operator response exercises. |
| Release owner | Complete screenshots, store descriptions, rating questionnaires, support/review contact, privacy labels/Data safety and reviewer access. | Accurate metadata and a reviewer path that does not rely on receiving a perfectly timed live round. |
| Release owner | Perform required closed testing and staged releases. | Account-specific Play requirements met; TestFlight/device coverage; Apple and Google approval, not just uploaded artifacts. |

### Reviewer access and time restrictions

Reviewers may arrive outside the daily window or in another timezone. Provide
clear instructions, a functional practice/history path and an isolated review
environment/account when allowed. Do not ship a secret clock bypass into real
ranked play or waive phone verification globally to make review easier.

Explain the absence of money/prizes and the purpose of account/phone requirements.
Recheck current target SDK, iOS/Xcode upload requirements, privacy manifests,
required-reason API declarations and third-party SDK disclosures at submission.
Expo does not perform these owner/legal tasks automatically.

### Release definition of done

No public beta until all P0 findings in the trust register are closed with evidence,
the full round survives retries/restarts/corrections, both native platforms work,
account deletion and moderation operate, the real Azure topology fits the approved
budget under a measured cohort limit, and on-call/content responsibilities exist.

"Viral ready" is not a permanent status. Expand enrollment only when observed
capacity, content quality, abuse rates, cost and retention justify it. Keep a
waitlist/cohort cap and a rollback/read-only plan rather than promise unlimited
availability at a fixed tiny budget.
