# First-iteration requirements

## Proposed theatre extension — 15 October 2026

Dylan supplied Tobela’s workbook-development conversation for analysis. See [theatre register proposal](theatre-register-proposal.md) for source-supported requirements, current gaps and unresolved metric definitions. Attachments are unavailable; the extension is not implemented or clinically approved and does not supersede existing backlog/role policy.

## Implementation checkpoint — 5 October 2026

The local synthetic-data v0.1 now implements the core patient/first-case registration → demographic/case-note updates → priority/readiness → session/booking → theatre entry/completion loop, cancellations/holds, server-enforced global/region/country/province/district aggregate reporting, CSV waiting-list preview, and encrypted offline replay. It has built and passed the checks in [verification](verification.md). See [handover](handover.md) for exact limits.

The sections below remain the broader **pilot requirements**, not a claim of completed pilot acceptance. An Admin tab with scoped account/access and hospital/department/theatre creation is implemented locally. MFA, mixed roles within a hospital, patient-reference correction/merging/transfers, actual-procedure/outcome verification, downtime/no-shows/corrections, session amendments/publication, report snapshots, audited exports, hospital production infrastructure and physical-device validation are outstanding. The current local schema has one role per hospital membership; test actors have explicit department grants.

Current import accepts pasted CSV in batches of at most 100 new waiting cases, validates before saving, and uses per-row stable operations. It is not yet a managed import job. Current reports show a bounded local pilot cohort, not a production paginated warehouse. Leo has confirmed the P1/P2/P3 day ranges; the pilot must still confirm which clinical event starts the urgency clock and any specialty-specific exceptions before real-data use.


Planning baseline: 3 October 2026. Status: draft for Dylan and Leo.

## Confirmed direction

- Track surgical backlogs in South African hospitals: register patients, prioritise cases, organise surgery, and measure throughput and theatre use.
- Deliver an installable web app for desktop and phone.
- Support several hospitals in the architecture from the start; pilot at one hospital, possibly one department.
- Use Firebase and Google Cloud as the backend platform.
- Establish working logic and functionality before detailed theme work. Start with light blue, white, silver/grey, and restrained gold accents.
- Leo supplies the clinical/product vision; Dylan develops the application. Leo's Claude conversation is a later source of requirements.

Confirmed additions (3–4 October 2026): Leo supplied the actual bands as P1 up to 30 days, P2 31–90 days and P3 91–365 days. The treatment deadline uses each band's upper bound: 30, 90 or 365 elapsed days from the recorded urgency assessment time. Doctors, scrub sisters, and clerks can log activity; offline recording and later sync are required. Updates save to the server first whenever it is reachable. Local pending storage is the outage fallback and retries as soon as practical after connectivity returns. See [priority policy](clinical-priorities.md) and [offline contract](offline.md). Other detailed hospital policies remain proposals.

## What the artifact establishes

Reviewed source: `Global Surgical Backlog Monitor (Copy) (1).html`, 2,311 lines.

| Existing prototype | First-iteration interpretation |
| --- | --- |
| Global → regional → country → province/state → district → hospital → department views | The named aggregate roles and their server-enforced geographic boundaries are implemented. Overview lists every authorised hospital, then uses one Hospital and one Department selector for detailed metrics inside that boundary. Geographic administration and intermediate location-summary rows remain future management/reporting work. See [roles](roles.md). |
| Searchable and sortable patient/case lists; P1/P2/P3 priorities | Keep list operations and configurable priority bands. Use the confirmed bands in the priority policy. |
| Case editing, assigned surgeon, status, scheduled date | Extend into an explicit case lifecycle and actual theatre bookings. |
| Priority downgrade confirmation and a clinical reason | Keep the confirmation; record an attributable history of every priority change. |
| Hospital admin, scheduler, department head, and aggregate viewers | The new Leo/Dylan-confirmed role hierarchy supersedes operational role names; preserve geographic aggregate-only restrictions. See [roles](roles.md). |
| CSV validation and preview | Retain the workflow with robust parsing, duplicate detection, and safe retries. |
| Backlog, wait time, completions, trends, and utilisation | Define metrics and collect the events/timings required to calculate them. |

Gaps in the original artifact at the planning baseline (the new local implementation is described above):

