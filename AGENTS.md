# SurgiLog

## Recover context

On a fresh chat or after context loss, read [docs/handover.md](docs/handover.md) and inspect the working tree. Read [requirements](docs/requirements.md), [architecture](docs/architecture.md), [priority policy](docs/clinical-priorities.md), and [offline design](docs/offline.md) as relevant to the task. Current user directions and confirmed decisions take precedence over older proposals.

For interface, brand, colour, typography, iconography or external design work, use [design.md](design.md) as the shared visual reference and keep it aligned with implemented styles.

## Product

- South African surgical backlog and theatre tracking. Dylan is the technical developer; Leo is the doctor/product collaborator. Leo's HTML artifact is the current product reference; his Claude conversation has not been supplied and is not a prerequisite to developing v1.
- Installable web app for desktop and phone. Support multiple hospital tenants from the start; pilot at one hospital, perhaps one department.
- Firebase/GCP backend. Approved navy/turquoise interface palette with white and pale-aqua surfaces, published 23 October 2026; retain semantic clinical colours and Manrope/DM Sans. See `design.md`.
- The product name is **SurgiLog** (confirmed 13 October 2026). Use the complete supplied image `public/SurgiLog Clinical Register Logo.png` for the logo/name/tagline (confirmed 19 October 2026), preserving its proportions and colours. The original theatre-team artwork in `docs/brand/` is historical. The favicon/install icons use the new S/check symbol. Do not recreate the wordmark as separate text. See `design.md`. Keep existing project, URL, storage and workspace-lock identifiers stable when changing display branding.
- Leo-confirmed priority bands: P1 up to 30 days, P2 31–90 days, P3 91–365 days. Calculate the treatment due time using the upper bound: 30, 90 or 365 elapsed days from the recorded urgency assessment time. There is one P1 band; the earlier provisional P1a/P1b split is retired. Never reuse the artifact's 200-day P1 threshold.
- Current roles are Super User; Major User read/write over assigned hospitals/departments; System Admin read/write for one hospital; Doctor; Nurse; Clerk. Dylan explicitly grants clinical powers to write admins within scope. Doctors manage department staff but not theatres. Nurses/clerks register and edit patient details, the optional pre-procedure diagnosis and notes, and log surgery start/end; they cannot change existing priority, book or cancel. See [roles](docs/roles.md).
- Offline recording and later sync are required for v1. The original online-only proposal is superseded.
- Preserve the artifact's full backlog fields: patient reference/name, DOB with age, gender, contact, procedure, surgeon, priority, readiness, wait and status. An optional pre-procedure diagnosis and WHO ICD-10 code are stored with the case; entries without them stay valid. Backlog trends show P1/P2/P3 over time from lifecycle events and effective-dated priority history, never invented historical values.
- Overview starts with a basic aggregate table for every server-authorised hospital, followed by ordinary single Hospital and Department selectors for detailed metrics. Performance uses the same single selected department. Aggregate API responses contain metrics and scope summaries only. Backlog and Theatre Planning always require one confirmed hospital and department before showing patient-level data.
- Artifact reporting roles `global_viewer`, `regional_viewer`, `country_viewer`, `state_viewer` and `district_viewer` use separate geographic grants, never operational memberships. Reporting-only accounts have no Backlog/Theatre navigation and cannot fetch a patient workspace. Hospital metadata carries region, country, province and district.

## Engineering rules

- Separate patients, cases, sessions, and booking/operative attempts. Scheduled cases remain outstanding; cancelling a booking does not close a case or reset its waiting clock.
- Theatre-register entries can represent historical/unplanned activity without a fake backlog case/booking or inferred DOB. Keep source age/sex separate from backlog demographics; nurses/clerks draft, clinical writers verify. See [theatre preview](docs/theatre-register.md) for metric definitions and limits. Configurable hospital turnaround is 15–30 minutes (default 15), snapshotted on new bookings; actual measured turnaround remains separate.
- Authorise hospital/department access on the server, including import/export and replayed offline operations. Only the explicitly confirmed write-admin and Doctor roles grant clinical powers; read admins and nurses/clerks do not.
- Use one account password for sign-in and offline unlock; the separate device-passphrase design is superseded. Dylan explicitly removed all pre-release passphrase banners/forms/recovery flows. Do not reintroduce them. Account login and normal offline recording remain. Dylan explicitly chose visible Log out that signs out of Firebase and deletes that account’s local vault, unsynced work and retained backups; preserve other accounts. Sessions persist across reload/browser restart and expire after three days of inactivity. Automatic expiry removes remembered access but retains encrypted pending work. The single-workspace tab guard remains until coordinated multi-tab writes are implemented.
- Keep offline data per user/hospital in an encrypted local store. Save durably before showing local success; only server acknowledgement means Synced. Use idempotency and explicit conflict review, not last-write-wins for clinical/scheduling data.
- Shared bookings need server confirmation. Do not promise immediate remote revocation while disconnected or browser storage that can never be lost.
- Calculate metrics from real recorded events; distinguish missing data. Preserve event time, recording time, and server receipt time.
- Use Africa/Johannesburg for local operations and UTC timestamps. P1 needs hour precision; define month arithmetic explicitly.
- Develop/test with synthetic patients. No credentials or real patient data in Git, ordinary logs, screenshots, or demos.
- Preserve the original HTML artifact unless asked to edit it. Its demo credentials, dates, metrics, and legal claims are not production specifications.
- Use relevant installed skills from the session catalog and primary sources for changing capabilities. Do not assume a Firebase project from unrelated machine credentials.
- Verify meaningful risks: tenant/role isolation, lifecycle changes, concurrent bookings, priority boundaries, metric cohorts, offline persistence/replay/conflicts. Use existing scripts; do not invent claims that checks passed.

## Maintain continuity

After a meaningful decision/milestone, update [docs/handover.md](docs/handover.md) with actual status, checks, limitations, and next work; update affected detailed docs so stale assumptions cannot survive. Keep this file short. Distinguish proposed, implemented, tested, deployed, and clinically approved work. Do not store private raw chats or patient records as memory.
