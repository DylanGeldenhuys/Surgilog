# Architecture and implementation

Updated 16 October 2026. The hardening and theatre-extension API, indexes and frontend are deployed; see [review](code-review-2026-10-15.md). Local emulator v1 and the fictional-data cloud review are implemented and deployed. Firebase Hosting serves the review PWA; Cloud Run and Firestore Standard run in Johannesburg. Email/Password Auth and API-only Firestore rules are deployed. See [deployment](deployment.md) for actual endpoints, [handover](handover.md) for feature boundaries and [verification](verification.md) for checks. One explicitly requested permanent Super User account is provisioned; other reviewer accounts remain deferred; real hospital use is not approved.

## Local implementation

The theatre extension on `feature/theatre-register` was published to the fictional-data review on 16 October. Live revision `theatre-tracker-api-00006-seh` serves 100%; Hosting version is `eec873a2dac0b3a7`. See [contracts, metrics and limits](theatre-register.md). Additive hospital subcollections `theatreEntries` and `theatreEntryKeys` hold actual encounters and transactional duplicate keys. Completed bookings derive register rows until enriched; standalone encounters do not create patients/cases/bookings. Hospital `turnaroundMinutes` defaults to 15, accepts 15–30 through versioned Admin operations and is snapshotted per booking. `apps/api/theatre.ts` enforces current role/scope, linked-record consistency, duplicate/version checks, atomic audit and authoritative receipt snapshots. The existing direct-client deny rules are unchanged.

`GET /api/reporting/theatre?hospitalId&departmentId&from&to` is separate from Overview: one authorised department, at most 366 days, bounded indexed queries, aggregate-only response and audited reads. It includes boundary carry-in occupancy and rejects oversized reports rather than truncating. Five indexes for saved-entry dates, actual/planned booking times and session start were deployed and confirmed READY. Prepared patient workspaces carry at most 500 saved register entries with a truncation flag; historical period reports query the server. Existing 1,000-record workspace/Overview limits still apply.

The repository is a single npm package with `apps/web`, `apps/api`, `shared`, `scripts`, `firebase`, and `tests`. It uses React/TypeScript/Vite, plain CSS and native forms/dialogs, Lucide, Recharts, Zod, Papa Parse, Firebase Authentication, Fastify/Admin SDK, Firestore Standard emulators, and Dexie/Web Crypto. Navigation is React state; a custom workspace hook implements refresh/projection/replay. Fonts are bundled. The single login action authenticates online when possible and automatically opens the account-password-encrypted offline vault when connectivity is unavailable; pre-release migration banners and old-secret recovery screens were removed at Dylan’s request. Existing encrypted development archives are retained silently. Tailwind, shadcn, TanStack and React Hook Form were initial options, not dependencies.

Admin configuration adds `adminOperations/{operationId}` and `systemAudit/{operationId}` (online-only, API-enforced, direct clients denied). Actual clinical collections are `profiles/{uid}` and `hospitals/{hid}/{patients,cases,sessions,bookings,patientRefs,guards,receipts,audit}`. Departments/theatres/surgeons are small hospital configuration lists. All client Firestore access is denied. The API reads current profiles, validates department references and role capabilities, and atomically writes transitions, audit and receipts. Shared date guards serialise booking/session conflicts. Receipt replay checks current hospital, department, role, actor and payload.

The local UI prepares 250 cases (current cases first, then P1/P2/P3 and longest waiting time), plus every case referenced by a returned booking. It returns department sessions/bookings, and computes reports on up to 1,000 records per collection and authorised department. It explicitly rejects larger pilot datasets instead of silently truncating reports. Search is on the prepared subset. History returns the newest 100 server-receipt events using the declared `audit(caseId ASC, at DESC)` composite index (deploy before publishing the API change). Server pagination, further index/volume analysis, repository abstraction, background report snapshots, managed imports and exports remain future work.

