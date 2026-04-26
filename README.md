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
- Visual/event primitives (`Rectangle`, `MouseArea`)
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

Optional local development server with rebuild:

```bash
npm run dev:example
```

## Tests

```bash
npm test
```

