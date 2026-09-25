'use strict';

// Copy the browser entry from the installed, lockfile-verified npm package.
// No Spyret/Core source checkout or package rebuild is involved.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const root = path.resolve(__dirname, '../..');
const entry = require.resolve('spyret/global');
const source = path.dirname(path.dirname(entry));
const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
const manifest = require(path.join(root, 'package.json'));
const locked = require(path.join(root, 'package-lock.json')).packages['node_modules/spyret'];
if (manifest.dependencies.spyret !== pkg.version || locked.version !== pkg.version
    || !locked.resolved.startsWith('https://registry.npmjs.org/spyret/-/')) {
  throw new Error('Spyret must be installed at the exact published version in package.json and package-lock.json');
}
const bytes = fs.readFileSync(entry);
const target = path.join(root, 'lib/js');
function write(name, value) {
  const file = path.join(target, name);
  const contents = Buffer.from(value);
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(contents)) fs.writeFileSync(file, contents);
}
write('spytial-pyret-capture.js', bytes);
write('spytial-pyret-capture.json', JSON.stringify({
  package: pkg.name, version: pkg.version, resolved: locked.resolved,
  integrity: locked.integrity,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}, null, 2) + '\n');
write('spytial-pyret-capture.LICENSE.txt', fs.readFileSync(path.join(source, 'LICENSE'), 'utf8').trimEnd()
  + '\n\n' + fs.readFileSync(path.join(source, 'THIRD_PARTY_NOTICES.txt'), 'utf8').trimEnd() + '\n');
console.log('Using published ' + pkg.name + '@' + pkg.version);