`GET /api/reporting/overview` accepts a bounded selection of hospital/department pairs and validates every pair against current profile memberships and reporting grants. The web app uses one full authorised selection for the Overview's hospital table and one exact hospital/department pair for the detailed Overview and Performance metrics. A request containing any ungranted hospital or department is rejected as a whole. The API loads only granted departments, namespaces record identifiers before cross-hospital metric calculation, and returns metrics plus scope summaries without patients or cases. Each included hospital receives a `report.read` audit event. The encrypted account vault caches responses under stable selection keys for prepared offline viewing; online refresh and replay recheck current server grants. Backlog and Theatre Planning use a separate exact operational scope.

Profiles may also hold a separate `reportingGrants` array for the artifact's `global_viewer`, `regional_viewer`, `country_viewer`, `state_viewer` and `district_viewer` roles. Hospitals record region, country, province and district. On `/api/me` and every report request, the API resolves matching hospitals from current server records and returns a derived `reportingAccess` list. These grants never satisfy the operational membership check used by patient workspaces, histories or mutations. The web app therefore supports a reporting-only profile with no operational membership and omits its patient-level navigation. Membership-based clinicians retain aggregate reporting over their explicitly granted departments.

The deployed Admin module supports the confirmed Super/Major/System Admin/Doctor/Nurse/Clerk hierarchy. Write admins explicitly have clinical authority; readonly admins do not. Global access resolves against current hospital metadata; ordinary staff use explicit departments and bounded delegation. Admin user creation reserves a request, creates the Auth identity, then rechecks grants and commits the profile. Password setup links are returned only for new users and never persisted in receipts. The deployed runtime has the approved scoped Auth provisioning role with create-user and account-action-link permissions; see [roles](roles.md) and [deployment](deployment.md).

The implementation accepts explicit-offset instants for listing/assessment/event/recording, generates server receipt timestamps in UTC, compares times numerically, and uses SAST display/calendar arithmetic and date-only birth dates. Refresh is manual, after replay, and every 30 seconds while visible. No server streaming or background processing exists yet. Booking requests require server acknowledgement; retrying an uncertain confirmation within its open form reuses the submitted operation.

Mutation receipts now include the authoritative changed patient/case/booking/session snapshots. The client persists those records and removes the accepted outbox entry atomically, merging by version so an old replay cannot replace a newer cached record. Receipts without snapshots retain a compatible fallback. A read/write generation guard rejects stale workspace/report reads. HTTP parsing preserves error status; Auth verification failures exposed by the SDK as internal/network errors produce retryable 503 responses; invalid/revoked token/account errors remain 401. All forms retain uncertain request identity while open. A failed post-confirmation refresh does not change a successful write into a failed save.

The API and frontend default to local emulators. An explicit review mode targets Firebase project `theatre-tracker-2f2e5`; its Node 24 container uses platform credentials, an injected port and approved HTTPS frontend origins. A separate review PWA strips local login fixtures and requires the deployed API URL. See [deployment](deployment.md). Cloud Build produced the deployed container, and real Firebase Auth/API/Firestore checks passed. Physical-phone checks remain outstanding. The following target architecture includes future controls such as MFA, scheduled jobs, backups and CI/CD that are not implemented.

## Target stack and production additions

