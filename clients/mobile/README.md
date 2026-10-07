# Called It TEST - shared client

A phone-first Expo / React Native client for **iOS, Android, and web**, scaffolded with
`create-expo-app`'s current `blank-typescript` template. SDK 57, React Native 0.86, and
React 19 packages are pinned by `package-lock.json`; native/web packages were selected
with `expo install`. TypeScript is strict.

The first playable distribution is the Azure-hosted **web** build. Native-compatible
components and token storage are implemented; a working web export is **not evidence
of an Xcode/Gradle build, device validation, or App Store/Google Play readiness**.

## Playable scope

- Invite-only TEST login with a public display name and privately issued invite code.
  No real SMS/social login, payments, odds, prizes, or local fake accounts.
- Shared two-minute rounds: one Sports, Finance, and Pop Culture card. Pick A, B, or
  Skip; change a saved call until the server locks the round.
- Sample questions and **explicitly simulated outcomes**. Picks, skips, scores, and
  leaderboards come from the API and are actually stored there.
- Previous-round results distinguish correct, wrong, skipped, missed, void, and pending.
  Stats show lifetime points and each category's current/best streak and total correct.
- Global boards support lifetime points, combined streak, category streak, and category
  best. Combined streak is the **sum of three category streaks**, not perfect rounds.

Correct adds one point and grows its category streak. Wrong/missed resets that category's
streak. Skip/void preserves it without points. The server remains authoritative.
Normal production's daily six-hour gameplay is unchanged; this client targets TEST only.

## Setup and commands

Use a current supported Node LTS (Node 24.3+ recommended, or Node 22.13+). Local validation
also works on Node 25.2.1 / npm 11. Run all commands from this directory:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run export:web
```

`export:web` generates a static single-page site in **`dist/`**. The shared deployment
Docker build copies its contents to ASP.NET `wwwroot`; web and API share one HTTPS
origin. Navigation is in-app, without server-side rendering, a Node web service, or a
service worker. `dist/`, local environment files, generated native projects, and test
artifacts are ignored.

```bash
npm run web       # Expo/Metro web development
npm run ios       # Expo development on an iOS simulator/device
npm run android   # Expo development on an Android emulator/device
```

The native commands need the relevant local tooling/device and a compatible Expo Go or
development build. They do not create an EAS account, EAS project, signing credentials,
or an app-store release.

## Public configuration

**Only `EXPO_PUBLIC_API_BASE_URL` is public application configuration.** It is bundled
into client JavaScript at build time, not a secret or a runtime Azure setting.

| Target | Configuration |
| --- | --- |
| Azure web | Leave unset/empty; requests use relative `/api/...` paths on the page's origin. |
| Native | Set to the deployed **HTTPS origin**, e.g. `https://<your-test-api-host>`. Missing/invalid configuration is a visible blocking error. |
| Separate-origin web | Set to an HTTPS API origin and explicitly allow the web origin in the API's CORS configuration. |
| Local web development | Explicitly set an API origin as shown below and allow Metro's origin in the API. No localhost API default is embedded. |

Use an origin only: no `/api`, URL credentials, query string, or fragment. Native always
requires HTTPS. An explicit HTTP `localhost`, `127.0.0.1`, or `[::1]` override is accepted
**only in a development web build**, never as a release override or on native.

For a separately running local TEST API:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:5080 npm run web -- --port 8081
```

Configure that API's allowed web origins to include **`http://localhost:8081`**, not `*`.
This app does not alter backend CORS or enable TEST mode. For a production-style local
same-origin check, export with the variable unset and serve `dist/` from the API's
`wwwroot`. A native device instead needs a reachable HTTPS TEST API; loopback on a
phone is not the developer computer.

Never put invite codes, test credentials, tokens, signing material, or cloud secrets in
`app.json`, any `EXPO_PUBLIC_*` value, tracked `.env` files, or the static export.
Invite issuance and revocation belong to the server/operator.

## Session and request behavior

- Native sessions use `expo-secure-store`, with device-only Keychain accessibility on
  iOS and Expo's secure Android storage/backup configuration. Native storage failure
  is visible and does **not** fall back to plaintext. iOS Keychain data can survive an
  uninstall/reinstall; use Sign out to clear it rather than assuming uninstall revokes
  the session.
- Web sessions use **`sessionStorage`**, not `localStorage` or cookies. A tab can reload
  without re-entering its invite; the invite code itself is cleared from the form on
  submit and is never written to storage. Browser tab duplication can copy an initial
  `sessionStorage` snapshot: rotated-token conflicts then require re-login in that tab.
- If the browser blocks storage before a session has been saved, the app explicitly
  displays a **memory-only session** warning on both welcome and game screens. Reloading
  loses that session. It never silently replaces a known persisted token after a failed
  rotation write. Cleanup failure is shown with a retry action rather than claiming the
  saved session was removed.
- Stored data is versioned, validated, and bound to the API origin. Changing APIs,
  invalid storage, or an invalid refresh token requires a fresh sign-in. Logout clears
  local tokens and all account-specific screen state; it does not delete the server
  account or claim to revoke every device's session.
