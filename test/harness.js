'use strict';

/*
 * jsdom test harness for the Setlist App.
 *
 * Run with:  npm test
 *
 * Add cases to the suite at the bottom. The harness itself should rarely change.
 * Every assertion prints PASS or FAIL and the process exits non-zero on any failure
 * or any error logged during boot.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { applyPolyfills, applyPostParse, makeSupabaseMock } = require('./polyfills');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'index.html');
const FIXTURE = path.join(__dirname, 'fixtures', 'library.sample.json');

let pass = 0;
let fail = 0;
const bootErrors = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''));
  }
}

function section(title) {
  console.log('\n-- ' + title + ' --');
}

function near(a, b, tol) {
  return typeof a === 'number' && Math.abs(a - b) <= (tol === undefined ? 0.001 : tol);
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

/**
 * Boot the app in jsdom and return the window, document, and exposed internals.
 */
function boot(opts) {
  const options = opts || {};
  const html = fs.readFileSync(APP, 'utf8');

  const vc = new VirtualConsole();
  vc.on('jsdomError', function (e) { bootErrors.push('jsdomError: ' + (e.detail || e.message)); });
  vc.on('error', function () {
    bootErrors.push('console.error: ' + Array.from(arguments).join(' '));
  });

  const supabase = makeSupabaseMock();

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: 'https://sjanes9.github.io/Setlist-App/',
    beforeParse: function (win) {
      applyPolyfills(win, {
        online: true,
        localStorage: options.storage || {},
        beforeParseExtra: function (w) {
          w.supabase = supabase.client;
          if (options.beforeParseExtra) options.beforeParseExtra(w);
        }
      });
    }
  });

  applyPostParse(dom.window, options.dims);

  return {
    dom: dom,
    win: dom.window,
    doc: dom.window.document,
    supabase: supabase,
    /** Internals namespace. Keep the app exposing this or the suite goes blind. */
    get app() { return dom.window.__setlist; }
  };
}

/* ------------------------------------------------------------------ */
/* Suite                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('Setlist App test suite');

  const fixture = fs.existsSync(FIXTURE)
    ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    : { songs: {}, setlists: {} };

  section('boot');
  const ctx = boot({
    storage: {
      song_manager_library: fixture.songs,
      song_manager_setlists: fixture.setlists
    }
  });
  await sleep(150);

  ok('booted with no console errors', bootErrors.length === 0, bootErrors.slice(0, 3));
  ok('internals exposed on window.__setlist', !!ctx.app);

  section('manual publish model');
  // The manual-publish rule is about WRITES. A boot-time keep-alive read
  // (count-only select, so the free Supabase project does not pause) is allowed;
  // only upsert/delete are forbidden until Upload is pressed.
  const bootWrites = ctx.supabase.ops.filter(function (o) { return /^(upsert|delete) /.test(o); });
  ok('nothing written to cloud on boot', bootWrites.length === 0, bootWrites);

  section('storage hardening');
  const blocked = boot({
    beforeParseExtra: function (w) {
      // Simulate the artifact sandbox and Safari private mode.
      Object.defineProperty(w, 'localStorage', {
        get() { throw new Error('storage blocked'); },
        configurable: true
      });
    }
  });
  await sleep(150);
  ok('app boots with localStorage completely blocked', !!blocked.doc.body.firstChild);

  section('XSS safety');
  /*
   * Do not test this by checking whether a payload executed. jsdom does not fire
   * img onerror without resources:'usable', so an execution check passes even when
   * the app is injecting raw innerHTML. That is a vacuous test.
   *
   * Test structurally instead: if the hostile string was parsed as markup, an
   * element node exists that should not. If it was set as text, it does not.
   */
  const nasty = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
  const xss = boot({
    storage: {
      song_manager_library: { [nasty]: { lyrics: nasty, tempo: 120, time_sig: '4/4' } },
      song_manager_setlists: { 'Set 1': [nasty] }
    }
  });
  await sleep(150);

  const injectedImg = xss.doc.querySelector('img[src="x"]');
  const injectedBold = Array.from(xss.doc.querySelectorAll('b'))
    .some(function (b) { return b.textContent === 'bold'; });

  ok('hostile title not parsed as an img element', injectedImg === null);
  ok('hostile title not parsed as markup', injectedBold === false);
  ok('hostile title rendered as literal text',
    xss.doc.body.textContent.indexOf('<img src=x') !== -1);
  ok('payload did not execute', xss.win.__pwned === undefined);

  /* Add further cases here. Suggested next: library import and export round trip,
     ChordPro section header parsing, time signature save and load, and a check
     that every control in the DOM is either wired or labelled Coming Soon. */

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (bootErrors.length) {
    console.log('\nErrors captured during boot:');
    bootErrors.slice(0, 10).forEach(function (e) { console.log('  ' + e); });
  }
  process.exit(fail === 0 && bootErrors.length === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('harness crashed:', e);
  process.exit(1);
});

module.exports = { boot, ok, section, near, sleep };
