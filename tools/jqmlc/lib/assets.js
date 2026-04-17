const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createDefaultAssetRules() {
  return [
    ({ propertyName, valueNode }) => {
      if (valueNode.kind !== 'StringValue') {
        return false;
      }
      const name = propertyName.split('.').pop() || propertyName;
      return name === 'source' || name.endsWith('Source') || name.toLowerCase().includes('url');
    },
  ];
}

function applyAssetPipeline(componentGraph, outdir, rules = createDefaultAssetRules()) {
  const assetsDir = path.resolve(outdir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const copied = new Map();

  const maybeRewriteValue = (componentFile, propertyName, valueNode) => {
    if (!rules.some((rule) => rule({ componentFile, propertyName, valueNode }))) {
      return;
    }
    if (valueNode.kind !== 'StringValue') {
      return;
    }

    const rawValue = valueNode.value;
    if (/^(https?:|data:|qrc:)/i.test(rawValue)) {
      return;
    }

    const sourcePath = path.resolve(path.dirname(componentFile), rawValue);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      return;
    }

    if (!copied.has(sourcePath)) {
      const hash = crypto.createHash('sha1').update(sourcePath).digest('hex').slice(0, 8);
      const fileName = `${hash}-${path.basename(sourcePath)}`;
      const targetPath = path.resolve(assetsDir, fileName);
      fs.copyFileSync(sourcePath, targetPath);
      copied.set(sourcePath, `./assets/${fileName}`);
    }

    valueNode.value = copied.get(sourcePath);
    valueNode.raw = JSON.stringify(valueNode.value);
  };

  for (const component of componentGraph.components) {
    walkObject(component.filePath, component.ast.rootObject, maybeRewriteValue);
  }

  return {
    copied: [...copied.entries()].map(([from, to]) => ({ from, to })),
  };
}

function walkObject(componentFile, objectNode, onValue) {
  for (const property of objectNode.properties) {
    onValue(componentFile, property.name, property.value);
    if (property.value.kind === 'ObjectValue') {
      walkObject(componentFile, property.value.object, onValue);
    }
  }
  for (const definition of objectNode.propertyDefinitions) {
    onValue(componentFile, definition.name, definition.value);
    if (definition.value && definition.value.kind === 'ObjectValue') {
      walkObject(componentFile, definition.value.object, onValue);
    }
  }
  for (const child of objectNode.children) {
    walkObject(componentFile, child, onValue);
  }
}

module.exports = {
  createDefaultAssetRules,
  applyAssetPipeline,
};
