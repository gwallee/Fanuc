# Aither Weather V28 ⚡🌩️

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

### 🖥️ A quieter radar, and a desktop app that is actually ahead (V28)

**The radar stopped narrating itself.** It printed STANDBY, SCANNING, SIMULATED
or LIVE RADAR across the top of a weather map, and said the same moment in time
four ways underneath. Those are facts about the app, not about the weather.

Now: the state is a coloured dot, and the words stay in the DOM for a screen
reader, which cannot see a dot. The source badge appears **only when there is
something to say** — a prediction, stale imagery, or a simulation. A live radar
says nothing, because a live radar is the expected case.

**The legend names its bands**, not just its ends. "Light … Heavy" tells you the
bar goes up; naming the middle tells you what the green you are looking at
actually is. It moved off a hover `title` — which a touch device never shows —
onto the legend itself.

**The pin shows the weather**, not just a number: temperature *and* the
condition, in the same words the hero uses. The radar was building that string
from the icon set's internal name and saying "Rain light"; the app owns the
wording now.

**The desktop app updates itself from GitHub.** `electron-updater` reads the
`latest*.yml` feed that electron-builder attaches to each release. It checks on
launch, tells you the version and what changed, and **downloads nothing until
you say so** — a weather app quietly pulling ninety megabytes over a tethered
connection is not a courtesy.

**And the desktop build is ahead of the browser**, with four things a tab cannot
do:

| | Browser | Desktop |
| --- | --- | --- |
| Replace its own version | reload only | downloads and installs from GitHub |
| Temperature in the system tray | — | beside the clock, window closed |
| Severe-alert notifications | only while a tab is open, after a permission prompt | native, window closed |
| Launch at login · always on top · close to tray | — | yes |

The security posture does not move for any of it: `contextIsolation` on,
`nodeIntegration` off, `sandbox` on, and a preload that exposes a small **named**
surface rather than `ipcRenderer`. Nothing on that surface takes a path, a URL or
a command from the page.

In a browser, `desktop-extras.js` **removes** the desktop settings section
rather than leaving a panel of switches that do nothing, and every one of its
helpers is a no-op. The suite asserts both — including that calling them with no
bridge present throws nothing.

> **Not verified here.** This sandbox has no display and cannot run Electron, so
> the desktop code is covered by unit-level assertions on the configuration and
> by a stand-in bridge in the browser tests. The update flow itself has not been
> exercised against a real GitHub release.

### 🗺️ A map, and the frames back (V27)

**The radar is a map now.** Apple's precipitation view is a flat rectangle —
dark basemap, place names, rain painted over it, a temperature pill where you
are. No sweep, no range rings, no bezel. That is the default. The scope it used
to be is still there under **Settings → Radar style**, because it was a
deliberate look rather than an accident.

The projection is still square; a rectangular map is that square scaled to cover
the box and centred, so the basemap, the imagery, the alert polygons and the pin
all keep using one size and origin and stay aligned. The pill reads the same
temperature the hero does, so the map cannot disagree with the page above it.

**The lag, measured rather than guessed.** Profiling the app at phone size found
three things, and only one of them was what I expected:

| | before | after |
| --- | --- | --- |
| Hero strip | drawing every frame (uncapped) | **frozen** while the sky animates |
| Backdrop canvas | 860×1860 = 1.6M pixels | 538×1163 = **0.63M** |
| Radar paints | whatever the display offered | **30/sec**, capped |
| `getComputedStyle` per scroll | 125 | **15** |
| Canvas reallocations | on every render | only when the size changes |

The strip is the interesting one. It and the backdrop show the same weather, so
with the animated background on, the strip was a second canvas painting the same
rain thirty times a second, inside a card, over a sky that was already raining.
It holds a single still frame now, and only animates when the backdrop is *not*
— colours-only or plain-theme backgrounds, where it is the only moving weather
there is.

I was also wrong about something: I was sure the loop was leaking animation
chains, and wrote a guard for it. Instrumenting the loop showed exactly one
chain per layer. The guard stayed — it is cheap insurance against a real
hazard — but it fixed nothing, and the honest fix was the frame caps.

