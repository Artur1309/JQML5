class Signal {
  constructor(owner, name) {
    this.owner = owner;
    this.name = name;
    this.listeners = new Set();
  }

  connect(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError(`Signal '${this.name}' expects a function listener.`);
    }
    this.listeners.add(listener);
    return () => this.disconnect(listener);
  }

  disconnect(listener) {
    this.listeners.delete(listener);
  }

  emit(...args) {
    for (const listener of [...this.listeners]) {
      listener.apply(this.owner, args);
    }
  }
}

class Binding {
  constructor(evaluator) {
    if (typeof evaluator !== 'function') {
      throw new TypeError('Binding expects an evaluator function.');
    }
    this.evaluator = evaluator;
  }

  evaluate(owner) {
    return this.evaluator.call(owner, owner);
  }

  static from(value) {
    if (value instanceof Binding) {
      return value;
    }
    if (typeof value === 'function') {
      return new Binding(value);
    }
    return null;
  }
}

class Context {
  constructor(parent = null, values = {}) {
    if (parent !== null && !(parent instanceof Context)) {
      throw new TypeError('Context parent must be another Context or null.');
    }

    this.parent = parent;
    this.values = new Map(Object.entries(values));
  }

  has(name) {
    return this.values.has(name);
  }

  get(name) {
    if (this.values.has(name)) {
      return this.values.get(name);
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    return undefined;
  }

  set(name, value) {
    this.values.set(name, value);
    return this;
  }

  lookup(name) {
    return this.get(name);
  }
}

class ComponentScope {
  constructor() {
    this._ids = new Map();
  }

  register(name, object) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new TypeError('Id name must be a non-empty string.');
    }
    this._ids.set(name, object);
  }

  unregister(name, object) {
    if (!this._ids.has(name)) {
      return;
    }
    if (object && this._ids.get(name) !== object) {
      return;
    }
    this._ids.delete(name);
  }

  lookup(name) {
    return this._ids.get(name);
  }
}

class QObject {
  constructor(parent = null) {
    this._objectId = QObject._nextObjectId += 1;
    this._signals = new Map();
    this._propertyValues = new Map();
    this._propertyDefinitions = new Map();
    this._propertyBindings = new Map();
    this._aliasDisconnectors = new Map();
    this._children = [];
    this._parent = null;
    this._context = null;
    this._componentScope = null;
    this._registeredId = null;
    this._destroying = false;

    this.defineSignal('destroyed');
    this.defineSignal('completed');

    if (parent !== null) {
      this.setParent(parent);
    }
  }

  static _bindingStack = [];
  static _nextObjectId = 0;

  static _recordPropertyRead(owner, propertyName) {
    const stack = QObject._bindingStack;
    if (!stack.length) {
      return;
    }

    const tracker = stack[stack.length - 1];
    tracker(owner, propertyName);
  }

  defineSignal(name) {
    const existing = this._signals.get(name);
    if (existing) {
      return existing;
    }

    if (Object.prototype.hasOwnProperty.call(this, name)) {
      throw new Error(`Cannot define signal '${name}'; name is already in use.`);
    }

    const signal = new Signal(this, name);
    this._signals.set(name, signal);

    Object.defineProperty(this, name, {
      value: signal,
      enumerable: false,
      writable: false,
      configurable: false,
    });

    return signal;
  }

  signal(name) {
    return this._signals.get(name) ?? this.defineSignal(name);
  }

  connect(signalName, listener) {
    return this.signal(signalName).connect(listener);
  }

  defineProperty(name, initialValue, options = {}) {
    if (this._propertyDefinitions.has(name)) {
      throw new Error(`Property '${name}' is already defined.`);
    }

    if (Object.prototype.hasOwnProperty.call(this, name)) {
      throw new Error(`Cannot define property '${name}'; name is already in use.`);
    }

    const definition = {
      readOnly: Boolean(options.readOnly),
      coerce: typeof options.coerce === 'function' ? options.coerce : (value) => value,
      onChanged: typeof options.onChanged === 'function' ? options.onChanged : null,
      alias: false,
    };

    const initialBinding = Binding.from(initialValue);
    this._propertyDefinitions.set(name, definition);
    this._propertyValues.set(
      name,
      initialBinding ? undefined : definition.coerce(initialValue),
    );
    this.defineSignal(`${name}Changed`);

    Object.defineProperty(this, name, {
      enumerable: true,
      configurable: false,
      get: () => {
        QObject._recordPropertyRead(this, name);
        return this._propertyValues.get(name);
      },
      set: (value) => {
        if (definition.readOnly) {
          throw new Error(`Property '${name}' is read-only.`);
        }
        this._assignProperty(name, value);
      },
    });

    if (initialBinding) {
      this._bindProperty(name, initialBinding);
    }
  }

