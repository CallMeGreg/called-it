# Operations, notifications, and long-term health

Status: proposed operating model and acceptance targets, not a deployed SLA.
Actual provisioning behavior is documented in [infra](../infra/README.md).

## A budget-conscious Azure beta

The owner approved **USD 100-250/month for Azure**, excluding SMS and developer
accounts. This is a ceiling to design toward, not a verified quote. Budget alerts
do not stop spending. Do not deploy until the selected subscription/region/SKUs
have a current estimate and an agreed over-budget response.

Start with a single-region Container Apps API, a bounded worker process, a small
Azure SQL database, ACR, managed identities, secrets, and capped observability.
SQL holds durable leaderboard projections; Redis is not required just because a
leaderboard exists. Provision Notification Hubs only with an enabled, configured
push workstream. Defer App Configuration, blob share rendering, Front Door Premium,
API Management, Service Bus/Event Grid, AI services, and multi-region replication
until their specific need and cost are established.

Keep at least one API replica warm during competition. An always-running worker
must have a replica or it will not execute timers. Scheduled Container Apps Jobs
are a later cost alternative **after** durable catch-up/leases make restart safe;
changing the hosting resource alone cannot fix missed work.

| Budget control | Policy |
| --- | --- |
| Planning | Keep the base estimate below the maximum, leaving incident/traffic headroom; quote compute, SQL, logs, identity/secrets, registry, push, network and backups separately. |
| Alerts | Notify the owner at 50%, 80% and 100% of the agreed monthly envelope; also monitor forecasted overspend. |
| Guardrails | Bound replica counts, log ingestion/retention, expensive queries, provider polling, SMS attempts and exported media. |
| At risk | Reduce optional telemetry volume and nonessential work; pause acquisition or invitation rollout before degrading authoritative pick acceptance. |
| Never | Automatically delete the database, silently drop accepted work, or promise that an Azure budget is a hard charge cap. |

For beta, accept a documented single-region failure domain and potentially a
single warm API replica. Two replicas and zone redundancy improve availability
but must fit the estimate and a supported environment. Do not describe this
budget tier as multi-region, zero-downtime, or guaranteed viral-scale capacity.

Compare a small provisioned SQL tier with serverless held warm. A cheap DTU tier
may be adequate for a small cohort but lacks some HA options; serverless auto-pause
can break the first requests of a timed event. Choose from measurements and
region support, not a hardcoded "production" label.

## Azure availability evidence

For each environment, record service provider registrations, region/SKU support,
quota/usage, relevant Azure Policy restrictions, network/DNS constraints and the
actual validation result. Supported-region documentation is necessary but not
sufficient for deployability. Do not cycle through regions provisioning resources
until something happens to work.

Preview with Bicep compilation and what-if, then explicitly approve the named
resources and cost. Bootstrap infrastructure before application rollout; create
Entra SQL users and schema with a separate migration identity. Runtime should
not own DDL or Azure role-assignment permissions.

Prefer private data-plane access where the chosen affordable topology supports it.
If public endpoints are used temporarily, require least-privilege identity,
narrow firewall/egress rules, TLS, monitoring, and a documented exception. The
"allow all Azure services" SQL rule is not equivalent to allowing only this app.
Do not add Front Door while leaving an unprotected public-origin bypass.

## Capacity model and acceptance targets

Initial sizing hypotheses: up to **10,000 daily active players**, one common
drop/lock, small three-choice writes, and skewed leaderboard reads. This is not a
guarantee that the lowest-price database can sustain a launch spike.

| Exercise | Initial acceptance target to validate |
| --- | --- |
| Representative round | 10,000 eligible players with realistic existing history, friends and score rows. |
| Drop burst | 100 read requests/second plus 50 submission requests/second for two minutes, then a normal daily profile. Increase to twice the measured expected peak before expanding the cohort. |
| Deadline burst | Many overlapping submissions/edits spanning the lock; zero accepted late writes, duplicates or silent lost updates. |
| API latency | Accepted-pick p95 below 500 ms and ordinary read p95 below 1 second in the chosen hosting region, excluding intentional throttles and external sign-in. |
| Projection lag | Most ordinary result changes reflected within 60 seconds; explicit pending state during catch-up. |
| Recovery | Worker restart, provider outage, duplicate job and stale lease do not lose committed work or double-award. |

Use realistic SQL Server/Azure SQL semantics, not only SQLite. Record replica
count, database tier/CPU/IO, connections, query plans, queue depth, request mix,
latency percentiles and cost. Reject the target size or raise the budget if the
chosen tier cannot meet these tests; cap beta enrollment rather than assert scale.

