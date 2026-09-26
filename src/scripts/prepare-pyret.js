'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'vendor/pyret-upstream');
const language = path.join(source, 'lang');

function prepare() {
  if (!fs.existsSync(path.join(language, 'package-lock.json'))) {
    throw new Error('Initialize the standard Pyret backend: git submodule update --init --recursive');
  }
  const link = path.join(root, 'pyret');
  let existing;
  try { existing = fs.lstatSync(link); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error('Expected pyret to be a symlink; move the local directory before building.');
    }
    if (fs.readlinkSync(link) !== 'vendor/pyret-upstream/lang') fs.unlinkSync(link);
  }
  if (!fs.existsSync(link)) fs.symlinkSync('vendor/pyret-upstream/lang', link);
  const hash = createHash('sha256').update(fs.readFileSync(path.join(language, 'package-lock.json'))).digest('hex');
  const stamp = path.join(language, 'node_modules/.spyret-lock');
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== hash) {
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts'],
      { cwd: language, stdio: 'inherit' });
    fs.writeFileSync(stamp, hash);
  }
  // Compiled module caches cannot be reused across compiler revisions.
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  const builtWith = path.join(root, 'compiled/.pyret-backend');
  if (!fs.existsSync(builtWith) || fs.readFileSync(builtWith, 'utf8') !== revision) {
    fs.rmSync(path.join(root, 'compiled'), { recursive: true, force: true });
    fs.rmSync(path.join(root, 'build/web/js/cpo-main.jarr'), { force: true });
    fs.mkdirSync(path.dirname(builtWith), { recursive: true });
    fs.writeFileSync(builtWith, revision);
  }
}

if (require.main === module) prepare();
module.exports = { prepare };
