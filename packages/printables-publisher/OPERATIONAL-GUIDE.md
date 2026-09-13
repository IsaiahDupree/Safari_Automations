# Safari-to-Printables Agentic Publishing

## Outcome

The local service at `127.0.0.1:3112` provides an agent-callable boundary between the private CAD catalog and Printables. It accepts only hash-covered release bundles inside the private staging root, discovers Printables across all Safari windows, creates drafts before publication, and requires a second exact-artifact approval before a public listing can be submitted.

No private Printables API is used. No browser password, cookie, account token, or CAD catalog is exposed by the service. Health is the only unauthenticated route.

## Workflow

1. Finish and physically review one Isaiah-created model.
2. Record its exact license, description, print settings, preview/photo, provenance, and publication approval in the private CAD catalog.
3. Stage it with `cad-catalog/publisher/publisher.py`. The output must include `README.md`, `printables.json`, `manifest.json`, CAD files, and a preview.
4. Create a local Printables job through the API.
5. Validate the bundle. This checks the staging-root boundary, blocks symlinks and traversal, verifies all SHA-256 values, and requires release metadata and a preview.
6. Prepare the draft. This changes local state only.
7. Execute the browser draft through a task-selected Safari tab. The executor must stop before publication and read the saved draft back.
8. Review the actual draft URL, title, description, license, files, cover image, print instructions, and GitHub link.
9. Approve that exact `bundleDigest` with the exact approval statement. Preserve the returned one-time nonce only for the immediate publish call.
10. Publish through the API. The executor rechecks the metadata, archive, previews, and public-state control before submission, then opens the public model URL and verifies its title and download surface.
11. Record the resulting Printables URL and mirror the same released files and metadata into the public GitHub repository.

## Initial activation

Use any Safari session signed into `printables.com`. The executor scans every window and opens a task tab when necessary; other windows, browsers, agents, human-presence state, and screen-lock state do not block it.

Generate a service token and start the API:

```bash
cd "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/printables-publisher"
export PRINTABLES_PUBLISHER_TOKEN="$(openssl rand -hex 32)"
npm start
```

Keep the token in an environment variable or secret manager. The `.env.example` contains names only and must never be filled with a real secret in Git.

## Selector verification and pilot

The versioned selector contract was captured and verified against the authenticated create-model form on 2026-09-12. Private draft `1840792` is the verification pilot.

After Safari is open and authenticated:

```bash
curl -sS \
  -H "Authorization: Bearer $PRINTABLES_PUBLISHER_TOKEN" \
  http://127.0.0.1:3112/api/printables/browser/status

curl -sS \
  -H "Authorization: Bearer $PRINTABLES_PUBLISHER_TOKEN" \
  http://127.0.0.1:3112/api/printables/browser/inspect
```

Re-capture the contract whenever Printables changes the form. Verify the signed-in profile handle is `Isaiah_Dupre_1141044`, and read back every field and file after a private pilot. The save-draft and publish controls must remain distinct.

## Agent contract

An agent may autonomously create, validate, prepare, inspect, and cancel local jobs for an already approved release bundle. Creating a Printables draft is an external account write and requires the authenticated Safari session plus the verified selector contract. A public publish requires a browser draft, the exact current digest, the literal approval statement, and the one-time nonce.

An agent must never:

- upload inferred or downloaded CAD merely because it appears in the local inventory;
- change a model's license to make it publishable;
- use internal Printables GraphQL mutations or replay browser credentials;
- create another browser instance or act in Safari Window 1;
- treat draft creation as permission to publish;
- reuse an approval after a release, file hash, or browser draft changes;
- report success without reading the resulting draft/listing back from Printables.

## FLSUN V400 release evidence

Before a full model is marked publication-ready, retain the source STEP/FCStd, repaired/exported STL or 3MF, slicer project/profile, G-code only when safe to distribute, print photos, fitment notes, material, nozzle, layer height, wall count, infill, support/orientation, and the exact tested V400 speed/flow overrides. Treat “speed 50” and “extrusion 75–85” as machine-side observations until their units and slicer fields are confirmed; do not silently encode ambiguous values into a public profile.

## Files

- API source: `packages/printables-publisher/src/`
- Selector contract: `packages/printables-publisher/selectors/printables.v1.json`
- OpenAPI description: `packages/printables-publisher/openapi.yaml`
- Local job receipts: `packages/printables-publisher/data/jobs/` (Git-ignored)
- Private staged releases: `cad-catalog/publisher-output/models/`
- Public mirror: `https://github.com/IsaiahDupree/3d-print-library`
- Printables profile: `https://www.printables.com/@Isaiah_Dupre_1141044`