| Area | Recommendation | Purpose |
| --- | --- | --- |
| Client | React + TypeScript + Vite | One responsive application, building on the artifact's React concepts with a normal build and typed modules. |
| Installation | Web app manifest + a narrowly scoped service worker | Install on supported desktop/phone browsers; cache static application assets only. |
| UI | Plain CSS, native forms/dialogs and Lucide (implemented) | Responsive light theme; expand accessibility validation during pilot preparation. |
| Navigation/data | Custom React workspace hook (implemented) | Encrypted working sets, polling, mutation status and replay; routed URLs and server pagination can follow. |
| Forms/validation | Native forms + Zod (implemented) | Shared input contracts with server validation as the authority. |
| Charts | Recharts | Backlog, throughput, waiting-time, and theatre-use charts. |
| Staff identity | Firebase Authentication with Identity Platform | Invited staff accounts, verified email, account recovery, and TOTP MFA. |
| Backend | Node.js + TypeScript + Fastify on Cloud Run | One API enforcing hospital access, clinical transitions, booking rules, and audit logging. |
| Operational database | Cloud Firestore Standard edition, regional `africa-south1` (deployed) | Hospital-scoped operational records, transactions, and indexed queries. The review database edition and location were verified; retain the same emulator model. |
| Web hosting | Classic Firebase Hosting | Serve only the static app bundle over HTTPS. |
| Background processing | Scheduled Cloud Run job / authenticated scheduled endpoint | Build daily reporting snapshots and perform reconciliation with idempotent processing. Verify scheduler/location settings during setup. |
| Documents | Private Cloud Storage bucket when required | Add only when the pilot needs uploads or durable generated exports; keep patient files out of the public web host. |
| Operations | Secret Manager, Cloud Logging/Monitoring, backups and budget alerts | Manage secrets, operational errors, recovery, and costs. |
| Verification | Vitest + Firebase emulators + Playwright | Domain calculations, API/tenant/concurrency integration tests, and desktop/phone journeys. |
| Delivery | GitHub Actions with workload identity federation | Check/build on changes; separate staging and production releases without stored service-account keys. |

Installed versions are pinned by package-lock.json; the local emulator launcher pins Firebase CLI 15.32.1. Keep dependency updates deliberate and re-run the verification suite.

React's current guidance favours frameworks for many new apps, but also describes building from a tool such as Vite when requirements justify the tradeoff. Here the product is an authenticated operational client with an explicit regional API and no current server-rendering/SEO requirement. Routing and data-loading choices are made explicitly above. [React guidance](https://react.dev/learn/creating-a-react-app), [Vite documentation](https://vite.dev/guide/).

## Service boundaries

1. Firebase Hosting supplies public static application assets to the PWA.
2. Staff sign in through Firebase Authentication. The app receives identity tokens; patient details never become Authentication profile attributes.
3. The PWA calls the regional Cloud Run API directly over HTTPS with its identity token. Restrict CORS to approved app origins; CORS does not replace authentication.
4. The API verifies identity/session validity and active server-held hospital/department membership, validates input, then runs a domain operation.
5. The operation reads/writes Firestore and records its audit event. The API returns only fields the caller may see. Aggregate report endpoints build their own redacted response and never reuse a patient-bearing workspace response.
6. Background work will eventually read scoped operational events and produce dated aggregate snapshots. Current local aggregate reports calculate bounded cohorts on request and expose their server calculation time.

Use a separate API URL initially; do not assume Firebase Hosting rewrites support the chosen region. No patient-bearing responses pass through static Hosting caches. API responses use `Cache-Control: no-store` and are excluded from service-worker caches.

