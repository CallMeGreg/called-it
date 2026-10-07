# UX and UI direction

Status: proposed design for the approved React Native/Expo client. The existing
SwiftUI code is a non-shipping reference, not a finished interaction specification.

## Information architecture

Four primary destinations: **Today**, **Standings**, **Friends**, **Profile**.
Keep administrative controls in a separately authorized operator interface, never
a hidden consumer-app toggle.

| Destination | Primary content |
| --- | --- |
| Today | Current round, drop/lock state, three choices, save receipt, recent pending/results, next drop. |
| Standings | Friends first, then season/global; category and career filters; a persistent "You" row with rank and as-of state. |
| Friends | Accepted friends, pending requests, invite/share, block/report; leagues can follow the basic mutual graph. |
| Profile | Streaks, total, achievements, history, notification preferences, privacy, linked identities, support, export/delete account. |

Avoid an empty "come back tomorrow" dead end. Outside the window, history and
resolved explanations are valuable. If a new player cannot enter the current
round, explain why, show a practice round, and offer an optional reminder.

## First-run journey

Explain the game before requesting personal data. Use a clearly fictional,
unranked tutorial, not a fabricated live leaderboard.

The ranked-account flow must explain why the owner requires **both** a phone and
a social provider. Display the SMS destination and country, show resend cooldown,
support OS code autofill and paste, and allow correcting a number. Never request
Contacts or notifications during the initial verification screens.

Preserve progress through canceled provider dialogs, delayed SMS, app backgrounding,
and network retries. Explain partial verification without creating a second
account. Provide a recovery/support path for recycled/lost numbers and unavailable
providers. This is not solved by automatically linking matching email addresses.

Offer Sign in with Apple on iOS alongside Google; plan a valid Apple web-based
path on Android for an Apple-linked player's return. Actual provider requirements,
nonce handling, redirect URLs, entitlements, and review behavior are release gates.

## Today is a state machine

| State | What the player sees and can do |
| --- | --- |
| Loading | Stable skeleton, not stale choices presented as current. |
| Before drop | Next drop in local time; history/practice available. No future question leakage. |
| Open/untouched | Three cards, common deadline, clear A/B/Skip choices, saved versus draft count. |
| Editing | Local selection is visibly a draft; a review step lists all three choices. |
| Saving | Disable duplicate submission; keep old accepted receipt visible; announce progress accessibly. |
| Saved | Server-accepted timestamp/revision and all choices; edits become a new draft. |
| Save rejected at lock | "The window closed before these changes were accepted." Show the last accepted receipt, not the rejected draft. |
| Offline | Cached round plus an offline label; never say "saved" for a queued request. |
| Locked/pending | Immutable receipt, expected result timing, and why an outcome is delayed. |
| Partially resolved | Each category explicitly resolved/pending/void; provisional aggregate progress. |
| Final | Correct/incorrect/skip/missed/void labels, source explanation, progress and optional sharing. |
| Corrected | Previous result, new result, reason, timestamp, and recalculated progression. |
| Canceled/service incident | Neutral round explanation and next update; no punitive lost-streak copy. |
| Empty/content unavailable | Acknowledge no round was published; no misleading network retry or missed-day penalty. |

Refresh authoritative state on foreground, notification/deep-link open, after a
write conflict, and when crossing the displayed lock. The UI may estimate a
countdown from a server-time offset and monotonic elapsed time; it never authorizes
a late write. Show an absolute local deadline as well as relative time.

Errors must be readable and recoverable. The prototype's `try?` swallowing of
submit/login errors and stale `isOpen` button state are not acceptable patterns.
Do not replace a failed read with an empty successful leaderboard.

## Card anatomy and interaction

Each category card has a category label/icon, question, concise neutral context,
two plainly labeled alternatives, explicit Skip, selection state, and an accessible
source/rules disclosure. Avoid truncating the meaningful part of a proposition.

Selected, saved, incorrect, and disabled are distinct states. Skip is a first-class
choice with "preserves, does not extend" explained; it is not a tiny secondary
escape hatch. The final review calls out any untouched category and its consequence.

Recommend one atomic three-choice submit/edit operation. Until the backend
supports that contract, do not imply that three independent requests save
atomically. The client implementation must match the actual protocol.

## Visual system

Direction: a calm, high-contrast sports-scorecard feel, not a casino. Keep the
"Called It" confidence playful without shaming mistakes.

| Token family | Direction |
| --- | --- |
| Color | Neutral surfaces and one brand accent; category accents are secondary. Success/error always include icon and text. |
| Typography | Platform-native, scalable text; tabular digits for countdowns and scores; comfortable question-reading hierarchy. |
| Layout | Shared spacing scale, generous card padding, safe-area support, responsive narrow phones and larger screens. |
| Controls | Prefer at least 48 logical-pixel/dp targets, never below platform requirements; distinct pressed/focus/disabled styles. |
| Motion | Brief, optional result celebration; reduced-motion equivalent; no flashing, continuous confetti, or animation-blocked navigation. |
| Themes | Light and dark palettes validated separately; never simply invert colors. |
| Icons | Accompany semantic labels; provide category distinctions without relying on color or emoji alone. |

Create named design tokens and reusable QuestionCard, ChoiceGroup, Deadline,
SaveReceipt, ResultExplanation, RankRow, AchievementBadge, and Empty/ErrorState
components. Do not build separate one-off loading/error behavior per screen.

## Accessibility and localization

Target WCAG 2.2 AA where applicable, alongside native iOS/Android accessibility
guidance. Validate text contrast, 200% font scaling, narrow screens, VoiceOver,
TalkBack, keyboard/focus order, switch access, and reduced motion on devices.

Group question choices meaningfully for screen readers, announce save/error
outcomes, and never announce a ticking countdown every second. Preserve focus on
refresh. Avoid destructive actions triggered by swipe alone.

Externalize user-facing strings and pluralization from the start. Beta can be
English-only, but format dates, numbers, and timezones locally and design for text
expansion. Category codes are stable machine values, not display copy.

## Healthy notifications and growth

Ask for push permission after the first useful action, with an explanation and a
"Not now" option. Keep notifications optional for all game functions.

Good reminder: "Today's calls close at 6:00 PM. You have one choice left."
Avoid "Your streaks are at risk" as a generic broadcast to everyone, especially
players who already finished. Respect quiet hours for the global drop too.

Share previews show exactly what will leave the app. No phone number, contacts,
location, bearer token, or private league contents. Use native share sheets,
verified Universal Links/App Links, and a useful web fallback rather than demanding
an install to understand every shared card.

## Design validation before polish

Run moderated walkthroughs covering a brand-new player, a late newcomer, a slow
connection at lock, declined push permission, a missed day, a void, and a corrected
outcome. Measure first accepted pick, comprehension of Skip, and ability to find
personal rank. Use a frozen-clock local playground for scenarios, isolated from
release bundles and production credentials.

Both platforms must be evaluated; a browser preview is not evidence of native
sign-in, notification, secure-storage, deep-link, or accessibility behavior.
