# Called It — Mobile Clients

Cross-platform native clients for **Called It**, built **contract-first** against
[`shared/openapi.yaml`](./shared/openapi.yaml).

> **Status: scaffold + contract, not yet a compiled app.** This environment has no Xcode / Android
> SDK, so the native apps are provided as a **buildable starting point** — an accurate OpenAPI
> contract plus SwiftUI (iOS) and Jetpack Compose (Android) skeletons wired for the real auth,
> today-card, and leaderboard flows. They are the clearly-scoped **next workstream**. The backend,
> IaC, and CI/CD in this repo are fully implemented and tested.

```
clients/
  shared/openapi.yaml     # single source of truth for every endpoint + schema
  ios/                    # SwiftUI app (XcodeGen project.yml + Sources)
  android/                # Jetpack Compose app (Gradle Kotlin DSL)
```

## Contract-first: generate typed clients

Rather than hand-maintaining models, generate them from the contract with
[openapi-generator](https://openapi-generator.tech):

```bash
# iOS (URLSession + Codable)
openapi-generator generate -i clients/shared/openapi.yaml \
  -g swift5 -o clients/ios/Generated \
  --additional-properties=responseAs=AsyncAwait,library=urlsession

# Android (Retrofit + Moshi/kotlinx)
openapi-generator generate -i clients/shared/openapi.yaml \
  -g kotlin -o clients/android/generated \
  --additional-properties=library=jvm-retrofit2,serializationLibrary=kotlinx_serialization
```

The hand-written `APIClient` / `ApiClient` in each app show the auth + call patterns; swap in the
generated client when you wire up the real project.

## Auth flow (both platforms)

1. `POST /api/auth/otp` with the E.164 phone → user receives an SMS code.
2. Native **Sign in with Apple** (iOS) / **Google Sign-In** (Android) yields an `id_token`.
3. `POST /api/auth/login` with `{ phoneE164, code, provider, idToken, platform, pushToken }`
   → `AuthResult { accessToken, refreshToken, ... }`.
4. Send `Authorization: Bearer <accessToken>` on every other call.
5. On `401`, call `POST /api/auth/refresh` with the stored refresh token (tokens rotate — persist the
   new pair). Store tokens in the **Keychain** (iOS) / **EncryptedSharedPreferences** (Android).

## Push notifications

- **iOS:** register for APNs, take the device token, `POST /api/auth/devices` with
  `{ platform: "iOS", pushToken }`. The backend registers it with **Azure Notification Hubs**.
- **Android:** obtain the **FCM** token, `POST /api/auth/devices` with `{ platform: "Android", pushToken }`.
- The daily "drop" and the "your set locks soon" reminder are delivered as pushes by the Workers
  service via Notification Hubs (APNs + FCM).

## Privacy-preserving contact discovery

Raw phone numbers never leave the device. Each contact's **E.164** number is hashed on-device and
only the hashes are sent to `POST /api/contacts/match`. The recipe **must** match the backend
(`HmacPhoneHasher`) byte-for-byte:

```
hashedPhone = lowercase_hex( HMAC_SHA256( key = UTF8(pepper), message = UTF8(e164.trim()) ) )
```

- `pepper` is the shared `Contacts:Pepper` value, delivered to the app via secured configuration
  (e.g. Azure App Configuration at first launch or an embedded build secret). Rotating it re-keys
  discovery.
- **Security note:** a peppered hash raises the bar over a plain unsalted hash, but because the phone
  number space is small, anyone who extracts the pepper from a client can brute-force it. This is the
  standard trade-off for hash-based contact discovery; a future hardening step is a **private set
  intersection (PSI)** protocol so the pepper never ships to clients. Discovery is also gated by the
  user's `DiscoverableByPhone` opt-in and server-side rate limiting.

## Category codes

`sports`, `finance`, `pop_culture` (display names come back on the today card as `categoryName`).
