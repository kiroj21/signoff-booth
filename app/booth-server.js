/*
  Sign-Off Booth: laptop server

  The laptop records (camera on a cable), the tablet is the graduate's screen (over Wi-Fi).
  - Recorder (laptop only):  http://localhost:8080/recorder
  - Tablet:                  http://<laptop address>:8080/tablet?k=<key>   (the recorder screen shows a QR for it)
  - Share page:              http://<laptop address>:8080/share/<code>     (the page on this laptop; a Google Drive page can replace it)

  Saving: each kept clip is written to CLIPS/Masters (clean) and CLIPS/Share (branded, with the graduate's
  random code in the name), checked for size, and copied to BACKUP if set. A plain log (booth-log.csv)
  records file names, sizes and times only. The live preview and the replay are kept in memory only.
  Where CLIPS and BACKUP are is chosen in the recorder's Settings (section "Where clips are saved") and kept in
  booth-settings.json under "storage": a Google Drive for desktop account and location, this laptop, or any folder,
  plus a USB stick or folder for the backup copy.

  Run:  node booth-server.js        Stop: Ctrl+C
  Options (environment, for tests only): BOOTH_CLIPS=<folder> and BOOTH_BACKUP=<folder> fix the folders and lock the
  panel choice. BOOTH_PORT=8080, BOOTH_SETTINGS=<settings file>.
*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DIR = __dirname;
const PORT = +(process.env.BOOTH_PORT || 8080);
let CLIPS = '';      /* set by applyStorage() below, and again when the panel changes the save location */
let BACKUP = '';
/* ---- branding: everything a person would change to make the booth their own lives in ../brand/brand.json ----
   Read again on every page load, so an edit shows after a browser reload (no restart). Missing keys fall back to the defaults. */
