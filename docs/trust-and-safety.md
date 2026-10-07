# Trust, security, privacy, and abuse

This is a launch-oriented threat assessment, not a penetration-test certificate.
Findings below refer to the inspected starting revision recorded in
[the blueprint](README.md); implementation progress belongs in the delivery plan.
Do not deploy the prototype publicly on the strength of passing happy-path tests.

## Trust boundaries

The device, its clock, request order, push token, attestation claim, and all client
configuration are untrusted inputs. The API authenticates the caller; the database
owns eligibility, accepted choices, identity ownership, result revisions, and
authorization state. Operator accounts and provider responses are separate,
high-impact trust boundaries.

Threat actors include opportunistic API callers, SMS fraud operators, account
farmers, an abusive friend/league member, stolen-session holders, compromised
operators, and accidental operator mistakes. Legitimate retries and outages must
not resemble cheating or corrupt progress.

## Observed baseline risks

| Priority | Evidence | Consequence and required control |
| --- | --- | --- |
| P0 | `Api/Program.cs` accepts a known zero-filled fallback signing key; Infrastructure chooses development adapters from missing configuration. | Production must fail closed before initialization/listening. Development credentials/adapters must be explicitly environment-limited. |
| P0 | `OidcSocialTokenValidator` disables audience validation if the audience is empty; Bicep does not supply provider audiences. | A token for another application may be accepted. Require audience/issuer/signature/expiry/subject validation, nonce-bound flows, and key-rotation handling. |
| P0 | `AuthService.ResolveOrCreateUserAsync` checks whether an identity is linked anywhere, not whether it belongs to the phone's user. | The mandatory two-identity policy is not enforced. Deny cross-account combinations and require a separate recent-authenticated link/recovery flow. |
| P0 | Auth refresh/OTP checks use read-then-write state without concurrency control or token-family replay revocation. | Parallel consumption/rotation can defeat intended one-use controls. Use transactional consume/CAS, bounded attempts, family revocation, and negative race tests. |
| P0 | Daily-set creation accepts questions resolving before lock; submissions do not check question outcomes. | Known-answer scoring is possible. Enforce event cutoff, publication immutability, and authoritative atomic acceptance. |
| P0 | Outcome writes and recompute are separate; due queries exclude already-resolved questions after a crash. | Scores can remain stale permanently. Persist an outbox with the outcome transaction and replay versioned projections. |
| P0 | No account deletion, export, block/report workflow, or real operator authorization lifecycle is wired. | Store/privacy/abuse obligations remain unfulfilled. These are launch gates, not post-launch polish. |
| P0 | SQL migration runs in API startup; shared identity plus DDL grant is recommended in old docs. | Runtime compromise has excessive reach and multi-replica deploys can race. Separate migrator/runtime privileges and gate schema rollout. |
| P1 | OTP limits are per-phone, non-atomic read/count checks; phone parsing only checks prefix/length. | SMS pumping across numbers and concurrent requests remains possible. Managed verification, strict normalization, atomic multi-dimensional limits and spend controls. |
| P1 | Contacts docs distribute a shared pepper; `DiscoverableByPhone` defaults true; matching is enumerable. | A secret embedded in a client is not a secret; hashed phones remain personal data. Default off and defer discovery rather than claim cryptographic privacy. |
| P1 | Redis/in-memory ranking semantics differ, bounds are incomplete, and failed cache publication is not durably retried. | Inconsistent standings, expensive queries, or lost boards. Prefer indexed SQL projections first, bounded reads and explicit tie/finality rules. |
| P1 | A health endpoint always returns success; environment variables name telemetry/config resources without loading those SDKs. | The platform can look healthy while gameplay is unavailable. Dependency-aware readiness and verified end-to-end telemetry are required. |
| P1 | Device registration only writes a SQL row; reminder workers broadcast without consent/deduplication. | Push is neither fully registered nor appropriately targeted. Server-owned installations, preference/TTL checks and a durable dispatcher. |
| P1 | Deployment converges default hello-world images before updating applications; no readiness/migration gate. | A deployment can replace the real service with a placeholder or incompatible revision. Explicit images, staged provisioning, probes, health verification and rollback. |

## Required identity design

