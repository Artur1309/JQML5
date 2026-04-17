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

Optional local development server with rebuild:

```bash
npm run dev:example
```

## Tests

```bash
npm test
```
