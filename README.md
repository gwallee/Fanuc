# Aither Weather V21 ⚡🌩️

A dark/neon weather web app with a **real radar over a real map**, a 48-hour
outlook, 7-day forecasts, favorites, themes, offline support, and a built-in
**local AI** that roasts the weather (and you) — **no API keys required, ever.**

Installs to a phone or desktop as a standalone app, and keeps working with no
connection.

![Aither Weather logo](logo.svg)

## Features

### 🔎 Search that shows you the choices
Through V12 the box silently took the first geocoding hit, so
"Springfield", "Portland" and every other duplicated place name resolved to
whichever one the API happened to rank first. Now you get the actual
candidates, disambiguated by region and country, with:

- Type-ahead results as you type (debounced, so it isn't a request per keystroke)
- Arrow keys and `Enter` to pick, `Escape` to dismiss
- Recent picks offered when the box is empty
- A US ZIP still loads directly — there's only one answer
- Proper combobox semantics (`aria-expanded`, `aria-activedescendant`)

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

### ♿ Accessibility
- A skip link as the first focusable element
- Loading a place is announced to screen readers through a polite live
  region ("Beverly Hills, CA. Clear sky. 70°F, feels like 68°F…") — a canvas
  repaint says nothing on its own
- Interactive canvases and stats are real controls: focusable, labelled,
  and operable with `Enter`/`Space`
- Honours `prefers-reduced-motion`

### 🔋 Doesn't run when nobody's looking
The radar drove a `requestAnimationFrame` loop continuously, even scrolled
off-screen or in a background tab. It now parks the loop when the scope
leaves the viewport (`IntersectionObserver`) or the tab is hidden
(`visibilitychange`), and resumes the moment it's visible again.

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

### 🌤️ The sky is the page (V21)

**The background is the weather.** The whole page takes the colour of the sky
outside — deep blue on a clear afternoon, slate under a thunderstorm, near-black
at night, washed grey in fog — with rain, snow, cloud and lightning moving
across it behind the cards.

The colour is *not* painted by the animation. `weatheranim.js` sets `data-sky`
and `data-daynight` on the root element, and the stylesheet does the rest. That
matters for three reasons: the page is the right colour before a single frame is
drawn, it stays right with the animation switched off, and the colour and the
animation are set in one call so they can never show different weather. The V21
suite asserts exactly that — the page, the backdrop, the hero strip and the
engine must all name the same scene.

**Detail tiles, one fact each.** The flat stat rows are now tiles in the shape
Apple's Weather made the expectation: a quiet uppercase header, the number large
enough to read at arm's length, and a sentence saying what the number means.
Feels like, UV index (with the published 0–11+ scale), wind on a compass dial,
precipitation, visibility, humidity, sunset on the day's arc, the moon, high/low,
and a barometer.

The sentences are the point — "UV index 6" tells you nothing you can act on,
"use sun protection until 6PM" does — so they are derived, never canned. The UV
hour comes from the day's actual sunset. The wind sentence names the direction
the wind comes *from*, which is the convention and the classic place to get it
backwards. Feels-like says "similar to the actual temperature" unless there is a
real gap to explain.

**Four ways to change the look**, in Settings:

| Setting | Options |
| --- | --- |
| Background | Animated sky · Sky colours only · Plain theme |
| Card style | Glass · Solid · Outline |
| Corners | Rounded · Soft · Square |
| Spacing | Compact · Comfortable · Airy |

Each is a data attribute on the root element and nothing more, so a new option
is a label in `config.js` and a block in `styles.css`. They compose with the
existing theme and accent settings rather than replacing them.

**Two things this version got wrong first, and how they were caught.** Glass
tiles were tinted *white*, which put white text over a midday sky at about
1.5:1 — present, and unreadable. The suite composites the real stack (ink over
translucent tile over the sky at its lightest) and demands WCAG AA, so it failed
until the glass was tinted down instead. And the moon's terminator was drawn as
two arcs with sweep flags, one of which was backwards: a 96%-lit moon rendered
as a thin crescent, which looks entirely plausible. It is drawn a scanline at a
time now, and the suite counts lit pixels against the stated illumination.

**What is deliberately not here:** Apple's *Averages* tile compares today with a
30-year climate normal. This app has no climate normals — only yesterday — so
rather than show a plausible-looking number derived from nothing, the comparison
against yesterday stays on the hero where it has always been, and there is no
Averages tile.

### 🖼️ Drawn buttons and a moving sky (V20)

**The interface icons are drawn now too.** V19 replaced the *weather* emoji
with real artwork and left the buttons as they were, which was half a job: the
magnifying glass beside the word "Search" was still whatever the platform felt
like drawing, at whatever size, in whatever colour, sitting on the text
baseline rather than beside it. Every button in the header and in Settings now
carries an inline SVG that inherits `currentColor`, so the same icon is dark on
a light theme, the accent contrast colour on a primary button, and identical on
every device.

They are declared, not pasted. Markup carries a name — `data-ui-icon="search"`
— and `icons.js` fills in the picture, so an icon is defined in exactly one
place and changing it changes it everywhere. The icons are `aria-hidden`; the
button keeps its own `aria-label`, so a screen reader still announces "Use my
location" once rather than announcing a picture as well.

**And the sky underneath moves.** Below the temperature there is a strip that
does what the forecast says: rain falls at a slant, snow drifts, cloud slides
across, the sun breathes, lightning cracks in a thunderstorm, fog rolls. It is
driven by the same weather code as the icon above it, through the same name
table, so the two cannot disagree about what the weather is.

It is decoration and it behaves like decoration:

- `aria-hidden` and `pointer-events: none` — it says nothing and it swallows
  nothing
- It stops when nobody is looking: a hidden tab, or the card scrolled out of
  view, parks the loop rather than throttling it
- `prefers-reduced-motion: reduce` gets a single still frame, not a slower storm
- **Settings → Animated sky under the weather** turns it off entirely

The V20 suite checks the parts a screenshot would miss: that the icons are
really SVG and really take the button's colour, that the labels survived, and —
the check most likely to earn its keep later — that *every* weather name the
icon set knows has a scene of its own, so a new condition can't quietly fall
back to generic cloud.

### 🎨 Icons, layout and things to change (V19)

**The weather icons are drawn, not typed.** Emoji were somebody else's artwork,
they differ on every platform — the same forecast looked like three different
things on Android, Windows and iOS — several weather emoji are nearly
indistinguishable at 20px, and none of them took the app's accent colour. The
icons are now original SVG built from a handful of gradients: sun, moon, cloud,
rain, snow, sleet, fog, bolt, and the combinations. Day and night differ where
a sun or a moon is part of the picture.

They are **not** copies of any platform's icon set. The style — soft gradients,
a sun behind a cloud — is a common one; the paths are this project's own.
Gradients and the cloud body live once in a hidden sprite, referenced by id: a
document with forty copies of the same gradient id has forty ambiguous
references.

**The layout reads down the middle.** The current card centres: icon, a large
light temperature, the condition, then `H:80° L:65°`. The forecast is a list
rather than a row of tiles — day, icon, rain chance, low, a range bar, high —
and the bars share one scale across the whole week, so a mild day next to a hot
one actually looks like one.

**Four more things to change**, in Settings:

| Setting | Options |
| --- | --- |
| Weather icons | Rendered (drawn by the app) or Emoji |
| Accent colour | Neon Green, Sky Blue, Violet, Amber, Rose, Mint |
| Days in the forecast | 5, 7 or 10 |
| Hours in the outlook | 12, 24 or 48 |

The accent colours the radar, the charts, buttons and highlights, and is
re-applied on top of whichever theme is active — a theme change repaints the
palette from CSS, so the accent has to be re-stamped or it silently reverts.
Changing the forecast length is a different request, so it reloads; the outlook
heading follows its setting rather than claiming 48 hours forever.

### 📅 A day in detail (V19)

Tapping a day in the forecast row opens that day: its roast, its high, low,
rain chance, UV, sunrise and sunset, and an hour-by-hour strip you can scroll —
temperature as a bar, chance of rain underneath, wet hours picked out.

Tapping a day already roasted it, and still does — the roast lands on the
weather card exactly as before, so the roast log and the main line are
unchanged. What changed is that the same line is now also shown *where you are
looking*, and the page no longer scrolls the card into view behind a dialog you
cannot see through.

The hours come from Open-Meteo's hourly series, which is kept whole rather than
trimmed to the 48 the strip shows. Days it does not reach say so rather than
showing an empty box, and the day's own facts are still there. Where NWS drew
the forecast row, Open-Meteo's sun times and UV are merged in by date — NWS
publishes neither.

### 🌡️ Today, in context (V19)

Under the conditions the card says how today compares with yesterday —
**"18°F warmer than yesterday"** — with yesterday's actual high in the tooltip.
The forecast request now asks Open-Meteo for one past day to make that
possible.

- It compares like with like: the day's high against the day's high, never a
  current reading against a daily figure
- Under a degree either way reads *About the same as yesterday*, because a
  fraction of a degree is noise, not news
- If the past day is missing it says nothing at all rather than inventing a
  comparison
- The difference converts as a **difference**: 18°F warmer is 10°C warmer, not
  the −8°C that running a delta through a temperature conversion would give.
  That has its own function in `units.js` and its own tests

Asking for a past day moved every index into the daily arrays by one, so the
V19 suite exists mostly to prove today is still today: the fixture makes
yesterday 62° against today's 80°, so an off-by-one would be unmistakable
rather than plausible. Sunrise, sunset, UV and the forecast row are all checked
against it. Visibility now comes from the hour nearest to now rather than the
first hour in the series, which with yesterday in the data would have been a
day old.

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

**`FORECAST` — where the rain is going (V19).** The same index publishes
*nowcast* frames, and the loop now carries on past the present into the next
half hour, so you can watch a band approach rather than only where it has
been. Predictions are never dressed up as observations:

- The badge reads `FORECAST`, never `LIVE RADAR`, and is not styled as live —
  whichever frame you scrub to, whether you dragged there or the loop played
  there
- The timeline label reads `+20 min` rather than a clock time, and the far end
  of the timeline says how far ahead it runs
- Forecast frames are drawn a shade lighter than observations, so the
  difference shows on the map and not only in the text
- The "how old is this imagery" figure ignores them entirely — a future
  timestamp would otherwise make stale radar look fresher than it is
- The radar opens on the newest real observation, not on a prediction

Set `radarTiles.forecastFrames` to `0` to turn them off; the loop then stops at
the present. The frame after the one on screen is fetched while you are looking
at it, so a loop that has run once does not stall mid-playback.

**`NWS LIVE` — NOAA mosaic (US fallback).** If the frame index is
unreachable, the app falls back to base-reflectivity imagery from
[NOAA's public GeoServer](https://opengeo.ncep.noaa.gov/) (`conus_bref_qcd`),
drawn over the basemap as before.

**A legend (V19).** A bar under the scope runs light → heavy, so the colours
mean something without having to be looked up. It is deliberately labelled by
order rather than by exact figures: RainViewer's palette and NOAA's mosaic do
not share a scale, and a legend that claimed precise values would be wrong for
one of them.

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

### 👤 Account — a name, or Google / Microsoft / Apple (optional)

The **👤 button in the header** opens a sign-in screen. It leads with an
account that needs **nothing at all**: pick a name and a picture, press Create,
and you have one. No client ID, no provider, no password, no email, no network —
and it works in the packaged desktop app, where the providers cannot. Above it,
when configured, sit **Sign in with Google**, **Sign in with Microsoft** and
**Sign in with Apple**.

Those three each need a client ID registered with the provider; that is their
requirement, not a choice made here, and there is no way around it for any of
them. The built-in account exists so that requirement never blocks anybody.

**Moving an account to another device (V19).** Settings → *Move to another
device* produces a code carrying your account, saved places and settings. Paste
it into the same box on another device and everything arrives. No server is
involved, which is also the limit: it is a deliberate transfer, not sync — the
two devices do not stay in step afterwards.

What the code deliberately does **not** carry is any provider profile. A Google
or Microsoft sign-in belongs to that provider on that device, and a token or an
email address has no business travelling in a string somebody might paste into a
chat. What travels is a name, a picture, favourites and preferences, which is
why the panel can honestly say it holds no password and no sign-in token. A
malformed code is refused with a message and changes nothing. Signing in sets your
name and picture, and the roast bot starts using your first name. That is the
whole of what it does. **Settings → Account** opens the same screen, and shows
the signed-in account with a **Log out** button once there is one.

The screen is a door, not a gate. Nothing in the app is behind it — every
feature works before anybody signs in — so it opens on request and closes on
Escape, the overlay, the ✕ or **Not now**, and it never appears uninvited. Once
signed in, the header button carries your picture (or your initial) and opens
your account instead.

Each provider's SDK is fetched only when that screen is opened by somebody who
is not signed in, so simply using the app contacts neither company.

All three providers are **off until you supply a client ID**, and each is
independent: configure any of them and only what is configured appears. With
none set the screen simply offers the name — it never tells whoever is using
the app that sign-in is unavailable, because it isn't. A line pointing here
appears only when the site is served from `localhost`, where the person
looking at it is the one who can fix it.

A name on this device is a profile, not an identity: it is stored in this
browser, it proves nothing, and the screen says as much. Signing out and back
in with the same device keeps the same account id.

**Switching one on without a deploy.** **Settings → Sign-in providers** takes a
client ID for each of the three. Pasting one switches that provider on
immediately — the button appears on the sign-in screen without a reload, and
the whole flow can be tried before anything is committed. That ID is kept in
that browser only: to offer the provider to everyone who visits, put the same
value in `config.js`, which is what the steps below do.

**Turning on Google:**

1. Create an **OAuth 2.0 Client ID** (type: *Web application*) at
   [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Under **Authorised JavaScript origins**, add your site — for this project
   that is `https://gwallee.github.io` (add `http://localhost:8000` too if you
   test locally)
3. Paste it into `auth.google.clientId` in `config.js`

**Turning on Microsoft:**

1. Register an application at
   [Microsoft Entra ID → App registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Choose the account types you want to accept. *Personal Microsoft accounts*
   and *work or school accounts* both map to the default `common` tenant; set
   `auth.microsoft.tenant` to `consumers` for personal only, or to a tenant ID
   to restrict sign-in to one organisation
3. Add a **Single-page application** redirect URI matching the page itself —
   `https://gwallee.github.io/What-The-Weather/` (and
   `http://localhost:8000/` for local testing). SPA, *not* Web: the Web type
   expects a client secret, which a static site cannot keep
4. Paste the **Application (client) ID** into `auth.microsoft.clientId`

**Turning on Apple:**

Apple is the one that costs money — a Services ID needs a paid **Apple
Developer Program** membership (currently $99/year), which Google and Microsoft
do not. Worth knowing before you start.

1. In [Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list/serviceId),
   register an **App ID**, then a **Services ID** (that is the client ID)
2. Enable **Sign in with Apple** on the Services ID and configure it: add your
   domain (`gwallee.github.io`) and a **Return URL** matching the page exactly
   — `https://gwallee.github.io/What-The-Weather/`
3. Paste the Services ID into `auth.apple.clientId`. If your Return URL differs
   from the page's own URL, set `auth.apple.redirectUri` to match it

Two things about Apple that the code handles so they don't surprise you: it
sends the person's name **only on their very first authorization** and never
again (the app stores it then, and falls back to the email's local part
later), and it never sends a picture, so an Apple account shows an initial.
Private-relay addresses are not turned into names.

No client secret is needed for any of them, and no client ID is a secret: all
are public by design and only work from the origins you registered, which is
why they can live in a committed file.

**Two things this deliberately is not:**

- **Not verified authentication.** Verifying an ID token means checking its
  signature against the provider's public keys *on a server*. This app has no
  server, so the token is decoded, never verified. That is fine for showing a
  name and a picture, and nothing security-relevant depends on it — but don't
  mistake it for real auth.
- **Not account sync.** Favourites and settings stay in this browser's
  `localStorage`. Syncing across devices needs somewhere to store them, which
  again means a server.

**Logging out** clears the stored profile and hands back the name and picture
that came with it. For Google it also calls `disableAutoSelect`, so you are not
silently signed back in on the next visit; for Microsoft it drops the cached
account, and sign-in always asks which account to use, so nothing is sticky. A
username you chose yourself is never touched, whichever way you came in.

Microsoft's ID token carries no picture (fetching one needs Microsoft Graph),
and Apple never sends one at all, so those accounts show an initial rather than
a broken image.

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

## Tests

The app ships with its own browser test suite — 282 checks across 14 suites,
driving the real app in Chromium with every external service stubbed:

```bash
npm install
npx playwright install chromium   # one-time
npm test                          # all suites
node tests/run.js v13 smoke       # just these
```

The runner serves the project on a free port, runs each suite against it, and
prints a combined summary. See [`tests/README.md`](tests/README.md) for what
each suite covers. The app itself still has **no build step and no runtime
dependencies** — `package.json` exists only for the tests.

## Project structure

```
AitherWeather-V21/
├── index.html      # App shell / markup
├── styles.css      # All styling + the three themes (CSS variables)
├── app.js          # Main app: search, weather, favorites, settings
├── radar.js        # Animated canvas radar engine
├── local-ai.js     # Local AI 3.0 roast generator (offline)
├── search.js       # Place search, candidates and recents
├── downloads.js    # Lists desktop builds from the latest release
├── auth.js         # Guest mode + optional Google sign-in (identity only)
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
├── icons.js        # Weather + interface icons (drawn, not emoji)
├── weatheranim.js  # The sky: full-page backdrop + the strip under the hero
├── tiles.js        # The detail tiles and their small drawings
├── icons/          # PWA icons (192, 512, maskable)
├── config.js       # Central configuration + defaults
├── storage.js      # Safe localStorage wrapper
├── themes.js       # Theme switching
├── logo.svg        # The logo (also used as the favicon)
├── README.md
├── .gitignore
├── tests/          # Browser test suite + runner (npm test)
├── package.json    # Test scripts only — the app itself has no build
├── assets/         # Extra static assets
├── .github/
│   └── workflows/  # Desktop builds (all platforms) + test CI
└── desktop/        # Electron desktop app
    ├── README.txt
    ├── package.json  # Electron manifest + electron-builder config
    ├── main.js       # Main process
    └── build/        # icon.ico (Windows) and icon.png (macOS/Linux)
```

Script load order matters and is already correct in `index.html`:
`config.js → storage.js → themes.js → units.js → search.js → nws.js → air.js →
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
variables and zero secrets. The optional Google client ID is public by design
and lives in `config.js`, not in an environment file.

## Desktop apps

The same app installs as a real desktop application on Windows, macOS and
Linux — still no API keys.

**From inside the app:** the ⬇️ button in the header (also in Settings, and
linked in the footer) opens a downloads panel that lists the real assets from
the latest GitHub release — grouped by platform, with file sizes, and your own
platform highlighted. If nothing has been released yet it says so rather than
offering dead links.

**Get a build without building anything:** push a tag (or click *Run workflow*
on the **Build desktop apps** action) and GitHub builds all three platforms
natively and attaches them to a release:

```bash
git tag v21.0.0 && git push origin v21.0.0
```

| Platform | Files |
| --- | --- |
| **Windows** | `WhatTheWether-Setup-*.exe` — installer with Start Menu and desktop shortcuts, or `WhatTheWether-Portable-*.exe` (single file, no install) |
| **macOS** | `WhatTheWether-*-x64.dmg` (Intel) and `-arm64.dmg` (Apple Silicon) |
| **Linux** | `.AppImage` (chmod +x and run), `.deb`, `.rpm`, `.tar.gz` |

**Building locally** (Node 18+):

```bash
cd desktop
npm install
npm start        # run without packaging
npm run dist     # build for the platform you're on
```

Build each platform *on* that platform. A Windows `.exe` cross-built from
Linux needs Wine — both 64- and 32-bit, since the icon stamper is a 32-bit
tool — and a macOS `.dmg` can't be produced off macOS at all. The workflow
exists so you never have to deal with that.

These builds are **unsigned** (certificates cost money and none are in this
repo), so Windows SmartScreen and macOS Gatekeeper warn on first launch —
[`desktop/README.txt`](desktop/README.txt) explains how to proceed and how to
add your own certificate.

## Credits

- US weather, alerts and radar: [NOAA / National Weather Service](https://www.weather.gov/)
  (public domain)
- Worldwide weather fallback: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- ZIP lookup: [Zippopotam.us](https://api.zippopotam.us/)
- Basemap tiles: [CARTO](https://carto.com/), data ©
  [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Roasts: generated locally by Wether Bot, who is very sorry (it is not)