  defineAlias(name, targetObject, targetProperty) {
    if (!(targetObject instanceof QObject)) {
      throw new TypeError('Alias target object must be a QObject.');
    }

    if (!targetObject._propertyDefinitions.has(targetProperty)) {
      throw new Error(`Cannot alias unknown property '${targetProperty}'.`);
    }

    if (this._propertyDefinitions.has(name)) {
      throw new Error(`Property '${name}' is already defined.`);
    }

    if (Object.prototype.hasOwnProperty.call(this, name)) {
      throw new Error(`Cannot define alias '${name}'; name is already in use.`);
    }

    const definition = {
      readOnly: false,
      coerce: (value) => value,
      onChanged: null,
      alias: true,
      targetObject,
      targetProperty,
    };

    this._propertyDefinitions.set(name, definition);
    this._propertyValues.set(name, targetObject[targetProperty]);
    this.defineSignal(`${name}Changed`);

    const emitAliasChanged = (nextValue, previousValue) => {
      this._propertyValues.set(name, nextValue);
      this.signal(`${name}Changed`).emit(nextValue, previousValue);
    };

    const disconnect = targetObject.connect(`${targetProperty}Changed`, emitAliasChanged);
    this._aliasDisconnectors.set(name, disconnect);

    Object.defineProperty(this, name, {
      enumerable: true,
      configurable: false,
      get: () => {
        QObject._recordPropertyRead(this, name);
        return targetObject[targetProperty];
      },
      set: (value) => {
        targetObject[targetProperty] = value;
      },
    });
  }

  _assignProperty(name, rawValue, options = {}) {
    const binding = Binding.from(rawValue);
    if (binding) {
      this._bindProperty(name, binding);
      return;
    }

    if (!options.skipUnbind) {
      this._unbindProperty(name);
    }

    this._setPropertyValue(name, rawValue, options);
  }

  _bindProperty(name, binding) {
    const definition = this._propertyDefinitions.get(name);
    if (!definition || definition.alias) {
      throw new Error(`Property '${name}' is not bindable.`);
    }

    let state = this._propertyBindings.get(name);
    if (!state) {
      state = {
        binding,
        dependencies: new Map(),
        evaluating: false,
      };
      this._propertyBindings.set(name, state);
    } else {
      for (const disconnect of state.dependencies.values()) {
        disconnect();
      }
      state.dependencies.clear();
      state.binding = binding;
    }

    this._evaluateBinding(name, state);
  }

  _evaluateBinding(name, state) {
    if (this._destroying || state.evaluating) {
      return;
    }

    state.evaluating = true;

    for (const disconnect of state.dependencies.values()) {
      disconnect();
    }
    state.dependencies.clear();

    const registerDependency = (owner, propertyName) => {
      const key = `${owner._objectId}:${propertyName}`;
      if (state.dependencies.has(key)) {
        return;
      }

      const disconnect = owner.connect(`${propertyName}Changed`, () => {
        this._evaluateBinding(name, state);
      });
      state.dependencies.set(key, disconnect);
    };

    QObject._bindingStack.push(registerDependency);
    try {
      const nextValue = state.binding.evaluate(this);
      this._setPropertyValue(name, nextValue, { fromBinding: true });
    } finally {
      QObject._bindingStack.pop();
      state.evaluating = false;
    }
  }

  _unbindProperty(name) {
    const state = this._propertyBindings.get(name);
    if (!state) {
      return;
    }

    for (const disconnect of state.dependencies.values()) {
      disconnect();
    }

    state.dependencies.clear();
    this._propertyBindings.delete(name);
  }

