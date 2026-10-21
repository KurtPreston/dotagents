---
name: browser-testing
description: Run browser tests, screenshots, and GPU timings against the shared headless Chrome at http://127.0.0.1:9222 instead of launching a browser. Use when a task drives a browser through puppeteer, Playwright, or the DevTools protocol.
---

# Browser Testing

Some hosts run a shared headless Chrome (agenthost's `browser` role) for agents.
It runs as its own account with the real GPU, so it works from a sandboxed
session that cannot launch a browser, and its timings reflect real hardware.

## Check for it

```sh
curl -s --max-time 2 http://127.0.0.1:9222/json/version
```

If that answers, use the shared browser. If not, launch a browser as the
project normally would.

## Serve on 41000–41999

The shared browser can reach only loopback ports 41000–41999. Bind dev servers
to `127.0.0.1` in that range, never `0.0.0.0`. With Vite, `port: 41000` and
`strictPort: false` takes the next free port when another agent holds 41000.

## Connect, isolate, and clean up

Every agent shares one browser. Open a fresh context per run, close it when
done, and disconnect rather than closing the browser.

```js
// puppeteer
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222" });
const context = await browser.createBrowserContext();
const page = await context.newPage();
// ... test ...
await context.close();
await browser.disconnect();
```

```js
// Playwright
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = await browser.newContext();
// ... test ...
await context.close();
```

## Limits

- Launch flags are fixed by the daemon; a test that needs its own flags, such
  as forcing SwiftShader, must launch its own browser.
- Agents running GPU timings at the same time share the GPU. Run one timing
  pass at a time and say so when results may be contended.
- `file://` URLs and the internet are unreachable from this browser by design.
