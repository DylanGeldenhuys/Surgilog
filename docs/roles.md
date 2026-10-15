# Roles and permissions

Updated 6 October 2026. Dylan supplied this hierarchy after discussing it with Leo and explicitly confirmed that **write admins also have clinical powers** within their scope. This supersedes the artifact’s older hospital-admin/scheduler/department-head model. Implemented, tested locally and against the deployed API, and published to the fictional-data review on 6 October 2026.

| Role | Scope | Read patients and reports | Clinical decisions, booking/cancellation | Register/edit patients, notes, surgery start/end | Staff management | Hospital setup |
| --- | --- | --- | --- | --- | --- | --- |
| Super User | Every hospital/department, including future additions | Yes | Yes | Yes | Every level, including Super Users | Add hospitals, departments and theatres |
| Major User — write | Explicitly assigned hospitals/departments | Yes | Yes | Yes | Major Users and lower roles within own scope | Add departments/theatres in assigned hospitals |
| Major User — read only | Explicitly assigned hospitals/departments | Yes | No | No | View scoped staff only | View only |
| System Admin — write | One hospital, all current/future departments | Yes | Yes | Yes | System Admins, doctors, nurses and clerks in that hospital | Add departments/theatres |
| System Admin — read only | One hospital, all current/future departments | Yes | No | No | View scoped staff only | View only |
| Doctor | Assigned departments | Yes | Yes | Yes | Add/manage doctors, nurses and clerks in own departments | No |
| Nurse / Clerk | Assigned departments | Yes | No | Yes | No | No |

Nurses/clerks cannot change existing priority, approve readiness, place/release clinical holds, create theatre sessions, book surgery or cancel bookings. They can correct patient demographics and case notes and record theatre entry/completion. For new registration, the current implementation lets them **transcribe a doctor-assigned priority**, explicitly choosing the band and naming the assigning doctor. Readiness starts at Needs assessment. That initial-priority approach was proposed to Dylan; his confirmation is still pending. Do not call it a clinically approved transcription protocol.

Read-only Major/System Admin roles may see patient details inside their assigned scope. The existing geographic reporting viewers remain separate **aggregate-only** roles: global, regional, country, province/state and district. They never gain patient-level access or administration from a reporting grant.

## Scope and delegation rules

- `Profile.superUser` is the explicit global grant, editable only by a Super User through the trusted API. A client-supplied membership named `super_user` never creates global access.
- Other roles use one membership per hospital with explicit department IDs. Major roles may select specific departments or `['*']` for all current/future departments. System Admin must use `['*']` and is restricted to one hospital per account. Doctor/Nurse/Clerk grants always use explicit departments.
- Every request resolves current hospital metadata and grants on the server. The UI receives the expanded hospital/department scope. Adding a department does not silently extend ordinary department grants. A limited Major User receives access to a department they create; broader all-department grants expand automatically.
- A manager cannot grant a higher role or wider scope than their own. Future-department access can only be delegated by an actor who already has that scope. A doctor cannot promote a colleague to hospital admin or touch an existing wider grant. Self-permission changes require another authorised administrator.
- Staff edits affect only the named hospital grants and preserve unrelated access. Expected profile versions reject stale edits. Removing the final hospital grant removes application access; it does not delete the person’s Auth account or historical activity. Global account suspension and department-by-department mixed roles within the same hospital are not implemented.
- Admin changes are online-only, transactionally audited and idempotent. Replays recheck current authority. Clinical/offline operations also recheck the current role before accepting a replay.

## Admin tab and account setup

The Admin tab appears for Super/Major/System Admin roles and doctors. Read-only roles see configuration and scoped staff without mutation buttons. Doctors see staff management for their departments, with no Add hospital/department/theatre actions. Nurses and clerks have no Admin tab and receive 403 from its API.

Admins can create a new Firebase Auth identity and application profile, add hospital access to an existing account, edit an allowed grant or remove it. A new identity receives a one-time password setup link in the creating admin’s browser; links/passwords are never placed in audit records or receipts. Existing accounts never expose password reset links to another user. Retry after an uncertain response uses the same request ID. Auth and Firestore cannot share a transaction: the server reserves the request, creates the identity with an unknown random password, then rechecks authority before committing the profile. An interrupted Auth-only account has no app access; the same request can resume. Sign-in also offers the individual a Set or reset password action. No invitation email is sent automatically.

Hospital configuration supports adding departments and named theatres. A newly granted Doctor is added to the hospital’s surgeon options. Theatre operating hours/24-hour availability, recurring session rules, bulk staff management, MFA and archived/deleted configuration remain future work.

## Local testing and compatibility

`npm run migrate:admin-roles` upgrades only the known synthetic emulator fixtures and adds Super User, Major read/write and System Admin read/write accounts without changing patient records. A completion marker makes repeat runs preserve subsequent staff edits. `npm run dev` runs this guarded migration after ordinary seeding. All these accounts use the documented emulator-only password.

Legacy `clinician` is recognised as Doctor, `recorder` as the nurse/clerk capability set; legacy `admin` and `viewer` are not promoted. The former `coordinator` no longer has booking/cancellation authority. Existing aggregate geographic grants are preserved. The local scheduler fixture is now read-only System Admin.

Server tests cover tenant/department isolation, read-only denial, clinical write-admin powers, nurse/clerk restrictions, out-of-scope/higher-role assignment, self-edit rejection, stale grants, duplicate creation, idempotency, password-link isolation and permission revocation before replay. See [verification](verification.md).
