/* ============================================================
   Aither Weather V26 — downloads.js
   Lists the desktop builds from the project's latest GitHub
   release, so the website can hand out the real files.

   The GitHub releases API needs no key and sends CORS headers, so
   the actual assets, their sizes and their download counts can be
   listed rather than guessed. If no release has been published yet
   the panel says so plainly instead of offering dead links.
   ============================================================ */

const WTWDownloads = (() => {
  const state = { release: null, loaded: false, error: null };

  const repo = () => (window.WTW_CONFIG && WTW_CONFIG.repo) || {};

  /* ---------------- Platform detection ---------------- */

  function detectPlatform() {
    const data = navigator.userAgentData;
    const hint = (data && data.platform) || navigator.platform || '';
    const ua = navigator.userAgent || '';
    const probe = `${hint} ${ua}`.toLowerCase();
    if (/win/.test(probe)) return 'windows';
    if (/mac|darwin/.test(probe)) return 'mac';
    if (/linux|x11|ubuntu|fedora/.test(probe)) return 'linux';
    return null;
  }

  /* ---------------- Asset classification ---------------- */

  const PLATFORMS = [
    { id: 'windows', label: 'Windows', icon: '🪟' },
    { id: 'mac',     label: 'macOS',   icon: '🍎' },
    { id: 'linux',   label: 'Linux',   icon: '🐧' },
  ];

  function classify(name) {
    const n = name.toLowerCase();
    if (n.endsWith('.exe')) {
      return { platform: 'windows', kind: n.includes('portable') ? 'Portable (no install)' : 'Installer' };
    }
    if (n.endsWith('.dmg')) {
      return { platform: 'mac', kind: n.includes('arm64') ? 'Apple Silicon' : 'Intel' };
    }
    if (n.endsWith('.zip') && n.includes('mac')) {
      return { platform: 'mac', kind: n.includes('arm64') ? 'Zip (Apple Silicon)' : 'Zip (Intel)' };
    }
    if (n.endsWith('.appimage')) return { platform: 'linux', kind: 'AppImage (portable)' };
    if (n.endsWith('.deb')) return { platform: 'linux', kind: 'Debian / Ubuntu' };
    if (n.endsWith('.rpm')) return { platform: 'linux', kind: 'Fedora / RHEL' };
    if (n.endsWith('.tar.gz')) return { platform: 'linux', kind: 'Tarball' };
    return null;   // blockmaps, latest.yml and friends
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }

  /* ---------------- Fetch ---------------- */

  async function load({ force = false } = {}) {
    if (state.loaded && !force) return state.release;
    try {
      const res = await fetch(repo().latestApi, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (res.status === 404) {
        // A repository with no published release yet — not an error.
        state.release = null;
        state.error = 'none';
        state.loaded = true;
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const assets = (data.assets || []).map((a) => {
        const info = classify(a.name);
        if (!info) return null;
        return {
          name: a.name,
          url: a.browser_download_url,
          size: a.size,
          platform: info.platform,
          kind: info.kind,
        };
      }).filter(Boolean);

      const checksums = (data.assets || [])
        .find((a) => /sha256sums/i.test(a.name));

      state.release = {
        checksums: checksums ? checksums.browser_download_url : null,
        tag: data.tag_name,
        name: data.name,
        published: data.published_at ? new Date(data.published_at) : null,
        url: data.html_url,
        assets,
      };
      state.error = null;
      state.loaded = true;
      return state.release;
    } catch (err) {
      console.warn('[downloads] release lookup failed', err.message);
      state.error = 'failed';
      state.loaded = true;
      return null;
    }
  }

  /* ---------------- Render ---------------- */

  function render(container) {
    if (!container) return;
    container.innerHTML = '';
    const mine = detectPlatform();

    if (!state.loaded) {
      container.innerHTML = '<p class="dl-note">Checking for builds…</p>';
      return;
    }

    if (!state.release) {
      const note = document.createElement('p');
      note.className = 'dl-note';
      note.innerHTML = state.error === 'none'
        ? `No desktop build has been published yet. Builds are produced by the
           <strong>Build desktop apps</strong> workflow — tag a version, or run it
           from the Actions tab. <a href="${repo().releasesUrl}" target="_blank" rel="noopener">Open releases ↗</a>`
        : `Couldn't reach GitHub to list the builds.
           <a href="${repo().releasesUrl}" target="_blank" rel="noopener">Open releases ↗</a>`;
      container.appendChild(note);
      return;
    }

    const meta = document.createElement('p');
    meta.className = 'dl-meta';
    const when = state.release.published && window.WTWUnits
      ? ` · released ${WTWUnits.dateTime(state.release.published)}` : '';
    meta.textContent = `${state.release.name || state.release.tag}${when}`;
    container.appendChild(meta);

    PLATFORMS.forEach((platform) => {
      const assets = state.release.assets.filter((a) => a.platform === platform.id);
      if (!assets.length) return;

      const group = document.createElement('div');
      group.className = 'dl-group' + (mine === platform.id ? ' dl-mine' : '');

      const head = document.createElement('div');
      head.className = 'dl-group-head';
      head.innerHTML = `<span class="dl-icon">${platform.icon}</span>` +
        `<span class="dl-platform">${platform.label}</span>` +
        (mine === platform.id ? '<span class="dl-badge">Your system</span>' : '');
      group.appendChild(head);

      assets.forEach((asset) => {
        const link = document.createElement('a');
        link.className = 'dl-asset';
        link.href = asset.url;
        link.setAttribute('download', '');
        link.innerHTML = `<span class="dl-kind">${asset.kind}</span>` +
          `<span class="dl-size">${formatSize(asset.size)}</span>`;
        link.title = asset.name;
        group.appendChild(link);
      });

      container.appendChild(group);
    });

    const all = document.createElement('a');
    all.className = 'dl-all';
    all.href = state.release.url || repo().releasesUrl;
    all.target = '_blank';
    all.rel = 'noopener';
    all.textContent = 'All files and release notes ↗';
    container.appendChild(all);

    const warn = document.createElement('p');
    warn.className = 'dl-note';
    warn.innerHTML = 'These builds are unsigned, so Windows SmartScreen and ' +
      'macOS Gatekeeper warn on first launch. On Windows choose &ldquo;More info &rarr; ' +
      'Run anyway&rdquo;; on macOS right-click the app and choose Open.' +
      (state.release.checksums
        ? ` <a href="${state.release.checksums}" target="_blank" rel="noopener">SHA256 checksums ↗</a>
            let you verify what you downloaded.`
        : '');
    container.appendChild(warn);
  }

  async function loadAndRender(container) {
    render(container);              // shows the checking state
    await load();
    render(container);
  }

  return { load, render, loadAndRender, detectPlatform, classify, formatSize };
})();

window.WTWDownloads = WTWDownloads;
