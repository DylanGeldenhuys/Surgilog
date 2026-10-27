# Dev and production environments

Updated 27 October 2026. This is repository scaffolding. No production project has been created, and nothing in this document has been deployed.

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

`npm run guard:deploy -- --target prod --confirm-prod` checks that agreement and stops while the config is still a placeholder. It does not deploy.

## Promotion

Work reaches production only from `main`, and only after Dylan has signed that commit off.

1. Changes land on `main` through the existing pull-request checks. Those checks do not deploy production. Dev Hosting at https://theatre-tracker-2f2e5.web.app stays the manual dev release in [deployment](deployment.md).
2. Merging to `main` does not deploy production.
3. Dylan signs off the `main` commit that should ship.
4. A maintainer runs the **Deploy production** workflow (`.github/workflows/deploy-prod.yml`) from `main` and types `deploy-production`.
5. GitHub Environment `production` must approve the run. Add Dylan as a required reviewer on that environment before the first run, so the first dispatch cannot slip through without a reviewer.
6. The workflow deploys the API to Cloud Run, builds the web app against that API URL, then deploys Hosting. It does not deploy Firestore rules, indexes, or Auth providers.

If `PROD_GCP_SA_KEY` or `FIREBASE_SERVICE_ACCOUNT_PROD` is missing from the `production` environment, the workflow succeeds without deploying and writes that reason in the log. Store those secrets on the `production` environment, not as ordinary repository secrets, so pull-request jobs cannot read them. While `config/prod.json` still has `"placeholder": true`, a run that does have the secrets fails before it deploys.

## One-time production setup

The owner does this once, in a project they create. This repository does not create the project and these commands are not part of the scaffolding change.

1. Create a Firebase/GCP project. Replace `surgilog-prod` using the section above if the real id is different. Prefer a dedicated billing account or the hospital's account, not a personal experiment attached to the dev project.
2. Link billing and move the project to the **Blaze** plan. Cloud Run and Firestore need it. Set a budget alert in Billing → Budgets & alerts for an amount the owner chooses. An alert is not a spending cap.
3. Enable the same APIs the dev project uses for the API build: `run.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`, and `iam.googleapis.com`. Create the Firebase resources below in the Firebase console, which enables Firestore, Auth, and Hosting on the project.
4. Create the Firestore database in **Standard** edition, location **`africa-south1` (Johannesburg)**. The location cannot be changed later. Use the `(default)` database. Deploy the existing rules and indexes once, after the guards pass, with `firebase deploy --only firestore --config firebase.prod.json --project PROD_ID`. The rules deny all direct client access. The API uses the Admin SDK.
5. Enable **Email/Password** authentication only. `firebase.prod.json` already declares that provider. Add the two Hosting hostnames as authorized domains. Do not add a wildcard. Dev preview-channel hostnames do not belong on this project.
6. Create two service accounts in the production project, with the same narrow roles as dev (see [review infrastructure](review-infrastructure.md)):
   - Runtime `surgilog-api`: `roles/datastore.user`, `roles/firebaseauth.viewer`, and a custom role with only `firebaseauth.users.create` and `firebaseauth.users.sendEmail`. Copy `config/review-user-provisioner-role.yaml` and change its title/description so it does not say "review".
   - Build `surgilog-build`: `roles/run.builder` only.
   - Do not download keys for these two identities. Cloud Run uses the runtime account attached to the service.
7. Create a third identity used only by GitHub to deploy. It needs to run the Cloud Run source deploy and the Hosting deploy, and to act as the runtime and build service accounts. It does not need `roles/datastore.user` or Firebase Auth user administration. Grant Hosting deploy `roles/firebasehosting.admin` and `roles/serviceusage.apiKeysViewer` (the Hosting CLI reads the web API key). Keep the JSON keys as `production` environment secrets `PROD_GCP_SA_KEY` (Cloud Run deploy) and `FIREBASE_SERVICE_ACCOUNT_PROD` (Hosting). Delete the local key files. A later improvement is Workload Identity Federation so GitHub does not store a long-lived key.
8. Enable Firestore point-in-time recovery and a daily backup schedule on `(default)`. Confirm a restore into an empty project before any real record exists. Record the backup location and retention with the hospital.
9. Create the first application Super User without the fictional seed. `npm run setup:review` and `npm run seed` refuse production. In the Auth console, create one Email/Password user. Then create `profiles/{uid}` with `superUser: true`, `active: true`, `version: 1`, empty `memberships`, and the person's name and email. Do not copy the dev account, the demo password, or the fictional hospitals. Do not commit the password.
10. Put the real web SDK config into `config/prod.json`, set `placeholder` to `false`, and align the copies listed above. `npm test` must pass. The first production deploy is still the signed-off workflow, not a laptop deploy.

Cloud Run settings match dev: region `africa-south1`, service `surgilog-api`, 1 vCPU, 512 MiB, minimum 0, maximum 2, concurrency 20, 30-second timeout, request-based CPU. The browser can reach the service; every application route still requires a Firebase token. Health is public and reports `mode: prod`.

## Cutover

Do this only after the checklist and a signed-off deploy of an empty production project.

1. Read `/health`. It must report `mode` `prod`, the production project id, and the Admin and theatre-register capabilities.
2. Confirm the API allows only the two production Hosting origins.
3. Sign in as the production Super User on the production Hosting URL. Dev accounts do not exist there.
4. Leave the 659 fictional dev documents on dev. Do not import them. The seed command will not write them to production.
5. Give staff the production URL (`https://PROJECT.web.app`). Do not point the dev Hosting site at production and do not add a redirect from the dev origin. Dev remains the fictional review environment.
6. Real patient records wait for the readiness note below and for Dylan's explicit sign-off. A synthetic smoke record, if the hospital wants one before go-live, is a separate decision. It is not the review fixture set.

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

## Checks

`npm test` covers the prod/dev deploy guard, the placeholder lock, production CORS, and the prod-mode refusal of fictional scripts. `npm run build:prod` builds the web app with the placeholder API URL and then refuses to treat that build as deployable. `npm run typecheck`, `npm run format:check`, and `npm run build` stay the dev/local checks.
