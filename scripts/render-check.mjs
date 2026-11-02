#!/usr/bin/env node
// Real-browser render & interaction check for GAVEX pages (headless Chrome via CDP, zero dependencies).
// Usage: node scripts/render-check.mjs [dashboard|published|docs|readme|all]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.verify');
const SHOTS = join(OUT, 'screens');
mkdirSync(SHOTS, { recursive: true });

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) { console.error('No Chrome found; set CHROME_PATH'); process.exit(2); }

const which = process.argv[2] || 'all';
if (!['dashboard', 'published', 'docs', 'readme', 'all'].includes(which)) { console.error('Unknown target: ' + which); process.exit(2); }
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PAGES = {
  dashboard: pathToFileURL(join(ROOT, 'docs/dashboard/index.html')).href,
  published: pathToFileURL(join(ROOT, 'docs/dashboard/index.html')).href,
  docs: pathToFileURL(join(ROOT, 'docs/index.html')).href
};
const VIEWPORTS = [390, 1024, 1440];
const THEMES = ['dark', 'light'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'gavex-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--allow-file-access-from-files', 'about:blank'
], { stdio: 'ignore' });

async function waitForChrome() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return; } catch {}
    await sleep(150);
  }
  throw new Error('Chrome did not start');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; 
    ws.onclose = () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.rej(new Error('CDP socket closed')); } this.pending.clear(); };
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej, timer } = this.pending.get(msg.id); clearTimeout(timer); this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) this.listeners.forEach((l) => l(msg));
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, method === 'Runtime.evaluate' ? 90000 : 20000);
      this.pending.set(id, { res, rej, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) { this.listeners.push(fn); }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

async function openPage() {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const t = await r.json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const c = new CDP(ws);
  c.errors = [];
  c.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') c.errors.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') c.errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url || '')) c.errors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Log.enable');
  return c;
}

async function navigate(c, url) {
  const loaded = new Promise((res) => { const h = (m) => { if (m.method === 'Page.loadEventFired') res(); }; c.on(h); });
  await c.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(8000)]);
  await sleep(700);
}

// Geometry: horizontal overflow + one-sided accent bars (left/right border asymmetry) on every element.
const GEOMETRY = `(() => {
  const vw = document.documentElement.clientWidth;
  const overflow = document.documentElement.scrollWidth - vw;
  const offenders = [];
  const sideBars = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const lw = parseFloat(cs.borderLeftWidth), rw = parseFloat(cs.borderRightWidth);
    const lc = cs.borderLeftColor, rc = cs.borderRightColor;
    const ls = cs.borderLeftStyle, rs = cs.borderRightStyle;
    const lOn = ls !== 'none' && lw > 0, rOn = rs !== 'none' && rw > 0;
    if (lOn !== rOn || (lOn && rOn && (lw !== rw || lc !== rc)) || lw > 1.5 || rw > 1.5) {
      sideBars.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' L=' + lw + ' ' + lc + ' R=' + rw + ' ' + rc);
    }
    const r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 1) {
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
      if (!clipped) offenders.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' right=' + Math.round(r.right));
    }
  }
  const cardSel = '.panel, .lane, .lane-inner, .wcard, .vcard, .rework, .ws-matrix, .prow, .rev, .sb-step, .sbw, .sbv, .gate, .mode, .vs-card, .live-card, .lc-row, .stat, .kpi, .tab-panel, .code, .pillar, .protocol-note';
  const cardOverflow = [];
  for (const card of document.querySelectorAll(cardSel)) {
    const cr = card.getBoundingClientRect();
    if (!cr.width) continue;
    for (const el of card.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= cr.right + 1) continue;
      let p = el.parentElement, clipped = false;
      while (p && p !== card) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { clipped = true; break; } p = p.parentElement; }
      if (!clipped && getComputedStyle(el).position !== 'absolute') { cardOverflow.push('.' + [...card.classList].join('.') + ' > ' + el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + ' +' + Math.round(r.right - cr.right) + 'px'); break; }
    }
  }
  return { vw, overflow, offenders: offenders.slice(0, 8), sideBars: sideBars.slice(0, 8), cardOverflow: cardOverflow.slice(0, 8), theme: document.documentElement.getAttribute('data-theme') };
})()`;

