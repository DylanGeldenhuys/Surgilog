# SurgiLog: phone checks and clinical review

Prepared 16 October 2026 for Dylan, Leo and Tobela. Use only fictional patients on the [review site](https://theatre-tracker-2f2e5.web.app). These are checks to perform, not completed acceptance results. Engineering evidence is in [verification](verification.md).

## Review record

| Review | Person | Device/version | Date | Result |
| --- | --- | --- | --- | --- |
| iPhone Safari and installed app | Dylan | To record | Pending | Not run/reported |
| Android Chrome and installed app | Dylan | To record | Pending | Not run/reported |
| Backlog and theatre workflow | Leo | — | Pending | Awaiting review |
| Register and reporting definitions | Tobela, with Leo | — | Pending | Awaiting review |

Record **Pass / Change needed / Blocks pilot / Not tested** for each scenario below. Include the scenario number, expected versus observed result, and a synthetic reference if reporting a problem. Never include a password. Approval of one scenario does not imply approval of the entire app.

## Phone check — repeat on both phones

Allow about 10 minutes per phone. Record phone model, OS version, browser version, and whether each result was in the browser or the installed app. Use your hosted review account; local demo credentials do not work on the hosted site.

1. **Install and open.** Open the review site in a normal Safari/Chrome tab. On iPhone use Share → Add to Home Screen, enabling Open as Web App if offered. On Android open Chrome's menu → Install and create shortcut → Install (wording can vary by version). Close the original workspace tab, then launch the SurgiLog icon. Sign in if asked. The one-workspace-tab guard is still intentional; if it appears, close the other workspace first. Check the app name and logo.
2. **Navigate and enter data.** Select one hospital and department. Visit Overview, Surgical backlog, Theatre planning, Theatre register and Performance. Rotate between portrait and landscape. In Theatre register → Record operation, use a unique reference such as `SYN-PHONE-IPHONE-1610-A` or `SYN-PHONE-ANDROID-1610-A`, name `Synthetic Phone Check`, a configured theatre and `Dr Synthetic`. Enter yesterday's actual entry 08:00 and exit 08:30 SAST, a fictional procedure and the reason `Phone review`. Keep verification **Draft**. Check native date/time pickers, typing with the keyboard open, scrolling to Save, and reaching Close. Save online and confirm the record appears once. Tables may scroll horizontally inside their own area; the whole page should not become wider than the screen.
3. **Remember the session.** Close the app normally and reopen it while connected. The workspace should restore without another password. Explicit Log out is different and intentionally clears the remembered session.
4. **Lose connectivity.** With the department prepared online, open that synthetic register row using View / edit. Turn on airplane mode and also disable Wi-Fi. Add a unique note such as `iPhone offline check 14:30`, give a reason, and save. Expect a saved-on-device/pending indication, never a claim that the server has received it.
5. **Reopen offline.** Close and reopen the installed app while still disconnected. Return to the same department/register and synthetic row. The saved note and pending activity should remain. First-time login and departments never prepared online are outside this check. Do not uninstall the app, clear browser storage or deliberately Log out during this step.
6. **Reconnect and verify sharing.** Restore Wi-Fi/mobile data and bring the app to the foreground. Let the pending queue clear automatically; a conflict must be shown for review rather than silently overwritten. On another device or desktop, refresh the same department and locate the synthetic reference. Confirm the exact note arrived and there is still only one operation. Reports exclude this Draft. Background upload while the phone/app is suspended is not promised.
7. **Check logout last.** Once the test is synced, choose Log out. Relaunch: it should stay signed out. Sign in again online and confirm the server-saved synthetic record remains. Logging out before sync deliberately discards unsynced work on that device, as agreed for this app.

Repeat the basic browser navigation and a reload in Safari/Chrome as well as the installed-app steps above. Browser and installed-app storage can differ; prepare each context online before testing offline. If the page won't open offline, record which context failed and whether it had previously loaded online.

Installation references checked 16 October 2026: [Apple: turn a website into an app](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios), [Google: install a web app on Android](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en).

## Clinical walkthrough — Leo and Tobela

Dylan should prepare an empty synthetic review department and two role-scoped reviewer accounts if role comparisons are needed. Use a Doctor/write admin for clinical actions and a Nurse/Clerk for recording checks. Do not change existing reviewers' permissions just to simulate another role. This guide does not provision accounts or send invitations.

### C1. Register, prioritise and book

Add a fictional patient in Surgical backlog. Review reference/name, DOB/age, gender, contact, procedure, surgeon, listing date, priority and urgency assessment time. New cases start with Needs assessment. Change readiness to Ready with the appropriate clinical user, enter an operating estimate, then choose a session with space. Planned session start/end already describe staffed hours; the app finds a fitting booking start.

Expected: priority remains P1/P2/P3, and scheduling preserves original waiting time. Scheduled cases still contribute to backlog. Completed cases leave the default immediate backlog but remain available in history/filters. Leo's confirmed maximum targets are **30, 90 and 365 elapsed days**; the lower ends of P2/P3 are not instructions to delay treatment.

**Decisions still needed:** Is the recorded urgency assessment the correct target-clock anchor? What should retrospective reprioritisation do? Is it acceptable for a nurse/clerk to transcribe an initial doctor-assigned priority and name the assigning doctor? Existing priority changes remain clinical-only. These details have not been clinically approved.

### C2. Planned surgery → actual register

In Theatre planning, record actual entry and completion for that booked case. Use a short synthetic session today or a prepared historical fixture; do not enter future actual timestamps. Open Theatre register and find the same operation. Add ward, team and actual procedures using its existing View / edit action.

Expected: the completed booking appears automatically; enriching it does not create a second operation. One operation can contain several procedures. Nurses/clerks can log actual start/end, but cannot book, cancel or change an existing priority. Write admins have clinical powers within their assigned scope. Doctors manage department staff but cannot configure theatres.

**Review:** Are planner actions and register details clear enough for the person doing the recording? Are any essential fields or team members missing? The planner is the schedule/current booking workflow; the register is actual completed activity and historical records. Combining the views is not implemented.

### C3. Cancelled or unresolved bookings

Prepare another fictional booking. Cancel it with a clinical user and a reason; check the case remains untreated and retains its waiting clock/history. Review a prepared booking whose planned end has passed without a recorded outcome.

Expected: the unresolved booking appears under Requires action. The app does not assume surgery occurred or silently rebook it. Staff must record its actual outcome or cancel before rebooking.

**Review:** Is the message actionable, and who resolves it? Detailed no-show, abandoned-operation and booked-time correction workflows remain unfinished; record whether these block the intended pilot.

### C4. Historical register and verification

Record a standalone fictional operation using recorded age instead of inventing a DOB. Add two procedure lines. Save as Draft, then have a Doctor/write admin review and verify it. Alternatively preview a small synthetic CSV; imported rows begin as Draft.

Expected: standalone entries create no backlog case or booking. Drafts are visible but excluded from executive totals. Verification adds one operation and two procedures. Booked operations should be enriched in place, not entered again as standalone history. The source sex field is separate from backlog gender.

**Review:** Who verifies paper-register transcription? Are age units, admission/ward, sources, procedure lists and team fields sufficient? There is no OCR/scanning, deletion/void or booked-time correction workflow yet.

### C5. Capacity, turnaround and reporting

In an otherwise empty department, use one fully elapsed 08:00–10:00 staffed session yesterday and two verified operations in that theatre: 08:00–08:30 and 09:00–09:30 SAST. Give the first operation two procedures and the second one. Select a Performance period containing yesterday. Use a write admin to prepare the session if needed; avoid changing other review records.

Expected: **2 operations, 3 procedures, 60 occupied minutes / 120 staffed minutes = 50% utilisation**, **30-minute measured gap**, and **08:00 first entry**. An additional empty, elapsed two-hour session in another theatre changes capacity to 240 minutes and utilisation to **25%**, with the same operation/procedure counts. Verify in the selected department, not by adding unrelated Overview totals.

A configuration write admin may set a 15–30-minute booking turnaround allowance. It affects new bookings only. It does not turn into measured anaesthetic/cleaning time or move old bookings. Restore the review department's original setting after the check.

**Agree or request changes to these implemented definitions:**

- Actual entry-to-exit means theatre occupancy, not incision-to-closure or anaesthetic duration. First entry is not an anaesthetic/operation start measurement.
- Capacity uses recorded staffed sessions, including idle sessions, clipped to elapsed time. No automatic seven-hour day. Overlapping occupancy is counted once; missing timing or zero capacity is not reported as a confident zero-percent result.
- Actual turnaround is the observed gap between encounters in a session, or location/day for standalone work. Breaks/downtime are not separately classified yet.
- Operations are grouped by SAST entry date. Overnight carry-in can contribute occupied minutes without recounting the operation. Existing backlog completion metrics use completion dates, so overnight totals can differ legitimately.
- Weeks start Monday; financial years run April–March. Period percentages use their combined numerator/denominator. Staff figures describe activity, not comparative clinical quality.

## Return the outcome

For each phone: `model / OS / browser version / browser or installed / step / Pass or issue`.

For clinical review: `C1–C5 / reviewer / date / Accept, change needed, or blocks pilot / requested change`.

Dylan records the results here and in the handover. Clinical acceptance is pending until Leo/Tobela respond; passing automated checks is not a substitute. Any changes then receive focused testing before a new release.
