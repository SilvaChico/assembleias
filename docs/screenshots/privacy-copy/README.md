# Participant privacy copy review

Captured and visually inspected before opening the privacy-copy pull request, using an isolated local in-memory database on Node 22.23.4 and Chromium. No production credentials, participant data, vote codes or room codes appear in these images.

- `entry-mobile.png`: unchanged four-letter vote entry and short privacy line, 375 × 812.
- `dialog-mobile.png`: revised privacy dialog, 375 × 812.
- `dialog-desktop.png`: revised privacy dialog, 1280 × 900.

The disposable local fixture also set the response's hosted flag to true to exercise the former hosted-only notice condition, without contacting an external database. Additional checks covered 320 × 740, 667 × 375, 200% text at 320 px, keyboard opening/closing and focus restoration. No horizontal overflow, browser errors or external requests were observed.
