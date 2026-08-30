# Aither Weather — handoff

**Version:** V28 · **Stack:** vanilla JS, no build step, no API keys
**Repos:** `gwallee/Fanuc` (branch `claude/what-the-wether-v8-3a1l7b`) · `gwallee/What-The-Weather` (`main`, live site)
**Tests:** 763 checks across 28 Playwright suites, all green at the time of writing

---

## What this is

A dark/neon weather web app that also ships as a desktop app. It works with **no
API key, no account and no server** — every data source it uses is free and
key-less. It installs as a PWA and keeps working offline from a cached snapshot.

The one optional exception is the Wether Bot's Gemini mode, which needs a key
*you* supply and which is off by default. Everything else works without it.

---

## Running it

**In a browser — there is no build step.** Serve the folder over HTTP and open it:

```bash
python3 -m http.server 8000     # or any static server
# then open http://localhost:8000
```

`file://` will *not* work: the service worker and the module load order need a
real origin.

**As a desktop app:**

```bash
cd desktop
npm install
npm start                 # run it
npm run dist              # build installers into desktop/dist
```

---

## How it fits together

Load order matters — `index.html` loads plain `<script>` tags in dependency
order, and there is no bundler to sort it out for you.

```
config.js        Every constant, default and endpoint. Start here.
storage.js       localStorage wrapper (prefix wtw:)
themes.js        Theme switching
units.js         °F/mph/miles/inHg in, chosen units out. One place.
icons.js         Weather icons + interface icons, all drawn as SVG
weatheranim.js   The sky: full-page backdrop + the strip under the hero
tiles.js         The detail tiles and their small drawings
metricsheet.js   The sheet a tile opens, and its chart engine
normals.js       Climate normals from the Open-Meteo archive
local-ai.js      The built-in roast generator (template pools)
gemini.js        Optional: the bot on your own Gemini key
nws.js air.js rain.js precip.js   Data sources
map.js radarsource.js radar.js    The radar and its basemap
hourly.js tempchart.js compare.js share.js search.js downloads.js auth.js
desktop-extras.js   Desktop-only powers; completely inert in a browser
app.js           The conductor: state, rendering, event wiring
sw.js            Service worker — precaches the shell, caches last data
```

### The rules the code follows

These are worth keeping, because most of them were learned the hard way:

1. **One canonical unit system.** Everything internal is °F, mph, miles, inHg,
   inches. Conversion happens once, at display time, in `units.js`. Note that a
   *temperature difference* converts differently from a temperature —
   `tempDelta()` exists for that and is not optional.
2. **Never invent data.** If a figure is unavailable, the app says so or hides
   the tile. There is no Averages tile without real history; the moon sheet says
   plainly that moonrise is not published by any source used here.
3. **Past and future are drawn differently.** Dashed vs solid, everywhere a
   chart mixes observation with forecast. A prediction is never badged as live.
4. **Every fact a drawing shows must exist as words too.** Canvases are
   `aria-hidden`; the same information appears in text for a screen reader.
5. **Failure falls back, it does not error.** Every optional source — Gemini,
   the archive, RainViewer, NWS, air quality — degrades to something useful.
6. **No secrets in the repo, ever.** Browser client IDs are public by design and
   live in `config.js`. The Gemini key lives only in the user's browser, outside
   the app's storage namespace so the account transfer code cannot carry it.

---

## Settings, and where they live

All in `config.js` `defaults`, persisted by `storage.js`. The look is applied by
`applyLook()` in `app.js`, which sets data attributes on `<html>` —
`data-cards`, `data-corners`, `data-density`, `data-radar`, `data-sky`,
`data-daynight` — and `styles.css` does the rest. **Adding a look option is a
label in `config.js` and a block in `styles.css`, nothing else.**

---

## The desktop app

`desktop/main.js` (main process), `desktop/preload.js` (the bridge),
`desktop-extras.js` (the renderer side).

It updates itself from **GitHub releases** via `electron-updater`, reading the
`latest*.yml` feed that `electron-builder` attaches to each release. The release
workflow uploads those files — **without them an installed copy has nothing to
read and will never see a new version.**

It checks on launch and **downloads nothing until asked.**

Four things it does that a browser tab cannot: replace its own version, put the
temperature in the system tray, raise severe-alert notifications with the window
closed, and offer launch-at-login / always-on-top / close-to-tray.

Security posture, which should not move: `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, and a preload exposing a small
**named** surface — never `ipcRenderer` itself. Nothing on that surface accepts a
path, a URL or a command from the page.

### Cutting a release

```bash
git tag v28.0.0 && git push origin v28.0.0
```

The `desktop-release.yml` workflow builds Windows, macOS and Linux, and publishes
the installers plus the update feed.

---

## Testing

```bash
npm install
npx playwright install chromium
node tests/run.js              # everything
node tests/run.js v28 smoke    # only matching suites
```

Every network call is stubbed. Suites are cumulative: `vN.js` covers what
version N added, and older suites are the regression net.

**Two things to know about the tests:**

- The deny-all route uses a **predicate**, not the glob `https://**` — that glob
  matches nothing in current Playwright and silently lets everything through.
- Several checks are deliberately written against *measured* behaviour rather
  than a container or a class name, because the container version passed while
  being wrong. If you find yourself asserting on a selector, ask what the claim
  actually is.

---

## Known gaps and honest caveats

| | Status |
| --- | --- |
| Gemini in a real browser | **Not verified.** The dev sandbox's proxy closed the browser's tunnel to Google. The key, the API and CORS were verified directly; the in-browser wiring is covered by stubs only. |
| Desktop app | **Not run.** The sandbox has no display and cannot run Electron. Covered by config assertions and a stand-in bridge. The update flow has never been exercised against a real release. |
| All browser testing | Runs against Playwright route stubs, not live weather APIs. |
| Moonrise / moonset | Not published by any free source used here. Deliberately absent rather than estimated. |
| Averages tile | Ten years of archive, not the 30-year WMO normal — and it says so. |
| Sign-in | **Not authentication.** No server verifies any token. It provides a name and a picture and must never gate anything security-sensitive. |

## If you pick this up next

1. **Cut `v28.0.0` and confirm the first real desktop update.** That is the
   single biggest unverified path.
2. **Try Gemini in a real browser.** If it fails, the service worker serving a
   stale shell is the first suspect — Settings → Force update.
3. The sticky condensed header from Apple's app (city + temp pinned while you
   scroll) is the most obvious remaining visual gap.
