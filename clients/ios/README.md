# Called It — iOS (SwiftUI)

A SwiftUI client scaffold for **Called It**, targeting iOS 16+. This is a **starting point**, not a
finished app: it shows the app entry point, a typed API client, Codable models mirroring
[`../shared/openapi.yaml`](../shared/openapi.yaml), token/session handling, and the Today card
screen. Compile it in Xcode after generating the full client and adding the platform integrations
noted below.

## Layout

```
ios/
  project.yml                     # XcodeGen project definition
  CalledIt/Sources/CalledIt/
    CalledItApp.swift             # @main app + root routing
    APIClient.swift               # URLSession client, bearer auth, auto-refresh
    Models.swift                  # Codable DTOs (mirror the OpenAPI schemas)
    Session.swift                 # ObservableObject: tokens (Keychain) + auth calls
    TodayView.swift               # the daily card UI (pick A / pick B / skip)
```

## Generate the project & open

```bash
brew install xcodegen          # once
cd clients/ios && xcodegen generate
open CalledIt.xcodeproj
```

## To make it a real app (next-workstream checklist)

- [ ] Run `openapi-generator` (see `../README.md`) and replace the hand-written models/endpoints.
- [ ] Add **Sign in with Apple** (`AuthenticationServices`) to obtain the `idToken` for `/api/auth/login`.
- [ ] Register for **APNs**; POST the device token to `/api/auth/devices`.
- [ ] Store tokens in the **Keychain** (the scaffold keeps them in memory for clarity).
- [ ] Implement on-device contact hashing (HMAC-SHA256 + pepper) for `/api/contacts/match`.
- [ ] Point `APIClient.baseURL` at your deployed API (or `http://localhost:5080` in the simulator).
