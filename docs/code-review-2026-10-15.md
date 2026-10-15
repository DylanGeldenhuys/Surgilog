# SurgiLog code review and hardening

Reviewed 14–15 October 2026, requested by Dylan. Changes described as fixed passed local checks. Subsequently the API/index were deployed; frontend publication and live workflow verification were paused at Dylan’s request. Existing hosted reviewer accounts were unchanged.

## Assessment

The API has a sound starting boundary: direct client Firestore access is denied; server operations check current hospital/department grants; clinical writes use version checks, transactions, actor-bound receipts and audit records. The role and concurrent-booking suites pass. Concrete reliability and data-quality defects were found and corrected, particularly around uncertain requests, offline acknowledgements, scheduling, history and metrics.

This remains a fictional-data pilot. These checks are not clinical approval or a claim that no defects remain. Production-scale queries, recovery procedures, device validation and clinical correction workflows remain unfinished. The hosted frontend does not yet include this review; the API/index do. See release status below.

Scope: API routes/permissions, staff delegation/provisioning, clinical transitions, booking transactions, encrypted persistence/session lifecycle, retries/projection, reporting, imports, UI error handling, Firebase rules/indexes, runtime/deployment configuration and dependencies. Synthetic fixtures only; no user-supplied account password used. The original HTML artifact and branding are unchanged.

## Corrected findings

Severity describes potential impact before correction, not an observed real-patient incident.

| ID | Severity | Finding and correction | Evidence |
| --- | --- | --- | --- |
| F01 | High | Sync removed an acknowledged operation before updating its local record. Failed refresh/reload could make it disappear locally. Acknowledged records and queue removal now persist in one encrypted write; persistence failure leaves the original queue intact. | `apps/web/state.ts`, `workspace-projection.ts`; encrypted reload/failure tests. |
| F02 | High | Registration could predict a new patient ID when the server linked an existing patient outside the prepared subset. Mutation receipts now return authoritative changed records. The client merges by ID/version, updates demographics across cached departments and preserves newer versions on replay. Older receipts retain a compatible projection fallback. | `apps/api/service.ts`, `shared/domain.ts`, `workspace-projection.ts`; projection and linked-patient integration tests. |
| F03 | High | Only booking/session forms retained uncertain request IDs. A normal write with a lost response and failed local fallback could retry under a new ID. All operation forms now retain the submitted payload/ID until success or definitive rejection, including 429 retries. Inputs are disabled during submission and date parsing is inside error handling. | `apps/web/Forms.tsx`; browser fault check below. |
| F04 | High | A slow read could overwrite a newer snapshot or acknowledged mutation. Read/write generation guards now reject stale workspace/report fetches. | `apps/web/snapshot-guard.ts`, `state.ts`; three race/failure tests. |
| F05 | Moderate | HTML/truncated error responses lost their HTTP status during JSON parsing, allowing a real 403 to be treated as an offline retry. The HTTP reader preserves denial/temporary classifications and rejects malformed success responses. Mutation acknowledgements must match the operation ID and contain an accepted timestamp. | `apps/web/http.ts`, `firebase.ts`, `state.ts`; malformed 401/403/409/429/502 and success tests. |
| F06 | Moderate | All token-verification exceptions became 401, including provider failures. Known invalid/revoked/disabled identities remain 401; other verification failures exposed as service/network errors now return 503. Prepared password sign-in recognises temporary API failure; replay ends a genuinely invalid session promptly. | `apps/api/auth-errors.ts`, `server.ts`, `apps/web/Login.tsx`, `state.ts`; classification and revocation checks. |
| F07 | High | Lexical timestamp sorting mishandled valid timezone offsets. Waiting order, history and gaps could be wrong; an offset-bearing booking fixture offered occupied time. Time sorts now compare instants, preserving original request payloads/hashes. | `shared/domain.ts`, API/UI sort sites; offset/gap regression tests. Current API-generated booking starts already use UTC; the gap test protects legacy/imported records too. |
| F08 | Moderate | Next OR slot took the first gap in the earliest-starting session, missing earlier openings elsewhere. It now compares actual free start times across theatres. | `shared/domain.ts`; two-theatre regression. |
| F09 | High | 200 complete timings out of 201 rounded to 100%, making utilisation appear complete. Availability now uses exact counts, and incomplete coverage cannot display 100%. | `shared/domain.ts`; 201-attempt regression. |
| F10 | Moderate | Trends substituted today's priority into historical periods without history. Those periods now exclude unknown priorities; the chart explains this. Legacy priority edits no longer invent a listing-time priority. | Domain/API/projection logic and trend note; missing/partial-history regression. |
| F11 | High | The 250-case subset used due-date order and omitted cases needed by returned bookings. Preparation now uses current status, P1/P2/P3 and waiting time, plus every case referenced by a returned booking. | `apps/api/service.ts`; >250-case integration fixture checks ordering and patient/booking references. |
| F12 | Moderate | History limited arbitrary document IDs before sorting. It now orders by server receipt time before taking the newest 100, with a composite index. UI history resets between cases and ignores late responses. | API, `firebase/firestore.indexes.json`, `main.tsx`; 105-event integration test. |
| F13 | Moderate | Imports accepted timezone-less assessments and normalised impossible listing dates. Source dates/instants now pass validation first. | `shared/csv-import.ts`, import form; offset and 30-February regressions. |
| F14 | Moderate | Repeated query parameters could become arrays and trigger 500s; missing IDs were coerced to strings. Runtime query validation and strict string checks now return 400. | API routes/service; malformed-query integration tests. |
| F15 | Moderate | A confirmed booking/session followed by failed refresh was displayed as a failed save. Confirmed snapshots now update the local copy where possible; a refresh error has a separate message and does not repeat the accepted write. | `state.ts`, `main.tsx`; browser check below. |
| F16 | Moderate | Password sign-in after a downgrade to legacy reports-only could retain a prepared patient cache for the same department. It now removes operational workspace copies while retaining the original owner’s encrypted pending queue for review. | `apps/web/vault.ts`; online downgrade regression. |

