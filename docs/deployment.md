# Leo's review deployment

Updated 16 October 2026. **Published with fictional data, including the Admin tab and confirmed role hierarchy. Theatre-register preview remains local.**

- Website: https://theatre-tracker-2f2e5.web.app
- API: https://theatre-tracker-api-54783611706.africa-south1.run.app
- Project: `theatre-tracker-2f2e5`; owner account: `dylangeldenhuys1@gmail.com`.
- API revision: `theatre-tracker-api-00004-2hm`, ready with 100% traffic.
- Hosting version: `e4e2c9dee7b5db86` (SurgiLog branding).
- Cloud Build: `4451fab7-013c-49af-923e-61599059d155`.
- Firestore ruleset: `c20c7b24-ee5c-44cc-a463-521eb8529e87`.

Dylan completed owner sign-in and explicitly approved the API/IAM plan in [review-infrastructure.md](review-infrastructure.md). Email/Password Auth, Firestore rules/indexes, backend and Hosting are deployed. Fictional setup installed 659 documents across two hospitals and three departments. **One explicitly requested permanent Super User was created and verified on 9 October; other reviewer accounts remain deferred.** There is no shared hosted demo account; the local emulator credentials do not work on this website. No email has been sent to Leo.

## Hardening release partially deployed; paused by Dylan

On 15 October, deployed the additive `audit(caseId ASC, at DESC)` index (`CICAgOjXh4EK`) and confirmed READY. Built the API without live traffic, then switched 100% to revision `theatre-tracker-api-00004-2hm` after index readiness. Live health returned HTTP 200, review mode and the correct project.

Dylan then paused deployment to discuss the theatre-register extension. **Hosting remains the 13 October branding release above; the matching hardening frontend has not been published.** Full live authenticated/history/replay/booking checks were prepared but not run. The temporary synthetic test hospital/account/profile and all associated records/local credentials were cleaned up. Existing reviewer accounts/data, IAM and rules were unchanged. See [theatre proposal](theatre-register-proposal.md) and [handover](handover.md) before resuming; do not describe this as a fully verified hardening release.

## Actual infrastructure

The 16 October [theatre extension](theatre-register.md) has not changed this cloud release. Before publishing it, deploy and confirm READY the five additive indexes in `firebase/firestore.indexes.json`: `theatreEntries(departmentId ASC, operationDate DESC)` and the ASC-date variant; `bookings(departmentId ASC, inAt ASC)`; `bookings(departmentId ASC, start ASC)`; `sessions(departmentId ASC, start ASC)`. Then deploy/test the new API before Hosting. Local health advertises `admin-v1` and `theatre-register-v1`; the frontend predeploy guard now requires both, so it will intentionally reject the current older live API. No schema conversion, rule change or additional IAM was required for the local implementation. Live index readiness/workflows and scale remain unverified for the extension.

Classic Firebase Hosting serves the React/Vite PWA. The existing Fastify API runs on Cloud Run in `africa-south1` (Johannesburg), alongside the verified Firestore Standard `(default)` database. The API uses the dedicated `theatre-tracker-api` identity with `roles/datastore.user`, `roles/firebaseauth.viewer` and the project custom role `theatreTrackerUserProvisioner` (`firebaseauth.users.create`, `firebaseauth.users.sendEmail`). Source builds use `theatre-tracker-build` with `roles/run.builder`. Both identities belong only to this project; no service-account key was downloaded.

Cloud Run has 1 vCPU, 512 MiB memory, concurrency 20, a 30-second request timeout, request-based CPU allocation and zero minimum/two maximum instances. Browser ingress is public; every application-data endpoint requires a valid Firebase token and current profile permissions. Only the two Firebase Hosting origins receive CORS access. API data responses use no-store; direct client Firestore access is denied. Health exposes only project/mode/readiness and the `admin-v1` release capability. The frontend calls the API directly because Hosting's supported Cloud Run rewrite locations do not include Johannesburg.

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

## Verification and remaining limits

Typecheck/formatting, 33 unit/storage/sync/config/fixture tests, 14 emulator integration scenarios and both builds passed. Cloud Build built the real container successfully. Live API tests used temporary clinician/recorder/viewer accounts and an isolated temporary hospital: real email/password login; runtime Auth/Firestore permissions; tenant/department/clinical-role isolation; registration and audited idempotent replay; stale-version rejection; simultaneous bookings with exactly one winner; theatre entry/completion; aggregate redaction; direct Firestore denial; disabled-user rejection. Temporary accounts, their profiles and all temporary hospital records were removed after testing.

Chromium verified the live sign-in and authenticated Overview/backlog/case-note form. The final hosted offline/reconnect check was interrupted when the browser session closed, so it is not a verified cloud check. The local production PWA's offline reload, encrypted persistence, automatic replay and 390px layout were verified in prior milestones. Physical phones, Safari/Firefox, real reviewer login and full hospital acceptance remain outstanding. See [verification](verification.md). The client bundle advisory remains.

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
