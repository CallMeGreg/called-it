# "Called It" — Tech Stack & Cloud Architecture (Azure)

## 1. Goals & confirmed decisions
Build a daily casual-forecasting app with private (friends) + global leaderboards.

**Locked decisions**
- **Clients:** Fully native — **iOS (Swift/SwiftUI)** + **Android (Kotlin/Jetpack Compose)**.
- **Auth:** **Phone-number = primary ID**, verified by **SMS OTP**, **plus mandatory Sign in with
  Apple / Google** from day one (security + account recovery).
- **Cloud:** **Azure** for all services.
- **Backend style:** Modular monolith (ASP.NET Core) + separate background workers now; split into
  microservices later. Clean module seams: Identity, Social, Questions, Scoring, Leaderboards,
  Notifications.

**MVP scope (v1)**
- **3 binary questions per daily drop** — one each from **Sports**, **Finance**, **Pop Culture**
  (yes/no, win/lose, over/under). **No confidence weighting** — each pick is simply right or wrong.
- **Independent per-category streaks.** Correct **extends** that category's streak; wrong **resets**
  it; **Skip** (**unlimited**) **protects** it for the day without extending it; **missing a day
  altogether resets *all* streaks**.
- **Cumulative total score** (lifetime correct answers) that **keeps tallying and never resets** —
  even when a missed day wipes your streaks — so there's always permanent progress to chase.
- Questions are **auto-resolvable by default**: each must map to an **API resolution source**; the
  admin can still **manually set or amend** any result (including previously-resolved ones) via
  audited DB writes, with streaks and totals recomputing.

---

## 2. High-level architecture

```
        iOS (Swift)              Android (Kotlin)
             \                       /
              \   HTTPS (REST/JSON)  /
               \                    /
        ┌────────────────────────────────┐
        │   Azure Front Door (WAF/CDN/TLS)│
        └───────────────┬────────────────┘
                        │
              ┌─────────▼──────────┐   (optional) Azure API Management
              │  Azure Container   │   – rate limiting, versioning
              │  Apps: API service │
              │ (ASP.NET Core)     │
              └───┬───────┬────────┘
      ┌───────────┘       └───────────────┐
      ▼                                   ▼
 Azure SQL DB                     Azure Cache for Redis
 (system of record)              (leaderboards, hot cache,
      │                            OTP/rate-limit counters)
      │
      ├── Azure Blob + CDN (images/share cards)
      │
   Events/queues: Azure Service Bus + Event Grid
      │
      ▼
 Azure Functions / Durable Functions (background plane)
   • Daily Set Builder (timer)         • Resolution engine (timer/event)
   • Scoring worker                    • Leaderboard updater
   • Notification dispatcher  ───────► Azure Notification Hubs ─► APNs + FCM

 Cross-cutting: Azure Communication Services (SMS OTP) · Azure OpenAI
 (question drafting) · Key Vault · App Configuration · App Insights/Monitor ·
 Container Registry · Managed Identities · GitHub Actions + Bicep IaC
```

---

## 3. Client architecture (native)

**iOS**
- Swift, SwiftUI, async/await; MVVM.
- Push: **APNs**. Contacts: **Contacts framework**. Social: **Sign in with Apple**
  (AuthenticationServices). Token storage: **Keychain**. Anti-abuse: **App Attest / DeviceCheck**.
- Phone normalization via libphonenumber (E.164). Universal Links for invites/deep links.

**Android**
- Kotlin, Jetpack Compose, Coroutines/Flow; MVVM.
- Push: **FCM**. Contacts: **ContactsContract**. Social: **Google Sign-In / Credential Manager**.
  Token storage: **Android Keystore + EncryptedSharedPreferences**. Anti-abuse: **Play Integrity**.
- App Links for invites/deep links.

