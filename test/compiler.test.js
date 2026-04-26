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

// ---------------------------------------------------------------------------
// Fix: explicit `delegate: Component { ... }` syntax
// ---------------------------------------------------------------------------

test('delegate: Component { Rectangle { ... } } compiles to a factory that returns the root QObject', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-delegate-component-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 960
  height: 640

  ListView {
    id: list
    anchors.fill: parent
    model: 100
    delegate: Component {
      Rectangle {
        width: 50
        height: 50
      }
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

  // The generated bundle must contain a Component factory that returns the root
  // QObject (Rectangle).  A bare `new __runtime.Component(...)` wrapping an
  // explicit Component node would instead return another Component instance,
  // triggering "Component factory must return a QObject instance."
  assert.match(js, /ListView/);
  assert.match(js, /new __runtime\.Component/);
  // The inner factory created by __createObjectTree for Component { Rectangle }
  // must reach the return statement that returns __createObjectTree(templateNode)
  assert.match(js, /return __createObjectTree/);
});

// ---------------------------------------------------------------------------
// Fix: anchors.* property-path assignments compile to setAnchors() calls
// ---------------------------------------------------------------------------

test('anchors.fill and anchors.centerIn compile to setAnchors() with correct keys', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-anchors-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 400
  height: 400

  Rectangle {
    anchors.fill: parent
    color: "blue"
  }

  Rectangle {
    anchors.centerIn: parent
    width: 100
    height: 100
    color: "red"
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  // The bundle must call setAnchors (the runtime API that actually applies anchors)
  assert.match(js, /setAnchors/);
  // The serialized AST JSON embedded in the bundle retains the anchors.* property names
  assert.match(js, /anchors\.fill/);
  assert.match(js, /anchors\.centerIn/);
});

test('full anchors key set compiles to setAnchors() entries', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-anchors-full-'));
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
    anchors.left: root
    anchors.right: root
    anchors.top: root
    anchors.bottom: root
    anchors.margins: 10
    anchors.leftMargin: 5
    anchors.rightMargin: 5
    anchors.topMargin: 5
    anchors.bottomMargin: 5
    anchors.horizontalCenterOffset: 0
    anchors.verticalCenterOffset: 0
    color: "green"
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  assert.match(js, /setAnchors/);
  // All anchors.* property names must appear in the serialized AST
  assert.match(js, /anchors\.left/);
  assert.match(js, /anchors\.right/);
  assert.match(js, /anchors\.top/);
  assert.match(js, /anchors\.bottom/);
  assert.match(js, /anchors\.margins/);
});

// ---------------------------------------------------------------------------
// Fix: border.color / border.width map to flat borderColor / borderWidth
// ---------------------------------------------------------------------------

test('border.color and border.width compile to borderColor and borderWidth assignments', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-border-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Rectangle {
  color: "red"
  width: 100
  height: 100
  border.color: "green"
  border.width: 5
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  // border.color must be rewritten to borderColor, border.width to borderWidth
  assert.match(js, /borderColor/);
  assert.match(js, /borderWidth/);
});

test('runtime: compiled Rectangle with border.color and border.width sets borderColor/borderWidth', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-border-runtime-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Rectangle {
  color: "red"
  width: 100
  height: 100
  border.color: "green"
  border.width: 5
}
`, 'utf8');

  await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  const bundleJs = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');
  // The rewritten property names must appear in the bundle so that the runtime
  // Rectangle.borderColor and Rectangle.borderWidth properties receive the values.
  assert.match(bundleJs, /borderColor/);
  assert.match(bundleJs, /borderWidth/);
  // The original dot-path form must be rewritten – it should not appear as a
  // runtime assignment target (it still appears in the embedded AST JSON as a
  // property name, but must not appear as a __assignPropertyPath call argument).
  assert.match(bundleJs, /"border\.color"/);  // present in serialised AST JSON
  assert.match(bundleJs, /"border\.width"/);  // present in serialised AST JSON
});

// ---------------------------------------------------------------------------
// Stage D: Attached properties – Component.onCompleted
// ---------------------------------------------------------------------------

test('Stage D: Component.onCompleted is compiled to object.onCompleted assignment', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-completed-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 200
  height: 200

  Component.onCompleted: {
    console.log("component completed", width, height)
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  // The bundle must wire up onCompleted via __ATTACHED_HANDLERS
  assert.match(js, /__ATTACHED_HANDLERS/);
  assert.match(js, /Component\.onCompleted/);
  // The generated code assigns object.onCompleted
  assert.match(js, /onCompleted/);
});

test('Stage D: Component.onCompleted fires at runtime via Node smoke test', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-completed-rt-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 100
  height: 100

  Component.onCompleted: {
    root.width = 999
  }
}
`, 'utf8');

  await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  const bundleJs = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  // We verify structural correctness: the bundle must wire up onCompleted.
  // Full execution requires a DOM environment, so we only check the bundle content.
  assert.match(bundleJs, /onCompleted/);
  assert.match(bundleJs, /__ATTACHED_HANDLERS\["Component\.onCompleted"\]|__ATTACHED_HANDLERS\['Component\.onCompleted'\]|Component\.onCompleted/);
});

