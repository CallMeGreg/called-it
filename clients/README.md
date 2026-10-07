# Called It clients

**Approved launch direction:** one React Native/Expo application with native
development and release builds for **iOS and Android**. The small SwiftUI scaffold
in this branch is a legacy reference, not the shipping client or proof that either
store integration works.

See [UX/UI](../docs/ux-ui.md), [architecture](../docs/architecture.md), and the
[native/store delivery gates](../docs/delivery-plan.md). Earlier unmerged Expo/local
playground work is preserved separately; it is not imported or endorsed by this
clean-baseline redesign.

## Current layout

```text
clients/
  shared/openapi.yaml   Existing prototype API contract
  ios/                  Legacy SwiftUI scaffold
```

`shared/openapi.yaml` is useful baseline material, **not a verified complete
contract**. Establish API-generated/drift-checked schemas and typed client generation
before relying on it for the new client. Preserve mobile-version compatibility
when receipt, idempotency, season and account-lifecycle endpoints are introduced.

## Cross-platform requirements

Use native development builds rather than Expo Go for real Apple/Google sign-in,
OS secure storage, attestation, APNs/FCM, associated domains and notifications.
Choose a current compatible Expo/React Native toolchain at implementation time
and verify both stores' SDK/upload requirements; do not pin a version based on
an old prototype.

Implement typed API errors, single-flight refresh, secure session persistence,
foreground reconciliation, explicit saved/draft receipts, monotonic countdown
display anchored to server time, offline/late rejection, and accessibility.
No token, OTP, provider private key, contact pepper or production credential in
public Expo config, JS bundles, AsyncStorage, source, or screenshots.

Accounts require **verified phone and a linked Apple/Google identity**. The SMS
supplier must be selected; do not hardcode retiring ACS as the new architecture.
Phone changes, linking and recovery require dedicated safe server flows.

Register each installation through the authenticated backend. A SQL Device row
alone does not register it with Notification Hubs. Respect preferences, quiet
hours, TTL, token rotation and sign-out; notification receipt never grants a pick.

## Contacts and privacy

Do **not** distribute a shared HMAC pepper to clients or call enumerable phone
hashes private. Mandatory phone verification does not grant Contacts permission.
Invite links are the proposed v1 discovery mechanism; contact matching needs an
explicit later decision, opt-in, threat model, abuse limits and retention policy.

## Native release gates

Both platforms need owned bundle/application IDs, provider clients/redirects,
signing, native entitlements, device tests, privacy disclosures and store review.
Deliver in-app account deletion and a public external deletion-request page for
Google Play. Reviewer access must work outside the daily submission window without
introducing a production ranking bypass.

A local playground is valuable for frozen-clock UX scenarios, but its data, admin
controls and auth bypasses must be excluded from all release builds.
