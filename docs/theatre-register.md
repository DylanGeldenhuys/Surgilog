# Theatre register preview

Updated 16 October 2026. Implemented on `feature/theatre-register`, tested with synthetic data and **published to the fictional review site**; not clinically approved. See [deployment](deployment.md) for verified release identifiers. The original source analysis remains in [the proposal](theatre-register-proposal.md). No source workbook, scans or patient rows were imported.

## Use the preview

Run `npm run dev` and open http://127.0.0.1:5173 for automatic development updates. For installation/offline page reloads, also run `npm run build` and `npm run preview`, then open http://127.0.0.1:4173. Local demo accounts are documented in [README](../README.md).

- **Admin → hospital → Set turnaround time:** write configuration admins choose 15–30 whole minutes. Existing hospitals default to 15. New bookings reserve the doctor's operating estimate plus this allowance. The booking saves its own allowance; changing the setting does not move existing bookings. This is a scheduling allowance for reset/setup, not a measurement of actual anaesthesia or cleaning.
- **Theatre planning:** retain the existing planned session start/end and actual patient entry/completion recording. Staff can create the day's session with its intended working hours; no second planned-start control was added.
- **Theatre register:** choose one hospital/department; filter by date, configured operating location and search; view ten rows at a time. Completed bookings appear automatically. Add details to an existing booked operation, or record a separate historical/unplanned operation without manufacturing a backlog case or booking.
- **Performance:** choose Week, Month, Quarter or Financial year, plus a date in that period. Review totals, charts, operating-location/procedure/surgeon/anaesthetist tables and **Print executive summary**. Reports require a connection and use server-confirmed records.

## Records and permissions

Each encounter records patient reference/name, known DOB **or** recorded age/unit (years/months/days), separately recorded sex, admission date, ward, theatre/location, one or more actual procedures, surgeon, assistant, anaesthetist, actual entry/exit, source/reference, notes and verification status. Unknown age and DOB are allowed; never infer an exact DOB from age. Recorded age is associated with the operation date and does not increase over time. Source sex is not copied into the backlog gender field.

Nurses/clerks can create and edit Draft standalone entries within their departments. Doctors and write admins can verify them and amend verified records. Read admins view only; geographic reporting viewers receive aggregates, with no patient register/workspace access. Verification is a preview workflow requiring clinical review, not an assertion of clinical signoff. Existing booked start/end permissions remain unchanged.

Booked encounters must reference a completed booking; their patient identity, theatre and actual times stay consistent with it. Stored enrichment replaces the derived row, so an operation is counted once. Standalone entries keep their own patient snapshot and do not alter an existing backlog patient, invent urgency/history or close a case.

The API uses current scope checks, version conflicts, actor-bound idempotency receipts and audit transactions. It rejects duplicate patient-reference/location/start fingerprints and re-entry of a known booked operation at the same time. These checks do not replace patient matching across inconsistent references. Editing an encounter requires a reason. There is no deletion/void or booked-time correction workflow yet.

Connected changes go to the server first. During an outage, authorised register changes save to the existing encrypted outbox, survive reload in the prepared PWA and replay on reconnection. Replays recheck permission and version; conflicts retain the proposal for review. Deliberate Log out still deletes unsynced device work as previously requested. Settings, shared bookings and report retrieval require connectivity.

## CSV preview

The register has a separate paste/preview import, at most 100 rows. All imported rows begin as Draft; successful rows retain stable request IDs during retry. Required header names and supported optional columns are:

```text
patientRef,patientName,operationDate,entryTime,exitTime,theatre,procedures,surgeon,age,ageUnit,dob,sex,admissionDate,ward,assistant,anaesthetist,sourceReference
```

Dates accept DD/MM/YYYY or YYYY-MM-DD; times are HH:MM in SAST on the operation date; procedures use semicolons within the cell. Theatre must match hospital configuration. Use manual entry for overnight operations. Preview rejects invalid dates, conflicting age/DOB, repeated rows and invalid chronology. Server duplicate checks and permissions still apply at import. This is structured CSV intake, **not scanning/OCR** or a managed background import job.

## Metric definitions implemented for review

