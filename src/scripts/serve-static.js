'use strict';

// Local preview only. Production can serve build/static with any static host.
const fs = require('fs');
const path = require('path');
const http = require('http');
const root = path.resolve(__dirname, '../../build/static');
const mime = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'};

function createStaticServer(directory = root, basePath = '') {
  return http.createServer((req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405); res.end(); return;
      }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (basePath && pathname !== basePath && !pathname.startsWith(basePath + '/')) {
        res.writeHead(404); res.end(); return;
      }
      let target = path.resolve(directory, '.' + (pathname.slice(basePath.length) || '/'));
      if (target !== directory && !target.startsWith(directory + path.sep)) {
        res.writeHead(404); res.end(); return;
      }
      if (fs.statSync(target).isDirectory()) {
        if (!pathname.endsWith('/')) {
          res.writeHead(301, {Location: pathname + '/' + new URL(req.url, 'http://localhost').search}); res.end(); return;
        }
        target = path.join(target, 'index.html');
      }
      res.writeHead(200, {'Content-Type': mime[path.extname(target)] || 'application/octet-stream'});
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(target).on('error', () => res.destroy()).pipe(res);
    } catch (_) { res.writeHead(404); res.end('Not found'); }
  });
}
if (require.main === module) {
  if (!fs.existsSync(path.join(root, 'index.html'))) { throw new Error('Run npm run build first.'); }
  const {basePath} = JSON.parse(fs.readFileSync(path.join(root, 'static-config.json')));
  const port = Number(process.env.PORT || 4999);
  createStaticServer(root, basePath).listen(port, '127.0.0.1', () => {
    console.log(`Static Spyret: http://localhost:${port}${basePath}/editor/`);
  });
}
module.exports = {createStaticServer};