## Remaining work and uncertainties

These are follow-up implementation/product decisions, not approval requests.

### Before real hospital records

1. **High — scale and request cost.** `workspace()` stops at 1,000 cases, sessions or bookings per department, including completed records. Search remains a prepared subset. Admin scans up to 1,000 profiles globally, so growth elsewhere can block a hospital administrator. Reporting loads departments with `Promise.all`; implicit “all” bypasses the explicit 100-hospital/500-department selection limits, with no total read/record budget. Add server cursors, bounded report concurrency/budgets and stored report summaries; measure representative volume and latency. (`apps/api/service.ts`, `admin.ts`.)

2. **High — recovery/device policy.** Explicit logout intentionally discards unsynced work, as requested. Password changes can retain old ciphertext without supported recovery. A remembered CryptoKey permits same-origin code to decrypt during a session; browser storage can be lost. Define enrolment, shared-device use, password-reset handling and stranded-record procedures; test storage exhaustion and physical devices. This review does not reintroduce passphrases or change the confirmed 72-hour session. (`vault.ts`, `WorkspaceSession.tsx`, [offline design](offline.md).)

3. **High — retrospective priority semantics.** A later-submitted priority change can carry an event time before a previous assessment or listing. Current priority uses the last accepted operation while history uses effective time; they can disagree. Leo needs to define retrospective entry/correction and clock-skew rules, then implementation can enforce chronology or distinguish historical corrections from current reassessments. (`service.ts`, priority branch.)

4. **High — clinical corrections/outcomes.** Completed cases have no supported amendment/reopening workflow; cancellation only applies before entry. Abandonment, no-show, changed actual procedure and incorrect timestamps need explicit audited transitions. Recorded actual intervals may overlap; utilisation unions them, potentially hiding contradictory records. Define legitimate late recording versus invalid data before adding clinical hard blocks. (`service.ts`, `domain.ts`, [requirements](requirements.md).)

5. **Moderate — browser/account defences.** Hosting has frame/content-type/referrer headers but no CSP; API Helmet does not protect the separate hosted HTML. Add and exercise a script policy covering the inline update script and Firebase Auth. MFA, verified-email and production password policy remain unimplemented. No stored-XSS exploit was demonstrated: ordinary React text is escaped and reviewed app code has no `dangerouslySetInnerHTML`. [CSP reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP).

6. **High — operational evidence.** This review did not re-audit live IAM, restore backups, inspect monitoring/alerts or load-test Cloud Run. The tree has no automated CI acceptance pipeline and much application code is untracked. Establish versioned release checkpoints and prove recovery before live use. The new index was subsequently confirmed READY during partial deployment; this does not establish other production readiness.

### Pilot refinements

