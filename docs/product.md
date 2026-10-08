# Product and competition

Decision version: **beta-2026-10-08**, ratified by the owner through the decision
questions for issue #7. The rules below supersede conflicting prototype behavior
and the 2026-10-07 proposals. They are **not yet implemented**. D3 (competition)
and D4 (discovery) are decided; audience requirements, content-calendar validation
and recovery targets retain the boundaries in [the decision register](README.md).

## The promise

"Make three calls, find out what happened, and compete with your friends."
The differentiator is a shared, understandable daily ritual, not wagering,
infinite scrolling, or a claim that forecasting skill guarantees success.

Keep the three binary categories (Sports, Finance, Pop Culture) for beta, with
exactly one question per category per day. Validate that ordinary players can
understand each question without outside research. A two-minute session is a
design target, not a deadline imposed
on the player. Finance questions must concern public events, not trading or
personal investment recommendations.

## A full daily loop

1. Preview the rules and a clearly labeled practice round without registering.
   A ranked account requires both verified phone and a linked social identity.
2. See the common round, its local-time deadline, and neutral context/source
   information. Choose A, B, or Skip for every category.
3. Submit a reviewed set of choices; receive a server receipt. Until lock, edit
   through a new acknowledged revision. A local draft is never a saved pick.
4. After lock, see the submitted receipt and pending results. Open the app for
   history, friends, standings, and explanations even when predictions are closed.
5. See results with evidence and correction status; celebrate progress and share
   a spoiler-safe card. The daily opening range is visible, but the randomly
   chosen opening time remains hidden until the next round opens.

Time-restricted **prediction submission**, not an inaccessible app, is the
model. No purchase, ad view, invite, push permission, or streak payment unlocks a
late submission or changes competitive points.

## Window and eligibility

| Question | Approved rule / remaining requirement |
| --- | --- |
| Global versus local time | One persisted UTC drop and lock shared by the cohort. Display local time plus zone; never derive eligibility from the phone clock. |
| Initial schedule | Random daily opening between 12:00 and 17:00 Eastern; open for exactly one hour, with latest close at 18:00 Eastern. The previous six-hour/fixed-17:00-UTC settings are superseded. Validate the actual content calendar before completing D2. |
| Daylight saving | The selection range follows Eastern local time (`America/New_York`, including DST); persist that day's chosen drop/lock as UTC instants. All players share those instants regardless of device timezone. |
| Surprise and notification | Keep the chosen time hidden until opening; do not expose it through a countdown, public API or pre-drop notification. Strongly encourage optional notifications and notify opted-in players when live, respecting preferences and quiet hours. |
| Joining during a window | Fully verified newcomers can join the current open round. No misses before their first eligible round. Joining at/after lock starts eligibility with the next round. |
| Deadline | The authoritative database acceptance check must occur before lock. A request queued or sent by a device before lock is not automatically eligible. |
| Offline | Allow draft editing, clearly labeled unsent. Reject late delivery; never backdate or silently replay a pick into a later round. |
| Event safety | Lock must be at least 30 minutes before the earliest relevant event/information cutoff, not merely the expected result publication time. Reject incompatible content; do not shorten the buffer to fit a schedule. |
| Overlapping rounds | A new round may open while an older outcome is delayed, but never reuse a question or reopen the older submission window. |
| Geographic rollout | United States and Canada, English only. Store/SMS support and Canadian language obligations still need verification; a country selection is not proof of availability. |
| Age eligibility | No additional product-imposed age floor. Establish actual store requirements and applicable legal age/consent rules before opening enrollment; a content rating alone does not determine eligibility. |

A surprise one-hour round cannot be equally convenient worldwide. A regional
beta is an honest limit, not a solved global-accessibility problem. Before expansion, compare
longer common windows and separate regional competitions; never silently combine
players who had different information or deadlines in one rated leaderboard.

## Scoring and finality

Each correct answer earns one point; every other outcome earns zero. There are
no scoring multipliers. Keep unlimited Skip and **independent category and global
account streak trackers**. The global streak is not a sum of category streaks.

| Closed, eligible category result | Current streak | Lifetime correct total |
| --- | --- | --- |
| Correct | Extend by one; update best | Add one |
| Incorrect | Reset this category | Unchanged |
| Explicit Skip | Preserve, do not extend | Unchanged |
| No accepted choice | Preserve, like Skip; do not extend | Unchanged |
| Void/canceled/unfair round | Neutral for everyone | No points |
| Unresolved | Pending, not a miss or a correct answer | No points yet |

Leaving all categories untouched preserves every streak and awards no points.
An unanswered category is neutral for progression, not an accepted submission
receipt. A wrong pick resets only that category, leaving the other category
trackers unchanged.

Evaluate the global streak deterministically at the daily-round level: **any
incorrect pick makes the global streak end at zero**. Otherwise, add one per
correct pick; Skip, unanswered and void categories neither add nor reset. A day
with two correct picks and one wrong pick ends at zero regardless of result
arrival order; two correct picks and one Skip add two. Do not derive intermediate
global records or awards from a partial result that may still contain a wrong pick.

