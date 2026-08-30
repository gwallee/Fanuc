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
| `v21.js` | The weather-driven sky, the detail tiles and their sentences, contrast over the sky, and the four look settings |
| `v22.js` | Reading order on screen (not in the DOM), the hero off its card, the hour row with its sun events, and the air-quality tile |
| `v23.js` | Rain amounts, gusts, the measured barometric trend, climate normals (including the cases that must produce no tile), the hourly sentence, and the place footer |
| `v24.js` | The optional Gemini bot: that no key is committed, that it is off by default, that every failure falls back to the local bot, and that the key never leaves the browser or the transfer code |
| `v25.js` | The per-metric day sheets: that each reads its own series on the chosen day, that the past is drawn differently from the future, that summaries follow the data, and that a day with no data says so |
| `v26.js` | A blank name (and roast lines that read as though they never had one), the bot switched off entirely, the four table sheets, and the radar's opacity, speed and frame stepping |
| `v28.js` | The radar saying only what is worth saying, and the desktop build: GitHub updates that ask first, tray weather, desktop preferences, and a browser left exactly as it was |

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