**The bot blends in.** It had its own dark ground, which put a box inside a box:
one shade of glass floating on another, for content that is part of that card's
story. It keeps a hairline above it and nothing else. Same for the nowcast strip.

**The transport controls fit.** Every radar button was forced to at least half
the row, so adding two step buttons turned a tidy strip into four rows of slabs.
A button is the width of its label again.

### 🎛️ Five asks (V26)

**The app no longer ships you a name.** It used to be "DJTheBest", which meant a
first run greeted somebody who had never told it anything, and the bot addressed
them by a name they had not chosen. The username starts empty, and empty means
the greeting is *absent* — not rendered blank, and not filled with a stand-in.
"Yo,  ⚡" and "Yo, friend ⚡" are both worse than nothing.

The bot's lines had to follow. Roughly half its templates carry `{name}`, and
dropping it leaves `"Grab the umbrella,  — the clouds…"`. So the name is removed
*with the punctuation that was only there to attach it*, and a sentence that
loses its opening name gets its capital back. The suite asks for a dozen roasts
and rejects any with a doubled space, an orphaned comma, a stray `friend`, or a
lower-case opening.

**The bot is optional.** Settings → *Show the Wether Bot*. Off removes the panel
entirely — not an empty box with a heading — hides the settings that only matter
to it, and generates nothing at all: no roast on load, no history written.

**Every icon opens something.** V25 gave charts to the seven tiles with an
hourly series. The other four have facts about a day rather than a shape across
one, so they open the same sheet with a **table** instead: sun times with the
day-length change from the day before, moon phase and illumination, the air's
pollutant breakdown, and the climate average with its year span. A reading that
isn't per-day — air quality, averages — offers no date strip, because offering
to change a day that changes nothing is a lie about the data.

The moon sheet says plainly that **moonrise and moonset are not published** by
any source this app uses. A figure that looks authoritative and is half an hour
out is worse than saying so.

**The radar got real controls:**

- **Rain opacity** and **loop speed** sliders. Both were fixed numbers; heavy
  rain over a dark basemap is unreadable at one opacity and washed out at
  another.
- **Cross-fade between frames.** Ten-minute frames switched instantly make rain
  appear to teleport; fading one out under the next reads as movement, which is
  what the rain is doing. Nothing is ever drawn brighter than a single frame.
- **A wall-clock time on the frame you're looking at.** The timeline said "NOW"
  or "+20 min", which is a relation, not a time.
- **Step a frame at a time** — buttons, or arrow keys when the scope has focus.
  The interesting moment is usually between two frames.

**Gemini saves and tests in one action.** It was two buttons, and the difference
between "saved" and "working" is the entire question — a key that saves and then
fails is exactly the case you need to hear about. Pasting a key and pressing
**Enter** now saves it, checks it against Google, reports what actually
happened, and switches the bot over if it worked.

> **A note on verifying that one.** This sandbox's egress proxy closes the
> browser's tunnel to `generativelanguage.googleapis.com` mid-exchange, so the
> Gemini path cannot be exercised from a real browser here. What *was* verified
> against Google directly: the key works, the model answers, and CORS is
> configured for both the `x-goog-api-key` header and a browser `Origin`. The
> in-browser wiring is covered by stubs.

### 📊 Every tile opens (V25)

A tile shows one number. That number nearly always has a **shape over the day** —
UV peaks at noon, wind picks up in the afternoon, humidity falls as the
temperature climbs — and the shape is usually the part worth knowing.

So every tile is now a button, and opens a sheet with that metric charted across
the day, a strip of dates to move between days, and a sentence saying what the
shape means. Conditions, UV index, wind, precipitation, visibility, humidity and
pressure all have one. It is one panel, not seven: a metric is a *definition* in
`metricsheet.js` — where its numbers come from, how to write one, what to say
about a day of them — and adding another is an entry in a table.

Three rules the chart follows, because each is a way this kind of thing quietly
lies:

- **The past is dashed and the future is solid**, with a marker at now. A single
  continuous line presents a recorded observation and a model's guess as the
  same kind of fact. This is the claim the whole feature rests on, so the test
  for it samples the line's own pixels either side of the now-marker and demands
  the earlier half have more gaps.
