#!/usr/bin/env node
// Checks the Hymns app before a push:
//
//   node tools/check-app.js            (--shots saves screenshots to the temp folder)
//
// Checks every inline script parses, then opens the app in a phone-sized
// Chromium with the network faked (the song listings and the audio), and
// walks the everyday journeys: playing a song, resuming the last song,
// Back closing sheets, a song that won't load, removing a download, and
// Psalms/Specials keeping their ids when new files are uploaded.
//
// Needs Playwright (npm i -g playwright) and its Chromium.

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv.includes('--shots');
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {}
  try { return require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright')); } catch (e) {}
  console.error('Playwright is not installed: npm i -g playwright');
  process.exit(2);
}

// ── Static checks ──────────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
console.log('Scripts');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((src, i) => {
  try { new Function(src); ok(true, 'inline script ' + i + ' parses'); }
  catch (e) { ok(false, 'inline script ' + i + ': ' + e.message); }
});
ok(/CACHE_NAME = 'ifb-hymns-v\d+'/.test(sw), 'sw.js CACHE_NAME looks like ifb-hymns-vNN (the About sheet reads it)');

// ── Fake network ───────────────────────────────────────────────────────────
// A short silent WAV stands in for every recording.
function silentWav(seconds) {
  const rate = 8000, n = rate * seconds, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36);
  b.writeUInt32LE(n, 40); b.fill(128, 44);
  return b;
}
const WAV = silentWav(20);
const PSALM_FILES = ['0001 Psalm 1 1-6 song.mp3', '0023 Psalm 23 1-6 song.mp3', '0091 Psalm 91 1-16 song.mp3'];
const PSALM_FILES_NEW = ['0001 Psalm 1 1-6 song.mp3', '0019 Psalm 19 1-14 song.mp3', '0023 Psalm 23 1-6 song.mp3', '0091 Psalm 91 1-16 song.mp3'];
const TG_FILES = ['Brand New Special - Test Quartet.mp3'];

// The Bible app's data: from a KJVBible checkout next to this one, or a small stand-in
const KJV_DIR = path.join(ROOT, '..', 'KJVBible');
const KJV_FILES = {};
if (fs.existsSync(path.join(KJV_DIR, 'hymns.json'))) {
  KJV_FILES['hymns.json'] = fs.readFileSync(path.join(KJV_DIR, 'hymns.json'));
  KJV_FILES['bible/Psalms.json'] = fs.readFileSync(path.join(KJV_DIR, 'bible', 'Psalms.json'));
} else {
  KJV_FILES['hymns.json'] = JSON.stringify({ h: [['Leaning on the Everlasting Arms', 'Elisha A. Hoffman', 1887, 'Assurance and Trust',
    [['Deuteronomy 33:27', 'Deuteronomy 33:27']], [['What a fellowship, what a joy divine,', 'Leaning on the everlasting arms;']], ['Leaning, leaning,']],
    ['A Mighty Fortress Is Our God', 'Martin Luther', 1529, 'Praise and Worship', [['Psalm 46:1', 'Psalms 46:1']], [['A mighty fortress is our God,']], []],
    ['Pass Me Not', 'Fanny J. Crosby', 1868, 'Salvation and Invitation', [['Luke 18:38', 'Luke 18:38']], [['Pass me not, O gentle Saviour,']], []]] });
  const chapters = Array.from({ length: 150 }, (_, i) => ({ chapter: String(i + 1), verses: [{ verse: '1', text: 'Verse one of Psalm ' + (i + 1) + '.' }] }));
  chapters[22].verses = [{ verse: '1', text: 'The LORD is my shepherd; I shall not want.' }, { verse: '2', text: 'He maketh me to lie down in green pastures.' }];
  KJV_FILES['bible/Psalms.json'] = JSON.stringify({ book: 'Psalms', chapters });
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/Hymns/, '');
  if (p === '/' || p === '') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(f)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(f));
});

