# Leo's review deployment

Updated 20 October 2026. **Published with fictional data, including the Admin tab and confirmed role hierarchy. Theatre register, reporting and turnaround settings are now published.**

- Website: https://theatre-tracker-2f2e5.web.app
- API: https://theatre-tracker-api-54783611706.africa-south1.run.app
- Project: `theatre-tracker-2f2e5`; owner account: `dylangeldenhuys1@gmail.com`.
- API revision: `theatre-tracker-api-00006-seh`, ready with 100% traffic.
- Hosting version: `bc6c85fa1661e594`, released 20 October 2026 at 07:09:37 SAST.
- Cloud Build: `9db07c3d-3144-4103-9e1d-8f8e1da1dbdb`.
- Firestore ruleset: `c20c7b24-ee5c-44cc-a463-521eb8529e87`.

Dylan completed owner sign-in and explicitly approved the API/IAM plan in [review-infrastructure.md](review-infrastructure.md). Email/Password Auth, Firestore rules/indexes, backend and Hosting are deployed. Fictional setup installed 659 documents across two hospitals and three departments. **One explicitly requested permanent Super User was created and verified on 9 October; other reviewer accounts remain deferred.** There is no shared hosted demo account; the local emulator credentials do not work on this website. No email has been sent to Leo.

## Supplied logo and typography release — 20 October 2026

Dylan requested the supplied logo/name image, push to `main` and Firebase release. Source **ebec09a** on `main` includes the complete artwork, new S/check favicon/install icons, Exo 2 heading/numeral fonts and DM Sans body text. Hosted version **bc6c85fa1661e594** contains bundle **index-DLmP0lIE.js** and CSS **index-BJoCunAj.css**. Live HTML/JS/CSS, supplied image, icon/font bytes, manifest, service worker and security/cache headers match the prepared build. The preceding Hosting version is **80a0e416d643e631**.

This was a Hosting-only release. The API revision, Auth, Firestore, account data and IAM were unchanged. Existing install icons can update on the browser/OS's own schedule. [Update SurgiLog](https://theatre-tracker-2f2e5.web.app/api/app-update.html) refreshes cached website assets while retaining saved work; save open forms first.

## Browser follow-up patch — 16 October 2026

Published frontend-only fixes for sign-in waiting on optional storage permission and unreachable navigation/logout on short screens. Hosting **80a0e416d643e631**, bundle **index-MKrKENiU.js**, CSS **index-vB2VRVdc.css**; live files and headers match the build. 84 unit tests, builds/typecheck/formatting and targeted WebKit/Chromium/Firefox checks pass. API, Firestore, accounts and IAM were unchanged. The immediately previous Hosting version is **eec873a2dac0b3a7**. See [verification](verification.md) and [pending physical-phone/clinical checks](review-acceptance.md).

## Theatre release — independently verified 16 October 2026

Dylan asked Claude to complete publication after the initial deployment work, then asked Codex to double-check it. No new source changes or redeployment were necessary during this verification. At that verification, Hosting was `eec873a2dac0b3a7`. The API revision above had 100% traffic, and the hosted HTML/JS/CSS, manifest, service worker and update page match the prepared build from commit `2bc5d98`. The live Hosting version was read back from Firebase. API health is review mode for the expected project with `admin-v1` and `theatre-register-v1`; the release guard passes.

All five new indexes and the existing history index were independently confirmed READY: `CICAgJiUpoMK` / `CICAgJim14AK` (register date DESC/ASC), `CICAgJjF9oIK` (booking entry), `CICAgJj7z4EK` (booking planned start), `CICAgJiUpoMJ` (session start), and `CICAgOjXh4EK` (case history). Existing runtime identity, service-level maximum of two instances, origins and review configuration were preserved. No extra IAM/rules changes were needed.

