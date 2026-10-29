# Dev and production environments

Updated 29 October 2026. This is repository scaffolding. No production project has been created, and nothing in this document has been deployed.

`theatre-tracker-2f2e5` is **dev**. It is the fictional-data review site already described in [deployment](deployment.md) and [review infrastructure](review-infrastructure.md). Firebase aliases `dev` and `review` both select it. The default alias stays `demo-theatre-tracker` so a bare Firebase command remains on the local emulators.

**Production** is a second Firebase/GCP project. Its id is not decided. The placeholder `surgilog-prod` is the value to replace. It is not a live project.

## Where the project id is set

Edit the id in these two places:

- `config/prod.json` field `projectId`
- `.firebaserc` alias `prod`

Cloud Run and Hosting read their own files, so the same id is repeated in `config/prod-api.yaml` (`FIREBASE_PROJECT_ID` and the two Hosting origins) and `firebase.prod.json` (`hosting.site`). `config/prod.json` also repeats it on the placeholder web config (`authDomain`, `projectId`, `storageBucket`). `npm test` fails if those copies drift. Leave `placeholder` set to `true` until the real Firebase web config is in `config/prod.json`. Do not put secrets, service-account keys, or passwords in any of these files. The web API key is a public client identifier, the same kind of value already stored for dev in `config/review.json`.

## What each environment runs

| | Local | Dev (`theatre-tracker-2f2e5`) | Production (placeholder `surgilog-prod`) |
| --- | --- | --- | --- |
| Alias | `default` | `dev` and `review` | `prod` |
| Data | Emulator fixtures | Fictional review data | Empty until a hospital is onboarded. The fictional seed is refused. |
| Web build | `npm run build` | `npm run build:review -- --api-url …` | `npm run build:prod` (placeholder API) or `npm run build:prod -- --api-url …` |
| API mode | `local` | `APP_ENV=review` | `APP_ENV=prod` and `FICTIONAL_SEEDING=false` |
| Browser origins | Local Vite/preview | Dev Hosting origins, plus dev preview channels | Only `https://PROJECT.web.app` and `https://PROJECT.firebaseapp.com` |

Production mode does not add Hosting preview-channel origins. A dev/review build cannot be deployed onto the production project, and a production build cannot be deployed onto the dev project. A production deploy also requires confirmation: `CONFIRM_PROD=yes` or `--confirm-prod`. The GitHub workflow adds a second check: the dispatch input must be the text `deploy-production`.

`FICTIONAL_SEEDING=false` is required for the API to start. The same value is a hard stop for `seed`, `setup-review`, `backfill-seed-history`, `review-admin`, and `synthetic-fixtures`, including when `APP_ENV` is unset but the process is pointed at the production project. A `migrate-*` script is not in that set. In a production context it runs only with `CONFIRM_PROD=yes` or `--confirm-prod`. The migrate scripts that exist today still refuse anything except the local demo emulator. That local check is separate, and `CONFIRM_PROD` does not bypass it.

`npm run guard:deploy -- --target prod --confirm-prod` checks that agreement and stops while the config is still a placeholder. It does not deploy. A production deploy with no project id also stops. `npm run build:prod` verifies a placeholder build without a deploy project id.

## Promotion

Work reaches production only from `main`, and only after Dylan has signed that commit off.