async function newPage(browser, { seed = {}, psalmFiles = PSALM_FILES, badAudio = null, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('http://localhost')) return route.continue();
    if (url.includes('telegram-list.fbckjv.app')) {
      const files = url.includes('prefix=Psalms') ? psalmFiles : TG_FILES;
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ files: files.map(filename => ({ filename })) }) });
    }
    if (/\.(mp3|m4a|wav|ogg)(\?|$)/i.test(url)) {
      if (badAudio && decodeURIComponent(url).includes(badAudio)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Access-Control-Allow-Origin': '*' }, body: WAV });
    }
    if (url.startsWith('https://fbckjv.app/KJVBible/')) { // the Bible app's hymns and Psalms
      const rel = decodeURIComponent(new URL(url).pathname.replace('/KJVBible/', ''));
      const body = KJV_FILES[rel];
      return body ? route.fulfill({ status: 200, contentType: 'application/json', body }) : route.fulfill({ status: 404, body: '' });
    }
    return route.abort(); // fonts, YouTube, etc.
  });
  await ctx.addInitScript(s => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  }, seed);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto('http://localhost:8766/Hymns/' + query);
  await page.waitForFunction(() => typeof psalmsLoadState !== 'undefined' && psalmsLoadState === 'ok', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return page;
}
const toastText = page => page.$eval('#toast', el => el.classList.contains('show') ? el.textContent : '');
const isOpen = (page, id) => page.$eval(id, el => el.classList.contains('open'));

