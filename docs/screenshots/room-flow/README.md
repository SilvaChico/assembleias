# Room-flow review screenshots

Captured from `tests/browser.mjs` using an isolated local in-memory database and randomly generated test credentials/codes. No production data, passwords, cookies, browser state or production room codes are included. Room codes shown here are fictitious and disappear when the test server exits.

- `participant-entry.png`: entry asks only for a shared room code and gives the short privacy message.
- `room-proposals.png`: an admitted participant sees the room context and its proposals, without a city selector.
- `mesa-rooms.png`: the city-authenticated mesa can select a room, create/open another and share its code.
- `privacy-details.png`: short local privacy details with keyboard-accessible dismissal. Hosted installations additionally explain that Vercel receives the browser connection IP.

These four intentionally reviewed documentation images are the exception to the rule against committing generated browser output. All ordinary `test-results/` files remain ignored. Regenerate with the isolated browser suite, review each image and copy only these intended views.
