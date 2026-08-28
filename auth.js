/* ============================================================
   What the Wether V14 — auth.js
   Sign in with Google or Microsoft, through each provider's own
   browser SDK. Both are optional and both are key-free: a public
   client ID is not a secret, and no server is involved.

   TWO THINGS THIS IS NOT, stated up front because the design
   depends on them:

   1. It is not verified authentication. Verifying an ID token
      means checking its signature against the provider's public
      keys on a server. This app has no server, so the token is
      only decoded, never verified. A determined user could hand
      the page a forged token. That is fine for what it is used
      for here — a display name and an avatar — and it must never
      be used to gate anything that matters.

   2. It is not account sync. Favourites and settings still live
      in this browser's localStorage. Syncing them across devices
      needs somewhere to store them, which again means a server.

   Nothing in the app is locked behind signing in; the whole thing
   works before anybody does. Signing in adds a name and a face,
   and that is all it claims to do.
   ============================================================ */

const WTWAuth = (() => {
  const GSI_SRC  = 'https://accounts.google.com/gsi/client';
  // Microsoft's own CDN. Pinned: an SDK that changes under the app
  // is an outage waiting for a quiet weekend.
  const MSAL_SRC = 'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js';

  const state = {
    profile: null,
    onChange: null,
    scripts: {},        // src -> Promise<boolean>
    msalApp: null,
  };

  const cfg = () => (window.WTW_CONFIG && WTW_CONFIG.auth) || {};

  // A placeholder left in config.js is not a client ID.
  function idOf(section) {
    const raw = ((cfg()[section] && cfg()[section].clientId) || '').trim();
    return raw && !/^your[_-]/i.test(raw) ? raw : null;
  }

  const googleClientId    = () => idOf('google');
  const microsoftClientId = () => idOf('microsoft');

  function msAuthority() {
    const tenant = (cfg().microsoft && cfg().microsoft.tenant) || 'common';
    return `https://login.microsoftonline.com/${tenant}`;
  }

  // Both SDKs need a real http(s) origin registered in advance; a
  // packaged desktop app loads from file://, where neither can work.
  function isSupportedHere() {
    return location.protocol === 'https:' ||
           location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1';
  }

  // Which providers can actually be offered right now. Anything not
  // in this list must not be drawn as a button.
  function providers() {
    if (!isSupportedHere()) return [];
    const out = [];
    if (googleClientId()) out.push('google');
    if (microsoftClientId()) out.push('microsoft');
    return out;
  }

  const isConfigured = () => providers().length > 0;

  /* ---------------- Stored profile ---------------- */

  function getProfile() {
    if (state.profile) return state.profile;
    const saved = WTWStorage.get('profile', null) || WTWStorage.get('googleProfile', null);
    state.profile = saved && saved.sub ? saved : null;
    return state.profile;
  }

  const isSignedIn = () => !!getProfile();

  function saveProfile(profile) {
    state.profile = profile;
    WTWStorage.set('profile', profile);
    WTWStorage.remove('googleProfile');    // superseded by the shared key
    if (typeof state.onChange === 'function') state.onChange(profile);
  }

  /* ------------------------------------------------------------
     Stop Google silently re-selecting the same account next time.
     On a return visit the person is already signed in, so the panel
     never renders a button and Google's script was never loaded —
     which used to mean signing out quietly skipped this step. Load it
     just far enough to clear the flag, and only when the account being
     signed out of is actually a Google one.
     ------------------------------------------------------------ */
  function disableGoogleAutoSelect() {
    const clear = () => {
      try {
        google.accounts.id.disableAutoSelect();
      } catch (err) {
        console.warn('[auth] disableAutoSelect failed', err);
      }
    };
    if (window.google && google.accounts && google.accounts.id) return clear();
    if (!googleClientId()) return;
    loadScript(GSI_SRC).then((ok) => {
      if (ok && window.google && google.accounts && google.accounts.id) clear();
    });
  }

  function signOut() {
    const profile = getProfile();
    if (!profile || profile.provider === 'google') disableGoogleAutoSelect();
    // Microsoft: drop the cached account rather than calling
    // logoutPopup, which would sign the person out of Microsoft
    // everywhere and can be swallowed by a popup blocker. Sign-in
    // always asks which account to use, so nothing is sticky.
    try {
      if (state.msalApp && state.msalApp.getAllAccounts) {
        state.msalApp.getAllAccounts().forEach((account) => {
          if (state.msalApp.removeAccount) state.msalApp.removeAccount(account);
        });
      }
    } catch (err) {
      console.warn('[auth] could not clear the Microsoft account cache', err);
    }
    state.profile = null;
    WTWStorage.remove('profile');
    WTWStorage.remove('googleProfile');
    if (typeof state.onChange === 'function') state.onChange(null);
  }

  /* ------------------------------------------------------------
     Decode a JWT payload. Decoding is NOT verification — see the
     header. Only the display fields are read.
     ------------------------------------------------------------ */
  function decodeJwt(token) {
    try {
      const payload = String(token).split('.')[1];
      if (!payload) return null;
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const json = decodeURIComponent(
        atob(padded).split('').map((c) =>
          '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
      );
      return JSON.parse(json);
    } catch (err) {
      console.warn('[auth] could not read the token', err);
      return null;
    }
  }

  // One shape, whichever provider it came from, so nothing downstream
  // has to care which button was pressed.
  function toProfile(provider, claims, extra = {}) {
    if (!claims) return null;
    const sub = extra.sub || claims.sub || claims.oid;
    if (!sub) return null;
    const name = extra.name || claims.name || claims.given_name || 'Signed in';
    return {
      provider,
      sub: String(sub),
      name,
      givenName: claims.given_name || String(name).split(' ')[0] || '',
      email: extra.email || claims.email || claims.preferred_username || '',
      picture: extra.picture || claims.picture || '',
      signedInAt: Date.now(),
    };
  }

  function decodeCredential(credential) {
    return toProfile('google', decodeJwt(credential));
  }

  /* ---------------- Lazy SDK loading ---------------- */

  function loadScript(src) {
    if (state.scripts[src]) return state.scripts[src];
    state.scripts[src] = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => {
        console.warn('[auth] could not load', src);
        resolve(false);
      };
      document.head.appendChild(script);
    });
    return state.scripts[src];
  }

  /* ---------------- Google ---------------- */

  function handleGoogleCredential(response) {
    const profile = decodeCredential(response && response.credential);
    if (!profile) return;
    saveProfile(profile);
  }

  // Renders Google's own branded button, which is the only presentation
  // their terms allow.
  async function renderGoogleButton(host) {
    if (!host) return 'no-container';
    const ok = await loadScript(GSI_SRC);
    if (!ok || !window.google || !google.accounts || !google.accounts.id) {
      return 'unavailable';
    }
    try {
      google.accounts.id.initialize({
        client_id: googleClientId(),
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      host.innerHTML = '';
      google.accounts.id.renderButton(host, {
        theme: 'filled_black',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        width: 260,
      });
      return 'rendered';
    } catch (err) {
      console.warn('[auth] Google button failed', err);
      return 'error';
    }
  }

  /* ---------------- Microsoft ---------------- */

  async function msalApp() {
    if (state.msalApp) return state.msalApp;
    const ok = await loadScript(MSAL_SRC);
    if (!ok || !window.msal || !msal.PublicClientApplication) return null;
    const app = new msal.PublicClientApplication({
      auth: {
        clientId: microsoftClientId(),
        authority: msAuthority(),
        redirectUri: location.origin + location.pathname,
      },
      cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
    });
    // MSAL 3 requires an explicit initialize; MSAL 2 has no such method.
    if (typeof app.initialize === 'function') await app.initialize();
    state.msalApp = app;
    return app;
  }

  // Popup rather than redirect: a redirect would drop whatever the
  // person was looking at, and the app has no router to put it back.
  async function signInWithMicrosoft() {
    const app = await msalApp();
    if (!app) return { ok: false, reason: 'unavailable' };
    try {
      const res = await app.loginPopup({
        scopes: ['openid', 'profile', 'email'],
        prompt: 'select_account',
      });
      const account = res.account || {};
      const claims = res.idTokenClaims || account.idTokenClaims ||
                     decodeJwt(res.idToken) || {};
      const profile = toProfile('microsoft', claims, {
        sub: account.homeAccountId || claims.oid || claims.sub,
        name: account.name || claims.name,
        email: account.username || claims.preferred_username || claims.email,
      });
      if (!profile) return { ok: false, reason: 'no-claims' };
      saveProfile(profile);
      return { ok: true };
    } catch (err) {
      // Closing the popup is a decision, not a failure.
      const message = String((err && err.errorCode) || (err && err.message) || '');
      if (/user_cancelled|popup_window_error|user_canceled/i.test(message)) {
        return { ok: false, reason: 'cancelled' };
      }
      console.warn('[auth] Microsoft sign-in failed', err);
      return { ok: false, reason: 'error' };
    }
  }

  function init({ onChange } = {}) {
    state.onChange = onChange;
    WTWStorage.remove('guestMode');   // a flag from an older version
    getProfile();
    if (typeof onChange === 'function') onChange(state.profile);
  }

  return {
    init, signOut, getProfile, isSignedIn, isConfigured, isSupportedHere,
    providers, renderGoogleButton, signInWithMicrosoft, decodeCredential,
    decodeJwt, toProfile,
  };
})();

window.WTWAuth = WTWAuth;
