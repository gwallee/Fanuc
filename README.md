# What the Wether V8 ⚡🌩️

A dark/neon weather web app with an animated radar, 7-day forecasts, favorites,
themes, and a built-in **local AI** that roasts the weather (and you) —
**no API keys required, ever.**

![What the Wether logo](logo.svg)

## Features

### 🌡️ Weather
- City / place search and US ZIP code search
- Current conditions: temperature (°F), feels-like, humidity, wind speed,
  high/low, rain probability
- 7-day forecast with icons, highs/lows, and rain chance
- Browser geolocation ("My Location")
- Refresh button
- Powered by [Open-Meteo](https://open-meteo.com/) — a free public weather API
  with **no API key**

### 📡 Radar
- Animated canvas radar with rotating sweep beam and fading glow
- Breathing range rings, bearing ticks, and expanding ping
- Multi-blob storm cells seeded from the *real* current weather
  (precipitation probability, weather code, wind speed and direction)
- Classic intensity color scale (green → yellow → orange → red → magenta)
- Cells light up as the sweep passes over them
- Wind-driven cell drift with a scrubbable 60-minute timeline
- Play / Pause, Stop, Refresh, and My Location controls
- Live status indicator, crisp on retina screens, resizes for mobile

### 🤖 Local AI 2.0
- 100% local roast generator — no OpenAI, no ChatGPT, no cloud, no key
- Four personalities: **friendly, sassy, rude, brutal**
- Reacts to temperature, rain, snow, thunderstorms, fog, wind,
  extreme heat, extreme cold, clouds, and clear skies
- Big template pools + random openers + anti-repeat memory so it
  doesn't tell the same joke twice in a row
- Funny and rude, never hateful or discriminatory

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
├── local-ai.js     # Local AI 2.0 roast generator (offline)
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
`config.js → storage.js → themes.js → local-ai.js → radar.js → app.js`.

## APIs used (all free, all key-less)

| Service | Purpose | Key required |
| --- | --- | --- |
| [Open-Meteo Forecast](https://open-meteo.com/) | Current weather + 7-day forecast | **No** |
| [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | City/place search | **No** |
| [Zippopotam.us](https://api.zippopotam.us/) | US ZIP code lookup | **No** |

There is intentionally **no `.env.example`** — the app needs zero environment
variables and zero secrets.

## Desktop version

The `desktop/` folder contains an Electron-ready scaffold so the exact same
app can be packaged as a desktop application later. See
[`desktop/README.txt`](desktop/README.txt). The desktop version also requires
no API keys.

## Credits

- Weather data: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- ZIP lookup: [Zippopotam.us](https://api.zippopotam.us/)
- Roasts: generated locally by Wether Bot, who is very sorry (it is not)