const BRAND_DIR = [path.join(DIR, '..', 'brand'), path.join(DIR, 'brand')].find(d => fs.existsSync(path.join(d, 'brand.json'))) || path.join(DIR, '..', 'brand');
const BRAND_DEFAULTS = {
  organisation: 'Your Organisation', filePrefix: 'signoff',
  event: { line1: 'Your', line2: 'Event', year: '2026' },
  tagline: 'Your tagline here',
  colors: { primary: '#24435E', primaryDark: '#162B3D', accent: '#E8590C', tint: '#E4ECF2', gold: '#C9A227', goldDark: '#876712', page: '#F5F6F7', text: '#161A1D', muted: '#505A61' },
  fonts: { preset: 'classic', serif: "Georgia,'Times New Roman',serif", sans: "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif", cssFile: '' },
  logo: { main: 'logo.png', border: 'logo-border.png', light: 'logo-light.png', colour: 'logo-colour.png', alt: 'Your logo' },
  promo: 'promo.mp4',
  text: {
    helpPerson: 'a member of staff',
    welcomeTitle: 'Leave your mark on the glass', welcomeBody: 'Sign your name. Take your clip home on your phone.',
    attractTitle: 'Leave your mark on the glass', attractSub: 'Sign your name. Take your clip home.', attractTap: 'Tap the screen to begin',
    thanksTitle: 'Thank you', thanksBody: 'Thanks for stopping by.',
    shareTitle: 'Your sign-off clip', shareLead: 'Thanks for stopping by.', shareDownload: 'Download your clip',
    shareIphone: 'On iPhone, tap Download, then open the file and choose Save Video.', shareWait: 'Please check this link again in a few minutes.'
  },
  consent: '[EDIT ME] Your consent wording goes here. Say who films, what the clip is used for, and who to tell if someone changes their mind. See README, "Consent and privacy".',
  shareBase: ''
};
function deepMerge(a, b) {
  const o = Array.isArray(a) ? a.slice() : Object.assign({}, a);
  if (!b || typeof b !== 'object') return o;
  for (const k of Object.keys(b)) {
    if (k.startsWith('_')) continue;
    if (a && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && b[k] && typeof b[k] === 'object') o[k] = deepMerge(a[k], b[k]);
    else if (b[k] !== undefined && b[k] !== null) o[k] = b[k];
  }
  return o;
}
function loadBrand() {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(path.join(BRAND_DIR, 'brand.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.warn('brand/brand.json could not be read, using the defaults:', e.message); }
  return deepMerge(BRAND_DEFAULTS, j);
}
const brandFile = name => { const f = path.join(BRAND_DIR, path.basename(String(name || ''))); return name && fs.existsSync(f) ? f : ''; };
const PREFIX = (loadBrand().filePrefix || 'signoff').toString().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'signoff';
/* clips whose branded copy is not saved yet: number and code kept here so the copy can be made later,
   for example after a crash. Kept beside the server, not in the clips folder. */
const PEND = path.join(DIR, '.booth-pending');
fs.mkdirSync(PEND, { recursive: true });
const keyFile = path.join(DIR, '.booth-key');   /* kept beside the server, not in the clips folder (which may sync to Drive) */
let KEY = '';
try { KEY = fs.readFileSync(keyFile, 'utf8').trim(); } catch (e) {}
if (!/^[0-9a-f]{6}$/.test(KEY)) { KEY = crypto.randomBytes(3).toString('hex'); fs.writeFileSync(keyFile, KEY); }

/* event settings file: booth-settings.json beside the server, or one folder up (kit layout), or BOOTH_SETTINGS.
   The recorder reads and saves its settings here so they travel with the folder. */
const SETTINGS_FILE = process.env.BOOTH_SETTINGS ||
  [path.join(DIR, 'booth-settings.json'), path.join(DIR, '..', 'booth-settings.json')].find(f => fs.existsSync(f)) ||
  path.join(DIR, 'booth-settings.json');
const RANGES = { countdown: [0, 10], maxLen: [5, 60], retakes: [0, 5], idleSec: [10, 120], shareSec: [10, 120], thanksSec: [2, 15], attractSec: [15, 600], linkHours: [1, 720], logoSize: [8, 20] };
const FLAGS = ['flipPreview', 'flipSaved', 'branded'];
/* keep only known keys with the right type and range; anything else is dropped */
function cleanRecorder(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const [k, [lo, hi]] of Object.entries(RANGES)) if (Number.isFinite(+src[k]) && src[k] !== '' && src[k] !== null) out[k] = Math.max(lo, Math.min(hi, Math.round(+src[k])));
  for (const k of FLAGS) if (typeof src[k] === 'boolean') out[k] = src[k];
  if (src.brandMode === 'after' || src.brandMode === 'live') out.brandMode = src.brandMode;
  if (['auto', 'border', 'light', 'colour'].includes(src.logoMode)) out.logoMode = src.logoMode;
  if (['br', 'bl', 'tr', 'tl'].includes(src.logoPos)) out.logoPos = src.logoPos;
  if (typeof src.shareBase === 'string') out.shareBase = src.shareBase.trim().slice(0, 500);
  if (typeof src.consent === 'string') out.consent = src.consent.slice(0, 400);
  return out;
}
function readSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function writeRecorderSettings(rec) {
  const cur = readSettings();
  cur.recorder = Object.assign({}, cur.recorder, cleanRecorder(rec));
  cur._saved = true;   /* set once the recorder has saved: until then the file only holds starting values */
  const tmp = SETTINGS_FILE + '.part';
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n'); fs.renameSync(tmp, SETTINGS_FILE);
  return cur.recorder;
}

/* next clip number: one more than the highest master already in the folder */
function nextNumber() {
  let max = 0;
  for (const f of fs.readdirSync(path.join(CLIPS, 'Masters'))) {
    const m = new RegExp('^' + PREFIX + '-(\\d+)\\.').exec(f);
    if (m) max = Math.max(max, +m[1]);
  }
  return max + 1;
}
let reserved = 0;
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
function newCode() { let s = ''; const b = crypto.randomBytes(10); for (const x of b) s += CODE_CHARS[x % CODE_CHARS.length]; return s; }


/* ---- where clips are saved: kept in booth-settings.json under "storage", chosen in the recorder's Settings ----
   account    Google account email whose Drive for desktop folder is used (empty = the first one found)
   location   "My Drive", "Shared drives/<name>", "local" (this laptop, next to the settings file) or "custom" (customPath)
   folder     folder name made inside the Drive location
   backup     "usb" (a stick named usbName), "folder" (backupFolder) or "none"                                         */
const HOME = os.homedir();
const DEFAULT_STORAGE = { account: '', location: 'local', customPath: '', folder: 'Sign-Off Booth', backup: 'none', usbName: 'BOOTH-USB', backupFolder: '' };
const BAD_NAME = /[\/\\:*?"<>|\u0000-\u001f]/;
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function tilde(p) { return p === '~' ? HOME : p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p; }
function effectiveStorage() {
  const cur = readSettings();
  if (cur.storage && typeof cur.storage === 'object') return Object.assign({}, DEFAULT_STORAGE, cur.storage);
  /* older settings file: the launcher block held these */
  const l = cur.launcher || {}, o = Object.assign({}, DEFAULT_STORAGE);
  if (l.driveFolder) o.folder = String(l.driveFolder);
  if (l.driveBase) o.location = String(l.driveBase);
  if (l.driveAccount) o.account = String(l.driveAccount);
  if (l.usbName) o.usbName = String(l.usbName);
  return o;
}
function cleanStorage(src, base) {
  const o = Object.assign({}, base);
  if (!src || typeof src !== 'object') return o;
  if (typeof src.account === 'string') { const a = src.account.trim(); if (a && !/^[^\s\/\\@]+@[^\s\/\\@]+$/.test(a)) throw new Error('The Google account should look like name@example.com (or leave it empty).'); o.account = a; }
  if (typeof src.location === 'string') {
    const l = src.location.trim();
    if (l === 'local' || l === 'custom' || l === 'My Drive' || /^Shared drives\/[^\/]{1,100}$/.test(l)) o.location = l; else throw new Error('Unknown save location.');
  }
  if (typeof src.customPath === 'string') o.customPath = tilde(src.customPath.trim()).slice(0, 500);
  if (typeof src.folder === 'string') { const f = src.folder.trim(); if (!f || f.length > 80 || f === '.' || f === '..' || BAD_NAME.test(f)) throw new Error('The folder name cannot be empty or contain / \\ : * ? " < > |'); o.folder = f; }
  if (['usb', 'folder', 'none'].includes(src.backup)) o.backup = src.backup;
  if (typeof src.usbName === 'string') { const f = src.usbName.trim(); if (f.length > 80 || f === '.' || f === '..' || BAD_NAME.test(f)) throw new Error('The USB stick name is not valid.'); o.usbName = f; }
  if (typeof src.backupFolder === 'string') o.backupFolder = tilde(src.backupFolder.trim()).slice(0, 500);
  if (o.location === 'custom' && !path.isAbsolute(o.customPath)) throw new Error('Type the full folder path for "Another folder", starting with /.');
  if (o.backup === 'folder' && !path.isAbsolute(o.backupFolder)) throw new Error('Type the full backup folder path, starting with /.');
  return o;
}
/* Drive for desktop on a Mac keeps each signed-in account at ~/Library/CloudStorage/GoogleDrive-<email> */
function driveAccounts() {
  const base = path.join(HOME, 'Library', 'CloudStorage'), out = [];
  let names = []; try { names = fs.readdirSync(base); } catch (e) {}
  for (const d of names) {
    const m = /^GoogleDrive-(.+)$/.exec(d); if (!m) continue;
    const root = path.join(base, d), locations = [];
    if (isDir(path.join(root, 'My Drive'))) locations.push('My Drive');
    try { for (const n of fs.readdirSync(path.join(root, 'Shared drives'))) if (!n.startsWith('.') && isDir(path.join(root, 'Shared drives', n))) locations.push('Shared drives/' + n); } catch (e) {}
    out.push({ email: m[1], root, locations });
  }
  return out;
}
/* where a plugged-in USB stick shows up: /Volumes on a Mac; /media/<user>, /run/media/<user>, /media, /mnt on Linux */
function usbRoots() {
  if (process.platform === 'darwin') return ['/Volumes'];
  const u = process.env.USER || process.env.LOGNAME || path.basename(HOME);
  return ['/media/' + u, '/run/media/' + u, '/media', '/mnt'];
}
function usbPath(name) { for (const r of usbRoots()) { const p = path.join(r, name); if (isDir(p)) return p; } return ''; }
function usbVolumes() {
  const out = [];
  for (const root of usbRoots()) {
    let names = []; try { names = fs.readdirSync(root); } catch (e) {}
    for (const n of names) {
      const p = path.join(root, n);
      try { if (!fs.statSync(p).isDirectory() || fs.realpathSync(p) === '/') continue; } catch (e) { continue; }
      if (!out.some(v => v.name === n)) out.push({ name: n, writable: canWrite(p) });
    }
  }
  return out;
}
function localClipsDir() { return path.join(path.dirname(SETTINGS_FILE), 'clips'); }
function resolveStorage(st) {
  const r = { clips: '', kind: 'local', account: '', backup: '', backupKind: 'none', notes: [], problem: '' };
  if (st.location === 'local') r.clips = localClipsDir();
  else if (st.location === 'custom') { r.clips = st.customPath; r.kind = 'custom'; }
  else {
    const accts = driveAccounts();
    const a = st.account ? accts.find(x => x.email.toLowerCase() === st.account.toLowerCase()) : accts[0];
    if (a && a.locations.includes(st.location)) { r.clips = path.join(a.root, st.location, st.folder); r.kind = 'drive'; r.account = a.email; }
    else {
      r.clips = localClipsDir(); r.kind = 'local';
      r.problem = !accts.length ? 'driveMissing' : !a ? 'accountMissing' : 'locationMissing';
      r.notes.push(!accts.length ? 'Google Drive for desktop is not signed in on this laptop. Clips are saved on this laptop only.'
        : !a ? 'Google Drive is not signed in as ' + st.account + ' on this laptop (found: ' + accts.map(x => x.email).join(', ') + '). Clips are saved on this laptop only.'
        : '"' + st.location + '" was not found in the Drive account ' + a.email + '. Clips are saved on this laptop only.');
    }
  }
  if (st.backup === 'usb') {
    const v = st.usbName ? usbPath(st.usbName) : '';
    if (v) { r.backup = path.join(v, 'Sign-Off Booth'); r.backupKind = 'usb'; }
    else r.notes.push('No USB stick named ' + (st.usbName || '(none)') + ' is plugged in. Clips have no second copy.');
  } else if (st.backup === 'folder') { r.backup = st.backupFolder; r.backupKind = 'folder'; }
  return r;
}
/* ---- Drive upload with rclone (Linux has no Google Drive for desktop) ----
   booth-settings.json > storage.sync = { "type": "rclone", "remote": "boothdrive:", "path": "" }
   Every few seconds, and right after each saved clip, the clips folder is copied to <remote><path> (path empty = the folder name
   from the storage settings). Copy only: nothing is ever deleted in Drive. Files still being written (.part) are skipped. */
const SYNC = { on: false, found: false, version: '', dest: '', running: false, lastStart: 0, lastOk: 0, lastError: '', lastLine: '', runs: 0, errors: 0 };
function syncConfig() { const s = (STORAGE && STORAGE.settings && STORAGE.settings.sync) || null; return s && s.type === 'rclone' ? s : null; }
function syncDest() { const c = syncConfig(); if (!c) return ''; const remote = (c.remote || 'boothdrive:').replace(/([^:])$/, '$1:'); return remote + (c.path === undefined || c.path === '' ? STORAGE.settings.folder : c.path); }
function rcloneVersion() {
  try { const o = require('child_process').spawnSync('rclone', ['version'], { encoding: 'utf8', timeout: 5000 }); return o.status === 0 ? (o.stdout.split('\n')[0] || '').trim() : ''; } catch (e) { return ''; }
}
function newestClip() {
  let t = 0;
  for (const sub of ['Masters', 'Share']) { try { for (const f of fs.readdirSync(path.join(CLIPS, sub))) { if (f.endsWith('.part')) continue; t = Math.max(t, fs.statSync(path.join(CLIPS, sub, f)).mtimeMs); } } catch (e) {} }
  return t;
}
function syncRun() {
  if (!SYNC.on || SYNC.running || !CLIPS) return;
  const newest = newestClip();
  if (SYNC.lastOk && !SYNC.lastError && newest <= SYNC.lastOk && Date.now() - SYNC.lastOk < 120000) return;   /* nothing new: look again at most every 2 minutes */
  SYNC.running = true; SYNC.lastStart = Date.now(); SYNC.dest = syncDest();
  const args = ['copy', CLIPS, SYNC.dest, '--exclude', '*.part', '--transfers', '2', '--checkers', '4', '--retries', '2', '--low-level-retries', '5', '--stats', '0', '-v'];
  const cmd = process.platform === 'win32' ? 'rclone' : 'nice', full = process.platform === 'win32' ? args : ['-n', '10', 'rclone'].concat(args);
  let err = '', out = '';
  const ch = require('child_process').spawn(cmd, full, { stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = setTimeout(() => { try { ch.kill('SIGKILL'); } catch (e) {} }, 10 * 60 * 1000);
  ch.stdout.on('data', d => { out += d; if (out.length > 4000) out = out.slice(-4000); });
  ch.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
  ch.on('error', e => { clearTimeout(kill); SYNC.running = false; SYNC.errors++; SYNC.lastError = 'rclone could not start: ' + e.message; });
  ch.on('close', code => {
    clearTimeout(kill); SYNC.running = false; SYNC.runs++;
    const lines = (err + out).split('\n').filter(l => /Copied|ERROR|Failed/.test(l));
    SYNC.lastLine = lines.slice(-1)[0] || '';
    if (code === 0) { SYNC.lastOk = SYNC.lastStart; SYNC.lastError = ''; if (lines.some(l => /Copied/.test(l))) console.log('Drive upload: ' + lines.filter(l => /Copied/.test(l)).length + ' file(s) uploaded.'); }
    else { SYNC.errors++; SYNC.lastError = ((err.split('\n').filter(l => /ERROR|Failed|error/i.test(l)).slice(-1)[0]) || 'rclone stopped with code ' + code).replace(/^\S+ \S+ /, '').slice(0, 300); console.log('WARNING: Drive upload failed: ' + SYNC.lastError); }
  });
}
function syncSoon() { if (SYNC.on) setTimeout(syncRun, 800); }
function syncStart() {
  SYNC.on = !!syncConfig();
  if (!SYNC.on) return;
  SYNC.version = rcloneVersion(); SYNC.found = !!SYNC.version; SYNC.dest = syncDest();
  if (!SYNC.found) { SYNC.lastError = 'rclone is not installed on this computer.'; console.log('WARNING: Drive upload is on, but rclone is not installed. Clips stay on this laptop.'); return; }
  setInterval(syncRun, 15000); setTimeout(syncRun, 3000);
}
function syncFacts() {
  if (!syncConfig()) return { on: false };
  const newest = newestClip();
  return { on: true, found: SYNC.found, version: SYNC.version, dest: syncDest(), running: SYNC.running, ok: !SYNC.lastError && SYNC.found, lastOkAt: SYNC.lastOk, lastError: SYNC.lastError,
    waiting: newest > (SYNC.lastOk || 0), errors: SYNC.errors };
}
let STORAGE = null;   /* what is in use right now: { settings, resolved, locked } */
function prepareDirs(r) {
  fs.mkdirSync(path.join(r.clips, 'Masters'), { recursive: true });
  fs.mkdirSync(path.join(r.clips, 'Share'), { recursive: true });
  r.backupError = '';
  /* make the backup folders now, so the booth check can tell a healthy stick from a read-only one */
  if (r.backup) { try { fs.mkdirSync(path.join(r.backup, 'Masters'), { recursive: true }); fs.mkdirSync(path.join(r.backup, 'Share'), { recursive: true }); } catch (e) { r.backupError = e.message; r.notes.push('Could not prepare the backup folder (' + e.message + ').'); } }
}
function applyStorage(st) {
  const locked = !!process.env.BOOTH_CLIPS;
  let r;
  if (locked) r = { clips: process.env.BOOTH_CLIPS, kind: process.env.BOOTH_CLIPS_KIND || 'custom', account: '', backup: process.env.BOOTH_BACKUP || '', backupKind: process.env.BOOTH_BACKUP ? 'folder' : 'none', notes: ['Folders were fixed by the program that started the booth.'], problem: '' };
  else r = resolveStorage(st);
  prepareDirs(r);
  CLIPS = r.clips; BACKUP = r.backup; reserved = 0;
  STORAGE = { settings: st, resolved: r, locked };
  return STORAGE;
}
function startStorage() {
  const st = effectiveStorage();
  try { return applyStorage(st); }
  catch (e) {
    console.log('WARNING: could not use the save folder (' + e.message + '). Clips are saved on this laptop only.');
    const r = resolveStorage(Object.assign({}, st, { location: 'local' })); r.problem = 'folderFailed'; r.notes.push('The chosen folder could not be used (' + e.message + ').');
    prepareDirs(r); CLIPS = r.clips; BACKUP = r.backup; STORAGE = { settings: st, resolved: r, locked: false };
    return STORAGE;
  }
}
function writeStorageSettings(st, port) {
  const cur = readSettings();
  cur.storage = st;
  if (cur.launcher) for (const k of ['driveFolder', 'driveBase', 'driveAccount', 'usbName']) delete cur.launcher[k];
  if (port) { cur.launcher = Object.assign({}, cur.launcher, { port }); }
  const tmp = SETTINGS_FILE + '.part';
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + '\n'); fs.renameSync(tmp, SETTINGS_FILE);
}
function storageView() {
  return { settings: STORAGE.settings, resolved: STORAGE.resolved, locked: STORAGE.locked, port: PORT, portSetting: (readSettings().launcher || {}).port || PORT,
    options: { accounts: driveAccounts().map(a => ({ email: a.email, locations: a.locations })), usb: usbVolumes(), driveApp: isDir('/Applications/Google Drive.app'), sync: syncFacts() } };
}

function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, ip: a.address });
  return out;
}

