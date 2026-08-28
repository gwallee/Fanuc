# What the Wether V9 ⚡🌩️

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

### 📡 Radar over a real map

The radar has two modes and always tells you which one you're looking at,
via the badge next to the status light.

**`NWS LIVE` — real radar (US).** Georeferenced base-reflectivity imagery
from [NOAA's public GeoServer](https://opengeo.ncep.noaa.gov/) (the
`conus_bref_qcd` mosaic — free, no key), drawn over an actual basemap so
storms sit against real geography. Six timestamped frames 10 minutes apart
build a genuine radar loop; the timeline scrubs them by clock time.

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
WhatTheWether-V8/
├── index.html      # App shell / markup
├── styles.css      # All styling + the three themes (CSS variables)
├── app.js          # Main app: search, weather, favorites, settings
├── radar.js        # Animated canvas radar engine
├── local-ai.js     # Local AI 3.0 roast generator (offline)
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
`config.js → storage.js → themes.js → nws.js → map.js → hourly.js →
share.js → local-ai.js → radar.js → app.js`.

## APIs used (all free, all key-less)

| Service | Purpose | Key required |
| --- | --- | --- |
| [NWS API](https://www.weather.gov/documentation/services-web-api) (`api.weather.gov`) | US observations, forecast, alerts | **No** |
| [NOAA GeoServer](https://opengeo.ncep.noaa.gov/) (`conus_bref_qcd`) | Live radar reflectivity imagery | **No** |
| [Open-Meteo Forecast](https://open-meteo.com/) | Worldwide weather fallback | **No** |
| [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | City/place search | **No** |
| [Zippopotam.us](https://api.zippopotam.us/) | US ZIP code lookup | **No** |
| [Carto basemaps](https://carto.com/basemaps/) | Map tiles under the radar | **No** |

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

## Upgrading from V8

V9 uses its own storage namespace but migrates your V8 username, favorites,
settings and last location automatically on first run. The V8 data is left
in place, so downgrading loses nothing.

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