  _setPropertyValue(name, rawValue, options = {}) {
    const definition = this._propertyDefinitions.get(name);
    if (!definition) {
      throw new Error(`Property '${name}' is not defined.`);
    }

    if (definition.alias) {
      definition.targetObject[definition.targetProperty] = rawValue;
      return false;
    }

    const nextValue = definition.coerce(rawValue);
    const previousValue = this._propertyValues.get(name);
    if (Object.is(nextValue, previousValue)) {
      return false;
    }

    this._propertyValues.set(name, nextValue);
    this.signal(`${name}Changed`).emit(nextValue, previousValue);

    if (definition.onChanged) {
      definition.onChanged.call(this, nextValue, previousValue);
    }

    return true;
  }

  getProperty(name) {
    if (!this._propertyDefinitions.has(name)) {
      throw new Error(`Property '${name}' is not defined.`);
    }
    return this._propertyValues.get(name);
  }

  setProperty(name, value) {
    if (!this._propertyDefinitions.has(name)) {
      throw new Error(`Property '${name}' is not defined.`);
    }
    this[name] = value;
  }

  setContext(context) {
    if (context !== null && !(context instanceof Context)) {
      throw new TypeError('Context must be a Context instance or null.');
    }

    this._context = context;
    return this;
  }

  getContext() {
    if (this._context) {
      return this._context;
    }
    if (this._parent instanceof QObject) {
      return this._parent.getContext();
    }
    return null;
  }

  setComponentScope(scope) {
    if (scope !== null && !(scope instanceof ComponentScope)) {
      throw new TypeError('Component scope must be a ComponentScope instance or null.');
    }

    this._componentScope = scope;
    return this;
  }

  getComponentScope() {
    if (this._componentScope) {
      return this._componentScope;
    }
    if (this._parent instanceof QObject) {
      return this._parent.getComponentScope();
    }
    return null;
  }

  registerId(name, object = this) {
    let scope = this.getComponentScope();
    if (!scope) {
      scope = new ComponentScope();
      this.setComponentScope(scope);
    }

    scope.register(name, object);

    if (object instanceof QObject) {
      object.setComponentScope(scope);
      object._registeredId = name;
    }

    return object;
  }

  id(name) {
    const scope = this.getComponentScope();
    return scope ? scope.lookup(name) : undefined;
  }

  setParent(parent) {
    if (parent === this._parent) {
      return this;
    }

    if (parent !== null && !(parent instanceof QObject)) {
      throw new TypeError('QObject parent must be another QObject or null.');
    }

    if (this._parent) {
      const index = this._parent._children.indexOf(this);
      if (index >= 0) {
        this._parent._children.splice(index, 1);
      }
    }

    this._parent = parent;

    if (parent) {
      parent._children.push(this);
    }

    return this;
  }

  get parent() {
    return this._parent;
  }

  get children() {
    return [...this._children];
  }

  destroy() {
    if (this._destroying) {
      return;
    }

    this._destroying = true;

    for (const child of [...this._children]) {
      child.destroy();
    }

    for (const propertyName of [...this._propertyBindings.keys()]) {
      this._unbindProperty(propertyName);
    }

    for (const disconnect of this._aliasDisconnectors.values()) {
      disconnect();
    }
    this._aliasDisconnectors.clear();

    if (this._registeredId) {
      const scope = this.getComponentScope();
      if (scope) {
        scope.unregister(this._registeredId, this);
      }
    }

    this.setParent(null);
    this.destroyed.emit(this);

    for (const signal of this._signals.values()) {
      signal.listeners.clear();
    }
  }
}

class QtObject extends QObject {
  constructor(options = {}) {
    const {
      parent = null,
      properties = {},
      context = null,
      componentScope = null,
      id = null,
    } = options;

    super(parent);

    if (componentScope instanceof ComponentScope) {
      this.setComponentScope(componentScope);
    }

    if (context instanceof Context) {
      this.setContext(context);
    }

    for (const [name, value] of Object.entries(properties)) {
      this.defineProperty(name, value);
    }

    if (id) {
      this.registerId(id, this);
    }
  }
}

