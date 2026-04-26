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
- **Stage C: Input / Focus / Keys / Pointer handlers**
  - Focus system: `focus`, `activeFocus`, `focusScope`, `focusable`, `activeFocusOnTab` on `Item`
  - `Scene.forceActiveFocus(item)`, `Scene.clearFocus()`, `Scene.focusNext()`, `Scene.focusPrevious()`
  - `Scene.activeFocusItem` – the currently focused item
  - Keyboard dispatch: `keydown`/`keyup` DOM events on canvas routed to `activeFocusItem` with bubbling
  - `Keys` attached property: `Keys.onPressed` / `Keys.onReleased` handlers per item
  - `TapHandler` – pointer handler that emits `tapped` signal
  - `DragHandler` – pointer handler with pointer grabbing; `active`, `translation`, `dragTarget` properties

## Stage C: Input / Focus / Keys

### Focus system

```js
// Item properties
item.focus = true;          // request focus within scope
item.activeFocus;           // read-only: whether item has active focus
item.focusable = true;      // explicitly focusable (via forceActiveFocus)
item.activeFocusOnTab = true; // included in Tab traversal
item.focusScope = true;     // marks a focus boundary

// Scene focus API
scene.activeFocusItem;                  // currently focused Item or null
scene.forceActiveFocus(item);           // give active focus to item
scene.clearFocus();                     // remove active focus
scene.focusNext();                      // Tab – move focus to next item
scene.focusPrevious();                  // Shift+Tab – move focus to previous item
```

### Keyboard events

Tab/Shift+Tab are handled automatically by the Scene. For all other keys, set handlers on `item.keys`:

```js
item.keys.onPressed = (event) => {
  console.log(event.key, event.code);
  console.log(event.ctrl, event.alt, event.shift, event.meta);
  if (event.key === 'Escape') event.accepted = true;
};
item.keys.onReleased = (event) => { /* ... */ };
item.keys.enabled = false; // disable handler without removing it
```

The event object has: `key`, `code`, `text`, `ctrlKey`/`ctrl`, `altKey`/`alt`, `shiftKey`/`shift`, `metaKey`/`meta`, `accepted`.  
Set `event.accepted = true` to stop bubbling to parent items.

### QML syntax for Keys

```qml
Item {
  activeFocusOnTab: true

  Keys.onPressed: {
    if (event.key === "Escape") {
      event.accepted = true
    }
  }

  Keys.onReleased: {
    console.log("released:", event.key)
  }
}
```

### TapHandler

```js
const tap = new TapHandler({ parentItem: container });
tap.width = 100; tap.height = 100;
tap.tapped.connect((event) => console.log('tapped!'));
```

QML:
```qml
TapHandler {
  width: 200; height: 200
  onTapped: { console.log("tapped") }
}
```

### DragHandler

```js
const drag = new DragHandler({ parentItem: box });
drag.width = box.width; drag.height = box.height;
// drag moves box.parentItem by default; set drag.dragTarget to override
drag.activeChanged.connect((active) => console.log('drag active:', active));
```

QML:
```qml
Rectangle {
  id: box
  x: 50; y: 50; width: 120; height: 80

  DragHandler {
    id: drag
    width: 120; height: 80
  }
}
```

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
- **Stage C additions**
  - `activeFocusOnTab`, `focusable`, `focusScope` properties on Item
  - `Keys.onPressed: { ... }` / `Keys.onReleased: { ... }` – attached property handlers
  - `TapHandler { onTapped: { ... } }` – tap gesture handler
  - `DragHandler { id: drag }` – drag gesture handler with pointer grabbing
  - Tab/Shift+Tab navigation handled automatically by Scene (canvas must have `tabindex="0"`)

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

A Stage C input/focus/keys demo is under `examples/input-demo/`. Build it with:

```bash
node ./tools/jqmlc/index.js ./examples/input-demo/Main.qml --outdir dist-input
```

> The demo canvas needs `tabindex="0"` in the HTML so the canvas can receive keyboard events.

Optional local development server with rebuild:

```bash
npm run dev:example
```

## Tests

```bash
npm test
```

