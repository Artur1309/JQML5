const path = require('node:path');

function generateBundleSource(componentGraph, runtimeFilePath) {
  const components = componentGraph.components.slice().sort((a, b) => a.filePath.localeCompare(b.filePath));
  const moduleIdMap = new Map();
  components.forEach((component, index) => {
    moduleIdMap.set(component.filePath, `__component_${index}`);
  });

  const entryId = moduleIdMap.get(componentGraph.entryComponent.filePath);
  const runtimeImport = normalizeImportPath(runtimeFilePath);

  let output = '';
  output += `const __runtime = require(${JSON.stringify(runtimeImport)});\n`;
  output += `${helperRuntimeCode()}\n`;

  for (const component of components) {
    output += generateComponentFactory(component, moduleIdMap);
    output += '\n';
  }

  output += `const __entryComponent = ${entryId}();\n`;
  output += `window.addEventListener('DOMContentLoaded', () => {\n`;
  output += `  const canvas = document.getElementById('app') || document.querySelector('canvas');\n`;
  output += `  const context = new __runtime.Context(null, {});\n`;
  output += `  const root = __entryComponent.createObject(null, {}, context, new __runtime.ComponentScope());\n`;
  output += `  if (canvas && root instanceof __runtime.Item) {\n`;
  output += `    if (root.width === 0) root.width = canvas.width || 800;\n`;
  output += `    if (root.height === 0) root.height = canvas.height || 600;\n`;
  output += `    const scene = new __runtime.Scene({ rootItem: root, canvas });\n`;
  output += `    scene.renderer.render();\n`;
  output += `    window.__jqmlScene = scene;\n`;
  output += `  }\n`;
  output += `  window.__jqmlRoot = root;\n`;
  output += `});\n`;

  return output;
}

