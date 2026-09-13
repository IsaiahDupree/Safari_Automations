# Printables Publisher API (Safari)

This package turns a reviewed `cad-catalog` release bundle into a controlled Printables upload job. It resolves an existing Printables tab in any Safari window or creates a task tab in the current front window. It does not require a shared ownership lane, a reserved window, private Printables GraphQL mutations, or stored Printables credentials.

The service is intentionally draft-first:

`created → validated → draft_prepared → browser_draft_created → publish_approved → published`

Publication requires a separate, exact-bundle approval after the browser draft exists. The one-time approval nonce is never stored in plaintext. Until the live Printables create-model page is captured and verified in Safari, browser draft creation and publication fail closed.

## Start

Use any available Safari window signed into Printables; the task may create its
own tab and run alongside other browsers and agents. Then:

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

## Live selector activation

`selectors/printables.v1.json` is deliberately `pending_live_capture`. After Safari is open and authenticated, call `/api/printables/browser/inspect`, identify unique stable controls, exercise one approved pilot as a draft, verify the saved draft by reading it back, and only then change the contract to `verified`. The draft executor never clicks the final publish control.
