#!/usr/bin/env node
/**
 * Stamps every local asset URL in the HTML with a hash of that file's contents.
 *
 * Version strings used to be dates typed by hand, which meant the version only
 * changed when someone remembered to change it. On 4 Aug 2026 four files had
 * been rewritten and still carried July dates: everyone who had visited before
 * was served the old copies from cache, and the bug surfaced as a draw timer
 * that was a day out for one person and correct for another.
 *
 * A content hash cannot be forgotten. It changes exactly when the file changes,
 * and — just as usefully — does NOT change when the file doesn't, so editing one
 * script no longer forces every visitor to re-download all of them.
 *
 * Runs with no dependencies, and rewrites nothing when nothing has changed, so
 * it is safe to run on every push.
 */

// ESM, matching the rest of scripts/ — the repo sets "type": "module", so a
// .js file here is a module and require() is not defined in it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const HTML_FILES = process.argv.slice(2);
if (!HTML_FILES.length) HTML_FILES.push('index.html');

// Local assets only. A CDN URL is someone else's cache to manage.
const ASSET_RE = /(?<!\/\/)(?:^|["'(\s])((?:\.\/)?assets\/[A-Za-z0-9._\-\/]+\.(?:js|css))(\?v=[^"'\s)]*)?/g;

function hashOf(rel) {
  const abs = path.join(ROOT, rel.replace(/^\.\//, ''));
  if (!fs.existsSync(abs)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 10);
}

let changedFiles = 0;
let missing = [];

for (const file of HTML_FILES) {
  if (!fs.existsSync(file)) {
    console.error(`skip: ${file} not found`);
    continue;
  }
  const before = fs.readFileSync(file, 'utf8');
  const seen = new Map();

  // HTML comments are masked out before matching. The real page mentions
  // "assets/js/app.js" inside a note about relative paths, and stamping a
  // version into prose is at best confusing.
  const comments = [];
  const masked = before.replace(/<!--[\s\S]*?-->/g, (c) => {
    comments.push(c);
    return `\u0000C${comments.length - 1}\u0000`;
  });

  let after = masked.replace(ASSET_RE, (match, rel, oldQ) => {
    const h = hashOf(rel);
    if (!h) {
      // A reference to a file that does not exist is worth surfacing: it is
      // either a typo or a deleted asset, and both are silent in a browser.
      missing.push(`${file} → ${rel}`);
      return match;
    }
    seen.set(rel, h);
    const newQ = `?v=${h}`;
    return oldQ ? match.replace(oldQ, newQ) : match.replace(rel, rel + newQ);
  });

  after = after.replace(/\u0000C(\d+)\u0000/g, (_, i) => comments[Number(i)]);

  if (after !== before) {
    fs.writeFileSync(file, after);
    changedFiles++;
    console.log(`updated ${file}`);
  } else {
    console.log(`unchanged ${file}`);
  }

  for (const [rel, h] of seen) console.log(`  ${h}  ${rel}`);
}

// A dangling reference is worth flagging, but it must not stop the stamping:
// one stale <script> tag should not leave every other asset uncached-busted.
if (missing.length) {
  console.error('\nreferenced but not found:');
  for (const m of missing) console.error('  ' + m);
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::warning::${missing.length} asset reference(s) point at files that do not exist: ${missing.join(', ')}`);
  }
}

// Signals to the workflow whether a commit is needed, without it having to
// diff the tree itself.
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changedFiles > 0}\n`);
}
