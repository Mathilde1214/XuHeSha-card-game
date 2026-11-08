# XuHeSha-card-game
This is a card battle game we created during our spare time in high school. My first year of high school was so incredibly fun and memorable that I turned every amusing anecdote or inside joke into a card. 

## Development checks

Use Node.js 22.18+ and run these commands from the repository root:

```sh
npm ci --prefix server
node --test engine/test/*.test.ts server/test/*.test.ts
node client/build.ts
```

Browser tests use Playwright Core and an installed Chromium-compatible browser.
Set `BROWSER_EXECUTABLE` to the browser executable, then run
`npm run test:browser --prefix server`. In PowerShell, set it with
`$env:BROWSER_EXECUTABLE = 'C:\path\to\chrome.exe'`.
The browser tests start and stop their own local game servers.
