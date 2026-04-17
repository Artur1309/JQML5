const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const { createDefaultRegistries } = require('./registry');
const { resolveEntry, buildComponentGraph } = require('./resolver');
const { createDefaultAssetRules, applyAssetPipeline } = require('./assets');
const { generateBundleSource } = require('./codegen');

async function compileQmlApplication(options) {
  const {
    entryFile,
    outdir,
    importPaths = [],
    runtimeFile = path.resolve(__dirname, '../../../src/runtime.js'),
    assetRules = createDefaultAssetRules(),
  } = options;

  const resolved = resolveEntry(entryFile, importPaths);
  const registries = createDefaultRegistries();

  const graph = buildComponentGraph({
    entryFile: resolved.entryFile,
    importPaths: resolved.importPaths,
    modules: registries.modules,
    typeRegistry: registries.typeRegistry,
  });

  fs.mkdirSync(path.resolve(outdir), { recursive: true });
  applyAssetPipeline(graph, outdir, assetRules);

  const generatedSource = generateBundleSource(graph, runtimeFile);
  const generatedEntry = path.resolve(outdir, '.jqmlc-entry.cjs');
  fs.writeFileSync(generatedEntry, generatedSource, 'utf8');

  await esbuild.build({
    entryPoints: [generatedEntry],
    outfile: path.resolve(outdir, 'app.js'),
    sourcemap: true,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    logLevel: 'silent',
  });

  fs.writeFileSync(
    path.resolve(outdir, 'index.html'),
    createHtmlShell(),
    'utf8',
  );

  fs.rmSync(generatedEntry, { force: true });

  return {
    outdir: path.resolve(outdir),
    entryFile: resolved.entryFile,
    componentCount: graph.components.length,
  };
}

function createHtmlShell() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>JQML5 App</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #f2f4f8; }
      #app { display: block; width: 100%; height: 100%; max-width: 960px; max-height: 640px; margin: 0 auto; background: #fff; }
    </style>
  </head>
  <body>
    <canvas id="app" width="960" height="640"></canvas>
    <script src="./app.js"></script>
  </body>
</html>
`;
}

module.exports = {
  compileQmlApplication,
};
