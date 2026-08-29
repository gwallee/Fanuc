# Tests

Browser tests for Aither Weather. They drive the real app in Chromium
via Playwright, with every external service stubbed — so the suite is
deterministic, needs no API keys, and works offline.

## Running

```bash
npm install
npx playwright install chromium   # one-time browser download
npm test                          # every suite
node tests/run.js v13 smoke       # only suites whose name matches
```

`tests/run.js` serves the project on a free port and runs each suite
against it, then prints a combined summary. Nothing is written to your
project and no global state is touched.

## What each suite covers

| Suite | Covers |
| --- | --- |
| `smoke.js` | Core journey: search, forecast, favorites, settings, themes, radar controls, state restore, mobile layout |
| `accuracy.js` | Station distance and staleness rejection, unknown-vs-zero rendering, evening high/low backfill, unit conversion table |
| `nws-smoke.js` | NWS observation/forecast path and the Open-Meteo fallback |
| `ai-coverage.js` | Every personality × weather category produces clean, varied, placeholder-free roasts (runs in Node, no browser) |
| `roast-layout.js` | The roast is built into the weather card |
| `v9.js` | Hourly outlook, PWA manifest and icons, map radar, Local AI 3.0 |
| `v10.js` | Fullscreen radar: tap, button, keyboard, Escape, drag-vs-tap |
| `v11.js` | Units and clock across every surface, air quality, nowcast, compare grid, notifications |
| `v12.js` | Rain source ordering and interval expansion, temperature trend chart |
| `radar-accuracy.js` | Radar frames come from the published index at real timestamps; staleness labelling |
| `fs-fix.js` | Native fullscreen actually engages; network-first document caching |
| `forceupdate.js` | Version readout and the cache-clearing force update |
| `sw-offline.js` | Service worker precache and the offline snapshot path |
| `downloads.js` | Desktop download panel, asset grouping, and the reorganised header |
| `auth.js` | Optional Google sign-in: unconfigured behaviour, sign in/out, username handling, malformed tokens |
| `v13.js` | Alerts over the map, radar timeline scrubbing, share cards |
| `v16.js` | The sign-in screen itself: providers offered, guest continue, sign out |
| `v17.js` | An account with no client ID, and the transfer code that moves it |
| `v18.js` | The day view: the day tapped, its own hours, its own roast |
| `v19.js` | Drawn weather icons, the centred hero, yesterday's comparison, the customisation settings |
| `v20.js` | Drawn interface icons on every button, and the animated sky under the weather |

## Environment

| Variable | Purpose |
| --- | --- |
| `WTW_BASE_URL` | Test against an already-running server instead of the built-in one |
| `WTW_APP_DIR` | Project directory, when it isn't the parent of `tests/` |
| `PLAYWRIGHT_CHROMIUM` | Explicit Chromium path, if Playwright can't find one |

## Notes

Every network call is stubbed, including deliberately hostile cases:
stale observations, stations too far away, missing fields, failed
sources, a poisoned cache. A suite failing usually means real
behaviour changed — check the assertion before changing the test.
