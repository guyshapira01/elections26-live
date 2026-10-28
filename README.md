# Elections 26 live dashboard

Static Hebrew dashboard hosted on Netlify with a server-side JSON API.

## Deploy
1. Create a GitHub repository, upload all project files (not the ZIP itself).
2. In Netlify, choose Add new project → Import an existing project → GitHub.
3. Select the repository. Build command `npm run build`, publish directory `public`.
4. After deployment open `/results.json` and then the homepage.

## Architecture
- `/results.json` redirects to a Netlify Function that downloads the official `expc.csv` on demand.
- The function uses a 60-second in-memory cache per warm instance and Netlify CDN caching for 60 seconds. Multiple instances may fetch independently. The browser polls every 60 seconds. This is NOT a guaranteed clock-driven job or durable on-disk results.json file.
- SHA-256 detects changed CSV bytes; the function validates that party totals match the valid vote total.
- If source fetch fails, warm instances return stale data; cold instances return HTTP 503.
- The displayed 120-seat allocation is **provisional**. Surplus agreements are empty by default until individually verified with an official source. Populate `VERIFIED_SURPLUS_AGREEMENTS` in `netlify/functions/results.mjs` with ballot symbols when verified.
- The source file is by locality and may omit special envelopes or other national ballot categories; do not present seat allocation as official final results.

## Local testing
Requires Node.js 20+ and Netlify CLI (`npm install -g netlify-cli`). Run `netlify dev`, then open the local URL.