- **The axis carries real values and real hours** — and cannot show a value the
  metric can't take. The first version drew a UV axis reaching **−1**, and
  clipped midnight to read "2AM". Both are wrong numbers on an axis, not
  cosmetic problems.
- **A metric with no hourly data draws nothing and says so.** An empty axis is
  an invitation to read meaning into blank space.

The summaries are derived from the series they sit under, so they cannot
describe a peak the chart does not show — "The peak UV index today is 9. Levels
of Moderate or higher are reached from 9:00 AM to 6:00 PM" is computed by
finding the first and last hour at or above 3.

**UV gets the published WHO bands** behind the curve, so the number means
something without a legend. **Wind gets direction arrows** along the top, since
a speed chart alone can't tell you where it's coming from — and they point where
the wind is *going*, which is the opposite of the direction it is named for.

**The wind tile** now carries three labelled facts — Wind, Gusts, Direction —
as the reference does. V23 put the gust in a sentence and suppressed it when it
barely differed from the steady wind, because a sentence repeating the number
above it is noise. A labelled row is a fact rather than a remark, so it is
always shown.

### 🤖 The bot, optionally with a real model behind it (V24)

The Wether Bot writes its lines from template pools. That is why the app works
with no key, no account and no network beyond the weather itself, and **that
does not change** — the built-in bot is still the default and is still the
fallback for everything.

What V24 adds is a choice: **Settings → Wether Bot brain → Google Gemini**, plus
your own API key, and the bot writes rather than assembles.

**Where the key lives.** In your browser's `localStorage`, put there by you. It
is never in this repository, never in `config.js`, and sent nowhere except
Google's own endpoint. It travels in an `x-goog-api-key` header rather than a
query string, because a URL ends up in history, logs and referrers.

Be clear about the trade, because the app is:

- A key in a browser is readable by **anyone who can open devtools on that
  browser**.
- It is **not** shared with other visitors — `localStorage` is per-browser, so
  publishing this site does not publish your key. Each person brings their own
  or uses the built-in bot.
- It is stored outside the app's own storage namespace and outside settings, so
  the account transfer code — which exports settings wholesale — **cannot**
  carry it. There is a test for that.
- The key is never shown back to you in full, only as `AIza…1234`.

For a personal key on a personal machine that is a reasonable place for it. For
a key that matters, put it behind a server you control and call that instead.
The settings panel says so where you enter it.

**Failure is not an error state.** No key, no network, a rejected key, a quota
that has run out, a blocked response, a retired model, a slow reply — every one
falls back to the built-in bot, and you get a roast. The local line goes up
*immediately* and Gemini replaces it if and when it arrives, so nobody watches a
spinner where a joke should be. The badge beside the bot's name says which brain
wrote the line, because "the model said it" and "a template said it" are
different claims.

**Two bugs that only a real API call could find.** The stubs were green and
both of these were still wrong:

1. `gemini-2.0-flash` — the obvious default — **has been retired**. Google
   answers 404 and tells you to move on. Hence a model picker, and an error that
   says "that model has been retired, pick another one".
2. The reasoning models spend the output budget *thinking*. A live call to
   `gemini-3.6-flash` burned **886 tokens of thinking to produce a 31-token
   joke**, so the original 120-token cap returned the words "It's a" and
   stopped. The budget is 2048 now, and the default is `gemini-3.5-flash-lite`,
   which wrote a better line in 28 tokens with no thinking at all.

Both are in the test suite now, as fixtures shaped like the real responses.

### 📐 Numbers you can act on (V23)

Every feature in this version replaces a figure people cannot do anything with
by one they can.

**Rain as an amount.** The precipitation tile led with a probability, which
tells you nothing about whether to move the barbecue. It now leads with how
much has actually fallen today and names the next wet day with its amount —
"Next expected is 0.15" on Thursday." The probability is still there, one line
down, where it belongs. Nothing today reads `0"`, not `0.00"`; an amount too
small to round is called a **trace**, because zero is a claim that nothing fell.

