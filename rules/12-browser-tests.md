## Browser Tests

If `http://127.0.0.1:9222/json/version` responds, drive that shared headless Chrome for browser tests, screenshots, and GPU timings instead of launching a browser. Follow the `browser-testing` skill: serve on `127.0.0.1` ports 41000–41999 and use a fresh browser context per run.