- Access tokens refresh shortly before expiry or once after a `401`. Concurrent
  refreshes are **single-flight**. The rotated token is persisted **before** retrying
  a request. A delayed `401` reuses an already refreshed token. An account generation
  prevents late responses/writes from restoring an old account after logout.
- Requests time out after 15 seconds; bearer requests do not follow redirects.
  HTTP failures use the middleware's RFC 7807 `title`/`detail`/`status` envelope.
  Lock errors are **423**, not the legacy contract's 409.
- Picks are never optimistically marked saved. A successful POST is followed by an
  authoritative game refresh. An ambiguous network failure freezes choices pending
  confirmation; it never automatically replays a POST. A 423 locks the old round locally
  while refreshing the server's new round.
- The countdown anchors to `serverTimeUtc`, compensates half the response round trip,
  then uses a monotonic clock. It is informational: the server's lock decision wins.
  Expiry refreshes once per observed round; foreground game polling is every 8 seconds
  (boards every 20 seconds while visible). Polling and requests pause in background/
  offline state. A failed resource pauses its automatic retries until manual retry or
  a foreground/connectivity transition. No offline queue or always-on worker is used.

The typed, runtime-validated contract is in `src/api/contracts.ts`, aligned with
[`../shared/openapi.yaml`](../shared/openapi.yaml). The existing unresolved outcome is
`Unresolved`; the UI calls it pending. Leaderboard category filtering uses the existing
**`category`** query parameter; responses contain `categoryCode`.

## Focused verification

`npm test` runs isolated Node/TypeScript tests for API errors, concurrent/rotated
refresh, persistence and account races, configuration, storage failures, server-clock
countdowns, and result precedence.

Browser coverage runs the **exported production web files**, with mock API data kept
exclusively under `tests/`. No mock accounts or scores are included in the app bundle:

```bash
npm run export:web
npx playwright install chromium webkit   # only needed when these browsers are not installed
npm run test:e2e
```

Playwright starts a loopback-only static test server at `http://127.0.0.1:43817`.
It covers Chromium and WebKit at 320px/390px phone layouts, accessible 48px+ choice targets, authoritative
save/lock behavior, reload/logout isolation, result rendering, board filtering,
countdown rollover, offline/background polling, retry, and explicit storage fallback.
Screenshots/traces are written under ignored `test-results/`.

The committed icons/favicon are rendered from `assets/brand.svg`. After installing
Playwright Chromium, `npm run assets` reproduces them locally. This is an authoring
command, not a production build dependency; `npm run export:web` does not need a browser.

### Known upstream build-toolchain advisories

The initial SDK 57 lockfile reports **22 transitive/inherited audit findings (15 high,
7 moderate)** rooted in these three packages:

| Installed dependency chain | Advisory |
| --- | --- |
| Expo / Metro / metro-file-map / micromatch / `braces@3.0.3` | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), deeply nested glob pattern stack exhaustion |
| Expo CLI / code-signing-certificates / `node-forge@1.4.0` | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), RSA signature verification |
| Expo config-plugins / `xcode@3.0.1` / `uuid@7.0.3` | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), optional output-buffer bounds checking |

At implementation time, `braces@3.0.3`, `node-forge@1.4.0`, and `xcode@3.0.1` are their
latest releases, and Xcode's UUID dependency is not on the patched major. There is no
normal compatible lockfile update that resolves these. `npm audit fix --force` proposes
SDK 44 / React Native 0.72 downgrades; **do not apply those** to this SDK 57 project.

These chains are build/development/native-project tooling, not application imports;
the deployed web artifact is static files served by .NET and does not run Expo CLI or
install Node dependencies. This limits the relevant exposure but is **not a security
audit or a claim that the app is vulnerability-free**. Keep build inputs trusted, do not
expose Metro publicly, revisit patched upstream versions before wider distribution,
and review the signing/toolchain advisories before native release work.

## Native rollout gates - not completed by this POC

The provisional identifiers are **`com.callmegreg.calledit`** for both iOS and Android.
Confirm ownership/availability before provisioning permanent release identities.

1. Install Xcode and Android SDK/JDK tooling; create development builds and exercise real
   iOS/Android devices, safe areas, font scaling, background/resume, and secure storage.
   Validate required OS/SDK targets, icons/splash assets, accessibility, and deep links.
2. Establish Apple Developer/App Store Connect and Google Play Console ownership,
   bundle/application IDs, certificates/profiles, Android upload/release keystores,
   release signing, build numbers, and protected CI signing. EAS is optional and is not
   configured or provisioned by this work.
3. Complete real authentication/account recovery, invite migration, privacy policy and
   consent/data-retention disclosures, in-app and web account deletion, store privacy/
   data-safety forms, and appropriate audience/content review. TEST nicknames and token
   storage are not a substitute for production auth/privacy design.
4. Implement and validate push permissions, APNs/FCM credentials and registration,
   notification/deep-link behavior, and production round scheduling as separate work.
5. Build signed native release artifacts; validate TestFlight/internal Google Play
   testing, tester access, crash reporting, and review requirements before store release.

Legacy `../ios/` remains an unchanged historical SwiftUI scaffold. New mobile work
should continue in this shared client.
