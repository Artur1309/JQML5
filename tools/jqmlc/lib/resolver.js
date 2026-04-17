const fs = require('node:fs');
const path = require('node:path');
const { parseQmlFile } = require('./parser');
const { CompilerError } = require('./errors');

function isLocalImport(source) {
  return source.startsWith('.') || source.includes('/') || source.endsWith('.qml');
}

function resolveEntry(entryFile, importPaths = []) {
  const absEntry = path.resolve(entryFile);
  if (!fs.existsSync(absEntry)) {
    throw new CompilerError(`Entry file not found: ${entryFile}`);
  }
  return {
    entryFile: absEntry,
    importPaths: importPaths.map((p) => path.resolve(p)),
  };
}

function buildComponentGraph({ entryFile, importPaths, modules, typeRegistry }) {
  const components = new Map();

  const visit = (filePath) => {
    const absPath = path.resolve(filePath);
    if (components.has(absPath)) {
      return components.get(absPath);
    }

    const ast = parseQmlFile(absPath);
    const component = {
      filePath: absPath,
      typeName: path.basename(absPath, '.qml'),
      ast,
      localTypes: new Map(),
      moduleTypes: new Set(),
    };
    components.set(absPath, component);

    for (const imported of ast.imports) {
      if (isLocalImport(imported.source)) {
        const importedTypes = resolveLocalImport(absPath, imported.source, importPaths);
        for (const [name, resolvedPath] of importedTypes.entries()) {
          component.localTypes.set(name, resolvedPath);
          visit(resolvedPath);
        }
      } else {
        const mapper = modules.resolveModule(imported.source);
        if (!mapper) {
          throw new CompilerError(
            `Unsupported module import '${imported.source}'. Register a module mapper to support it.`,
            imported.location,
            absPath,
          );
        }

        for (const typeName of mapper.listTypes(imported.version)) {
          if (!typeRegistry.has(typeName)) {
            throw new CompilerError(
              `Module '${imported.source}' maps unknown runtime type '${typeName}'.`,
              imported.location,
              absPath,
            );
          }
          component.moduleTypes.add(typeName);
        }
      }
    }

    const sameDirTypes = loadDirectoryTypes(path.dirname(absPath));
    for (const [name, resolvedPath] of sameDirTypes.entries()) {
      if (resolvedPath !== absPath) {
        component.localTypes.set(name, resolvedPath);
      }
    }

    for (const child of collectTypeReferences(ast.rootObject)) {
      if (typeRegistry.has(child)) {
        continue;
      }
      if (component.localTypes.has(child)) {
        visit(component.localTypes.get(child));
        continue;
      }
      throw new CompilerError(
        `Unknown type '${child}'. Add an import or register this type in the compiler type registry.`,
        ast.rootObject.location,
        absPath,
      );
    }

    return component;
  };

  const entryComponent = visit(entryFile);
  return {
    entryComponent,
    components: [...components.values()],
  };
}

function collectTypeReferences(objectNode, out = new Set()) {
  out.add(objectNode.typeName);
  for (const child of objectNode.children) {
    collectTypeReferences(child, out);
  }
  for (const property of objectNode.properties) {
    if (property.value.kind === 'ObjectValue') {
      collectTypeReferences(property.value.object, out);
    }
  }
  for (const definition of objectNode.propertyDefinitions) {
    if (definition.value && definition.value.kind === 'ObjectValue') {
      collectTypeReferences(definition.value.object, out);
    }
  }
  return out;
}

function resolveLocalImport(fromFile, importSource, importPaths = []) {
  const basedir = path.dirname(fromFile);
  const candidates = [];

  if (importSource.startsWith('.')) {
    candidates.push(path.resolve(basedir, importSource));
  } else {
    candidates.push(path.resolve(basedir, importSource));
    for (const importPath of importPaths) {
      candidates.push(path.resolve(importPath, importSource));
    }
  }

  for (const candidate of candidates) {
    const found = resolvePathToTypeMap(candidate);
    if (found.size > 0) {
      return found;
    }
  }

  throw new CompilerError(`Unable to resolve local import '${importSource}' from '${fromFile}'.`);
}

function resolvePathToTypeMap(candidatePath) {
  const map = new Map();
  if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
    if (candidatePath.endsWith('.qml')) {
      map.set(path.basename(candidatePath, '.qml'), candidatePath);
    }
    return map;
  }

  if (fs.existsSync(`${candidatePath}.qml`) && fs.statSync(`${candidatePath}.qml`).isFile()) {
    const file = `${candidatePath}.qml`;
    map.set(path.basename(file, '.qml'), file);
    return map;
  }

  if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
    const qmldir = path.join(candidatePath, 'qmldir');
    if (fs.existsSync(qmldir) && fs.statSync(qmldir).isFile()) {
      const lines = fs.readFileSync(qmldir, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) {
          continue;
        }
        const [typeName, maybeFile] = parts;
        if (!maybeFile.endsWith('.qml')) {
          continue;
        }
        const resolved = path.resolve(candidatePath, maybeFile);
        if (fs.existsSync(resolved)) {
          map.set(typeName, resolved);
        }
      }
      if (map.size > 0) {
        return map;
      }
    }

    return loadDirectoryTypes(candidatePath);
  }

  return map;
}

function loadDirectoryTypes(dirPath) {
  const map = new Map();
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return map;
  }

  for (const name of fs.readdirSync(dirPath)) {
    if (!name.endsWith('.qml')) {
      continue;
    }
    map.set(path.basename(name, '.qml'), path.resolve(dirPath, name));
  }
  return map;
}

module.exports = {
  resolveEntry,
  buildComponentGraph,
};
