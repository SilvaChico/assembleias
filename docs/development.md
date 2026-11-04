# Development and releases

The canonical source is [SilvaChico/assembleias](https://github.com/SilvaChico/assembleias). The repository is public with the user's explicit approval because the current GitHub plan cannot enforce branch protection on a private repository.

## Local checks

Use the exact Node version in `.node-version` and run:

```sh
npm ci
npm run check
npm test
npx --no-install playwright install chromium
npm run test:browser
```

The browser test starts its own loopback server and in-memory SQLite database, creates fictional proposals and random test credentials, then shuts everything down. It covers participant and chair contexts, cross-tab repeats, refresh/retry after a lost response, reconnecting after closure, physical counts, combined results and city separation. The API suite also checks late votes, immutability, invalid counts, stale revisions, persistence and concurrent duplicate requests.

GitHub Actions runs **Static checks**, **Data and API**, and **Browser flow** on every PR and on `main`. Each job uses `npm ci`, a pinned Node patch and GitHub Actions pinned by commit SHA. Workflow permissions are read-only and checkout does not retain authentication. CI has no application secrets, does not load `.env`, and refuses a non-empty `APP_URL` for browser tests. Only fictional test screenshots are uploaded on failure, for seven days; cookies, browser traces, databases and environment files are not artifacts.

## Branches and merging

Use a `codex/` branch and a pull request. `main` requires the three stable checks above against an up-to-date branch. The PR requirement also applies to administrators, force pushes and deletion are disabled, and the required number of human approvals is zero. Repository owners can still edit repository settings; branch protection is not an immutable policy outside the owner's control.

The first `main` commit contained only GitHub's generated README. The application and CI are introduced together through the setup PR, with the protection already enabled.

## Vercel

Keep the existing `assembleias` project and Turso database; do not create replacement projects or databases. `main` is the production source and feature branches/PRs get protected preview deployments. Production uses the existing private Vercel environment settings and Ireland region.

CI deliberately runs locally instead of using the hosted database. Production database credentials must not be made available to unmerged preview code. Without a separate preview data environment, previews are for interface review; their API must fail closed when server credentials are absent. The complete voting flow is tested in CI's isolated server. Do not replace shared production storage with a function-local file or in-memory imitation.

Never commit `.env`, `.data`, SQLite files, credentials, bypass links, logs, browser state or screenshots. `.env.example` contains names and empty placeholders only. Install dependencies through the lockfile; no production secrets belong in Actions or PR artifacts.