async function shoot(c, name, width) {
  const h = await c.eval('Math.min(document.documentElement.scrollHeight, 9000)');
  await c.send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile: width < 600 });
  await sleep(250);
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name + '.png'), Buffer.from(shot.data, 'base64'));
  await c.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
}

const results = [];
function record(page, name, ok, detail) { results.push({ page, name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${page}] ${name}${detail ? '  — ' + detail : ''}`); }

async function matrix(c, page, query, variant = '') {
  for (const theme of THEMES) for (const w of VIEWPORTS) {
    c.errors = [];
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 });
    await navigate(c, PAGES[page] + query(theme));
    const g = await c.eval(GEOMETRY);
    const name = `${page}${variant}-${w}-${theme}`;
    await shoot(c, name, w);
    const brand = await c.eval(`(() => ({ title: document.title, logo: (document.querySelector('.brand b') || document.querySelector('.logo')).innerText.trim(), modes: [...document.querySelectorAll('[data-mode] .mono, .cmdname')].map(el => el.textContent.trim()), legacy: document.body.innerText.split(/[^A-Za-z_]+/).some(word => ['Tri', 'triA', 'triB', 'triAB', 'TRI_FINAL_ACCEPTED'].includes(word)) }))()`);
    const brandOK = brand.title.startsWith('GAVEX') && brand.logo.startsWith('GAVEX') && JSON.stringify(brand.modes) === JSON.stringify(['gavexA', 'gavexB', 'gavexAB']) && !brand.legacy;
    record(page, 'GAVEX visible branding' + variant + ' @' + w + 'px × ' + theme, brandOK, JSON.stringify(brand));
    const ok = brandOK && g.overflow <= 1 && g.offenders.length === 0 && g.sideBars.length === 0 && g.cardOverflow.length === 0 && c.errors.length === 0 && g.theme === theme;
    record(page, `render${variant} ${w}px × ${theme}`, ok, `overflow=${g.overflow}px offenders=${g.offenders.length} sideBars=${g.sideBars.length} cardOverflow=${g.cardOverflow.length} errors=${c.errors.length}` +
      (g.offenders.length ? ' ' + g.offenders.join(' | ') : '') + (g.sideBars.length ? ' ' + g.sideBars.join(' | ') : '') + (g.cardOverflow.length ? ' ' + g.cardOverflow.join(' | ') : '') + (c.errors.length ? ' ' + c.errors.join(' | ') : ''));
  }
}

async function waitFor(c, expr, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await c.eval(expr)) return true; await sleep(200); }
  return false;
}

async function dashboardAssets(c) {
  const captures = [];
  const sourceSha256 = sha256(readFileSync(join(ROOT, 'docs/dashboard/index.html')));
  for (const theme of THEMES) {
    c.errors = [];
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate(c, PAGES.dashboard + '?mode=gavexAB&replay=0&theme=' + theme);
    const brand = await c.eval(`({title: document.title, logo: document.querySelector('.brand b').textContent, modes: [...document.querySelectorAll('[data-mode] .mono')].map(el => el.textContent), terminal: document.querySelector('#livePill').textContent.trim(), mode: window.__gavex.state.mode})`);
    const g = await c.eval(GEOMETRY);
    const ok = brand.title.startsWith('GAVEX') && brand.logo === 'GAVEX' && brand.mode === 'gavexAB' && JSON.stringify(brand.modes) === JSON.stringify(['gavexA', 'gavexB', 'gavexAB']) && brand.terminal === 'GAVEX_FINAL_ACCEPTED' && g.theme === theme && g.overflow === 0 && !g.offenders.length && !g.cardOverflow.length && !g.sideBars.length && !c.errors.length;
    record('assets', 'fresh Chrome dashboard-' + theme + '.png with GAVEX branding', ok, JSON.stringify({ ...brand, geometry: g, errors: c.errors }));
    if (!ok) throw new Error('Refusing to publish an invalid ' + theme + ' dashboard capture');
    const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const bytes = Buffer.from(shot.data, 'base64');
    const path = 'docs/assets/dashboard-' + theme + '.png';
    writeFileSync(join(ROOT, path), bytes);
    captures.push({ theme, path, width: 1440, height: 1000, sha256: sha256(bytes), ...brand });
  }
  writeFileSync(join(OUT, 'dashboard-captures.json'), JSON.stringify({ brand: 'GAVEX', at: new Date().toISOString(), browser: CHROME, source: 'ui/dashboard/index.html', sourceSha256, captures }, null, 2) + '\n');
}

async function dashboardInteractions(c) {
  c.errors = [];
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(c, PAGES.dashboard + '?replay=0&theme=dark');

  const kpiB = await c.eval(`(document.querySelector('[data-mode=gavexB]').click(), new Promise(r => setTimeout(() => r([...document.querySelectorAll('.kpi .val b')].map(b => b.textContent)), 700)))`);
  record('dashboard', 'gavexB KPI = 6/14/6/42/49.8', JSON.stringify(kpiB) === JSON.stringify(['6', '14', '6', '42', '49.8']), JSON.stringify(kpiB));
  const closed = await c.eval(`document.querySelector('#kn3').textContent`);
  record('dashboard', '42 probes 100% closed', /42\/42/.test(closed) && /100%/.test(closed), closed.trim());
  const lanesB = await c.eval(`[!document.querySelector('#auditPanel').hidden, !document.querySelector('#lanesSection').hidden]`);
  record('dashboard', 'gavexB hides audit, shows lanes', lanesB[0] === false && lanesB[1] === true, JSON.stringify(lanesB));

  const kpiA = await c.eval(`(document.querySelector('[data-mode=gavexA]').click(), new Promise(r => setTimeout(() => r({k:[...document.querySelectorAll('.kpi .val b')].map(b => b.textContent), audit: !document.querySelector('#auditPanel').hidden, lanes: !document.querySelector('#lanesSection').hidden}), 700)))`);
  record('dashboard', 'gavexA switches KPI + panels', kpiA.k.join(',') === '3,2,1,18,21.4' && kpiA.audit && !kpiA.lanes, JSON.stringify(kpiA));

  await c.eval(`document.querySelector('[data-mode=gavexAB]').click()`); await sleep(600);
  const ab = await c.eval(`({rows: document.querySelectorAll('#plist li').length, stamps: [...document.querySelectorAll('#plist .stamp')].map(s => s.textContent), audit: !document.querySelector('#auditPanel').hidden, lanes: !document.querySelector('#lanesSection').hidden})`);
  record('dashboard', 'gavexAB progress card Step0..6 + Final + gavexA', ab.rows === 9 && ab.stamps.includes('STEP_1_VERIFIED_PASS ✅') && ab.stamps.includes('GAVEX_FINAL_ACCEPTED ✅') && ab.audit && ab.lanes, JSON.stringify(ab));

  const workers = await c.eval(`({w: document.querySelectorAll('.wcard').length, v: document.querySelectorAll('.vcard').length, probes: document.querySelectorAll('.probe').length, scope: document.querySelectorAll('.scope li').length, models: document.querySelectorAll('.wcard .pill.mono').length, rework: document.querySelectorAll('.rework').length})`);
  record('dashboard', 'swimlanes: 14 workers / 6 verifiers / 42 probes', workers.w === 14 && workers.v === 6 && workers.probes === 42 && workers.models === 14 && workers.rework === 6, JSON.stringify(workers));

  const filt = await c.eval(`(document.querySelector('[data-filter=s2]').click(), [...document.querySelectorAll('.lane')].filter(l => !l.hidden).map(l => l.id))`);
  record('dashboard', 'step filter Step 3 → only lane2 visible', JSON.stringify(filt) === '["lane2"]', JSON.stringify(filt));
  await c.eval(`document.querySelector('[data-filter=all]').click()`);

  const col = await c.eval(`(document.querySelector('[data-toggle="1"]').click(), new Promise(r => setTimeout(() => r({cls: document.querySelector('#lane1').className, aria: document.querySelector('[data-toggle="1"]').getAttribute('aria-expanded'), h: document.querySelector('#lb1').getBoundingClientRect().height}), 500)))`);
  record('dashboard', 'collapse Step 2', /collapsed/.test(col.cls) && col.aria === 'false' && col.h < 2, JSON.stringify(col));
  await c.eval(`document.querySelector('#expandAll').click()`);

  const before = await c.eval(`window.__gavex.state.events.length`);
  await c.eval(`document.querySelector('[data-speed="4"]').click(); document.querySelector('[data-sim="0"]').click()`);
  const sawReject = await waitFor(c, `window.__gavex.state.steps[0].status === 'rework' && !!document.querySelector('#lane0 .probe.is-fail') && document.querySelector('#wc0B').className.includes('is-rework')`, 8000);
  record('dashboard', 'simulate Step 1: REJECTED → Worker 1-B rework (amber)', sawReject, '');
  const simDone = await waitFor(c, `window.__gavex.state.sim === null && window.__gavex.state.steps[0].status === 'pass'`, 15000);
  const simEv = await c.eval(`window.__gavex.state.events.slice(${before}).map(e => e.type).join(',')`);
  record('dashboard', 'simulate Step 1: recheck → STEP_1_VERIFIED_PASS + timeline events', simDone && /REJECT/.test(simEv) && /PASS/.test(simEv), simEv);

  await c.eval(`document.querySelector('#replayBtn').click()`);
  const midSpin = await waitFor(c, `document.querySelectorAll('.spin').length > 0`, 5000);
  record('dashboard', 'replay shows spinning in-progress icons', midSpin, '');
  const replayDone = await waitFor(c, `!window.__gavex.state.playing && window.__gavex.state.final === 'pass'`, 60000);
  const tl = await c.eval(`({n: document.querySelectorAll('#tl .ev').length, steer: !!document.querySelector('#tl .t-STEER'), patrol: !!document.querySelector('#tl .t-PATROL')})`);
  record('dashboard', 'full replay reaches GAVEX_FINAL_ACCEPTED with watchdog patrol/steer', replayDone && tl.n > 50 && tl.steer && tl.patrol, JSON.stringify(tl));

  const th = await c.eval(`(document.querySelector('#themeBtn').click(), document.documentElement.getAttribute('data-theme'))`);
  record('dashboard', 'theme toggle dark → light', th === 'light', th);
  record('dashboard', 'no runtime errors during interactions', c.errors.length === 0, c.errors.join(' | '));
}

async function docsInteractions(c) {
  c.errors = [];
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(c, PAGES.docs + '?theme=dark&lang=zh');
  const zh = await c.eval(`document.documentElement.lang`);
  const zhSystem = await c.eval(`({pillars: [...document.querySelectorAll('.pillar p')].map(el => el.innerText), philosophy: document.querySelector('#philosophy').innerText, title: document.title})`);
  record('docs', 'Chinese G-A-V-EX pillars + Gavel philosophy + escalation policy', zhSystem.pillars.length === 4 && zhSystem.pillars.every(text => /[\u4e00-\u9fff]/.test(text)) && zhSystem.philosophy.includes('Gavel 法槌 + Execution 执行') && zhSystem.philosophy.includes('GAVEX_ESCALATED') && zhSystem.title.startsWith('GAVEX'), JSON.stringify(zhSystem));
  const en = await c.eval(`(document.querySelector('#langBtn').click(), {lang: document.documentElement.lang, hero: document.querySelector('h1').innerText})`);
  record('docs', 'language toggle zh → en', zh.startsWith('zh') && en.lang === 'en' && /[A-Za-z]{4,}/.test(en.hero) && !/[\u4e00-\u9fa5]/.test(en.hero), JSON.stringify(en));
  const enSystem = await c.eval(`({pillars: [...document.querySelectorAll('.pillar h3')].map(el => el.innerText), text: document.querySelector('#pillars').innerText, title: document.title})`);
  record('docs', 'English G-A-V-EX pillars + Gavel philosophy + terminal tokens', JSON.stringify(enSystem.pillars) === JSON.stringify(['Guarded Write-Scopes', 'Adversarial Cross-Audit', 'Verifier Veto Gates', 'Execution Pipeline']) && enSystem.text.includes('Gavel + Execution') && enSystem.text.includes('GAVEX_FINAL_ACCEPTED') && enSystem.text.includes('GAVEX_ESCALATED') && !/[\u4e00-\u9fff]/.test(enSystem.text) && enSystem.title.includes('Guarded Audit & Verifier-gated Execution'), JSON.stringify(enSystem));
  const back = await c.eval(`(document.querySelector('#langBtn').click(), {lang: document.documentElement.lang, philosophy: document.querySelector('#philosophy').innerText})`);
  record('docs', 'language roundtrip en → zh preserves philosophy', back.lang === 'zh-CN' && back.philosophy.includes('Gavel 法槌 + Execution 执行'), back.lang);
  await c.eval(`document.querySelector('#langBtn').click()`);
  const th = await c.eval(`(document.querySelector('#themeBtn').click(), document.documentElement.getAttribute('data-theme'))`);
  record('docs', 'theme toggle dark → light', th === 'light', th);
  const tabs = await c.eval(`[...document.querySelectorAll('[data-tab]')].map(b => { b.click(); const vis = [...document.querySelectorAll('.tab-panel')].filter(p => p.getBoundingClientRect().height > 0); return vis.length === 1 ? vis[0].id : 'visible=' + vis.length; })`);
  record('docs', 'install tabs (6 platforms, exactly one panel rendered)', tabs.length === 6 && new Set(tabs).size === 6 && tabs.every((t) => t.startsWith('panel-')), JSON.stringify(tabs));
  const installs = await c.eval(`[...document.querySelectorAll('.tab-panel')].map(panel => ({ id: panel.id, code: [...panel.querySelectorAll('pre')].map(pre => pre.textContent).join(' '), usage: panel.querySelector('pre:last-of-type')?.textContent }))`);
  record('docs', 'all six install panels use gavex paths and invocation modes', installs.length === 6 && installs.every(panel => panel.code.includes('skills') && panel.code.includes('/gavex') && panel.code.includes('~/Developer/GAVEX') && /gavex(?:AB|A|B)/.test(panel.code) && !/skills\/tri|Developer\/Tri|\btri(?:A|B|AB)\b/.test(panel.code)), installs.map(panel => panel.id).join(', '));
  const pre = await c.eval(`[...document.querySelectorAll('.tab-panel:not([hidden]) pre')].map(p => getComputedStyle(p).overflowX + ':' + (p.getBoundingClientRect().right <= p.closest('.tab-panel').getBoundingClientRect().right + 1)).join(',')`);
  record('docs', 'install code blocks scroll inside panel (not clipped)', !/false/.test(pre) && /auto/.test(pre), pre);
  await c.eval(`document.querySelector('#sbPlay').click()`);
  const sb = await waitFor(c, `document.querySelector('#sandbox').dataset.phase === 'done'`, 40000);
  const sbLog = await c.eval(`document.querySelectorAll('#sbLog li').length`);
  record('docs', 'workflow sandbox plays to completion (split → parallel → reject → unlock)', sb && sbLog >= 8, 'log=' + sbLog);
  for (const w of [1440, 1024, 390]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 });
    await sleep(300);
    const g = await c.eval(GEOMETRY);
    record('docs', `sandbox final-state geometry @${w}px`, g.overflow <= 1 && g.cardOverflow.length === 0 && g.sideBars.length === 0, `overflow=${g.overflow}px cardOverflow=${g.cardOverflow.length} ${g.cardOverflow.join(' | ')}`);
  }
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const id of ['pillars', 'philosophy', 'why', 'sandbox-section', 'gates', 'modes', 'install', 'dashboard']) {
    await c.eval(`(document.documentElement.style.scrollBehavior='auto', document.getElementById('${id}').scrollIntoView({block:'start'}), window.scrollBy(0,-60))`);
    await sleep(id === 'dashboard' ? 1500 : 300);
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, `docs-section-${id}.png`), Buffer.from(shot.data, 'base64'));
  }
  const iframe = await c.eval(`!!document.querySelector('iframe[src*="dashboard"]')`);
  record('docs', 'embedded dashboard preview iframe', iframe, '');
  record('docs', 'no runtime errors during interactions', c.errors.length === 0, c.errors.join(' | '));
}

async function mermaidCheck(c) {
  const lib = join(OUT, 'mermaid.min.js');
  if (!existsSync(lib)) {
    try {
      const r = await fetch('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      writeFileSync(lib, Buffer.from(await r.arrayBuffer()));
    } catch (e) { record('readme', 'mermaid dependency available (required, never silently skipped)', false, e.message); return; }
  }
  const blocks = [...readFileSync(join(ROOT, 'README.md'), 'utf8').matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
  record('readme', 'architecture diagram blocks present', blocks.length >= 1, 'blocks=' + blocks.length);
  const page = join(OUT, 'mermaid.html');
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><body><script src="mermaid.min.js"></script><script>
    window.__blocks = ${JSON.stringify(blocks)};
    window.__run = async () => { mermaid.initialize({ startOnLoad: false, theme: 'dark' }); const out = [];
      for (let i = 0; i < __blocks.length; i++) {
        try { const r = await mermaid.render('m' + i, __blocks[i]); const d = document.createElement('div'); d.innerHTML = r.svg; document.body.appendChild(d); out.push({ i, ok: true, nodes: d.querySelectorAll('.node').length }); }
        catch (e) { out.push({ i, ok: false, err: String(e.message || e).slice(0, 300) }); }
      } return out; };
  </script>`);
  c.errors = [];
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(c, pathToFileURL(page).href);
  const out = await c.eval('window.__run()');
  out.forEach((r) => record('readme', `mermaid diagram #${r.i + 1} renders`, r.ok && r.nodes > 3, r.ok ? `${r.nodes} nodes` : r.err));
  const shot = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(SHOTS, 'readme-mermaid.png'), Buffer.from(shot.data, 'base64'));
}

try {
  await waitForChrome();
  const c = await openPage();
  if (which === 'all' || which === 'readme') await mermaidCheck(c);
  if (which === 'all' || which === 'dashboard') {
    await matrix(c, 'dashboard', (t) => `?replay=0&theme=${t}`);
    await dashboardAssets(c);
    await dashboardInteractions(c);
  }
  if (which === 'all' || which === 'published') await matrix(c, 'published', (t) => `?mode=gavexAB&replay=0&theme=${t}`);
  if (which === 'all' || which === 'docs') {
    await matrix(c, 'docs', (t) => `?theme=${t}&static=1&lang=zh`);
    await matrix(c, 'docs', (t) => `?theme=${t}&static=1&lang=en`, '-en');
    await docsInteractions(c);
  }
  c.ws.close();
} catch (e) {
  record('runner', 'exception', false, e.stack || String(e));
} finally {
  chrome.kill('SIGKILL');
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, `render-report-${which}.json`), JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed · screenshots → .verify/screens`);
process.exit(failed.length ? 1 : 0);
