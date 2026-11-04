# Mesa passwords

The city, rather than a named person, owns the mesa credential. Lisboa and Porto have separate credentials and sessions. Participants still enter with only their shared room code. There is no participant account, contact information, recovery email or external identity service.

## First access and ordinary changes

On startup, a city without a stored credential imports its existing `LISBOA_ADMIN_PASSWORD` or `PORTO_ADMIN_PASSWORD` once, provided it has at least 12 characters and at most 1024 UTF-8 bytes. There is no default or universal password. An absent/invalid seed leaves that city's login unavailable without blocking participant access. Concurrent startup inserts are conditional and cannot replace an existing credential.

The database stores the city, salted KDF hash, random credential version and required-replacement flag. Node's asynchronous scrypt uses `N=32768, r=8, p=3`, a random 16-byte salt and 32-byte output, with a bounded 64 MiB allocation limit. This is the [OWASP 32 MiB scrypt profile](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt); it uses Node 22's built-in implementation and adds no dependency. Passwords are never encrypted reversibly or returned to the browser. New passwords require at least 15 Unicode code points, at most 1024 UTF-8 bytes, exact confirmation and a value different from the current credential. No trimming or silent truncation is applied.

A temporary-password login creates a setup-only session lasting at most ten minutes. It cannot read rooms, codes or proposals or perform mesa room/voting actions. After choosing a replacement, the mesa gets a fresh ordinary session. Ordinary **Alterar palavra-passe** requires the current password and confirmation. The write atomically replaces the hash/version, clears required replacement, revokes every previous mesa session for that city and creates the initiating browser's new session. Other cities and participant room admission remain unaffected. Lost responses can require signing in with the newly chosen password; the old password is never automatically restored.

Logins and password operations retain shared database-backed attempt limits by city; no IP, browser identifier or participant identity is used. Cookies remain HttpOnly, SameSite=Strict, Secure on HTTPS and scoped to the city's admin API. Each authorized write checks the session, expiry, city and credential version inside its transaction. A login whose verified credential changed before session creation is rejected. Concurrent setup/change attempts have one winner; stale attempts must sign in again. Hashing happens outside the short write transaction. Normal sessions last up to eight hours; logout deletes the session. A changed server session secret invalidates sessions too.

After initialization, verification uses the database alone. Changing or removing environment password variables does not reset a city; after both cities are initialized, they can be removed. Do not delete credential rows to reset access. Never add an environment-password fallback when a stored credential fails verification.

## Migration and review

The additive schema migration creates `mesa_credentials` without rewriting rooms, proposals, categories, receipts or results. First credential initialization deletes legacy mesa sessions for that city, requiring the first-access flow; this is intentional. Existing room codes and participant admission remain unchanged. Startup is idempotent across subsequent restarts.

This PR is for review only: it must remain open, with no merge or production deployment by the implementing agent. A later authorized rollout will import the already-configured city passwords as temporary credentials and require each mesa to choose a new one. Keep the existing Turso database and Vercel project. Previews/CI must not receive production database credentials; full verification uses isolated local fixtures. Do not manually copy or recreate production data to test this flow. The migration test reconstructs the preceding schema and checks existing rooms, proposals, final counts and active receipts survive.

## Controlled operator recovery

Recovery requires an operator who already has authorized direct database access. There is deliberately no public recovery endpoint. Do not collect an email address or introduce a common recovery password.

1. Use the reviewed source on a trusted machine, with the existing database credentials in a private, ignored environment file (for example `.env.operator`, readable only by the operator). Do not put secrets in command arguments, source control, CI, screenshots or chat. For a local database, configure `DATA_FILE`; for the existing hosted database, use `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Do not provision another database.
2. Run `node --env-file=.env.operator scripts/reset-mesa-password.mjs lisboa` (or `porto`) in an interactive terminal. This is a write to the selected city's credential, so first verify the intended database/environment locally.
3. Enter and repeat a new temporary passphrase using the hidden prompts. At least 15 characters are required, and it must differ from the current password. The utility never prints the password, database errors or credential values. It refuses piped input and command-line password arguments.
4. The utility conditionally replaces the previously read credential version, marks replacement required and deletes all that city's sessions in one transaction. If another operator/mesa changed it first, it fails rather than overwriting their change. A generic failure leaves access unchanged.
5. Share the temporary passphrase with the authorized mesa through an agreed private channel. On its next login, the mesa must choose a different password. The environment bootstrap password and pre-recovery password do not regain access. Remove the private operator environment file securely when finished, in line with the operator's credential-handling policy.

The script never deletes assembly data, exposes an HTTP recovery route, reads participant identifiers or silently re-enables bootstrap access. Stored hashes and old values can remain in database backups; this feature does not promise forensic erasure or provider log guarantees.
