#!/usr/bin/env node
const path = require('node:path');

const { compileQmlApplication } = require('./lib/compiler');
const { CompilerError } = require('./lib/errors');

function parseArgs(argv) {
  const args = argv.slice(2);
  const importPaths = [];
  const options = {
    outdir: 'dist',
  };

  let entryFile = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!entryFile && !arg.startsWith('-')) {
      entryFile = arg;
      continue;
    }

    if (arg === '--outdir') {
      i += 1;
      options.outdir = args[i];
      continue;
    }

    if (arg === '--import-path') {
      i += 1;
      importPaths.push(args[i]);
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new CompilerError(`Unknown argument '${arg}'.`);
  }

  if (options.help || !entryFile) {
    return {
      help: true,
      entryFile,
      options,
      importPaths,
    };
  }

  return {
    help: false,
    entryFile: path.resolve(entryFile),
    options,
    importPaths,
  };
}

function printHelp() {
  process.stdout.write(
    `Usage: jqmlc <entry.qml> --outdir dist --import-path <path>...\n\n` +
    `Options:\n` +
    `  --outdir <dir>         Output directory (default: dist)\n` +
    `  --import-path <path>   Additional local import search path (repeatable)\n` +
    `  --help, -h             Show help\n`,
  );
}

async function main() {
  try {
    const parsed = parseArgs(process.argv);
    if (parsed.help) {
      printHelp();
      if (!parsed.entryFile) {
        process.exitCode = 0;
      }
      return;
    }

    const result = await compileQmlApplication({
      entryFile: parsed.entryFile,
      outdir: parsed.options.outdir,
      importPaths: parsed.importPaths,
    });

    process.stdout.write(
      `Built ${result.entryFile} -> ${result.outdir} (${result.componentCount} components)\n`,
    );
  } catch (error) {
    if (error instanceof CompilerError || (error && error.name === 'CompilerError')) {
      process.stderr.write(`jqmlc error: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }

    if (error && error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
      for (const entry of error.errors) {
        const location = entry.location
          ? `${entry.location.file || 'unknown'}:${entry.location.line}:${entry.location.column}`
          : 'unknown';
        process.stderr.write(`jqmlc error: ${location} ${entry.text}\n`);
      }
      process.exitCode = 1;
      return;
    }

    process.stderr.write(`jqmlc error: ${error && error.message ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

main();
