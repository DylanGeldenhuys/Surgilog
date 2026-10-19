# Review backend infrastructure

Applied 5 October 2026 after Dylan confirmed owner Google Cloud sign-in and explicitly approved this plan. All changes below are confined to `theatre-tracker-2f2e5`. Cloud Run and Firebase Hosting are live; see [deployment](deployment.md) for release identifiers and verification. Leo’s account is deferred at Dylan’s request.

## Reviewable scope

- Enable `run.googleapis.com`, `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com` and `iam.googleapis.com`. All four were enabled successfully. Billing is already enabled; this plan does not change the billing account.
- Create dedicated `theatre-tracker-api` and `theatre-tracker-build` service accounts.
- Grant the runtime identity `roles/datastore.user` for application records/transactions and `roles/firebaseauth.viewer` for staff token revocation/disabled-account checks. These grants permit access to this review project's data and Firebase Auth user metadata and may take time to propagate.
- Grant only `roles/run.builder` to the build identity for source/container build operations. Application identity and build identity are separate. No downloaded service-account keys.
- Deploy `theatre-tracker-api` in Johannesburg (`africa-south1`), 1 vCPU, 512 MiB, zero minimum and two maximum instances, request-based CPU allocation, 30-second request timeout and concurrency 20. This bounds compute scaling, not the overall billing total.
- Use the Dockerfile and source allowlist already verified. Source deployment creates its regional artifact repository and managed build storage as needed. Build/storage/logging usage is billable under the linked account.
- Allow browsers to reach the HTTPS API; Firebase tokens and current hospital/department permissions remain mandatory on all application-data routes. The health endpoint is public. Only the two Hosting origins receive browser CORS access.

