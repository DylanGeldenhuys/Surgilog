# Continuous integration and deploys

GitHub Actions runs the checks and the pull-request preview below on pull requests and on pushes to `main`. Those two workflows do not deploy the API, do not change Firestore rules, and do not publish a live site.

A push to `dev` deploys the existing dev web app and API. A push to `main` deploys production. Both are under [Branch deploys](#branch-deploys). They do not run on pull requests, and they deploy nothing until the one-time setup in that section is done.

## Checks

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`.

The fast job installs with `npm ci` (npm cache via `actions/setup-node`), then runs `typecheck`, unit tests, `format:check` and `build`. Node.js 22 matches the local requirement.

Emulator integration tests are a separate job. They need Java 21 and the Firebase Auth and Firestore emulators for `demo-theatre-tracker`, plus the local API. `scripts/ci-integration.mjs` starts that API only after `firebase emulators:exec` has set `FIRESTORE_EMULATOR_HOST`. The job runs `test:integration`, `test:admin` and `test:theatre`, starting a fresh API process for each suite and awaiting shutdown between them. This isolates the in-memory request allowance without weakening the application rate limit. It is separate so emulator download and the longer scenarios do not sit in front of the fast checks, and so a slow emulator startup cannot hide a type or unit-test failure. The emulators are the demo project only. They do not call `theatre-tracker-2f2e5`.

## Previews

`.github/workflows/preview.yml` runs on pull requests whose head branch is in this repository. Fork pull requests skip the job. The workflow builds the review web app with the existing API:

`https://theatre-tracker-api-54783611706.africa-south1.run.app`

It then deploys that `dist-review` build to a Firebase Hosting preview channel on site `theatre-tracker-2f2e5`. [FirebaseExtended/action-hosting-deploy](https://github.com/FirebaseExtended/action-hosting-deploy) reads `firebase.json`, so the workflow first runs `scripts/write-preview-firebase-json.mjs`. That step copies Hosting from `firebase.review.json` and omits Auth and Firestore. The workflow sets `channelId` to `pr` plus the pull request number, so a branch name is not part of the channel id. An automatic id can keep a `.` from the branch name, and the CORS pattern rejects that. The URL stays the same for later commits on that request and looks like:

`https://theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app`

Channels expire after 7 days (`expires: 7d`). The action posts and updates the preview URL on the pull request. Hosting's existing predeploy command performs a read-only `GET /health` against the review API. It does not deploy the API.

If the repository secret `FIREBASE_SERVICE_ACCOUNT_THEATRE_TRACKER_2F2E5` is missing or empty, the job does not fail and does not deploy. It warns in the log and posts or updates one pull-request comment that points here. After the secret is added, the next run removes that comment and deploys the channel.

The check job and the emulator job each receive only `contents: read`. The preview job adds `pull-requests: write` for the skip comment and the Hosting action's preview URL comment, and `checks: write` because the pinned Hosting action creates a Deploy Preview check before it deploys. Those comments use the issues comment API on the pull request, which requires `pull-requests: write`. The token does not have `deployments: write` or `issues: write`.

## One-time setup

Do this once in project `theatre-tracker-2f2e5`, as the project owner. Do not grant this identity Editor, Firebase Admin, Cloud Run Admin, Datastore, or Firestore roles. Do not commit the JSON key.

Never grant this preview service account, its JSON key, or the `githubHostingPreviewDomains` custom role on any production project. They belong only to the fictional-data project `theatre-tracker-2f2e5`. The custom role includes `firebaseauth.configs.update`, which can change Auth configuration beyond authorized domains, including sign-in providers. That permission stays off every production project and every production identity.

1. Create a service account used only for preview Hosting deploys:

```sh
gcloud iam service-accounts create github-hosting-preview \
  --display-name="SurgiLog GitHub Hosting previews" \
  --project=theatre-tracker-2f2e5
```

2. Grant Hosting deploy access, and read-only access to the Firebase web API key. The Hosting action's CLI reads that key during deploy. Cloud Run Viewer is not required: this app does not rewrite Hosting to Cloud Run.

`roles/firebasehosting.admin` can also manage the live Hosting channel, not only preview channels. There is no Google-managed preview-only role. A leaked key for this service account can overwrite the live site's static files. Live dev and production deploys use a different service account, `github-deploy`, described under Branch deploys. Do not use this preview account, its JSON key, or `githubHostingPreviewDomains` for those deploys, and do not grant them on production.

```sh
gcloud projects add-iam-policy-binding theatre-tracker-2f2e5 \
  --member="serviceAccount:github-hosting-preview@theatre-tracker-2f2e5.iam.gserviceaccount.com" \
  --role="roles/firebasehosting.admin" \
  --project=theatre-tracker-2f2e5
```

```sh
gcloud projects add-iam-policy-binding theatre-tracker-2f2e5 \
  --member="serviceAccount:github-hosting-preview@theatre-tracker-2f2e5.iam.gserviceaccount.com" \
  --role="roles/serviceusage.apiKeysViewer" \
  --project=theatre-tracker-2f2e5
```

3. Let preview deploys add and remove Auth authorized domains without user administration. `roles/firebaseauth.admin` can create, update and delete Auth users, so it is not used. The custom role in [config/github-hosting-preview-role.yaml](../config/github-hosting-preview-role.yaml) has only `firebaseauth.configs.get` and `firebaseauth.configs.update`. `firebaseauth.configs.update` can change Auth project configuration beyond the authorized-domain list, including sign-in providers and other project Auth settings. It cannot create or delete users. That is narrower than `roles/firebaseauth.admin`, and the key still needs to stay private.

```sh
gcloud iam roles create githubHostingPreviewDomains \
  --project=theatre-tracker-2f2e5 \
  --file=config/github-hosting-preview-role.yaml
```

```sh
gcloud projects add-iam-policy-binding theatre-tracker-2f2e5 \
  --member="serviceAccount:github-hosting-preview@theatre-tracker-2f2e5.iam.gserviceaccount.com" \
  --role="projects/theatre-tracker-2f2e5/roles/githubHostingPreviewDomains" \
  --project=theatre-tracker-2f2e5
```

The CLI then adds `theatre-tracker-2f2e5--pr<number>-<hash>.web.app` when the channel is deployed, and removes expired channel hostnames for this site on a later deploy. If this role is skipped, the channel still deploys and the CLI warns `Unable to add channel domain to Firebase Auth.` Sign-in fails until the hostname is added by hand. Firebase Auth does not accept a wildcard. Add the hostname only, with no `https://`, at Firebase console → Authentication → Settings → Authorized domains. The hostname is stable for that pull request.

4. Create a JSON key, store it as a GitHub secret, and delete the local file. The secret name must be exactly `FIREBASE_SERVICE_ACCOUNT_THEATRE_TRACKER_2F2E5`. The key is long-lived. It is only for pull-request previews. Branch deploys do not use it. They use Workload Identity Federation, below, so no JSON key is stored for dev or production.

```sh
gcloud iam service-accounts keys create /tmp/github-hosting-preview.json \
  --iam-account=github-hosting-preview@theatre-tracker-2f2e5.iam.gserviceaccount.com \
  --project=theatre-tracker-2f2e5
```

```sh
gh secret set FIREBASE_SERVICE_ACCOUNT_THEATRE_TRACKER_2F2E5 \
  --repo DylanGeldenhuys/Surgilog < /tmp/github-hosting-preview.json
rm /tmp/github-hosting-preview.json
```

The same JSON can be pasted in GitHub → Settings → Secrets and variables → Actions → New repository secret.

## CORS and authorized domains

Two separate checks decide whether a preview can sign in and load data.

Authorized domains are a Firebase Auth console setting. The preview hostname is not covered by `theatre-tracker-2f2e5.web.app`. Step 3 above lets the deploy add that hostname. Without it, use the manual console step in step 3. No API deploy is required for this check.

CORS is enforced by the Cloud Run API. `config/review-api.yaml` still lists only:

- `https://theatre-tracker-2f2e5.web.app`
- `https://theatre-tracker-2f2e5.firebaseapp.com`

`shared/runtime-config.ts` also allows `https://theatre-tracker-2f2e5--<channel>.web.app` and the matching `firebaseapp.com` host, and only when `FIREBASE_PROJECT_ID` is `theatre-tracker-2f2e5`. Other projects keep the explicit list. The live site is not matched by the pattern. This code is not running in Cloud Run until the next API release. Until that release, the preview page can load and the browser will block its calls to the review API. A push to `dev` deploys that API. The preview workflow does not.

## Branch deploys

Two workflows publish the web app and the API. Neither runs on a pull request. Neither deploys Firestore rules, indexes, or Auth providers, and neither writes patient or review records.

| Push | Workflow | GitHub environment | GCP project |
| --- | --- | --- | --- |
| `dev` | [deploy-dev.yml](../.github/workflows/deploy-dev.yml) | `development`, limited to `dev` | `theatre-tracker-2f2e5` |
| `main` | [deploy-prod.yml](../.github/workflows/deploy-prod.yml) | `production`, limited to `main`, with Dylan as a required reviewer | `surgilog-prod` |

Dev publishes the live site https://theatre-tracker-2f2e5.web.app and the existing API https://theatre-tracker-api-54783611706.africa-south1.run.app. The Cloud Run service stays `theatre-tracker-api` in `africa-south1`. The workflow stops if that API address would change. Production uses the project id in `config/prod.json`. While that file still says `"placeholder": true`, the production workflow stops before it deploys.

Each job runs typecheck and unit tests before it authenticates. It deploys the API, then Hosting. When the Cloud Run service already exists, the new revision is deployed with `--no-traffic --tag=candidate`, `/health` is checked, and traffic moves only after that check. The first deploy of a missing service has no previous revision to keep, so it serves immediately and the health check still has to pass before Hosting. A failed later check leaves the current traffic in place. Dev `/health` must report mode `review` and project `theatre-tracker-2f2e5`. Production `/health` must report mode `prod` and the production project. `scripts/guard-deploy.ts` refuses a dev run aimed at production and a production run aimed at dev.

Authentication is keyless Workload Identity Federation through `google-github-actions/auth`. The workflow reads `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT` from the GitHub environment's variables, or from secrets of the same names. It does not contain those values. Do not create a JSON key for the deploy account. The preview account `github-hosting-preview` and the role `githubHostingPreviewDomains` stay on pull-request previews only. They include `firebaseauth.configs.update`. The deploy account must not have that permission, and neither the preview account nor that role may be granted on production.

Create both GitHub environments before merging the workflow. The first push creates a missing environment with no branch limit and no reviewer.

### Cloud Shell, once per project

Run this in Cloud Shell as the project owner. It does not deploy the app and it does not write Firestore. If a create command says the resource already exists, leave it and continue. Do not delete the pool to recreate it.

Dev already has billing. For production, link a billing account and move `surgilog-prod` to the Blaze plan before these commands. Cloud Run will not build without it. Create the production project first; this script does not create a project. Production also needs the runtime account `surgilog-api` and the build account `surgilog-build` from [environments](environments.md) before the `actAs` commands below.

Dev:

```sh
set -euo pipefail
PROJECT_ID=theatre-tracker-2f2e5
BRANCH=dev
SERVICE=theatre-tracker-api
RUNTIME_SA=theatre-tracker-api
BUILD_SA=theatre-tracker-build
DEPLOY_SA="github-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
ENV_NAME=development

gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="${PROJECT_ID}"

gcloud iam workload-identity-pools create github-surgilog \
  --project="${PROJECT_ID}" \
  --location=global \
  --display-name="SurgiLog GitHub Actions" || echo "Pool github-surgilog already exists; leaving it."

gcloud iam workload-identity-pools providers create-oidc github \
  --project="${PROJECT_ID}" \
  --location=global \
  --workload-identity-pool=github-surgilog \
  --display-name="SurgiLog GitHub ${BRANCH}" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='DylanGeldenhuys/Surgilog' && assertion.ref=='refs/heads/${BRANCH}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" || echo "Provider github already exists; leaving it."

gcloud iam service-accounts create github-deploy \
  --project="${PROJECT_ID}" \
  --display-name="SurgiLog GitHub deploy" || echo "Service account github-deploy already exists; leaving it."

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "${DEPLOY_SA}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-surgilog/subject/repo:DylanGeldenhuys/Surgilog:ref:refs/heads/${BRANCH}" \
  --condition=None

for id in "$RUNTIME_SA" "$BUILD_SA"; do
  if ! gcloud iam service-accounts describe "${id}@${PROJECT_ID}.iam.gserviceaccount.com" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Missing ${id}@${PROJECT_ID}.iam.gserviceaccount.com. Create it from docs/environments.md, then run this script again."
    exit 1
  fi
  gcloud iam service-accounts add-iam-policy-binding "${id}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOY_SA}" \
    --role="roles/iam.serviceAccountUser" \
    --condition=None
done

if gcloud run services describe "${SERVICE}" --region=africa-south1 --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud run services add-iam-policy-binding "${SERVICE}" \
    --region=africa-south1 \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOY_SA}" \
    --role="roles/run.admin" \
    --condition=None
else
  echo "Service ${SERVICE} does not exist yet. Granting project-level Cloud Run admin so the first deploy can create it. After that deploy succeeds, remove the project binding and keep roles/run.admin on the service only."
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOY_SA}" \
    --role="roles/run.admin" \
    --condition=None
fi

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/cloudbuild.builds.editor" \
  --condition=None
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/serviceusage.serviceUsageConsumer" \
  --condition=None
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/firebasehosting.admin" \
  --condition=None
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/serviceusage.apiKeysViewer" \
  --condition=None

if ! gcloud artifacts repositories describe cloud-run-source-deploy --location=africa-south1 --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create cloud-run-source-deploy \
    --repository-format=docker \
    --location=africa-south1 \
    --description="Cloud Run source deploys" \
    --project="${PROJECT_ID}"
fi
gcloud artifacts repositories add-iam-policy-binding cloud-run-source-deploy \
  --location=africa-south1 \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None

echo "Granting object admin only on Cloud Run and Cloud Build buckets, not on the whole project."
gcloud storage buckets list --project="${PROJECT_ID}" --format='value(name)' | while read -r bucket; do
  name="${bucket#gs://}"
  case "$name" in
    run-sources-*"africa-south1"|*"_cloudbuild")
      gcloud storage buckets add-iam-policy-binding "gs://${name}" \
        --member="serviceAccount:${DEPLOY_SA}" \
        --role="roles/storage.objectAdmin"
      ;;
  esac
done

PROVIDER="$(gcloud iam workload-identity-pools providers describe github \
  --project="${PROJECT_ID}" \
  --location=global \
  --workload-identity-pool=github-surgilog \
  --format='value(name)')"
echo
echo "GitHub environment: ${ENV_NAME}"
echo "Deployment branch: ${BRANCH} only"
echo "GCP_WORKLOAD_IDENTITY_PROVIDER=${PROVIDER}"
echo "GCP_SERVICE_ACCOUNT=${DEPLOY_SA}"
```

Production. Link a billing account and move the project to the Blaze plan before pasting this. The project must already exist. After the first deploy creates `surgilog-api`, remove the project-level `roles/run.admin` binding and keep that role on the service only. Add Dylan (`DylanGeldenhuys`) as a required reviewer on the `production` environment.

```sh
set -euo pipefail
PROJECT_ID=surgilog-prod
BRANCH=main
SERVICE=surgilog-api
RUNTIME_SA=surgilog-api
BUILD_SA=surgilog-build
DEPLOY_SA="github-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
ENV_NAME=production

gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  cloudresourcemanager.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="${PROJECT_ID}"

gcloud iam workload-identity-pools create github-surgilog \
  --project="${PROJECT_ID}" \
  --location=global \
  --display-name="SurgiLog GitHub Actions" || echo "Pool github-surgilog already exists; leaving it."

gcloud iam workload-identity-pools providers create-oidc github \
  --project="${PROJECT_ID}" \
  --location=global \
  --workload-identity-pool=github-surgilog \
  --display-name="SurgiLog GitHub ${BRANCH}" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='DylanGeldenhuys/Surgilog' && assertion.ref=='refs/heads/${BRANCH}'" \
  --issuer-uri="https://token.actions.githubusercontent.com" || echo "Provider github already exists; leaving it."

gcloud iam service-accounts create github-deploy \
  --project="${PROJECT_ID}" \
  --display-name="SurgiLog GitHub deploy" || echo "Service account github-deploy already exists; leaving it."

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "${DEPLOY_SA}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-surgilog/subject/repo:DylanGeldenhuys/Surgilog:ref:refs/heads/${BRANCH}" \
  --condition=None

for id in "$RUNTIME_SA" "$BUILD_SA"; do
  if ! gcloud iam service-accounts describe "${id}@${PROJECT_ID}.iam.gserviceaccount.com" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Missing ${id}@${PROJECT_ID}.iam.gserviceaccount.com. Create it from docs/environments.md, then run this script again."
    exit 1
  fi
  gcloud iam service-accounts add-iam-policy-binding "${id}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOY_SA}" \
    --role="roles/iam.serviceAccountUser" \
    --condition=None
done

if gcloud run services describe "${SERVICE}" --region=africa-south1 --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud run services add-iam-policy-binding "${SERVICE}" \
    --region=africa-south1 \
    --project="${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOY_SA}" \
    --role="roles/run.admin" \
    --condition=None
else
  echo "Service ${SERVICE} does not exist yet. Granting project-level Cloud Run admin so the first deploy can create it. After that deploy succeeds, remove the project binding and keep roles/run.admin on the service only."
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${DEPLOY_SA}" \
    --role="roles/run.admin" \
    --condition=None
fi

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/cloudbuild.builds.editor" \
  --condition=None
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/serviceusage.serviceUsageConsumer" \
  --condition=None
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/firebasehosting.admin" \
  --condition=None
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/serviceusage.apiKeysViewer" \
  --condition=None

if ! gcloud artifacts repositories describe cloud-run-source-deploy --location=africa-south1 --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create cloud-run-source-deploy \
    --repository-format=docker \
    --location=africa-south1 \
    --description="Cloud Run source deploys" \
    --project="${PROJECT_ID}"
fi
gcloud artifacts repositories add-iam-policy-binding cloud-run-source-deploy \
  --location=africa-south1 \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None

echo "Granting object admin only on Cloud Run and Cloud Build buckets, not on the whole project."
gcloud storage buckets list --project="${PROJECT_ID}" --format='value(name)' | while read -r bucket; do
  name="${bucket#gs://}"
  case "$name" in
    run-sources-*"africa-south1"|*"_cloudbuild")
      gcloud storage buckets add-iam-policy-binding "gs://${name}" \
        --member="serviceAccount:${DEPLOY_SA}" \
        --role="roles/storage.objectAdmin"
      ;;
  esac
done

PROVIDER="$(gcloud iam workload-identity-pools providers describe github \
  --project="${PROJECT_ID}" \
  --location=global \
  --workload-identity-pool=github-surgilog \
  --format='value(name)')"
echo
echo "GitHub environment: ${ENV_NAME}"
echo "Deployment branch: ${BRANCH} only"
echo "Required reviewer: DylanGeldenhuys"
echo "GCP_WORKLOAD_IDENTITY_PROVIDER=${PROVIDER}"
echo "GCP_SERVICE_ACCOUNT=${DEPLOY_SA}"
```

Do not grant `roles/editor`, `roles/firebase.admin`, `roles/firebaseauth.admin`, `roles/datastore.user`, or `firebaseauth.configs.update`. Do not grant `github-hosting-preview` or `githubHostingPreviewDomains`. Do not run `gcloud iam service-accounts keys create`. If the bucket loop prints nothing, the source bucket does not exist yet. Do not grant project Storage Admin. After the first source deploy creates `run-sources-...-africa-south1` and the `*_cloudbuild` bucket, run the bucket loop again.

### GitHub environment variables

Add these on the environment, not as repository variables or secrets. Repository values are visible to pull-request jobs. Environment values are visible only to the job that names that environment. A secret of the same name works if you prefer the value masked. The workflow accepts either.

GitHub → Settings → Environments → the environment → Environment variables:

| Environment | Deployment branches | Required reviewer | Variables |
| --- | --- | --- | --- |
| `development` | Selected branches: `dev` only | none | `GCP_WORKLOAD_IDENTITY_PROVIDER` = the `projects/NUMBER/.../providers/github` line. `GCP_SERVICE_ACCOUNT` = `github-deploy@theatre-tracker-2f2e5.iam.gserviceaccount.com` |
| `production` | Selected branches: `main` only | `DylanGeldenhuys` | The same two names, with the production provider name and `github-deploy@surgilog-prod.iam.gserviceaccount.com` |

Do not create the `dev` branch until the development environment and its two variables exist. The first push to `dev` deploys the live dev site and API. Production also waits until `config/prod.json` has the real web config and `"placeholder": false`. The workflow does not do that edit.