Live checks passed real sign-in, tenant/department isolation, malformed query denial, authoritative patient/note writes, idempotent replay, session/booking confirmation, newest-100 indexed history, register Draft/Verified workflow, stale-version rejection, aggregate reporting with known capacity/occupancy, no patient data in report responses, write-admin turnaround changes and read-only mutation denial. A previously booked 15-minute allowance survived setting the synthetic hospital to 30. See [verification](verification.md) for browser evidence and cleanup.

## Earlier partial release (historical)

On 15 October the hardening API/index were deployed while Hosting remained the branding release. That pause was superseded by the theatre publication above; both the hardening frontend and theatre features are now live. The previous rollback targets are API revision `theatre-tracker-api-00004-2hm` and Hosting version `e4e2c9dee7b5db86`. Git baseline `147acf7` / `checkpoint/pre-theatre-register` remains intact. Code/data rollback are distinct; preserve pending device work and use an explicit release rollback if needed.

## Actual infrastructure

The five additive theatre indexes are deployed and READY. Future releases must preserve index → API → frontend compatibility checks; live health now satisfies the Hosting capability guard. Production-scale hospital workloads remain unverified.

Classic Firebase Hosting serves the React/Vite PWA. The existing Fastify API runs on Cloud Run in `africa-south1` (Johannesburg), alongside the verified Firestore Standard `(default)` database. The API uses the dedicated `theatre-tracker-api` identity with `roles/datastore.user`, `roles/firebaseauth.viewer` and the project custom role `theatreTrackerUserProvisioner` (`firebaseauth.users.create`, `firebaseauth.users.sendEmail`). Source builds use `theatre-tracker-build` with `roles/run.builder`. Both identities belong only to this project; no service-account key was downloaded.

Cloud Run has 1 vCPU, 512 MiB memory, concurrency 20, a 30-second request timeout, request-based CPU allocation and zero minimum/two maximum instances. Browser ingress is public; every application-data endpoint requires a valid Firebase token and current profile permissions. Only the two Firebase Hosting origins receive CORS access. API data responses use no-store; direct client Firestore access is denied. Health exposes project/mode/readiness and the `admin-v1` / `theatre-register-v1` release capabilities. The frontend calls the API directly because Hosting's supported Cloud Run rewrite locations do not include Johannesburg.

The four approved APIs (Cloud Run, Cloud Build, Artifact Registry and IAM) are enabled. Billing is linked. The deployment created the regional build storage and artifact repository. Scaling limits are not a spending cap; a budget alert amount has not been verified. Analytics is not initialised. This release is for fictional review, not real hospital data.

## Repeat deployment

Local development still defaults to the demo emulators. `shared/runtime-config.ts` rejects emulator endpoints in review mode. The source upload allowlist includes only Dockerfile, package files, API and shared modules. The container uses Node 24, native TypeScript and a non-root user with platform credentials.

Use the Cloud Run command in [review-infrastructure.md](review-infrastructure.md) when backend code changes. Sign in to the selected owner account again if its Google Cloud login has expired or been revoked. Read the current leaf help before constructing new gcloud commands. Do not repeat API enablement or grant extra permissions without checking actual requirements.

Then build and publish the client against the real API:

```sh
npm run build:review -- --api-url https://theatre-tracker-api-54783611706.africa-south1.run.app
```

```sh
npx -y firebase-tools@latest deploy --only hosting --config firebase.review.json --project theatre-tracker-2f2e5 --account dylangeldenhuys1@gmail.com --non-interactive
```

The separate `dist-review` verifier checks project/endpoint and absence of local demo credentials/endpoints. Hosting's predeploy check requires the live API to report review mode and the expected project. `.firebaserc` retains the local default; always specify the cloud project explicitly. Deployment is currently manual, not linked to local file saves or Git pushes.

## Additional reviewer provisioning (deferred)

Once Dylan supplies a reviewer's email, create that individual's Email/Password account privately in Firebase Authentication, then run:

```sh
npm run setup:review -- --project theatre-tracker-2f2e5 --account dylangeldenhuys1@gmail.com --reviewer LEO_EMAIL --name 'Leo'
```

