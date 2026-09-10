'use strict';

/*
 * jsdom gap fills.
 *
 * Every entry here exists because a real session hit it. Do not trim this list
 * because a given test does not appear to need something; the cost of a missing
 * polyfill is a confusing failure that looks like an app bug.
 *
 * Usage:
 *   const { applyPolyfills, applyPostParse } = require('./polyfills');
 *   new JSDOM(html, { beforeParse: applyPolyfills, ... });
 *   applyPostParse(dom.window);
 */

/**
 * Applied via JSDOM's beforeParse hook, so these exist before app scripts run.
 */
function applyPolyfills(win, opts) {
  const options = opts || {};

  win.matchMedia = win.matchMedia || function () {
    return {
      matches: false,
      media: '',
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false; }
    };
  };

  win.scrollTo = function () {};
  win.scrollBy = function () {};
  win.print = function () {};

  win.requestAnimationFrame = function (cb) {
    return setTimeout(function () { cb(Date.now()); }, 0);
  };
  win.cancelAnimationFrame = function (id) { clearTimeout(id); };

  // Native dialogs block forever under jsdom. Default to the non-destructive answer.
  win.alert = function () {};
  win.confirm = function () { return true; };
  win.prompt = function (msg, def) { return def === undefined ? '' : def; };

  win.open = function () {
    return {
      document: { write() {}, close() {} },
      focus() {}, print() {}, close() {}
    };
  };

  if (win.URL) {
    win.URL.createObjectURL = function () { return 'blob:test'; };
    win.URL.revokeObjectURL = function () {};
  }

  if (!win.ResizeObserver) {
    win.ResizeObserver = function () {
      return { observe() {}, unobserve() {}, disconnect() {} };
    };
  }

  if (!win.IntersectionObserver) {
    win.IntersectionObserver = function () {
      return { observe() {}, unobserve() {}, disconnect() {}, takeRecords() { return []; } };
    };
  }

  if (options.online !== undefined) {
    Object.defineProperty(win.navigator, 'onLine', {
      value: options.online,
      configurable: true
    });
  }

  // Seed storage before the app boots, so init reads real data.
  if (options.localStorage) {
    Object.keys(options.localStorage).forEach(function (k) {
      const v = options.localStorage[k];
      win.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    });
  }

  if (options.beforeParseExtra) options.beforeParseExtra(win);
}

/**
 * Applied after the DOM exists. Layout metrics need the prototype to be present.
 * jsdom reports every layout dimension as 0, which turns any division into
 * NaN or Infinity and produces failures that look like app bugs.
 */
function applyPostParse(win, dims) {
  const d = Object.assign({
    offsetWidth: 800,
    offsetHeight: 600,
    clientWidth: 800,
    clientHeight: 600,
    scrollWidth: 800,
    scrollHeight: 2000
  }, dims || {});

  Object.keys(d).forEach(function (prop) {
    Object.defineProperty(win.HTMLElement.prototype, prop, {
      get() { return d[prop]; },
      configurable: true
    });
  });

  win.HTMLElement.prototype.scrollIntoView = function () {};

  // jsdom implements <dialog> only partially in some versions.
  const proto = win.HTMLDialogElement && win.HTMLDialogElement.prototype;
  if (proto && !proto.showModal) {
    proto.showModal = function () { this.open = true; };
    proto.show = function () { this.open = true; };
    proto.close = function (v) {
      this.open = false;
      this.returnValue = v === undefined ? '' : v;
      this.dispatchEvent(new win.Event('close'));
    };
  }
}

/**
 * Minimal Supabase double. Records every operation so tests can assert that the
 * manual-publish model is respected, meaning nothing writes until Upload is pressed.
 */
function makeSupabaseMock() {
  const db = { songs: {}, setlists: {} };
  const ops = [];

  function table(name) {
    return {
      select() {
        ops.push('select ' + name);
        return Promise.resolve({ data: Object.values(db[name] || {}), error: null });
      },
      upsert(rows) {
        const list = Array.isArray(rows) ? rows : [rows];
        ops.push('upsert ' + name + ' x' + list.length);
        list.forEach(function (r) { db[name][r.title || r.name] = r; });
        return Promise.resolve({ data: list, error: null });
      },
      delete() {
        return {
          in(col, vals) {
            ops.push('delete ' + name + ' x' + vals.length);
            vals.forEach(function (v) { delete db[name][v]; });
            return Promise.resolve({ error: null });
          }
        };
      }
    };
  }

  return {
    db: db,
    ops: ops,
    reset() { ops.length = 0; },
    client: {
      createClient() {
        return {
          from: table,
          channel() { return { on() { return this; }, subscribe() { return this; } }; }
        };
      }
    }
  };
}

module.exports = { applyPolyfills, applyPostParse, makeSupabaseMock };