class Item extends QtObject {
  constructor(options = {}) {
    const {
      parent = null,
      parentItem = null,
      properties = {},
      anchors = null,
    } = options;

    super({ parent, properties, context: options.context, componentScope: options.componentScope, id: options.id });

    this._childItems = [];
    this._syncingParentLinks = false;
    this._anchors = null;
    this._anchorDisconnectors = [];

    this.defineProperty('x', 0);
    this.defineProperty('y', 0);
    this.defineProperty('width', 0);
    this.defineProperty('height', 0);
    this.defineProperty('implicitWidth', 0);
    this.defineProperty('implicitHeight', 0);
    this.defineProperty('visible', true);
    this.defineProperty('enabled', true);
    this.defineProperty('opacity', 1);
    this.defineProperty('z', 0);

    this.defineProperty('parentItem', null, {
      onChanged: (nextValue, previousValue) => {
        if (previousValue instanceof Item) {
          previousValue._removeChildItem(this);
        }
        if (nextValue instanceof Item) {
          nextValue._addChildItem(this);
        }

        if (this._syncingParentLinks) {
          return;
        }

        this._syncingParentLinks = true;
        try {
          QObject.prototype.setParent.call(this, nextValue instanceof Item ? nextValue : null);
        } finally {
          this._syncingParentLinks = false;
        }

        this._rewireAnchors();
        this.applyAnchors();
      },
    });

    this.connect('widthChanged', () => this.applyAnchors());
    this.connect('heightChanged', () => this.applyAnchors());

    if (parentItem instanceof Item) {
      this.parentItem = parentItem;
    } else if (parent instanceof Item) {
      this.parentItem = parent;
    }

    if (anchors) {
      this.setAnchors(anchors);
    }
  }

  setAnchors(anchors = null) {
    this._anchors = anchors ? { ...anchors } : null;
    this._rewireAnchors();
    this.applyAnchors();
    return this;
  }

  get anchors() {
    return this._anchors ? { ...this._anchors } : null;
  }

  _rewireAnchors() {
    for (const disconnect of this._anchorDisconnectors) {
      disconnect();
    }
    this._anchorDisconnectors = [];

    const anchors = this._anchors;
    if (!anchors) {
      return;
    }

    const dependencies = [
      anchors.fill,
      anchors.centerIn,
      anchors.left,
      anchors.right,
      anchors.top,
      anchors.bottom,
      this.parentItem,
    ].filter((item) => item instanceof Item);

    for (const dependency of dependencies) {
      this._anchorDisconnectors.push(dependency.connect('xChanged', () => this.applyAnchors()));
      this._anchorDisconnectors.push(dependency.connect('yChanged', () => this.applyAnchors()));
      this._anchorDisconnectors.push(dependency.connect('widthChanged', () => this.applyAnchors()));
      this._anchorDisconnectors.push(dependency.connect('heightChanged', () => this.applyAnchors()));
    }
  }

