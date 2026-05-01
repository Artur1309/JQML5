# JQML5

Runtime-only QML/QtQuick-like primitives for JavaScript.

## Included runtime features

- Core object model: `Signal`, `QObject`, `QtObject`, `Item`
- Reactive `Binding`
- Hierarchical `Context`
- Component id registry (`registerId`, `id`)
- Alias properties (`defineAlias`)
- `Component` + lifecycle completion (`onCompleted`, `completed` signal); destruction hook (`onDestruction`)
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
- **Stage D: Controls MVP**
  - `Theme` – global palette (`primary`, `text`, `border`, `disabled`, …) and font defaults
  - `Button` – `text`, `enabled`, `hovered`, `pressed`; signals `clicked`, `released`; keyboard activation (Enter/Space); focus ring
  - `Label` – `text`, `color`, `font`
  - `TextField` – `text`, `placeholderText`; cursor; focus-required text input from key events; emits `textChanged`
  - `Slider` – `from`, `to`, `value`, `stepSize`; drag interaction; keyboard arrows adjust value when focused
  - `CheckBox` – `text`, `checked`; click/keyboard toggles; emits `clicked`
  - All controls are focusable by default (`activeFocusOnTab: true`), auto-acquire focus on click

## Stage D: Controls MVP

### Theme

The `Theme` singleton holds the default palette and font used by all controls.

```js
const { Theme } = require('jqml5');

// Override individual palette values globally
Theme.palette.primary = '#e74c3c';
Theme.font.pixelSize = 16;
```

### Button

```js
const btn = new Button({ parentItem: root });
btn.width = 120; btn.height = 40;
btn.text = 'Click me';
btn.clicked.connect(() => console.log('clicked'));
btn.released.connect(() => console.log('released'));
```

Properties: `text`, `enabled`, `hovered` (read via poll), `pressed`  
Signals: `clicked`, `released`  
Keyboard: Enter / Space when the button has `activeFocus`

QML:
```qml
Button {
  width: 120; height: 40
  text: "Save"
  onClicked: { console.log("saved") }
}
```

### Label

```js
const lbl = new Label({ text: 'Hello', color: '#333', font: { pixelSize: 16, bold: true } });
```

Properties: `text`, `color`, `font` (`pixelSize`, `bold`, `family`)

QML:
```qml
Label {
  x: 20; y: 10
  text: "Status: " + model.status
  color: "#1a1a2e"
}
```

### TextField

```js
const tf = new TextField({ placeholderText: 'Enter name…' });
tf.width = 200; tf.height = 36;
tf.textChanged.connect((val) => console.log('text:', val));
```

Properties: `text`, `placeholderText`  
Signals: `textChanged`  
Requires `activeFocus` to accept keyboard input. Supports Backspace, Delete, ArrowLeft/Right, Home, End, and printable characters.

QML:
```qml
TextField {
  width: 240; height: 36
  placeholderText: "Type here"
  onTextChanged: { label.text = text }
}
```

### Slider

```js
const s = new Slider({ from: 0, to: 100, value: 50, stepSize: 5 });
s.width = 200; s.height = 24;
s.valueChanged.connect((v) => console.log('value:', v));
```

Properties: `from`, `to`, `value`, `stepSize`  
Drag the knob or press ArrowRight/ArrowUp (increase) and ArrowLeft/ArrowDown (decrease) when focused.

QML:
```qml
Slider {
  width: 300; height: 28
  from: 0; to: 1; value: 0.5; stepSize: 0.1
  onValueChanged: { label.text = Math.round(value * 100) + "%" }
}
```

### CheckBox

```js
const cb = new CheckBox({ text: 'Enable feature', checked: false });
cb.width = 160; cb.height = 24;
cb.clicked.connect(() => console.log('checked:', cb.checked));
```

Properties: `text`, `checked`  
Signals: `clicked` (emitted after each toggle)  
Keyboard: Space / Enter toggles when focused.

