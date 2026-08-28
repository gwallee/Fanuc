/* ============================================================
   What the Wether V11 — units.js
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
    temp, tempUnit, tempValue,
    speed, speedUnit,
    distance, distanceFromKm,
    pressure, percent, range, rangeValue, rangeUnit,
    time, hourLabel, dateTime, duration,
  };
})();

window.WTWUnits = WTWUnits;