Candidate beta availability objective: 99.5% successful eligible API operations
over a rolling month, with a separate submission-window/error-budget dashboard.
Track validation rejections separately from unexpected 5xx/timeouts; report provider
auth outages rather than hiding them from the player-facing experience. This is
an engineering objective, not a contractual promise.

## Notifications are a durable preference-driven subsystem

| Type | Eligibility | Expiry / suppression |
| --- | --- | --- |
| Drop | Opted-in player in the enabled cohort; real published round exists. | Expire no later than lock; respect quiet hours even though the drop is global. |
| Closing | Still has unsubmitted choices, opted in, round open, permitted local hour. | Short useful TTL ending at lock; never remind everyone blindly. |
| Results | Player participated; meaningful result revision is available. | Coalesce category updates; avoid repeating the same result/version. |
| Social | Explicit preference plus an allowed friend/league relationship. | Rate-limit and coalesce; blocked users cannot trigger it. |
| Service/correction | Relevant affected player; appropriate channel and preference policy. | Link to current authoritative state; no sensitive details on the lock screen. |

Persist preferences and IANA timezone, quiet hours, installation ownership,
platform/environment, token rotation, last-seen and revocation. The backend creates
or updates Notification Hubs installations for APNs/FCM v1 with server-controlled
tags. Remove invalid registrations and rebind/logout safely on shared devices.

Write notification intents transactionally with game events; claim jobs with
leases, check current preferences and eligibility immediately before dispatch,
set provider TTL/APNs expiration, and record attempts and deduplication keys.
Use bounded exponential retry for transient failures, respect retry-after, and
dead-letter permanent failures. Expired jobs are recorded as suppressed, not
reported as delivered.

Exactly-once handset delivery is impossible to promise. Distinguish intent,
provider handoff, provider error, and user-open telemetry. A duplicate push must
not duplicate game actions. The app re-fetches the round on open; a displayed
notification can be stale even after its delivery TTL expires.

## Observability and operator routines

Required signals: accepted/rejected picks by reason, clock/deadline conflicts,
round publication lag, unclaimed/oldest jobs, resolution age, score version lag,
identity/OTP failures and spend, DB saturation, ready replicas, notification
failures/suppression, and crash-free mobile sessions.

Trace a request/event/job with an opaque correlation ID. Do not log OTPs, JWTs,
refresh tokens, full phones, contact lists, sensitive provider payloads, or request
bodies by default. Sample high-volume telemetry and configure retention/cost caps.
An App Insights connection-string variable alone is not instrumentation.

Daily: verify the next two rounds, provider health/quota, unresolved disputes,
job lag and budget alerts. Weekly: review safety reports, question quality, cohort
retention, expensive queries and backup health. Monthly: restore rehearsal,
dependency/runtime/store-policy updates, credential ownership/expiry and capacity.

## Incidents and fairness

Prepare operator runbooks for a missed drop, partial publication, acceptance
outage near lock, bad outcome, SMS abuse, identity-provider outage, stalled scoring,
credential compromise, notification spam, data breach and region failure.

Proposed competition policy: a verified service-wide submission failure that
materially prevents fair participation leads to a globally neutral void or an
announced replacement round. Do not selectively accept client timestamps, grant
private late picks, or extend a window once relevant outcomes can be known.
Approve objective outage thresholds and the decision owner before beta.

Use a game read-only/maintenance switch independently of authentication and
notification/SMS kill switches. Surface an incident state in-app and through a
status/support page. All result changes carry a reason and revision; replay scores
and achievements through durable jobs, then notify affected users.

## Recovery and sustainability

Proposed beta targets to prove: same-region recovery within four hours with
at most 15 minutes of recoverable-data lag; regional disaster recovery within
24 hours with at most one hour of lag **only if** selected backup redundancy and
restore evidence support it. Otherwise publish the weaker demonstrated objective
or change the tier/budget before public play.

Back up the data, configuration, migration history and recovery procedures, not
just container images. Test identity grants and secrets in a restored environment,
replay erasure tombstones and outbox work, and reconcile projections before
reopening rated play. Rebuilding a cache cannot restore missing guesses.

Maintain upgrade ownership for .NET, EF Core, Expo/React Native, native SDKs,
APNs/FCM credentials and dependencies. Use one operator-supported region and
simple modules until team size/load justify more infrastructure. Track content
hours, moderation burden, verification cost per activated player and incident
hours alongside DAU; popularity without an affordable operating model is not
long-term game health.