| Measure | Implemented definition |
| --- | --- |
| Operations / procedures | Verified encounters by SAST entry date; sum actual procedures separately. Drafts excluded. Completed bookings are derived until enriched, then counted once. |
| Staffed capacity | Union of recorded session windows by theatre, clipped to the selected period and the current time. Idle staffed sessions count; future hours do not. No assumed seven-hour day or fabricated capacity for unplanned work. |
| Utilisation | Unioned actual entry-to-exit occupancy inside those windows / eligible staffed minutes. Overnight carry-in contributes occupied minutes without counting the operation twice. Missing completed-booking timing/references make utilisation unavailable; zero capacity is unknown. |
| Actual turnaround | Previous occupied exit to next entry within a session, or location/day for unplanned activity. Last case has no observation; overlapping/nested intervals are flagged and not treated as negative or positive turnaround. No arbitrary long-gap cutoff or assumed downtime exclusion. |
| Average first entry | First patient entry per recorded session, or location/day for unplanned work, displayed as SAST clock time. This is not incision/anaesthetic start. First-entry difference from planned session start is shown separately; negative means early. |
| Staff activity | Verified encounter count, total encounter minutes and minutes/operation, grouped by recorded surgeon or anaesthetist. Describes activity, not quality or case-mix-adjusted performance. Missing names remain Not recorded. |

Weeks start Monday. Financial years run 1 April–31 March; quarters are Apr–Jun, Jul–Sep, Oct–Dec and Jan–Mar. Period totals are recomputed from records and denominators, never averaged from monthly percentages. Future graph points and unknown measures remain blank. A zero past count means no verified records in this dataset, not independently proven complete capture. The selected department is the scope; no all-department theatre report was added.

## Storage, limits and next work

- Additive collections: `hospitals/{hid}/theatreEntries` and `theatreEntryKeys`; existing receipts/audit carry entry IDs and authoritative snapshots. Hospital `turnaroundMinutes` is optional for compatibility. No existing records require conversion.
- Prepared register contains the newest 500 saved entries plus completed bookings in the existing prepared workspace. A notice identifies that limit and distinguishes server reports; local date/search cannot retrieve older unprepared entries. Existing workspace/Overview collection limits remain 1,000 per department.
- `/api/reporting/theatre` uses authorised department/date queries, with limits of 5,000 saved entries, 5,000 actual-time bookings, 5,000 planned-time bookings and 2,000 sessions (including padded boundary records). Exceeding a limit rejects the report instead of returning partial totals. References are fetched in batches of 100. Responses contain aggregates only and reads are audited. No snapshots or reporting warehouse yet.
- Five composite indexes in `firebase/firestore.indexes.json` are deployed and READY. The API with `theatre-register-v1` and matching frontend are published. Future releases must preserve the index → API → frontend order. The Hosting guard requires that capability and `admin-v1`.
- Still deferred: OCR/scans, source uploads, structured multiple team members, staff/location directories, recurring/24-hour availability, downtime/overrun/abandoned outcomes, clinical duration classifications, live unplanned-running cases, booked timing corrections, full server pagination and scale testing. Capacity/timing conventions need Leo/Tobela's review.

## Rollback

The baseline is commit **`147acf7`**, tagged **`checkpoint/pre-theatre-register`**; `main` remains at that checkpoint. Feature work is isolated on **`feature/theatre-register`**. To preview the old code after committing any new work, stop local services, run `git switch main`, rebuild if using port 4173, then restart. Return with `git switch feature/theatre-register`. No force reset or cloud rollback is needed.

Code rollback does not roll back data. New collections/fields are additive and ignored by the checkpoint app, but finish syncing or review pending register work before using the older client. Rebuild the PWA and use its update page to replace cached feature assets.

An ignored local emulator snapshot from before the feature browser mutations is saved at `.local/pre-theatre-register-emulators`. It contains Auth and Firestore fixture state, not source code. Keep it private. Restore only with stopped emulators and after exporting any later work you want to keep; the emulator launcher normally imports `.emulator-data`. The snapshot is local-only and was not committed or uploaded. The initial local preview did not change cloud data. Subsequent release verification uses isolated temporary synthetic records and removes them afterward; existing review data is preserved.

See [verification](verification.md) for actual automated/browser evidence and remaining device/release checks.