All server patient reads and writes go through the API. Offline work uses a previously authorised encrypted subset and pending operations; it becomes shared state only on API acceptance. This gives one enforcement point for access, redaction, and access auditing. Client Firestore access is denied by default. Server Firestore libraries bypass Security Rules, so API authorisation and service-account IAM are essential, and must be tested independently. [Firestore server-library behaviour](https://firebase.google.com/docs/firestore/security/rules-conditions).

Start with refresh after writes, refresh on focus, and short bounded polling for active lists. Label stale data. Firestore's realtime capability does not automatically provide audited API subscriptions; introduce scoped API streaming only when workflow feedback requires it.

## Database choice and its tradeoffs

Recommend Firestore for this first iteration because it fits the selected Firebase platform and the bounded hospital/case/list workflows, without operating a continuously running SQL instance. Keep business rules in domain services and isolate database access behind repository interfaces.

The domain is relational: patients have cases, cases have bookings, sessions have capacity, and reports join activity over time. Firestore therefore requires explicit reference validation, some denormalised display fields, deliberate compound indexes, transactional uniqueness checks, and reporting snapshots. It is not a substitute for relational constraints.

Before admitting live data, prove atomic booking/conflict handling and representative report queries with synthetic pilot-scale data. PostgreSQL on Cloud SQL behind the same API is a valid alternative if complex scheduling constraints or ad hoc relational reporting become the dominant requirement. Changing databases would still be a migration project; repository interfaces do not make it automatic.

Firebase SQL Connect (formerly Data Connect) is a relational option, but its currently documented service regions omit Johannesburg. Its location must match its Cloud SQL instance. It is therefore not the default for a South Africa clinical-data location preference. Recheck availability before provisioning. [SQL Connect locations](https://firebase.google.com/docs/sql-connect/manage-services-and-databases).

Do not deploy both Firestore and PostgreSQL in the first release. Use an event/snapshot model for operational reporting; assess a reporting warehouse later from actual query and volume needs.

## Logical records

These describe the full target domain. The local subset and actual collection paths are listed above; import jobs, separate versioned policies, activity streams and daily snapshots are not implemented yet. Cloud indexes still need query/volume review.

| Record | Responsibility |
| --- | --- |
| Hospital | Tenant identity, province/district, timezone, operating settings. |
| Department | Specialty, hospital relationship, clinical policy references. |
| Staff profile and membership | Auth UID, active status, hospital/department grants and role capabilities. |
| Patient | Hospital-local identity, date of birth, recorded gender value and minimum necessary contact details. |
| Surgical case | Patient reference, procedure, optional pre-procedure diagnosis and WHO ICD-10 coding (`icd-10-who` plus a format-validated code, ready for a later catalogue display), list-entry date, current priority/readiness, effective-dated priority history, lifecycle, responsible team, version. Entries created before the diagnosis field omit it. |
| Priority policy and change event | Versioned targets and accountable reassessments; preserve historical values. |
| Theatre and session | Resource identity, planned staffed window, publication/capacity baseline, team, status. |
| Booking / operative attempt | Case/session link, ordered position, estimated slot, actual timings, cancellation/completion details. |
| Case activity | Transfers, holds, lifecycle changes, corrections, outcomes, provenance. |
| Audit event | Access/action, actor, scope, affected opaque IDs, changes/reason as appropriate, server timestamp. |
| Import job and row result | Idempotency, row validation, created/rejected/skipped records, provenance. |
| Daily metric snapshot | Scoped counts/distributions, reporting date, definition version, completeness, computed-at timestamp. |

Tenant-owned records belong under an explicit hospital boundary. Never use a browser-supplied hospital ID as proof of authority. Verify all references belong to the authorised hospital, and check department membership as well.

Initial deployment proposal: one Firebase/GCP project per environment, with multiple hospital tenants in the production database. Isolation is enforced by the API and tested with separate hospital fixtures. A hospital requiring a dedicated project/database is a deployment requirement to resolve before its onboarding; a tenant ID alone is not physical infrastructure isolation.

Patient references are unique within a hospital; case IDs are independent. The same person attending another hospital is a separate local patient identity until a deliberate transfer/matching design exists. Department access to patient details is mediated by an authorised case, not simply by knowing the patient ID. A demographic correction is version checked and requires access to every department with a related case so it cannot alter a patient record visible through an unauthorised department.

Avoid unbounded arrays of cases, bookings, members, or history on a hospital/department record. Use separate records and paginated queries. Protect report data too: small aggregates can identify individuals, so broader reporting will require aggregation/disclosure rules.

Define indexed query patterns before implementation. Start patient lookup with exact hospital-reference matching and bounded normalised name-prefix search; arbitrary full-text search is a separate capability. Do not fetch the entire hospital backlog into the browser to implement search, sorting, or report calculations.

## Domain correctness and concurrency

- Store server timestamps in UTC. Use `Africa/Johannesburg` for calendar-day waiting calculations, sessions, reporting cutoffs, and displayed local time. Treat birth dates as date-only values; listing/assessment timestamps preserve hour precision for priority calculations.
- Use a version on mutable records; reject stale updates and show a comparison/refetch path.
- Write case transitions, booking changes, and audit entries together in a transaction. Side effects after commit use an outbox/idempotent job pattern where needed.
- For booking conflicts, contend on shared resource/date guard records and a per-case active-booking record inside the same transaction. An overlap query followed by an independent insert is insufficient.
- Session creation checks the hospital-wide date under the shared guard: either the same theatre or the same responsible surgeon blocks overlapping staffed windows, even when no patients are booked. Department-scoped workspace responses do not include other departments' sessions. Conflict errors identify only the requested matching resource and its reserved SAST date/time, naming the department only within the actor's current grants; they do not expose session IDs, other staff or patient details.
- For a booking, accept the operating-time estimate and selected session rather than a client-chosen start. Inside the guarded transaction, calculate the earliest gap that fits operating time plus turnover, persist both duration components on the booking attempt, and reject the request if capacity changed.
- Guard theatre and surgeon/team allocations consistently across departments within a hospital. Cross-hospital staff scheduling is outside the first release; do not imply it is checked.
- For duplicate patient references, use an atomic hospital-scoped reference registry. Do not use names as a unique key.
- Apply request/import idempotency keys, including to retries after a network timeout. Persist the result so callers can distinguish already-committed work.
- Validate all state transitions on the server. A user cannot mark an operation completed by sending an arbitrary status patch without the required activity data.
- Keep audit events append-only through application permissions. This is not a claim of tamper-proof storage against infrastructure administrators; use restricted IAM, access logs, backups, and an agreed retention policy.
- Compute medians/P90 from the correct cohort on the backend or reporting job, not from the currently visible page. Keep numeric durations, source events, and definition versions.

Firestore transactions support serialisable execution; conflict behaviour still depends on correctly identifying shared records and implementing retries. Integration tests must exercise genuine concurrent requests. [Firestore transaction behaviour](https://firebase.google.com/docs/firestore/transaction-data-contention).

## Data location and access

- Prefer `africa-south1` (Johannesburg) for clinical storage and the API. Both Firestore and Cloud Run list this region. Confirm edition-specific availability, backups, logs, secrets, and optional storage placement when setting up resources. [Firestore locations](https://firebase.google.com/docs/firestore/locations), [Cloud Run locations](https://docs.cloud.google.com/run/docs/locations).
- Classic Firebase Hosting distributes static assets globally. Keep patient content out of those assets and its CDN. [Firebase Hosting](https://firebase.google.com/docs/hosting).
- Firebase App Hosting currently lists primary regions outside South Africa. The static PWA plus regional API design avoids relying on it for patient processing. [App Hosting locations](https://firebase.google.com/docs/app-hosting/about-app-hosting#app-hosting-locations).
- Firebase Authentication operates in US data centres. Staff account information is therefore a separate cross-border processing consideration. Minimise it, keep patient records out of Auth, and obtain hospital review of the processing arrangement. This architecture does not promise that all Google service data stays in South Africa. [Firebase processing locations](https://firebase.google.com/support/privacy#data_storage_and_processing_locations).
- TOTP MFA requires Firebase Authentication with Identity Platform; include that upgrade in production planning. [Firebase TOTP MFA](https://firebase.google.com/docs/auth/web/totp-mfa).
- Use verified invitations rather than public access grants. Provisioning an identity alone never grants hospital access. Check current membership on API calls so role removal takes effect without waiting for a stale client claim.
- Use Firebase local session persistence and a three-day activity-based expiry, as Dylan confirmed on 6 October. A separate IndexedDB session row holds a non-extractable CryptoKey and identity/activity metadata for automatic encrypted-workspace restoration; passwords and raw key bytes are not stored. Explicit logout closes the write gate, deletes that account’s local vault/key/unsynced work, signs out of Firebase and releases the tab lock. Automatic expiry removes remembered access and retains encrypted work. Plaintext patient data stays out of localStorage and general caches.
- Add App Check and request throttling to the public API as abuse controls; membership checks remain the authorisation mechanism. Test attestation on the pilot's browsers/network.
- Exclude clinical request bodies and patient search values from ordinary logs. Keep clinical audit details in the protected audit store. Use opaque resource IDs and scrub errors.

POPIA covers health information and imposes conditions on cross-border transfers; it does not impose a universal rule that every service must be hosted in South Africa. Regional clinical storage is a proposed design preference, subject to hospital policy and an appropriate processing agreement. [POPIA sections 26–32 and 72](https://www.gov.za/sites/default/files/gcis_document/201409/3706726-11act4of2013protectionofpersonalinforcorrect.pdf).

## PWA behaviour and design foundation

Desktop: persistent hospital/department context, dense filterable lists, day/week theatre planning, and reports. Phone: patient search, short registration/update forms, case details, and today's theatre list. Avoid fitting a desktop table onto a phone as the only workflow.

Offline recording and later sync are required in v1. Use Dexie/IndexedDB, Web Crypto and explicit API replay for a per-user encrypted working set/outbox. The service worker caches static assets only. Show saved locally, syncing, synced and needs-review states. First sign-in and shared booking confirmation require connectivity. See [offline contract](offline.md); the original online-only proposal is superseded.

Proposed colour tokens:

| Use | Colour |
| --- | --- |
| Page background | `#F4F8FB` — very light blue-grey |
| Cards/forms | `#FFFFFF` — white |
| Primary actions | `#176B9A` — healthcare blue |
| Selected/soft blue background | `#E4F2FA` |
| Borders/dividers | `#CBD5E1` — silver-grey |
| Main text | `#172B3A` — dark blue-grey |
| Secondary text | `#526475` |
| Decorative gold | `#B58B3A`, with pale `#FBF4E5` backgrounds |

Gold is a restrained brand accent; do not use it for small body text on white. Define danger, warning, and success separately with text/icons, so urgency is never conveyed through colour alone. Check contrast in actual components, support keyboard/focus states, and use generous touch targets. Self-host fonts and compile all frontend dependencies into the application bundle.

## Future module layout option

```text
apps/web/          # Responsive React PWA
apps/api/          # Fastify API and background job entry points
packages/domain/   # Case transitions, priority policy, scheduling and metrics
packages/contracts/# Validated API inputs/outputs and shared types
firebase/          # Rules, indexes and emulator configuration
tests/             # Integration and end-to-end scenarios
docs/              # Requirements and architecture decisions
```

The local implementation currently uses one npm package and a shared domain directory. Split into workspaces only when it helps module ownership. Keep one backend deployment with clear modules for access, patients, cases, scheduling, imports, audit, and reporting. Separate microservices are unnecessary for the pilot.

## Delivery sequence

| Stage | Deliverable | Exit condition |
| --- | --- | --- |
| 0. Clinical alignment | Review these requirements with Leo; identify the pilot and confirm clock/priority/utilisation definitions. | Agreed terminology and synthetic example cases. |
| 1. Foundation | Workspace, light UI shell, Auth/emulators, two synthetic hospitals, membership enforcement, audit, API contracts and durable offline capture/replay. | Isolation and revocation tests pass; desktop and phone navigation work. |
| 2. Backlog | Patient/case registration, search, priority/readiness changes, history, and CSV import. | Clinician can maintain a persistent department backlog with accountable changes. |
| 3. Theatre planning | Sessions, bookings, capacity display, cancellations, timings, and completion. | Concurrent conflicts are blocked and the end-to-end treatment loop works. |
| 4. Reporting | Defined metrics, history snapshots, authorised exports, and completeness indicators. | Numbers reconcile against a known synthetic event ledger. |
| 5. Pilot readiness | Staging review with Leo, backup/restore, MFA, operational ownership, budget monitoring, and controlled live rollout. | Requirements acceptance criteria pass and the hospital authorises real-data use. |

Detailed estimates follow pilot volumes and the clinical answers; avoid committing to a calendar from the artifact alone. Foundations and synthetic-data implementation can progress while clinical policies remain visibly unconfigured.

Plan for billed cloud services rather than assuming a free production deployment. Estimate monthly usage from staff, cases, polling, imports, snapshots, storage, and backups. Cap instance counts and query page sizes, and configure budget alerts; budget alerts are not spending caps. A regional database design also needs an agreed recovery plan for a regional outage.
