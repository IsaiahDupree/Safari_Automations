# Printables Publisher API (Safari)

This package turns a reviewed `cad-catalog` release bundle into a controlled Printables upload job. It discovers a matching Printables tab across every Safari window and otherwise opens one in an available window. It has no fixed-window, singleton, shared-claim, presence, or screen-lock gate. It does not call private Printables GraphQL mutations or store Printables credentials.

The service is intentionally draft-first:

`created → validated → draft_prepared → browser_draft_created → publish_approved → published`

Publication requires a separate, exact-bundle approval after the browser draft exists. The one-time approval nonce is never stored in plaintext. The selector contract was verified with private draft `1840792`; the public endpoint refuses any changed digest, stale nonce, unverified selector contract, or missing browser read-back.

## Start

Open any Safari session signed into Printables. Then:

```bash
cd "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/printables-publisher"
export PRINTABLES_PUBLISHER_TOKEN="$(openssl rand -hex 32)"
npm start
```

The server binds only to `127.0.0.1:3112`. Keep the token in the caller's environment or secret store; do not commit it.

## API

- `GET /api/health` — unauthenticated liveness only.
- `GET /api/printables/browser/status` — managed Safari and selector state.
- `GET /api/printables/browser/inspect` — read the task-selected Printables tab's form controls for selector capture.
- `GET /api/printables/selector-contract` — current selector contract.
- `POST /api/printables/jobs` — create a job from `{ "bundlePath": "..." }`.
- `POST /api/printables/jobs/:id/validate` — verify containment, file types, metadata, symlink policy, and every SHA-256.
- `POST /api/printables/jobs/:id/prepare-draft` — freeze the validated job for browser entry.
- `POST /api/printables/jobs/:id/execute-draft` — create an unpublished browser draft after selector verification.
- `POST /api/printables/jobs/:id/approve-publish` — approve the exact draft and digest with the exact statement `I approve publishing this exact release`.
- `POST /api/printables/jobs/:id/publish` — requires the one-time nonce and a verified publish contract.
- `POST /api/printables/jobs/:id/cancel` — cancel a nonterminal job.

All endpoints except health require `Authorization: Bearer $PRINTABLES_PUBLISHER_TOKEN`.

## Release requirements

The bundle must be inside `PRINTABLES_STAGING_ROOT` (default: `cad-catalog/publisher-output/models`) and contain:

- `manifest.json` with SHA-256 values and `network_writes_performed: false`;
- `printables.json` with a nonempty title, explicit licence, GitHub/request URLs, CAD files, and one preview;
- a useful `README.md` description;
- no symlinks or paths escaping the bundle.

Every submitted CAD and preview file must be covered by the manifest. Jobs and approval hashes remain local under `data/jobs/` and are ignored by Git.

## Live selector contract

`selectors/printables.v1.json` records the verified create-model controls. Pilot draft `1840792` read back its title, summary, category, tags, license, original authorship, AI-assisted disclosure, archive, six previews, and unpublished state. Draft execution never enables the published toggle. Only the separately approved publish endpoint may arm the public state, submit the form, and then read the public model page back.

The executor resolves the selected tab by stable window ID for each operation, refuses to overwrite a different unsaved form, and can resume the exact same release after an interrupted upload.
