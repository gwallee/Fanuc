/* ============================================================
   Aither Weather V21 — config.js
   Central configuration. No API keys required, ever.
   ============================================================ */

const WTW_CONFIG = {
  app: {
    name: 'Aither Weather',
    version: 'V21',
    tagline: 'Weather with an attitude problem.',
  },

  // Default settings applied on first run (user changes are
  // persisted by storage.js and win over these).
  defaults: {
    username: 'DJTheBest',
    personality: 'sassy',        // friendly | sassy | rude | brutal
    autoRoast: true,             // roast automatically after each weather load
    theme: 'neon-dark',          // neon-dark | midnight | light
    units: 'imperial',           // imperial | metric
    clock: '12',                 // 12 | 24
    alertNotifications: false,   // browser notifications for severe alerts
    iconStyle: 'rendered',       // rendered | emoji
    accent: 'neon',              // see accents below
    forecastDays: 7,             // days in the forecast list
    hourlyHours: 24,             // hours in the outlook strip
    sceneAnimation: true,        // moving sky under the current weather
    background: 'animated',      // animated | gradient | off
    cardStyle: 'glass',          // glass | solid | outline
    corners: 'round',            // round | soft | square
    density: 'comfortable',      // compact | comfortable | airy
  },

  // Free, key-less public services.
  api: {
    // Open-Meteo: free weather API, no key required.
    forecast: 'https://api.open-meteo.com/v1/forecast',
    // Open-Meteo geocoding: free place search, no key required.
    geocoding: 'https://geocoding-api.open-meteo.com/v1/search',
    // Zippopotam: free US ZIP lookup, no key required.
    zip: 'https://api.zippopotam.us/us/',
    // National Weather Service: free, no key, US coverage only.
    nws: 'https://api.weather.gov',
    // Open-Meteo air quality + pollen: free, no key.
    airQuality: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    // MET Norway (yr.no) forecast: free, no key, worldwide.
    metno: 'https://api.met.no/weatherapi/locationforecast/2.0/complete',
  },

  // Where precipitation figures come from, best first. Each is free and
  // key-less; the app labels whichever one actually answered.
  //   nws-grid  — the local forecast office's own QPF and PoP grid (US)
  //   met-no    — MET Norway locationforecast (worldwide)
  //   open-meteo— model blend, used as the last resort
  rain: {
    order: ['nws-grid', 'met-no', 'open-meteo'],
    labels: {
      'nws-grid': 'NWS forecast grid',
      'met-no': 'MET Norway',
      'open-meteo': 'Open-Meteo',
    },
  },

  // Accent colours. Each is a pair: the line colour and the one it
  // fades into, so gradients and glows stay coherent.
  accents: [
    { id: 'neon',   label: 'Neon Green', accent: '#00e08a', accent2: '#00b3ff' },
    { id: 'sky',    label: 'Sky Blue',   accent: '#38bdf8', accent2: '#6366f1' },
    { id: 'violet', label: 'Violet',     accent: '#a78bfa', accent2: '#ec4899' },
    { id: 'amber',  label: 'Amber',      accent: '#fbbf24', accent2: '#fb7185' },
    { id: 'rose',   label: 'Rose',       accent: '#fb7185', accent2: '#a78bfa' },
    { id: 'mint',   label: 'Mint',       accent: '#34d399', accent2: '#22d3ee' },
  ],

  iconStyles: [
    { id: 'rendered', label: 'Rendered' },
    { id: 'emoji',    label: 'Emoji' },
  ],

  // How the page itself is drawn. Each of these is a data attribute on
  // the root element and nothing more — styles.css does the rest, so a
  // new option is a label here and a block there.
  backgrounds: [
    { id: 'animated', label: 'Animated sky' },
    { id: 'gradient', label: 'Sky colours only' },
    { id: 'off',      label: 'Plain theme' },
  ],
  cardStyles: [
    { id: 'glass',   label: 'Glass' },
    { id: 'solid',   label: 'Solid' },
    { id: 'outline', label: 'Outline' },
  ],
  cornerStyles: [
    { id: 'round',  label: 'Rounded' },
    { id: 'soft',   label: 'Soft' },
    { id: 'square', label: 'Square' },
  ],
  densities: [
    { id: 'compact',     label: 'Compact' },
    { id: 'comfortable', label: 'Comfortable' },
    { id: 'airy',        label: 'Airy' },
  ],

  forecastLengths: [5, 7, 10],
  hourlyLengths: [12, 24, 48],

  unitSystems: [
    { id: 'imperial', label: 'Imperial (°F, mph)' },
    { id: 'metric',   label: 'Metric (°C, km/h)' },
  ],

  // Minute-scale precipitation nowcast.
  nowcast: {
    enabled: true,
    lookaheadMinutes: 120,
    // Open-Meteo serves 15-minute data for much of Europe and North
    // America; elsewhere the hourly series is used instead.
    minutelyResolution: 15,
  },

  // Sign-in. Leave both client IDs empty and sign-in simply does not
  // appear; nothing else in the app changes, because nothing is behind
  // it. Setting either one up is described in the README.
  //
  // Without a server the returned token can only be decoded, never
  // verified, so this provides a name and a picture, not trustworthy
  // authentication, and nothing security-relevant depends on it.
  // Both providers are optional and neither needs a secret:
  // a browser client ID is public by design and only works from the
  // origins you register it against, so it belongs in this file rather
  // than in an environment variable that a static site cannot read.
  auth: {
    google: {
      clientId: '',
      setupUrl: 'https://console.cloud.google.com/apis/credentials',
    },
    microsoft: {
      clientId: '',
      // 'common' accepts both personal and work/school accounts;
      // 'consumers' is personal only, or use a tenant ID to restrict
      // sign-in to one organisation.
      tenant: 'common',
      setupUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    },
    apple: {
      // Apple's "Services ID", e.g. com.example.whatthewether.web.
      // Creating one needs a paid Apple Developer account, which the
      // other two do not — see the README before spending anything.
      clientId: '',
      // Must match a Return URL registered against that Services ID.
      // Empty means this page's own URL.
      redirectUri: '',
      setupUrl: 'https://developer.apple.com/account/resources/identifiers/list/serviceId',
    },
  },

  // Where the desktop builds come from. The GitHub API is key-less and
  // CORS-enabled, so the app can list the real release assets.
  repo: {
    owner: 'gwallee',
    name: 'What-The-Weather',
    get url() { return `https://github.com/${this.owner}/${this.name}`; },
    get releasesUrl() { return `${this.url}/releases`; },
    get latestApi() { return `https://api.github.com/repos/${this.owner}/${this.name}/releases/latest`; },
  },

  search: {
    maxResults: 6,   // candidates offered in the picker
    maxRecent: 6,    // remembered searches
  },

  compare: {
    maxLocations: 8,   // favorites fetched for the compare grid
  },

  // Worldwide radar frames with published timestamps (no API key).
  // Preferred over the WMS mosaic because the frame index says which
  // observations actually exist, instead of guessing round times.
  radarTiles: {
    enabled: true,
    indexUrl: 'https://api.rainviewer.com/public/weather-maps.json',
    frameCount: 8,
    // Frames from RainViewer's nowcast, played after the observations.
    // Predictions, labelled as such everywhere they appear. 0 turns
    // them off and the loop stops at the present.
    forecastFrames: 3,
    tileSize: 256,
    colorScheme: 4,   // RainViewer palette id
    smooth: true,
    showSnow: true,
    // Frames older than this are labelled stale rather than "live".
    maxAgeMinutes: 30,
  },

  // Real radar imagery. NOAA's public GeoServer serves the CONUS
  // reflectivity mosaic as georeferenced WMS images — no key, and
  // it accepts a TIME parameter so we can build an actual loop.
  // US only; outside coverage the radar falls back to simulation.
  radarImagery: {
    enabled: true,
    wmsBase: 'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows',
    layer: 'conus_bref_qcd',
    rangeKm: 150,      // scope radius on the ground
    imageSize: 512,    // px requested per frame
    frameCount: 6,     // frames in the loop
    frameStepMin: 10,  // minutes between frames
    // Set to false to skip live imagery entirely and always use
    // the stylized simulation.
  },

  // Guards that keep displayed conditions representative of the
  // searched point rather than of a distant or offline station.
  nwsQuality: {
    maxStationKm: 40,      // reject stations farther than this
    maxObsAgeMinutes: 90,  // reject readings older than this
  },

  weather: {
    forecastDays: 7,
    forecastHours: 48,     // hourly strip length
    temperatureUnit: 'fahrenheit',
    windSpeedUnit: 'mph',
  },

  // Basemap under the radar. Carto's tiles are free and key-less;
  // attribution to OpenStreetMap + CARTO is required and is rendered
  // on the radar card and in the footer.
  map: {
    enabled: true,
    tileDark: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    tileLight: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    minRangeKm: 40,
    maxRangeKm: 400,
    zoomSteps: [40, 75, 150, 250, 400],
  },

  radar: {
    fullscreenOnTap: true,   // tap/click the scope to go fullscreen
    frameMinutes: 60,     // timeline spans the last 60 minutes
    sweepSecondsPerRev: 4,
    maxStormCells: 7,
    framePlaybackMs: 750, // real-imagery loop speed
  },

  personalities: ['friendly', 'sassy', 'rude', 'brutal', 'deadpan', 'doomer'],
  themes: [
    { id: 'neon-dark', label: 'Neon Dark' },
    { id: 'midnight',  label: 'Midnight' },
    { id: 'light',     label: 'Light' },
  ],

  // Roast history shown in the app (Local AI 3.0).
  roastLog: { maxEntries: 50 },

  // Version-neutral from V10 onward: bumping the app version no longer
  // orphans anyone's data. storage.js migrates the old V8/V9 namespaces
  // across once.
  storagePrefix: 'wtw:',
  legacyStoragePrefixes: ['wtw9:', 'wtw8:'],
};

// Expose globally (plain <script> loading, works from file:// too).
window.WTW_CONFIG = WTW_CONFIG;