/* fonts and logos come from the brand folder (see brand/brand.json). No outside font service is used, so the booth works offline. */
function brandAssets(B) {
  B = B || loadBrand();
  const fontsFile = brandFile(B.fonts.cssFile && path.basename(B.fonts.cssFile));
  const logos = {};
  for (const k of ['main', 'border', 'light', 'colour']) logos[k] = brandFile(B.logo[k]);
  return { fontsFile, logos };
}
const LOGO_KINDS = ['border', 'light', 'colour'];
const lookup = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
/* brand colours become the CSS variables the pages use; {{path}} in a page is replaced by that text from brand.json
   ({{json:path}} for use inside a script); window.BRAND carries the same data to the page scripts */
function brandVars(B) {
  const c = B.colors;
  return ':root{--brand:' + c.primary + ';--brand-dark:' + c.primaryDark + ';--accent:' + c.accent + ';--brand-tint:' + c.tint + ';--gold:' + c.gold + ';--gold-dark:' + c.goldDark +
    ';--page:' + c.page + ';--text:' + c.text + ';--muted:' + c.muted + ';--serif:' + B.fonts.serif + ';--sans:' + B.fonts.sans + '}';
}
function renderPage(file) {
  const B = loadBrand();
  let html = fs.readFileSync(path.join(DIR, file), 'utf8');
  html = html.replace(/\{\{(json:)?([A-Za-z0-9_.]+)\}\}/g, (m, j, p) => {
    const v = lookup(B, p);
    if (v === undefined) return m;
    return j ? JSON.stringify(v).replace(/</g, '\\u003c') : esc(v);
  });
  const pub = JSON.stringify({ organisation: B.organisation, event: B.event, tagline: B.tagline, text: B.text, consent: B.consent, shareBase: B.shareBase, logoAlt: B.logo.alt }).replace(/</g, '\\u003c');
  const head = '<link rel="stylesheet" href="/fonts.css"><style id="brand-vars">' + brandVars(B) + '</style><script>window.BRAND=' + pub + ';</script><script src="/brand.js"></script>';
  return html.includes('</head>') ? html.replace('</head>', head + '</head>') : head + html;
}
/* facts for the preflight page (booth-check.html). Folder checks use access(), never write test files, so a Drive folder is not touched. */
function canWrite(p) { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch (e) { return false; } }
function checkFacts() {
  const B = loadBrand(), A = brandAssets(B), promo = brandFile(B.promo) || path.join(BRAND_DIR, 'promo.mp4');
  return {
    node: process.version, arch: process.arch, platform: process.platform, port: PORT, key: KEY, addresses: addresses(), tablets: tablets.size,
    clips: { path: CLIPS, kind: STORAGE.resolved.kind, account: STORAGE.resolved.account, writable: canWrite(CLIPS) && canWrite(path.join(CLIPS, 'Masters')) && canWrite(path.join(CLIPS, 'Share')), next: Math.max(nextNumber(), reserved) },
    backup: { path: BACKUP, set: !!BACKUP, writable: BACKUP ? canWrite(BACKUP) : false, name: STORAGE.settings.usbName, mode: STORAGE.settings.backup, kind: STORAGE.resolved.backupKind },
    storage: { settings: STORAGE.settings, problem: STORAGE.resolved.problem, notes: STORAGE.resolved.notes, locked: STORAGE.locked },
    sync: syncFacts(),
    drive: { app: isDir('/Applications/Google Drive.app') || (process.platform !== 'darwin' && !!syncConfig()), wantAccount: STORAGE.settings.account, accounts: driveAccounts().map(a => ({ email: a.email, locations: a.locations })) },
    assets: { fonts: A.fontsFile ? 'brand/' + path.basename(A.fontsFile) : (B.fonts.cssFile ? 'missing' : 'system fonts'), logo: A.logos.main ? 'brand/' + path.basename(A.logos.main) : 'missing', logos: LOGO_KINDS.filter(k => A.logos[k]) },
    brand: { organisation: B.organisation, consentIsPlaceholder: /\[EDIT ME\]/.test(B.consent) || /\[EDIT ME\]/.test(String(((readSettings().recorder || {}).consent) || '')), customised: B.organisation !== BRAND_DEFAULTS.organisation, dir: BRAND_DIR },
    promo: { exists: fs.existsSync(promo), bytes: fs.existsSync(promo) ? fs.statSync(promo).size : 0, name: path.basename(promo) },
    settings: { file: SETTINGS_FILE, exists: fs.existsSync(SETTINGS_FILE), writable: canWrite(fs.existsSync(SETTINGS_FILE) ? SETTINGS_FILE : path.dirname(SETTINGS_FILE)) },
    pages: { recorder: fs.existsSync(path.join(DIR, 'signoff-board-recorder.html')), tablet: fs.existsSync(path.join(DIR, 'signoff-board-tablet.html')), qr: fs.existsSync(path.join(DIR, 'booth-qr.js')) }
  };
}