1. Changes land on `main` through the existing pull-request checks. Those checks do not deploy production. Dev Hosting at https://theatre-tracker-2f2e5.web.app stays the manual dev release in [deployment](deployment.md).
2. Merging to `main` does not deploy production.
3. Dylan signs off the `main` commit that should ship.
4. A maintainer runs the **Deploy production** workflow (`.github/workflows/deploy-prod.yml`) from `main` and types `deploy-production`. The workflow fails the job when `github.ref` is not `refs/heads/main`. It runs typecheck, unit tests, and `npm run build:prod` before it authenticates or deploys. Choosing another branch at dispatch can bypass that step: GitHub runs the workflow file from the selected ref, and that copy can omit the check.
5. The real protection is the GitHub Environment `production`, limited to deployment branch `main`, with Dylan (GitHub user `DylanGeldenhuys`) as a required reviewer. Set that environment up before any production secrets are added. GitHub otherwise creates the environment on the first dispatch with no protection.
6. Turn on branch protection for `main`. Require a pull request before merging. Require the CI status checks **Typecheck, unit tests, format, build** and **Emulator integration tests**. Block force-pushes and block deletion. Apply the rules to administrators.
7. The workflow checks for the API with `gcloud run services describe`. When the service does not exist yet, it deploys normally, without `--no-traffic`, and then smoke-checks `/health`. When the service already exists, it deploys with `--no-traffic --tag=candidate`, smoke-checks that tag's `/health`, and shifts traffic with `gcloud run services update-traffic --to-tags=candidate=100`. That sends traffic to the revision that was checked. A failed smoke check on a later run stops the job and leaves the current traffic in place. The job then builds the web app against the service URL and deploys Hosting. It does not deploy Firestore rules, indexes, or Auth providers. Cutover deploys those before staff use the site.

If `PROD_GCP_SA_KEY` or `FIREBASE_SERVICE_ACCOUNT_PROD` is missing from the `production` environment, the workflow fails and deploys nothing. Add those secrets only after the environment is limited to `main` and Dylan is a required reviewer. Store them on the `production` environment, not as ordinary repository secrets, so pull-request jobs cannot read them. While `config/prod.json` still has `"placeholder": true`, a run that does have the secrets fails before it deploys.

## One-time production setup

The owner does this once, in a project they create. This repository does not create the project and these commands are not part of the scaffolding change.

1. Create a Firebase/GCP project. Replace `surgilog-prod` using the section above if the real id is different. Prefer a dedicated billing account or the hospital's account, not a personal experiment attached to the dev project.
2. Link billing and move the project to the **Blaze** plan. Cloud Run and Firestore need it. Set a budget alert in Billing → Budgets & alerts for an amount the owner chooses. An alert is not a spending cap.
3. Enable the same APIs the dev project uses for the API build: `run.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`, and `iam.googleapis.com`. Create the Firebase resources below in the Firebase console, which enables Firestore, Auth, and Hosting on the project.
4. Create the Firestore database in **Standard** edition, location **`africa-south1` (Johannesburg)**. The location cannot be changed later. Use the `(default)` database. Leave rules and indexes for the cutover deploy below. The rules deny all direct client access. The API uses the Admin SDK.
5. Enable **Email/Password** for sign-in. `firebase.prod.json` already declares that provider. The app has no public sign-up form. Keep client registration closed: add an Authentication blocking function `beforeCreate` that rejects every client registration. Firebase documents that blocking functions run for client SDK calls and that Admin SDK `createUser` does not run `beforeCreate`. Confirm both paths: a client `createUserWithEmailAndPassword` is rejected, and an Admin SDK create from the API runtime still succeeds. If `beforeCreate` also fires for the Admin SDK, allow only that admin create and reject the rest. Staff accounts are provisioned by an admin. Add the two Hosting hostnames as authorized domains. Do not add a wildcard. Dev preview-channel hostnames do not belong on this project.
6. Set the Auth email templates before anyone is invited. Authentication → Templates. Sender display name **SurgiLog**. Customize the password-reset message; the app's set-or-reset-password flow sends that template. Configure a hospital-domain SMTP sender so mail is not from `noreply@PROJECT.firebaseapp.com`. Record the From address.
7. Create two service accounts in the production project, with the same narrow roles as dev (see [review infrastructure](review-infrastructure.md)):
   - Runtime `surgilog-api`: `roles/datastore.user`, `roles/firebaseauth.viewer`, and a custom role with only `firebaseauth.users.create` and `firebaseauth.users.sendEmail`. Copy `config/review-user-provisioner-role.yaml` and change its title/description so it does not say "review".
   - Build `surgilog-build`: `roles/run.builder` only.
   - Do not download keys for these two identities. Cloud Run uses the runtime account attached to the service.
