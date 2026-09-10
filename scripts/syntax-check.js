'use strict';

/*
 * Extracts every inline <script> block from index.html and runs node --check on each.
 *
 * This catches syntax damage in under a second, before the slower jsdom suite runs.
 * It also guards against the file-corruption failure mode from the old upload
 * workflow, where a duplicate fragment was appended after </html>.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');

let failures = 0;

/* Structural sanity checks first. */
const openTags = (html.match(/<script\b[^>]*>/gi) || []).length;
const closeTags = (html.match(/<\/script>/gi) || []).length;
if (openTags !== closeTags) {
  console.log('  FAIL  script tags balanced (' + openTags + ' open, ' + closeTags + ' close)');
  failures++;
} else {
  console.log('  PASS  script tags balanced (' + openTags + ')');
}

const closeHtml = html.lastIndexOf('</html>');
if (closeHtml === -1) {
  console.log('  FAIL  </html> present');
  failures++;
} else {
  const trailing = html.slice(closeHtml + '</html>'.length).trim();
  if (trailing.length > 0) {
    console.log('  FAIL  content after </html> (' + trailing.length + ' bytes). Likely a corrupted paste.');
    failures++;
  } else {
    console.log('  PASS  nothing after </html>');
  }
}

/* Syntax check each inline block. Blocks with a src attribute are skipped. */
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-'));
let m;
let n = 0;

while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  const body = m[2] || '';
  if (/\bsrc\s*=/i.test(attrs)) continue;
  if (/type\s*=\s*["']?(application\/json|text\/template)/i.test(attrs)) continue;
  if (!body.trim()) continue;

  n++;
  const isModule = /type\s*=\s*["']?module/i.test(attrs);
  const file = path.join(tmp, 'block' + n + (isModule ? '.mjs' : '.js'));
  fs.writeFileSync(file, body);

  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log('  PASS  script block ' + n + ' (' + body.length + ' bytes)');
  } catch (e) {
    const msg = (e.stderr || Buffer.from('')).toString().split('\n').slice(0, 4).join('\n    ');
    console.log('  FAIL  script block ' + n + '\n    ' + msg);
    failures++;
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n' + n + ' inline script block(s) checked, ' + failures + ' failure(s)');
process.exit(failures === 0 ? 0 : 1);
