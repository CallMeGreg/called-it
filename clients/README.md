# Called It clients

**`mobile/` is the preferred client path:** one Expo / React Native TypeScript app for
iOS, Android, and web. Try the experience with the **local-only web playground**:
no Azure resources, backend, invite codes, or real authentication are needed.
Native distribution remains a later workstream.

```text
clients/
  mobile/                 # Shared iOS, Android, and web client (preferred)
  shared/openapi.yaml     # Backend API contract
  ios/                    # Historical SwiftUI scaffold; not the active client
```

The playground reuses the three-category cards, results, stats, and board screens.
Local controls fast-forward the manual clock, lock a round, choose Side A/Side B/Void
outcomes, and publish them to update scores and start the next round. Demo data persists
separately in this browser; Reset demo requires confirmation.

## Shared client

See [`mobile/README.md`](./mobile/README.md) for the controls, local-data/reset behavior,
safety boundaries, API configuration, validation commands, and native rollout gates.

```bash
cd clients/mobile
npm ci
npm run playground
```

Open the loopback URL printed by the command. Local controls are web-only and cannot
be enabled in normal release/native builds or on remote hosts.

Ordinary commands still use the preserved **API-connected mode** by default. It calls
`/api/test/login` and `/api/test/game`; those endpoints must not be enabled for normal
production gameplay, and production's daily six-hour rules are unchanged.
`npm run export:web` writes that API client to `mobile/dist/` for same-origin hosting
from ASP.NET `wwwroot`. `EXPO_PUBLIC_API_BASE_URL` is its only public API setting; native
requires an explicit HTTPS origin. Never put credentials in public Expo configuration.

## Historical native scaffold

`ios/` is retained unchanged as reference material, not as a compiled or store-ready app.
Its earlier SMS/social authentication, contact discovery, and push sketches are not part
of the new TEST client. Do not ship a shared contact-hashing pepper or any other secret
inside either client. Native release work should continue in `mobile/`, with real
authentication, privacy, account deletion, signing, and distribution reviewed first.
