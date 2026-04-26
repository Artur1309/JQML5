# JQML5

Runtime-only QML/QtQuick-like primitives for JavaScript.

## Included runtime features

- Core object model: `Signal`, `QObject`, `QtObject`, `Item`
- Reactive `Binding`
- Hierarchical `Context`
- Component id registry (`registerId`, `id`)
- Alias properties (`defineAlias`)
- `Component` + lifecycle completion (`onCompleted`, `completed` signal)
- `Loader`
- Canvas scene runtime (`Scene`, `CanvasRenderer`)
- Visual/event primitives (`Rectangle`, `MouseArea`, `Text`)
- Minimal anchors/layout helpers (`fill`, `centerIn`, edge anchors with margins)
- **Stage A: States / Transitions / Animations**
  - `Easing` functions (Linear, InQuad, OutQuad, InOutQuad, InCubic, OutCubic, InOutCubic, InSine, OutSine, InOutSine, InExpo, OutExpo)
  - `AnimationTicker` – centralised RAF-based ticker; injectable mock for deterministic tests
  - `Animation` base class with `start()`/`stop()`, `running`, `loops`, `duration`, signals
  - `NumberAnimation` – animates a numeric property from/to with easing
  - `ColorAnimation` – interpolates CSS hex colours
  - `SequentialAnimation` / `ParallelAnimation` – composite animations
  - `PropertyChanges` – holds target + property-value pairs
  - `State` – named state with a list of `PropertyChanges`
  - `Transition` – `from`/`to` pattern with animations for state changes
  - `Behavior` – intercepts plain-value property assignments and animates to the new value
  - `Item.state` property to activate states; `Item.addState()` / `Item.addTransition()` / `Item.addBehavior()` API
- **Stage B: Models / Views**
  - `ListElement` – declarative row data holder for `ListModel`
  - `ListModel` – role-based, mutable model with full mutation API and change signals
  - `Repeater` – non-visual item that instantiates a delegate `Component` for each model row; updates dynamically on model changes
  - `ListView` – vertical scrolling list with basic virtualization (only creates delegates for visible range + cache buffer)

## Stage B: Models / Views

### ListModel

```js
const model = new ListModel({ rows: [{ name: 'Alice', age: 30 }] });

// Mutation API
model.append({ name: 'Bob', age: 25 });
model.insert(0, { name: 'Zoe', age: 22 });
model.remove(1);              // remove 1 row at index 1
model.remove(0, 2);           // remove 2 rows starting at index 0
model.move(0, 2, 1);          // move 1 row from index 0 to index 2
model.set(0, { age: 31 });    // merge-update row 0
model.setProperty(0, 'age', 32);
model.clear();

// Signals
model.rowsInserted.connect((index, count) => { /* ... */ });
model.rowsRemoved.connect((index, count) => { /* ... */ });
model.rowsMoved.connect((from, to, count) => { /* ... */ });
model.dataChanged.connect((index, roles) => { /* ... */ });
model.countChanged.connect((n) => { /* ... */ });
```

### Repeater

```js
const repeater = new Repeater({ model, delegate, parentItem: container });
// Dynamically creates/destroys Items as model changes.
// delegate receives: index, model, modelData, and all role names in its Context.
```

### ListView

```js
const listView = new ListView({ model, delegate });
listView.height = 400;         // viewport height
listView.contentY = 0;         // scroll offset
listView.cacheBuffer = 40;     // extra px above/below to keep alive
console.log(listView.contentHeight);  // total scrollable height
console.log(listView.createdCount);   // number of currently created delegates
listView.positionViewAtIndex(5);      // scroll to row 5
```

### QML syntax (via jqmlc)

```qml
ListModel {
    id: myModel
    ListElement { name: "Alice"; age: 30 }
    ListElement { name: "Bob";   age: 25 }
}

Repeater {
    model: myModel
    delegate: Rectangle {
        width: 200
        height: 30
        color: index % 2 === 0 ? "#fff" : "#eee"
    }
}

ListView {
    width: 300
    height: 400
    model: myModel
    delegate: Rectangle {
        width: 300
        height: 40
    }
}
```

## Demo

Open `/demo/index.html` in a browser.

## QML compiler/bundler (`jqmlc`)

`jqmlc` compiles a QML entry file into a browser-ready app bundle using the JQML5 runtime and `esbuild`.

### Usage

```bash
jqmlc <entry.qml> --outdir dist --import-path <path>...
```

Output:

- `dist/index.html`
- `dist/app.js` + `dist/app.js.map`
- `dist/assets/*` (copied/re-written resource paths)

### Supported subset (designed to extend)

- `import` statements:
  - module imports: `QtQuick`, `QtQml`, `QtQuick.Controls`
  - local imports: `import "./dir"`, `import "dir"`, single-file imports, and minimal `qmldir`
- Object declarations: `TypeName { ... }`
- Nested objects
- Property assignments (`name: value`, `anchors.fill: ...`)
- `id: name`
- `property <type> <name>: <value>` (minimal)
- Signal handlers (`onXxx`) with arbitrary JavaScript (`{ ... }` blocks or expressions)
- Bindings compiled to runtime `Binding` objects
- **Stage A additions**
  - `Behavior on <property> { AnimationType { ... } }` – attached behavior syntax
  - `states: [ State { ... }, ... ]` – array of State objects
  - `transitions: [ Transition { ... }, ... ]` – array of Transition objects
  - `PropertyChanges { target: id; prop: value }` children auto-wired to parent `State`
  - Animation children auto-wired to parent `Transition`, `SequentialAnimation`, `ParallelAnimation`
- **Stage B additions**
  - `ListModel { ListElement { role: value; ... } ... }` – declarative model initialization
  - `ListElement` children auto-appended to parent `ListModel`
  - `delegate: Rectangle { ... }` – implicit `Component` wrapping for delegate properties
  - `Repeater { model: ...; delegate: ... }` – full support
  - `ListView { model: ...; delegate: ... }` – full support
  - Delegate context exposes `index`, `model`, `modelData`, and all role names

> ⚠️ Security note: the compiler intentionally supports arbitrary JavaScript in bindings/handlers, so compile and run only trusted QML sources.

### Extensibility points

Compiler internals are split so you can extend without rewriting the pipeline:

- **Type registry**: `tools/jqmlc/lib/registry.js`
  - Register runtime constructors in one place.
- **Module mappers**: `tools/jqmlc/lib/registry.js`
  - Map QML module imports (`QtQuick`, `QtQml`, `QtQuick.Controls`) to exposed types.
- **Asset rules**: `tools/jqmlc/lib/assets.js`
  - Default rule copies string literals from `source`, `*Source`, and `*url*` property names.

### Example

```bash
npm run build:example
```

The example source is under `examples/qml-app/`.

A dedicated Stage A demo is under `examples/states-demo/`. Build it with:

```bash
node ./tools/jqmlc/index.js ./examples/states-demo/Main.qml --outdir dist-states
```

A Stage B list-view demo is under `examples/listview-demo/`. Build it with:

```bash
node ./tools/jqmlc/index.js ./examples/listview-demo/Main.qml --outdir dist-listview
```

Optional local development server with rebuild:

```bash
npm run dev:example
```

## Tests

```bash
npm test
```

