/*
 * Helpers to open the real Index.html in a simulated browser (jsdom), connected to the real Code.js on the fake sheet.
 */
'use strict';
process.env.TZ = 'Asia/Kolkata';
const fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = () => fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8')
  .replace('<head>', '<head><script>var APP_URL="https://script.google.com/macros/s/FAKE/exec";var INIT={};</script>'); // what doGet adds

/* google.script.run, connected to the fake server. net(fn) can say 'offline' (never arrives) or 'lost' (server saves, reply lost). */
function bridge(server, opt) {
  const b = { calls: [], inflight: 0, net: () => 'ok', delay: opt && opt.delay || 40 };
  const runner = (succ, fail) => new Proxy({}, { get(_, fn) {
    if (fn === 'withSuccessHandler') return h => runner(h, fail);
    if (fn === 'withFailureHandler') return h => runner(succ, h);
    return function () {
      const args = Array.prototype.slice.call(arguments);
      b.calls.push(fn); b.inflight++;
      setTimeout(() => {
        b.inflight--;
        const mode = b.net(fn, args);
        if (mode === 'offline') return fail && fail({ message: 'NetworkError: Connection failure due to HTTP 0' });
        let res;
        try { res = server.run.apply(null, [fn].concat(args)); } catch (e) { return fail && fail({ message: e.message }); }
        if (mode === 'lost') return fail && fail({ message: 'NetworkError: Connection failure due to HTTP 0' });
        if (succ) succ(res);
      }, b.delay);
    };
  } });
  b.run = runner(null, null);
  return b;
}

/* Opens the app like a phone/laptop would: token (and maybe saved data) already in localStorage. onError(msg) gets page errors. */
function openApp(server, token, storage, onError) {
  const br = bridge(server);
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message) && onError) onError(e.message); });
  const dom = new JSDOM(page(), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://n-x.script.googleusercontent.com/userCodeAppPanel', virtualConsole: vc,
    beforeParse(win) {
      win.google = { script: { run: br.run } };
      win.scrollTo = () => {};
      Object.keys(storage || {}).forEach(k => win.localStorage.setItem(k, storage[k]));
      if (token) win.localStorage.setItem('ddgs_token', token);
    }
  });
  const win = dom.window;
  return { win, br, dom, $: s => win.document.querySelector(s), $$: s => Array.from(win.document.querySelectorAll(s)),
    storage: () => { const o = {}; for (let i = 0; i < win.localStorage.length; i++) { const k = win.localStorage.key(i); o[k] = win.localStorage.getItem(k); } return o; } };
}
/* Waits until nothing is saving or loading. */
async function idle(app, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 10000)) {
    await sleep(25);
    // NEEDSYNC: a fetch of others' changes is queued right after a save (it starts a moment later)
    if (!app.win.Q.length && !app.win.QRUN && !app.win.BUSY && !app.br.inflight && !app.win.SYNCING && !app.win.NEEDSYNC && app.win.D) return true;
  }
  return false;
}
function fill(app, vals) {
  Object.keys(vals).forEach(k => {
    const el = app.win.document.getElementById('f_' + k);
    if (!el) throw new Error('no field ' + k);
    if (el.type === 'checkbox') el.checked = !!vals[k]; else el.value = vals[k];
  });
}
const submit = app => app.$('#mform').dispatchEvent(new app.win.Event('submit', { cancelable: true }));
/* One APP_TRUCKS row of the fake sheet as {header: value}. */
const truckRow = (s, id) => { const h = s.store.sheet('APP_TRUCKS').dump(); const r = h.slice(1).find(x => x[0] === id); const o = {}; h[0].forEach((k, i) => { o[k] = r ? r[i] : undefined; }); return r ? o : null; };

module.exports = { sleep, bridge, openApp, idle, fill, submit, truckRow };