  applyAnchors() {
    const anchors = this._anchors;
    if (!anchors) {
      return;
    }

    const margins = anchors.margins ?? 0;
    const marginOf = (name) => (name in anchors ? anchors[name] : margins);
    const targetRectInParent = (target) => {
      if (!(target instanceof Item)) {
        return null;
      }

      if (!(this.parentItem instanceof Item)) {
        return { x: target.x, y: target.y, width: target.width, height: target.height };
      }

      const local = target.mapToItem(this.parentItem, 0, 0);
      return { x: local.x, y: local.y, width: target.width, height: target.height };
    };

    if (anchors.fill instanceof Item) {
      const target = targetRectInParent(anchors.fill);
      if (!target) {
        return;
      }
      const leftMargin = marginOf('leftMargin');
      const rightMargin = marginOf('rightMargin');
      const topMargin = marginOf('topMargin');
      const bottomMargin = marginOf('bottomMargin');

      this.x = target.x + leftMargin;
      this.y = target.y + topMargin;
      this.width = Math.max(0, target.width - leftMargin - rightMargin);
      this.height = Math.max(0, target.height - topMargin - bottomMargin);
      return;
    }

    if (anchors.centerIn instanceof Item) {
      const target = targetRectInParent(anchors.centerIn);
      if (!target) {
        return;
      }
      const horizontalOffset = anchors.horizontalCenterOffset ?? 0;
      const verticalOffset = anchors.verticalCenterOffset ?? 0;

      this.x = target.x + (target.width - this.width) / 2 + horizontalOffset;
      this.y = target.y + (target.height - this.height) / 2 + verticalOffset;
    }

    const leftAnchor = anchors.left;
    const rightAnchor = anchors.right;
    const topAnchor = anchors.top;
    const bottomAnchor = anchors.bottom;

    if (leftAnchor instanceof Item && rightAnchor instanceof Item) {
      const leftRect = targetRectInParent(leftAnchor);
      const rightRect = targetRectInParent(rightAnchor);
      if (!leftRect || !rightRect) {
        return;
      }
      const leftMargin = marginOf('leftMargin');
      const rightMargin = marginOf('rightMargin');
      const left = leftRect.x + leftMargin;
      const right = rightRect.x + rightRect.width - rightMargin;
      this.x = left;
      this.width = Math.max(0, right - left);
    } else if (leftAnchor instanceof Item) {
      const leftRect = targetRectInParent(leftAnchor);
      if (!leftRect) {
        return;
      }
      this.x = leftRect.x + marginOf('leftMargin');
    } else if (rightAnchor instanceof Item) {
      const rightRect = targetRectInParent(rightAnchor);
      if (!rightRect) {
        return;
      }
      this.x = rightRect.x + rightRect.width - this.width - marginOf('rightMargin');
    }

    if (topAnchor instanceof Item && bottomAnchor instanceof Item) {
      const topRect = targetRectInParent(topAnchor);
      const bottomRect = targetRectInParent(bottomAnchor);
      if (!topRect || !bottomRect) {
        return;
      }
      const topMargin = marginOf('topMargin');
      const bottomMargin = marginOf('bottomMargin');
      const top = topRect.y + topMargin;
      const bottom = bottomRect.y + bottomRect.height - bottomMargin;
      this.y = top;
      this.height = Math.max(0, bottom - top);
    } else if (topAnchor instanceof Item) {
      const topRect = targetRectInParent(topAnchor);
      if (!topRect) {
        return;
      }
      this.y = topRect.y + marginOf('topMargin');
    } else if (bottomAnchor instanceof Item) {
      const bottomRect = targetRectInParent(bottomAnchor);
      if (!bottomRect) {
        return;
      }
      this.y = bottomRect.y + bottomRect.height - this.height - marginOf('bottomMargin');
    }
  }

  _addChildItem(item) {
    if (!this._childItems.includes(item)) {
      this._childItems.push(item);
    }
  }

  _removeChildItem(item) {
    const index = this._childItems.indexOf(item);
    if (index >= 0) {
      this._childItems.splice(index, 1);
    }
  }

  get childItems() {
    return [...this._childItems];
  }

  setParent(parent) {
    this._syncingParentLinks = true;
    try {
      QObject.prototype.setParent.call(this, parent);
      if (parent instanceof Item) {
        this._setPropertyValue('parentItem', parent);
      } else {
        this._setPropertyValue('parentItem', null);
      }
    } finally {
      this._syncingParentLinks = false;
    }
    return this;
  }

  _mapToScene(x, y) {
    let current = this;
    let sceneX = x;
    let sceneY = y;

    while (current instanceof Item) {
      sceneX += current.x;
      sceneY += current.y;
      current = current.parentItem;
    }

    return { x: sceneX, y: sceneY };
  }

  mapToItem(targetItem, x = 0, y = 0) {
    const scenePoint = this._mapToScene(x, y);
    if (!(targetItem instanceof Item)) {
      return scenePoint;
    }

    const targetScenePoint = targetItem._mapToScene(0, 0);
    return {
      x: scenePoint.x - targetScenePoint.x,
      y: scenePoint.y - targetScenePoint.y,
    };
  }

  mapFromItem(sourceItem, x = 0, y = 0) {
    const sourceScenePoint = sourceItem instanceof Item ? sourceItem._mapToScene(x, y) : { x, y };
    const selfScenePoint = this._mapToScene(0, 0);
    return {
      x: sourceScenePoint.x - selfScenePoint.x,
      y: sourceScenePoint.y - selfScenePoint.y,
    };
  }

