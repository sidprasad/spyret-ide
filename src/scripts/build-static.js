'use strict';

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const mustache = require('mustache');
const root = path.resolve(__dirname, '../..');

function publicConfig(env = process.env) {
  const filename = path.join(root, '.env.static');
  const config = Object.assign({}, fs.existsSync(filename) ? require('dotenv').parse(fs.readFileSync(filename)) : {}, env);
  const base = (config.STATIC_BASE_PATH || '').replace(/\/$/, '');
  if (base && !/^\/(?:[a-zA-Z0-9_-]+\/?)+$/.test(base)) {
    throw new Error('STATIC_BASE_PATH must be an absolute URL path, such as /spyret.');
  }
  const result = {CLIENT_SIDE: 'true', BASE_URL: base, STATIC_BASE_PATH: base,
    ASSET_BASE_URL: base, PYRET: base + '/js/cpo-main.jarr.js', PYRET_BACKUP: '',
    IMAGE_PROXY_BYPASS: 'true', URL_FILE_MODE: 'all-remote', LOG_URL: '',
    CURRENT_PYRET_RELEASE: '', CURRENT_PYRET_DOCS: 'latest', POSTMESSAGE_ORIGIN: '',
    GIT_REV: 'static', GIT_BRANCH: 'static'};
  for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_API_KEY', 'GOOGLE_APP_ID']) {
    const value = config[name] || '';
    if (!/^[a-zA-Z0-9_.-]*$/.test(value)) { throw new Error('Invalid public setting: ' + name); }
    result[name] = value;
  }
  return result;
}

function build() {
  const config = publicConfig();
  const env = Object.assign({}, process.env, config, {NODE_ENV: 'production'});
  // Static output only receives public settings. Do not load the server's .env.
  for (const key of Object.keys(env)) {
    if (/SECRET|TOKEN|REDIS|FIREBASE/.test(key)) { delete env[key]; }
  }
  if (!fs.existsSync(path.join(root, 'pyret'))) {
    fs.symlinkSync('node_modules/pyret-lang', path.join(root, 'pyret'));
  }
  for (const [command, args] of [
    [process.execPath, ['node_modules/webpack/bin/webpack.js']],
    ['make', ['web', 'build/web/js/cpo-main.jarr']]
  ]) {
    const result = spawnSync(command, args, {cwd: root, env, stdio: 'inherit'});
    if (result.error) { throw result.error; }
    if (result.status !== 0) { throw new Error(command + ' failed (' + result.status + ')'); }
  }
  const output = path.join(root, 'build/static');
  fs.rmSync(output, {recursive: true, force: true});
  fs.mkdirSync(output, {recursive: true});
  for (const directory of ['js', 'css', 'img']) {
    fs.cpSync(path.join(root, 'build/web', directory), path.join(output, directory), {recursive: true,
      filter: source => !/cpo-main\.jarr(?:\.|$)/.test(path.basename(source))});
  }
  // Make's timestamps do not track configuration changes between deployments.
  // Render asset URLs again so switching the hosting prefix cannot reuse old CSS.
  for (const file of fs.readdirSync(path.join(root, 'src/web/css'))) {
    if (file.endsWith('.template.css')) {
      fs.writeFileSync(path.join(output, 'css', file.replace('.template', '')),
        mustache.render(fs.readFileSync(path.join(root, 'src/web/css', file), 'utf8'), config));
    }
  }
  // Serve ordinary JavaScript; static hosts need no special .jarr/gzip handlers.
  fs.copyFileSync(path.join(root, 'build/web/js/cpo-main.jarr'), path.join(output, 'js/cpo-main.jarr.js'));
  const html = mustache.render(fs.readFileSync(path.join(root, 'src/web/editor.html'), 'utf8'), config);
  fs.mkdirSync(path.join(output, 'editor'));
  fs.writeFileSync(path.join(output, 'index.html'), html);
  fs.writeFileSync(path.join(output, 'editor/index.html'), html);
  // Used only by the local preview server to mount a configured path prefix.
  fs.writeFileSync(path.join(output, 'static-config.json'), JSON.stringify({basePath: config.BASE_URL}));
  console.log('Static IDE built in build/static. Run npm start to preview.');
}
if (require.main === module) { build(); }
module.exports = {publicConfig, build};
