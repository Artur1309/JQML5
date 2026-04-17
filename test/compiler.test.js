const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { parseQml } = require('../tools/jqmlc/lib/parser');
const { compileQmlApplication } = require('../tools/jqmlc/lib/compiler');

test('QML parser captures imports, ids, properties, children and handlers', () => {
  const ast = parseQml(`
import QtQuick 2.15
Item {
  id: root
  property int counter: 1
  width: 100
  onWidthChanged: {
    console.log(counter)
  }
  Rectangle {
    anchors.fill: root
  }
}
`, 'Inline.qml');

  assert.equal(ast.imports.length, 1);
  assert.equal(ast.rootObject.typeName, 'Item');
  assert.equal(ast.rootObject.id, 'root');
  assert.equal(ast.rootObject.propertyDefinitions[0].name, 'counter');
  assert.equal(ast.rootObject.properties.some((prop) => prop.name === 'width'), true);
  assert.equal(ast.rootObject.signalHandlers.some((handler) => handler.name === 'onWidthChanged'), true);
  assert.equal(ast.rootObject.children[0].typeName, 'Rectangle');
});

test('compiler builds browser bundle with copied assets', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-fixture-'));
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-dist-'));

  fs.mkdirSync(path.join(fixtureDir, 'components'), { recursive: true });
  fs.mkdirSync(path.join(fixtureDir, 'assets'), { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'assets', 'logo.txt'), 'asset-file', 'utf8');
  fs.writeFileSync(path.join(fixtureDir, 'components', 'Panel.qml'), `
import QtQuick 2.15
Rectangle {
  id: panel
  property string imageSource: ""
  source: imageSource
}
`, 'utf8');

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
import QtQml 2.15
import QtQuick.Controls 2.15
import "./components"
Item {
  id: root
  width: 320
  height: 200
  property int count: 0
  Panel {
    id: panel
    imageSource: "./assets/logo.txt"
  }
  Loader {
    sourceComponent: Component {
      Rectangle {
        width: 40
        height: 20
        color: count > 0 ? "#fff" : "#000"
      }
    }
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 2, true);
  assert.equal(fs.existsSync(path.join(outdir, 'index.html')), true);
  assert.equal(fs.existsSync(path.join(outdir, 'app.js')), true);
  assert.equal(fs.existsSync(path.join(outdir, 'app.js.map')), true);

  const assetsDir = path.join(outdir, 'assets');
  const assets = fs.readdirSync(assetsDir);
  assert.equal(assets.length >= 1, true);

  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');
  assert.match(js, /__jqmlRoot/);
});
