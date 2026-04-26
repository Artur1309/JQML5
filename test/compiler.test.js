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

test('QML parser handles Behavior on <prop> syntax', () => {
  const ast = parseQml(`
import QtQuick 2.15
Rectangle {
  id: box
  x: 0
  color: "#ff0000"

  Behavior on x {
    NumberAnimation { duration: 200 }
  }

  Behavior on color {
    ColorAnimation { duration: 300 }
  }
}
`, 'BehaviorTest.qml');

  assert.equal(ast.rootObject.typeName, 'Rectangle');
  assert.equal(ast.rootObject.behaviors.length, 2);
  assert.equal(ast.rootObject.behaviors[0].property, 'x');
  assert.equal(ast.rootObject.behaviors[0].animation.typeName, 'NumberAnimation');
  assert.equal(ast.rootObject.behaviors[1].property, 'color');
  assert.equal(ast.rootObject.behaviors[1].animation.typeName, 'ColorAnimation');
});

test('QML parser handles states array syntax', () => {
  const ast = parseQml(`
import QtQuick 2.15
Rectangle {
  id: box
  color: "#ffffff"

  states: [
    State {
      name: "active"
      PropertyChanges { target: box; color: "#0000ff" }
    }
  ]

  transitions: [
    Transition {
      from: "*"
      to: "active"
      NumberAnimation { duration: 150 }
    }
  ]
}
`, 'StatesTest.qml');

  const statesProp = ast.rootObject.properties.find((p) => p.name === 'states');
  assert.ok(statesProp, 'states property should exist');
  assert.equal(statesProp.value.kind, 'ArrayValue');
  assert.equal(statesProp.value.items.length, 1);
  assert.equal(statesProp.value.items[0].object.typeName, 'State');

  const transitionsProp = ast.rootObject.properties.find((p) => p.name === 'transitions');
  assert.ok(transitionsProp, 'transitions property should exist');
  assert.equal(transitionsProp.value.kind, 'ArrayValue');
  assert.equal(transitionsProp.value.items[0].object.typeName, 'Transition');
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

test('Stage B: compiler handles ListModel with ListElement children', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-stageB-'));
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-stageB-dist-'));

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 400
  height: 300

  ListModel {
    id: myModel
    ListElement { name: "Alice"; age: 30 }
    ListElement { name: "Bob";   age: 25 }
    ListElement { name: "Carol"; age: 35 }
  }

  ListView {
    x: 0
    y: 0
    width: 400
    height: 300
    model: myModel
    delegate: Rectangle {
      width: 400
      height: 40
      color: "#ffffff"
    }
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  assert.equal(fs.existsSync(path.join(outdir, 'app.js')), true);

  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');
  assert.match(js, /ListModel/);
  assert.match(js, /ListView/);
  assert.match(js, /ListElement/);
});

test('Stage B: compiler handles Repeater with delegate', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-repeater-'));
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-repeater-dist-'));

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 300
  height: 200

  ListModel {
    id: items
    ListElement { label: "One" }
    ListElement { label: "Two" }
  }

  Repeater {
    model: items
    delegate: Rectangle {
      width: 100
      height: 30
      color: "#eeeeee"
    }
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');
  assert.match(js, /Repeater/);
  assert.match(js, /ListModel/);
});

test('Stage C: parser captures Keys.onPressed as a property assignment', () => {
  const ast = parseQml(`
import QtQuick 2.15
Item {
  id: root
  width: 200
  height: 200
  activeFocusOnTab: true
  Keys.onPressed: {
    console.log(event.key)
  }
  Keys.onReleased: {
    console.log("released")
  }
}
`, 'KeysTest.qml');

  assert.equal(ast.rootObject.typeName, 'Item');
  const onPressed = ast.rootObject.properties.find((p) => p.name === 'Keys.onPressed');
  const onReleased = ast.rootObject.properties.find((p) => p.name === 'Keys.onReleased');
  assert.ok(onPressed, 'Keys.onPressed should be captured as a property');
  assert.ok(onReleased, 'Keys.onReleased should be captured as a property');
  assert.equal(onPressed.value.kind, 'JsBlockValue');
  assert.equal(onReleased.value.kind, 'JsBlockValue');
});

test('Stage C: compiler handles Keys.onPressed in QML bundle', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-keys-'));
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-keys-dist-'));

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 300
  height: 200
  activeFocusOnTab: true

  Keys.onPressed: {
    console.log(event.key)
  }

  TapHandler {
    id: tap
    width: 300
    height: 200
    onTapped: {
      root.forceActiveFocus()
    }
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');
  assert.match(js, /Keys\.onPressed|keys\[/);
  assert.match(js, /TapHandler/);
});

test('Stage C: compiler handles DragHandler in QML bundle', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-drag-'));
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-drag-dist-'));

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 400
  height: 400

  Rectangle {
    id: box
    x: 50
    y: 50
    width: 100
    height: 100
    color: "#4488ff"

    DragHandler {
      id: drag
      width: 100
      height: 100
    }
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');
  assert.match(js, /DragHandler/);
});

// ---------------------------------------------------------------------------
// Stage E: Rendering improvements – compiler support
// ---------------------------------------------------------------------------

test('Stage E: compiler handles Image type in QML', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-stage-e-image-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 400
  height: 300

  Image {
    id: logo
    x: 20
    y: 20
    width: 100
    height: 80
    source: "assets/logo.png"
    fillMode: "PreserveAspectFit"
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');
  assert.match(js, /Image/);
  assert.match(js, /logo\.png/);
});

test('Stage E: compiler handles clip, scale, rotation, transformOrigin properties', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-stage-e-transforms-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 400
  height: 400

  Rectangle {
    id: box
    x: 100
    y: 100
    width: 120
    height: 120
    color: "#ff4444"
    clip: true
    scale: 1.5
    rotation: 45
    transformOrigin: "Center"
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');
  assert.match(js, /clip/);
  assert.match(js, /scale/);
  assert.match(js, /rotation/);
  assert.match(js, /transformOrigin/);
});

test('Stage E: compiler handles layer.enabled property', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-stage-e-layer-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 300
  height: 300

  Rectangle {
    id: cachedGroup
    x: 50
    y: 50
    width: 200
    height: 200
    color: "#112233"
    layer.enabled: true

    Rectangle {
      x: 20; y: 20
      width: 60; height: 60
      color: "#ff0000"
    }
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');
  assert.match(js, /layer/);
  assert.match(js, /enabled/);
});
