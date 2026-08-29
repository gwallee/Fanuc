/* ============================================================
   What the Wether V19 — precip.js
   Precipitation nowcast: "rain starts in ~20 min".

   The series itself comes from rain.js, which picks the most
   authoritative available source. This module only analyses it, and
   the wording adapts to the resolution actually supplied: a
   15-minute series gets minute-level phrasing, an hourly one says
   "within the hour" rather than implying precision it lacks.
   ============================================================ */

const WTWPrecip = (() => {

  const cfg = () => (window.WTW_CONFIG && WTW_CONFIG.nowcast) || { enabled: true, lookaheadMinutes: 120 };

  // A slot counts as wet if measurable precipitation is expected, or
  // the probability is high enough to be worth saying out loud.
  function isWet(slot) {
    if (slot.mm !== null && slot.mm >= 0.1) return true;
    if (slot.mm === null && slot.prob !== null && slot.prob >= 60) return true;
    return false;
  }

  /* ---------------- Series builders ---------------- */

  function fromMinutely15(data) {
    const m = (data && data.minutely_15) || {};
    const times = m.time || [];
    if (!times.length) return null;
    const out = [];
    for (let i = 0; i < times.length; i++) {
      out.push({
        time: new Date(times[i]),
        mm: m.precipitation ? m.precipitation[i] : null,
        prob: m.precipitation_probability ? m.precipitation_probability[i] : null,
      });
    }
    return out.some((s) => s.mm !== null || s.prob !== null)
      ? { slots: out, stepMinutes: 15, precise: true }
      : null;
  }

  function fromHourly(hours) {
    if (!hours || !hours.length) return null;
    return {
      slots: hours.map((h) => ({ time: h.time, mm: null, prob: h.precipProb ?? null })),
      stepMinutes: 60,
      precise: false,
    };
  }

  /* ------------------------------------------------------------
     Analyse the series: is it raining now, when does it start, and
     when does it stop?
     ------------------------------------------------------------ */
  function analyse(series, now = new Date()) {
    if (!series || !series.slots.length) return null;
    const lookahead = cfg().lookaheadMinutes || 120;
    const nowMs = now.getTime();

    // Keep the current slot plus everything inside the window.
    const upcoming = series.slots.filter((s) => {
      const dt = (s.time.getTime() - nowMs) / 60000;
      return dt >= -series.stepMinutes && dt <= lookahead;
    });
    if (!upcoming.length) return null;

    const minutesUntil = (slot) => Math.round((slot.time.getTime() - nowMs) / 60000);
    const rainingNow = isWet(upcoming[0]) && minutesUntil(upcoming[0]) <= 0;

    let startsIn = null, endsIn = null;
    if (rainingNow) {
      const dry = upcoming.find((s) => minutesUntil(s) > 0 && !isWet(s));
      endsIn = dry ? Math.max(0, minutesUntil(dry)) : null;
    } else {
      const wet = upcoming.find((s) => minutesUntil(s) > 0 && isWet(s));
      if (wet) {
        startsIn = Math.max(0, minutesUntil(wet));
        const after = upcoming.filter((s) => s.time > wet.time);
        const stop = after.find((s) => !isWet(s));
        endsIn = stop ? Math.max(0, minutesUntil(stop)) : null;
      }
    }

    return {
      rainingNow, startsIn, endsIn,
      precise: series.precise,
      stepMinutes: series.stepMinutes,
      slots: upcoming,
      lookahead,
    };
  }

  /* ---------------- Wording ---------------- */

  function describe(result) {
    if (!result) return null;
    const U = window.WTWUnits;
    const round = (m) => (result.precise ? Math.max(5, Math.round(m / 5) * 5) : Math.round(m / 60) * 60);
    const span = (m) => (U ? U.duration(m) : `${m}m`);

    if (result.rainingNow) {
      if (result.endsIn === null) {
        return `Precipitation now, and it stays through the next ${span(result.lookahead)}.`;
      }
      return result.precise
        ? `Precipitation now — easing in about ${span(round(result.endsIn))}.`
        : `Precipitation now — easing within the hour.`;
    }

    if (result.startsIn === null) {
      return `Nothing falling in the next ${span(result.lookahead)}.`;
    }

    const when = result.precise
      ? `in about ${span(round(result.startsIn))}`
      : (result.startsIn <= 60 ? 'within the hour' : `in about ${span(round(result.startsIn))}`);

    if (result.endsIn !== null && result.endsIn > result.startsIn) {
      return `Precipitation starting ${when}, lasting roughly ${span(result.endsIn - result.startsIn)}.`;
    }
    return `Precipitation starting ${when}.`;
  }

  /* ------------------------------------------------------------
     Public entry: hand it the raw Open-Meteo payload and the
     normalized hourly list; it picks the best series available.
     ------------------------------------------------------------ */
  function nowcast(series, now = new Date()) {
    if (cfg().enabled === false) return null;
    if (!series || !series.slots) return null;
    const result = analyse(series, now);
    if (!result) return null;
    return Object.assign(result, {
      text: describe(result),
      source: series.source || null,
      sourceLabel: series.label || null,
    });
  }

  return { nowcast, analyse, describe, fromMinutely15, fromHourly, isWet };
})();

window.WTWPrecip = WTWPrecip;