Void only the affected question for ordinary content cancellation; other valid
categories still count. A fairness outage can instead void the entire round
under the [approved operations policy](operations.md#incidents-and-fairness).
Neither case penalizes streaks or creates a same-day replacement.

**"Lifetime" means no periodic reset, not an immutable counter.** Correcting an
incorrectly awarded result can lower totals, best streaks, achievements, and ranks.
Show the reason and restatement rather than promising that a score can never fall.

Process streak history in round order per category and in daily-round order for
the independent global tracker. A pending earlier outcome blocks the affected
tracker's authoritative progression through later results.
Resolved points may be shown separately as provisional. Never temporarily
announce a record or award that assumes an unresolved earlier call was correct.

Settle automatically when the approved data source marks its result final.
Selecting, licensing and proving that source/adapter remain D6 work; this decision
does not approve a stub or invent a finality signal. A question still unresolved
48 hours after submission lock becomes a neutral timeout void so progression can
continue. If the source later supplies a final result, **revive the question and
replay affected points, streaks, ranks and result-dependent achievements**.
Show the transition as a correction, not a silently changed "permanent" void.
This late-source rule does not revive a round voided for an unfair service outage.

Verified corrections have no arbitrary time limit. Keep the original evidence,
new evidence, reason and revision; replay can lower as well as raise progress and
can revoke an award. "Settled" describes the current source-backed state, not a
promise that an error can never be corrected.

## Leaderboards worth competing in

Use **lifetime-only leaderboards for beta; seasons are deferred**. Do not reset
points or streak records at calendar boundaries. Introducing seasons later requires
a new approved rule version, not a silent change to the beta contract.

| Surface | Purpose and safeguards |
| --- | --- |
| Friends | Default social comparison; only accepted friendships, with block/removal respected. |
| Global/lifetime points | One point per correct pick, with no periodic reset; favors longevity, not a pure skill rating. |
| Global/current and best streak | Independent consecutive-correct-pick progress using the daily-round wrong-pick rule, never a sum of category streaks. |
| Category/current and best streak | Independent category progress. Unlimited skips and neutral absences make streaks unsuitable as a daily-attendance measure. |
| Accuracy | A later experiment with a published minimum resolved-pick sample; never rank a one-for-one player above a sustained record without qualification. |
| "You" | Always show personal points and rank/unranked state, not just a top-50 list that most players never enter. |

Use shared competition rank for equal values (1, 1, 3), with a stable opaque
ID only ordering display. No speed-to-submit, purchase, referral count, or device
clock tie-breaker. A page/around-me response needs an as-of projection version and
pending/final indicator. Names and avatars are public profile data; phones,
provider identities, device IDs, and contact matches are not.

Always expose as-of/projection and pending/settled/corrected state. Lifetime boards
remain subject to the source-finality, timeout-void and correction rules above;
an operator may not invent an outcome to clear a pending board.

## Achievements and retention

The approved initial catalog is:

| Achievement | Criterion / scope |
| --- | --- |
| First submitted round | First accepted three-choice receipt; explicit Skips are allowed. An untouched/unsent round does not qualify. |
| First correct pick | First settled correct pick in any category. |
| First perfect round | All three category picks in one round settle correct; Skip, unanswered or void is not perfect. |
| Streak milestones | 3, 5, 10, 20, 50 and 100 correct picks, independently for each category tracker and the global tracker. These are not consecutive-calendar-day awards. |
| Lifetime-correct milestones | 10, 25, 50, 100, 250, 500 and 1,000 correct picks summed across all categories. |

Name, icon, locked/unlocked progress, criteria version, and award receipt are data.
No hidden scoring multipliers or purchased streak repairs.
Award a milestone when the authoritative tracker reaches or passes its threshold,
including a global daily increment that crosses multiple thresholds.

Awards require idempotent uniqueness by user, achievement, and qualifying scope.
Distinguish one-time participation badges from result-dependent awards. Corrections
can revoke/restated result-dependent awards with an explanation; retries must not
send another celebration. Do not ship time-zone-sensitive attendance badges until
eligibility and outage neutrality work.

Validate D1/D7/D30 return rates, completed rounds per eligible user, time to first
accepted pick, and voluntary sharing. Inspect cohorts by signup date, device,
region, and experience; aggregate reporting must not expose a person's choices
or phone. Establish retention targets after an instrumented beta, not invented
"viral" forecasts.

## Social and sharing

Use **invite links only for beta friend discovery**, plus shareable result cards.
Mandatory phone verification does not imply permission to read contacts or make
the phone publicly searchable. Contact upload/matching is explicitly deferred;
adding it later requires a new decision, consent and a defensible privacy design.

Before lock, share participation without answers, popular-side percentages, or
unresolved "wins." After lock, share acknowledged picks; after resolution, include
the round and result revision. A static screenshot cannot be recalled, so opening
its link must fetch the latest result and correction notice.

Invites confer no competitive points. Rate-limit requests, provide block/report,
and make league join links revocable. Avoid chat, public comments, user-submitted
questions, and arbitrary image uploads in the first release; these add a standing
moderation obligation, not just a few screens.

## Content is the daily production dependency

Every published question needs an unambiguous binary proposition, labeled sides,
timezone, units, event/information cutoff, expected resolution time, licensed
primary source, fallback evidence, cancellation rule, and a named editorial owner.
Handle draws, postponements, market holidays, currency/rounding differences,
after-hours prices, and revised box-office reports before publication.

Maintain at least seven days of candidate supply, with the next two rounds
reviewed and checked against their actual event schedules. Finance weekends need
deliberate questions, not a promise that closed markets produce fresh outcomes.
Prefer a manual evidence-backed result over a fictitious "automatic" provider.
Never substitute a question after anyone can see the round; void when integrity
cannot be restored equally.

AI may assist drafting later. It is not the source of truth, publisher, outcome
judge, or substitute for licensed data. Do not add community sourcing until there
is moderation capacity and a safe author/reviewer separation.
