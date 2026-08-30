/* ============================================================
   Aither Weather V28 — auth.js
   Sign in with Google, Microsoft or Apple, through each provider's
   own browser SDK. Both are optional and both are key-free: a public
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

   There is also a name you can just type, which needs no provider
   and no setup and therefore always works. It is a profile on this
   device, it says so, and it claims nothing more — but it means the
   sign-in screen is never a dead end on a build where no client ID
   has been set.

   Nothing in the app is locked behind signing in; the whole thing
   works before anybody does. Signing in adds a name and a face,
   and that is all it claims to do.
   ============================================================ */

const WTWAuth = (() => {
  const GSI_SRC  = 'https://accounts.google.com/gsi/client';
  // Microsoft's own CDN. Pinned: an SDK that changes under the app
  // is an outage waiting for a quiet weekend.
  const MSAL_SRC = 'https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js';
  const APPLE_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

  const state = {
    profile: null,
    onChange: null,
    scripts: {},        // src -> Promise<boolean>
    msalApp: null,
  };

  const cfg = () => (window.WTW_CONFIG && WTW_CONFIG.auth) || {};

  /* ------------------------------------------------------------
     A client ID can come from two places: config.js, which is the
     committed one everybody who visits the site gets, and one pasted
     into Settings, which lives in this browser only. The pasted one
     wins, so a provider can be switched on and tried out without a
     code change or a deploy — but it switches it on for one device,
     which the panel says in as many words.
     ------------------------------------------------------------ */
  function storedIds() {
    const saved = WTWStorage.get('clientIds', null);
    return saved && typeof saved === 'object' ? saved : {};
  }

  function usable(raw) {
    const value = String(raw || '').trim();
    // A placeholder left in config.js is not a client ID.
    return value && !/^your[_-]/i.test(value) ? value : null;
  }

  function idOf(section) {
    return usable(storedIds()[section]) ||
           usable(cfg()[section] && cfg()[section].clientId);
  }

  // Returns the id actually in force, or null. An empty value clears
  // the stored one and hands the provider back to config.js.
  function setClientId(section, raw) {
    const ids = storedIds();
    const value = String(raw || '').trim();
    if (value) ids[section] = value;
    else delete ids[section];
    WTWStorage.set('clientIds', ids);
    return idOf(section);
  }

  // What Settings should show in each box: the pasted value only, so
  // an empty box never implies a provider is off when config.js has it.
  const storedClientId = (section) => storedIds()[section] || '';

  const googleClientId    = () => idOf('google');
  const microsoftClientId = () => idOf('microsoft');
  // Apple calls it a Services ID; it plays the same part.
  const appleClientId     = () => idOf('apple');

  // Apple insists the redirect URI be registered in advance and match
  // exactly, so it is configurable; the page's own URL is the sane
  // default and the one the README tells you to register.
  function appleRedirectUri() {
    const configured = ((cfg().apple && cfg().apple.redirectUri) || '').trim();
    return configured || (location.origin + location.pathname);
  }

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
    if (appleClientId()) out.push('apple');
    return out;
  }

  const isConfigured = () => providers().length > 0;

  /* ---------------- A name on this device ----------------
     No provider, no client ID, no network: this one is always
     available, including in the packaged desktop app where the others
     cannot work at all. It is a profile, not an identity, and the UI
     says so rather than implying otherwise. */

  // A picture without a provider: pick one of these rather than have an
  // initial stand in. Emoji, so there is nothing to host and nothing to
  // fetch.
  const AVATARS = ['🌩️', '🌈', '❄️', '🌪️', '☀️', '🌙', '🔥', '🐸', '🦖', '👽', '🍕', '💀'];

  function signInLocally(rawName, avatar) {
    const name = String(rawName || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!name) return { ok: false, reason: 'empty' };
    // Reuse this device's id if it already has one, so signing out and
    // back in is the same account rather than a new one each time.
    const existing = WTWStorage.get('localAccountId', null);
    const sub = existing ||
      `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    WTWStorage.set('localAccountId', sub);
    saveProfile({
      provider: 'local',
      sub,
      name,
      // Whatever they typed is what they want to be called, in full —
      // unlike a provider's name, where the first name is the friendly
      // part and the surname is just paperwork.
      givenName: name,
      email: '',
      picture: '',
      avatar: AVATARS.includes(avatar) ? avatar : '',
      signedInAt: Date.now(),
    });
    return { ok: true };
  }

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

  /* ---------------- Apple ----------------
     Two things about Apple differ from the others and both are handled
     here rather than surprising the rest of the app:

     1. The name comes back exactly once — on the very first
        authorization — and never again. If it is there, it is used;
        if not, the email's local part stands in.
     2. There is no picture, ever, so the UI falls back to an initial.
     ------------------------------------------------------------ */
  async function appleAuth() {
    const ok = await loadScript(APPLE_SRC);
    if (!ok || !window.AppleID || !AppleID.auth) return null;
    try {
      AppleID.auth.init({
        clientId: appleClientId(),
        scope: 'name email',
        redirectURI: appleRedirectUri(),
        usePopup: true,
      });
      return AppleID.auth;
    } catch (err) {
      console.warn('[auth] Apple init failed', err);
      return null;
    }
  }

  function nameFromApple(res, claims) {
    const person = (res && res.user && res.user.name) || {};
    const full = [person.firstName, person.lastName].filter(Boolean).join(' ').trim();
    if (full) return full;
    const email = (res && res.user && res.user.email) || claims.email || '';
    const local = email.split('@')[0];
    // Apple's private relay addresses are random strings; a name made
    // out of one is worse than no name at all.
    if (local && !/^[0-9a-z]{16,}$/i.test(local)) return local;
    return 'Signed in';
  }

  async function signInWithApple() {
    const auth = await appleAuth();
    if (!auth) return { ok: false, reason: 'unavailable' };
    try {
      const res = await auth.signIn();
      const claims = decodeJwt(res && res.authorization && res.authorization.id_token);
      if (!claims) return { ok: false, reason: 'no-claims' };
      const name = nameFromApple(res, claims);
      const profile = toProfile('apple', claims, {
        name,
        email: (res.user && res.user.email) || claims.email || '',
      });
      if (!profile) return { ok: false, reason: 'no-claims' };
      saveProfile(profile);
      return { ok: true };
    } catch (err) {
      const code = String((err && err.error) || (err && err.message) || '');
      if (/popup_closed_by_user|user_cancelled|user_trigger_new_signin_flow/i.test(code)) {
        return { ok: false, reason: 'cancelled' };
      }
      console.warn('[auth] Apple sign-in failed', err);
      return { ok: false, reason: 'error' };
    }
  }

  /* ------------------------------------------------------------
     Moving an account to another device, with no server involved.

     The code is this browser's account, saved places and settings,
     JSON-encoded and base64'd. Deliberately NOT included: any
     provider profile. A Google or Microsoft sign-in belongs to that
     provider on that device, and a token or an email address has no
     business travelling in a string somebody might paste into a chat.
     What travels is a name, a picture, favourites and preferences —
     which is why the panel can honestly say the code holds no
     password and no sign-in token.
     ------------------------------------------------------------ */
  const TRANSFER_VERSION = 1;

  function exportAccount() {
    const profile = getProfile();
    const payload = {
      v: TRANSFER_VERSION,
      name: profile && profile.provider === 'local' ? profile.name : '',
      avatar: profile && profile.provider === 'local' ? (profile.avatar || '') : '',
      settings: WTWStorage.getSettings(),
      favorites: WTWStorage.getFavorites(),
      madeAt: Date.now(),
    };
    try {
      // btoa is byte-oriented; encodeURIComponent first so an emoji or
      // an accented place name does not throw on the way out.
      return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    } catch (err) {
      console.warn('[auth] could not build a transfer code', err);
      return '';
    }
  }

  function importAccount(code) {
    let payload;
    try {
      payload = JSON.parse(decodeURIComponent(escape(atob(String(code || '').trim()))));
    } catch (err) {
      return { ok: false, reason: 'unreadable' };
    }
    if (!payload || payload.v !== TRANSFER_VERSION) return { ok: false, reason: 'unreadable' };

    const favorites = Array.isArray(payload.favorites) ? payload.favorites : [];
    const settings = payload.settings && typeof payload.settings === 'object'
      ? payload.settings : {};

    if (Object.keys(settings).length) WTWStorage.saveSettings(settings);
    if (favorites.length) WTWStorage.saveFavorites(favorites);
    if (payload.name) signInLocally(payload.name, payload.avatar);

    return { ok: true, name: payload.name || '', favorites: favorites.length };
  }

  function init({ onChange } = {}) {
    state.onChange = onChange;
    WTWStorage.remove('guestMode');   // a flag from an older version
    getProfile();
    if (typeof onChange === 'function') onChange(state.profile);
  }

  return {
    init, signOut, getProfile, isSignedIn, isConfigured, isSupportedHere,
    providers, renderGoogleButton, signInWithMicrosoft, signInWithApple,
    signInLocally, avatars: () => AVATARS.slice(),
    exportAccount, importAccount,
    decodeCredential, decodeJwt, toProfile,
    setClientId, storedClientId, configuredClientId: idOf,
  };
})();

window.WTWAuth = WTWAuth;
