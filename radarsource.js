/* ============================================================
   What the Wether V14 — radarsource.js
   Real radar frames with real timestamps.

   V9-V11 asked NOAA's WMS for frames at guessed times (every 10
   minutes, on the clock). That is not how the mosaic is published:
   it updates on its own cadence, so a guessed timestamp can return
   the nearest frame, a repeat of one already shown, or nothing —
   which makes the loop look wrong even when the imagery is right.

   RainViewer publishes an index of exactly which frames exist and
   when, worldwide, with no API key. Using that index means every
   frame drawn is a real observation at a known time, and the
   timeline labels are the truth rather than an assumption.
   ============================================================ */

const WTWRadarSource = (() => {

  const cfg = () => (window.WTW_CONFIG && WTW_CONFIG.radarTiles) || {};

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ------------------------------------------------------------
     Fetch the frame index. Returns the most recent `frameCount`
     observed frames, oldest first, each with its true timestamp.
     ------------------------------------------------------------ */
  async function getFrames() {
    const c = cfg();
    if (c.enabled === false) return null;
    try {
      const data = await getJSON(c.indexUrl);
      const host = data.host || '';
      const radar = data.radar || {};
      const past = Array.isArray(radar.past) ? radar.past : [];
      if (!past.length) return null;

      const wanted = c.frameCount || 6;
      const frames = past.slice(-wanted).map((f) => ({
        time: new Date(f.time * 1000),
        path: f.path,
      }));
      return { source: 'rainviewer', host, frames, generated: data.generated };
    } catch (err) {
      console.warn('[radar] RainViewer index unavailable', err.message);
      return null;
    }
  }

  /* ------------------------------------------------------------
     Tile URL for a frame.
     Layout: {host}{path}/{size}/{z}/{x}/{y}/{color}/{options}.png
     options are "{smooth}_{snow}".
     ------------------------------------------------------------ */
  function tileUrl(host, framePath, z, x, y) {
    const c = cfg();
    const size = c.tileSize || 256;
    const color = c.colorScheme === undefined ? 4 : c.colorScheme;
    const smooth = c.smooth === false ? 0 : 1;
    const snow = c.showSnow === false ? 0 : 1;
    return `${host}${framePath}/${size}/${z}/${x}/${y}/${color}/${smooth}_${snow}.png`;
  }

  // How stale the newest frame is, in minutes — surfaced in the UI so
  // "live" is never claimed for imagery that is actually old.
  function ageMinutes(frames) {
    if (!frames || !frames.length) return null;
    const newest = frames[frames.length - 1].time;
    return (Date.now() - newest.getTime()) / 60000;
  }

  return { getFrames, tileUrl, ageMinutes };
})();

window.WTWRadarSource = WTWRadarSource;