8. Create a deploy identity, suggested name `surgilog-deploy`, used only by GitHub. It does not get `roles/datastore.user` and it does not get Firebase Auth user administration. Grant exactly:
   - `roles/run.admin` on the Cloud Run service `surgilog-api` in `africa-south1`. A service-level binding cannot create a service that does not exist yet. The workflow's first run creates it, so that run needs project-level `roles/run.admin`. After the service exists, remove the project binding and leave the service binding.
   - `roles/cloudbuild.builds.editor` on the project.
   - `roles/artifactregistry.writer` on the regional Artifact Registry repository. The owner creates that repository so this account does not need `roles/artifactregistry.admin`.
   - `roles/storage.objectAdmin` only on the source upload bucket. Cloud Run source deploys use a bucket such as `run-sources-PROJECT-africa-south1`, and Cloud Build uses a `*_cloudbuild` bucket. Read the bucket name from the first build log. Do not grant project-wide Storage Admin.
   - `roles/iam.serviceAccountUser` (`iam.serviceAccounts.actAs`) on `surgilog-api@PROJECT.iam.gserviceaccount.com` and on `surgilog-build@PROJECT.iam.gserviceaccount.com`.
   - `roles/firebasehosting.admin` for the Hosting deploy.
   - `roles/serviceusage.apiKeysViewer`, because the Hosting CLI reads the web API key.
   - `roles/serviceusage.serviceUsageConsumer` on the project. Source deploy calls the enabled APIs as this identity, and that role is the extra it needs for those calls.
   - The deploy account must not have `firebaseauth.configs.update`. The preview custom role in `config/github-hosting-preview-role.yaml` (`firebaseauth.configs.get` and `firebaseauth.configs.update`) is never granted in production, not on this account and not on the runtime account. The live channel does not change authorized domains or sign-in providers. The runtime custom role stays the user-provisioner permissions only.
   Keep the JSON key as the `production` environment secrets `PROD_GCP_SA_KEY` (Cloud Run deploy) and `FIREBASE_SERVICE_ACCOUNT_PROD` (Hosting). The same key file can fill both until the Hosting identity is split. Delete the local key files. Move GitHub off this long-lived key and onto Workload Identity Federation before any real patient data is stored. Until that move, rotate the key and keep the roles listed here.
9. Enable Firestore point-in-time recovery and a daily backup schedule on `(default)`. Confirm a restore into an empty project before any real record exists. Record the backup location and retention with the hospital.
10. Turn on Data Access audit logs for `datastore.googleapis.com` (Firestore) and `identitytoolkit.googleapis.com`. Admin Activity logs stay on; Google retains those for 400 days by default. Agree a retention period with the hospital. 365 days is a practical starting point, not a legal ruling. Lock the Cloud Logging bucket so that retention cannot be shortened. Do not sink Firestore document bodies into logs. The API already avoids logging clinical text.
11. Create the first application Super User without the fictional seed. `npm run setup:review` and `npm run seed` refuse production. In the Auth console, create one Email/Password user. Then create `profiles/{uid}` with `superUser: true`, `active: true`, `version: 1`, empty `memberships`, and the person's name and email. Do not copy the dev account, the demo password, or the fictional hospitals. Do not commit the password.
12. Register a Firebase web app for this project. Put its real web SDK config into `config/prod.json`, set `placeholder` to `false`, and align the copies listed above. `npm test` must pass. Restrict the browser API key: HTTP referrers `https://PROJECT.web.app/*` and `https://PROJECT.firebaseapp.com/*` only. API restrictions: Identity Toolkit API and Token Service API only. The browser key is for Auth. Client Firestore stays denied, so Cloud Firestore does not belong on this key, and the key stays restricted. The first production deploy is still the signed-off workflow, not a laptop deploy.

Cloud Run settings match dev: region `africa-south1`, service `surgilog-api`, 1 vCPU, 512 MiB, minimum 0, maximum 2, concurrency 20, 30-second timeout, request-based CPU. The browser calls the API directly, so the service uses public HTTPS ingress (`--no-invoker-iam-check`). Every application route still requires a Firebase ID token. Health is public and reports `mode: prod`.