  containsPoint(sceneX, sceneY) {
    if (!this.visible) {
      return false;
    }

    const local = this.mapFromItem(null, sceneX, sceneY);
    return local.x >= 0 && local.y >= 0 && local.x <= this.width && local.y <= this.height;
  }

  _sortedChildItemsAscending() {
    return [...this._childItems]
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const zDelta = a.item.z - b.item.z;
        if (zDelta !== 0) {
          return zDelta;
        }
        return a.index - b.index;
      })
      .map(({ item }) => item);
  }

  _sortedChildItemsDescending() {
    return [...this._childItems]
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const zDelta = b.item.z - a.item.z;
        if (zDelta !== 0) {
          return zDelta;
        }
        return b.index - a.index;
      })
      .map(({ item }) => item);
  }

  hitTest(sceneX, sceneY) {
    if (!this.visible || !this.enabled) {
      return null;
    }

    for (const child of this._sortedChildItemsDescending()) {
      const hit = child.hitTest(sceneX, sceneY);
      if (hit) {
        return hit;
      }
    }

    return this.containsPoint(sceneX, sceneY) ? this : null;
  }
}

class Component {
  constructor(factory) {
    if (typeof factory !== 'function') {
      throw new TypeError('Component expects a factory function.');
    }
    this.factory = factory;
  }

  createObject(parent = null, properties = {}, context = null, componentScope = null) {
    if (parent !== null && !(parent instanceof QObject)) {
      throw new TypeError('Component parent must be a QObject or null.');
    }

    const scope = componentScope instanceof ComponentScope ? componentScope : new ComponentScope();
    const resolvedContext = context instanceof Context ? context : (parent instanceof QObject ? parent.getContext() : null);

    const instance = this.factory({
      parent,
      properties,
      context: resolvedContext,
      componentScope: scope,
      component: this,
    });

    if (!(instance instanceof QObject)) {
      throw new Error('Component factory must return a QObject instance.');
    }

    if (instance.getComponentScope() === null) {
      instance.setComponentScope(scope);
    }

    if (resolvedContext && instance.getContext() === null) {
      instance.setContext(resolvedContext);
    }

    if (parent instanceof Item && instance instanceof Item && instance.parentItem === null) {
      instance.parentItem = parent;
    }

    for (const [name, value] of Object.entries(properties)) {
      if (instance._propertyDefinitions.has(name)) {
        instance.setProperty(name, value);
      } else {
        instance.defineProperty(name, value);
      }
    }

    Component._emitCompleted(instance);
    return instance;
  }

  static _emitCompleted(root) {
    const postOrder = (node) => {
      for (const child of node.children) {
        postOrder(child);
      }

      if (typeof node.onCompleted === 'function') {
        node.onCompleted.call(node);
      }
      node.completed.emit(node);
    };

    postOrder(root);
  }
}

class Loader extends Item {
  constructor(options = {}) {
    super(options);

    this._loading = false;

    this.defineProperty('sourceComponent', null, {
      onChanged: () => this._reload(),
    });

    this.defineProperty('active', true, {
      onChanged: () => this._reload(),
    });

    this.defineProperty('item', null, {
      readOnly: true,
    });

    if ('sourceComponent' in options) {
      this.sourceComponent = options.sourceComponent;
    }

    if ('active' in options) {
      this.active = options.active;
    }

    this.connect('parentItemChanged', () => this._reload());
    this._reload();
  }

  _setItem(value) {
    const definition = this._propertyDefinitions.get('item');
    const previousReadOnly = definition.readOnly;
    definition.readOnly = false;
    try {
      this._setPropertyValue('item', value);
    } finally {
      definition.readOnly = previousReadOnly;
    }
  }

  _reload() {
    if (this._loading || this._destroying) {
      return;
    }

    this._loading = true;
    try {
      if (this.item instanceof QObject) {
        this.item.destroy();
        this._setItem(null);
      }

      if (!this.active) {
        return;
      }

      if (!(this.sourceComponent instanceof Component)) {
        return;
      }

      const loadedParent = this.parentItem instanceof Item ? this.parentItem : this;
      const instance = this.sourceComponent.createObject(
        loadedParent,
        {},
        this.getContext(),
        this.getComponentScope(),
      );
      this._setItem(instance);
    } finally {
      this._loading = false;
    }
  }

