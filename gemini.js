/* gemini.js — the Wether Bot, with a real model behind it.

   The built-in Local AI stays the default and stays the fallback: this
   app's promise is that it works with no key, no account and no
   network beyond the weather itself, and that promise does not move.
   What this adds is an option — bring your own Google Gemini key and
   the bot writes its lines rather than assembling them from pools.

   Where the key lives, and why
   ---------------------------
   In this browser's localStorage, put there by the person using the
   app. It is never in the repository, never in config.js, and never
   sent anywhere except Google's own endpoint.

   That is a deliberate trade, and it is worth being plain about what
   it costs. A key held in a browser is readable by anyone who can open
   devtools on that browser, and any page-level script could read it
   too. What it is NOT is shared with other visitors: localStorage is
   per-browser, so publishing this site does not publish the key —
   each person brings their own or uses the local bot.

   For a personal key on a personal machine that is a reasonable place
   for it. For a key that matters, it is not: put it behind a server
   you control and call that instead. The app says as much where the
   key is entered rather than leaving it to be discovered.

   Failure is not an error state
   -----------------------------
   No key, no network, a rejected key, a rate limit, a safety block, a
   slow response — every one of them falls back to the local bot and
   the user gets a roast. A weather app that shows an error where a
   joke should be has failed at the only job that panel has. */