The first workflow run creates the Cloud Run service. `gcloud run services describe` finds nothing, so that run deploys normally, without `--no-traffic`, and then smoke-checks the service `/health`. A new service has to receive traffic, so a failed first-run check leaves that revision serving and still stops Hosting. Later runs deploy with `--no-traffic --tag=candidate`, smoke-check `https://candidate---…/health`, and shift traffic with `gcloud run services update-traffic --to-tags=candidate=100`. The revision that passed the check is the one that receives traffic. A failed check on a later run leaves the serving revision unchanged. Record the serving revision name before the shift.

Organisation policy can block that public invoke. `constraints/iam.allowedPolicyMemberDomains` and a Cloud Run ingress policy both refuse `allUsers`. Confirm a project-only exception for this API. Leave the rest of the organisation unchanged, and leave every data route behind a Firebase token.

## Cutover

Do this only after the checklist and a signed-off deploy of an empty production project.

1. Deploy Firestore rules and indexes for the signed-off commit. The production workflow does not deploy them:

```sh
npx -y firebase-tools@latest deploy --only firestore --config firebase.prod.json --project PROD_ID
```

Confirm the published rules deny all client access and that every index reports READY. Do this before staff use the site.
2. Read `/health`. It must report `mode` `prod`, the production project id, and the Admin and theatre-register capabilities.
3. Confirm the API allows only the two production Hosting origins.
4. Sign in as the production Super User on the production Hosting URL. Dev accounts do not exist there.
5. Leave the 659 fictional dev documents on dev. Do not import them. The seed command will not write them to production.
6. Give staff the production URL (`https://PROJECT.web.app`). Do not point the dev Hosting site at production and do not add a redirect from the dev origin. Dev remains the fictional review environment.
7. Real patient records wait for the readiness note below and for Dylan's explicit sign-off. A synthetic smoke record, if the hospital wants one before go-live, is a separate decision. It is not the review fixture set.

## Rollback

Roll back the web and the API separately. Neither step restores or deletes Firestore data.

- **Hosting.** Firebase console → Hosting → the production site → Release history → roll back to the previous release. That restores the previous static files.
- **API.** Send all traffic to the previous Cloud Run revision, using the revision name recorded before the deploy:

```sh
gcloud run services update-traffic surgilog-api \
  --to-revisions=PREVIOUS_REVISION=100 \
  --region=africa-south1 \
  --project=PROD_ID
```

Leave the bad revision in place until the previous one is serving. The production workflow does not deploy rules or indexes, so a bad rules change is not undone by these two steps. Restore rules from the last known `firebase/firestore.rules` deploy, or restore data from the backup taken before the change.

Dev rollback stays the procedure already recorded in [deployment](deployment.md). Rolling back dev does not affect production, and the reverse is also true.

## POPIA and real patient data

This scaffolding is not approval to process real patient information, and it is not a POPIA compliance claim.

Health information needs a legal basis, a hospital Information Officer review, and an operator agreement before it is stored here. Hosting in Johannesburg does not by itself satisfy POPIA. Firebase Authentication still has its own processing footprint outside the Firestore region. See [requirements](requirements.md) and [architecture](architecture.md).

Before any real record:

- The production project is the one in this document, with backups, point-in-time recovery, and a tested restore.
- The fictional seed has not been loaded. Dev remains fictional and must not receive real patients either.
- Staff use invited accounts. Multi-factor authentication for live clinical access is still an open requirement in [requirements](requirements.md) and is not implemented.
- Logs, screenshots, git, and demo data stay free of patient information.
- Dylan and the hospital have signed the go-live off in writing. A green workflow is not that sign-off.
- GitHub deploys through Workload Identity Federation. A long-lived deploy key is no longer the production credential.

## Checks

`npm test` covers the prod/dev deploy guard, a deploy with no project id, the placeholder lock, production CORS, fictional-script refusal (including `FICTIONAL_SEEDING=false` and a production project id with `APP_ENV` unset), and confirmed production migrations. `npm run build:prod` builds the web app with the placeholder API URL and then refuses to treat that build as deployable. `npm run typecheck`, `npm run format:check`, and `npm run build` stay the dev/local checks. The production workflow runs typecheck, unit tests, and `build:prod` before it deploys, and it fails when the production secrets are missing.