let lastFrame = null, lastState = '{}';
let replay = { id: 0, type: '', buf: null };
const tablets = new Set(), recorders = new Set();

function isLocal(req) { const a = req.socket.remoteAddress || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; }
function body(req, limit) {
  return new Promise((res, rej) => {
    const parts = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { rej(new Error('too big')); req.destroy(); } else parts.push(c); });
    req.on('end', () => res(Buffer.concat(parts))); req.on('error', rej);
  });
}
function sse(req, res, set, first) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write('retry: 1000\n\n'); if (first) res.write(first);
  set.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 10000);
  req.on('close', () => { clearInterval(ping); set.delete(res); if (set === tablets) tell(recorders, 'tablets', String(tablets.size)); });
  if (set === tablets) tell(recorders, 'tablets', String(tablets.size));
}
function tell(set, ev, data) { for (const r of set) r.write('event: ' + ev + '\ndata: ' + data + '\n\n'); }
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function sendFile(req, res, file, type, download) {
  const st = fs.statSync(file), total = st.size, range = req.headers.range;
  const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (download) h['Content-Disposition'] = 'attachment; filename="' + path.basename(file).replace(/-[a-z0-9]{10}(?=\.)/, '') + '"';
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], total - 1) : total - 1;
    res.writeHead(206, Object.assign(h, { 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 }));
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, Object.assign(h, { 'Content-Length': total }));
  fs.createReadStream(file).pipe(res);
}
function findShare(code) {
  if (!/^[a-z0-9]{10}$/.test(code)) return null;
  const f = fs.readdirSync(path.join(CLIPS, 'Share')).find(n => n.includes('-' + code + '.'));
  return f ? path.join(CLIPS, 'Share', f) : null;
}
/* clips whose branded copy is not saved yet (also used to stop a folder change while one is in progress) */
function pendingList() {
  const out = [];
  for (const f of fs.readdirSync(PEND)) {
    if (!/^\d+\.json$/.test(f)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(path.join(PEND, f), 'utf8')); } catch (e) { continue; }
    if (findShare(j.code)) { try { fs.unlinkSync(path.join(PEND, f)); } catch (e) {} continue; }      // already done
    if (fs.existsSync(path.join(CLIPS, 'Masters', j.master))) out.push(j);
  }
  return out;
}
function typeOf(f) { return /\.mp4$/i.test(f) ? 'video/mp4' : 'video/webm'; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* write, check the size, then copy to the backup folder and check again */
function writeChecked(dir, name, buf) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, name + '.part'), dest = path.join(dir, name);
  fs.writeFileSync(tmp, buf);
  if (fs.statSync(tmp).size !== buf.length) throw new Error('size check failed');
  fs.renameSync(tmp, dest);
  return dest;
}
function logLine(cols) {
  const f = path.join(CLIPS, 'booth-log.csv');
  if (!fs.existsSync(f)) fs.writeFileSync(f, 'number,kind,file,bytes,saved_at,backup\n');
  fs.appendFileSync(f, cols.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',') + '\n');
}

