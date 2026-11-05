# Mesa proposal selection

`new-proposal-open.png` shows the selected proposal and its **Abre votação** action after creation. It comes from the isolated local browser fixture through `api/index.js`, with the API rewrite from `vercel.json` simulated before the production handler runs. The code, text and credentials are fictitious; no hosted database or production session is used.

The browser flow also opens this new proposal, saves zero card counts, closes it and reads the final result. Data/API regression coverage verifies that the selected proposal survives the hosted rewrite, unknown proposals return 404 and city authentication stays separate.
