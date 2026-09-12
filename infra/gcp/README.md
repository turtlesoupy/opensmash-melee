# OpenSmash release builds on Google Cloud

Project: `fun-opensmash-builds`, under the `fun.inc` organization.
Region: `us-central1`. Private bucket: `gs://fun-opensmash-builds-artifacts`.

Cloud Build's `desktop-release` trigger listens to **version tags only**:
`v0.2.1` or `v0.2.1-rc.1`. The tag must match `desktop/package.json` exactly.
Regular pushes and PRs do not launch the release builders. The old GitHub desktop
packaging workflow is manual-only. No always-running CI machine is installed on
this Mac or on tj64-forge.

## Release flow

1. Develop and validate the launcher locally with `python tools/dev_desktop.py`.
2. Update the desktop version, commit, then push that commit and its version tag.
3. Cloud Build stages the exact tagged source and starts temporary Linux and
   Windows VMs. They reuse the private engine and character payloads. Missing
   engine payloads are compiled once and saved for later releases.
4. Each platform runs service tests and the packaged ISO-gate smoke check before
   uploading archives, checksums and source metadata under
   `releases/<tag>/<platform>/` in the private bucket.
5. Download those files with `gcloud storage cp --recursive` when publishing a
   GitHub release. Cloud Build's GitHub app has read access to source and write
   access to checks/statuses, not permission to publish GitHub release assets.

**macOS still needs Apple hardware.** Both Mac engine payloads are stored in the
bucket, but GCP does not replace the Mac application-packaging step. Use the local
Mac packaging scripts or the manual GitHub fallback on a Mac runner. This GCP
trigger automates Linux and Windows; it does not claim four-platform packaging.

`release.json` is the central configuration for the project, bucket, VM size,
maximum duration and versioned inputs. Bump the runtime tag for native changes;
launcher-only changes reuse the runtime. The first Windows/Linux engine build is
still pending validation; creating infrastructure is not evidence those apps run.

## Cost and cleanup

- No persistent builder VMs or boot disks. Both builders are `c3-standard-44`, sized so a fresh engine compile finishes in minutes; they still auto-delete on completion and at the max run duration.
- A VM is deleted in the coordinator's `finally` block, with its boot disk.
- Compute Engine independently enforces a two-hour maximum runtime and DELETE
  termination action, including if the coordinating build is interrupted.
- Startup scripts report completion/failure for prompt deletion. They leave the
  VM running if the coordinator disappears, so its independent delete deadline
  stays active. No inbound firewall ports.
- Source snapshots and build logs expire after 14 days; compiler caches after
  30 days. Versioned inputs and release outputs are retained.
- A project-filtered **$10 monthly budget alert** is configured at 50%, 90%, and
  100%. This is a notification threshold, **not a spending cap**. Multiple release
  tags can each start builds; the timeout limits each VM, not total monthly spend.
- Windows license, VM, disk, public IP, Cloud Build coordination and storage
  charges can apply. Cached app releases still install their build tools on fresh
  VMs; no paid idle machine or long-lived Windows disk is retained.

The service accounts use attached VM/Cloud Build identities. No personal GitHub
PAT or downloadable service-account key is copied onto builders. The Cloud Build
GitHub app is restricted to `turtlesoupy/opensmash-melee`.

## Operations

After initial GitHub authorization, `bash infra/gcp/connect-trigger.sh` creates the
repository link and tag trigger. Inspect the existing trigger instead of silently
replacing its policy on reruns.

Run the bounded infrastructure check explicitly:

```sh
gcloud builds submit . --config=infra/gcp/smoke.yaml \
  --gcs-source-staging-dir=gs://fun-opensmash-builds-artifacts/jobs/smoke-source \
  --project=fun-opensmash-builds --region=us-central1 --account=thomas@fun.inc
```

It boots both OSes, verifies their bucket credentials, writes success, and deletes
them. It does not compile Melee or build an app. Smoke VMs expire after 10 minutes.
Inspect `jobs/<build-id>/<platform>/serial.log` for bootstrap failures and
`build.log` for compiler/package failures. Failed builds never publish successful
completion records.

Private inputs were copied from the existing verified local release caches:
`inputs/desktop-inputs-v3/native-inputs-v3.tar.gz`,
`inputs/desktop-characters-v1/characters.tar.gz`, and the two Mac ZIPs under
`inputs/desktop-runtime-v1/`. No ISO or extracted game filesystem is staged.

## Infrastructure validation

The 2026-09-10 smoke run verified Linux and Windows VM provisioning and bucket
writes using the attached service account. The Windows run also parsed the actual
release startup script with Windows PowerShell. A byte-array metadata decoding
issue was corrected during this check. Local tests: 74 passed, including release
ref validation and cleanup on provisioning failure. Full application compilation
is deliberately deferred to a release tag.
