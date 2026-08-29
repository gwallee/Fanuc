/* ============================================================
   What the Wether V17 — search.js
   Place search with real choices.

   Through V12 the search box took the single first geocoding hit,
   so "Springfield", "Portland" or any of the dozens of duplicated
   place names silently resolved to whichever one the API ranked
   first. This offers the actual candidates, disambiguated by
   region and country, and remembers what you picked before.
   ============================================================ */

const WTWSearch = (() => {
  const state = { results: [], active: -1, open: false, seq: 0, onPick: null };

  const cfg = () => (window.WTW_CONFIG && WTW_CONFIG.search) || { maxResults: 6, maxRecent: 6 };

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ---------------- Lookup ---------------- */

  function describe(hit) {
    // "Austin, Texas, United States" — enough to tell duplicates apart.
    const parts = [hit.name];
    if (hit.admin1 && hit.admin1 !== hit.name) parts.push(hit.admin1);
    if (hit.country) parts.push(hit.country);
    return parts.join(', ');
  }

  function toLocation(hit) {
    return { name: describe(hit), lat: hit.latitude, lon: hit.longitude };
  }

  async function lookup(query) {
    const q = query.trim();
    if (!q) return [];

    // A US ZIP resolves to exactly one place, so it skips the picker.
    if (/^\d{5}(-\d{4})?$/.test(q)) {
      try {
        const data = await getJSON(WTW_CONFIG.api.zip + q.slice(0, 5));
        const place = data.places && data.places[0];
        if (place) {
          return [{
            name: `${place['place name']}, ${place['state abbreviation']}`,
            lat: parseFloat(place.latitude),
            lon: parseFloat(place.longitude),
            exact: true,
          }];
        }
      } catch (err) {
        console.warn('[search] ZIP lookup failed, trying name search', err.message);
      }
    }

    const url = `${WTW_CONFIG.api.geocoding}?name=${encodeURIComponent(q)}` +
                `&count=${cfg().maxResults || 6}&language=en&format=json`;
    const data = await getJSON(url);
    return (data.results || []).map(toLocation);
  }

  /* ---------------- Recent searches ---------------- */

  function getRecent() {
    const list = WTWStorage.get('recentSearches', []);
    return Array.isArray(list) ? list : [];
  }

  function remember(location) {
    if (!location) return;
    const max = cfg().maxRecent || 6;
    const key = (l) => `${l.lat.toFixed(3)},${l.lon.toFixed(3)}`;
    const next = [location].concat(getRecent().filter((l) => key(l) !== key(location)));
    WTWStorage.set('recentSearches', next.slice(0, max));
  }

  function clearRecent() {
    WTWStorage.set('recentSearches', []);
  }

  /* ---------------- Dropdown ---------------- */

  function listEl() { return document.getElementById('searchResults'); }
  function inputEl() { return document.getElementById('searchInput'); }

  function close() {
    state.open = false;
    state.active = -1;
    const list = listEl();
    if (list) {
      list.hidden = true;
      list.innerHTML = '';
    }
    const input = inputEl();
    if (input) input.setAttribute('aria-expanded', 'false');
  }

  function render(items, { heading } = {}) {
    const list = listEl();
    const input = inputEl();
    if (!list) return;
    state.results = items;
    state.active = -1;
    list.innerHTML = '';

    if (!items.length) {
      list.hidden = true;
      if (input) input.setAttribute('aria-expanded', 'false');
      return;
    }

    if (heading) {
      const head = document.createElement('li');
      head.className = 'search-heading';
      head.setAttribute('role', 'presentation');
      head.textContent = heading;
      list.appendChild(head);
    }

    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'search-result';
      li.id = `searchResult-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.textContent = item.name;
      li.addEventListener('mousedown', (e) => {
        // mousedown, not click: blur would close the list first.
        e.preventDefault();
        pick(i);
      });
      list.appendChild(li);
    });

    list.hidden = false;
    state.open = true;
    if (input) input.setAttribute('aria-expanded', 'true');
  }

  function highlight(index) {
    const list = listEl();
    if (!list) return;
    const nodes = Array.from(list.querySelectorAll('.search-result'));
    nodes.forEach((n, i) => {
      const on = i === index;
      n.classList.toggle('active', on);
      n.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) n.scrollIntoView({ block: 'nearest' });
    });
    state.active = index;
    const input = inputEl();
    if (input) {
      input.setAttribute('aria-activedescendant',
        index >= 0 && nodes[index] ? nodes[index].id : '');
    }
  }

  function pick(index) {
    const item = state.results[index];
    if (!item) return;
    remember(item);
    close();
    const input = inputEl();
    if (input) input.value = '';
    if (typeof state.onPick === 'function') state.onPick(item);
  }

  /* ---------------- Wiring ---------------- */

  function showRecent() {
    const recent = getRecent();
    if (recent.length) render(recent, { heading: 'Recent' });
  }

  async function runSearch(query) {
    const seq = ++state.seq;
    try {
      const results = await lookup(query);
      if (seq !== state.seq) return null;      // a newer keystroke won
      if (results.length === 1 && results[0].exact) {
        pickDirect(results[0]);
        return results[0];
      }
      render(results);
      return results;
    } catch (err) {
      console.warn('[search] lookup failed', err.message);
      close();
      throw err;
    }
  }

  function pickDirect(location) {
    remember(location);
    close();
    const input = inputEl();
    if (input) input.value = '';
    if (typeof state.onPick === 'function') state.onPick(location);
  }

  function init({ onPick }) {
    state.onPick = onPick;
    const input = inputEl();
    const list = listEl();
    if (!input || !list) return;

    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (q.length < 2) {
        q.length === 0 ? showRecent() : close();
        return;
      }
      debounce = setTimeout(() => {
        lookup(q).then((results) => {
          if (input.value.trim() !== q) return;   // stale
          render(results);
        }).catch(() => close());
      }, 250);
    });

    const offerRecent = () => { if (!input.value.trim()) showRecent(); };
    input.addEventListener('focus', offerRecent);
    // 'focus' does not refire when the box already has focus, which is
    // exactly the state after picking a result, so listen for the click.
    input.addEventListener('click', offerRecent);

    input.addEventListener('keydown', (e) => {
      if (!state.open) return;
      const count = state.results.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlight((state.active + 1) % count);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlight((state.active - 1 + count) % count);
      } else if (e.key === 'Enter' && state.active >= 0) {
        e.preventDefault();
        pick(state.active);
      } else if (e.key === 'Escape') {
        close();
      }
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !list.contains(e.target)) close();
    });
  }

  return { init, lookup, runSearch, render, close, getRecent, remember, clearRecent, describe, pickDirect };
})();

window.WTWSearch = WTWSearch;
