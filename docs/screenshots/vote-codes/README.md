# Vote-code review screenshots

Captured from the isolated local Chromium flow with `testMode: true`, fictional proposals/counts and disposable room/vote codes. No production database, credentials, cookies or codes were used. Captured before opening the PR; these are the final mesa-only-authoring screens.

- `vote-entry-mobile.png`: participant four-letter code entry; no city selector or submission link.
- `active-vote-mobile.png`: one admitted proposal and its three vote options, with no proposal-switch control.
- `closed-result-mobile.png`: persistent final digital/physical/combined counts and an explicit back-to-start action.
- `mesa-proposal-creation.png`: proposal authoring within the authenticated city/room mesa.
- `vote-code-mesa.png`: the four-letter code the mesa announces for its active formal vote.

The screenshots include visible keyboard focus where the flow moved focus. Run `npm run test:browser` with the pinned Node/Playwright environment to regenerate `test-results/`; only sanitized review images are copied here.
