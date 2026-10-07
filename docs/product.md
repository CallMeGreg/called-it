# Product and competition

Status: owner-confirmed constraints are in [the decision register](README.md).
The detailed game rules here are a **recommended v1 specification**, to be
ratified before the competition engine and store descriptions are finalized.

## The promise

"Make three calls, find out what happened, and compete with your friends."
The differentiator is a shared, understandable daily ritual, not wagering,
infinite scrolling, or a claim that forecasting skill guarantees success.

Keep the three binary categories (Sports, Finance, Pop Culture) as a beta
hypothesis. Validate that ordinary players can understand each question without
outside research. A two-minute session is a design target, not a deadline imposed
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
   a spoiler-safe card. The next round's drop is visible.

Time-restricted **prediction submission**, not an inaccessible app, is the proposed
model. No purchase, ad view, invite, push permission, or streak payment unlocks a
late submission or changes competitive points.

## Window and eligibility

| Question | Recommended rule |
| --- | --- |
| Global versus local time | One persisted UTC drop and lock shared by the cohort. Display local time plus zone; never derive eligibility from the phone clock. |
| Initial schedule | Retain six hours only as a hypothesis. Select a fixed UTC time after testing the target region and content calendar. The existing 17:00 UTC setting is not approved. |
| Daylight saving | The competition stays on UTC; local display shifts. Announce planned schedule changes in advance and apply only to future unpublished rounds. |
| Joining during a window | Fully verified newcomers can join the current open round. No misses before their first eligible round. Joining at/after lock starts eligibility with the next round. |
| Deadline | The authoritative database acceptance check must occur before lock. A request queued or sent by a device before lock is not automatically eligible. |
| Offline | Allow draft editing, clearly labeled unsent. Reject late delivery; never backdate or silently replay a pick into a later round. |
| Event safety | Lock must precede the earliest relevant event/information cutoff, not merely the expected result publication time. |
| Overlapping rounds | A new round may open while an older outcome is delayed, but never reuse a question or reopen the older submission window. |
| Geographic rollout | Global means everyone in the available cohort has the same rules; it does not mean every country's store or SMS service is supported at beta launch. |

A six-hour round cannot be equally convenient worldwide. A regional beta is an
honest limit, not a solved global-accessibility problem. Before expansion, compare
longer common windows and separate regional competitions; never silently combine
players who had different information or deadlines in one rated leaderboard.

## Scoring and finality

Proposed baseline: each correct answer earns one point; an incorrect answer earns
zero. Retain unlimited Skip and independent category streaks initially.

| Closed, eligible category result | Current streak | Lifetime correct total |
| --- | --- | --- |
| Correct | Extend by one; update best | Add one |
| Incorrect | Reset this category | Unchanged |
| Explicit Skip | Preserve, do not extend | Unchanged |
| No accepted choice | Reset this category | Unchanged |
| Void/canceled/unfair round | Neutral for everyone | No points |
| Unresolved | Pending, not a miss or a correct answer | No points yet |

Leaving all categories untouched resets all eligible category streaks. It does
not erase lifetime progress. Do not punish a player for a round canceled by the
operator, a missing content category, or a round before enrollment.

**"Lifetime" means no periodic reset, not an immutable counter.** Correcting an
incorrectly awarded result can lower totals, best streaks, achievements, and ranks.
Show the reason and restatement rather than promising that a score can never fall.

Process streak history in round order per category. A pending earlier outcome
blocks that category's authoritative streak from advancing through later results.
Resolved points may be shown separately as provisional. Never temporarily
announce a record or award that assumes an unresolved earlier call was correct.

## Leaderboards worth competing in

Recommend a **calendar-month season** as the primary competitive board, with
lifetime totals and best streaks as career records. Calendar boundaries and
qualification rules require owner approval; do not retrofit season behavior into
the legacy API without a versioned specification.

| Surface | Purpose and safeguards |
| --- | --- |
| Friends | Default social comparison; only accepted friendships, with block/removal respected. |
| Season/global | A reachable fresh start, correct-pick points only. A newcomer has a reason to return next season. |
| Lifetime | Permanent participation record; explicitly favors longevity, not a pure skill rating. |
| Category/current and best | Secondary mastery records. Unlimited skips make current streaks unsuitable as the sole premier ranking. |
| Accuracy | A later experiment with a published minimum resolved-pick sample; never rank a one-for-one player above a sustained record without qualification. |
| "You" | Always show personal points and rank/unranked state, not just a top-50 list that most players never enter. |

Propose shared competition rank for equal scores (1, 1, 3), with a stable opaque
ID only ordering display. No speed-to-submit, purchase, referral count, or device
clock tie-breaker. A page/around-me response needs an as-of projection version and
pending/final indicator. Names and avatars are public profile data; phones,
provider identities, device IDs, and contact matches are not.

Season assignment follows the round's drop, not its eventual resolution. Define
a published settlement/correction period; keep disputed seasons provisional.
Results delayed beyond that period require the published void/escalation rule,
not an operator inventing a winner. Keep corrections auditable even after an
archive is restated.

## Achievements and retention

Start with a small, transparent set: first correct call, first completed round,
first perfect resolved round, category streak milestones, and cumulative correct
milestones. Name, icon, locked/unlocked progress, criteria version, and award
receipt are data. No hidden scoring multipliers or purchased streak repairs.

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

Use invite links and shareable result cards first. Mandatory phone verification
does not imply permission to read contacts. Contact discovery is **proposed for
deferral**, pending explicit consent and a defensible privacy design.

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
