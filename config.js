/* ============================================================
   What the Wether V8 — config.js
   Central configuration. No API keys required, ever.
   ============================================================ */

const WTW_CONFIG = {
  app: {
    name: 'What the Wether',
    version: 'V8',
    tagline: 'Weather with an attitude problem.',
  },

  // Default settings applied on first run (user changes are
  // persisted by storage.js and win over these).
  defaults: {
    username: 'DJTheBest',
    personality: 'sassy',        // friendly | sassy | rude | brutal
    autoRoast: true,             // roast automatically after each weather load
    theme: 'neon-dark',          // neon-dark | midnight | light
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
    temperatureUnit: 'fahrenheit',
    windSpeedUnit: 'mph',
  },

  radar: {
    frameMinutes: 60,     // timeline spans the last 60 minutes
    sweepSecondsPerRev: 4,
    maxStormCells: 7,
    framePlaybackMs: 750, // real-imagery loop speed
  },

  personalities: ['friendly', 'sassy', 'rude', 'brutal'],
  themes: [
    { id: 'neon-dark', label: 'Neon Dark' },
    { id: 'midnight',  label: 'Midnight' },
    { id: 'light',     label: 'Light' },
  ],

  storagePrefix: 'wtw8:',
};

// Expose globally (plain <script> loading, works from file:// too).
window.WTW_CONFIG = WTW_CONFIG;
