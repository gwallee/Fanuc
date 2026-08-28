# What the Wether V12 ⚡🌩️

A dark/neon weather web app with a **real radar over a real map**, a 48-hour
outlook, 7-day forecasts, favorites, themes, offline support, and a built-in
**local AI** that roasts the weather (and you) — **no API keys required, ever.**

Installs to a phone or desktop as a standalone app, and keeps working with no
connection.

![What the Wether logo](logo.svg)

## Features

### 🌡️ Weather
- City / place search and US ZIP code search
- Current conditions: temperature (°F), feels-like, humidity, wind speed,
  high/low, rain probability
- 7-day forecast with icons, highs/lows, and rain chance
- Browser geolocation ("My Location")
- Refresh button
- **Two key-less sources, chosen automatically:**
  - [**National Weather Service**](https://www.weather.gov/documentation/services-web-api)
    (`api.weather.gov`) is used wherever it has coverage (US + territories).
    It's the authoritative US source, and it supplies observations from the
    nearest reporting station plus official watches and warnings.
  - [**Open-Meteo**](https://open-meteo.com/) covers the rest of the world and
    takes over automatically if NWS is unreachable or returns incomplete data.
- The active source is always shown under the current conditions, so
  you can see exactly where a number came from

### ✅ Accuracy safeguards

Weather is only as good as the reading behind it, so the NWS path
enforces a few rules before anything reaches the screen:

- **Station distance.** Candidate stations are sorted by true
  great-circle distance from the searched point, and any beyond
  `nwsQuality.maxStationKm` (default 40 km) are rejected — a reading
  from 80 km away is not your weather.
- **Staleness.** NWS keeps serving a station's last observation
  indefinitely, so an offline station will happily return this
  morning's temperature. Readings older than
  `nwsQuality.maxObsAgeMinutes` (default 90) are skipped.
- **Honest gaps.** A missing wind speed or precipitation chance
  renders as `--`, never as `0` — "unknown" and "calm" are not the
  same claim.
- **Observation time.** The card shows when the reading was actually
  taken, plus how far away the station is, e.g.
  *"Updated 1:43 AM · National Weather Service · KAUS (7 km away) ·
  observed 1:15 AM"*.
- **Same-day high/low.** Load the app in the evening and NWS no
  longer has a daytime period for today, so today's high would be
  blank. Those two numbers are backfilled from Open-Meteo, which
  reports the full calendar day.
- If no station qualifies, the app falls back to Open-Meteo rather
  than showing a stale or unrepresentative number.

### ⚠️ Severe weather alerts
- Active NWS watches, warnings, and advisories for the current location
- Colour-coded by severity (extreme/severe, moderate, minor)
- Hidden entirely when there's nothing active

### 🌍 Units, worldwide
Pick **Imperial** or **Metric** and a **12- or 24-hour clock** in Settings, and
every surface follows at once: cards, detail row, hourly chart axis, radar
range rings, station distance, the share card — and the roasts, which restate
themselves in your units.

Internally everything stays in one canonical set (°F, mph, miles, inHg) and is
converted once at display time, in `units.js`, so there is no mixed-unit maths
anywhere in the app.

### 🌬️ Air & Sky
- **Air quality index** with an EPA-coloured badge, plain-language advice, and
  the PM2.5 / PM10 / ozone / NO₂ breakdown
- **Pollen** where the upstream model publishes it. It covers Europe only, so
  elsewhere the row is hidden rather than showing zeroes that would read as
  "no pollen"
- **Moon phase** with illumination, computed locally from the synodic month —
  no network needed
- **Daylight length** and **solar noon**, derived exactly from sunrise/sunset

### 🌧️ Rain, from the most authoritative source available
Precipitation does **not** come from the same service as the rest of the
forecast. `rain.js` tries three independent sources in order and labels
whichever one answered:

1. **NWS forecast grid** (US) — the local forecast office's own quantitative
   precipitation forecast and probability grid: the numbers the public NWS
   forecast is actually built from. Values arrive as ISO-8601 intervals
   (`PT6H` and friends); amounts are spread evenly across the hours they
   cover, probabilities repeated across them.
2. **MET Norway** (worldwide) — an independent national met service, not
   another view of the same model.
3. **Open-Meteo** — a model blend, kept only as a last resort.

The nowcast panel names the source and the resolution, e.g.
*"NWS forecast grid · hourly data"*, so a figure can always be traced back.

"Precipitation starting in about 35m, lasting roughly 1h" — with a compact
two-hour strip underneath. With an hourly source the wording says "within the
hour" rather than implying minute precision the data doesn't have.

### 📈 Temperature trend
Tap the **High / Low** readout for a 7-day chart: both curves, a filled band
between them, labelled points, and day names — in your selected units.
Keyboard accessible, closes with `Escape` or a tap outside.

### 🗺️ Your Locations
Every saved favorite side by side — temperature, conditions, high/low and rain
chance at a glance, warmest first. Click any card to load it. One compact
request per location, run in parallel; a single failure shows that one card as
unavailable instead of emptying the grid.

### 🔔 Severe alert notifications
Optional browser notifications for extreme and severe NWS alerts, deduplicated
so a refresh doesn't re-notify. Opt-in, permission-gated, and honest about its
limit: there is no push server, so they fire only while the app is open.

### 🔍 Fullscreen radar
**Tap or click the scope** and it expands to fill the screen — bigger sweep,
same controls, timeline and zoom. Tap it again, press `Escape`, or use the
Fullscreen button to come back.

- Works everywhere: the overlay fills the viewport on its own, and where the
  browser grants the Fullscreen API it hides the browser chrome too. iOS
  Safari refuses that API for non-video elements, so the overlay is what
  makes this work there
- A **drag pans instead** — anything past 6px of movement is a pan, not a tap,
  so exploring the map never opens fullscreen by accident
- Keyboard accessible: the scope is a focusable control, `Enter`/`Space`
  toggles it
- Set `radar.fullscreenOnTap = false` in `config.js` to require the button

### 📡 Radar over a real map

The radar has two modes and always tells you which one you're looking at,
via the badge next to the status light.

**`LIVE RADAR` — real frames at real times (worldwide).** V12 fixed an
accuracy problem in how frames were requested. V9–V11 asked NOAA's WMS for
frames at *guessed* times — every 10 minutes, on the clock — but the mosaic
publishes on its own cadence, so a guessed timestamp could return the nearest
frame, a repeat of one already shown, or nothing. The loop could look wrong
even when the imagery was right.

Now the app reads [RainViewer's](https://www.rainviewer.com/api.html) published
frame index (free, no key) and draws exactly the frames that exist, at their
real timestamps. Every frame is a genuine observation and every timeline label
is the truth. The badge also reports **staleness**: if the newest frame is
older than `radarTiles.maxAgeMinutes`, it reads `RADAR (STALE)` instead of
claiming to be live, and its tooltip gives the frame age in minutes.

**`NWS LIVE` — NOAA mosaic (US fallback).** If the frame index is
unreachable, the app falls back to base-reflectivity imagery from
[NOAA's public GeoServer](https://opengeo.ncep.noaa.gov/) (`conus_bref_qcd`),
drawn over the basemap as before.

Every layer — basemap tiles, reflectivity, and alert polygons — is projected
in **EPSG:3857 (Web Mercator)** so they align exactly. (V8 requested radar in
EPSG:4326, which cannot be aligned with Mercator map tiles.)

- **Drag the scope to pan**, and zoom between 40 km and 400 km
- **Recenter** snaps back to your location
- Range rings are labelled in km
- Active NWS alert polygons are outlined on the scope
- Basemap from Carto (no key); attribution to OpenStreetMap and CARTO is
  displayed on the card

**`SIMULATED` — stylized fallback.** Outside NWS coverage, or if the imagery
service is unreachable, the scope falls back to the V8 simulation: multi-blob
storm cells seeded from the real current weather (precipitation probability,
weather code, wind speed and direction), with wind-driven drift across a
60-minute timeline. Never a blank box.

Both modes share the same instrument styling:
- Rotating sweep beam with fading glow and a bright leading edge
- Breathing range rings, bearing ticks, and an expanding ping
- Classic intensity colour scale (green → yellow → orange → red → magenta)
- Pulsing centre location marker
- Play / Pause, Stop, Refresh, and My Location controls
- Live status indicator, crisp on retina screens, resizes for mobile

### ⏱️ 48-hour outlook
- Scrollable hourly temperature curve with precipitation-chance bars
- Tap or hover any point for that hour's temperature and rain chance
- Drawn on canvas — no charting library, and it follows the active theme
- Hourly data comes from NWS where available, Open-Meteo elsewhere

### 🔎 Conditions detail
Sunrise, sunset, UV index, dew point, pressure (inHg) and visibility,
alongside the headline stats.

### 🤖 Local AI 3.0
- 100% local roast generator — no OpenAI, no ChatGPT, no cloud, no key
- **Six personalities:** friendly, sassy, rude, brutal, **deadpan**, **doomer**
- Reacts to temperature, rain, snow, thunderstorms, fog, wind,
  extreme heat, extreme cold, clouds, and clear skies
- **Tap any forecast day** to roast that day specifically
- **Roast history** — scroll back through past roasts, clear it in Settings
- **Share a roast** as a rendered image (Web Share on mobile, PNG download
  on desktop). The card is drawn locally; nothing is uploaded
- Big template pools + random openers + anti-repeat memory so it
  doesn't tell the same joke twice in a row
- Funny and rude, never hateful or discriminatory

### 📱 Installable + offline (PWA)
- Web manifest and icons: install to an iPhone/Android home screen or as a
  desktop app, opening fullscreen with its own icon
- A service worker precaches the app shell, so it launches instantly and
  **opens with no connection at all**
- The last successful forecast is saved and restored when you're offline,
  with a banner making clear it's not live
- Roasts keep working offline — the AI never needed a network

### ⭐ Favorites
- Save locations, remove them, click to load
- Stored in `localStorage`

### ⚙️ Settings
- **Username** (default: `DJTheBest`) — shown throughout the app and used
  by the roast bot; change and save it in Settings
- AI personality
- Automatic weather roasts on/off
- **Themes:** Neon Dark, Midnight, Light — implemented with CSS variables,
  no white/unstyled sections in dark themes
- Everything persists locally in your browser

## Running it

It's a plain static site — no build step, no server logic, no environment
variables.

```bash
# Option 1: just open it
open index.html          # macOS
start index.html         # Windows

# Option 2: serve it locally (nicer for geolocation permissions)
python3 -m http.server 8000
# then visit http://localhost:8000
```

Deploy anywhere static files work: GitHub Pages, Netlify, Vercel, an S3
bucket, a USB stick...

> **GitHub Pages:** Settings → Pages → deploy from the repo root of your
> default branch. Done.

## Project structure

```
WhatTheWether-V12/
├── index.html      # App shell / markup
├── styles.css      # All styling + the three themes (CSS variables)
├── app.js          # Main app: search, weather, favorites, settings
├── radar.js        # Animated canvas radar engine
├── local-ai.js     # Local AI 3.0 roast generator (offline)
├── units.js        # Imperial/metric + clock formatting (single source)
├── air.js          # Air quality, pollen, moon phase, sun figures
├── rain.js         # Chooses the most authoritative precipitation source
├── precip.js       # Nowcast analysis and wording
├── radarsource.js  # Timestamped radar frame index
├── tempchart.js    # 7-day temperature trend chart
├── compare.js      # Multi-location dashboard
├── nws.js          # National Weather Service client (obs, forecast, alerts)
├── map.js          # Web Mercator projection + basemap tiles
├── hourly.js       # 48-hour outlook chart
├── share.js        # Renders shareable roast cards
├── manifest.json   # PWA manifest
├── sw.js           # Service worker (offline shell + data cache)
├── icons/          # PWA icons (192, 512, maskable)
├── config.js       # Central configuration + defaults
├── storage.js      # Safe localStorage wrapper
├── themes.js       # Theme switching
├── logo.svg        # The logo (also used as the favicon)
├── README.md
├── .gitignore
├── assets/         # Extra static assets
└── desktop/        # Desktop packaging scaffold (Electron-ready)
    ├── README.txt
    ├── package.json
    └── main.js
```

Script load order matters and is already correct in `index.html`:
`config.js → storage.js → themes.js → units.js → nws.js → air.js →
rain.js → precip.js → tempchart.js → compare.js → map.js → radarsource.js →
hourly.js → share.js → local-ai.js → radar.js → app.js`.

## APIs used (all free, all key-less)

| Service | Purpose | Key required |
| --- | --- | --- |
| [NWS API](https://www.weather.gov/documentation/services-web-api) (`api.weather.gov`) | US observations, forecast, alerts | **No** |
| [NOAA GeoServer](https://opengeo.ncep.noaa.gov/) (`conus_bref_qcd`) | Live radar reflectivity imagery | **No** |
| [Open-Meteo Forecast](https://open-meteo.com/) | Worldwide weather fallback | **No** |
| [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | City/place search | **No** |
| [Zippopotam.us](https://api.zippopotam.us/) | US ZIP code lookup | **No** |
| [Carto basemaps](https://carto.com/basemaps/) | Map tiles under the radar | **No** |
| [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api) | AQI, pollutants, pollen | **No** |
| [NWS forecast grid](https://www.weather.gov/documentation/services-web-api) | US precipitation (QPF + PoP) | **No** |
| [MET Norway](https://api.met.no/weatherapi/locationforecast/2.0/documentation) | Worldwide precipitation | **No** |
| [RainViewer](https://www.rainviewer.com/api.html) | Timestamped radar frames | **No** |

MET Norway asks API clients to identify themselves with a User-Agent.
Browsers set their own and don't let scripts override it, so nothing is needed
here — but if you port this to a server or desktop runtime, set a contact
User-Agent there and respect their terms.

V9 asks NWS and Open-Meteo **in parallel**. NWS is authoritative for US
observations, forecasts and alerts; Open-Meteo covers the rest of the world
and fills the fields NWS doesn't publish (UV index, sunrise/sunset) or can't
supply late in the day (today's high). If NWS returns nothing usable,
Open-Meteo carries the whole app.

The NWS API asks clients to send an identifying User-Agent. Browsers set
their own and don't allow scripts to override it, so nothing is needed here —
but if you ever port this to a server or desktop runtime, set a contact
User-Agent there.

Radar imagery is drawn to the canvas but never read back (no `getImageData`
or `toDataURL`), so the cross-origin images work without CORS headers.

To turn live imagery off and always use the simulation, set
`radarImagery.enabled = false` in `config.js`. To drop the basemap, set
`map.enabled = false`.

## Installing as an app

Open the site in a browser, then:
- **iPhone/iPad:** Share → *Add to Home Screen*
- **Android:** menu → *Install app* / *Add to Home screen*
- **Desktop Chrome/Edge:** the install icon in the address bar

The service worker only registers over `https://` or on `localhost` — opening
`index.html` straight from disk works, just without offline caching.

## Upgrading

V11 needs no migration — V10 already moved to a **version-neutral storage
namespace** (`wtw:`), so from here on
upgrading never touches your data again. On first run it migrates your
username, favorites, settings, roast history, last location and saved
snapshot from the V9 or V8 namespaces, newest first. The old keys are left in
place, so downgrading loses nothing.

There is intentionally **no `.env.example`** — the app needs zero environment
variables and zero secrets.

## Desktop version

The `desktop/` folder contains an Electron-ready scaffold so the exact same
app can be packaged as a desktop application later. See
[`desktop/README.txt`](desktop/README.txt). The desktop version also requires
no API keys.

## Credits

- US weather, alerts and radar: [NOAA / National Weather Service](https://www.weather.gov/)
  (public domain)
- Worldwide weather fallback: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- ZIP lookup: [Zippopotam.us](https://api.zippopotam.us/)
- Basemap tiles: [CARTO](https://carto.com/), data ©
  [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Roasts: generated locally by Wether Bot, who is very sorry (it is not)
