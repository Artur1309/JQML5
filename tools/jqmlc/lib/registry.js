class TypeRegistry {
  constructor() {
    this.types = new Map();
  }

  registerType(name, descriptor) {
    this.types.set(name, { name, ...descriptor });
  }

  has(name) {
    return this.types.has(name);
  }

  get(name) {
    return this.types.get(name);
  }

  entries() {
    return [...this.types.entries()];
  }
}

class ModuleMapperRegistry {
  constructor(typeRegistry) {
    this.typeRegistry = typeRegistry;
    this.mappers = new Map();
  }

  registerModule(name, mapper) {
    this.mappers.set(name, mapper);
  }

  resolveModule(moduleName) {
    return this.mappers.get(moduleName) ?? null;
  }
}

const RUNTIME_TYPES = [
  ['Signal', { kind: 'runtime', runtimeExport: 'Signal', category: 'core' }],
  ['Binding', { kind: 'runtime', runtimeExport: 'Binding', category: 'core' }],
  ['Context', { kind: 'runtime', runtimeExport: 'Context', category: 'core' }],
  ['ComponentScope', { kind: 'runtime', runtimeExport: 'ComponentScope', category: 'core' }],
  ['QObject', { kind: 'runtime', runtimeExport: 'QObject', category: 'core' }],
  ['QtObject', { kind: 'runtime', runtimeExport: 'QtObject', category: 'qml' }],
  ['Item', { kind: 'runtime', runtimeExport: 'Item', category: 'quick', isItem: true }],
  ['Component', { kind: 'runtime-component', runtimeExport: 'Component', category: 'qml' }],
  ['Loader', { kind: 'runtime', runtimeExport: 'Loader', category: 'quick', isItem: true }],
  ['CanvasRenderer', { kind: 'runtime', runtimeExport: 'CanvasRenderer', category: 'quick' }],
  ['Scene', { kind: 'runtime', runtimeExport: 'Scene', category: 'quick' }],
  ['Rectangle', { kind: 'runtime', runtimeExport: 'Rectangle', category: 'quick', isItem: true }],
  ['MouseArea', { kind: 'runtime', runtimeExport: 'MouseArea', category: 'quick', isItem: true }],
  // Stage A: animations
  ['Animation', { kind: 'runtime', runtimeExport: 'Animation', category: 'quick-animation' }],
  ['NumberAnimation', { kind: 'runtime', runtimeExport: 'NumberAnimation', category: 'quick-animation' }],
  ['ColorAnimation', { kind: 'runtime', runtimeExport: 'ColorAnimation', category: 'quick-animation' }],
  ['SequentialAnimation', { kind: 'runtime', runtimeExport: 'SequentialAnimation', category: 'quick-animation' }],
  ['ParallelAnimation', { kind: 'runtime', runtimeExport: 'ParallelAnimation', category: 'quick-animation' }],
  // Stage A: states / transitions / behaviors
  ['PropertyChanges', { kind: 'runtime', runtimeExport: 'PropertyChanges', category: 'quick-states' }],
  ['State', { kind: 'runtime', runtimeExport: 'State', category: 'quick-states' }],
  ['Transition', { kind: 'runtime', runtimeExport: 'Transition', category: 'quick-states' }],
  ['Behavior', { kind: 'runtime', runtimeExport: 'Behavior', category: 'quick-states' }],
  // Stage B: text
  ['Text', { kind: 'runtime', runtimeExport: 'Text', category: 'quick', isItem: true }],
  // Stage B: models / views
  ['ListElement', { kind: 'list-element', runtimeExport: 'ListElement', category: 'quick-model' }],
  ['ListModel', { kind: 'list-model', runtimeExport: 'ListModel', category: 'quick-model' }],
  ['Repeater', { kind: 'runtime', runtimeExport: 'Repeater', category: 'quick-model', isItem: true }],
  ['ListView', { kind: 'runtime', runtimeExport: 'ListView', category: 'quick-model', isItem: true }],
  // Stage C: focus / keys / pointer handlers
  ['Keys', { kind: 'runtime', runtimeExport: 'Keys', category: 'quick-input' }],
  ['TapHandler', { kind: 'runtime', runtimeExport: 'TapHandler', category: 'quick-input', isItem: true }],
  ['DragHandler', { kind: 'runtime', runtimeExport: 'DragHandler', category: 'quick-input', isItem: true }],
  // Stage D: controls MVP
  ['Theme', { kind: 'runtime', runtimeExport: 'Theme', category: 'controls' }],
  ['Button', { kind: 'runtime', runtimeExport: 'Button', category: 'controls', isItem: true }],
  ['Label', { kind: 'runtime', runtimeExport: 'Label', category: 'controls', isItem: true }],
  ['TextField', { kind: 'runtime', runtimeExport: 'TextField', category: 'controls', isItem: true }],
  ['Slider', { kind: 'runtime', runtimeExport: 'Slider', category: 'controls', isItem: true }],
  ['CheckBox', { kind: 'runtime', runtimeExport: 'CheckBox', category: 'controls', isItem: true }],
];

function createDefaultRegistries() {
  const typeRegistry = new TypeRegistry();
  for (const [name, descriptor] of RUNTIME_TYPES) {
    typeRegistry.registerType(name, descriptor);
  }

  const modules = new ModuleMapperRegistry(typeRegistry);
  modules.registerModule('QtQuick', {
    listTypes: () => [
      'Item', 'Rectangle', 'MouseArea', 'Loader', 'CanvasRenderer', 'Scene',
      'Text',
      'Animation', 'NumberAnimation', 'ColorAnimation', 'SequentialAnimation', 'ParallelAnimation',
      'PropertyChanges', 'State', 'Transition', 'Behavior',
      'ListElement', 'ListModel', 'Repeater', 'ListView',
      'TapHandler', 'DragHandler',
    ],
  });
  modules.registerModule('QtQml', {
    listTypes: () => ['QtObject', 'Component', 'Binding', 'Context', 'ComponentScope'],
  });
  modules.registerModule('QtQuick.Controls', {
    listTypes: () => ['Button', 'Label', 'TextField', 'Slider', 'CheckBox'],
  });

  return {
    typeRegistry,
    modules,
  };
}

module.exports = {
  TypeRegistry,
  ModuleMapperRegistry,
  createDefaultRegistries,
};
