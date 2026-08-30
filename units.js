/* ============================================================
   Aither Weather V25 — units.js
   One place that turns canonical values into display strings.

   Everything inside the app stays in a single canonical set —
   °F, mph, miles, inHg — because that is what the sources give us
   and mixing units internally is how conversion bugs happen.
   Conversion happens once, here, at display time.
   ============================================================ */

const WTWUnits = (() => {
  function settings() {
    return WTWStorage.getSettings();
  }

  const isMetric = () => settings().units === 'metric';
  const is24Hour = () => String(settings().clock) === '24';

  /* ---------------- Raw conversions ---------------- */

  const fToC = (f) => ((f - 32) * 5) / 9;
  const mphToKmh = (mph) => mph * 1.609344;
  const miToKm = (mi) => mi * 1.609344;
  const kmToMi = (km) => km / 1.609344;
  const inHgToMb = (inHg) => inHg * 33.8639;

  const blank = (v) => v === null || v === undefined || Number.isNaN(v);

  /* ---------------- Formatters ---------------- */

  // Temperature with the degree sign but no unit letter, for big
  // readouts where the unit is obvious from context.
  function temp(valueF, { withUnit = false } = {}) {
    if (blank(valueF)) return '--';
    const v = isMetric() ? fToC(valueF) : valueF;
    return `${Math.round(v)}°${withUnit ? (isMetric() ? 'C' : 'F') : ''}`;
  }

  function tempUnit() {
    return isMetric() ? '°C' : '°F';
  }

  /* ------------------------------------------------------------
     A temperature DIFFERENCE, which does not convert like a
     temperature: 10°F warmer is 5.6°C warmer, not -12°C. Running a
     delta through temp() would produce a confidently wrong number,
     so it gets its own function.
     ------------------------------------------------------------ */
  function tempDelta(deltaF, { withUnit = true } = {}) {
    if (blank(deltaF)) return '--';
    const v = isMetric() ? deltaF * 5 / 9 : deltaF;
    return `${Math.round(Math.abs(v))}°${withUnit ? (isMetric() ? 'C' : 'F') : ''}`;
  }

  function speed(valueMph, { withUnit = true } = {}) {
    if (blank(valueMph)) return '--';
    const v = isMetric() ? mphToKmh(valueMph) : valueMph;
    return `${Math.round(v)}${withUnit ? (isMetric() ? ' km/h' : ' mph') : ''}`;
  }

  function speedUnit() {
    return isMetric() ? 'km/h' : 'mph';
  }

  function distance(valueMi) {
    if (blank(valueMi)) return '--';
    const v = isMetric() ? miToKm(valueMi) : valueMi;
    return `${Math.round(v)} ${isMetric() ? 'km' : 'mi'}`;
  }

  // Station distances arrive in km from the geo maths.
  function distanceFromKm(valueKm) {
    if (blank(valueKm)) return '--';
    const v = isMetric() ? valueKm : kmToMi(valueKm);
    return `${Math.round(v)} ${isMetric() ? 'km' : 'mi'}`;
  }

  function pressure(valueInHg) {
    if (blank(valueInHg)) return '--';
    return isMetric()
      ? `${Math.round(inHgToMb(valueInHg))} mb`
      : `${valueInHg.toFixed(2)} in`;
  }

  // Radar ranges are computed in km; show them in the chosen system.
  function range(valueKm) {
    if (blank(valueKm)) return '--';
    return isMetric()
      ? `${Math.round(valueKm)} km`
      : `${Math.round(kmToMi(valueKm))} mi`;
  }

  function percent(value) {
    return blank(value) ? '--' : `${Math.round(value)}%`;
  }

  /* Precipitation depth, held internally in inches like every other
     canonical figure here.

     Rounding matters more than it looks. A quarter of an inch is
     0.25 and a trace is 0.01, so a whole-number rounding turns most
     real rain into "0 in" — which reads as "none" rather than "not
     much". Two decimals below an inch, one above; and an amount too
     small to round to anything is called a trace rather than zero,
     because zero is a claim that nothing fell. */
  function precip(valueIn, { withUnit = true } = {}) {
    if (blank(valueIn)) return '--';
    // Exactly none is "0", not "0.00" — the decimals are there to keep
    // small amounts from rounding away, and nothing is not a small
    // amount.
    if (valueIn === 0) return withUnit ? (isMetric() ? '0 mm' : '0"') : '0';
    if (isMetric()) {
      const mm = valueIn * 25.4;
      if (mm > 0 && mm < 0.1) return withUnit ? 'trace' : '0';
      const text = mm < 10 ? mm.toFixed(1) : String(Math.round(mm));
      return withUnit ? `${text} mm` : text;
    }
    if (valueIn > 0 && valueIn < 0.005) return withUnit ? 'trace' : '0';
    const text = valueIn < 1 ? valueIn.toFixed(2) : valueIn.toFixed(1);
    return withUnit ? `${text}"` : text;
  }

  function precipUnit() {
    return isMetric() ? 'mm' : 'in';
  }

  /* ---------------- Time ---------------- */

  function time(value) {
    if (!value) return '--';
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d)) return '--';
    return d.toLocaleTimeString([], is24Hour()
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : { hour: 'numeric', minute: '2-digit' });
  }

  // Short label for chart axes: "3PM" or "15".
  function hourLabel(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d)) return '';
    return is24Hour()
      ? d.toLocaleTimeString([], { hour: '2-digit', hour12: false }).replace(':00', '')
      : d.toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '');
  }

  function dateTime(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d)) return '--';
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${date} ${time(d)}`;
  }

  // "5h 12m"
  function duration(minutes) {
    if (blank(minutes) || minutes < 0) return '--';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  /* ---------------- Numeric accessors ----------------
     For the chart and radar, which need numbers, not strings. */

  function tempValue(valueF) {
    if (blank(valueF)) return null;
    return isMetric() ? fToC(valueF) : valueF;
  }

  function rangeValue(valueKm) {
    if (blank(valueKm)) return null;
    return isMetric() ? valueKm : kmToMi(valueKm);
  }

  function rangeUnit() {
    return isMetric() ? 'km' : 'mi';
  }

  return {
    isMetric, is24Hour,
    fToC, mphToKmh, miToKm, kmToMi, inHgToMb,
    temp, tempUnit, tempValue, tempDelta,
    speed, speedUnit,
    distance, distanceFromKm,
    pressure, percent, precip, precipUnit, range, rangeValue, rangeUnit,
    time, hourLabel, dateTime, duration,
  };
})();

window.WTWUnits = WTWUnits;