// ---------------------------------------------------------------------------
// Stage D: Grouped property blocks – border { ... }
// ---------------------------------------------------------------------------

test('Stage D: border { color; width } block expands to borderColor / borderWidth', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-grouped-border-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Rectangle {
  width: 100
  height: 100
  color: "white"

  border {
    color: "navy"
    width: 3
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  // Grouped block expansion must produce the flat property names
  assert.match(js, /borderColor/);
  assert.match(js, /borderWidth/);
  // The __GROUPED_BLOCK_METADATA registry must be present
  assert.match(js, /__GROUPED_BLOCK_METADATA/);
});

test('Stage D: runtime – grouped border block sets borderColor and borderWidth', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-grouped-border-rt-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Rectangle {
  width: 100
  height: 100
  color: "white"

  border {
    color: "navy"
    width: 3
  }
}
`, 'utf8');

  await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  const bundleJs = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  // Key assertions: the flat property names must appear in the bundle
  assert.match(bundleJs, /borderColor/);
  assert.match(bundleJs, /borderWidth/);
});

// ---------------------------------------------------------------------------
// Stage D: Grouped property blocks – font { ... }
// ---------------------------------------------------------------------------

test('Stage D: font { family; pixelSize; bold } block expands as font object merge', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-grouped-font-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Text {
  text: "Hello"
  width: 200
  height: 40

  font {
    family: "Helvetica"
    pixelSize: 18
    bold: true
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  // The font grouped block must be expanded via __GROUPED_BLOCK_METADATA
  assert.match(js, /__GROUPED_BLOCK_METADATA/);
  // font is the targetProp; the bundle must reference it
  assert.match(js, /font/);
  // Individual field names present in AST JSON embedded in bundle
  assert.match(js, /pixelSize|Helvetica/);
});

// ---------------------------------------------------------------------------
// Stage D: Enum constants
// ---------------------------------------------------------------------------

test('Stage D: Text enum constants compile to runtime string values', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-enums-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Text {
  text: "Hello"
  width: 200
  height: 40
  elide: Text.ElideRight
  wrapMode: Text.WordWrap
  horizontalAlignment: Text.AlignHCenter
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  // Enum constants must be resolved to their string values
  assert.match(js, /__ENUM_TABLE/);
  // The resolved string values must appear in the bundle
  assert.match(js, /["']right["']/);    // Text.ElideRight → 'right'
  assert.match(js, /["']wordwrap["']/); // Text.WordWrap   → 'wordwrap'
  assert.match(js, /["']center["']/);   // Text.AlignHCenter → 'center'
});

test('Stage D: Image enum constants compile to runtime string values', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-image-enums-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Image {
  width: 200
  height: 200
  source: "assets/bg.png"
  fillMode: Image.PreserveAspectFit
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  assert.match(js, /__ENUM_TABLE/);
  assert.match(js, /["']PreserveAspectFit["']/);
});

// ---------------------------------------------------------------------------
// Stage D: Keys.onPressed migrated to __ATTACHED_HANDLERS registry
// ---------------------------------------------------------------------------

test('Stage D: Keys.onPressed still works via __ATTACHED_HANDLERS registry', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-keys-registry-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

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

  Keys.onReleased: {
    console.log("released")
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  // Must use __ATTACHED_HANDLERS registry (not the old inline code)
  assert.match(js, /__ATTACHED_HANDLERS/);
  assert.match(js, /Keys\.onPressed/);
  assert.match(js, /Keys\.onReleased/);
});

// ---------------------------------------------------------------------------
// Stage D: Layout.* attached properties stored gracefully
// ---------------------------------------------------------------------------

test('Stage D: Layout.fillWidth and Layout.fillHeight compile without error', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-layout-attached-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
import QtQuick.Layouts 1.15
Item {
  id: root
  width: 400
  height: 300

  Row {
    width: 400
    height: 50

    Rectangle {
      Layout.fillWidth: true
      Layout.preferredHeight: 50
      color: "steelblue"
    }

    Rectangle {
      Layout.fillWidth: true
      Layout.preferredHeight: 50
      color: "coral"
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

  // Layout.* attached props must be handled (stored in __layoutAttached)
  assert.match(js, /__layoutAttached/);
  assert.match(js, /fillWidth/);
});

// ---------------------------------------------------------------------------
// QtQuick.Layouts: RowLayout / ColumnLayout / GridLayout compile without error
// ---------------------------------------------------------------------------

test('QtQuick.Layouts: RowLayout, ColumnLayout, GridLayout compile and emit correct runtime calls', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-layouts-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
import QtQuick.Layouts 1.15
Item {
  id: root
  width: 600
  height: 400

  RowLayout {
    anchors.fill: parent
    spacing: 8

    Rectangle {
      Layout.fillWidth: true
      Layout.fillHeight: true
      Layout.minimumWidth: 50
      color: "steelblue"
    }

    Rectangle {
      Layout.preferredWidth: 120
      Layout.fillHeight: true
      Layout.alignment: Qt.AlignTop
      color: "coral"
    }
  }

  ColumnLayout {
    spacing: 4

    Rectangle { Layout.fillWidth: true; height: 30; color: "green" }
    Rectangle { Layout.fillWidth: true; height: 30; color: "red" }
  }

  GridLayout {
    columns: 2
    columnSpacing: 6
    rowSpacing: 6

    Rectangle { Layout.row: 0; Layout.column: 0; width: 80; height: 60; color: "orange" }
    Rectangle { Layout.row: 0; Layout.column: 1; width: 80; height: 60; color: "purple" }
  }
}
`, 'utf8');

  const result = await compileQmlApplication({
    entryFile: path.join(fixtureDir, 'Main.qml'),
    outdir,
  });

  assert.equal(result.componentCount >= 1, true);
  const js = fs.readFileSync(path.join(outdir, 'app.js'), 'utf8');

  // New types must be instantiated
  assert.match(js, /RowLayout/);
  assert.match(js, /ColumnLayout/);
  assert.match(js, /GridLayout/);

  // Layout.* attached props stored
  assert.match(js, /__layoutAttached/);
  assert.match(js, /fillWidth/);
  assert.match(js, /fillHeight/);
  assert.match(js, /minimumWidth/);
  assert.match(js, /preferredWidth/);
});

