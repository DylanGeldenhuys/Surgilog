# Clinical priorities

Confirmed by Leo through Dylan on 4 October 2026.

| Band | Product target |
| --- | --- |
| P1 | Up to 30 days. Treatment due at 30 elapsed days. |
| P2 | 31–90 days. Treatment due at 90 elapsed days. |
| P3 | 91–365 days. Treatment due at 365 elapsed days. |

These product targets come directly from Leo and supersede the earlier provisional P1a/P1b 24/72-hour interpretation, P2/P3 calendar-month calculation, external comparison schemes, and the artifact's obsolete 200-day P1 rule. P4 was not requested.

## Calculation contract

- A band's upper bound is the maximum treatment interval, not an instruction to delay care until the lower bound. A P2 patient may therefore be treated before day 31 and a P3 patient before day 91.
- Show exactly three bands: P1, P2 and P3. P1a/P1b are retired.
- Preserve priority, clinician, reason, assessment time, urgency clock anchor, target timestamp, policy version, and history.
- Keep referral/list-entry dates separately; scheduling, reassessment, holds, and sync must not silently erase original waiting time or past breaches.
- Calculate the treatment due time as exactly 30, 90 or 365 elapsed 24-hour days from the recorded urgency assessment time. A case becomes overdue at that instant.
- All imports must supply the urgency assessment timestamp and timezone; do not invent it from server receipt time.
- Keep UTC instants and display Africa/Johannesburg time. Offline client times are claims; store trusted server receipt time separately and review clock anomalies. Receipt time is not the waiting-clock start.
- Clinical authority is required for priority changes, including replayed offline changes. Record reasons and explicitly review conflicts.

Verify exact 30/90/365-day boundaries, missing timestamps, reassessment history, clock skew, and delayed offline sync when implementing.

## Historical reporting integrity (15 October 2026)

Monthly trends omit a case for periods without a recorded effective priority and disclose coverage. They must not project today's priority backwards. Imported urgency timestamps require an explicit timezone; invalid calendar dates are rejected before JavaScript date normalisation. Timestamp ordering compares instants, including offset-bearing values. Retrospective assessment/correction chronology remains a clinical decision: the current API can accept a later-submitted, earlier-dated priority, so current priority and effective history can disagree. See the [review](code-review-2026-10-15.md).
