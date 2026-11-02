#!/usr/bin/env node
// Static validation for GAVEX deliverables: presence, HTML structure, inline JS syntax, CSS red lines, Markdown integrity.
// Usage: node scripts/validate.mjs
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (file, name, ok, detail = '') => {
  results.push({ file, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file} · ${name}${detail ? '  — ' + detail : ''}`);
};
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const HTML = ['docs/index.html', 'docs/dashboard/index.html'];
const MD = ['SKILL.md', 'README.md', 'ARCHITECTURE.md'];
const REQUIRED = [...HTML, ...MD, 'docs/assets/dashboard-dark.png', 'docs/assets/dashboard-light.png', 'scripts/render-check.mjs'];

// ---------- presence ----------
for (const f of REQUIRED) {
  const p = join(ROOT, f);
  const min = f.endsWith('.sh') ? 200 : 1024;
  const ok = existsSync(p) && statSync(p).size > min;
  check(f, `exists & > ${min} B`, ok, ok ? `${(statSync(p).size / 1024).toFixed(1)} KB` : 'missing or too small');
}
check('docs/.nojekyll', 'exists', existsSync(join(ROOT, 'docs/.nojekyll')));

// ---------- side accent bar red line ----------
const LEGACY = /\b(?:Tri|tri|triA|triB|triAB)\b|TRI_(?:FINAL_ACCEPTED|ESCALATED)|__tri\b/;
const VOCABULARY = ['GAVEX', 'gavexA', 'gavexB', 'gavexAB', 'GAVEX_FINAL_ACCEPTED', 'GAVEX_ESCALATED', '.gavex/ledger.md'];
const PILLARS = ['Guarded Write-Scopes', 'Adversarial Cross-Audit', 'Verifier Veto Gates', 'Execution Pipeline'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SIDE_BAR = /border-(left|right|inline-start|inline-end)\b|border-inline\s*:|box-shadow\s*:[^;]*inset\s+-?[1-9]/gi;

// Guard self-tests: known forbidden fixtures must fail; uniform perimeter borders stay valid.
const sidePattern = new RegExp(SIDE_BAR.source, 'i');
check('validator', 'detect all one-sided accent fixtures', ['border-left: 3px solid red', 'border-right: 4px solid red', 'border-inline-start: 3px solid red', 'border-inline-end: 3px solid red', 'border-inline: 3px solid red', 'box-shadow: inset 3px 0 red'].every((css) => sidePattern.test(css)));
check('validator', 'allow uniform 1px perimeter fixture', !sidePattern.test('border: 1px solid var(--line); box-shadow: none;'));
check('validator', 'detect legacy brand/mode/token fixtures', ['Tri', 'triA', 'triB', 'triAB', 'TRI_FINAL_ACCEPTED', 'TRI_ESCALATED', '.tri/ledger.md', 'window.__tri'].every((text) => LEGACY.test(text)));
check('validator', 'accept GAVEX protocol fixtures', VOCABULARY.every((text) => !LEGACY.test(text)));

// ---------- HTML ----------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function tagBalance(html) {
  const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '<$1></$1>');
  const stack = [], errors = [];
  const re = /<\/?([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[1].toLowerCase(), closing = m[0][1] === '/', selfClose = m[2] === '/';
    if (tag === '!doctype' || VOID.has(tag)) continue;
    if (!closing) { if (!selfClose) stack.push(tag); continue; }
    const top = stack.pop();
    if (top !== tag) { errors.push(`expected </${top}> got </${tag}> near offset ${m.index}`); if (top) stack.push(top); if (errors.length > 4) break; }
  }
  if (stack.length) errors.push('unclosed: ' + stack.slice(-5).join(','));
  return errors;
}
for (const f of HTML) {
  if (!existsSync(join(ROOT, f))) continue;
  const html = read(f);
  check(f, 'GAVEX title + expanded name', /<title>GAVEX[^<]*Guarded Audit &amp; Verifier-gated Execution/.test(html));
  const missing = VOCABULARY.filter((token) => !html.includes(token));
  check(f, 'GAVEX vocabulary (modes, terminal tokens, ledger)', missing.length === 0, missing.join(', '));
  check(f, 'no legacy branding or identifiers', !LEGACY.test(html));
  const staticHtml = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const local = [...staticHtml.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]).filter((url) => !/^(?:[a-z]+:|\/\/)/i.test(url));
  const broken = local.filter((url) => !existsSync(join(ROOT, dirname(f), decodeURIComponent(url.split(/[?#]/)[0]))));
  check(f, 'local HTML links and iframe resolve', broken.length === 0, broken.length ? broken.join(', ') : local.length + ' links');
  if (f.includes('dashboard/')) {
    check(f, 'mode buttons match GAVEX protocol', ['gavexA', 'gavexB', 'gavexAB'].every((mode) => html.includes('data-mode="' + mode + '"')) && html.includes('window.__gavex'));
  } else {
    check(f, 'G-A-V-EX pillar decomposition', PILLARS.every((pillar) => html.includes(pillar)) && (html.match(/data-pillar="/g) || []).length === 4);
    const cards = [...html.matchAll(/<article class="pillar"[\s\S]*?<\/article>/g)].map((m) => m[0]);
    check(f, 'all four pillars have Chinese + English prose', cards.length === 4 && cards.every((card) => /class="zh"/.test(card) && /class="en"/.test(card)));
    check(f, 'bilingual Gavel + Execution philosophy', html.includes('Gavel 法槌 + Execution 执行') && html.includes('Gavel + Execution'));
    check(f, 'GAVEX install paths', html.includes('~/Developer/GAVEX') && html.includes('skills/gavex/SKILL.md'));
  }
  check(f, 'doctype + lang + viewport', /^<!doctype html>/i.test(html) && /<html[^>]+lang=/.test(html) && /name="viewport"/.test(html));
  const bal = tagBalance(html);
  check(f, 'tag balance', bal.length === 0, bal.join(' | '));
  const ids = [...html.replace(/<script[\s\S]*?<\/script>/gi, '').matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  check(f, 'unique static ids', dup.length === 0, dup.length ? 'dup: ' + [...new Set(dup)].join(',') : `${ids.length} ids`);
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((x) => x[1]);
  scripts.forEach((code, i) => {
    try { new vm.Script(code, { filename: `${f}#script${i}` }); check(f, `inline script #${i} syntax`, true, `${code.length} chars`); }
    catch (e) { check(f, `inline script #${i} syntax`, false, e.message); }
  });
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((x) => x[1]).join('\n');
  const open = (styles.match(/\{/g) || []).length, close = (styles.match(/\}/g) || []).length;
  check(f, 'CSS brace balance', open === close, `{ ${open} / } ${close}`);
  const hits = [...html.matchAll(SIDE_BAR)].map((x) => x[0]);
  check(f, 'no one-sided accent bars (border-left/right/inline, inset side shadow)', hits.length === 0, hits.length ? hits.join(', ') : '0 hits');
  check(f, 'prefers-reduced-motion fallback', /prefers-reduced-motion/.test(html));
  check(f, 'dark + light themes', /data-theme="dark"\]/.test(html) && /data-theme="light"\]/.test(html));
}