The existing script gives clinician access to both fictional hospitals and their fixture departments, refuses existing-profile overwrites and creates no shared login accounts. The new role/admin work requested after deployment will update this process; check current role documentation before using it. Passwords and tokens must stay out of chat/Git.

Fictional seeding is already complete. Repeating `setup:review --seed-fictional` preserves reviewer edits after a completed setup; partial or nonempty unknown databases stop for inspection. The local admin helper obtains an in-memory short-lived token from the explicitly selected gcloud account. It supplies the explicit quota project for Auth and an OAuth2 client directly to the Firestore server SDK; cloud runtime credentials are separate.

## Local credential containment

An initial SDK setup error included a short-lived owner gcloud access token in tool output. Quota-project handling and error sanitisation were corrected. After temporary cloud cleanup, Google OAuth revocation returned HTTP 200 and the same token was rejected with HTTP 401. No service-account key was created. Future gcloud deployment/admin work requires owner sign-in again; the deployed service uses its own identity and is unaffected.

## Initial deployment verification (historical)

Typecheck/formatting, 33 unit/storage/sync/config/fixture tests, 14 emulator integration scenarios and both builds passed. Cloud Build built the real container successfully. Live API tests used temporary clinician/recorder/viewer accounts and an isolated temporary hospital: real email/password login; runtime Auth/Firestore permissions; tenant/department/clinical-role isolation; registration and audited idempotent replay; stale-version rejection; simultaneous bookings with exactly one winner; theatre entry/completion; aggregate redaction; direct Firestore denial; disabled-user rejection. Temporary accounts, their profiles and all temporary hospital records were removed after testing.

Chromium verified the live sign-in and authenticated Overview/backlog/case-note form. At the initial deployment, the hosted offline/reconnect check was interrupted when the browser closed. It subsequently passed on 16 October, as recorded above. The local production PWA's offline reload, encrypted persistence, automatic replay and 390px layout were verified in prior milestones. Physical phones, Safari/Firefox, real reviewer login and full hospital acceptance remain outstanding. See [verification](verification.md). The client bundle advisory remains.

## References checked

