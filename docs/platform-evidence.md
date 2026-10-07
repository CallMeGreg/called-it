# Platform evidence and external gates

Official documentation reviewed on **2026-10-07**. These are source-backed
constraints, not proof of subscription capacity, vendor eligibility, pricing,
store approval, or legal compliance. Recheck date-sensitive rules before release.

## Azure

| Source | Observed constraint | Design consequence / unverified gate |
| --- | --- | --- |
| [Container Apps reliability](https://learn.microsoft.com/en-us/azure/reliability/reliability-container-apps) | Zone redundancy is supported in qualifying regions/profiles, configured at environment creation; multiple replicas are needed to use it. Jobs must tolerate interruption/restart. | Pick environment/network/zone design deliberately. A region listed as supported does not guarantee subscription quota or physical capacity. |
| [Container Apps scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app) | HTTP scaling is reactive, evaluated on a cadence; scale-to-zero adds startup delay. | Keep a warm API during competition. Load-test min/max replicas and database connection limits rather than extrapolate from DAU. |
| [Front Door integration](https://learn.microsoft.com/en-us/azure/container-apps/how-to-integrate-with-azure-front-door) | Private Link integration requires Front Door Premium and an appropriate workload-profiles environment. | Premium edge is not assumed affordable in the beta budget. Adding a WAF alone does not prevent bypass through a public origin. |
| [SQL Database reliability](https://learn.microsoft.com/en-us/azure/reliability/reliability-sql-database) | Tier-dependent zone support, backups and asynchronous geo-replication solve different failure modes. Some inexpensive tiers do not support zone redundancy. | Choose an explicit durability target; validate backup redundancy and restore. No automatic multi-region guarantee. |
| [SQL serverless pause/resume](https://learn.microsoft.com/en-us/azure/azure-sql/database/serverless-tier-auto-pause-resume?view=azuresql) | Resume generally takes about a minute; the initial connection can receive error 40613. Some features prevent auto-pause. | Do not let a rated window depend on a paused database resuming on time. Benchmark a small provisioned tier versus warm serverless. |
| [SQL Entra principal provisioning](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-aad-service-principal-tutorial?view=azuresql) | Azure RBAC is not a database user grant; initial Entra/database bootstrap and directory permissions may be necessary. | Owner must authorize and test runtime/migrator identities separately. Do not grant runtime DDL just to make startup work. |
| [Redis retirement FAQ](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq) | Legacy Enterprise tiers retire March 31, 2027; Basic/Standard/Premium retire September 30, 2028. Azure Managed Redis is the successor with its own region/SKU/HA constraints. | Defer Redis until measured SQL queries require it. If later needed, select Managed Redis deliberately; do not add retiring Azure Cache for Redis. |
| [ACS retirement announcement](https://learn.microsoft.com/en-us/azure/communication-services/acs-retirement-and-breaking-changes-guide) | Microsoft announced ACS SMS retirement on September 30, 2028, with new-customer signup restrictions beginning October 23, 2026. | Do not establish ACS SMS as this greenfield app's verification dependency. Verify transition eligibility if evaluating any legacy account. |

No Azure resources were provisioned to validate this blueprint. Earlier prototype
branches are preserved separately; neither earlier experiments nor public region
tables establish that the target combination can be deployed now.

Before choosing a region, record exact service/SKU support, subscription quota,
provider registration, policy restrictions, data residency, capacity response,
and a current calculator estimate. Run read-only validation/what-if first; actual
deployment requires owner approval and a resource/cost teardown plan.

Historical context, **not a current capacity check**: a preserved 2026-10-07
prototype experiment reported Container Apps environment creation in Central US
failing with `ManagedEnvironmentCapacityHeavyUsageError` /
`AKSCapacityHeavyUsage`. This is precisely why "listed as supported" is not a
deployment guarantee. Do not import its resource IDs or switch regions
automatically. Failed resource creations also need explicit inventory/cleanup;
a list of successfully created resources can omit failed remnants.

## Authentication candidates, not a vendor selection

| Candidate and source | Verified capability | Proof still needed for this game |
| --- | --- | --- |
| [Entra External ID identity providers](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-authentication-methods-customers) and [MFA](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-multifactor-authentication-customers) | Apple/Google social federation is available through browser-delegated authentication. External-provider sign-in can use SMS as a paid MFA factor; SMS is not a first-factor sign-in method. | Verify the required phone evidence/uniqueness, identity linking, recovery, re-verification cadence, mobile UX, country availability, add-on pricing and subscription behavior. Do not assume the native-authentication SDK supports social login. |
| [Twilio Verify](https://www.twilio.com/docs/verify/api) | A managed verification workflow with SMS and other channels, accessed by authenticated server APIs. | Validate country eligibility, fraud/attempt controls, privacy, price and outage handling. Verification alone does not own the game's social linking, session lifecycle or recovery. |
| [Firebase account linking](https://firebase.google.com/docs/auth/android/account-linking) | Multiple credentials can link to one stable Firebase user, and a credential already owned elsewhere cannot simply be linked. | Linking permits sign-in with alternative providers; it is not proof that phone **and** social requirements are enforced together. Verify MFA/enrollment policy, native support, recovery and data-location/cost constraints. |

The owner permits a non-Azure verification supplier; that does not rule out Entra
External ID or approve any vendor. Prototype hardening must not lock in a custom
authentication system by accident. Complete this bounded provider proof before
building the full identity lifecycle or requesting production credentials.

## Stores and mobile release

| Source | Observed constraint | Design consequence / owner action |
| --- | --- | --- |
| [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) | Sections 4.8 and 5.1 govern social-login alternatives, account deletion and privacy; 1.2 covers UGC controls; 4.5.4 covers push; 5.3 covers gaming/contests. | Provide appropriate Apple login, in-app deletion, optional push, moderation and accurate privacy statements. Mandatory phone collection still needs a defensible core purpose. |
| [Apple age-rating definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions) | Contests can include rankings/personal goals; territory and frequency affect ratings. No cash does not automatically imply a child-directed rating. | Complete the actual questionnaire and choose an eligible audience with legal review. This blueprint assigns no official age rating. |
| [Google Play User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en) | Account creation entails in-app and external account-deletion request paths, with associated-data handling and accurate Data safety declarations. | Ship a working public deletion URL, privacy policy and vendor data inventory, not only a settings button. |
| [Play account setup](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en) and [testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) | Verification depends on account type; qualifying new personal accounts require 12 opted-in testers for 14 continuous days before applying for production access. | Owner checks account eligibility and recruits testers. Passing that duration is not automatic production approval. |
| [Play target API policy](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) | The reviewed policy requires new/updated phone/tablet apps to target Android 16 / API 36 from August 31, 2026. | Choose a compatible Expo/native toolchain and validate behavior changes. Recheck Play Console at submission; do not infer future deadlines. |
| [Android app signing](https://developer.android.com/studio/publish/app-signing) | Release artifacts must be signed; Play App Signing and upload keys have distinct responsibilities. | Owner controls signing/recovery and provider fingerprints. A shared codebase does not remove native release credentials. |

Apple's guidelines specifically regulate binary-options **trading** and real-money
gaming. A free binary-prediction game is not automatically either, but labels do
not decide policy classification. Keep non-redeemable points separate from
financial products and obtain review before adding prizes, entry fees or currency.

The inspected baseline's `LICENSE` is MIT. Review the exact license on the
eventual release revision and every dependency for distribution/source
obligations, signing/store terms and necessary contributor rights; other branches
are not evidence of this branch's license. This plan does not change the license
or assert a legal conclusion about store compatibility.

## Notifications

| Source | Observed constraint | Design consequence |
| --- | --- | --- |
| [Notification Hubs cross-platform setup](https://learn.microsoft.com/en-us/dotnet/maui/data-cloud/push-notifications?view=net-maui-10.0) | Demonstrates APNs and FCM v1 provider configuration, native entitlements and permission handling. | The provider facts apply independently of client UI framework. Configure native Expo development builds, APNs environments and Firebase credentials; this tutorial is not a production app. |
| [Notification Hubs FAQ](https://learn.microsoft.com/en-us/azure/notification-hubs/notification-hubs-push-notification-faq) | Neither delivery nor latency through platform notification systems is guaranteed. | Successful hub handoff is not device receipt. Never use push to establish eligibility, synchronize a lock, or promise an exact alert time. |
| [FCM message lifespan](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan) | Without an explicit limit, messages can outlive a daily game window; TTL and APNs expiration govern pending delivery. | Set event-specific expiry, suppress stale queued reminders, and refresh authoritative state on open. Expiry does not retract a displayed notification. |

Sports, finance and entertainment data rights were **not** verified for a chosen
supplier. Commercial use, redistribution/caching, attribution, historical evidence,
territorial availability, quotas and correction terms are explicit owner gates.
