#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const exampleDir = path.resolve(repoRoot, 'examples/qml-app');
const outdir = path.resolve(repoRoot, 'dist');
const entry = path.resolve(exampleDir, 'Main.qml');
const port = Number(process.env.PORT || 4173);

function build() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, 'index.js'), entry, '--outdir', outdir], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`jqmlc exited with code ${code}`));
    });
  });
}

function serveFile(filePath, res) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
  }[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  fs.createReadStream(filePath).pipe(res);
}

async function main() {
  await build();

  const server = http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.resolve(outdir, `.${urlPath}`);
    if (!filePath.startsWith(outdir)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    serveFile(filePath, res);
  });

  server.listen(port, () => {
    process.stdout.write(`Serving ${outdir} at http://localhost:${port}\n`);
  });

  fs.watch(exampleDir, { recursive: true }, async (eventType, filename) => {
    if (!filename || !filename.endsWith('.qml')) {
      return;
    }
    process.stdout.write(`Change detected: ${filename} (${eventType})\n`);
    try {
      await build();
      process.stdout.write('Rebuilt example successfully.\n');
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
    }
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