  destroy() {
    if (this.item instanceof QObject) {
      this.item.destroy();
      this._setItem(null);
    }
    super.destroy();
  }
}

class Rectangle extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('color', options.color ?? '#000000');
    this.defineProperty('borderColor', options.borderColor ?? 'transparent');
    this.defineProperty('borderWidth', options.borderWidth ?? 0);
    this.defineProperty('radius', options.radius ?? 0);
  }

  draw(context) {
    if (!context) {
      return;
    }

    const width = this.width || this.implicitWidth;
    const height = this.height || this.implicitHeight;

    if (width <= 0 || height <= 0) {
      return;
    }

    const radius = Math.max(0, Math.min(this.radius, width / 2, height / 2));

    context.beginPath();
    if (radius === 0) {
      context.rect(0, 0, width, height);
    } else {
      context.moveTo(radius, 0);
      context.lineTo(width - radius, 0);
      context.quadraticCurveTo(width, 0, width, radius);
      context.lineTo(width, height - radius);
      context.quadraticCurveTo(width, height, width - radius, height);
      context.lineTo(radius, height);
      context.quadraticCurveTo(0, height, 0, height - radius);
      context.lineTo(0, radius);
      context.quadraticCurveTo(0, 0, radius, 0);
    }
    context.closePath();

    if (this.color && this.color !== 'transparent') {
      context.fillStyle = this.color;
      context.fill();
    }

    if (this.borderWidth > 0 && this.borderColor && this.borderColor !== 'transparent') {
      context.lineWidth = this.borderWidth;
      context.strokeStyle = this.borderColor;
      context.stroke();
    }
  }
}

class MouseArea extends Item {
  constructor(options = {}) {
    super(options);

    this._pressedInside = false;

    this.defineSignal('clicked');
    this.defineSignal('pressed');
    this.defineSignal('released');
    this.defineSignal('positionChanged');
  }

  handlePointerEvent(type, event) {
    if (type === 'down') {
      this._pressedInside = true;
      this.pressed.emit(event);
      return true;
    }

    if (type === 'move') {
      this.positionChanged.emit(event);
      return this._pressedInside;
    }

    if (type === 'up') {
      const wasPressed = this._pressedInside;
      this._pressedInside = false;
      this.released.emit(event);
      if (wasPressed && this.containsPoint(event.sceneX, event.sceneY)) {
        this.clicked.emit(event);
      }
      return wasPressed;
    }

    return false;
  }
}

class CanvasRenderer {
  constructor(options = {}) {
    const {
      rootItem = null,
      canvas = null,
      context2d = null,
      autoSchedule = true,
    } = options;

    this.rootItem = rootItem;
    this.canvas = canvas;
    this.context = context2d || (canvas ? canvas.getContext('2d') : null);
    this.autoSchedule = autoSchedule;
    this._dirty = false;
    this._rafId = null;
  }

  setRootItem(rootItem) {
    this.rootItem = rootItem;
    this.markDirty();
  }

  setCanvas(canvas) {
    this.canvas = canvas;
    this.context = canvas ? canvas.getContext('2d') : null;
    this.markDirty();
  }

  markDirty() {
    if (!this.autoSchedule) {
      return;
    }

    if (this._dirty) {
      return;
    }

    this._dirty = true;

    const requestFrame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback) => setTimeout(callback, 16);

    this._rafId = requestFrame(() => {
      this._dirty = false;
      this.render();
    });
  }

  render() {
    if (!this.context || !(this.rootItem instanceof Item)) {
      return;
    }

    const width = this.canvas ? this.canvas.width : null;
    const height = this.canvas ? this.canvas.height : null;

    if (typeof width === 'number' && typeof height === 'number') {
      this.context.clearRect(0, 0, width, height);
    }

    this._drawItem(this.rootItem, 1);
  }

  _drawItem(item, inheritedOpacity) {
    if (!item.visible) {
      return;
    }

    const context = this.context;
    const opacity = inheritedOpacity * item.opacity;
    if (opacity <= 0) {
      return;
    }

    context.save();
    context.translate(item.x, item.y);

    const previousAlpha = context.globalAlpha;
    context.globalAlpha = previousAlpha * opacity;

    if (typeof item.draw === 'function') {
      item.draw(context);
    }

    for (const child of item._sortedChildItemsAscending()) {
      this._drawItem(child, opacity);
    }

    context.restore();
  }
}

