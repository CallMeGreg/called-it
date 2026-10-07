# Called It clients

**`mobile/` is the preferred client path:** one Expo / React Native TypeScript app for
iOS, Android, and web. The first playable release is an invite-only **TEST** game,
accessed through an Azure-hosted phone-browser link. Native distribution comes later.

```text
clients/
  mobile/                 # Shared iOS, Android, and web client (preferred)
  shared/openapi.yaml     # Backend API contract
  ios/                    # Historical SwiftUI scaffold; not the active client
```

The shared client has three-category prediction cards, synchronized two-minute demo
rounds, explicit simulated-outcome labeling, server-stored picks/skips/streaks, previous
results, and global leaderboards. It calls `/api/test/login` and `/api/test/game`;
those endpoints must not be enabled for normal production gameplay. It does not replace
the production daily six-hour round rules.

## Shared client

See [`mobile/README.md`](./mobile/README.md) for configuration, local development,
session behavior, validation commands, and native rollout gates.

```bash
cd clients/mobile
npm ci
npm run typecheck
npm test
npm run export:web
```

The static export is `clients/mobile/dist/`. The deployment build copies it to the
ASP.NET application's `wwwroot`, so web API calls default to the same origin.
`EXPO_PUBLIC_API_BASE_URL` is the only public application setting; native requires an
explicit HTTPS API origin. Do not put invitation codes, signing keys, or credentials
in public Expo configuration.

## Historical native scaffold

`ios/` is retained unchanged as reference material, not as a compiled or store-ready app.
Its earlier SMS/social authentication, contact discovery, and push sketches are not part
of the new TEST client. Do not ship a shared contact-hashing pepper or any other secret
inside either client. Native release work should continue in `mobile/`, with real
authentication, privacy, account deletion, signing, and distribution reviewed first.
