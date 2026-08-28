/* ============================================================
   What the Wether — auth.js
   Optional "Sign in with Google", via Google Identity Services.

   TWO THINGS THIS IS NOT, stated up front because the design
   depends on them:

   1. It is not verified authentication. Verifying a Google ID
      token means checking its signature against Google's public
      keys on a server. This app has no server, so the token is
      only decoded, never verified. A determined user could hand
      the page a forged token. That is fine for what it is used
      for here — a display name and an avatar — and it must never
      be used to gate anything that matters.

   2. It is not account sync. Favorites and settings still live in
      this browser's localStorage. Syncing them across devices
      needs somewhere to store them, which again means a server.

   Signing in is entirely optional: with no client ID configured
   the app behaves exactly as before, so "works with zero keys"
   stays true. Guest is the default and the full app — the guest
   flag below only records that the choice was made, so the
   Account panel can stop asking.
   ============================================================ */

const WTWAuth = (() => {
  const GSI_SRC = 'https://accounts.google.com/gsi/client';
  const state = { scriptLoaded: false, loading: null, profile: null, onChange: null };

  const cfg = () => (window.WTW_CONFIG && WTW_CONFIG.auth) || {};

  function clientId() {
    const id = (cfg().googleClientId || '').trim();
    return id && !id.startsWith('YOUR_') ? id : null;
  }

  function isConfigured() {
    return !!clientId();
  }

  // Google Identity Services needs a real http(s) origin it can be
  // told about in advance; a packaged desktop app loads from file://.
  function isSupportedHere() {
    return location.protocol === 'https:' ||
           location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1';
  }

  /* ---------------- Stored profile ---------------- */

  function getProfile() {
    if (state.profile) return state.profile;
    const saved = WTWStorage.get('googleProfile', null);
    state.profile = saved && saved.sub ? saved : null;
    return state.profile;
  }

  function isSignedIn() {
    return !!getProfile();
  }

  function saveProfile(profile) {
    state.profile = profile;
    WTWStorage.set('googleProfile', profile);
    // Signed in is not guest.
    WTWStorage.remove('guestMode');
    if (typeof state.onChange === 'function') state.onChange(profile);
  }

  function signOut() {
    // Also clear Google's own auto-select, so the next visit does not
    // silently sign the same account straight back in.
    try {
      if (window.google && google.accounts && google.accounts.id) {
        google.accounts.id.disableAutoSelect();
      }
    } catch (err) {
      console.warn('[auth] disableAutoSelect failed', err);
    }
    state.profile = null;
    WTWStorage.remove('googleProfile');
    if (typeof state.onChange === 'function') state.onChange(null);
  }

  /* ---------------- Guest ----------------
     Guest is not an account and needs no storage to work — this flag
     exists purely so the Account panel can show "you're all set"
     instead of asking again every time Settings is opened. */

  function isGuest() {
    return WTWStorage.get('guestMode', false) === true;
  }

  function continueAsGuest() {
    WTWStorage.set('guestMode', true);
    if (typeof state.onChange === 'function') state.onChange(getProfile());
    return true;
  }

  function clearGuest() {
    WTWStorage.remove('guestMode');
  }

  /* Signing in is the opposite of being a guest. */
  function canSignIn() {
    return isConfigured() && isSupportedHere();
  }

  // Why signing in isn't on offer, in words meant for whoever is using
  // the app rather than whoever is building it.
  function unavailableReason() {
    if (!isConfigured()) return 'unconfigured';
    if (!isSupportedHere()) return 'unsupported';
    return null;
  }

  /* ------------------------------------------------------------
     Decode the ID token payload. Decoding is NOT verification —
     see the header. Only the display fields are read.
     ------------------------------------------------------------ */
  function decodeCredential(credential) {
    try {
      const payload = String(credential).split('.')[1];
      if (!payload) return null;
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const json = decodeURIComponent(
        atob(padded).split('').map((c) =>
          '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
      );
      const data = JSON.parse(json);
      if (!data.sub) return null;
      return {
        sub: data.sub,
        name: data.name || data.given_name || 'Signed in',
        givenName: data.given_name || (data.name || '').split(' ')[0] || '',
        email: data.email || '',
        picture: data.picture || '',
        signedInAt: Date.now(),
      };
    } catch (err) {
      console.warn('[auth] could not read the credential', err);
      return null;
    }
  }

  /* ---------------- Google Identity Services ---------------- */

  function loadScript() {
    if (state.scriptLoaded) return Promise.resolve(true);
    if (state.loading) return state.loading;
    state.loading = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => { state.scriptLoaded = true; resolve(true); };
      script.onerror = () => {
        console.warn('[auth] Google Identity Services could not be loaded');
        resolve(false);
      };
      document.head.appendChild(script);
    });
    return state.loading;
  }

  function handleCredential(response) {
    const profile = decodeCredential(response && response.credential);
    if (!profile) return;
    saveProfile(profile);
  }

  /* ------------------------------------------------------------
     Render the button into `container`, or an explanation of why
     there is no button. Never leaves a dead control on screen.
     ------------------------------------------------------------ */
  async function renderButton(container) {
    if (!container) return 'no-container';
    container.innerHTML = '';

    if (!isConfigured()) {
      container.innerHTML =
        '<p class="auth-note">Sign-in is off because no Google client ID is set. ' +
        'It is optional — everything else works without it. ' +
        'See <code>auth.googleClientId</code> in <code>config.js</code>.</p>';
      return 'unconfigured';
    }

    if (!isSupportedHere()) {
      container.innerHTML =
        '<p class="auth-note">Google sign-in needs a web address, so it is ' +
        'unavailable in the desktop app and when opening the file directly. ' +
        'It works on the published site.</p>';
      return 'unsupported';
    }

    const ok = await loadScript();
    if (!ok || !window.google || !google.accounts || !google.accounts.id) {
      container.innerHTML =
        '<p class="auth-note">Couldn\'t reach Google to load the sign-in button.</p>';
      return 'unavailable';
    }

    try {
      google.accounts.id.initialize({
        client_id: clientId(),
        callback: handleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      const host = document.createElement('div');
      container.appendChild(host);
      google.accounts.id.renderButton(host, {
        theme: 'filled_black',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
      });
      return 'rendered';
    } catch (err) {
      console.warn('[auth] could not render the sign-in button', err);
      container.innerHTML = '<p class="auth-note">Sign-in is unavailable right now.</p>';
      return 'error';
    }
  }

  function init({ onChange } = {}) {
    state.onChange = onChange;
    getProfile();
    if (typeof onChange === 'function') onChange(state.profile);
  }

  return {
    init, renderButton, signOut, getProfile, isSignedIn,
    isConfigured, isSupportedHere, decodeCredential,
    isGuest, continueAsGuest, clearGuest, canSignIn, unavailableReason,
  };
})();

window.WTWAuth = WTWAuth;