class Scene {
  constructor(options = {}) {
    const {
      rootItem = null,
      canvas = null,
      renderer = null,
    } = options;

    this.rootItem = rootItem;
    this.renderer = renderer || new CanvasRenderer({ rootItem, canvas });
    this.canvas = null;
    this._pressedTarget = null;
    this._boundHandlers = null;

    if (canvas) {
      this.attachCanvas(canvas);
    }
  }

  setRootItem(rootItem) {
    this.rootItem = rootItem;
    this.renderer.setRootItem(rootItem);
  }

  attachCanvas(canvas) {
    this.detachCanvas();

    this.canvas = canvas;
    this.renderer.setCanvas(canvas);

    const toScenePoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    this._boundHandlers = {
      mousedown: (event) => {
        const point = toScenePoint(event);
        this.dispatchPointer('down', point.x, point.y, event);
      },
      mouseup: (event) => {
        const point = toScenePoint(event);
        this.dispatchPointer('up', point.x, point.y, event);
      },
      mousemove: (event) => {
        const point = toScenePoint(event);
        this.dispatchPointer('move', point.x, point.y, event);
      },
      click: (event) => {
        const point = toScenePoint(event);
        this.dispatchPointer('click', point.x, point.y, event);
      },
    };

    canvas.addEventListener('mousedown', this._boundHandlers.mousedown);
    canvas.addEventListener('mouseup', this._boundHandlers.mouseup);
    canvas.addEventListener('mousemove', this._boundHandlers.mousemove);
    canvas.addEventListener('click', this._boundHandlers.click);
  }

  detachCanvas() {
    if (!this.canvas || !this._boundHandlers) {
      this.canvas = null;
      this._boundHandlers = null;
      return;
    }

    this.canvas.removeEventListener('mousedown', this._boundHandlers.mousedown);
    this.canvas.removeEventListener('mouseup', this._boundHandlers.mouseup);
    this.canvas.removeEventListener('mousemove', this._boundHandlers.mousemove);
    this.canvas.removeEventListener('click', this._boundHandlers.click);

    this.canvas = null;
    this._boundHandlers = null;
  }

  dispatchPointer(type, sceneX, sceneY, originalEvent = null) {
    if (!(this.rootItem instanceof Item)) {
      return null;
    }

    let target = null;

    if (type === 'move' && this._pressedTarget) {
      target = this._pressedTarget;
    }

    if (!target) {
      target = this.rootItem.hitTest(sceneX, sceneY);
    }

    if (type === 'down') {
      this._pressedTarget = target;
    } else if (type === 'up') {
      if (this._pressedTarget) {
        target = this._pressedTarget;
      }
      this._pressedTarget = null;
    }

    if (!target) {
      return null;
    }

    const localPoint = target.mapFromItem(null, sceneX, sceneY);
    const event = {
      type,
      x: localPoint.x,
      y: localPoint.y,
      sceneX,
      sceneY,
      target,
      originalEvent,
      accepted: false,
    };

    let current = target;
    while (current) {
      if (typeof current.handlePointerEvent === 'function') {
        const accepted = current.handlePointerEvent(type, event);
        if (accepted) {
          event.accepted = true;
          break;
        }
      }
      current = current.parentItem;
    }

    if (event.accepted) {
      this.renderer.markDirty();
    }
    return event;
  }
}

const runtimeExports = {
  Signal,
  Binding,
  Context,
  ComponentScope,
  QObject,
  QtObject,
  Item,
  Component,
  Loader,
  CanvasRenderer,
  Scene,
  Rectangle,
  MouseArea,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = runtimeExports;
}

if (typeof globalThis !== 'undefined') {
  if (!globalThis.JQML5 || typeof globalThis.JQML5 !== 'object') {
    globalThis.JQML5 = {};
  }
  Object.assign(globalThis.JQML5, runtimeExports);
}