Sources: [Cloud Run source deployment](https://docs.cloud.google.com/run/docs/deploying-source-code), [Firebase Auth Viewer](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth), [Firestore data roles](https://docs.cloud.google.com/iam/docs/roles-permissions/firestore).

## Execution sequence

- **Step 1**: Syntax Validation via `gcloud help <leaf_command>`
- **Step 2**: Parameter Verification (confirming required and optional flags, and explicitly checking if the `--dry-run` or `--validate-only` flag is supported)
- **Step 3**: Dry-Run Command Proposal (If `--dry-run` or `--validate-only` is supported, there MUST be a `--dry-run` or `--validate-only` invocation before the next step.)
- **Step 4**: Command Proposal & Authorization (If the command is on the "Prohibited Operations" denylist, state that autonomous execution is forbidden, and the user MUST be explicitly asked for authorization to proceed. If the command is NOT on the denylist, propose or proceed with execution, while following *ALL* "Execution Constraints" below.)

The leaf help for `services enable`, `iam service-accounts create`, `projects add-iam-policy-binding` and `run deploy` was checked. None offers `--dry-run` or `--validate-only`. Dylan explicitly approved these API and IAM changes under the installed gcloud/IAM skills. Execution succeeded, and all three resulting project IAM grants were read back and verified. Recheck existing resources before repeating setup; do not create duplicate resources or broaden grants.

The selected owner signed in before execution. For a future deployment, renew this local Google Cloud login if needed:

```sh
gcloud auth login dylangeldenhuys1@gmail.com --quiet
```

The following approved commands were run separately:

```sh
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iam.googleapis.com --project=theatre-tracker-2f2e5 --account=dylangeldenhuys1@gmail.com --quiet
```

```sh
gcloud iam service-accounts create theatre-tracker-api --display-name="Theatre Tracker review API" --project=theatre-tracker-2f2e5 --account=dylangeldenhuys1@gmail.com --quiet
```

```sh
gcloud iam service-accounts create theatre-tracker-build --display-name="Theatre Tracker review builds" --project=theatre-tracker-2f2e5 --account=dylangeldenhuys1@gmail.com --quiet
```

```sh
gcloud projects add-iam-policy-binding theatre-tracker-2f2e5 --member=serviceAccount:theatre-tracker-api@theatre-tracker-2f2e5.iam.gserviceaccount.com --role=roles/datastore.user --project=theatre-tracker-2f2e5 --account=dylangeldenhuys1@gmail.com --quiet
```

```sh
gcloud projects add-iam-policy-binding theatre-tracker-2f2e5 --member=serviceAccount:theatre-tracker-api@theatre-tracker-2f2e5.iam.gserviceaccount.com --role=roles/firebaseauth.viewer --project=theatre-tracker-2f2e5 --account=dylangeldenhuys1@gmail.com --quiet
```

```sh
gcloud projects add-iam-policy-binding theatre-tracker-2f2e5 --member=serviceAccount:theatre-tracker-build@theatre-tracker-2f2e5.iam.gserviceaccount.com --role=roles/run.builder --project=theatre-tracker-2f2e5 --account=dylangeldenhuys1@gmail.com --quiet
```

```sh
gcloud run deploy theatre-tracker-api --source=. --region=africa-south1 --service-account=theatre-tracker-api@theatre-tracker-2f2e5.iam.gserviceaccount.com --build-service-account=projects/theatre-tracker-2f2e5/serviceAccounts/theatre-tracker-build@theatre-tracker-2f2e5.iam.gserviceaccount.com --env-vars-file=config/review-api.yaml --cpu=1 --memory=512Mi --min=0 --max=2 --concurrency=20 --timeout=30s --cpu-throttling --no-invoker-iam-check --project=theatre-tracker-2f2e5 --account=dylangeldenhuys1@gmail.com --quiet
```

The source build succeeded with the approved roles; no additional role grants were required. The regional source bucket and artifact repository were created by the deployment workflow.

Read-back verified ready revision `theatre-tracker-api-00001-h6k`, the dedicated runtime identity, Johannesburg location, zero-to-two instance settings, memory/CPU/concurrency/timeout and approved CORS origins. The client was built against the real endpoint and published. Fictional fixtures are installed; real reviewer provisioning is deferred. Cloud Auth, permissions, booking concurrency and recording checks passed. See [deployment](deployment.md).


## Admin feature extension — approved and applied, 6 October 2026

The local Admin tab now creates Firebase Auth users and password setup links. Auth Viewer alone cannot perform those two writes. Dylan explicitly approved the extension and publication (“yes for 2 please”). The applied extension is a project-only custom role containing exactly `firebaseauth.users.create` and `firebaseauth.users.sendEmail`, added only to the existing API service account. No full Firebase Auth Admin role, delete-user permission, broader project role or new API is requested. The role definition is in [review-user-provisioner-role.yaml](../config/review-user-provisioner-role.yaml).

These permissions let the runtime create identities and generate account action links. The API permits setup links only for newly created identities and checks delegation scope before and after Auth creation. Permission changes may take time to propagate; validate actual cloud account creation after applying. Sources: [Firebase IAM permissions](https://firebase.google.com/docs/projects/iam/permissions), [out-of-band link permissions](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/sendOobCode).

Use the same four-step syntax/parameter/dry-run/authorisation protocol above. `gcloud iam roles create --help` was checked; it has no dry-run/validate-only option. The binding command's leaf help was validated for the initial deployment. Owner access was verified. The role did not exist; the following approved commands were executed and the exact two permissions and API service-account binding were read back successfully:

```sh
gcloud iam roles create theatreTrackerUserProvisioner --project=theatre-tracker-2f2e5 --file=config/review-user-provisioner-role.yaml --account=dylangeldenhuys1@gmail.com --quiet
```

```sh
gcloud projects add-iam-policy-binding theatre-tracker-2f2e5 --member=serviceAccount:theatre-tracker-api@theatre-tracker-2f2e5.iam.gserviceaccount.com --role=projects/theatre-tracker-2f2e5/roles/theatreTrackerUserProvisioner --project=theatre-tracker-2f2e5 --account=dylangeldenhuys1@gmail.com --quiet
```

The custom role and binding were verified after application. Cloud Run revision `theatre-tracker-api-00002-tzd` and Hosting version `2d4d0d6b447ba94c` are published. All seven cloud Admin scenario groups passed, including actual runtime Auth creation, password setup and new-user sign-in. The existing runtime/build grants remain in place. See [deployment](deployment.md) for release details.
