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
];

function createDefaultRegistries() {
  const typeRegistry = new TypeRegistry();
  for (const [name, descriptor] of RUNTIME_TYPES) {
    typeRegistry.registerType(name, descriptor);
  }

  const modules = new ModuleMapperRegistry(typeRegistry);
  modules.registerModule('QtQuick', {
    listTypes: () => ['Item', 'Rectangle', 'MouseArea', 'Loader', 'CanvasRenderer', 'Scene'],
  });
  modules.registerModule('QtQml', {
    listTypes: () => ['QtObject', 'Component', 'Binding', 'Context', 'ComponentScope'],
  });
  modules.registerModule('QtQuick.Controls', {
    listTypes: () => [],
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