**Shared client behaviors**
- **Daily card:** 3 binary questions (Sports / Finance / Pop Culture); for each, tap a side (Yes/No,
  Win/Lose) **or tap Skip** (protects that category's streak), then lock in before the cutoff.
  Per-category **streak** badges are shown.
- Offline cache of today's set; optimistic guess submit validated against a **server-authoritative
  global lock**; a visible **countdown** to the cutoff, after which the UI locks and any edit/submit
  is rejected.
- Cert pinning (optional), forced-update gate via App Configuration.

---

## 4. Identity & authentication

**Model:** one `User` anchored by a **verified phone** (the social-graph key) with **linked
federated identities** (Apple, Google). Both a phone AND at least one social provider are required.

**Flows**
1. **Register/Login:** enter phone → ACS sends OTP → verify → then complete/link **Sign in with
   Apple or Google** (validate the OIDC `id_token` server-side against Apple/Google JWKS) → link to
   the user record.
2. **Token issuance:** service issues short-lived **JWT access token** (~15 min) + **rotating
   refresh token** (reuse detection, revocation list in Redis).
3. **Recovery:** lost number → re-verify via linked Apple/Google; new number → re-verify OTP.

**Hardening:** OTP rate-limits + throttling (Redis) gated by App Attest/Play Integrity; signing
keys in **Key Vault**; per-device sessions; account-deletion + data-export endpoints (GDPR/CCPA).

> Managed alternative if you later prefer not to own auth: **Microsoft Entra External ID** (CIAM)
> supports phone OTP + Apple/Google. We're going custom for the cleanest phone-as-ID + contact model.

---

## 5. Data stores
- **Azure SQL Database** — system of record: users, identities, devices, friendships, leagues,
  questions, categories, daily sets, guesses, scores, resolution sources, audit.
- **Azure Cache for Redis** — real-time **leaderboards (Sorted Sets)**, hot cache (today's set),
  OTP/rate-limit counters, refresh-token revocation, contact-match acceleration.
- **Azure Blob Storage + Front Door/CDN** — question media, category icons, generated share-card
  images.
- (Later) **Azure AI Search** for admin question-bank search; **Azure Data Lake/Fabric** for analytics.

---

## 6. Question lifecycle (creation → distribution → resolution → scoring)

**6a. Creation (binary + auto-resolvable by default)**
- **Answer type:** **binary** (yes/no, win/lose, over/under) for v1. **MVP categories: Sports,
  Finance, Pop Culture** — one question each per drop (broader categories are a post-MVP expansion).
- **Auto-resolvable-by-default rule:** every question **must declare a machine-readable
  `resolution_source` + `resolution_rule`** (an API that can confirm the outcome); the Admin app
  **blocks publishing** a question without one by default.
- **Question bank** in SQL, each tagged: `category`, `answer_type`, difficulty, region,
  `resolution_source`, `resolution_rule`, per-question `resolves_at`. Submission window is set-level
  and global (see 6b): `DailySet.drop_at` and `DailySet.locks_at = drop_at + 6h`.
- **Authoring channels:** (1) internal **Admin web app** (Azure Static Web Apps / Container Apps) —
  proposes questions preferring **API-validatable** ones and requiring a resolution source; (2)
  **Azure OpenAI** drafts candidates **with a suggested resolution source** across Sports/Finance/Pop
  Culture → human review queue; (3) **community submissions** → moderation queue.

**6b. Distribution — one synchronized global drop**
- **Daily Set Builder** = Azure Functions **timer trigger**: at a **fixed daily UTC time** selects
  **exactly 3 questions — one Sports, one Finance, one Pop Culture** (each API-validatable) and
  publishes **one global set simultaneously to all users worldwide** (SQL write + warm Redis).
- **Global submission window:** `drop_at` → `locks_at = drop_at + 6 hours`. Everyone gets the exact
  same questions and the exact same 6-hour window.
- **Hard cutoff:** at `locks_at` the API **rejects any new or changed guess** using a
  server-authoritative clock (late/offline submissions are dropped). Nothing can be submitted or
  edited afterward.
- Fires a single **global "questions are live" broadcast** at `drop_at` and a **"window closing"
  reminder** before `locks_at`.

**6c. Resolution (how guesses get confirmed/denied — no app update needed; it's data)**
- **Automated by default:** Azure Functions triggered at each `resolves_at` call the question's
  external **data API** (sports scores, market data, entertainment sources), apply `resolution_rule`,
  and write `outcome` (YES/NO/VOID) with `outcome_source = auto`.
- **Admin override & amend:** the Admin app can **manually set a result**, or **change a
  previously-set result**, via audited **database writes** (`outcome_source = manual`, `resolved_by`,
  reason) — for when an API is wrong/unavailable or a call is disputed.
- **Re-scoring on any change:** setting or amending an outcome emits `QuestionResolved` /
  `OutcomeAmended`; scoring + leaderboards **idempotently recompute** for that question, so a
  corrected result cleanly restates scores. Every change is written to `AuditLog`.
- All resolution/override actions are **data writes — no app deployment**.

**6d. Scoring — per-category streaks (no confidence)**
- Answers are **pure binary**; each category (Sports / Finance / Pop Culture) keeps an **independent
  streak** (current + best).
- The **Streak worker** consumes `QuestionResolved` / `OutcomeAmended` and updates per-category state:
  - **Correct →** current streak **+1** (update best) **and total score +1**.
  - **Wrong →** current streak **resets to 0** (total score unchanged).
  - **Skip (unlimited) →** streak **preserved**; no result recorded for that category that day.
  - **Missed day → all streaks reset.** Submitting nothing before `locks_at` resets every category's
    streak to 0. (A category left untouched while you play others resets the same way — answer *or*
    **Skip** to protect it.)
- **Total score** (lifetime correct answers) is **cumulative and never resets**, even when a missed
  day wipes your streaks — it's the permanent career tally.
- Updates the **Leaderboard updater** → enqueues "results are in" push. Recompute is **idempotent**,
  so amended outcomes correctly restate streaks, totals, and boards.

**6e. Streaks & Skip — how it works (worked example)**

Each category has its **own** streak and they move **independently**. Only **correct** answers grow a
streak; **Skip** protects it for a day (but never grows it); a **wrong** answer or a **missed window**
resets it to 0. Strategy: on a topic you're unsure about, **Skip to protect a long streak** rather
than risk it.

*Example.* You start with streaks **Sports 12 · Finance 3 · Pop 0** and a lifetime **Total score 40**
(the rightmost column only ever climbs):

| Day | Sports | Finance | Pop Culture | Total score |
|---|---|---|---|---|
| Start | 12 | 3 | 0 | 40 |
| Mon | ✅ → **13** | ❌ → **0** | ✅ → **1** | **42** (+2 correct) |
| Tue | ⏭️ **Skip** → **13** | ✅ → **1** | ✅ → **2** | **44** (+2) |
| Wed | 😴 **missed the day entirely — ALL streaks reset** → 0 | → 0 | → 0 | **44** (unchanged) |
| Thu | ✅ → **1** | ⏭️ **Skip** → **0** | ✅ → **1** | **46** (+2) |

Takeaways: streaks are **per category** and **Skip** (unlimited) preserves one without growing it
(Tue Sports 13); a **wrong** pick resets just that category (Mon Finance); **missing the whole day
wipes all three streaks** (Wed) — but your **Total score never drops** (stays 44 through the missed
day, then keeps climbing). Long streaks are the volatile flex; Total score is the permanent grind.

---

## 7. Social graph & contacts linking (phone numbers as IDs)

**Privacy-preserving contact match**
1. User grants Contacts permission on-device.
2. App normalizes each number to **E.164**, then **hashes** it (SHA-256 over an **HMAC pepper**
   fetched from the server; pepper stored in Key Vault) — **raw contact numbers never leave the
   device**.
3. App sends hashed numbers to `POST /contacts/match`.
4. Server matches against registered users' hashed phones → returns which contacts are on the app
   (respecting each user's discoverability opt-in) + invite suggestions for the rest.
5. User sends/accepts **friend requests** (mutual edges) and/or joins **leagues** (groups); invites
   also via share link (Universal/App Links).

**Privacy/compliance notes:** phone-hash matching is enumerable, so mitigate with server pepper,
strict rate-limiting, match-only responses for non-users, discoverability opt-out, and consent
logging. (Future upgrade: **Private Set Intersection** for stronger guarantees.)

**Storage:** friendships + league memberships in SQL; fast friends-leaderboard via per-league Redis
Sorted Sets.

---

## 8. Push notifications
- **Azure Notification Hubs** — single fan-out to **APNs + FCM**; device registration with **tags**
  (per-user, per-league, per-timezone).
- **Notification types:** **global questions-live broadcast at `drop_at`** (same instant worldwide),
  **window-closing "streak at risk" reminder** before `locks_at` (answer or **Skip** to protect your
  streak), results-are-in (streak & score updates), social (friend joined, passed on leaderboard).
- **Core loop is globally synchronized** (not timezone-staggered); timezone data is used only for
  *ancillary* pings (e.g., quiet-hours handling for results/social notifications).

---

## 9. Leaderboards (streak-based)
- **Per-category boards** for **Sports, Finance, Pop Culture** — ranked by **current streak**, plus an
  all-time **longest-streak** board per category. An **Overall** board sums a player's three current
  streaks.
- Each board has **Friends/League** and **Global** variants, backed by Redis **Sorted Sets** (score =
  streak length) with SQL persistence for history and best-streaks.
- **All-time Total-Score board** — lifetime correct answers, **never reset by missed days**; the
  permanent progression board alongside the volatile streak boards (Friends + Global).
- Integrity: every player answers the same global set within the same `drop_at` → `locks_at` 6-hour
  window; the server rejects anything after `locks_at` (server-authoritative clock); anti-abuse via
  App Attest/Play Integrity + rate limits.

---

## 10. Cross-cutting concerns
- **Secrets/keys:** Azure **Key Vault**; **Managed Identities** for service-to-Azure auth (no secrets
  in code).
- **Config/flags:** Azure **App Configuration** (category weights, feature flags, force-update).
- **Eventing:** **Service Bus** (reliable work queues) + **Event Grid** (pub/sub events).
- **Observability:** **Application Insights + Azure Monitor + Log Analytics**, OpenTelemetry tracing,
  alerts/dashboards.
- **Edge/security:** **Azure Front Door** (WAF, TLS, CDN, DDoS); optional **API Management** gateway.
- **CI/CD & IaC:** **GitHub Actions** → build container → **Azure Container Registry** → deploy to
  **Container Apps** (revision-based/blue-green); infra as **Bicep** (or Terraform); Dev/Staging/Prod
  resource groups.
- **Compliance:** GDPR/CCPA (consent, export, delete), contacts consent, age gating (13+/16+),
  data residency.

---

## 11. Key data model (entities)
`User`, `FederatedIdentity`, `Device` (push tokens), `PhoneHash`, `Friendship`, `League`,
`LeagueMembership`, `Category`, `ResolutionSource`,
`Question` (`answer_type`=binary, `resolution_source`, `resolves_at`, `outcome`, `outcome_source`),
`DailySet` (global `drop_at` + `locks_at`), `Guess` (binary pick **or** `is_skip`),
`Streak` (per user × category: `current`, `best`), `Score` (per user × category: lifetime
`total_correct`, never resets),
`LeaderboardSnapshot`, `Notification`, `ModerationItem`, `AuditLog` (result sets & amendments).

---

## 12. Azure services summary

| Concern | Azure service |
|---|---|
| API / compute | Azure Container Apps (ASP.NET Core) |
| Background jobs, scheduler, resolvers | Azure Functions + Durable Functions |
| Eventing / queues | Azure Service Bus + Event Grid |
| System of record | Azure SQL Database |
| Leaderboards / cache | Azure Cache for Redis |
| Media / share cards | Azure Blob Storage + Front Door/CDN |
| SMS OTP | Azure Communication Services |
| Push (APNs+FCM) | Azure Notification Hubs |
| AI question drafting | Azure OpenAI |
| Secrets / keys | Azure Key Vault |
| Config / feature flags | Azure App Configuration |
| Observability | App Insights + Azure Monitor + Log Analytics |
| Edge / WAF / CDN | Azure Front Door |
| API gateway (optional) | Azure API Management |
| Container registry | Azure Container Registry |
| Admin / authoring web app | Azure Static Web Apps or Container Apps |
| CI/CD + IaC | GitHub Actions + Bicep |

---

## 13. Build workstreams (parallelizable)
1. **Cloud foundation & IaC** — resource groups, Bicep, networking, Key Vault, registries, CI/CD.
2. **Identity service** — phone OTP (ACS) + Apple/Google linking + JWT/refresh.
3. **Core data & API** — SQL schema, Container Apps API, module seams.
4. **Questions engine** — API-validatable **binary** question bank (Sports/Finance/Pop Culture), admin app with **manual set/amend result** (audited DB writes), AI drafting, Daily Set Builder (3/drop), automated resolution engine.
5. **Streaks, total score & leaderboards** — per-category streak engine (correct → +1, wrong → reset, **unlimited Skip → preserve**, **missed day → reset all streaks**) plus a **cumulative total score that never resets**; idempotent recompute on outcome amendment; Redis Sorted Sets for per-category + overall streak boards and an all-time total-score board (friends/global).
6. **Social graph & contacts** — privacy-preserving match, friend requests, leagues.
7. **Notifications** — Notification Hubs, global drop broadcast + window-closing reminders, notification types.
8. **iOS app** — SwiftUI, APNs, Contacts, Sign in with Apple, Keychain.
9. **Android app** — Compose, FCM, Contacts, Google Sign-In, Keystore.
10. **Security & compliance hardening** — anti-abuse, rate limits, GDPR flows, observability, load test.

---

## 14. Open considerations / risks
- **Contact-hash privacy** — add pepper + rate limits now; PSI later.
- **Resolution latency** — reframe as anticipation; include same-day questions for instant wins.
- **Global-board integrity** — server-locked timestamps + device attestation.
- **Question sourcing at scale** — AI drafting + community submissions + moderation.
- **Global drop time vs. timezones** — one synchronized drop means the fixed 6-hour window is
  inconvenient for some regions; choose a `drop_at` that maximizes global waking overlap and revisit
  the window length with real usage data.
- **Skip economy (resolved)** — Skips are **unlimited** by design; the counterweights are that **any
  fully-missed day resets all streaks** and that the **all-time total-score board** (never reset)
  rewards actually showing up and answering — so hiding behind Skip forever still costs you progression.
- **Cost at low scale** — prefer scale-to-zero (Container Apps/Functions) and right-size Redis/SQL.
