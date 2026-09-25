'use strict';

// Rebuild the independently versioned capture library from a reviewed Core
// checkout. The IDE's layout bundle remains on its existing release.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const source = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node src/scripts/update-pyret-capture.js /path/to/spytial-core');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
if (execFileSync('git', ['diff', 'HEAD', '--', 'src', 'package.json', 'package-lock.json', 'tsup.pyret-capture.config.ts'],
  { cwd: source, encoding: 'utf8' }).trim()) throw new Error('Commit the Core implementation before vendoring it.');
execFileSync('npm', ['run', 'build:pyret-capture'], { cwd: source, stdio: 'inherit' });
const bytes = fs.readFileSync(path.join(source, 'dist/pyret-capture.global.js'));
const target = path.resolve(__dirname, '../../lib/js');
fs.writeFileSync(path.join(target, 'spytial-pyret-capture.js'), bytes);
fs.writeFileSync(path.join(target, 'spytial-pyret-capture.json'), JSON.stringify({
  repository: 'https://github.com/sidprasad/spytial-core', revision,
  build: 'npm ci && npm run build:pyret-capture',
  sha256: createHash('sha256').update(bytes).digest('hex'),
}, null, 2) + '\n');
const corePackage = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
const licenses = [['graphlib', 'node_modules/graphlib/LICENSE'], ['lodash', 'node_modules/lodash/LICENSE']];
fs.writeFileSync(path.join(target, 'spytial-pyret-capture.LICENSE.txt'),
  'Spytial-Core\nAuthor: ' + corePackage.author + '\nLicense: ' + corePackage.license
  + ' (declared in package.json)\nSource: https://github.com/sidprasad/spytial-core/tree/' + revision + '\n\n'
  + licenses.map(([name, file]) =>
  name + '\n\n' + fs.readFileSync(path.join(source, file), 'utf8')).join('\n\n'));
console.log('Updated Pyret capture from Core ' + revision);
