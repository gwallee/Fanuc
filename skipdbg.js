const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ serviceWorkers: 'block' });
  await p.route('https://**', r => r.abort());
  await p.goto(process.env.WTW_BASE_URL + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  const info = await p.evaluate(() => {
    const el = document.querySelector('.skip-link');
    return { exists: !!el, html: el ? el.outerHTML : null,
      firstChild: document.body.firstElementChild.tagName + '.' + document.body.firstElementChild.className };
  });
  console.log(JSON.stringify(info, null, 1));
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await p.keyboard.press('Tab');
  console.log('after Tab:', await p.evaluate(() => document.activeElement.tagName + ' | ' + document.activeElement.className + ' | ' + (document.activeElement.id||'')));
  await p.evaluate(() => document.querySelector('.skip-link').focus());
  console.log('forced focus top:', await p.evaluate(() => document.querySelector('.skip-link').getBoundingClientRect().top));
  await b.close();
})();
