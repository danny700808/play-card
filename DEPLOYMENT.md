# Deployment guide

## Canonical Firebase Functions source

The only Firebase Functions source deployed by this repository is [`functions/`](functions/), as configured in [`firebase.json`](firebase.json). The root-level `index.js` and `package.json` are legacy files and must not be used to install or deploy Functions dependencies.

Run local checks from the repository root:

```bash
cd functions
npm ci
find . -type f -name '*.js' -not -path './node_modules/*' -exec node --check {} \;
```

Pull requests that touch Functions or deployment configuration run `.github/workflows/functions-pr-ci.yml`. It verifies installation, JavaScript syntax, the Firebase project/source configuration, required exports and the production dependency audit. Existing non-critical advisories are reported as warnings; critical advisories fail the check.

## Production deployment

`.github/workflows/firebase-functions-deploy.yml` is the only active deployment workflow. A matching push to `main`, or a manual workflow dispatch, deploys **Functions only** to `youzi-c1b74`.

The workflow requires the repository secret `FIREBASE_SERVICE_ACCOUNT_YOUZI_C1B74`. It validates that the secret is non-empty JSON for the expected project before creating a temporary credential file. Functions runtime secrets must remain in Google Secret Manager and must never be committed or generated as `.env` files in CI.

Hosting, Firestore Rules and Storage Rules are intentionally excluded from this workflow. They require separate review, authentication migration and rollback planning before any production deployment is enabled.