- At the initial review, the repository contained the HTML and a README, with no application backend or build setup. The artifact references a missing `server.js` API at `http://localhost:8787/api` (lines 101–105).
- Demo records and credentials are embedded in the HTML; edits live in React state. Session persistence uses the artifact-specific `window.storage` interface (lines 1954–1975).
- Dates are anchored to 30 July 2026 (line 99), rather than the actual date.
- Demo completion counts are calculated as a percentage of backlog (line 419); utilisation and trend histories are seeded constants. These are not measured outcomes.
- The 200-day P1 threshold is a prototype assumption (lines 329, 420). It is not an agreed clinical standard.
- Scheduled cases disappear from the prototype's backlog count even though they remain untreated (line 331). Wait statistics also mix statuses.
- The artifact conflates a patient reference and a surgical case identifier. A person may need multiple surgical episodes.
- Scheduling has a date but no theatre, session capacity, booking duration, conflict checks, or actual timings.
- A normal single-case registration form is missing; CSV is the available case creation path.
- The CSV parser splits on commas and invents a scheduled date for scheduled rows (lines 1367–1440). Production import must handle quoted fields and require real scheduling information.
- Role checks in the interface express intent; the missing backend means server-side enforcement cannot be verified.

## First-release workflows

### 1. Hospital setup and staff access

- Invite staff, verify their sign-in identity, assign hospital and department memberships, and suspend access when necessary.
- Support more than one hospital membership per staff account. Overview begins with aggregate summary rows for every authorised hospital, then Overview and Performance show detailed metrics for one selected hospital and department. Patient-level work always uses one explicitly confirmed hospital and department.
- Configure departments, theatres, procedure options, staff assignments, session hours, priority policies, and cancellation reasons per hospital.
- Enforce permissions on the server for every request, including searches, reports, CSV imports, and exports.
- Include a second synthetic hospital in development and acceptance tests even if the first live pilot uses only one.

Confirmed permissions (5 October 2026) are defined in [roles.md](roles.md): Super User; Major User read/write; System Admin read/write; Doctor; Nurse; Clerk. Write admins have clinical powers within scope. Nurses/clerks register patients, correct details/notes and record start/end times, but cannot change priority, readiness, booking or cancellation. Doctors can add doctors/nurses/clerks inside their own department grants. Read-only Major/System Admin roles can inspect scoped patients as well as metrics; geographic reporting viewers remain aggregate-only.

Application roles and Google Cloud IAM are separate. Admin changes require connectivity, current server authority, idempotency, audit and conflict checks. Account creation must not expose an existing user’s password or reset link. Initial nurse/clerk priority transcription is implemented as recording a named doctor’s decision, pending Dylan’s reply to that specific workflow question.

### 2. Register a patient and surgical case

- Find an existing hospital patient by hospital reference or authorised name search before creating one.
- Store patient identity separately from surgical cases. Each case has its own identifier and history.
- Patient fields: hospital reference, name, date of birth where known, gender, and contact details where available. Unknown information must be recorded explicitly rather than fabricated. The current v1 records Female, Male, Non-binary, Another term, Prefer not to say, or Not recorded; Leo and the pilot hospital must confirm whether a separate sex-at-birth field is clinically required.
- Case fields: department, procedure, indication/brief relevant notes, laterality where relevant, referring/listing clinician, responsible clinician/team, date added to the list, priority, readiness, and estimated theatre duration when scheduling.
- Allow an unassigned surgeon while a case waits; require an appropriate team assignment before publishing its theatre booking.
- Do not require a national ID or phone number simply to create a backlog entry. Leo must confirm the minimum safe identification fields.
- Detect repeated hospital references and likely duplicate active cases. Resolve deliberately; never silently merge patients.
- Derive age and waiting days from recorded dates; preserve original dates on import and rescheduling.

### 3. Manage the backlog and priority

- Search, filter, sort, and paginate by department, procedure, clinician, priority, readiness, status, and waiting time.
- The full backlog table shows the artifact's operational fields: patient reference/name, DOB with derived age, gender, contact, procedure, surgeon, priority, readiness, waiting time and status. Phone layouts may scroll this table horizontally rather than removing fields.
- Default to the **Current backlog** and show 10 cases per page. Completed cases leave the immediate working list but remain available through Completed/All filters, history and reporting.
- Show clearly which cases are unbooked, scheduled, on hold, overdue for treatment, or require clinical review.
- Provide a **Requires action** view for backlog cases overdue for treatment according to their assigned priority, and bookings whose planned end has passed without a recorded outcome.
- Use Leo-confirmed bands P1 (up to 30 days), P2 (31–90 days) and P3 (91–365 days), with explicit policy versions and urgency anchor timestamps. See [priority policy](clinical-priorities.md).
- Confirmed ordering: P1, P2, then P3; within each priority, longest waiting first using the original listing date. Readiness does not silently lower urgency.
- Require clinical authority and a reason for priority changes. Preserve old/new values, actor, policy version, and timestamp; confirm downgrades explicitly.
- Changing priority or cancelling a booking never resets the original waiting clock. Preserve prior target breaches and policy history.
- A clinician chooses or confirms priority. Automated clinical scoring and autonomous reprioritisation are outside the first release.
- Use explicit priority controls on phone and keyboard. Reordering a theatre list must not change clinical priority.