Use an opaque immutable user ID. A phone is a replaceable, verified credential,
not a permanent human identifier: numbers are recycled, ported, shared, and
SIM-swapped. Apple/Google subject ownership is unique by provider and subject.
Never merge users based solely on email or newly verified ownership of an old phone.

Bind a verification transaction to purpose, intended phone, provider subject,
expiry, attempt count, and server-generated challenge. Do not treat an arbitrary
valid social token plus a phone OTP as proof of ownership of an existing account.
Existing users authenticate the linked combination; link, unlink, phone change,
and recovery are distinct recent-authentication operations with audit records.

Choose a managed verification supplier after supported-country, fraud controls,
privacy, price and recovery checks. The abstraction should **start and verify a
challenge**, not assume the app generates/logs every OTP itself. No production
test code, test-phone bypass, or permissive fallback on supplier failure.

Keep access tokens short-lived, refresh tokens hashed and device/session-scoped,
and refresh rotation atomic with family replay detection. Support logout and
revocation. Use OS secure storage in native clients, not AsyncStorage or logs.
Do not put provider client secrets, SMS credentials, contact peppers, or hub send
keys in Expo public configuration, JS bundles, or OTA updates.

Use App Attest/DeviceCheck and Play Integrity as measured abuse signals, with
server validation and replay resistance. They do not prove one human per account
or make the API trustworthy. Define an accessible remediation path for legitimate
devices rather than silently excluding them.

## Authorization and abuse controls

Check ownership for every pick, device, friendship, league membership, data export
and deletion. Use server-owned notification tags; a caller must not subscribe
their token to another user's private stream. Limit body sizes, batch sizes,
pagination, invite attempts, matching, and leaderboard queries.

Place rate limiting at the app boundary as well as the edge; configure trusted
proxies before using forwarded client IPs. Per-phone limits alone cannot cap SMS
cost. Add IP/device/account/country limits, a global verification budget, alerts,
and an operator kill switch that does not disable already-authenticated gameplay.

Operator access should use a separate Entra-authenticated surface with MFA,
least-privilege roles and audit trails. A configured phone list is a development
bootstrap, not the long-term production admin system. Require reasons and review
for amendments, bans and data exports; redact personal data from audit payloads.

No arbitrary URLs, SQL, executable expressions or unrestricted network fetches
from question rules. Use typed, versioned provider rules and outbound allowlists;
validate source signatures where available and retain evidence for disputes.

## Privacy, moderation, and retention

Inventory verified phones, social subjects, tokens, device installations, IP/abuse
signals, guesses, social edges, analytics and support data. Define legal basis,
region, access, retention period and deletion action per class before collection.
Encrypt transport/storage; restrict and audit decryption/access to phones.

Provide in-app deletion plus Google's external deletion-request page, recent-auth
confirmation, session revocation, device deregistration, identity-provider actions,
social-edge removal and analytics/vendor erasure. Publish narrow lawful retention
exceptions for fraud/audit data. Anonymize public history where justified; deletion
must not break opponents' scores or silently leave a phone discoverable.

Backups are not instantly editable: restrict restored data and replay an erasure
tombstone ledger after restoration, then reapply retention. Set explicit policies
for OTP challenge expiry, stale installations, logs, exports and backup retention.
Short-lived signed export downloads must be authorized and non-public.

Player-chosen names and league names still require abuse handling even without
chat. Ship block/report, a moderation queue, published conduct/support contacts,
response ownership and appeal handling. Avoid arbitrary avatars and public UGC
until these controls and staffing exist.

Mandatory phone plus social sign-in is an owner choice, **not a guarantee of store
approval**. Document why each item is necessary for core account/integrity features
and validate that justification against data-minimization/review requirements.
Age eligibility and jurisdiction-specific privacy obligations require owner/legal
review; an age rating is not a substitute for consent policy.

## Before public testing

Exercise forged/foreign-audience tokens, missing configuration, conflicting
identity ownership, OTP/refresh races, late and duplicate picks, hostile IDs,
notification tag escalation, leaked signing-key rotation, deletion after restore,
and direct-origin bypass. Include a focused independent security review once the
real auth/deployment paths exist. No unresolved P0 issue enters a public beta.