- **Resource identity:** surgeon/theatre names are strings rather than stable identities. Renaming/removing a doctor's account does not implement a scheduling-resource lifecycle. Use stable IDs before complex amendments and staff turnover.
- **Current-session booking:** the OR indicator can show a remaining opening in a session already underway, while the booking form/API require an upcoming session. Decide whether late additions should be allowed, then align both eligibility rules.
- **Timing policies:** turnover remains fixed at 15 minutes; sessions are one local day and at most 12 hours. The discussed 24/7 opening-hours model is unfinished. Next OR slot finds space for at least a 5-minute operation plus turnover; it is not a promise that every procedure fits.
- **Metric definitions:** cancellations are attributed to scheduled date, not cancellation event time. Utilisation is recorded occupancy within staffed sessions, not all theatre opening hours or actual procedure duration. Confirm interpretation with Leo.
- **Retry/abuse budgets:** foreground retries use 30 seconds plus focus/reconnect triggers, without jitter/Retry-After backoff. Rate limiting is process/IP based. Measure proxy and hospital NAT behaviour before tuning; do not simply enable trust of arbitrary forwarded headers.
- **Closed uncertain forms:** request identity remains stable while the form is open. Closing/reloading an uncertain online-only booking/admin form still requires checking server state; there is no durable confirmation journal for shared operations.
- **Data integrity/imports:** Admin SDK reads are TypeScript-cast rather than fully runtime-validated. Trusted manual edits/migrations can create missing patient/session references that UI components assume exist. Add scoped integrity scans and actionable handling before general migration. Pasted CSV is not a resumable server import job.
- **Development lifecycle:** unmount closes the vault; hot reload/StrictMode behaviour warrants a dedicated check. Normal page reload is reliable for changed session code. This is separate from the intentional single-tab guard.
- **Performance/structure:** the production bundle is roughly 1 MB minified (~299 kB gzip), with a chunk-size warning. Lazy-load charts/admin/imports later. Split the large UI and API switches by workflow after these correctness changes settle; do not just hide warnings.

## Validation

Final results are also recorded in [verification](verification.md).

- Baseline: 40 unit tests and TypeScript passed; `npm audit --json` reported zero known vulnerabilities.
- Current unit suite: **67 tests across 10 files passed**, covering vault/session behaviour, time/gap/metric regressions, HTTP errors, CSV, acknowledgement persistence, stale reads and reports-only cache removal.
- API integration: **20 scenarios passed**, including authoritative linked-patient replay.
- Administration: **7 integration scenarios passed**, covering delegation, escalation denial, setup, clinical restrictions and revoked replay.
- Local and review production builds passed, including review-build verification. Both retain the bundle warning above.
- Chromium fault checks passed: accepted mutation with lost reply plus failed encrypted fallback; same-ID retry; encrypted reload during workspace-refresh outage; confirmed session with failed refresh; 390px layout. Original synthetic note restored; temporary session cleanup is recorded in verification. No physical-device/cross-browser claim.

The history emulator test proves query ordering, **not composite-index readiness**. The Firestore emulator does not enforce composite indexes. [Firebase emulator differences](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production).

## Release notes

The 15 October deployment was paused at Dylan's request to discuss additional theatre functionality. History index `CICAgOjXh4EK` is READY and API `theatre-tracker-api-00004-2hm` serves 100% with a passing health check. Hosting remains `e4e2c9dee7b5db86`; matching frontend publication and live sign-in/history/offline-replay/booking verification are still pending. See [deployment status](deployment.md).

No data reset was performed. Existing operation IDs/hashes, Firebase project identifiers, vault name and workspace lock remain stable. Receipts without snapshots remain supported. The temporary synthetic deployment fixtures/account were removed; no live workflow checks are claimed.

## Firebase rules assessment

This JSON scores **direct Firestore client access only**. All client reads/create/update/delete operations are denied, so the auditor's update-bypass, caller-supplied authority, field/type/size and ownership checks have no allowed mutation path. This matches the API-only architecture. Server SDKs bypass these rules and depend on separate API/IAM controls. [Firebase server-library behaviour](https://firebase.google.com/docs/firestore/security/rules-conditions).

```json
{
  "score": 5,
  "summary": "Direct Firestore client boundary is deny-all and matches the API-only design. This score excludes Admin SDK, API, cloud IAM, recovery and production readiness.",
  "findings": []
}
```

Authenticated reads/writes and unauthenticated reads are denied in emulator checks. Cloud Storage, external penetration testing, production-scale contention and a full accessibility audit were outside this review.
