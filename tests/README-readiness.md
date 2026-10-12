# Local readiness regression checks

These checks use synthetic local fixtures. They are not production acceptance,
physical-phone validation, a production load test, or proof of a real NAS restore.

`npm test` runs the original API suite, `readiness.test.mjs`, and the SQLite
snapshot consistency check. Use Node 24 (the snapshot check uses `node:sqlite`).
API suites require unused localhost ports 8931 and 8944 and installed Wrangler
dependencies. They apply both migrations to separate temporary local databases.
Do not run them with production credentials or source `.env` / `.dev.vars`.

The UI checks use the existing `cdp.mjs` fresh headless Chrome profile. They reject
non-local BASE URLs. Start an isolated seeded local app, then run the applicable
script with its synthetic ADMIN_USER / ADMIN_PASS and BASE configuration:

- `npm run test:e2e`: office nine-step flow, field, Owner, admin (34 checks).
- `npm run test:e2e:readiness`: slow responses/navigation, draft preservation,
  immediate photo rejection, seven email templates/conflict, escaping, pagination.
- `npm run test:e2e:privacy`: retry, save-copy/discard, logout/cache/cross-tab privacy.
- `npm run test:e2e:offline`: an already-open session queues a checkpoint and syncs.
- `npm run test:e2e:report`: English report/PDF/Excel, preserved entered text,
  Bangkok year boundaries, two-page A4 fixture, empty/closed jobs and role access.
- `npm run test:e2e:onboarding`: start with an admin-only, unseeded local database;
  checks form hints, the setup guide, active resources and storage warning UI.
  High-usage/error UI states are mocked; RD19-RD20 exercise the actual API.
- `npm run test:e2e:audit`: layout heuristics at six viewport widths; warnings need
  visual review. Emulation does not exercise real camera/GPS permissions or Safari.

Readiness RD01-RD20 cover simultaneous setup, role privacy, invalid settings,
closed-job protection, inactive assignments, confirm retries, GPS bounds,
account-cap concurrency, session invalidation, backup/export permissions,
photo limits/ACLs, Owner rotation, deletion, >200 jobs, email write conflicts,
generic authentication errors, the Owner closure expiry boundary, storage usage
permissions, configurable warning boundaries and unchanged capacity limits.
The API run has 44 checks including the original suite and BK01.

BK01 injects a write between independently awaited table reads using real SQLite.
The backup must remain relationally consistent; D1 `batch()` runs the reads as
a transaction. See https://developers.cloudflare.com/d1/worker-api/d1-database/ .
This tests the database snapshot, not atomicity between D1 and R2 photo objects.

Email template updates now require `mail_tpl_expected` containing the seven
template values loaded by that form. Missing precondition returns 428; a stale
revision returns 409 without saving. The UI keeps the draft. Do not mix template
updates and other settings in one request. Old open admin pages must reload.

Release prerequisites remain outside these tests: verify the intended Cloudflare
account, save/verify D1 plus R2 backups and rollback identity, apply migration0002
before publishing this code, then verify the live version and bounded test flow.
SETUP_KEY and first-admin credentials must be handled privately by the owner.