function generateComponentFactory(component, moduleIdMap) {
  const moduleId = moduleIdMap.get(component.filePath);

  const typeResolution = [];
  for (const [typeName, importedPath] of component.localTypes.entries()) {
    if (moduleIdMap.has(importedPath)) {
      typeResolution.push(`      ${JSON.stringify(typeName)}: { kind: 'component', create: ${moduleIdMap.get(importedPath)} },`);
    }
  }

  for (const typeName of component.moduleTypes.values()) {
    const kind = typeName === 'Component' ? 'runtime-component' : 'runtime';
    typeResolution.push(`      ${JSON.stringify(typeName)}: { kind: '${kind}', ctor: __runtime[${JSON.stringify(typeName)}] },`);
  }

  outputTypeFallbacks(typeResolution);

  let output = '';
  output += `const ${moduleId} = (() => {\n`;
  output += `  let __cached = null;\n`;
  output += `  return () => {\n`;
  output += `    if (__cached) return __cached;\n`;
  output += `    const __resolveType = (name) => {\n`;
  output += `      const map = {\n`;
  output += typeResolution.join('\n');
  output += '\n      };\n';
  output += `      if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];\n`;
  output += `      if (__runtime[name]) return { kind: name === 'Component' ? 'runtime-component' : 'runtime', ctor: __runtime[name] };\n`;
  output += `      throw new Error('Unknown QML type: ' + name + ' in ${escapeForTemplate(component.filePath)}');\n`;
  output += `    };\n`;
  output += `    const __instantiate = (typeName, options = {}, parent = null) => {\n`;
  output += `      const resolved = __resolveType(typeName);\n`;
  output += `      if (resolved.kind === 'component') {\n`;
  output += `        const child = resolved.create().createObject(parent, {}, options.context, options.componentScope);\n`;
  output += `        return child;\n`;
  output += `      }\n`;
  output += `      if (resolved.kind === 'runtime-component') {\n`;
  output += `        throw new Error('Component type cannot be directly instantiated. Use Component { ... } form.');\n`;
  output += `      }\n`;
  output += `      const ctor = resolved.ctor || __runtime[typeName];\n`;
  output += `      if (typeof ctor !== 'function') throw new Error('Missing runtime constructor for type: ' + typeName);\n`;
  output += `      const isItemCtor = ctor === __runtime.Item || ctor.prototype instanceof __runtime.Item;\n`;
  output += `      const ctorOptions = isItemCtor ? { ...options, parent: null } : options;\n`;
  output += `      return new ctor(ctorOptions);\n`;
  output += `    };\n`;
  output += `    const __createObjectTree = (node, parent, scopeState) => {\n`;
  output += `      if (node.typeName === 'Component') {\n`;
  output += `        const templateNode = node.children[0] || null;\n`;
  output += `        const componentFactory = new __runtime.Component(({ parent: componentParent, context, componentScope }) => {\n`;
  output += `          if (!templateNode) {\n`;
  output += `            throw new Error('Component declaration requires a child object in ${escapeForTemplate(component.filePath)}');\n`;
  output += `          }\n`;
  output += `          const nestedState = __createScopeState(componentParent, context, componentScope);\n`;
  output += `          return __createObjectTree(templateNode, componentParent, nestedState);\n`;
  output += `        });\n`;
  output += `        if (node.id) { scopeState.ids[node.id] = componentFactory; }\n`;
  output += `        return componentFactory;\n`;
  output += `      }\n`;
  output += `      const options = __createObjectOptions(node, parent, scopeState);\n`;
  output += `      const object = __instantiate(node.typeName, options, parent);\n`;
  output += `      if (node.id) { scopeState.ids[node.id] = object; }\n`;
  output += `      __applyObjectDefinition(object, node, scopeState);\n`;
  output += `      return object;\n`;
  output += `    };\n`;
  output += `    const __createScopeState = (rootParent, context, componentScope) => ({\n`;
  output += `      context,\n`;
  output += `      componentScope,\n`;
  output += `      root: null,\n`;
  output += `      ids: Object.create(null),\n`;
  output += `      hostParent: rootParent,\n`;
  output += `    });\n`;
  output += `    const __createObjectOptions = (node, parent, scopeState) => ({\n`;
  output += `      parent: parent instanceof __runtime.QObject ? parent : null,\n`;
  output += `      parentItem: parent instanceof __runtime.Item ? parent : null,\n`;
  output += `      context: scopeState.context,\n`;
  output += `      componentScope: scopeState.componentScope,\n`;
  output += `      id: node.id || null,\n`;
  output += `    });\n`;
  output += `    const __applyObjectDefinition = (object, node, scopeState) => {\n`;
  output += `      if (!scopeState.root && object instanceof __runtime.QObject) scopeState.root = object;\n`;
  output += `      for (const definition of node.propertyDefinitions) {\n`;
  output += `        if (!object._propertyDefinitions.has(definition.name)) {\n`;
  output += `          __defineOrSet(object, definition.name, __compileValue(object, definition.value, scopeState, definition.name, false), true);\n`;
  output += `        }\n`;
  output += `      }\n`;
  output += `      const anchorBuffer = {};\n`;
  output += `      const deferredStateProps = [];\n`;
  output += `      const deferredTransitionProps = [];\n`;
  output += `      for (const prop of node.properties) {\n`;
  output += `        if (prop.name.startsWith('anchors.')) {\n`;
  output += `          const _av = __compileValue(object, prop.value, scopeState, prop.name, false);\n`;
  output += `          let _avResolved = _av;\n`;
  output += `          if (_av instanceof __runtime.Binding) { try { _avResolved = _av.evaluate(); } catch (_) { _avResolved = null; } }\n`;
  output += `          anchorBuffer[prop.name.slice('anchors.'.length)] = _avResolved;\n`;
  output += `          continue;\n`;
  output += `        }\n`;
  output += `        // Stage D: Attached property handler dispatch (registry-driven)\n`;
  output += `        if (__ATTACHED_HANDLERS[prop.name]) {\n`;
  output += `          __ATTACHED_HANDLERS[prop.name](object, prop.value, scopeState);\n`;
  output += `          continue;\n`;
  output += `        }\n`;
  // Layout.* attached properties not listed in the registry: store gracefully
  output += `        if (prop.name.startsWith('Layout.')) {\n`;
  output += `          const _layoutField = prop.name.slice(7);\n`;
  output += `          const _layoutVal = __compileValue(object, prop.value, scopeState, _layoutField, false);\n`;
  output += `          const _layoutResolved = _layoutVal instanceof __runtime.Binding ? (function(b){try{return b.evaluate();}catch(_){return null;}}(_layoutVal)) : _layoutVal;\n`;
  output += `          if (!object.__layoutAttached) object.__layoutAttached = Object.create(null);\n`;
  output += `          object.__layoutAttached[_layoutField] = _layoutResolved;\n`;
  output += `          continue;\n`;
  output += `        }\n`;
  output += `        // Stage A: defer states/transitions until after children so IDs are available\n`;
  output += `        if (prop.name === 'states' && prop.value && prop.value.kind === 'ArrayValue') {\n`;
  output += `          deferredStateProps.push(prop); continue;\n`;
  output += `        }\n`;
  output += `        if (prop.name === 'transitions' && prop.value && prop.value.kind === 'ArrayValue') {\n`;
  output += `          deferredTransitionProps.push(prop); continue;\n`;
  output += `        }\n`;
  output += `        const _rw = __PROP_PATH_REWRITES[prop.name];\n`;
  output += `        if (_rw !== undefined) {\n`;
  output += `          __defineOrSet(object, _rw, __compileValue(object, prop.value, scopeState, _rw, false));\n`;
  output += `          continue;\n`;
  output += `        }\n`;
  output += `        __assignPropertyPath(object, prop.name, __compileValue(object, prop.value, scopeState, prop.name, false));\n`;
  output += `      }\n`;
  output += `      if (Object.keys(anchorBuffer).length && typeof object.setAnchors === 'function') {\n`;
  output += `        object.setAnchors(anchorBuffer);\n`;
  output += `      }\n`;
  output += `      for (const handler of node.signalHandlers) {\n`;
  output += `        const signalName = handler.name[2].toLowerCase() + handler.name.slice(3);\n`;
  output += `        if (typeof object.connect === 'function') {\n`;
  output += `          object.connect(signalName, (...args) => {\n`;
  output += `            const handlerScope = __createExecutionScope(object, scopeState, object.parentItem || object.parent, args[0]);\n`;
  output += `            return __runJs(handler.value, handlerScope, object);\n`;
  output += `          });\n`;
  output += `        }\n`;
  output += `      }\n`;
  output += `      for (const childNode of node.children) {\n`;
  output += `        // Stage D: Grouped property block expansion (e.g. border { ... }, font { ... })\n`;
  output += `        const _gm = __GROUPED_BLOCK_METADATA[childNode.typeName];\n`;
  output += `        if (_gm) {\n`;
  output += `          if (_gm.rewrites) {\n`;
  output += `            for (const _gp of childNode.properties) {\n`;
  output += `              const _flat = _gm.rewrites[_gp.name] !== undefined ? _gm.rewrites[_gp.name] : _gp.name;\n`;
  output += `              __defineOrSet(object, _flat, __compileValue(object, _gp.value, scopeState, _flat, false), false);\n`;
  output += `            }\n`;
  output += `          } else if (_gm.targetProp) {\n`;
  output += `            const _existing = (object[_gm.targetProp] && typeof object[_gm.targetProp] === 'object') ? Object.assign({}, object[_gm.targetProp]) : {};\n`;
  output += `            for (const _gp of childNode.properties) {\n`;
  output += `              const _gv = __compileValue(object, _gp.value, scopeState, _gp.name, false);\n`;
  output += `              _existing[_gp.name] = (_gv instanceof __runtime.Binding) ? (function(b){try{return b.evaluate();}catch(_e){return null;}}(_gv)) : _gv;\n`;
  output += `            }\n`;
  output += `            __defineOrSet(object, _gm.targetProp, _existing, false);\n`;
  output += `          }\n`;
  output += `          continue;\n`;
  output += `        }\n`;
  output += `        const childObj = __createObjectTree(childNode, object, scopeState);\n`;
  output += `        // Stage B: wire ListElement children into parent ListModel\n`;
  output += `        if (childObj instanceof __runtime.ListElement && object instanceof __runtime.ListModel) {\n`;
  output += `          object.append(childObj._rowData());\n`;
  output += `          childObj.destroy();\n`;
  output += `          continue;\n`;
  output += `        }\n`;
  output += `        // Stage A: wire State/PropertyChanges/Transition children to parent\n`;
  output += `        if (childObj instanceof __runtime.State && typeof object.addState === 'function') {\n`;
  output += `          object.addState(childObj);\n`;
  output += `        } else if (childObj instanceof __runtime.Transition && typeof object.addTransition === 'function') {\n`;
  output += `          object.addTransition(childObj);\n`;
  output += `        } else if (childObj instanceof __runtime.PropertyChanges && object instanceof __runtime.State) {\n`;
  output += `          object.addPropertyChanges(childObj);\n`;
  output += `        } else if (childObj instanceof __runtime.Animation && object instanceof __runtime.Transition) {\n`;
  output += `          object.addAnimation(childObj);\n`;
  output += `        } else if (childObj instanceof __runtime.Animation &&\n`;
  output += `                   (object instanceof __runtime.SequentialAnimation || object instanceof __runtime.ParallelAnimation)) {\n`;
  output += `          object.addAnimation(childObj);\n`;
  output += `        }\n`;
  output += `      }\n`;
  output += `      // Stage A: apply deferred states/transitions now that all IDs are registered\n`;
  output += `      for (const prop of deferredStateProps) {\n`;
  output += `        if (typeof object.addState === 'function') {\n`;
  output += `          for (const item of prop.value.items) {\n`;
  output += `            const stateObj = __compileValue(object, item, scopeState, 'states', false);\n`;
  output += `            if (stateObj instanceof __runtime.State) object.addState(stateObj);\n`;
  output += `          }\n`;
  output += `        }\n`;
  output += `      }\n`;
  output += `      for (const prop of deferredTransitionProps) {\n`;
  output += `        if (typeof object.addTransition === 'function') {\n`;
  output += `          for (const item of prop.value.items) {\n`;
  output += `            const transObj = __compileValue(object, item, scopeState, 'transitions', false);\n`;
  output += `            if (transObj instanceof __runtime.Transition) object.addTransition(transObj);\n`;
  output += `          }\n`;
  output += `        }\n`;
  output += `      }\n`;
  output += `      // Stage A: wire Behavior on <prop> declarations\n`;
  output += `      if (node.behaviors && node.behaviors.length > 0) {\n`;
  output += `        for (const behaviorDecl of node.behaviors) {\n`;
  output += `          const animInstance = __createObjectTree(behaviorDecl.animation, object, scopeState);\n`;
  output += `          const beh = new __runtime.Behavior({ animation: animInstance });\n`;
  output += `          if (typeof object.addBehavior === 'function') {\n`;
  output += `            object.addBehavior(behaviorDecl.property, beh);\n`;
  output += `          }\n`;
  output += `        }\n`;
  output += `      }\n`;
  output += `    };\n`;
  output += `    const __compileValue = (object, valueNode, scopeState, propertyName, forBinding) => {\n`;
  output += `      if (!valueNode) return null;\n`;
  output += `      if (valueNode.kind === 'StringValue') return valueNode.value;\n`;
  output += `      if (valueNode.kind === 'NumberValue') return valueNode.value;\n`;
  output += `      if (valueNode.kind === 'BooleanValue') return valueNode.value;\n`;
  output += `      if (valueNode.kind === 'NullValue') return null;\n`;
  output += `      if (valueNode.kind === 'IdentifierValue' && valueNode.name in scopeState.ids) return scopeState.ids[valueNode.name];\n`;
  output += `      if (valueNode.kind === 'ObjectValue') {
        // Stage B: implicitly wrap delegate object values in a Component
        if (propertyName === 'delegate') {
          const templateNode = valueNode.object;
          // If the value is already an explicit Component { ... }, __createObjectTree
          // handles it correctly and returns a runtime Component directly – avoid
          // double-wrapping, which would cause the factory to return a Component
          // instance instead of a QObject (triggering "must return a QObject" error).
          if (templateNode.typeName === 'Component') {
            return __createObjectTree(templateNode, object, scopeState);
          }
          return new __runtime.Component(({ parent: componentParent, context, componentScope }) => {
            const nestedState = __createScopeState(componentParent, context, componentScope);
            return __createObjectTree(templateNode, componentParent, nestedState);
          });
        }
        return __createObjectTree(valueNode.object, object, scopeState);
      }\n`;
  output += `      if (valueNode.kind === 'JsBlockValue') return valueNode;\n`;
  output += `      // Stage A: array of objects (states: [...], transitions: [...])\n`;
  output += `      if (valueNode.kind === 'ArrayValue') {\n`;
  output += `        return valueNode.items.map(item => __compileValue(object, item, scopeState, propertyName, false));\n`;
  output += `      }\n`;
  output += `      // Stage D: enum constant resolution (e.g. Text.AlignHCenter, Image.PreserveAspectFit)\n`;
  output += `      if (valueNode.kind === 'JsExpressionValue' && Object.prototype.hasOwnProperty.call(__ENUM_TABLE, valueNode.raw)) {\n`;
  output += `        return __ENUM_TABLE[valueNode.raw];\n`;
  output += `      }\n`;
  output += `      if (valueNode.kind === 'JsExpressionValue' || valueNode.kind === 'IdentifierValue') {\n`;
  output += `        return new __runtime.Binding(() => {\n`;
  output += `          const scope = __createExecutionScope(object, scopeState, object.parentItem || object.parent, null);\n`;
  output += `          return __evaluateExpression(valueNode.raw, scope, object);\n`;
  output += `        });\n`;
  output += `      }\n`;
  output += `      return null;\n`;
  output += `    };\n`;
  output += `    const __assignPropertyPath = (object, pathName, value) => {\n`;
  output += `      const parts = pathName.split('.');\n`;
  output += `      if (parts.length === 1) {\n`;
  output += `        __defineOrSet(object, parts[0], value, false);\n`;
  output += `        return;\n`;
  output += `      }\n`;
  output += `      let target = object;\n`;
  output += `      for (let i = 0; i < parts.length - 1; i += 1) {\n`;
  output += `        const key = parts[i];\n`;
  output += `        if (target[key] == null || typeof target[key] !== 'object') {\n`;
  output += `          target[key] = {};\n`;
  output += `        }\n`;
  output += `        target = target[key];\n`;
  output += `      }\n`;
  output += `      target[parts[parts.length - 1]] = value;\n`;
  output += `    };\n`;
  output += `    const __defineOrSet = (object, name, value, forceDefine) => {\n`;
  output += `      if (object && object._propertyDefinitions && object._propertyDefinitions.has(name) && !forceDefine) {\n`;
  output += `        object[name] = value;\n`;
  output += `        return;\n`;
  output += `      }\n`;
  output += `      if (object && object._propertyDefinitions && object._propertyDefinitions.has(name) && forceDefine) {\n`;
  output += `        object[name] = value;\n`;
  output += `        return;\n`;
  output += `      }\n`;
  output += `      if (object && typeof object.defineProperty === 'function') {\n`;
  output += `        object.defineProperty(name, value);\n`;
  output += `      } else {\n`;
  output += `        object[name] = value;\n`;
  output += `      }\n`;
  output += `    };\n`;
  output += `    const __component = new __runtime.Component(({ parent, properties, context, componentScope }) => {\n`;
  output += `      const scopeState = __createScopeState(parent, context, componentScope);\n`;
  output += `      const root = __createObjectTree(${JSON.stringify(component.ast.rootObject)}, parent, scopeState);\n`;
  output += `      for (const [key, value] of Object.entries(properties || {})) {\n`;
  output += `        __assignPropertyPath(root, key, value);\n`;
  output += `      }\n`;
  output += `      return root;\n`;
  output += `    });\n`;
  output += `    __cached = __component;\n`;
  output += `    return __cached;\n`;
  output += `  };\n`;
  output += `})();\n`;

  return output;
}