### 4. Plan theatre sessions and bookings

- Create a session with theatre, date, planned staffed start/end, department, responsible team, and available minutes.
- New sessions start with the date selected in Theatre planning; after saving, display the actual submitted date. The current one-off staffed-session model reserves both the theatre and responsible surgeon for the whole window, including sessions with no patient bookings. Check resources across every department in the hospital, while keeping the operational list department-scoped. Explain conflicts with the matching resource and reserved SAST date/time; name the department only if the caller is authorised to view it.
- Build an ordered list of ready cases, with estimated procedure/occupancy time and a separately visible turnover allowance.
- Collect the clinician's estimated operating time when scheduling, before selecting a session. Do not invent or require a generic duration when the case first enters the backlog.
- After an estimate is entered, show upcoming sessions in chronological order only when they have enough uninterrupted capacity. Each choice shows the available surgery interval and responsible doctor. Assign the earliest fitting start automatically and recheck it transactionally on confirmation; do not ask the user to calculate a planned start time.
- Provide day and week views plus a phone-friendly session list. Support draft and published sessions.
- Prevent overlapping theatre sessions, conflicting booked surgeon/team slots within the hospital, and multiple active bookings for one case. Warn about patient conflicts across that patient's cases.
- Reject conflicts on the server even when two schedulers save concurrently. Show the conflict and current data.
- Show capacity remaining and predicted overrun. Record a reason for an authorised capacity exception; do not silently overbook.
- **Next OR slot needs further design.** Dylan clarified that it should tell doctors when a theatre is next available to book, based on configured theatre operating windows—commonly 08:00–16:00, with some theatres available 24/7. Theatre availability should be captured when theatres and their operating times are configured. The current v1 card derives an unallocated gap from one-off staffed sessions and bookings; treat that calculation as provisional until the recurring/24-hour availability model is designed. The case-specific scheduling form must still use the clinician's estimate and recheck the exact fit on the server.
- The current v1 reserves a visible 15-minute turnover after the estimated operation for cleaning and room reset. Keep operating time and turnover as separate values; Leo/hospital policy must confirm whether turnover varies by theatre or procedure.
- Preserve booking attempts when a case is moved or cancelled. Cancellation reasons include patient, clinical, staffing, equipment, beds, and emergency displacement; Leo should refine these categories.
- Cancelling a booking returns the still-required case to waiting or an explicit hold. It does not remove the patient from the backlog.
- If a booking's planned end passes while it is still Scheduled or In theatre, flag it as **Requires action**. Do not infer that surgery happened, infer a cancellation, or automatically return the case to Waiting. Keep the case in the backlog until authorised staff record the actual theatre entry/completion or cancel the booking with a reason; a new date is booked only after resolving the prior attempt.

### 5. Record surgery and close the loop

- Record patient-in-theatre and patient-out-of-theatre timestamps for occupancy, and procedure start/end when available for operating time.
- Record completion time, actual procedure, responsible clinician/team, and a concise operational outcome.
- Record no-shows, cancellation time/reason, session delays, and downtime. Do not require continuous live clicking; allow later attributable entry and corrections.
- Distinguish surgery performed from abandoned or cancelled activity. Occupied theatre time may exist without a completed surgical case.
- Terminal non-treatment closure requires a reason, such as treatment elsewhere, transfer, no longer indicated, declined, or deceased. These are not counted as surgery completed by the hospital.
- Keep full history. No routine hard deletion of patient/case activity.

Proposed case lifecycle:

`Waiting → Scheduled → In theatre → Completed`

- `Waiting ↔ On hold`, with a reason and review date.
- `Scheduled → Waiting / On hold` when its booking is cancelled or the patient does not attend.
- Passing the booked time is not a lifecycle transition. A derived Requires action alert remains until the booking outcome is recorded.
- An open case can become `Closed without surgery`, with a reason.
- An abandoned procedure returns to an appropriate open state while retaining the attempt and timings.
- Historical entry can record an already-completed episode with explicit actual dates and attribution.
- Corrections/reopening require appropriate authority and history; a later independent surgery creates a new case.