function sharePage(code) {
  const B = loadBrand(), T = B.text;
  const file = findShare(code);
  const ready = !!file;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="only light"><style>:root{color-scheme:only light}</style>
<title>${esc(T.shareTitle)} | ${esc(B.organisation)}</title><link rel="stylesheet" href="/fonts.css">
<style>${brandVars(B)}
body{margin:0;background:var(--page);color:var(--text);font-family:var(--sans);line-height:1.5}
main{max-width:560px;margin:0 auto;padding:24px 16px 40px}img.logo{width:140px;height:auto;display:block;margin:0 auto 12px}
h1{font-family:var(--serif);font-weight:400;color:var(--brand);font-size:30px;line-height:1.15;text-align:center;margin:8px 0 12px}
p{text-align:center;margin:0 0 16px}video{width:100%;border-radius:14px;background:#000;display:block;margin:0 0 16px}
a.btn{display:block;text-align:center;background:linear-gradient(135deg,var(--brand),var(--brand-dark));color:#fff;text-decoration:none;font-weight:700;font-size:20px;padding:18px;border-radius:14px}
.small{font-size:14px;color:var(--muted)}.tag{font-family:var(--serif);font-weight:400;text-align:center;margin-top:24px;color:var(--brand)}</style></head>
<body><main>${logoPng() ? `<img class="logo" src="/logo.png" alt="${esc(B.logo.alt)}">` : ''}
${ready ? `<h1>${esc(T.shareTitle)}</h1><p>${esc(T.shareLead)}</p>
<video src="/v/${code}" controls playsinline loop muted autoplay></video>
<a class="btn" href="/dl/${code}">${esc(T.shareDownload)}</a>
<p class="small" style="margin-top:12px">${esc(T.shareIphone)}</p>`
    : `<h1>Your clip is on its way</h1><p>${esc(T.shareWait)}</p>`}
<p class="tag">${esc(B.tagline)}</p></main></body></html>`;
}
function logoPng() { const f = brandAssets().logos.main; return f ? fs.readFileSync(f) : null; }

/* ---- control panel (/control, this laptop only): edits brand/brand.json, the logo files and the main recorder settings ----
   Everything it saves is read again on every page load, so nothing needs a restart. */
const SYS_SANS = "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
const FONT_PRESETS = {
  classic:   { label: 'Classic: serif accents, clean sans text', serif: "Georgia,'Times New Roman',serif", sans: SYS_SANS },
  editorial: { label: 'Editorial: book-style serif accents', serif: "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',serif", sans: SYS_SANS },
  modern:    { label: 'Modern: sans everywhere', serif: SYS_SANS, sans: SYS_SANS },
  friendly:  { label: 'Friendly: rounded sans', serif: "'Avenir Next','Trebuchet MS',Verdana,sans-serif", sans: "'Avenir Next','Trebuchet MS',Verdana,system-ui,sans-serif" },
  mono:      { label: 'Typewriter: monospace accents', serif: "'Courier New',Courier,monospace", sans: SYS_SANS }
};
const COLOR_KEYS = ['primary', 'primaryDark', 'accent', 'tint', 'gold', 'goldDark', 'page', 'text', 'muted'];
const TEXT_LIMITS = { helpPerson: 80, welcomeTitle: 80, welcomeBody: 200, attractTitle: 80, attractSub: 160, attractTap: 60, thanksTitle: 60, thanksBody: 160, shareTitle: 80, shareLead: 160, shareDownload: 40, shareIphone: 200, shareWait: 160 };
const REC_DEFAULTS = { countdown: 5, maxLen: 20, linkHours: 72, shareSec: 30, thanksSec: 4 };
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const cleanStr = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

/* keep only known brand fields with the right type and length; an empty text goes back to its default */
function cleanBrandInput(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  const D = BRAND_DEFAULTS;
  const str = (v, n, def) => { const t = cleanStr(v, n); return t || def; };
  if (typeof src.organisation === 'string') out.organisation = str(src.organisation, 60, D.organisation);
  if (src.event && typeof src.event === 'object') {
    out.event = {};
    for (const [k, n] of [['line1', 30], ['line2', 30], ['year', 12]]) if (typeof src.event[k] === 'string') out.event[k] = cleanStr(src.event[k], n);
  }
  if (typeof src.tagline === 'string') out.tagline = cleanStr(src.tagline, 80);
  if (src.colors && typeof src.colors === 'object') {
    out.colors = {};
    for (const k of COLOR_KEYS) if (typeof src.colors[k] === 'string') {
      if (!/^#[0-9a-fA-F]{6}$/.test(src.colors[k])) throw new Error('"' + k + '" is not a colour like #1A2B3C.');
      out.colors[k] = src.colors[k].toUpperCase();
    }
  }
  if (src.fonts && typeof src.fonts === 'object' && src.fonts.preset !== undefined) {
    const f = FONT_PRESETS[src.fonts.preset];
    if (!f) throw new Error('Unknown font choice.');
    out.fonts = { preset: src.fonts.preset, serif: f.serif, sans: f.sans };
  }
  if (src.logo && typeof src.logo === 'object' && typeof src.logo.alt === 'string') out.logo = { alt: str(src.logo.alt, 80, D.logo.alt) };
  if (src.text && typeof src.text === 'object') {
    out.text = {};
    for (const [k, n] of Object.entries(TEXT_LIMITS)) if (typeof src.text[k] === 'string') out.text[k] = str(src.text[k], n, D.text[k]);
  }
  if (typeof src.consent === 'string') out.consent = str(src.consent, 400, D.consent);
  if (typeof src.shareBase === 'string') {
    const b = src.shareBase.trim().slice(0, 500);
    if (b && !/^https?:\/\/[^\s]+$/i.test(b)) throw new Error('The share address must start with http:// or https://');
    out.shareBase = b;
  }
  return out;
}
function writeJsonAtomic(file, obj) { const tmp = file + '.part'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n'); fs.renameSync(tmp, file); }
function readBrandFile() { try { return JSON.parse(fs.readFileSync(path.join(BRAND_DIR, 'brand.json'), 'utf8')) || {}; } catch (e) { return {}; } }
function saveBrandFile(clean) {
  const f = path.join(BRAND_DIR, 'brand.json'), cur = readBrandFile();
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(BRAND_DIR, 'brand.previous.json'));
  writeJsonAtomic(f, deepMerge(cur, clean));
}
const REC_CONTROL_KEYS = ['countdown', 'maxLen', 'linkHours', 'shareSec', 'thanksSec', 'shareBase', 'consent'];
function recorderView() {
  const rec = cleanRecorder(readSettings().recorder), B = loadBrand();
  return Object.assign({}, REC_DEFAULTS, { shareBase: B.shareBase || '', consent: B.consent }, rec);
}
function pngInfo(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 45 || !buf.subarray(0, 8).equals(sig) || buf.toString('latin1', 12, 16) !== 'IHDR' || buf.toString('latin1', buf.length - 8, buf.length - 4) !== 'IEND') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function logoVersions() {
  const A = brandAssets(), out = {};
  for (const k of ['main', 'border', 'light', 'colour']) out[k] = A.logos[k] ? fs.statSync(A.logos[k]).mtimeMs : 0;
  return out;
}
function controlData() {
  return { brand: loadBrand(), defaults: BRAND_DEFAULTS, fontPresets: FONT_PRESETS, recorder: recorderView(), recorderDefaults: REC_DEFAULTS,
    logos: logoVersions(), key: KEY, port: PORT, brandFile: path.join(BRAND_DIR, 'brand.json'), limits: { logoBytes: LOGO_MAX_BYTES, text: TEXT_LIMITS, consent: 400 } };
}
function saveControl(j) {
  const clean = cleanBrandInput(j && j.brand), recIn = (j && j.recorder) || {};
  const rec = {};
  for (const k of REC_CONTROL_KEYS) if (recIn[k] !== undefined) rec[k] = recIn[k];
  if (typeof rec.shareBase === 'string') { const b = rec.shareBase.trim(); if (b && !/^https?:\/\/[^\s]+$/i.test(b)) throw new Error('The share address must start with http:// or https://'); }
  /* the consent shown on the tablet and the share base live in both places; keep them the same so one cannot hide the other */
  if (clean.consent !== undefined) rec.consent = clean.consent;
  if (clean.shareBase !== undefined) rec.shareBase = clean.shareBase;
  saveBrandFile(clean);
  writeRecorderSettings(rec);
  tell(tablets, 'brand', '1');
}
function resetControl() {
  const src = path.join(DIR, 'brand-defaults'), f = path.join(BRAND_DIR, 'brand.json');
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(BRAND_DIR, 'brand.previous.json'));
  for (const n of ['brand.json', 'logo.png', 'logo-border.png', 'logo-light.png', 'logo-colour.png']) {
    const from = path.join(src, n);
    if (fs.existsSync(from)) { const to = path.join(BRAND_DIR, n); fs.copyFileSync(from, to + '.part'); fs.renameSync(to + '.part', to); }
  }
  const cur = readSettings(); cur.recorder = Object.assign({}, cur.recorder);
  for (const k of REC_CONTROL_KEYS) delete cur.recorder[k];
  cur._saved = true; writeJsonAtomic(SETTINGS_FILE, cur);
  tell(tablets, 'brand', '1');
}
function saveLogo(kind, buf) {
  const info = pngInfo(buf);
  if (!info) throw new Error('That is not a PNG image.');
  if (info.w < 16 || info.h < 16 || info.w > 4000 || info.h > 4000) throw new Error('The logo must be between 16 and 4000 pixels on each side.');
  const B = loadBrand(), def = { main: 'logo.png', border: 'logo-border.png', light: 'logo-light.png', colour: 'logo-colour.png' };
  const kinds = kind === 'all' ? Object.keys(def) : [kind];
  for (const k of kinds) {
    if (!def[k]) throw new Error('Unknown logo kind.');
    let name = path.basename(String(B.logo[k] || ''));
    if (!/^[A-Za-z0-9._-]+\.png$/i.test(name)) name = def[k];
    const to = path.join(BRAND_DIR, name);
    fs.writeFileSync(to + '.part', buf); fs.renameSync(to + '.part', to);
  }
}
/* only a page opened as localhost on this laptop may use the panel; saves also need our own header, which another website cannot add */
function controlRefusal(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return 'Open the control panel on the booth laptop at http://localhost:' + PORT + '/control';
  if (req.method === 'POST') {
    if (req.headers['x-booth-control'] !== '1') return 'This request did not come from the control panel.';
    const o = req.headers.origin;
    if (o && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o)) return 'This request came from another website.';
  }
  return '';
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname, local = isLocal(req);
  const keyed = local || u.searchParams.get('k') === KEY;
  try {
    /* shared files */
    let m0;
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p === '/fonts.css') { const f = brandAssets().fontsFile; res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' }); return res.end(f ? fs.readFileSync(f) : ''); }
    if (p === '/brand.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' }); return res.end(fs.readFileSync(path.join(DIR, 'brand-marks.js'))); }
    if (p === '/logo.png') { const f = brandAssets().logos.main; if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }); return res.end(fs.readFileSync(f)); }
    if ((m0 = /^\/brand-logo\/(border|light|colour)\.png$/.exec(p))) { const f = brandAssets().logos[m0[1]]; if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }); return res.end(fs.readFileSync(f)); }
    /* other files in the brand folder (for example font files that fonts.css points at as /brand/<name>) */
    if ((m0 = /^\/brand\/([A-Za-z0-9._-]+)$/.exec(p)) && m0[1] !== 'brand.json') { const f = brandFile(m0[1]); if (!f) { res.writeHead(404); return res.end(); } return sendFile(req, res, f, typeOf(f), false); }
    if (p === '/qr.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(DIR, 'booth-qr.js'))); }

    /* graduate download pages (the random code is the key) */
    let m;
    if ((m = /^\/share\/([a-z0-9]+)$/.exec(p))) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(sharePage(m[1])); }
    if ((m = /^\/(v|dl)\/([a-z0-9]+)$/.exec(p))) { const f = findShare(m[2]); if (!f) { res.writeHead(404); return res.end('Not ready yet'); } return sendFile(req, res, f, typeOf(f), m[1] === 'dl'); }

    /* recorder (laptop only) */
    if (p === '/recorder' || p === '/') {
      if (!local) { if (p === '/') { res.writeHead(302, { Location: '/tablet' + u.search }); return res.end(); } res.writeHead(403); return res.end('The recorder opens on the laptop only.'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(renderPage('signoff-board-recorder.html'));
    }
    if (local) {
      if (p === '/storage' && req.method === 'GET') return json(res, 200, storageView());
      if (p === '/storage' && req.method === 'POST') {
        let j; try { j = JSON.parse((await body(req, 2e4)).toString()); } catch (e) { return json(res, 400, { ok: false, error: 'bad settings' }); }
        if (u.searchParams.get('dry')) { try { return json(res, 200, { ok: true, resolved: resolveStorage(cleanStorage(j.storage, STORAGE.settings)) }); } catch (e) { return json(res, 200, { ok: false, error: e.message }); } }
        if (STORAGE.locked) return json(res, 409, { ok: false, error: 'The folders were fixed by the program that started the booth. Start the booth normally to change them.' });
        let st, port = 0;
        try {
          st = cleanStorage(j.storage, STORAGE.settings);
          if (j.port !== undefined && j.port !== '' && j.port !== null) { port = Math.round(+j.port); if (!(port >= 1024 && port <= 65535)) throw new Error('The port must be a number from 1024 to 65535.'); }
        } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
        if (pendingList().length) return json(res, 409, { ok: false, error: 'A clip is still being saved. Wait a moment, then press Apply again.' });
        const before = { st: STORAGE.settings, clips: CLIPS, backup: BACKUP, res: STORAGE };
        try { applyStorage(st); }
        catch (e) { CLIPS = before.clips; BACKUP = before.backup; STORAGE = before.res; return json(res, 400, { ok: false, error: 'That folder cannot be used: ' + e.message }); }
        try { writeStorageSettings(st, port); }
        catch (e) { return json(res, 500, { ok: false, error: 'Applied, but the settings file could not be saved: ' + e.message }); }
        return json(res, 200, Object.assign({ ok: true }, storageView()));
      }
      if (p === '/info') return json(res, 200, { key: KEY, port: PORT, addresses: addresses(), clips: CLIPS, backup: BACKUP, next: Math.max(nextNumber(), reserved), tablets: tablets.size });
      if (p === '/check') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(renderPage('booth-check.html')); }
      if (p === '/check.json') {
        /* the check page is the place to fix a missing Drive sign-in: look again before any clip has been saved, so no restart is needed */
        if (!STORAGE.locked && STORAGE.resolved.problem && !reserved && !pendingList().length) { try { applyStorage(STORAGE.settings); } catch (e) { /* keep the fallback folder */ } }
        return json(res, 200, checkFacts());
      }
      if (p === '/config' && req.method === 'GET') return json(res, 200, { file: SETTINGS_FILE, exists: fs.existsSync(SETTINGS_FILE), saved: !!readSettings()._saved, recorder: cleanRecorder(readSettings().recorder) });
      if (p === '/config' && req.method === 'POST') {
        let j; try { j = JSON.parse((await body(req, 2e4)).toString()); } catch (e) { return json(res, 400, { ok: false, error: 'bad settings' }); }
        try { return json(res, 200, { ok: true, recorder: writeRecorderSettings(j) }); }
        catch (e) { return json(res, 500, { ok: false, error: 'could not save settings: ' + e.message }); }
      }
      if (p === '/control' || p.startsWith('/control/')) {
        const why = controlRefusal(req);
        if (why) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end(why); }
        if (p === '/control') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(DIR, 'booth-control.html'))); }
        if (p === '/control/data' && req.method === 'GET') return json(res, 200, controlData());
        try {
          if (p === '/control/save' && req.method === 'POST') {
            let j; try { j = JSON.parse((await body(req, 1e5)).toString()); } catch (e) { return json(res, 400, { ok: false, error: 'Could not read the settings.' }); }
            saveControl(j); return json(res, 200, { ok: true, data: controlData() });
          }
          if (p === '/control/upload' && req.method === 'POST') {
            if (+req.headers['content-length'] > LOGO_MAX_BYTES) { res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' }); return res.end(JSON.stringify({ ok: false, error: 'That file is too big. The limit is 2 MB.' })); }
            saveLogo(u.searchParams.get('kind') || 'main', await body(req, LOGO_MAX_BYTES + 1024));
            return json(res, 200, { ok: true, logos: logoVersions() });
          }
          if (p === '/control/reset' && req.method === 'POST') { resetControl(); return json(res, 200, { ok: true, data: controlData() }); }
        } catch (e) { return json(res, e.message === 'too big' ? 413 : 400, { ok: false, error: e.message === 'too big' ? 'That file is too big. The limit is 2 MB.' : e.message }); }
        res.writeHead(404); return res.end();
      }
      if (p === '/rec-events') return sse(req, res, recorders, 'event: tablets\ndata: ' + tablets.size + '\n\n');
      if (p === '/state' && req.method === 'POST') { lastState = (await body(req, 1e5)).toString(); tell(tablets, 'state', lastState); res.writeHead(204); return res.end(); }
      if (p === '/frame' && req.method === 'POST') { lastFrame = await body(req, 3e6); res.writeHead(204); return res.end(); }
      if (p === '/replay' && req.method === 'POST') {
        replay = { id: replay.id + 1, type: req.headers['content-type'] || 'video/webm', buf: await body(req, 100e6) };
        return json(res, 200, { id: replay.id });
      }
      if (p === '/save' && req.method === 'POST') {
        const kind = u.searchParams.get('kind'), ext = u.searchParams.get('ext') === 'mp4' ? 'mp4' : 'webm';
        const buf = await body(req, 500e6);
        if (!buf.length) return json(res, 400, { ok: false, error: 'empty clip' });
        let n = +u.searchParams.get('n') || 0, code = u.searchParams.get('code') || '';
        if (kind === 'master') { n = Math.max(nextNumber(), reserved); reserved = n + 1; code = newCode(); }
        if (!n || !/^[a-z0-9]{10}$/.test(code)) return json(res, 400, { ok: false, error: 'missing number or code' });
        const num = String(n).padStart(3, '0');
        const name = kind === 'master' ? `${PREFIX}-${num}.${ext}` : `${PREFIX}-${num}-branded-${code}.${ext}`;
        const sub = kind === 'master' ? 'Masters' : 'Share';
        const dest = writeChecked(path.join(CLIPS, sub), name, buf);
        let backup = 'none';
        if (BACKUP) { try { writeChecked(path.join(BACKUP, sub), name, buf); backup = 'ok'; } catch (e) { backup = 'FAILED: ' + e.message; } }
        logLine([n, kind, name, buf.length, new Date().toISOString(), backup]);
        const pend = path.join(PEND, num + '.json');
        if (kind === 'master') fs.writeFileSync(pend, JSON.stringify({ n, code, ext, master: name, at: new Date().toISOString() }));
        else { try { fs.unlinkSync(pend); } catch (e) {} }
        syncSoon();
        return json(res, 200, { ok: true, n, code, file: name, path: dest, bytes: buf.length, backup });
      }
      if (p === '/pending') return json(res, 200, { pending: pendingList() });
      if (p === '/master-file') {
        const name = u.searchParams.get('name') || '';
        const f = path.join(CLIPS, 'Masters', name);
        if (!/^[\w.-]+\.(mp4|webm)$/.test(name) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
        return sendFile(req, res, f, typeOf(f), false);
      }
      if (p === '/list') {
        const rows = [];
        for (const sub of ['Masters', 'Share']) for (const f of fs.readdirSync(path.join(CLIPS, sub))) {
          if (!/\.(mp4|webm)$/.test(f)) continue;
          const st = fs.statSync(path.join(CLIPS, sub, f)); rows.push({ folder: sub, file: f, bytes: st.size, at: st.mtime });
        }
        rows.sort((a, b) => b.at - a.at);
        return json(res, 200, { rows: rows.slice(0, 200), clips: CLIPS, backup: BACKUP });
      }
    }

    /* tablet (needs the key) */
    if (!keyed) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('Open the tablet link shown on the booth laptop.'); }
    if (p === '/tablet') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(renderPage('signoff-board-tablet.html')); }
    if (p === '/tab-events') return sse(req, res, tablets, 'event: state\ndata: ' + lastState + '\n\n');
    if (p === '/cmd' && req.method === 'POST') {
      const c = (await body(req, 2e3)).toString(); tell(recorders, 'cmd', c);
      res.writeHead(recorders.size ? 204 : 503); return res.end();
    }
    if (p === '/frame.jpg') { if (!lastFrame) { res.writeHead(204); return res.end(); } res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }); return res.end(lastFrame); }
    if (p === '/replay') {
      if (!replay.buf || +u.searchParams.get('id') !== replay.id) { res.writeHead(404); return res.end(); }
      const total = replay.buf.length, range = req.headers.range;
      if (range) {
        const mm = /bytes=(\d*)-(\d*)/.exec(range) || [];
        const start = mm[1] ? +mm[1] : 0, end = mm[2] ? Math.min(+mm[2], total - 1) : total - 1;
        res.writeHead(206, { 'Content-Type': replay.type, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'no-store' });
        return res.end(replay.buf.subarray(start, end + 1));
      }
      res.writeHead(200, { 'Content-Type': replay.type, 'Content-Length': total, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      return res.end(replay.buf);
    }
    if (p === '/promo') { const f = brandFile(loadBrand().promo); if (!f) { res.writeHead(404); return res.end(); } return sendFile(req, res, f, 'video/mp4', false); }
    res.writeHead(404); res.end();
  } catch (e) { if (!res.headersSent) res.writeHead(500); res.end(String(e.message)); }
});

startStorage();
syncStart();
server.listen(PORT, '0.0.0.0', () => {
  console.log('Sign-Off Booth server running.');
  console.log('Recorder (this laptop): http://localhost:' + PORT + '/recorder');
  console.log('Control panel (logo, colours, wording): http://localhost:' + PORT + '/control');
  for (const a of addresses()) console.log('Tablet (' + a.name + '):       http://' + a.ip + ':' + PORT + '/tablet?k=' + KEY);
  const R = STORAGE.resolved;
  console.log('Clips folder: ' + CLIPS + '  (' + (R.kind === 'drive' ? 'Google Drive, ' + R.account : R.kind === 'custom' ? 'chosen folder' : 'this laptop only') + ')');
  console.log('Backup:       ' + (BACKUP ? BACKUP : 'none'));
  if (syncConfig()) console.log('Drive upload: rclone, to ' + syncDest() + (SYNC.found ? '  (' + SYNC.version + ')' : '  (rclone NOT FOUND)'));
  for (const n of R.notes) console.log('WARNING: ' + n);
  console.log('Change these in the recorder: Settings > Where clips are saved.');
  console.log('Stop with Ctrl+C.');
});