QML:
```qml
CheckBox {
  width: 180; height: 28
  text: "Auto-save"
  checked: true
  onClicked: { console.log("auto-save:", checked) }
}
```

### Supported limitations

- `Button.pressed` signal is omitted (use `pressedChanged` property change signal instead)
- `TextField` cursor positioning on click places cursor at end (precise hit-testing requires canvas measurement context)
- No text selection in `TextField` MVP
- Hover state is not cleared when the pointer leaves without pressing; it clears on the next `up` event

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

ListView {
    width: 300
    height: 400
    model: 100
    delegate: Component {
        Rectangle {
            width: 50
            height: 50
        }
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
  - `delegate: Component { Rectangle { ... } }` – explicit `Component` wrapping is also supported
  - `Repeater { model: ...; delegate: ... }` – full support
  - `ListView { model: ...; delegate: ... }` – full support
  - Delegate context exposes `index`, `model`, `modelData`, and all role names
- **Stage C additions**
  - `activeFocusOnTab`, `focusable`, `focusScope` properties on Item
  - `Keys.onPressed: { ... }` / `Keys.onReleased: { ... }` – attached property handlers
  - `TapHandler { onTapped: { ... } }` – tap gesture handler
  - `DragHandler { id: drag }` – drag gesture handler with pointer grabbing
  - Tab/Shift+Tab navigation handled automatically by Scene (canvas must have `tabindex="0"`)
- **Stage D additions**
  - `import QtQuick.Controls 2.15` resolved to `Button`, `Label`, `TextField`, `Slider`, `CheckBox`
  - `Button { text: "OK"; onClicked: … }` – full signal handler support
  - `TextField { placeholderText: "…"; onTextChanged: … }`
  - `Slider { from: 0; to: 1; value: 0.5; stepSize: 0.1; onValueChanged: … }`
  - `CheckBox { text: "Option"; checked: false; onClicked: … }`
  - `Label { text: "…"; color: "…" }`
- **PR2 additions** (layout positioners)
  - `Row { spacing: 5; … }` – horizontal positioner
  - `Column { spacing: 5; … }` – vertical positioner
  - `Flow { spacing: 5; … }` – wrapping positioner (LeftToRight / TopToBottom)
  - All positioners support `padding`, `topPadding`, `bottomPadding`, `leftPadding`, `rightPadding`, `layoutDirection`
- **QtQuick.Layouts** (`import QtQuick.Layouts 1.15`)
  - `RowLayout { spacing: 8; … }` – distributes space horizontally; children use `Layout.*` attached properties
  - `ColumnLayout { spacing: 4; … }` – distributes space vertically
  - `GridLayout { columns: 3; columnSpacing: 8; rowSpacing: 8; … }` – two-dimensional grid
  - Supported `Layout.*` attached properties on children:
    - `Layout.fillWidth: true` / `Layout.fillHeight: true` – child stretches to fill available space; remaining space is shared equally among all fill children (max/min clamped)
    - `Layout.preferredWidth: N` / `Layout.preferredHeight: N` – override implicit/explicit size as the preferred size
    - `Layout.minimumWidth: N` / `Layout.minimumHeight: N` – lower bound during fill distribution
    - `Layout.maximumWidth: N` / `Layout.maximumHeight: N` – upper bound during fill distribution
    - `Layout.alignment: Qt.AlignHCenter | Qt.AlignTop` – per-child alignment within its cell/lane; accepts `Qt.Align*` flags (bitwise) or `'AlignHCenter'` / `'AlignRight'` / `'AlignBottom'` / `'AlignVCenter'` strings
    - `Layout.margins: N` – uniform margin around child (reduces the space it occupies and offsets its position); per-side variants `Layout.leftMargin`, `Layout.rightMargin`, `Layout.topMargin`, `Layout.bottomMargin`
  - `GridLayout`-specific attached properties: `Layout.row`, `Layout.column` (explicit cell placement), `Layout.rowSpan`, `Layout.columnSpan`
  - Container properties: `padding` / `topPadding` / `bottomPadding` / `leftPadding` / `rightPadding`
  - `RowLayout` default vertical alignment is vcenter (matching Qt Quick Layouts); `ColumnLayout` default horizontal alignment is left
  - Reactivity: re-layout runs as a microtask whenever the container's width/height changes, or when children are added/removed, or when a child's `width`/`height`/`implicitWidth`/`implicitHeight`/`visible` changes
  - **Limitations**: `Layout.*` binding changes at runtime do not yet trigger a re-layout (initial value is applied); spanning items do not currently expand column/row tracks beyond single-span preferred sizes
- **QML compatibility layer (attached properties, grouped blocks, enums)**
  - **Attached properties** – registry-driven dispatch via `__ATTACHED_HANDLERS` in `tools/jqmlc/lib/codegen.js`
    - `Component.onCompleted: { … }` – handler runs after the component tree is fully created (correct `this` binding, QML id scope access); fires in post-order (children before parent), matching Qt 6 semantics
    - `Component.onDestruction: { … }` – handler fires when the object is about to be destroyed; fires in pre-order (parent before children), matching Qt 6 semantics; also fires when a `Loader` unloads its item
    - `Keys.onPressed: { … }` / `Keys.onReleased: { … }` / `Keys.onReturnPressed: { … }` / `Keys.onEscapePressed: { … }` – migrated to registry, same behaviour as before
    - `Layout.fillWidth: true` / `Layout.fillHeight: true` / `Layout.preferredWidth: N` / … – stored in `object.__layoutAttached` and acted on at runtime by `RowLayout`, `ColumnLayout`, and `GridLayout`
    - `import QtQuick.Layouts 1.15` is recognised; exports `RowLayout`, `ColumnLayout`, `GridLayout`
    - _Extend:_ add a new entry to `__ATTACHED_HANDLERS` in `codegen.js` to support further attached types (e.g. `ScrollBar.policy`, `Accessible.role`)
  - **Grouped property blocks** – `border { … }` and `font { … }` object-block syntax
    - `border { color: "navy"; width: 2 }` – expanded to `borderColor` / `borderWidth` on parent `Rectangle`
    - `font { family: "Arial"; pixelSize: 18; bold: true }` – merged into the `font` object property on `Text`
    - `border.color: "…"` / `border.width: N` dot-path form continues to work unchanged
    - `font.pixelSize: N` / `font.family: "…"` dot-path form works via `__assignPropertyPath`
    - `border` and `font` are registered as `grouped-block` pseudo-types in `tools/jqmlc/lib/registry.js`
    - _Extend:_ add new entries to `__GROUPED_BLOCK_METADATA` in `codegen.js` and register the type name in `registry.js`
  - **Enum constants** – `TypeName.Value` identifiers resolved at compile time via `__ENUM_TABLE`
    - `Text.ElideNone` / `Text.ElideLeft` / `Text.ElideRight` / `Text.ElideMiddle` → `'none'` / `'left'` / `'right'` / `'middle'`
    - `Text.NoWrap` / `Text.WordWrap` / `Text.WrapAnywhere` → `'nowrap'` / `'wordwrap'` / `'wrapanywhere'`
    - `Text.AlignLeft` / `Text.AlignRight` / `Text.AlignHCenter` / `Text.AlignJustify` → `'left'` / `'right'` / `'center'` / `'justify'`
    - `Text.AlignTop` / `Text.AlignVCenter` / `Text.AlignBottom` → `'top'` / `'vcenter'` / `'bottom'`
    - `Image.Stretch` / `Image.PreserveAspectFit` / `Image.PreserveAspectCrop` / `Image.Pad` / `Image.Tile`
    - `Qt.AlignLeft` / `Qt.AlignRight` / `Qt.AlignHCenter` / `Qt.AlignTop` / `Qt.AlignVCenter` / `Qt.AlignBottom`
    - _Extend:_ add new entries to `__ENUM_TABLE` in `codegen.js`
- **Stage F: Engine lifecycle & event-loop parity (Qt 6.x)**
  - **`Component.onCompleted`** – fires in post-order (children before parent) after the full component tree is created and all bindings have been applied. `onCompleted` therefore sees the _final_ bound property values, matching Qt 6 behaviour.
  - **`Component.onDestruction`** – fires in pre-order (parent before children) when `destroy()` is called or when a `Loader` unloads its item. The handler is invoked before any children are destroyed, giving access to a still-valid object graph.
  - **`Qt.callLater(fn, ...args)`** – defers `fn` to a microtask (after the current synchronous turn). Multiple calls with the same function reference within the same turn are coalesced into a single invocation; the last supplied args win. Matches Qt 6 `Qt.callLater` semantics. Example:
    ```js
    const refresh = () => console.log('refresh');
    // Both calls coalesce – refresh() runs exactly once after the current turn:
    Qt.callLater(refresh, 'attempt 1');
    Qt.callLater(refresh, 'attempt 2'); // overwrites args; only this fires
    ```
  - **Binding coalescing** – binding re-evaluations that are triggered _during_ an active binding evaluation are deferred and flushed after the outermost evaluation completes. This prevents re-entrancy loops when bindings form a chain (A → B → C) while keeping synchronous property reactivity intact.
- **Property-path rewrites** (anchors and border)
  - `anchors.fill: parent` / `anchors.centerIn: parent` and all edge+margin anchors compile to `setAnchors({…})` calls so the runtime applies geometry correctly.
  - Supported `anchors.*` keys: `fill`, `centerIn`, `left`, `right`, `top`, `bottom`, `margins`, `leftMargin`, `rightMargin`, `topMargin`, `bottomMargin`, `horizontalCenterOffset`, `verticalCenterOffset`.
  - `border.color: "…"` and `border.width: N` on `Rectangle` are rewritten to the flat runtime properties `borderColor` and `borderWidth`.
  - The rewrite table (`__PROP_PATH_REWRITES` in `tools/jqmlc/lib/codegen.js`) is designed to be extended with further nested-property aliases (e.g. `font.pixelSize`) without changing the main property-dispatch loop.

> ⚠️ Security note: the compiler intentionally supports arbitrary JavaScript in bindings/handlers, so compile and run only trusted QML sources.

### Extensibility points

Compiler internals are split so you can extend without rewriting the pipeline:

- **Type registry**: `tools/jqmlc/lib/registry.js`
  - Register runtime constructors in one place.
  - Register `grouped-block` pseudo-types (e.g. `border`, `font`) so the resolver skips them.
- **Module mappers**: `tools/jqmlc/lib/registry.js`
  - Map QML module imports (`QtQuick`, `QtQml`, `QtQuick.Controls`, `QtQuick.Layouts`) to exposed types.
- **Attached property handlers**: `__ATTACHED_HANDLERS` in `tools/jqmlc/lib/codegen.js`
  - Add `'TypeName.propName': function(object, valueNode, scopeState) { … }` to handle new attached properties.
- **Grouped property block handlers**: `__GROUPED_BLOCK_METADATA` in `tools/jqmlc/lib/codegen.js`
  - Add `'groupName': { rewrites: { subProp: 'flatProp' }, targetProp: null }` for flat rewrite blocks.
  - Or `'groupName': { rewrites: null, targetProp: 'objectProp' }` to merge into an existing object property.
  - Register the group name in `registry.js` with `kind: 'grouped-block'`.
- **Enum constant table**: `__ENUM_TABLE` in `tools/jqmlc/lib/codegen.js`
  - Add `'TypeName.Value': resolvedValue` to resolve QML enum identifiers at compile time.
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

A Stage D controls demo is under `examples/controls-demo/`. Build it with:

```bash
node ./tools/jqmlc/index.js ./examples/controls-demo/Main.qml --outdir dist-controls
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

