# Called It — Android (Jetpack Compose)

A Jetpack Compose client scaffold for **Called It**, targeting Android 8.0+ (minSdk 26, Kotlin). Like
the iOS folder this is a **starting point**, not a finished app: it shows the Gradle module setup, a
typed API client, kotlinx-serialization models mirroring [`../shared/openapi.yaml`](../shared/openapi.yaml),
and the Today card screen. Open it in Android Studio after generating the full client and adding the
platform integrations below.

## Layout

```
android/
  settings.gradle.kts / build.gradle.kts / gradle.properties
  app/
    build.gradle.kts
    src/main/AndroidManifest.xml
    src/main/java/it/called/app/
      MainActivity.kt        # Compose entry + simple nav (sign-in vs today)
      ApiClient.kt           # Ktor client, bearer auth, auto-refresh
      Models.kt              # @Serializable DTOs (mirror the OpenAPI schemas)
      TodayScreen.kt         # the daily card UI (pick A / pick B / skip)
```

## Open & run

```bash
# Requires Android Studio (or a local Android SDK + JDK 17).
cd clients/android && ./gradlew assembleDebug     # after adding the Gradle wrapper
# then open the folder in Android Studio and run on an emulator/device.
```

> The Gradle **wrapper** (`gradlew`, `gradle/wrapper/*`) is intentionally omitted from the scaffold —
> generate it with `gradle wrapper --gradle-version 8.7` or let Android Studio add it on first open.

## To make it a real app (next-workstream checklist)

- [ ] Run `openapi-generator` (see `../README.md`) and replace the hand-written models/endpoints.
- [ ] Add **Google Sign-In** (Credential Manager) to obtain the `idToken` for `/api/auth/login`.
- [ ] Add **Firebase Cloud Messaging**; POST the FCM token to `/api/auth/devices`.
- [ ] Store tokens with **EncryptedSharedPreferences** (the scaffold keeps them in memory).
- [ ] Implement on-device contact hashing (HMAC-SHA256 + pepper) for `/api/contacts/match`.
- [ ] Point `ApiClient.BASE_URL` at your deployed API (emulator reaches host via `http://10.0.2.2:5080`).
