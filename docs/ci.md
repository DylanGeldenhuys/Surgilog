# Continuous integration and pull request previews

GitHub Actions runs two workflows. Neither deploys the API, changes Firestore rules, or writes review data. Live Hosting at https://theatre-tracker-2f2e5.web.app stays a manual release; see [deployment](deployment.md).

## Checks

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`.

The fast job installs with `npm ci` (npm cache via `actions/setup-node`), then runs `typecheck`, unit tests, `format:check` and `build`. Node.js 22 matches the local requirement.

Emulator integration tests are a separate job. They need Java 21 and the Firebase Auth and Firestore emulators for `demo-theatre-tracker`, plus the local API. `scripts/ci-integration.mjs` starts that API only after `firebase emulators:exec` has set `FIRESTORE_EMULATOR_HOST`. The job runs `test:integration`, `test:admin` and `test:theatre`. It is separate so emulator download and the longer scenarios do not sit in front of the fast checks, and so a slow emulator startup cannot hide a type or unit-test failure. The emulators are the demo project only. They do not call `theatre-tracker-2f2e5`.

## Previews

`.github/workflows/preview.yml` runs on pull requests whose head branch is in this repository. Fork pull requests skip the job. The workflow builds the review web app with the existing API:

`https://theatre-tracker-api-54783611706.africa-south1.run.app`

It then deploys that `dist-review` build to a Firebase Hosting preview channel on site `theatre-tracker-2f2e5`. [FirebaseExtended/action-hosting-deploy](https://github.com/FirebaseExtended/action-hosting-deploy) reads `firebase.json`, so the workflow first runs `scripts/write-preview-firebase-json.mjs`. That step copies Hosting from `firebase.review.json` and omits Auth and Firestore. The workflow sets `channelId` to `pr` plus the pull request number, so a branch name is not part of the channel id. An automatic id can keep a `.` from the branch name, and the CORS pattern rejects that. The URL stays the same for later commits on that request and looks like:

`https://theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app`

Channels expire after 7 days (`expires: 7d`). The action posts and updates the preview URL on the pull request. Hosting's existing predeploy command performs a read-only `GET /health` against the review API. It does not deploy the API.

If the repository secret `FIREBASE_SERVICE_ACCOUNT_THEATRE_TRACKER_2F2E5` is missing or empty, the job does not fail and does not deploy. It warns in the log and posts or updates one pull-request comment that points here. After the secret is added, the next run removes that comment and deploys the channel.

## One-time setup

Do this once in project `theatre-tracker-2f2e5`, as the project owner. Do not grant this identity Editor, Firebase Admin, Cloud Run Admin, Datastore, or Firestore roles. Do not commit the JSON key.

1. Create a service account used only for preview Hosting deploys:

```sh
gcloud iam service-accounts create github-hosting-preview \
  --display-name="SurgiLog GitHub Hosting previews" \
  --project=theatre-tracker-2f2e5
```

2. Grant Hosting deploy access, and read-only access to the Firebase web API key. The Hosting action's CLI reads that key during deploy. Cloud Run Viewer is not required: this app does not rewrite Hosting to Cloud Run.

`roles/firebasehosting.admin` can also manage the live Hosting channel, not only preview channels. There is no Google-managed preview-only role. A leaked key for this service account can overwrite the live site's static files. Keep live releases on a separate identity. The manual live deploy in [deployment](deployment.md) stays on the owner account, not this service account.

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

4. Create a JSON key, store it as a GitHub secret, and delete the local file. The secret name must be exactly `FIREBASE_SERVICE_ACCOUNT_THEATRE_TRACKER_2F2E5`. The key is long-lived. A later replacement is Workload Identity Federation, so GitHub Actions can receive a short-lived token and no JSON key is stored. This workflow still uses the key.

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

`shared/runtime-config.ts` also allows `https://theatre-tracker-2f2e5--<channel>.web.app` and the matching `firebaseapp.com` host, and only when `FIREBASE_PROJECT_ID` is `theatre-tracker-2f2e5`. Other projects keep the explicit list. The live site is not matched by the pattern. This code is not running in Cloud Run until the next API release. Until that release, the preview page can load and the browser will block its calls to the review API. Deploy the API with the existing command in [review infrastructure](review-infrastructure.md) when you choose to release it. This workflow does not do that.