const WTWGemini = (() => {
  'use strict';

  /* Deliberately outside WTWStorage's namespace and outside settings.

     The transfer code exports WTWStorage.getSettings() wholesale, so
     anything living in settings travels to another device in a string
     the user is invited to paste around. A credential must not. Keeping
     it in its own item means no future field added to settings can
     carry it out by accident.

     The name is also outside the app's own 'wtw:' prefix, so anything
     that ever walks that namespace — an export, a wipe, a migration —
     cannot pick the key up without naming it explicitly. */
  const KEY_STORE = 'aither.gemini.key';
  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
  /* Fifteen, not eight. The local line is already on screen by the
     time this is waiting, so a slower model costs nothing but a later
     replacement — and the reasoning models genuinely take that long. */
  const TIMEOUT_MS = 15000;

  /* Voices, described rather than demonstrated: giving the model
     examples to copy produces variations on the examples, which is
     the pool problem again with more latency. */
  const VOICES = {
    friendly: 'warm, encouraging and gently funny — you like this person',
    sassy: 'playful and teasing, the way a close friend winds you up',
    rude: 'blunt and sarcastic, deadpan, mildly insulting but never cruel',
    brutal: 'savage, withering, comedically merciless — still never cruel ' +
            'about anything a person cannot change',
    doomer: 'theatrically fatalistic, treating ordinary weather as an omen',
  };

  /* ---------------- The key ---------------- */

  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ''; }
    catch (err) { return ''; }
  }

  function setKey(value) {
    try {
      const trimmed = String(value || '').trim();
      if (trimmed) localStorage.setItem(KEY_STORE, trimmed);
      else localStorage.removeItem(KEY_STORE);
      return true;
    } catch (err) { return false; }
  }

  const hasKey = () => getKey().length > 20;

  /* The user's choice if they made one, the config default otherwise.
     Kept in one place so the settings panel, the call and the test
     button cannot end up asking different models. */
  function chosenModel() {
    const wanted = window.WTWStorage ? WTWStorage.getSettings().geminiModel : '';
    const allowed = (window.WTW_CONFIG && WTW_CONFIG.geminiModels || []).map((m) => m.id);
    if (wanted && allowed.includes(wanted)) return wanted;
    return (window.WTW_CONFIG && WTW_CONFIG.gemini && WTW_CONFIG.gemini.model)
      || 'gemini-3.5-flash-lite';
  }

  /* Never print a key in full — not in the field, not in a status
     line, not in a log. Enough to recognise, not enough to use. */
  function maskedKey() {
    const key = getKey();
    if (!key) return '';
    return key.length <= 10 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`;
  }

  /* ---------------- The prompt ---------------- */

  /* Facts in, one line out. The weather is given as plain numbers
     rather than as a sentence, so the model is describing the actual
     conditions rather than paraphrasing something already written. */
  function buildPrompt(weather, { personality, username, context }) {
    const U = window.WTWUnits;
    const facts = [
      `place: ${weather.city || 'unknown'}`,
      `conditions: ${weather.conditionText || describe(weather.weatherCode)}`,
      `temperature: ${U ? U.temp(weather.tempF, { withUnit: true }) : weather.tempF}`,
      `feels like: ${U ? U.temp(weather.feelsLikeF, { withUnit: true }) : weather.feelsLikeF}`,
      `high/low: ${U ? U.temp(weather.highF) : weather.highF} / ${U ? U.temp(weather.lowF) : weather.lowF}`,
      `humidity: ${weather.humidity == null ? 'unknown' : Math.round(weather.humidity) + '%'}`,
      `wind: ${U ? U.speed(weather.windMph) : weather.windMph}`,
      `chance of rain: ${weather.precipProb == null ? 'unknown' : Math.round(weather.precipProb) + '%'}`,
      `time of day: ${weather.isDay === false ? 'night' : 'day'}`,
    ].join('\n');

    const voice = VOICES[personality] || VOICES.sassy;

    return [
      'You are "Wether Bot", the resident comedian of a weather app.',
      `Write ONE line about ${context || 'the weather right now'} for a user called "${username}".`,
      '',
      'The weather, as measured:',
      facts,
      '',
      `Voice: ${voice}.`,
      '',
      'Rules:',
      '- One or two sentences. Under 200 characters. No preamble, no quotes.',
      '- Be about THIS weather. Refer to at least one of the numbers above.',
      '- Never invent weather that is not in the facts.',
      '- You may use the user\'s name, at most once.',
      '- No hashtags, no emoji spam (one emoji at most).',
      '- Never comment on the person\'s appearance, body, race, gender or beliefs.',
    ].join('\n');
  }

  function describe(code) {
    return (window.WTWIcons && WTWIcons.nameFor)
      ? WTWIcons.nameFor(code).replace(/-/g, ' ') : 'weather';
  }

  /* ---------------- The call ---------------- */

  /* A roast nobody waits for is not a roast. Eight seconds, then the
     local bot answers instead — AbortController rather than a dangling
     promise, so a slow response is not still running when the next one
     starts. */
  async function ask(weather, options = {}) {
    const key = getKey();
    if (!hasKey()) throw new Error('no-key');

    const model = chosenModel();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        // The key goes in a header, not the query string: a URL ends up
        // in history, in logs and in referrers, and a header does not.
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(weather, options) }] }],
          generationConfig: {
            temperature: 1.15,          // it is a comedian, not a summariser
            topP: 0.95,
            /* Generous, and it has to be. On the reasoning models the
               thinking counts against this budget: a live call to
               gemini-3.6-flash spent 886 tokens thinking to produce a
               31-token joke, so a 120-token cap returned the words
               "It's a" and stopped. The reply is still short — that
               is what the prompt is for — this only stops it being
               cut off mid-sentence. */
            maxOutputTokens: 2048,
          },
        }),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        /* Read the reason rather than inferring it from the status.
           A 400 is a rejected key sometimes and a malformed request
           other times, and a 404 here means the model was retired —
           which is not hypothetical: gemini-2.0-flash was the default
           in this file until a live call came back saying it was gone.
           Each of those needs a different sentence to the user. */
        const message = (data.error && data.error.message) || '';
        if (res.status === 404 || /no longer available|not found/i.test(message)) {
          throw new Error('gone-model');
        }
        if (res.status === 401 || res.status === 403 ||
            /api key|api_key|permission/i.test(message)) {
          throw new Error('bad-key');
        }
        if (res.status === 429) throw new Error('rate-limit');
        throw new Error(`http-${res.status}`);
      }

      const line = extractText(data);
      if (!line) {
        // A thinking model that ran out of budget stops with
        // MAX_TOKENS and no text at all, which looks identical to a
        // safety block unless the reason is read.
        const reason = data.candidates && data.candidates[0] &&
          data.candidates[0].finishReason;
        throw new Error(reason === 'MAX_TOKENS' ? 'truncated' : 'empty');
      }
      return tidy(line);
    } finally {
      clearTimeout(timer);
    }
  }

  function extractText(data) {
    const parts = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map((p) => p.text || '').join('').trim();
  }

  /* Models like to wrap a one-liner in quotes, or hand back three
     options on separate lines. Take the first line and unwrap it. */
  function tidy(text) {
    let line = String(text).split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
    line = line.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
    line = line.replace(/^\s*[-*•]\s*/, '');
    if (line.length > 240) line = line.slice(0, 237).replace(/\s+\S*$/, '') + '…';
    return line.trim();
  }

  /* A key is only worth saving if it works, so the settings panel can
     ask. Returns a plain result rather than throwing: this is a thing
     a person clicked, and it should say what happened. */
  async function testKey() {
    if (!hasKey()) return { ok: false, reason: 'No key saved yet.' };
    try {
      const line = await ask({
        city: 'Testville', conditionText: 'Clear sky', tempF: 72, feelsLikeF: 72,
        highF: 80, lowF: 64, humidity: 50, windMph: 8, precipProb: 10,
        weatherCode: 0, isDay: true,
      }, { personality: 'friendly', username: 'friend', context: 'a test' });
      return { ok: true, sample: line };
    } catch (err) {
      const why = {
        'no-key': 'No key saved yet.',
        'bad-key': 'Google rejected that key. Check it was copied whole and that ' +
                   'the Generative Language API is enabled for it.',
        'gone-model': 'That model has been retired by Google. Pick another one above.',
        'rate-limit': 'That key is over its quota for now. It will work again later.',
        'truncated': 'The model ran out of room before it finished. Pick a lighter model.',
        'empty': 'The model answered with nothing. Try again.',
      }[err.message];
      if (why) return { ok: false, reason: why };
      if (err.name === 'AbortError') return { ok: false, reason: 'Timed out after 8 seconds.' };
      return { ok: false, reason: 'Could not reach Google. Check the connection.' };
    }
  }

  return { getKey, setKey, hasKey, maskedKey, chosenModel,
           ask, testKey, buildPrompt, tidy, VOICES };
})();

window.WTWGemini = WTWGemini;