function helperRuntimeCode() {
  return `
// =============================================================================
// Registry tables – extend these to add new QML compatibility support.
// =============================================================================

// 1. Property-path rewrites: QML dot-path → flat runtime property name.
//    Add entries here to support additional nested-property shorthands.
const __PROP_PATH_REWRITES = {
  'border.color': 'borderColor',
  'border.width': 'borderWidth',
};

// 2. Attached property handlers: TypeName.propName → handler function.
//    Each handler receives (object, valueNode, scopeState) and wires the
//    attached behaviour onto object.  Add new entries here to support
//    additional attached properties (e.g. ScrollBar.*, Accessible.*).
const __ATTACHED_HANDLERS = {
  // Component lifecycle
  'Component.onCompleted': function(object, valueNode, scopeState) {
    var _v = valueNode;
    object.onCompleted = function() {
      var hs = __createExecutionScope(object, scopeState, object.parentItem || object.parent, null);
      return __runJs(_v, hs, object);
    };
  },
  'Component.onDestruction': function(object, valueNode, scopeState) {
    var _v = valueNode;
    if (object && typeof object.connect === 'function') {
      object.connect('destroyed', function() {
        var hs = __createExecutionScope(object, scopeState, object.parentItem || object.parent, null);
        return __runJs(_v, hs, object);
      });
    }
  },
  // Keys input handlers
  'Keys.onPressed': function(object, valueNode, scopeState) {
    if (!(object instanceof __runtime.Item)) return;
    var _v = valueNode;
    object.keys['onPressed'] = function() {
      var _args = Array.prototype.slice.call(arguments);
      var hs = __createExecutionScope(object, scopeState, object.parentItem || object.parent, _args[0]);
      return __runJs(_v, hs, object);
    };
  },
  'Keys.onReleased': function(object, valueNode, scopeState) {
    if (!(object instanceof __runtime.Item)) return;
    var _v = valueNode;
    object.keys['onReleased'] = function() {
      var _args = Array.prototype.slice.call(arguments);
      var hs = __createExecutionScope(object, scopeState, object.parentItem || object.parent, _args[0]);
      return __runJs(_v, hs, object);
    };
  },
  'Keys.onReturnPressed': function(object, valueNode, scopeState) {
    if (!(object instanceof __runtime.Item)) return;
    var _v = valueNode;
    object.keys['onReturnPressed'] = function() {
      var _args = Array.prototype.slice.call(arguments);
      var hs = __createExecutionScope(object, scopeState, object.parentItem || object.parent, _args[0]);
      return __runJs(_v, hs, object);
    };
  },
  'Keys.onEscapePressed': function(object, valueNode, scopeState) {
    if (!(object instanceof __runtime.Item)) return;
    var _v = valueNode;
    object.keys['onEscapePressed'] = function() {
      var _args = Array.prototype.slice.call(arguments);
      var hs = __createExecutionScope(object, scopeState, object.parentItem || object.parent, _args[0]);
      return __runJs(_v, hs, object);
    };
  },
  'Keys.onBackPressed': function(object, valueNode, scopeState) {
    if (!(object instanceof __runtime.Item)) return;
    var _v = valueNode;
    object.keys['onBackPressed'] = function() {
      var _args = Array.prototype.slice.call(arguments);
      var hs = __createExecutionScope(object, scopeState, object.parentItem || object.parent, _args[0]);
      return __runJs(_v, hs, object);
    };
  },
};

// 3. Grouped property block metadata: lowercase group name → expansion rules.
//    rewrites: object mapping sub-property name → flat target property name on parent.
//    targetProp: when rewrites is null, merge sub-properties into this object property.
//    Add new entries here to support additional grouped property blocks.
const __GROUPED_BLOCK_METADATA = {
  // border { color: "red"; width: 2 } → borderColor, borderWidth on Rectangle
  'border': { rewrites: { 'color': 'borderColor', 'width': 'borderWidth' }, targetProp: null },
  // font { family: "Arial"; pixelSize: 14; bold: true } → font object merge on Text
  'font': { rewrites: null, targetProp: 'font' },
};

// 4. Enum constant table: "TypeName.Value" → resolved runtime value.
//    Add new entries here to support additional QML enum-like constants.
const __ENUM_TABLE = {
  // Text elide modes
  'Text.ElideNone':   'none',
  'Text.ElideLeft':   'left',
  'Text.ElideRight':  'right',
  'Text.ElideMiddle': 'middle',
  // Text wrap modes
  'Text.NoWrap':                       'nowrap',
  'Text.WordWrap':                     'wordwrap',
  'Text.WrapAnywhere':                 'wrapanywhere',
  'Text.WrapAtWordBoundaryOrAnywhere': 'wrapanywhere',
  // Text horizontal alignment
  'Text.AlignLeft':    'left',
  'Text.AlignRight':   'right',
  'Text.AlignHCenter': 'center',
  'Text.AlignJustify': 'justify',
  // Text vertical alignment
  'Text.AlignTop':    'top',
  'Text.AlignVCenter': 'vcenter',
  'Text.AlignBottom': 'bottom',
  // Image fill modes
  'Image.Stretch':           'Stretch',
  'Image.PreserveAspectFit': 'PreserveAspectFit',
  'Image.PreserveAspectCrop':'PreserveAspectCrop',
  'Image.Pad':               'Pad',
  'Image.Tile':              'Tile',
  // Qt alignment helpers
  'Qt.AlignLeft':    'left',
  'Qt.AlignRight':   'right',
  'Qt.AlignHCenter': 'center',
  'Qt.AlignTop':     'top',
  'Qt.AlignVCenter': 'vcenter',
  'Qt.AlignBottom':  'bottom',
};
const __exprCache = new Map();
function __compileExpression(code) {
  if (!__exprCache.has(code)) {
    __exprCache.set(code, new Function('__scope', '__self', 'with (__scope) { return (' + code + '); }'));
  }
  return __exprCache.get(code);
}
function __evaluateExpression(code, scope, self) {
  const fn = __compileExpression(code);
  return fn.call(self, scope, self);
}
function __runJs(valueNode, scope, self) {
  if (!valueNode) return undefined;
  if (valueNode.kind === 'JsBlockValue') {
    const body = valueNode.raw || '';
    const fn = new Function('__scope', '__self', 'with (__scope) { ' + body + ' }');
    return fn.call(self, scope, self);
  }
  if (valueNode.raw) {
    return __evaluateExpression(valueNode.raw, scope, self);
  }
  return undefined;
}
function __createExecutionScope(self, scopeState, parent, event) {
  const context = scopeState.context;
  const ids = scopeState.ids;
  const root = scopeState.root || self;
  return new Proxy(Object.create(null), {
    has: () => true,
    get(target, prop) {
      if (prop === Symbol.unscopables) return undefined;
      if (prop === 'this') return self;
      if (prop === 'self') return self;
      if (prop === 'parent') return parent || null;
      if (prop === 'root') return root || null;
      if (prop === 'ids') return ids;
      if (prop === 'event') return event || null;
      if (prop === 'context') return context || null;
      if (typeof prop === 'string') {
        if (Object.prototype.hasOwnProperty.call(ids, prop)) return ids[prop];
        if (self && prop in self) return self[prop];
        if (context && typeof context.lookup === 'function') {
          const lookedUp = context.lookup(prop);
          if (lookedUp !== undefined) return lookedUp;
        }
      }
      return globalThis[prop];
    },
    set(target, prop, value) {
      if (typeof prop === 'string') {
        if (self && prop in self) {
          self[prop] = value;
          return true;
        }
        if (context && typeof context.set === 'function') {
          context.set(prop, value);
          return true;
        }
      }
      target[prop] = value;
      return true;
    }
  });
}
`;
}

function normalizeImportPath(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/');
}

function outputTypeFallbacks(typeResolution) {
  if (!typeResolution.length) {
    typeResolution.push(`      __placeholderForEmptyMap: { kind: 'runtime', ctor: null },`);
  }
}

function escapeForTemplate(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

module.exports = {
  generateBundleSource,
};
