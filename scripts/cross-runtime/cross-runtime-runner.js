const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pixelmatch = require('pixelmatch');
const { PNG } = require('pngjs');
const { chromium } = require('playwright');

const { compileQmlApplication } = require('../../tools/jqmlc/lib/compiler');

const repoRoot = path.resolve(__dirname, '..', '..');
const scenarioEntryFile = path.join(repoRoot, 'test', 'cross-runtime', 'scenario', 'Main.qml');
const qtTestFile = path.join(repoRoot, 'test', 'cross-runtime', 'qt', 'tst_cross_runtime.qml');
const DEFAULT_MAX_DIFF_RATIO = 0.02;

function getArg(name, fallbackValue) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallbackValue;
  }
  return process.argv[index + 1] ?? fallbackValue;
}

function extractCrossLogs(output) {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/\[CROSS\]\s*(.*)$/);
      return match ? match[1].trim() : null;
    })
    .filter(Boolean);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw new Error(`Failed to run '${command}': ${result.error.message}`);
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status !== 0) {
    throw new Error(`Command failed (${command} ${args.join(' ')}):\n${output}`);
  }

  return output;
}

function toPlaywrightKey(char) {
  if (/^[a-z]$/i.test(char)) {
    return `Key${char.toUpperCase()}`;
  }
  return char;
}

function createStaticServer(rootDir) {
  const mimeByExtension = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.svg', 'image/svg+xml'],
    ['.map', 'application/json; charset=utf-8'],
  ]);

  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = normalizedPath === '/'
      ? path.join(rootDir, 'index.html')
      : path.join(rootDir, normalizedPath);

    if (!filePath.startsWith(rootDir)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.statusCode = error.code === 'ENOENT' ? 404 : 500;
        res.end('Not Found');
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      res.setHeader('Content-Type', mimeByExtension.get(extension) ?? 'application/octet-stream');
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
      });
    });
  });
}

function comparePngFiles(qtScreenshotPath, webScreenshotPath, maxDiffRatio, outputDir) {
  const qtPng = PNG.sync.read(fs.readFileSync(qtScreenshotPath));
  const webPng = PNG.sync.read(fs.readFileSync(webScreenshotPath));

  assert.equal(qtPng.width, webPng.width, 'Qt and web screenshots have different widths.');
  assert.equal(qtPng.height, webPng.height, 'Qt and web screenshots have different heights.');

  const diffPng = new PNG({ width: qtPng.width, height: qtPng.height });
  const diffPixels = pixelmatch(
    qtPng.data,
    webPng.data,
    diffPng.data,
    qtPng.width,
    qtPng.height,
    { threshold: 0.1 },
  );

  const diffRatio = diffPixels / (qtPng.width * qtPng.height);
  const diffImagePath = path.join(outputDir, 'visual.diff.png');
  fs.writeFileSync(diffImagePath, PNG.sync.write(diffPng));

  if (diffRatio > maxDiffRatio) {
    throw new Error(
      `Visual mismatch too large: ${(diffRatio * 100).toFixed(3)}% > ${(maxDiffRatio * 100).toFixed(3)}%. Diff: ${diffImagePath}`,
    );
  }

  return { diffRatio, diffImagePath };
}

async function runWebScenario({ distDir, screenshotPath, keys }) {
  const { server, port } = await createStaticServer(distDir);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 400, height: 300 },
    deviceScaleFactor: 1,
  });

  const logs = [];
  page.on('console', (message) => {
    logs.push(message.text());
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('canvas');
    await page.mouse.click(80, 80);
    for (const char of keys) {
      await page.keyboard.press(toPlaywrightKey(char));
    }
    await page.waitForTimeout(50);

    const finalState = await page.evaluate(() => (
      globalThis.__jqmlRoot ? globalThis.__jqmlRoot.stateText : null
    ));
    if (finalState) {
      await page.evaluate((state) => console.log(`[CROSS] final ${state}`), finalState);
    }

    await page.screenshot({ path: screenshotPath });
    return {
      logs: extractCrossLogs(logs.join('\n')),
      finalState,
    };
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

function runQtScenario({ qtBin, screenshotPath, keys }) {
  const output = runCommand(
    qtBin,
    ['-input', qtTestFile, '--', '--screenshot', screenshotPath, '--keys', keys],
    {
      env: {
        ...process.env,
        QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM || 'offscreen',
        QT_QUICK_BACKEND: process.env.QT_QUICK_BACKEND || 'software',
      },
    },
  );

  return {
    logs: extractCrossLogs(output),
    output,
  };
}

async function main() {
  const qtBin = getArg('--qt-bin', process.env.QMLTESTRUNNER_BIN || 'qmltestrunner');
  const keys = getArg('--keys', 'AB');
  const maxDiffRatio = Number(getArg('--max-diff-ratio', String(DEFAULT_MAX_DIFF_RATIO)));
  const keepArtifacts = process.argv.includes('--keep-artifacts');

  if (!Number.isFinite(maxDiffRatio) || maxDiffRatio < 0 || maxDiffRatio > 1) {
    throw new Error('--max-diff-ratio must be a number between 0 and 1.');
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqml5-cross-runtime-'));
  const webDistDir = path.join(workDir, 'web-dist');
  const qtScreenshotPath = path.join(workDir, 'qt.png');
  const webScreenshotPath = path.join(workDir, 'web.png');

  try {
    await compileQmlApplication({
      entryFile: scenarioEntryFile,
      outdir: webDistDir,
    });

    const qtResult = runQtScenario({
      qtBin,
      screenshotPath: qtScreenshotPath,
      keys,
    });

    const webResult = await runWebScenario({
      distDir: webDistDir,
      screenshotPath: webScreenshotPath,
      keys,
    });

    assert.deepEqual(
      qtResult.logs,
      webResult.logs,
      `Cross-runtime logs mismatch.\nQt: ${JSON.stringify(qtResult.logs)}\nWeb: ${JSON.stringify(webResult.logs)}`,
    );

    const visual = comparePngFiles(qtScreenshotPath, webScreenshotPath, maxDiffRatio, workDir);

    console.log('Cross-runtime test passed.');
    console.log(`Logs matched: ${qtResult.logs.length} entries.`);
    console.log(`Visual diff ratio: ${(visual.diffRatio * 100).toFixed(3)}%`);
    console.log(`Artifacts: ${workDir}`);
  } catch (error) {
    console.error('Cross-runtime test failed.');
    console.error(error.message);
    console.error(`Artifacts: ${workDir}`);
    process.exitCode = 1;
  } finally {
    if (!keepArtifacts && process.exitCode !== 1) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  main();
}