Readiness is separate: `Needs assessment`, `Not ready`, or `Ready`, with blockers and review dates. Detailed anaesthetic, bed, blood, equipment, and consent checks depend on the pilot specialty.

### 6. Measure performance from recorded activity

Metric definitions below are proposed operational definitions for Leo to approve. Every report must show its date range, scope, last update, and missing-data coverage.

| Metric | Proposed definition |
| --- | --- |
| Surgical backlog (all unresolved cases) | Waiting + Scheduled + On hold + In theatre. Scheduled patients remain untreated until completion. The Overview uses Leo's artifact term **Backlog** and identifies ready-and-unbooked cases as a subset. Show the status breakdown. |
| Ready and unbooked | Waiting cases whose readiness is Ready. |
| Waiting time of open cases | Calendar days from original list-entry date to report date in Africa/Johannesburg. Show median and P90; on-hold cases remain visible, with a separate breakdown. |
| Completed cases | Cases with surgery actually completed within the chosen period, using the actual completion date. Count cases; optionally show distinct patients separately. |
| Wait to treatment | Days from original list-entry date to actual surgery date for cases completed in the period. Never mix this cohort with open-case waiting time. |
| Overdue cases | Open cases past the applicable approved target date. Show Unconfigured where no policy exists. |
| Backlog movement | Opening outstanding cases + new/reopened/transferred-in cases − completions − closures/transfers-out = closing outstanding cases; report each component. |
| Backlog trend by priority | Outstanding cases at each month-end/current report time, split into P1/P2/P3 using the priority effective at that time. Derive it from listing, completion/closure and versioned priority history; expose history completeness. |
| Booking cancellation rate | Cancelled booking attempts intended for the reporting period / all valid booking attempts intended for that period. Report no-shows separately. Preserve rescheduling attempts and reasons. |
| Session occupancy utilisation | Union of actual patient-in/out intervals inside the session's planned staffed window / planned staffed minutes × 100. Turnover is separate. |
| Overrun | Actual occupied time beyond the planned staffed window; show separately from utilisation. |
| Turnover time | Time from the previous patient's theatre exit to the next patient's entry within the same session, excluding separately classified breaks/downtime. |
| Data completeness | Proportion of relevant sessions/attempts with required timings and outcomes; incomplete metrics display as provisional or unavailable. |

Freeze planned capacity at an agreed publication/cutoff point. Later cancellations or staff losses remain visible as capacity losses; changing the denominator must not hide wasted sessions. Report planned capacity and later changes separately. Missing timings are not zero utilisation. Zero-capacity sessions have no utilisation percentage. Validate overlapping timestamps instead of double-counting them.

Use an explicit percentile convention and retain its version. Store dated snapshots/events so historical trends can be reproduced; do not generate historical trends from today's records. The local v1 reconstructs a six-month P1/P2/P3 line from case lifecycle timestamps and per-case priority history. Pre-pilot history is unavailable unless validated historical data is imported.

Reporting scope is separate from the operational workspace. **Overview** first shows a basic aggregate table for all authorised hospitals, matching the artifact's global-to-hospital flow. Beneath it, ordinary single Hospital and Department selectors control the detailed Overview metrics; **Performance** uses the same exact selection. Aggregate responses are calculated on the server from the caller's current grants and contain only metrics and scope summaries; they do not return patient or case records. **Surgical backlog** and **Theatre planning** require one hospital and one department. If a reporting selection is outside a user's operational memberships, patient-level tabs retain and ask the user to confirm their authorised operational workspace instead of exposing the reporting selection's records.

### 7. Import and export

- Support individual registration first, then CSV upload/paste with template, preview, row errors, and hospital/department checks.
- Handle quoted CSV values, line endings, valid calendar dates, duplicates, and missing optional fields.
- Do not invent scheduled/completed dates. The initial bulk backlog template accepts waiting cases; importing historic or scheduled episodes requires the additional required data.
- Make retries idempotent: report created/skipped/rejected rows and preserve import provenance. A failed batch must not report total success.
- Authorised staff can export the minimum necessary waiting/theatre list or aggregate report. Log exports, neutralise spreadsheet formulas, and restrict fields to the caller's access.

## Reliability and patient data requirements

