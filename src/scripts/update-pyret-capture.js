'use strict';

// Rebuild the independently versioned capture library from a reviewed Spyret
// checkout. The IDE's layout bundle remains on its existing release.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const source = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node src/scripts/update-pyret-capture.js /path/to/spyret');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
if (execFileSync('git', ['diff', 'HEAD', '--', 'src', 'package.json', 'package-lock.json', 'tsup.config.ts'],
  { cwd: source, encoding: 'utf8' }).trim()) throw new Error('Commit the Spyret implementation before vendoring it.');
execFileSync('npm', ['run', 'build'], { cwd: source, stdio: 'inherit' });
const bytes = fs.readFileSync(path.join(source, 'dist/spyret.global.js'));
const target = path.resolve(__dirname, '../../lib/js');
const spyretPackage = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
const corePackage = JSON.parse(fs.readFileSync(path.join(source, 'node_modules/spytial-core/package.json'), 'utf8'));
fs.writeFileSync(path.join(target, 'spytial-pyret-capture.js'), bytes);
fs.writeFileSync(path.join(target, 'spytial-pyret-capture.json'), JSON.stringify({
  repository: 'https://github.com/sidprasad/spyret', revision,
  version: spyretPackage.version,
  core: { version: corePackage.version, source: spyretPackage.devDependencies['spytial-core'] },
  build: 'npm ci && npm run build',
  sha256: createHash('sha256').update(bytes).digest('hex'),
}, null, 2) + '\n');
const licenses = [['graphlib', 'node_modules/graphlib/LICENSE'], ['lodash', 'node_modules/lodash/LICENSE']];
fs.writeFileSync(path.join(target, 'spytial-pyret-capture.LICENSE.txt'),
  'Spyret\nAuthor: ' + spyretPackage.author + '\nLicense: ' + spyretPackage.license
  + ' (declared in package.json)\nSource: https://github.com/sidprasad/spyret/tree/' + revision + '\n\n'
  + fs.readFileSync(path.join(source, 'LICENSE'), 'utf8') + '\n\n'
  + 'Spytial-Core ' + corePackage.version + '\nAuthor: ' + corePackage.author
  + '\nLicense: ' + corePackage.license + ' (declared in package.json)\nSource: '
  + spyretPackage.devDependencies['spytial-core'] + '\n\n'
  + licenses.map(([name, file]) =>
  name + '\n\n' + fs.readFileSync(path.join(source, file), 'utf8')).join('\n\n'));
console.log('Updated Pyret capture from Spyret ' + revision);
