const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
/* Node-side coverage test for the local AI: every personality must
   have usable, placeholder-free lines for every weather category. */
const fs = require('fs');
const path = APP_DIR + '/';

global.window = {};
global.WTW_CONFIG = JSON.parse(JSON.stringify({
  personalities: ['friendly','sassy','rude','brutal','deadpan','doomer'],
  roastLog: { maxEntries: 50 },
}));
let history = [];
global.WTWStorage = {
  getRoastHistory: () => history,
  saveRoastHistory: (h) => { history = h; },
  getSettings: () => ({ personality: 'sassy', username: 'DJTheBest' }),
};
eval(fs.readFileSync(APP_DIR + '/local-ai.js', 'utf8'));
const AI = global.window.LocalAI;

const PERSONALITIES = WTW_CONFIG.personalities;
const CATEGORIES = ['thunder','snow','rain','fog','wind','extremeHeat',
                    'extremeCold','cold','hot','clouds','clear'];

// Weather fixtures that map to each category via detectCategory.
const FIXTURES = {
  thunder:      { weatherCode: 95, tempF: 75, windMph: 10 },
  snow:         { weatherCode: 73, tempF: 28, windMph: 8 },
  rain:         { weatherCode: 63, tempF: 55, windMph: 8 },
  fog:          { weatherCode: 45, tempF: 50, windMph: 3 },
  wind:         { weatherCode: 1,  tempF: 60, windMph: 30 },
  extremeHeat:  { weatherCode: 0,  tempF: 101, windMph: 5 },
  extremeCold:  { weatherCode: 0,  tempF: 5,  windMph: 5 },
  cold:         { weatherCode: 0,  tempF: 35, windMph: 5 },
  hot:          { weatherCode: 0,  tempF: 88, windMph: 5 },
  clouds:       { weatherCode: 3,  tempF: 65, windMph: 5 },
  clear:        { weatherCode: 0,  tempF: 70, windMph: 5 },
};

let failures = 0;
const fail = (msg) => { console.log('FAIL - ' + msg); failures++; };

// 1. detectCategory maps each fixture to the intended category.
for (const cat of CATEGORIES) {
  const got = AI.detectCategory({ ...FIXTURES[cat], city: 'Testville' });
  if (got !== cat) fail(`detectCategory(${cat} fixture) returned "${got}"`);
}
console.log('PASS - every fixture maps to its intended category');

// 2. Every personality x category produces clean, varied output.
let totalLines = 0;
for (const p of PERSONALITIES) {
  for (const cat of CATEGORIES) {
    history = [];
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const line = AI.generate({ ...FIXTURES[cat], city: 'Testville', feelsLikeF: 80 },
                               { personality: p, username: 'DJTheBest' });
      if (!line || line.length < 15) { fail(`${p}/${cat}: line too short: "${line}"`); break; }
      if (/\{[a-z]+\}/i.test(line)) { fail(`${p}/${cat}: unreplaced placeholder in "${line}"`); break; }
      if (line.includes('undefined') || line.includes('NaN')) { fail(`${p}/${cat}: bad value in "${line}"`); break; }
      seen.add(line);
    }
    if (seen.size < 3) fail(`${p}/${cat}: only ${seen.size} distinct line(s) in 40 draws`);
    totalLines += seen.size;
  }
}
console.log(`PASS - all ${PERSONALITIES.length} personalities x ${CATEGORIES.length} categories produce clean varied output`);

// 3. Anti-repeat: consecutive draws should rarely repeat.
history = [];
let repeats = 0, prev = null;
for (let i = 0; i < 60; i++) {
  const line = AI.generate({ ...FIXTURES.rain, city: 'Testville' }, { personality: 'rude', username: 'X' });
  if (line === prev) repeats++;
  prev = line;
}
// Back-to-back repeats must be impossible, not merely unlikely: the pool
// reset used to hand the just-used line straight back.
if (repeats > 0) fail(`anti-repeat weak: ${repeats} back-to-back repeats in 60 draws`);
else console.log('PASS - anti-repeat holds (no back-to-back repeats in 60 draws)');

// 4. Unknown personality must not throw.
try {
  const l = AI.generate(FIXTURES.clear, { personality: 'nonsense', username: 'X' });
  if (!l || l.length < 10) fail('unknown personality produced nothing');
  else console.log('PASS - unknown personality falls back safely');
} catch (e) { fail('unknown personality threw: ' + e.message); }

// 5. Missing weather fields must not throw or leak NaN.
try {
  const l = AI.generate({}, { personality: 'brutal', username: 'X' });
  if (/NaN|undefined/.test(l)) fail('empty weather leaked NaN/undefined: ' + l);
  else console.log('PASS - empty weather object handled');
} catch (e) { fail('empty weather threw: ' + e.message); }

console.log(`\n${totalLines} distinct lines across all pools`);
console.log(failures ? `${failures} FAILURE(S)` : 'All AI coverage checks passed.');
process.exit(failures ? 1 : 0);
