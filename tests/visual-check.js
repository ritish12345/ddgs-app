/*
 * Real-browser check (Microsoft Edge on this computer, hidden window): opens the real Index.html, connected to the
 * real Code.js on the fake sheet, at laptop and phone sizes. Clicks every main tab and checks that the tab bar never
 * hides Overview or the tab that was clicked. Saves pictures of the tab bar to the folder given (default: tests/shots).
 * Not part of npm test (needs Edge). Run: node tests/visual-check.js [folder]
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const fs = require('fs'), path = require('path'), http = require('http');
const puppeteer = require('puppeteer-core');
const { makeServer } = require('./fake-gas');
const { runScenario } = require('./scenario');

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const OUT = process.argv[2] || path.join(__dirname, 'shots');
const SIZES = [{ name: 'laptop-1366', width: 1366, height: 768 }, { name: 'laptop-1280', width: 1280, height: 720 },
  { name: 'phone-390', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }];

let fails = 0;
const ok = (cond, label) => { console.log((cond ? '  ok    ' : '  FAIL  ') + label); if (!cond) fails++; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const s = makeServer();
  runScenario(s);
  const token = s.run('api_login', 'nidhish23', 'secret1').token; // the Owner sees the most tabs
  const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8')
    .replace('<head>', '<head><script>var APP_URL="http://localhost/";var INIT={};</script>');
  const web = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }).listen(0);
  const url = 'http://localhost:' + web.address().port + '/';
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-first-run'] });
  try {
    for (const size of SIZES) {
      console.log(size.name + ' (' + size.width + ' px wide)');
      const page = await browser.newPage();
      page.on('pageerror', e => { console.log('  page error: ' + e.message); fails++; });
      await page.setViewport(size);
      await page.exposeFunction('gasCall', (fn, a) => {
        try { return { ok: true, res: s.run.apply(null, [fn].concat(JSON.parse(a))) }; } catch (e) { return { ok: false, msg: e.message }; }
      });
      await page.evaluateOnNewDocument(tok => {
        localStorage.setItem('ddgs_token', tok);
        const runner = (succ, fail) => new Proxy({}, { get(_, fn) {
          if (fn === 'withSuccessHandler') return h => runner(h, fail);
          if (fn === 'withFailureHandler') return h => runner(succ, h);
          return function () { window.gasCall(fn, JSON.stringify(Array.prototype.slice.call(arguments))).then(r => { if (r.ok) { if (succ) succ(r.res); } else if (fail) fail({ message: r.msg }); }); };
        } });
        window.google = { script: { run: runner(null, null) } };
      }, token);
      await page.goto(url);
      await page.waitForFunction('window.D && window.T && document.querySelectorAll("#nav button").length > 5', { timeout: 15000 });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      const tabs = await page.$$eval('#nav button', b => b.map(x => x.dataset.tab));
      const info = await page.evaluate(() => { const n = document.querySelector('#nav'); return { overflow: n.scrollWidth > n.clientWidth + 1, rows: Math.round(n.getBoundingClientRect().height) }; });
      console.log('        tabs: ' + tabs.join(', ') + (info.overflow ? ' (row scrolls sideways)' : ' (all fit, bar height ' + info.rows + ' px)'));
      for (const tab of tabs) {
        await page.click('#nav button[data-tab="' + tab + '"]');
        await new Promise(r => setTimeout(r, 120));
        const v = await page.evaluate(t => {
          const n = document.querySelector('#nav').getBoundingClientRect();
          const seen = b => { const r = b.getBoundingClientRect(); return r.left >= n.left - 1 && r.right <= n.right + 1; };
          return { home: seen(document.querySelector('#nav [data-tab="home"]')), clicked: seen(document.querySelector('#nav [data-tab="' + t + '"]')),
            on: (document.querySelector('#nav .on') || {}).dataset ? document.querySelector('#nav .on').dataset.tab : '' };
        }, tab);
        ok(v.on === tab && v.home && v.clicked, 'click ' + tab.padEnd(9) + '→ Overview ' + (v.home ? 'visible' : 'HIDDEN') + ', clicked tab ' + (v.clicked ? 'fully visible' : 'CUT OFF'));
        if (tab === 'freight' || tab === 'more') {
          const box = await page.evaluate(() => { const r = document.querySelector('header').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) + 60 }; });
          await page.screenshot({ path: path.join(OUT, size.name + '-' + tab + '.png'), clip: box });
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
    web.close();
  }
  console.log(fails ? '\n' + fails + ' FAILED' : '\nTab bar OK at every size.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