- Synthetic data for development and demonstrations. Separate development, staging, and production environments.
- Patient records are isolated by hospital and department permissions, including files, caches, imports, and reports.
- Staff accounts are invitation-based; require multi-factor authentication for access to live clinical data. For the current review, Dylan explicitly chose familiar Log out with deletion of unsynced device work and sessions lasting three days of inactivity across reload/browser restart. Automatic expiry retains encrypted work but requires sign-in. Institutional shared-device policy remains a pilot requirement.
- Persist clinical and scheduling changes atomically with their audit event; show who changed what and why. Log access and exports through the API.
- Use version checks to prevent silent overwrites and idempotency keys for retried writes.
- Offline recording is required. Send connected updates to the server first and label them Synced only after acknowledgement. Use the per-user encrypted working set/outbox only when connectivity or the server is temporarily unavailable, with visible pending states, durable writes, prompt idempotent replay and explicit conflict handling as defined in the [offline contract](offline.md). First sign-in and shared booking confirmation require a connection.
- Protect backups, test restores, and agree recovery/retention policies before the live pilot.
- No patient information in ordinary application logs, crash telemetry, analytics, push notifications, or public URLs.
- Capture the hospital's data-processing arrangements and minimum necessary fields before real patient use. Health-data processing and cross-border transfers need an applicable legal basis under POPIA; regional hosting alone is not compliance. Have the hospital's Information Officer review the arrangement. [POPIA, especially sections 19–22, 26–32 and 72](https://www.gov.za/sites/default/files/gcis_document/201409/3706726-11act4of2013protectionofpersonalinforcorrect.pdf).

## Deferred scope

Native app-store apps; patient self-service; patient SMS/WhatsApp; billing; a full electronic health record; geographic role-management screens and intermediate region/country/province/district summary rows; automatic cross-hospital patient matching/transfers; AI prioritisation; automatic theatre optimisation; complex workforce/bed inventory planning; hospital-system integrations; full offline hospital databases and offline shared booking confirmation.

The first architecture must allow hospital growth, but these features do not need to be implemented for the first pilot.

## First-pilot acceptance criteria

1. A clinician registers a patient/case on a phone, and an authorised scheduler sees it on desktop after refresh without losing data across sign-in sessions.
2. A patient can have two distinct surgical cases without identity duplication or shared case status.
3. Users cannot retrieve or mutate another hospital's cases by changing IDs, filters, import data, or export requests. Department restrictions also hold server-side.
4. Scheduling a case preserves its waiting days and outstanding-case membership; completing it updates the correct reporting cohort.
5. A scheduler cannot change priority; a clinician's priority change records a reason, old/new values, and author.
6. Two simultaneous conflicting bookings produce one success and one explicit conflict, with no partial state or duplicate booking.
7. Cancelling a booking preserves history and returns the case appropriately; cancellation is not counted as treatment.
8. Recorded theatre timings reproduce known utilisation, overrun, and turnover examples. Missing/invalid timings cannot create misleading complete figures.
9. Repeating an import or retrying a write creates no duplicate clinical event, case, or completion count.
10. Revoked staff access is enforced on subsequent API requests; sign-out clears in-memory patient data and service-worker caches contain no clinical responses.
11. Leo can complete the registration → priority → booking → outcome workflow with synthetic cases and approves the terminology, target policies, and report definitions.
12. A staging restore is demonstrated and live-data access/operating responsibilities are assigned before production use.
13. Offline entries survive reload, sync without duplicates, retain attribution, and show conflicts explicitly; verify shared-device isolation, expiry, lost acknowledgements, and storage failures as detailed in the offline contract.
14. Aggregate reports include only hospitals and departments granted by the server, return no patient/case payloads, and require a concrete hospital/department confirmation before patient-level navigation.

## Questions for Leo and the pilot hospital

1. Which hospital and department will pilot, and what are the approximate backlog, daily operations, theatres, and staff numbers?
2. Is the initial scope elective surgery only? How should emergency cases and emergency displacement be recorded?
3. Given the confirmed bands, what urgency clock anchor, P1 subtarget selection, month arithmetic and review policies apply?
4. Does the waiting clock start at referral, accepted referral, decision to operate, or formal listing? How should holds and transfers be reported?
5. Which identifiers and clinical/readiness fields are essential, including unknown birth dates, children, and patients without phones?
6. Who creates/publishes lists, who can approve exceptions, and who records actual theatre times and outcomes?
7. Which utilisation definition does the hospital already use, what are its session cutoffs, and are reliable actual timings available?
8. Which devices are shared and what offline unlock, expiry, retention and recovery policies apply? Offline recording is already required.
9. What source spreadsheet/system is used now, and can a synthetic sample of its column structure be provided?
10. Who owns the data, authorises access, approves processing/location arrangements, and sets retention, recovery, and hosting budget?

Reconcile these answers and Leo's Claude conversation against this document before treating the draft clinical rules as agreed requirements.