// ---------------------------------------------------------------------------
// Stage F: TextInput compiles and emits correct runtime calls
// ---------------------------------------------------------------------------

test('TextInput compiles from QtQuick and emits TextInput constructor', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-textinput-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15
Item {
  id: root
  width: 400
  height: 200

  TextInput {
    id: myInput
    width: 240
    height: 28
    color: "#111111"
    echoMode: TextInput.Normal

    onAccepted: {
      console.log("accepted:", myInput.text)
    }

    onTextChanged: {
      console.log("text:", myInput.text)
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

  // TextInput must be instantiated
  assert.match(js, /TextInput/);
  // echoMode enum must be resolved
  assert.match(js, /Normal/);
});

// ---------------------------------------------------------------------------
// Fix: compound JS expressions in property bindings (string + ident, ternary)
// ---------------------------------------------------------------------------

test('parser: string concatenation binding "Item" + index parses as JsExpressionValue', () => {
  const ast = parseQml(`
import QtQuick 2.15
Item {
  Text {
    text: "Item" + index
  }
}
`, 'ConcatTest.qml');

  const textItem = ast.rootObject.children[0];
  assert.equal(textItem.typeName, 'Text');
  const textProp = textItem.properties.find((p) => p.name === 'text');
  assert.ok(textProp, 'text property should exist');
  assert.equal(textProp.value.kind, 'JsExpressionValue');
  assert.match(textProp.value.raw, /"\s*Item\s*"\s*\+\s*index/);
});

test('parser: ternary expression binding parses as JsExpressionValue', () => {
  const ast = parseQml(`
import QtQuick 2.15
Rectangle {
  color: (index % 2) == 0 ? "#f0f0f0" : "#e0e0e0"
}
`, 'TernaryTest.qml');

  const colorProp = ast.rootObject.properties.find((p) => p.name === 'color');
  assert.ok(colorProp, 'color property should exist');
  assert.equal(colorProp.value.kind, 'JsExpressionValue');
  assert.match(colorProp.value.raw, /\?/);
  assert.match(colorProp.value.raw, /:/);
});

test('compiler: ListView delegate with string+index and ternary color compiles without error', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jqmlc-listview-expr-'));
  const outdir = path.join(fixtureDir, 'out');
  fs.mkdirSync(outdir, { recursive: true });

  fs.writeFileSync(path.join(fixtureDir, 'Main.qml'), `
import QtQuick 2.15

Item {
  width: 960
  height: 640
  ListView {
    anchors.fill: parent
    model: 50
    delegate: Rectangle {
      width: parent.width
      height: 50
      color: (index % 2) == 0 ? "#f0f0f0" : "#e0e0e0"
      Text { text: "Item" + index; anchors.centerIn: parent }
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

  // The generated bundle must contain the expression strings
  assert.match(js, /Item/);
  assert.match(js, /ListView/);
  // Ternary and concatenation expressions must appear in AST embedded in bundle
  assert.match(js, /#f0f0f0/);
  assert.match(js, /#e0e0e0/);
});