// ---------- Markdown ----------
for (const f of MD) {
  if (!existsSync(join(ROOT, f))) continue;
  const md = read(f);
  // The canonical Skill explicitly documents migration-only trigger aliases; they are not UI branding.
  const branded = f === 'SKILL.md' ? md.replace('Backward-compatible trigger aliases: triA / triB / triAB.', '') : md;
  check(f, 'GAVEX primary brand; no undocumented legacy identifiers', branded.includes('GAVEX') && !LEGACY.test(branded));
  const fences = md.split('\n').filter((l) => /^\s*```/.test(l)).length;
  check(f, 'fenced code blocks balanced', fences % 2 === 0, `${fences} fence lines`);
  const prose = md.replace(/```[\s\S]*?```/g, '');
  const links = [...prose.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)].map((x) => x[1]).filter((u) => !/^(https?:|mailto:|#)/.test(u));
  const dead = links.filter((u) => !existsSync(join(ROOT, dirname(f), decodeURIComponent(u.split('#')[0]))));
  check(f, 'relative links resolve', dead.length === 0, dead.length ? dead.join(', ') : `${links.length} links`);
  const sideBarLine = new RegExp(SIDE_BAR.source, 'i');
  const bad = md.split('\n').filter((l) => sideBarLine.test(l) && !/(严禁|禁止|❌|Never|0 hits|为 0|次数为 0)/.test(l));
  check(f, 'side accent bar only mentioned as a prohibition', bad.length === 0, bad.length ? bad.join(' | ').slice(0, 200) : '');
}
const skill = read('SKILL.md');
const fm = skill.match(/^---\n([\s\S]*?)\n---\n/);
check('SKILL.md', 'YAML frontmatter with name + description', !!fm && /^name:\s*gavex\s*$/m.test(fm[1]) && /^description:/m.test(fm[1]));
const SKILL_TOKENS = ['STEP_K_VERIFIED_PASS', 'STEP_K_REJECTED', 'UNCONDITIONAL_CONSENSUS', 'GAVEX_FINAL_ACCEPTED', 'GAVEX_ESCALATED', 'gavexA', 'gavexB', 'gavexAB', 'Write-Scope', 'Verifier K', 'Worker K-A', 'G1', 'G2', 'G3', 'G4'];
const missingSkill = SKILL_TOKENS.filter((token) => !skill.includes(token));
check('SKILL.md', 'protocol vocabulary complete (tokens, modes, roles, gates)', missingSkill.length === 0, missingSkill.join(', '));
const missingPlatforms = ['OpenClaw', 'Claude Code', 'OpenCode', 'Pi', 'DSH', 'Hermes'].filter((platform) => !skill.includes(platform));
check('SKILL.md', 'all six supported platforms', missingPlatforms.length === 0, missingPlatforms.join(', '));
const readme = read('README.md');
check('README.md', 'mermaid architecture diagrams', (readme.match(/```mermaid/g) || []).length >= 1, `${(readme.match(/```mermaid/g) || []).length} diagrams`);
check('README.md', 'comparison table + install + gavexA/gavexB/gavexAB + Write-Scope + Dashboard sections',
  /本质对比/.test(readme) && /快速安装/.test(readme) && /gavexA/.test(readme) && /gavexB/.test(readme) && /gavexAB/.test(readme) && /Write-Scope 防踩踏/.test(readme) && /Dashboard 预览/.test(readme));
for (const theme of ['dark', 'light']) {
  const file = 'docs/assets/dashboard-' + theme + '.png';
  const bytes = readFileSync(join(ROOT, file));
  check(file, 'real PNG at 1440 × 1000', bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.readUInt32BE(16) === 1440 && bytes.readUInt32BE(20) === 1000);
}

const failed = results.filter((r) => !r.ok);
mkdirSync(join(ROOT, '.verify'), { recursive: true });
writeFileSync(join(ROOT, '.verify/validate-report.json'), JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} static checks passed`);
process.exit(failed.length ? 1 : 0);
