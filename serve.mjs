#!/usr/bin/env node
// Zero-dependency Node HTTP dev/studio server for shattercraft-out/dist/.
// Maps / and /index.html -> studio.html with proper MIME types.
//
//   node serve.mjs
//   node serve.mjs --port 8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DIST} from './paths.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

const args = process.argv.slice(2);
const portArgIdx = args.indexOf('--port');
const PORT = Number(
  (portArgIdx >= 0 && args[portArgIdx + 1]) || process.env.PORT || 4173,
);
const HOST = process.env.HOST || '127.0.0.1';
const distRoot = path.resolve(DIST);

function listBuilds() {
  if (!fs.existsSync(distRoot)) return [];
  return fs
    .readdirSync(distRoot)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => {
      const st = fs.statSync(path.join(distRoot, f));
      return {file: f, name: f.replace(/\.html$/, ''), bytes: st.size};
    });
}

function fallbackHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Shattercraft Studio</title>
<style>body{font-family:system-ui,sans-serif;background:#f3f2ee;color:#16181b;padding:48px;max-width:640px;margin:0 auto}
code{background:#e4e2dc;padding:2px 6px;border-radius:3px}</style></head>
<body><h1>Shattercraft Studio</h1><p>No built pages found in <code>${distRoot}</code>.</p>
<p>Run <code>node sims/build.mjs</code> to bundle <code>studio.html</code> and all machine simulations.</p></body></html>`;
}

const server = http.createServer((req, res) => {
  const rawUrl = (req.url || '/').split('?')[0];
  let relPath = decodeURIComponent(rawUrl);

  if (relPath === '/api/builds') {
    const payload = JSON.stringify({dist: distRoot, builds: listBuilds()});
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(payload);
    return;
  }

  if (relPath === '/' || relPath === '/index.html') {
    relPath = '/studio.html';
  }

  const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  let filePath = path.join(distRoot, safePath);

  if (!filePath.startsWith(distRoot)) {
    res.writeHead(403, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // Allow extensionless routes like /v8-live -> /v8-live.html
    if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) {
      filePath += '.html';
    } else if (safePath === 'studio.html') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(fallbackHtml());
      return;
    } else {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end(`Not found: ${relPath}`);
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log(`Shattercraft Studio serving ${distRoot}`);
  console.log(`  Studio Hub : ${url} (studio.html)`);
  console.log(`  Builds     : ${listBuilds().map((b) => b.file).join(', ') || '(none yet — run npm run build)'}`);
  if (args.includes('--open')) {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(cmd, cmdArgs, {detached: true, stdio: 'ignore'}).unref();
  }
});
