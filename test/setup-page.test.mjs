// The setup page (setup/page.html) is one inline document served by setup/server.mjs.
// These tests pin the wiring between the two, the copy Or approved for the tree, and
// the rules the page lives by (no outside loads, reduced motion, both themes).
//   node --test test/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(ROOT, 'setup', 'page.html'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'setup', 'server.mjs'), 'utf8');
const skills = JSON.parse(fs.readFileSync(path.join(ROOT, 'setup', 'skills-catalog.json'), 'utf8')).skills;
const tools = JSON.parse(fs.readFileSync(path.join(ROOT, 'setup', 'tools-catalog.json'), 'utf8')).tools;

test('wiring: every API route the page calls exists on the server, and every old route is still called', () => {
  const called = new Set([...page.matchAll(/'(\/api\/[a-z-]+(?:\/[a-z]+)?)(?:\?[^']*)?'/g)].map((m) => m[1]));
  const routes = new Set([...server.matchAll(/url\.pathname === '([^']+)'/g)].map((m) => m[1]));
  for (const r of called) assert.ok(routes.has(r), `page calls ${r} but the server has no such route`);
  // The routes the page used before the tree (git-init was never called by the page).
  const used = ['/api/state', '/api/preflight', '/api/config', '/api/heartbeat', '/api/secret', '/api/telegram-install', '/api/telegram-status',
    '/api/telegram-token', '/api/skills', '/api/setup-all', '/api/install-tool', '/api/tools', '/api/tools/install', '/api/tools/connect'];
  for (const r of used) assert.ok(called.has(r), `page no longer calls ${r}`);
});

test('tree: skills and tools install through the existing endpoints with the documented bodies', () => {
  assert.match(page, /post\('\/api\/skills', \{ id: it\.id, enabled: true \}\)/, 'a skill is switched on with POST /api/skills {id, enabled}');
  assert.match(page, /post\('\/api\/skills', \{ id: it\.id, enabled: false \}\)/, 'an installed skill can be switched off');
  assert.match(page, /isMcp \? '\/api\/tools\/connect' : '\/api\/tools\/install', secret \? \{ id: it\.id, secret \} : \{ id: it\.id \}/, 'an mcp tool is connected, the rest installed, by id (plus the key for a tool that asks for one)');
});

test('tree: Or\'s copy is exact, and exactly one control reads "להתקין הכול"', () => {
  assert.ok(page.includes("helper: 'בחרו נושא כדי לראות מה יש בו ולסמן מה להתקין.'"), 'helper line under the tree');
  assert.equal(page.split('להתקין הכול').length - 1, 1, 'the install-everything label appears once');
  assert.ok(page.includes("installAll: 'להתקין הכול'"));
  assert.ok(!page.includes('להתקין את הכול'), 'no near-duplicate label');
});

test('tree: six topics + Animation twig; every catalog category lands on a topic', () => {
  for (const k of ['core', 'research', 'notes', 'design', 'build', 'media']) assert.match(page, new RegExp(`key: '${k}'`));
  const mapped = new Set([...page.match(/const TOPIC_DEF = \[([\s\S]*?)\n\];/)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]));
  const cats = new Set([...skills.map((s) => s.category), ...tools.map((t) => t.category)].filter((c) => c && c !== 'workspace'));
  for (const c of cats) assert.ok(mapped.has(c), `catalog category "${c}" has no topic on the tree (it would fall into Essentials by accident)`);
  assert.match(page, /it\.sub === 'animation'/, 'Animation is read from the catalog subgroup');
});

test('page: loads nothing from outside (the CSP forbids it), no demo CDN; fonts are self-hosted with a named Hebrew fallback', () => {
  assert.ok(!/fonts\.(googleapis|gstatic)|<link[^>]+href=["']https?:|<script[^>]+src=|@import|cdn\./i.test(page));
  assert.ok(!/(src|href)=["']https?:\/\/[^"']+\.(png|jpe?g|webp|woff2?|css|js)/i.test(page));
  assert.match(server, /default-src 'none'/);
  assert.match(server, /font-src 'self'/);
  // Fraunces + Figtree come from this server's /assets/fonts/ route; every file the page names is one the server serves.
  const named = [...page.matchAll(/\/assets\/fonts\/' \+ file|\/assets\/fonts\/([a-z0-9-]+)\.woff2/g)];
  assert.ok(named.length >= 1, 'the page declares @font-face for its self-hosted faces');
  for (const f of ['fraunces-latin-full', 'figtree-latin']) {
    assert.ok(page.includes("'" + f + "'"), `${f} is declared`);
    assert.ok(server.includes(`['${f}',`), `${f} is routed by the server`);
    assert.ok(fs.existsSync(path.join(ROOT, 'setup', 'assets', 'fonts', f + '.woff2')));
  }
  // Neither face covers Hebrew: it falls back to named system faces, then the system UI font.
  assert.match(page, /--display:"Fraunces"[^;]*"Arial Hebrew","Noto Sans Hebrew"/);
  assert.match(page, /--body:"Figtree"[^;]*"Arial Hebrew","Noto Sans Hebrew",system-ui/);
});

test('page: the product is Shufi only. No "Jarvis" anywhere in the page, the served page, or the server banner', async () => {
  assert.ok(!page.includes('Jarvis'), 'setup/page.html must not contain "Jarvis" (title, text, comments, scripts)');
  assert.ok(!/<title>[^<]*Jarvis/i.test(page));
  // Internal names that must keep working are fine: x-jarvis-token and __JARVIS_TOKEN__ are not the word "Jarvis".
  const { child, base, token } = await startServer();
  try {
    const html = await (await fetch(`${base}/?t=${token}`)).text();
    assert.ok(!html.includes('Jarvis'), 'the served page must not contain "Jarvis"');
    assert.match(html, /<title>Shufi/);
  } finally { child.kill(); }
});

test('page: no control without a backend (no mock chat, no Start over, no permission card that does nothing)', () => {
  for (const dead of ['chat-open', 'Chat with me', 'Start over', 'Ask Shufi', 'Grant']) assert.ok(!page.includes(dead), `page must not ship "${dead}"`);
  // the step-0 card asks for the one real first action: look at this computer (a live preflight)
  assert.match(page, /lookAt: 'Look at this computer'/);
  assert.match(page, /async function doScan\(\)[\s\S]{0,400}\/api\/preflight\?refresh=1/);
});

test('page: the owl is the felt photo set served from setup/assets, never a drawn stand-in', () => {
  const poses = [...page.match(/const POSES = \[([^\]]*)\]/)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(poses.length >= 8);
  for (const p of poses) assert.ok(fs.existsSync(path.join(ROOT, 'setup', 'assets', 'shufi', p + '.webp')), `${p}.webp exists`);
  assert.ok(!page.includes('data:image/jpeg;base64'), 'no inline base64 owl any more');
});

test('page: both themes, reduced motion, visible focus, Hebrew right to left', () => {
  assert.match(page, /:root\[data-theme="light"\]/);
  assert.match(page, /:root,:root\[data-theme="dark"\]/);
  assert.match(page, /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important;transition:none!important\}\}/, 'reduced motion stops growth, sway, twinkle and transitions');
  assert.match(page, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.bg \.draw\{stroke-dashoffset:0\}/, 'the tree shows fully grown');
  assert.match(page, /:focus-visible\{outline:3px solid/);
  assert.match(page, /\.btag:focus-visible/);
  assert.match(page, /d\.dir = l === 'he' \? 'rtl' : 'ltr'/);
  assert.match(page, /e\.key === 'Escape'[\s\S]{0,260}closeTopic\(true\)/, 'Escape closes the topic panel');
  // Hebrew flips the page chrome and the columns; the tree scene is drawn left to right and stays that way.
  assert.match(page, /#scene,#items,#back\{direction:ltr\}/);
  assert.match(page, /:root\[dir="rtl"\] #rightcol/);
  assert.match(page, /@media \(max-width:700px\)/);
});

// Real server: the page, its CSP, and the owl files behind the token.
function startServer() {
  return new Promise((resolve, reject) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shufi-page-'));
    const child = spawn(process.execPath, [path.join(ROOT, 'setup', 'server.mjs')], {
      env: { PATH: process.env.PATH, HOME: home, JARVIS_HUB: path.join(home, 'hub'), JARVIS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('server did not start')); }, 15000);
    child.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]+)/);
      if (m) { clearTimeout(timer); resolve({ child, base: `http://127.0.0.1:${m[1]}`, token: m[2] }); }
    });
  });
}

test('server: serves the page with its CSP, the owl poses behind the token, and the catalogs', async () => {
  const { child, base, token } = await startServer();
  try {
    const home = await fetch(`${base}/?t=${token}`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-security-policy') || '', /connect-src 'self'/);
    const html = await home.text();
    assert.ok(html.includes('להתקין הכול') && html.includes('בחרו נושא כדי לראות מה יש בו ולסמן מה להתקין.'));
    const pose = await fetch(`${base}/assets/shufi/idle.webp?t=${token}`);
    assert.equal(pose.status, 200);
    assert.equal(pose.headers.get('content-type'), 'image/webp');
    assert.equal((await fetch(`${base}/assets/shufi/idle.webp`)).status, 403, 'no token, no owl');
    assert.equal((await fetch(`${base}/assets/shufi/..%2Fserver.webp?t=${token}`)).status, 404, 'the asset route is an allowlist, not a path join');
    const api = (p) => fetch(`${base}${p}`, { headers: { 'x-jarvis-token': token } }).then((r) => r.json());
    const sk = await api('/api/skills');
    const tl = await api('/api/tools');
    assert.equal(sk.skills.length, skills.length);
    assert.equal(tl.tools.length, tools.length);
  } finally { child.kill(); }
});

test('server: fonts are served from an allowlist behind the token, with the CSP allowing font-src self', async () => {
  const { child, base, token } = await startServer();
  try {
    const home = await fetch(`${base}/?t=${token}`);
    assert.match(home.headers.get('content-security-policy') || '', /font-src 'self'/);
    for (const name of ['fraunces-latin-full', 'figtree-latin']) {
      const f = await fetch(`${base}/assets/fonts/${name}.woff2?t=${token}`);
      assert.equal(f.status, 200, name);
      assert.equal(f.headers.get('content-type'), 'font/woff2');
      const buf = Buffer.from(await f.arrayBuffer());
      assert.equal(buf.subarray(0, 4).toString(), 'wOF2', 'a real woff2 file');
      assert.equal((await fetch(`${base}/assets/fonts/${name}.woff2`)).status, 403, 'no token, no font');
    }
    assert.equal((await fetch(`${base}/assets/fonts/..%2Fserver.woff2?t=${token}`)).status, 404, 'allowlist, not a path join');
    assert.equal((await fetch(`${base}/assets/fonts/OFL-fraunces.woff2?t=${token}`)).status, 404, 'names outside the table are unknown');
    assert.equal((await fetch(`${base}/assets/fonts/fraunces-latin-full.txt?t=${token}`)).status, 404, 'only .woff2 is routed');
  } finally { child.kill(); }
});

test('fonts: the licence text ships next to the fonts (SIL OFL 1.1)', () => {
  for (const n of ['fraunces', 'figtree']) {
    const t = fs.readFileSync(path.join(ROOT, 'setup', 'assets', 'fonts', `OFL-${n}.txt`), 'utf8');
    assert.match(t, /SIL OPEN FONT LICENSE Version 1\.1/);
  }
});

test('hebrew: every string in the en table has a Hebrew twin, and no step-form string is English-only', () => {
  const src = page.slice(page.indexOf('const I18N = {'), page.indexOf('\nfunction tr('));
  const I18N = new Function(src.replace(/^const I18N = /, 'return ').replace(/;\s*$/, ''))();
  const missing = Object.keys(I18N.en).filter((k) => !(k in I18N.he));
  assert.deepEqual(missing, [], 'keys with no Hebrew: ' + missing.join(', '));
  const extra = Object.keys(I18N.he).filter((k) => !(k in I18N.en));
  assert.deepEqual(extra, [], 'Hebrew keys with no English twin: ' + extra.join(', '));
  // Every form string must be actually translated: some Hebrew letters, unless it is a bare name or label that is identical on purpose.
  const sameOk = new Set(['f_fr_claude']);   // a bare product name
  for (const k of Object.keys(I18N.en)) {
    const v = I18N.he[k];
    if (typeof v !== 'string' || !k.startsWith('f_')) continue;
    if (sameOk.has(k)) continue;
    assert.match(v, /[֐-׿]/, `${k} must contain Hebrew: ${v}`);
  }
  // The step forms are built from the table: no English sentence is hard-coded between frow() and renderStepForm().
  const forms = page.slice(page.indexOf('function tf('), page.indexOf('function renderStepForm()'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const literals = [...forms.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]);
  const allowed = new Set(['Claude Code', '/shufi-setup', '/newbot', 'ffmpeg', 'Telegram', '/done', '/telegram:access pair ', 'https://t.me/BotFather', 'ELEVENLABS_API_KEY', '/api/telegram-token', '/api/telegram-install', '/api/telegram-status', '/api/install-tool', '/api/preflight?refresh=1', '/api/skills', '/api/secret', '/api/config', '/api/tools/connect', '/api/tools/install']);
  const sentences = literals.filter((l) => /[A-Za-z]{3,}/.test(l) && /\s/.test(l.trim()) && /^[A-Z0-9]/.test(l.trim()) && !allowed.has(l));   // class names are lowercase; UI sentences are capitalised
  assert.deepEqual(sentences, [], 'hard-coded English in a step form: ' + JSON.stringify(sentences));
  assert.ok(!/stepTitle\([^)]*true\)/.test(forms), 'forms use translated step titles');
  assert.ok(!page.includes('trEn'), 'no English-only translation helper any more');
  assert.ok(!/f\.dir = 'ltr'; f\.lang = 'en'/.test(page), 'the forms are no longer an English left-to-right island');
  // commands and names inside sentences are isolated left to right
  assert.match(forms, /el\('bdi', \{ dir: 'ltr'/);
  assert.match(forms, /el\('div', \{ className: 'cmd', dir: 'ltr' \}/);
});