- [Firebase web project and app setup](https://firebase.google.com/docs/web/setup)
- [Firebase Email/Password setup](https://firebase.google.com/docs/auth/web/password-auth)
- [Firestore setup and Production mode](https://firebase.google.com/docs/firestore/quickstart-server)
- [Firestore locations and immutable location setting](https://firebase.google.com/docs/firestore/locations)
- [Firebase pricing plans and billing alerts](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Firebase Hosting](https://firebase.google.com/docs/hosting)
- [Cloud Run locations](https://docs.cloud.google.com/run/docs/locations)
- [Hosting/Cloud Run supported rewrite regions](https://firebase.google.com/docs/hosting/cloud-run)

## Firebase development tools (5 October 2026)

Installed and verified the official `firebase@firebase` Codex plugin, version 1.1.0, enabled from the `firebase/agent-skills` Git marketplace. The upstream snapshot is `de359da26586e4fad59b7ebab7592aa137c49b8a`. Five existing standalone Firebase skills were updated; five already matched. Previous versions are backed up outside this repository under `~/.codex/skill-backups/`. Plugin tools load on a new session; a full client restart may be needed for the new marketplace. Installing the plugin does not grant Google project access.

The app already uses `signInWithEmailAndPassword`, Firebase ID tokens and server-side profile/membership enforcement. Local emulator authentication was tested in the preceding milestone. The Auth provider configuration has now been deployed and verified through the project configuration API. Follow the [official Firebase email/password guide](https://firebase.google.com/docs/auth/web/password-auth) and [Firebase skills installation guide](https://firebase.google.com/docs/ai-assistance/agent-skills).


## Admin release — 6 October 2026

Dylan approved the two additional Auth permissions and publication. Owner login worked; the exact project custom role and binding were applied and read back. The updated API was deployed first, then the matching Hosting build. Its image is `sha256:dd73cfeae5076f1ac9749df7d7b69310a4105d09b78564937a49b1c5600a5166`. The Hosting predeploy guard requires `/health` to advertise `admin-v1`; it rejected the earlier backend and passed against this release. Runtime identity, ready revision, 100% traffic, resource settings and CORS origins were verified.

All seven Admin integration scenario groups passed against the deployed API using isolated fictional hospitals and temporary accounts. The runtime itself created a new Auth identity and private password setup link; the link successfully set its password and that new user signed in and received only its assigned department. Tests covered the role hierarchy, read-only restrictions, hospital/department boundaries, stale edits, idempotent replay, removal, clinical write-admin authority and revoked grants. Chromium verified the hosted update flow, sign-in and Admin at desktop and 390px width with no console errors or page overflow. The hosted index matches `dist-review` exactly. All temporary cloud accounts, hospitals and test audit/receipt records were cleaned up afterward; original fictional patients were preserved. See [verification](verification.md).

An explicitly chosen existing Firebase Auth account can be bootstrapped with `setup:review --reviewer EMAIL --name NAME --super-user`. This creates a new profile only and grants global application access; it does not change IAM or implicitly choose Dylan/Leo. Ordinary reviewer provisioning keeps the compatible `clinician` alias (displayed as Doctor). This remained deferred at the Admin release; the explicitly requested permanent Super User was provisioned on 9 October.


## Logout/session frontend release — 6 October 2026

Published Hosting version `d28fef824c95f260` after 40 automated tests, typecheck, formatting, both builds and local Chromium offline/expiry checks. The live index matches the prepared review build. The API and IAM were unchanged. Log out now clears the current account’s local vault/unsynced work and Firebase login; sessions otherwise persist across reload/browser restart for three days of inactivity. Automatic expiry retains encrypted work and removes remembered access. See [offline](offline.md) for the changed device-key persistence contract. Hosted Chromium verified real Firebase sign-in, reload and full browser restart restoration, desktop/390px Log out controls and offline logout. Read-back showed no remaining vault, remembered session or Firebase Auth user in the test browser; reload stayed signed out.

## Theatre-session correction — 6 October 2026

Published backend revision `theatre-tracker-api-00003-n4r` at 100% traffic (Cloud Build `42eb945e-7dd1-4013-8603-6fb8e5ed6e71`) and Hosting version `33c65610515d0a26`. The runtime identity is unchanged. The live health/project/compatibility guard passed, and fetched HTML exactly matches `dist-review/index.html` (main bundle `index-DYS1pjXs.js`). No IAM, rules, schema or seed changes were needed.

Create session now uses the schedule's selected date and follows the actual saved date. Existing hospital-wide theatre/surgeon reservation protection is preserved; errors explain the matching resource, date and hours, with department names restricted to current grants. Hosted Chromium verified a non-today date retained in the form, a real cross-department Theatre 2 conflict returned by the deployed API, and omission of the ungranted department/surgeon names. The longer error fits at 390px without page/dialog overflow. No cloud session was created by this check.

## Permanent Super User — 9 October 2026

Created the account explicitly named by Dylan, using his requested password and the existing trusted project-owner administration helper. An active global Super User profile and owner-provisioning audit were written together. Real password sign-in and read-back from the deployed identity/Admin endpoints passed, including all departments in both current hospitals. The global grant covers future hospitals/departments. No password, token or private setup link was written to repository files/audits, no invitation email was sent, and no frontend/backend deployment or infrastructure permission change was required. Other accounts remain deferred.

## SurgiLog branding — 13 October 2026

Published Hosting version `e4e2c9dee7b5db86` after both builds/typechecks, formatting and desktop/390px Chromium checks. The fetched live HTML matches the prepared release, and the live manifest/title/update page all use SurgiLog. The shared login/navigation wordmark and footer use the new name, with the supplied mark retained. Design guide/README/AGENTS now identify SurgiLog as the product. Existing Hosting URL, Firebase project, API revision, Auth accounts, data and device storage/lock identifiers are unchanged. No backend/IAM deployment was required.
