# SurgiLog

A first iteration of a surgical backlog and theatre tracker for South African hospitals. Built with Dylan (development) and Leo (clinical/product direction). The original Claude HTML artifact is preserved as a reference.

Brand, colour, typography and reusable visual guidance are documented in [design.md](design.md).

The new [theatre-register preview](docs/theatre-register.md) runs locally on `feature/theatre-register`: actual operation records, structured CSV preview, period reports/printing and an Admin setting for 15–30-minute turnaround. Published to the hosted fictional-data review on 16 October 2026. The working baseline is saved at `147acf7` / `checkpoint/pre-theatre-register`; see the preview guide for rollback.

The [hosted review](https://theatre-tracker-2f2e5.web.app) is published with fictional patients. Individual reviewer accounts are still pending; local demo accounts work only in the emulators. See [deployment status](docs/deployment.md).

## Run locally

Requires Node.js 22.12+ and Java 21. On this Mac, the launcher finds Homebrew's installed OpenJDK 21 automatically.

```sh
npm ci
npm run dev
```

This starts Firebase Authentication and Firestore emulators, seeds two fictional hospital workspaces, and starts the API and frontend. No Firebase login, cloud project, billing account, or real credentials are required.

- Development app with automatic refresh: http://127.0.0.1:5173
- Firebase Emulator UI: http://127.0.0.1:4000
- API health: http://127.0.0.1:8787/health

Use port 5173 while reviewing active development changes; Vite updates that page automatically. For installation and offline **page reloads**, leave `npm run dev` running and use the built PWA in another terminal:

```sh
npm run build
npm run preview
```

Open http://127.0.0.1:4173, sign in online, and visit the departments you want prepared offline. Use the browser's install option where supported. The development server on port 5173 does not install a service worker. These loopback URLs work on this computer; use the HTTPS hosted review for physical-phone access once an individual reviewer account is provisioned.

## Demo accounts

The login’s **Super User** shortcut opens the full local Admin section. All accounts below are emulator-only fixtures. The shared demo password is `TheatreDemo!26`.

| Email | Role / access |
| --- | --- |
| `super@demo.theatre.local` | Super User; all hospitals and full administration |
| `major@demo.theatre.local` | Major User write; both hospitals |
| `major-read@demo.theatre.local` | Major User read only; both hospitals |
| `hospital-admin@demo.theatre.local` | System Admin write; Groote Schuur |
| `hospital-read@demo.theatre.local` | System Admin read only; Groote Schuur |
| `leo@demo.theatre.local` | Doctor; both hospitals |
| `sister@demo.theatre.local` | Nurse; Groote Schuur |
| `clerk@demo.theatre.local` | Clerk; Groote Schuur |
| `scheduler@demo.theatre.local` | System Admin read only; Groote Schuur (retired scheduler fixture) |
| `reports@demo.theatre.local` | Aggregate reporting only; Groote Schuur |
| `doctor2@demo.theatre.local` | Doctor; Tygerberg only |
| `global@demo.theatre.local` | `global_viewer`; every configured hospital, aggregate only |
| `region@demo.theatre.local` | `regional_viewer`; Africa, aggregate only |
| `country@demo.theatre.local` | `country_viewer`; South Africa, aggregate only |
| `province@demo.theatre.local` | `state_viewer`; Western Cape, aggregate only |
| `district@demo.theatre.local` | `district_viewer`; City of Cape Town, aggregate only |

Use your account password and the single **Open workspace** button. The app refreshes the account online when possible and automatically opens the encrypted saved workspace during a connection outage. There is no separate offline mode, device passphrase, migration banner or old-workspace recovery form. Explicit Log out deletes that account’s local work, including unsynced entries; automatic inactivity expiry retains encrypted work for later sign-in. Only one workspace can be open per browser origin at a time.

For a stale port-4173 app screen, open [Update SurgiLog](http://127.0.0.1:4173/api/app-update.html) in the same browser and choose **Update and open app**. Continue in the page it opens. This unregisters the old service worker and removes replaceable static-app caches. It does not clear IndexedDB, account storage or encrypted saved work.

## Implemented

- Admin tab for hospital/department/theatre configuration, new users and scoped staff access changes. Super/Major/System Admin read/write roles and department Doctor/Nurse/Clerk permissions are documented in [roles](docs/roles.md). Published to the hosted fictional-data review on 6 October 2026; individual reviewer accounts remain deferred.

- Hospital/department access enforced by the API; client Firestore access denied.
- Artifact reporting roles enforced independently for global, region, country, province/state and district scopes. Overview lists every authorised hospital first, then ordinary single Hospital and Department selectors control detailed metrics. Reporting accounts receive no patient records or operational navigation.
- Separate patients, surgical cases, sessions and booking attempts.
- Patient and first-case registration, demographic corrections, case notes, local search/filtering, 10-case backlog pages, Leo-confirmed P1/P2/P3 treatment targets of 30/90/365 days, clinical priority/readiness review, holds, case history, and action alerts for overdue treatment or unrecorded surgery outcomes.
- Theatre sessions and bookings with clinician-entered operating estimates, fitting-session choices, automatic start assignment, configurable 15–30-minute turnaround (default 15), and concurrent capacity checks.
- Theatre entry/completion recorded by doctors, scrub sisters or clerks; cancellation requires a doctor/write admin and returns the case to waiting without resetting its clock.
- Separate actual theatre register, Draft/Verified workflow, direct recorded age without fabricated DOB, multiple procedures/team details, offline recording and historical CSV preview. Weekly/monthly/quarterly/April–March reports, activity breakdowns and aggregate printing are local preview additions.
- Actual-event completion charts, outstanding-case median/P90, overdue cases, cancellations and occupancy with timing completeness.
- CSV paste/validation for new waiting cases; P1 imports require an explicit assessment timestamp. Rows use the same permissions and replay checks as normal registration.
- Server-first connected updates, with an encrypted offline outbox, durable fallback saves, prompt ordered replay, idempotency, version conflicts, persistent three-day inactivity sessions, explicit logout and conflict review.
- Responsive light blue/white/grey/gold UI, bundled fonts, static-asset PWA cache and app-update notice.

## Check the implementation

With `npm run dev` running:

```sh
npm test
npm run test:integration
npm run test:admin
npm run test:theatre
npm run build
npm run format:check
npm audit
```

Domain tests cover deadlines, month boundaries and metric cohorts. Integration tests create and remove only their own synthetic fixtures and verify authentication, hospital/department/role isolation, demographic and case updates, patient duplication, hold/release clocks, concurrent booking, cancellation, completion, revocation, audit receipts and denied direct Firestore access. Browser verification is recorded in [docs/verification.md](docs/verification.md).

Stop local services with Ctrl+C and allow emulator export to finish. The next start imports `.emulator-data` when present. The first CLI run may download the Firebase tools and emulator binaries. Abruptly killing processes can lose emulator changes since the last export; this is a development environment.

## Current limits

This is a **synthetic-data v1**, available locally and as a hosted review in Firebase project `theatre-tracker-2f2e5`. It is not clinically approved for hospital use; see [deployment steps and status](docs/deployment.md). Cloud startup requires explicit review settings and refuses emulator endpoints. Prepared lists are capped at 250 cases; local pilot reporting rejects collections exceeding 1,000 records per department. Search covers prepared records. History currently returns at most 100 audit entries.

Automatic invitation email delivery/MFA, geographic role-management UI, mixed roles within one hospital, server-backed pagination beyond the prepared offline subset, patient-reference correction/merging/transfers, detailed procedure/delay/outcome forms, session amendments, audited exports, report snapshots, and operational backup/recovery are still to implement. Sessions persist across reload/browser restart and expire after three days of inactivity. Explicit Log out removes that account’s unsynced device work; automatic expiry retains it encrypted for a later sign-in. Foreground sync is required. Physical iOS/Android testing and hospital device/recovery policies remain outstanding.

## Continue in a fresh chat

Read [AGENTS.md](AGENTS.md) and [docs/handover.md](docs/handover.md) first. Detailed context: [requirements](docs/requirements.md), [architecture](docs/architecture.md), [priority policy](docs/clinical-priorities.md), and [offline behaviour](docs/offline.md).

## Code review

The [15 October 2026 review](docs/code-review-2026-10-15.md) records corrected defects, regression evidence, remaining production/clinical risks, and the new history index required before deployment. The hardening and theatre-extension API, indexes and frontend are now deployed; see [handover](docs/handover.md) for release status.