**Gusts.** The wind tile shows the gust that actually knocks the parasol over —
but only when it is meaningfully above the steady wind, since otherwise it is
the same fact printed twice.

**A barometer that has to have moved to say it moved.** A single reading cannot
be rising or falling, so the trend is measured against the reading three hours
ago from the hourly series, with a 0.02 inHg deadband. Below that the honest
answer is "steady", not a direction picked out of noise. The dial draws an
arrow; the tile also *says* it in words, because the dial is `aria-hidden` and
a fact only available to people who can see it is not available.

**An Averages tile, with real history behind it.** V21 deliberately left this
out — Apple's version compares today against a climate normal, and this app had
no history to average. It does now: Open-Meteo publishes a free, key-less
archive, and `normals.js` fetches the same calendar date across the last ten
years and averages the daily maximum. That is a genuine climate normal for that
date, not an average of the week or the month.

It is careful about the ways this goes wrong:

- Fewer than five usable years and there is **no tile** rather than a confident
  wrong number.
- 29 February borrows the 28th — three years in four it does not exist, so its
  sample is a quarter the size of every other date's.
- The wording says "Average of 10 years, 2015–2024", never "normal": the
  published WMO normal is a 30-year window and this is not one.
- One request per place per day, cached, and the rest of the page never waits
  on it.

**A sentence over the hour row** — "Clear conditions expected around 5PM. Wind
gusts are up to 22 mph." — read off the series rather than written in advance,
so it cannot describe weather that is not in the forecast. When nothing changes
it says so instead of inventing an event.

**Where the forecast is actually for.** A city name is not a place: two towns
share one, and a geolocated fix lands on coordinates rather than an address. The
detail card now ends with the place, its coordinates, and an **Open in Maps**
link (OpenStreetMap — no key, no account).

### 🧭 Reading order, and an hour row (V22)

**The hero came off its card.** The city, the temperature and the conditions
now sit on the sky itself, with no border around them. A box there made the
background read as wallpaper behind a window rather than as the thing being
reported. Everything below it is still a card.

**The page is in the order people read it:** where you are and what it is
doing, then the next few hours, then the week — and only then the detail tiles,
the scope and the rest. That decision lives in two `grid-template-areas`
blocks, so the V22 suite asserts it against **positions on screen**, not DOM
order. That distinction is not academic: the reorder shipped broken the first
time precisely because the markup was right and the grid was still placing the
hourly card 2,000px further down.

**An hour row**, above the chart that was already there. Each hour gets a time,
an icon and a temperature, with the rain chance shown only when it is worth
knowing — and sunrise and sunset dropped in at the hour they actually happen
rather than left to be inferred from shading. The icons know night from day, so
2am gets a moon. It is an `<ol>`, so a screen reader hears "6 PM, 94 degrees"
rather than a run of loose numbers.

The chart stays underneath: a row shows you the next few hours, and a chart
shows you the shape of the whole period. They answer different questions.

**Air quality is a tile** with the published 0–300 scale, and it is *hidden*
rather than blank when the location has no air data. Two places used to write
the same three AQI elements; one does now.

**The backdrop runs at 30fps.** It is a full window of canvas at up to 2× pixel
density, and it is scenery — nobody notices 30fps drifting cloud, and a phone
in a pocket notices 60. Skipping a frame is not the same as slowing the weather
down: elapsed time is still real, so the rain falls at the same speed and
simply updates half as often.

**A four-version-old bug fell out of this.** V19 turned the forecast from a
horizontal scroller into a vertical list, and the *mobile* half of the old rule
survived: `flex: 0 0 96px`, which in a column flex is a height, not a width. So
every forecast row on a phone was padded to nearly twice the height of its
contents. Nothing looked broken — it just looked airy. Rows are 53px now,
which is what their contents measure.

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
AitherWeather-V28/
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
├── normals.js      # Climate normals from the key-less Open-Meteo archive
├── gemini.js       # Optional: the bot with your own Google Gemini key
├── metricsheet.js  # The per-metric day sheet and its chart engine
├── desktop-extras.js # Desktop-only powers; inert in a browser
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
git tag v28.0.0 && git push origin v28.0.0
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