(async () => {
  const { chromium } = loadPlaywright();
  await new Promise(r => server.listen(8766, r));
  const launch = {};
  if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
  let browser;
  try { browser = await chromium.launch(launch); } catch (e) { browser = await chromium.launch(); }

  // ── Everyday listening ──
  console.log('Listening');
  let page = await newPage(browser);
  ok(page.errors.length === 0, 'opens with no script errors' + (page.errors.length ? ': ' + page.errors.join('; ') : ''));
  ok(await page.$$eval('.hymn-item', els => els.length) > 300, 'the full list shows');
  await page.click('.hymn-item >> nth=0');
  await page.waitForFunction(() => !document.getElementById('audio-el').paused, null, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(() => !document.getElementById('audio-el').paused), 'tapping a hymn plays it');
  await page.waitForFunction(() => document.getElementById('audio-el').currentTime > 0, null, { timeout: 5000 }).catch(() => {});
  ok(await page.evaluate(() => !document.getElementById('play-btn').classList.contains('loading')), 'loading ring clears once it plays');
  const before = await page.evaluate(() => currentHymn.id);
  await page.click('#next-btn');
  await page.waitForTimeout(300);
  ok(await page.evaluate(b => currentHymn.id !== b, before), 'Next moves to another song');
  ok(await page.$eval('.tab[data-src="hammond"]', el => !!el), 'Hammond tab is there');
  await page.click('.tab[data-src="hammond"]');
  ok(await page.$eval('.hymn-item .source-badge', el => el.textContent.trim()) === 'Hammond', 'Hammond badge reads "Hammond"');
  await page.click('.tab[data-src="psalms"]');
  ok(await page.$$eval('.hymn-item', els => els.length) === PSALM_FILES.length, 'Sung Psalms tab lists the server’s Psalms');
  ok(await page.evaluate(() => HYMNS.filter(h => h.source === 'psalms').every(h => /^ps-/.test(h.id))), 'Psalms get ids from their file names');
  if (SHOTS) await page.screenshot({ path: path.join(require('os').tmpdir(), 'hymns-dark.png') });
  await page.context().close();

  // ── Back button closes sheets ──
  console.log('Back button');
  page = await newPage(browser);
  await page.click('.hymn-item >> nth=1');
  await page.click('#np-title');
  await page.waitForTimeout(200);
  ok(await isOpen(page, '#now-playing-panel'), 'tapping the player opens the full player');
  await page.evaluate(() => history.back());
  await page.waitForTimeout(300);
  ok(!(await isOpen(page, '#now-playing-panel')), 'Back closes the full player');
  ok(page.url().startsWith('http://localhost:8766/Hymns/'), 'and stays in the app');
  for (const [btn, panel] of [['#tips-btn', '#tips-panel'], ['#info-btn', '#info-panel'], ['#lyr-btn', '#lyrics-panel']]) {
    await page.click(btn); await page.waitForTimeout(150);
    const opened = await isOpen(page, panel);
    await page.evaluate(() => history.back()); await page.waitForTimeout(300);
    ok(opened && !(await isOpen(page, panel)), 'Back closes ' + panel.slice(1));
  }
  await page.click('#info-btn'); await page.waitForTimeout(150);
  ok(await page.$eval('[data-count="hammond"]', el => +el.textContent) === 69, 'About counts the recordings');
  await page.click('#close-info'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !(history.state && history.state.sheet)), '✕ takes its Back step off too');
  await page.context().close();

  // ── Resume where you left off ──
  console.log('Resume');
  page = await newPage(browser, { seed: { sh_last: { id: 'o05', src: 'olmstead' } } });
  ok(await page.$eval('#np-title', el => el.textContent) === 'Footsteps of Jesus', 'player shows the last song');
  await page.click('#play-btn');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => decodeURIComponent(document.getElementById('audio-el').src).includes('Footsteps of Jesus')), 'Play resumes that song, not the first in the list');
  await page.context().close();
  // a Psalm (only known after the listing loads)
  const psId = await (async () => { const p = await newPage(browser); const id = await p.evaluate(() => HYMNS.find(h => h.title === 'Psalm 23').id); await p.context().close(); return id; })();
  page = await newPage(browser, { seed: { sh_last: { id: psId, src: 'psalms' } } });
  ok(await page.$eval('#np-title', el => el.textContent) === 'Psalm 23', 'a last-played Psalm is restored too');
  await page.context().close();

  // ── Old Psalm favorites keep pointing at the same Psalm ──
  console.log('Psalm ids across uploads');
  page = await newPage(browser, {
    psalmFiles: PSALM_FILES_NEW, // Psalm 19 was uploaded since the last visit
    seed: {
      sh_psalms_dynamic_v1: { fetchedAt: 0, data: { files: PSALM_FILES.map(filename => ({ filename })) } },
      sh_favs: ['psnew9002'],     // the old copy's id for Psalm 91
      sh_history_v1: [{ id: 'psnew9001', ts: 1 }], // Psalm 23
    },
  });
  const favTitles = await page.evaluate(() => [...favorites].map(id => (HYMNS.find(h => h.id === id) || {}).title));
  ok(favTitles.length === 1 && favTitles[0] === 'Psalm 91', 'old favorite is still Psalm 91 (got ' + favTitles + ')');
  ok(await page.evaluate(() => (HYMNS.find(h => h.id === playHistory[0].id) || {}).title) === 'Psalm 23', 'old History entry is still Psalm 23');
  await page.context().close();

  // ── A song that won't load says so ──
  console.log('Playback errors');
  page = await newPage(browser, { badAudio: 'Footsteps of Jesus' });
  await page.fill('#search', 'Footsteps of Jesus'); await page.waitForTimeout(400);
  await page.click('.hymn-item >> nth=0');
  await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
  ok(/Couldn’t play/.test(await toastText(page)), 'a failed song shows a message');
  ok(await page.evaluate(() => !document.getElementById('play-btn').classList.contains('loading') && !isPlaying), 'and the play button goes back to Play');
  await page.context().close();

  // ── Words and Scripture ──
  console.log('Words and Scripture');
  page = await newPage(browser);
  await page.waitForFunction(() => Object.keys(KJV_HYMNS).length > 0, null, { timeout: 5000 }).catch(() => {});
  const words = async title => {
    await page.evaluate(t => { playHymn(HYMNS.find(h => h.title === t)); openLyrics(); }, title);
    await page.waitForFunction(() => !/Opening the Psalm/.test(document.getElementById('lyr-body').textContent), null, { timeout: 5000 }).catch(() => {});
    const r = await page.$eval('#lyr-body', el => ({ text: el.textContent, chips: [...el.querySelectorAll('.sc-chip')].map(a => [a.textContent.trim(), a.href]) }));
    await page.evaluate(() => closeSheet('lyrics')); await page.waitForTimeout(250);
    return r;
  };
  let w = await words('Leaning on the Everlasting Arms');
  ok(/What a fellowship/.test(w.text), 'words come from the Bible app’s hymns');
  ok(w.chips.some(([t, href]) => /Deuteronomy 33:27/.test(t) && href === 'https://fbckjv.app/KJVBible/#Deuteronomy+33:27'), '📖 Deuteronomy 33:27 opens the Bible app at the verse');
  w = await words('What A Friend We Have in Jesus');
  ok(/What a friend we have in Jesus/i.test(w.text), 'words found when only the capitals differ');
  w = await words('Victory in Jesus (Congregational)');
  ok(/victory/i.test(w.text) && !/aren’t shown/.test(w.text), 'words found past a "(Congregational)" note');
  w = await words('My Savior\'s Love');
  ok(/I stand amazed/.test(w.text), 'a newly added public-domain hymn has its words');
  w = await words('A Mighty Fortress Is Our God');
  ok(w.chips.some(([t, href]) => /Psalm 46/.test(t) && /KJVBible\/#Psalms\+46:1$/.test(href)), 'a hymn added to the Bible app later also gets its 📖 Scripture button');
  w = await words('Pass Me Not, O Gentle Savior');
  ok(w.chips.length > 0, 'a song recorded under a fuller title (Pass Me Not, O Gentle Savior) finds its hymn');
  w = await words('Psalm 23');
  ok(/The LORD is my shepherd/.test(w.text), 'a Sung Psalm shows its verses from the KJV');
  ok(w.chips.some(([t, href]) => /Psalm 23/.test(t) && /#Psalms\+23:1$/.test(href)), 'and a 📖 button to read it in the Bible app');
  w = await words('Ain\'t God Good');
  ok(/aren’t shown yet/.test(w.text), 'a song without words says so plainly');
  await page.evaluate(() => { closeSheet('np'); });
  await page.fill('#search', 'everlasting arms'); await page.waitForTimeout(400);
  ok(await page.$$eval('.hymn-title', els => els.some(e => e.textContent === 'Leaning on the Everlasting Arms')), 'search finds words from the Bible app’s hymns');
  if (SHOTS) {
    await page.evaluate(() => { playHymn(HYMNS.find(h => h.title === 'Psalm 23')); openNowPlaying(); });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(require('os').tmpdir(), 'hymns-psalm.png') });
  }
  await page.context().close();

  // ── A link from the Bible app: ?psalm=23 ──
  console.log('Psalm links');
  page = await newPage(browser, { psalmFiles: PSALM_FILES, query: '?psalm=23' });
  await page.waitForTimeout(600);
  ok(await page.evaluate(() => currentHymn && currentHymn.title === 'Psalm 23'), '?psalm=23 loads Psalm 23');
  ok(await page.evaluate(() => activeSource === 'psalms'), 'and shows the Sung Psalms tab');
  ok(await isOpen(page, '#now-playing-panel'), 'with the full player open');
  ok(!page.url().includes('psalm='), 'and the link is cleared from the address');
  await page.context().close();
  page = await newPage(browser, { psalmFiles: PSALM_FILES, query: '?psalm=19' });
  await page.waitForTimeout(600);
  ok(/No recording of Psalm 19/.test(await toastText(page)), 'a Psalm with no recording says so');
  await page.context().close();

  // ── Removing a download asks first ──
  console.log('Downloads');
  page = await newPage(browser, { seed: { sh_downloads_v1: { o05: { url: 'x', title: 'Footsteps of Jesus', size: 1000, ts: 1 } } } });
  await page.fill('#search', 'Footsteps of Jesus'); await page.waitForTimeout(400);
  await page.click('.hymn-item .dl-btn.downloaded');
  await page.waitForTimeout(200);
  ok(await isOpen(page, '#confirm-panel'), 'tapping ✓ asks before removing');
  await page.click('#confirm-cancel'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => isDownloaded('o05')), '“Keep it” keeps the download');
  await page.click('.hymn-item .dl-btn.downloaded'); await page.waitForTimeout(200);
  await page.evaluate(() => history.back()); await page.waitForTimeout(300);
  ok(!(await isOpen(page, '#confirm-panel')) && await page.evaluate(() => isDownloaded('o05')), 'Back also keeps it');
  await page.click('.hymn-item .dl-btn.downloaded'); await page.waitForTimeout(200);
  await page.click('#confirm-ok'); await page.waitForTimeout(400);
  ok(await page.evaluate(() => !isDownloaded('o05')), '“Remove” removes it');
  if (SHOTS) {
    await page.click('#theme-btn');
    await page.screenshot({ path: path.join(require('os').tmpdir(), 'hymns-light.png') });
  }
  await page.context().close();

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
