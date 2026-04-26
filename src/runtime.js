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

    // States / transitions / behaviors
    this._states = [];
    this._transitions = [];
    this._behaviors = new Map();
    this._baseValues = new Map();
    this._activeStateAnimations = [];

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

    this.defineProperty('state', '', {
      onChanged: (nextState, previousState) => {
        this._applyState(nextState, previousState);
      },
    });

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

  // -----------------------------------------------------------------------
  // States & transitions
  // -----------------------------------------------------------------------

  addState(stateObj) {
    if (stateObj instanceof State) {
      this._states.push(stateObj);
    }
  }

  addTransition(transitionObj) {
    if (transitionObj instanceof Transition) {
      this._transitions.push(transitionObj);
    }
  }

  _findStateByName(name) {
    return this._states.find((s) => s.name === name) ?? null;
  }

  _findTransition(from, to) {
    return this._transitions.find((t) => t._matches(from, to)) ?? null;
  }

  _applyState(nextStateName, previousStateName) {
    // Stop any currently running state-transition animations
    for (const anim of this._activeStateAnimations) {
      anim.stop();
    }
    this._activeStateAnimations = [];

    const nextState = this._findStateByName(nextStateName);
    const prevState = this._findStateByName(previousStateName);

    // Collect all (target, property) pairs affected by the next state
    const affected = [];
    if (nextState) {
      for (const pc of nextState.propertyChanges) {
        const target = pc.target;
        if (!target) continue;
        for (const propName of Object.keys(pc.changes)) {
          affected.push({ target, propName, toValue: pc.changes[propName] });
        }
      }
    }

    // Save base values for properties we haven't saved yet
    for (const { target, propName, toValue: _toValue } of affected) {
      if (!target || target._objectId == null) continue;
      const key = `${target._objectId}:${propName}`;
      if (!this._baseValues.has(key)) {
        this._baseValues.set(key, target[propName]);
      }
    }

    // Restore base values for the properties that were changed by the previous state
    if (prevState) {
      for (const pc of prevState.propertyChanges) {
        const target = pc.target;
        if (!target || target._objectId == null) continue;
        for (const propName of Object.keys(pc.changes)) {
          const key = `${target._objectId}:${propName}`;
          if (this._baseValues.has(key)) {
            target[propName] = this._baseValues.get(key);
          }
        }
      }
    }

    if (!nextState) return;

    // Find a matching transition
    const transition = this._findTransition(previousStateName, nextStateName);

    if (transition && transition.animations.length > 0) {
      // Run transition animations towards the target values
      for (const { target, propName, toValue } of affected) {
        const fromValue = target[propName];

        // Try to find an existing animation in the transition that matches
        // target/property, or use the first applicable one
        let anim = transition.animations.find(
          (a) =>
            (a instanceof NumberAnimation || a instanceof ColorAnimation) &&
            ((!a.target || a.target === target) && (!a.property || a.property === propName)),
        ) ?? null;

        if (anim) {
          const animClone = _cloneAnimationForProperty(anim, target, propName, fromValue, toValue);
          animClone.start();
          this._activeStateAnimations.push(animClone);
        } else {
          // No matching animation — apply instantly
          target[propName] = toValue;
        }
      }
    } else {
      // No transition: apply all PropertyChanges directly
      for (const pc of nextState.propertyChanges) {
        pc.apply();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Behaviors
  // -----------------------------------------------------------------------

  addBehavior(propertyName, behavior) {
    const existing = this._behaviors.get(propertyName);
    if (existing && existing !== behavior) {
      if (existing._animation) existing._animation.stop();
    }
    this._behaviors.set(propertyName, behavior);
  }

  removeBehavior(propertyName) {
    const behavior = this._behaviors.get(propertyName);
    if (behavior) {
      if (behavior._animation) behavior._animation.stop();
      this._behaviors.delete(propertyName);
    }
  }

  // Override _assignProperty to allow behaviors to intercept plain-value assignments
  _assignProperty(name, rawValue, options = {}) {
    const binding = Binding.from(rawValue);
    if (!binding && this._behaviors) {
      // `Behavior` may be defined later in the file but method bodies are evaluated lazily
      // eslint-disable-next-line no-use-before-define
      const behavior = this._behaviors.get(name);
      if (behavior && !behavior._animating) {
        const currentValue = this._propertyValues.get(name);
        if (!Object.is(currentValue, rawValue)) {
          behavior._startAnimation(this, name, currentValue, rawValue);
          return;
        }
      }
    }
    super._assignProperty(name, rawValue, options);
  }

  destroy() {
    for (const behavior of this._behaviors.values()) {
      if (behavior._animation) behavior._animation.stop();
    }
    this._behaviors.clear();
    for (const anim of this._activeStateAnimations) {
      anim.stop();
    }
    this._activeStateAnimations = [];
    super.destroy();
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

// ---------------------------------------------------------------------------
// Easing functions
// ---------------------------------------------------------------------------

const Easing = {
  Linear: (t) => t,
  InQuad: (t) => t * t,
  OutQuad: (t) => t * (2 - t),
  InOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  InCubic: (t) => t * t * t,
  OutCubic: (t) => { const s = t - 1; return s * s * s + 1; },
  InOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  InSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  OutSine: (t) => Math.sin((t * Math.PI) / 2),
  InOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  InExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  OutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

function _resolveEasing(easing) {
  if (typeof easing === 'function') return easing;
  if (typeof easing === 'string' && Object.prototype.hasOwnProperty.call(Easing, easing)) {
    return Easing[easing];
  }
  return Easing.Linear;
}

// ---------------------------------------------------------------------------
// AnimationTicker
// ---------------------------------------------------------------------------

class AnimationTicker {
  constructor() {
    this._animations = new Set();
    this._running = false;
    this._rafHandle = null;
    this._lastTime = null;
    this._useRaf = typeof requestAnimationFrame === 'function';
  }

  add(animation) {
    this._animations.add(animation);
    if (!this._running) {
      this._scheduleFrame();
    }
  }

  remove(animation) {
    this._animations.delete(animation);
  }

  advance(dt) {
    for (const anim of [...this._animations]) {
      anim._tick(dt);
    }
  }

  _scheduleFrame() {
    if (this._running) return;
    this._running = true;
    this._lastTime = null;

    const tick = (time) => {
      if (!this._running) return;

      if (this._lastTime === null) this._lastTime = time;
      const dt = time - this._lastTime;
      this._lastTime = time;

      this.advance(dt);

      if (this._animations.size > 0) {
        if (this._useRaf) {
          this._rafHandle = requestAnimationFrame(tick);
        } else {
          this._rafHandle = setTimeout(() => tick(Date.now()), 16);
        }
      } else {
        this._running = false;
        this._rafHandle = null;
      }
    };

    if (this._useRaf) {
      this._rafHandle = requestAnimationFrame(tick);
    } else {
      this._rafHandle = setTimeout(() => tick(Date.now()), 16);
    }
  }

  stop() {
    this._running = false;
    if (this._rafHandle !== null) {
      if (this._useRaf) {
        cancelAnimationFrame(this._rafHandle);
      } else {
        clearTimeout(this._rafHandle);
      }
      this._rafHandle = null;
    }
    this._lastTime = null;
  }
}

const _globalTicker = new AnimationTicker();

// ---------------------------------------------------------------------------
// Animation base class
// ---------------------------------------------------------------------------

class Animation extends QObject {
  constructor(options = {}) {
    super();

    this._ticker = options.ticker || _globalTicker;
    this._elapsed = 0;
    this._loopsDone = 0;
    this._started = false;

    this.defineProperty('running', false);
    this.defineProperty('loops', options.loops ?? 1);
    this.defineProperty('duration', options.duration ?? 250);
    this.defineSignal('started');
    this.defineSignal('stopped');
    this.defineSignal('finished');
  }

  _setRunning(value) {
    const def = this._propertyDefinitions.get('running');
    const prev = def.readOnly;
    def.readOnly = false;
    this.running = value;
    def.readOnly = prev;
  }

  start() {
    if (this._started) return;
    this._elapsed = 0;
    this._loopsDone = 0;
    this._started = true;
    this._onStart();
    this._setRunning(true);
    this._ticker.add(this);
    this.started.emit();
  }

  stop() {
    if (!this._started) return;
    this._started = false;
    this._ticker.remove(this);
    this._setRunning(false);
    this.stopped.emit();
  }

  _onStart() {}

  _tick(dt) {
    if (!this._started) return;

    const dur = Math.max(1, this.duration);
    this._elapsed += dt;
    const progress = Math.min(1, this._elapsed / dur);

    this._applyProgress(progress);

    if (this._elapsed >= dur) {
      this._loopsDone += 1;
      const loops = this.loops;
      if (loops !== -1 && this._loopsDone >= loops) {
        this._applyProgress(1);
        this._started = false;
        this._ticker.remove(this);
        this._setRunning(false);
        this.finished.emit();
      } else {
        this._elapsed -= dur;
        this._applyProgress(0);
      }
    }
  }

  _applyProgress(_progress) {}

  destroy() {
    this.stop();
    super.destroy();
  }
}

// Shared no-op ticker for child animations managed by container animations
const _nullTicker = Object.freeze({ add: () => {}, remove: () => {} });

// ---------------------------------------------------------------------------
// NumberAnimation
// ---------------------------------------------------------------------------

class NumberAnimation extends Animation {
  constructor(options = {}) {
    super(options);

    this._fromValue = null;

    this.defineProperty('target', options.target ?? null);
    this.defineProperty('property', options.property ?? '');
    this.defineProperty('from', options.from ?? null);
    this.defineProperty('to', options.to ?? 0);
    this.defineProperty('easing', options.easing ?? 'Linear');
  }

  _onStart() {
    const capturedFrom = this.from;
    if (capturedFrom !== null && capturedFrom !== undefined) {
      this._fromValue = capturedFrom;
    } else if (this.target && this.property) {
      this._fromValue = this.target[this.property] ?? 0;
    } else {
      this._fromValue = 0;
    }
  }

  _applyProgress(progress) {
    const target = this.target;
    const prop = this.property;
    if (!target || !prop) return;

    const easingFn = _resolveEasing(this.easing);
    const t = easingFn(progress);
    const fromV = this._fromValue ?? 0;
    const toV = this.to;
    target[prop] = fromV + (toV - fromV) * t;
  }
}

// ---------------------------------------------------------------------------
// ColorAnimation
// ---------------------------------------------------------------------------

function _parseColor(color) {
  if (typeof color !== 'string') return { r: 0, g: 0, b: 0, a: 1 };
  const hex = color.trim();
  if (hex.startsWith('#')) {
    const h = hex.slice(1);
    let r = 0, g = 0, b = 0, a = 255;
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else if (h.length === 6) {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    } else if (h.length === 8) {
      a = parseInt(h.slice(0, 2), 16);
      r = parseInt(h.slice(2, 4), 16);
      g = parseInt(h.slice(4, 6), 16);
      b = parseInt(h.slice(6, 8), 16);
    }
    return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function _colorToHex(c) {
  const toByte = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  const r = toByte(c.r).toString(16).padStart(2, '0');
  const g = toByte(c.g).toString(16).padStart(2, '0');
  const b = toByte(c.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

class ColorAnimation extends Animation {
  constructor(options = {}) {
    super(options);

    this._fromParsed = null;
    this._toParsed = null;

    this.defineProperty('target', options.target ?? null);
    this.defineProperty('property', options.property ?? 'color');
    this.defineProperty('from', options.from ?? null);
    this.defineProperty('to', options.to ?? '#000000');
    this.defineProperty('easing', options.easing ?? 'Linear');
  }

  _onStart() {
    const capturedFrom = this.from;
    if (capturedFrom !== null && capturedFrom !== undefined) {
      this._fromParsed = _parseColor(capturedFrom);
    } else if (this.target && this.property) {
      this._fromParsed = _parseColor(this.target[this.property] ?? '#000000');
    } else {
      this._fromParsed = { r: 0, g: 0, b: 0, a: 1 };
    }
    this._toParsed = _parseColor(this.to);
  }

  _applyProgress(progress) {
    const target = this.target;
    const prop = this.property;
    if (!target || !prop || !this._fromParsed || !this._toParsed) return;

    const easingFn = _resolveEasing(this.easing);
    const t = easingFn(progress);
    const lerp = (a, b) => a + (b - a) * t;
    const result = {
      r: lerp(this._fromParsed.r, this._toParsed.r),
      g: lerp(this._fromParsed.g, this._toParsed.g),
      b: lerp(this._fromParsed.b, this._toParsed.b),
      a: lerp(this._fromParsed.a, this._toParsed.a),
    };
    target[prop] = _colorToHex(result);
  }
}

// ---------------------------------------------------------------------------
// SequentialAnimation / ParallelAnimation
// ---------------------------------------------------------------------------

class SequentialAnimation extends Animation {
  constructor(options = {}) {
    super(options);
    this._children = options.animations ? [...options.animations] : [];
    this._currentIndex = 0;
    this._totalDuration = 0;
  }

  addAnimation(anim) {
    this._children.push(anim);
  }

  _onStart() {
    this._currentIndex = 0;
    this._totalDuration = this._children.reduce((sum, a) => sum + (a.duration || 0), 0);
    for (const child of this._children) {
      child._ticker = _nullTicker;
    }
  }

  _tick(dt) {
    if (!this._started) return;

    if (this._children.length === 0) {
      this._finishLoop();
      return;
    }

    let remaining = dt;
    while (remaining > 0 && this._currentIndex < this._children.length) {
      const child = this._children[this._currentIndex];
      if (!child._started) {
        child._elapsed = 0;
        child._loopsDone = 0;
        child._started = true;
        child._onStart();
      }

      const childDur = Math.max(1, child.duration);
      const spaceLeft = childDur - child._elapsed;
      const consume = Math.min(remaining, spaceLeft);
      remaining -= consume;
      child._elapsed += consume;

      const progress = Math.min(1, child._elapsed / childDur);
      child._applyProgress(progress);

      if (child._elapsed >= childDur) {
        child._applyProgress(1);
        child._started = false;
        this._currentIndex += 1;
      } else {
        break;
      }
    }

    if (this._currentIndex >= this._children.length) {
      this._finishLoop();
    }
  }

  _finishLoop() {
    this._loopsDone += 1;
    const loops = this.loops;
    if (loops !== -1 && this._loopsDone >= loops) {
      this._started = false;
      this._ticker.remove(this);
      this._setRunning(false);
      this.finished.emit();
    } else {
      this._currentIndex = 0;
      for (const child of this._children) {
        child._elapsed = 0;
        child._started = false;
      }
    }
  }

  destroy() {
    for (const child of this._children) {
      child.destroy();
    }
    this._children = [];
    super.destroy();
  }
}

class ParallelAnimation extends Animation {
  constructor(options = {}) {
    super(options);
    this._children = options.animations ? [...options.animations] : [];
  }

  addAnimation(anim) {
    this._children.push(anim);
  }

  _onStart() {
    this._totalDuration = 0;
    for (const child of this._children) {
      child._ticker = _nullTicker;
      child._elapsed = 0;
      child._loopsDone = 0;
      child._started = true;
      child._onStart();
      if (child.duration > this._totalDuration) {
        this._totalDuration = child.duration;
      }
    }
    const def = this._propertyDefinitions.get('duration');
    if (def) {
      const prevRO = def.readOnly;
      def.readOnly = false;
      this.duration = this._totalDuration || 1;
      def.readOnly = prevRO;
    }
  }

  _applyProgress(progress) {
    for (const child of this._children) {
      const childDur = Math.max(1, child.duration);
      const childProgress = Math.min(1, (progress * this.duration) / childDur);
      child._applyProgress(childProgress);
    }
  }

  destroy() {
    for (const child of this._children) {
      child.destroy();
    }
    this._children = [];
    super.destroy();
  }
}

// ---------------------------------------------------------------------------
// PropertyChanges
// ---------------------------------------------------------------------------

class PropertyChanges extends QObject {
  constructor(options = {}) {
    super();
    this.target = options.target ?? null;
    this._changes = {};

    for (const [key, value] of Object.entries(options)) {
      if (key !== 'target') {
        this._changes[key] = value;
      }
    }
  }

  addChange(name, value) {
    this._changes[name] = value;
  }

  get changes() {
    return { ...this._changes };
  }

  apply(target) {
    const t = target || this.target;
    if (!t) return;
    for (const [name, value] of Object.entries(this._changes)) {
      if (t._propertyDefinitions && t._propertyDefinitions.has(name)) {
        t[name] = value;
      } else if (typeof t[name] !== 'undefined') {
        t[name] = value;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class State extends QObject {
  constructor(options = {}) {
    super();
    this.name = options.name ?? '';
    this.when = options.when ?? null;
    this._propertyChanges = [];

    if (Array.isArray(options.changes)) {
      for (const pc of options.changes) {
        this.addPropertyChanges(pc);
      }
    }
  }

  addPropertyChanges(pc) {
    if (pc instanceof PropertyChanges) {
      this._propertyChanges.push(pc);
    }
  }

  get propertyChanges() {
    return [...this._propertyChanges];
  }
}

// ---------------------------------------------------------------------------
// Transition
// ---------------------------------------------------------------------------

class Transition extends QObject {
  constructor(options = {}) {
    super();
    this.from = options.from ?? '*';
    this.to = options.to ?? '*';
    this._animations = [];

    if (Array.isArray(options.animations)) {
      for (const anim of options.animations) {
        this.addAnimation(anim);
      }
    }
  }

  addAnimation(anim) {
    if (anim instanceof Animation) {
      this._animations.push(anim);
    }
  }

  get animations() {
    return [...this._animations];
  }

  _matches(from, to) {
    const matchFrom = this.from === '*' || this.from === '' || this.from === from;
    const matchTo = this.to === '*' || this.to === '' || this.to === to;
    return matchFrom && matchTo;
  }
}

// ---------------------------------------------------------------------------
// Behavior – intercepts property assignments and animates to the new value
// ---------------------------------------------------------------------------

class Behavior extends QObject {
  constructor(options = {}) {
    super();
    this._animation = options.animation ?? null;
    this._animating = false;
  }

  setAnimation(anim) {
    this._animation = anim;
  }

  _startAnimation(target, propName, fromValue, toValue) {
    const anim = this._animation;
    if (!anim) {
      // No animation – apply value directly
      target._propertyValues.set(propName, toValue);
      target.signal(`${propName}Changed`).emit(toValue, fromValue);
      return;
    }

    anim.stop();
    anim.target = target;
    anim.property = propName;

    if (anim instanceof NumberAnimation) {
      anim._fromValue = typeof fromValue === 'number' ? fromValue : 0;
      const def = anim._propertyDefinitions.get('to');
      if (def) {
        const prevRO = def.readOnly;
        def.readOnly = false;
        anim.to = typeof toValue === 'number' ? toValue : 0;
        def.readOnly = prevRO;
      }
    } else if (anim instanceof ColorAnimation) {
      anim._fromParsed = _parseColor(typeof fromValue === 'string' ? fromValue : '#000000');
      anim._toParsed = _parseColor(typeof toValue === 'string' ? toValue : '#000000');
    } else {
      // Unsupported animation type for behavior – apply directly
      target._propertyValues.set(propName, toValue);
      target.signal(`${propName}Changed`).emit(toValue, fromValue);
      return;
    }

    this._animating = true;

    const onDone = () => {
      anim.finished.disconnect(onDone);
      anim.stopped.disconnect(onDone);
      this._animating = false;
    };
    anim.finished.connect(onDone);
    anim.stopped.connect(onDone);

    anim.start();
  }

  destroy() {
    if (this._animation) {
      this._animation.stop();
    }
    this._animating = false;
    super.destroy();
  }
}

// ---------------------------------------------------------------------------
// Internal helper – clone an animation template for a specific target/property
// ---------------------------------------------------------------------------

function _cloneAnimationForProperty(templateAnim, target, propName, fromValue, toValue) {
  const ticker = templateAnim._ticker || _globalTicker;
  let clone;

  if (templateAnim instanceof NumberAnimation) {
    clone = new NumberAnimation({
      ticker,
      target,
      property: propName,
      from: fromValue,
      to: toValue,
      duration: templateAnim.duration,
      easing: templateAnim.easing,
      loops: templateAnim.loops,
    });
    clone._fromValue = fromValue;
  } else if (templateAnim instanceof ColorAnimation) {
    clone = new ColorAnimation({
      ticker,
      target,
      property: propName,
      from: typeof fromValue === 'string' ? fromValue : null,
      to: typeof toValue === 'string' ? toValue : templateAnim.to,
      duration: templateAnim.duration,
      easing: templateAnim.easing,
      loops: templateAnim.loops,
    });
  } else {
    clone = templateAnim;
  }

  return clone;
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

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

class Text extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('text', options.text ?? '');
    this.defineProperty('color', options.color ?? '#000000');
    this.defineProperty('font', options.font ?? { family: 'sans-serif', pixelSize: 14, bold: false });
    this.defineProperty('horizontalAlignment', options.horizontalAlignment ?? 'left');
    this.defineProperty('verticalAlignment', options.verticalAlignment ?? 'top');
    this.defineProperty('wrapMode', options.wrapMode ?? 'NoWrap');
    this.defineProperty('elide', options.elide ?? 'ElideNone');
  }

  draw(context) {
    if (!context) return;
    const text = String(this.text ?? '');
    if (!text) return;

    const font = this.font || {};
    const size = font.pixelSize || 14;
    const family = font.family || 'sans-serif';
    const bold = font.bold ? 'bold ' : '';
    context.font = `${bold}${size}px ${family}`;
    context.fillStyle = this.color || '#000000';
    context.textBaseline = 'top';
    context.fillText(text, 0, 0);
  }
}

// ---------------------------------------------------------------------------
// Stage B: ListElement – data holder for ListModel rows
// ---------------------------------------------------------------------------

class ListElement extends QObject {
  constructor(options = {}) {
    super();
  }

  _rowData() {
    const data = {};
    for (const [key, value] of this._propertyValues.entries()) {
      data[key] = value;
    }
    return data;
  }
}

// ---------------------------------------------------------------------------
// Stage B: ListModel
// ---------------------------------------------------------------------------

class ListModel extends QObject {
  constructor(options = {}) {
    super();

    this._rows = [];

    this.defineSignal('countChanged');
    this.defineSignal('rowsInserted');
    this.defineSignal('rowsRemoved');
    this.defineSignal('rowsMoved');
    this.defineSignal('dataChanged');
    this.defineProperty('count', 0);

    if (Array.isArray(options.rows)) {
      for (const row of options.rows) {
        this.append(row);
      }
    }
  }

  _setCount(n) {
    this._setPropertyValue('count', n);
  }

  get(index) {
    if (index < 0 || index >= this._rows.length) return null;
    return { ...this._rows[index] };
  }

  append(rowData) {
    const index = this._rows.length;
    this._rows.push({ ...rowData });
    this._setCount(this._rows.length);
    this.rowsInserted.emit(index, 1);
  }

  insert(index, rowData) {
    const i = Math.max(0, Math.min(index, this._rows.length));
    this._rows.splice(i, 0, { ...rowData });
    this._setCount(this._rows.length);
    this.rowsInserted.emit(i, 1);
  }

  remove(index, count = 1) {
    if (this._rows.length === 0) return;
    const i = Math.max(0, Math.min(index, this._rows.length - 1));
    const n = Math.min(count, this._rows.length - i);
    if (n <= 0) return;
    this._rows.splice(i, n);
    this._setCount(this._rows.length);
    this.rowsRemoved.emit(i, n);
  }

  move(from, to, count = 1) {
    const len = this._rows.length;
    if (from < 0 || from >= len || to < 0 || to >= len || count <= 0) return;
    const moved = this._rows.splice(from, count);
    const insertAt = from < to ? to - count + 1 : to;
    this._rows.splice(insertAt, 0, ...moved);
    this.rowsMoved.emit(from, to, count);
  }

  clear() {
    const oldCount = this._rows.length;
    this._rows = [];
    this._setCount(0);
    if (oldCount > 0) {
      this.rowsRemoved.emit(0, oldCount);
    }
  }

  set(index, rowData) {
    if (index < 0 || index >= this._rows.length) return;
    this._rows[index] = { ...this._rows[index], ...rowData };
    this.dataChanged.emit(index, Object.keys(rowData));
  }

  setProperty(index, role, value) {
    if (index < 0 || index >= this._rows.length) return;
    if (role === '__proto__' || role === 'constructor' || role === 'prototype') return;
    this._rows[index][role] = value;
    this.dataChanged.emit(index, [role]);
  }
}

// ---------------------------------------------------------------------------
// Stage B: helpers for model access
// ---------------------------------------------------------------------------

function _modelCount(model) {
  if (model instanceof ListModel) return model.count;
  if (Array.isArray(model)) return model.length;
  if (typeof model === 'number' && model >= 0) return Math.floor(model);
  return 0;
}

function _modelRowData(model, index) {
  if (model instanceof ListModel) return model.get(index);
  if (Array.isArray(model)) return model[index] ?? null;
  if (typeof model === 'number') return index;
  return null;
}

function _buildDelegateContext(parentContext, model, index, rowData) {
  const contextValues = {
    index,
    model,
    modelData: rowData,
  };
  if (rowData !== null && typeof rowData === 'object') {
    for (const key of Object.keys(rowData)) {
      if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
        contextValues[key] = rowData[key];
      }
    }
  }
  return new Context(parentContext, contextValues);
}

// ---------------------------------------------------------------------------
// Stage B: Repeater
// ---------------------------------------------------------------------------

class Repeater extends Item {
  constructor(options = {}) {
    super(options);

    this._delegateItems = [];
    this._modelDisconnectors = [];

    this.defineProperty('model', null);
    this.defineProperty('delegate', null);
    this.defineProperty('count', 0);

    this.defineSignal('itemAdded');
    this.defineSignal('itemRemoved');

    // Watch model/delegate changes
    this.connect('modelChanged', (newModel, oldModel) => this._onModelReplaced(newModel, oldModel));
    this.connect('delegateChanged', () => this._rebuild());
    this.connect('parentItemChanged', () => this._rebuild());

    if (options.model !== undefined) this.model = options.model;
    if (options.delegate !== undefined) this.delegate = options.delegate;
  }

  _disconnectModel() {
    for (const disconnect of this._modelDisconnectors) {
      disconnect();
    }
    this._modelDisconnectors = [];
  }

  _onModelReplaced(newModel, _oldModel) {
    this._disconnectModel();
    if (newModel instanceof ListModel) {
      this._modelDisconnectors.push(
        newModel.rowsInserted.connect((index, count) => this._onRowsInserted(index, count)),
      );
      this._modelDisconnectors.push(
        newModel.rowsRemoved.connect((index, count) => this._onRowsRemoved(index, count)),
      );
      this._modelDisconnectors.push(
        newModel.rowsMoved.connect((from, to, count) => this._onRowsMoved(from, to, count)),
      );
      this._modelDisconnectors.push(
        newModel.dataChanged.connect((index) => this._onDataChanged(index)),
      );
    }
    this._rebuild();
  }

  _rebuild() {
    // destroy existing
    for (const item of this._delegateItems) {
      if (item) item.destroy();
    }
    this._delegateItems = [];

    const model = this.model;
    const delegate = this.delegate;
    if (!delegate || !(delegate instanceof Component)) return;

    const count = _modelCount(model);
    for (let i = 0; i < count; i++) {
      const item = this._createDelegateAt(i);
      this._delegateItems.push(item);
      if (item) this.itemAdded.emit(i, item);
    }
    this._setPropertyValue('count', this._delegateItems.filter(Boolean).length);
  }

  _createDelegateAt(index) {
    const delegate = this.delegate;
    if (!(delegate instanceof Component)) return null;

    const model = this.model;
    const rowData = _modelRowData(model, index);
    const parentContext = this.getContext();
    const delegateContext = _buildDelegateContext(parentContext, model, index, rowData);
    const parentItem = this.parentItem;
    const scope = this.getComponentScope();

    return delegate.createObject(parentItem, {}, delegateContext, scope);
  }

  _onRowsInserted(index, count) {
    const delegate = this.delegate;
    if (!(delegate instanceof Component)) return;

    // Shift existing items upward
    const newItems = [];
    for (let i = 0; i < count; i++) {
      newItems.push(this._createDelegateAt(index + i));
    }
    this._delegateItems.splice(index, 0, ...newItems);

    // Update index context values for items after insertion point
    this._updateIndexes(index + count);

    for (let i = 0; i < count; i++) {
      const item = this._delegateItems[index + i];
      if (item) this.itemAdded.emit(index + i, item);
    }
    this._setPropertyValue('count', this._delegateItems.filter(Boolean).length);
  }

  _onRowsRemoved(index, count) {
    const removed = this._delegateItems.splice(index, count);
    for (const item of removed) {
      if (item) {
        this.itemRemoved.emit(item);
        item.destroy();
      }
    }
    this._updateIndexes(index);
    this._setPropertyValue('count', this._delegateItems.filter(Boolean).length);
  }

  _onRowsMoved(from, to, count) {
    // simplest: full rebuild on move
    this._rebuild();
  }

  _onDataChanged(index) {
    // recreate delegate at index
    const old = this._delegateItems[index];
    if (old) old.destroy();
    const item = this._createDelegateAt(index);
    this._delegateItems[index] = item;
  }

  _updateIndexes(_fromIndex) {
    // Context values are captured at creation time; index updates require recreation.
    // For now this is a no-op (contexts are immutable snapshots).
  }

  itemAt(index) {
    return this._delegateItems[index] ?? null;
  }

  destroy() {
    this._disconnectModel();
    for (const item of this._delegateItems) {
      if (item) item.destroy();
    }
    this._delegateItems = [];
    super.destroy();
  }
}

// ---------------------------------------------------------------------------
// Stage B: ListView
// ---------------------------------------------------------------------------

class ListView extends Item {
  constructor(options = {}) {
    super(options);

    this._delegateItems = [];        // sparse array of created delegate instances
    this._delegateHeight = 40;       // measured/default row height
    this._modelDisconnectors = [];
    this._rebuilding = false;

    this.defineProperty('model', null);
    this.defineProperty('delegate', null);
    this.defineProperty('contentY', 0);
    this.defineProperty('contentHeight', 0);
    this.defineProperty('spacing', 0);
    this.defineProperty('cacheBuffer', 40);  // extra pixels above/below to pre-create

    this.defineSignal('contentYChanged');

    this.connect('modelChanged', (newModel, oldModel) => this._onModelReplaced(newModel, oldModel));
    this.connect('delegateChanged', () => this._rebuild());
    this.connect('contentYChanged', () => this._updateVirtualization());
    this.connect('heightChanged', () => this._updateVirtualization());

    if (options.model !== undefined) this.model = options.model;
    if (options.delegate !== undefined) this.delegate = options.delegate;
    if (options.contentY !== undefined) this.contentY = options.contentY;
  }

  // Alias: viewportHeight reads height
  get viewportHeight() {
    return this.height;
  }

  _disconnectModel() {
    for (const disconnect of this._modelDisconnectors) {
      disconnect();
    }
    this._modelDisconnectors = [];
  }

  _onModelReplaced(newModel, _oldModel) {
    this._disconnectModel();
    if (newModel instanceof ListModel) {
      this._modelDisconnectors.push(
        newModel.rowsInserted.connect(() => this._rebuild()),
      );
      this._modelDisconnectors.push(
        newModel.rowsRemoved.connect(() => this._rebuild()),
      );
      this._modelDisconnectors.push(
        newModel.rowsMoved.connect(() => this._rebuild()),
      );
      this._modelDisconnectors.push(
        newModel.dataChanged.connect((index) => this._onDataChanged(index)),
      );
    }
    this._rebuild();
  }

  _rowHeight() {
    return this._delegateHeight + (this.spacing || 0);
  }

  _totalContentHeight() {
    const count = _modelCount(this.model);
    if (count === 0) return 0;
    return count * this._delegateHeight + Math.max(0, count - 1) * (this.spacing || 0);
  }

  _rebuild() {
    if (this._rebuilding) return;
    this._rebuilding = true;
    try {
      for (const item of this._delegateItems) {
        if (item) item.destroy();
      }
      this._delegateItems = [];

      const count = _modelCount(this.model);
      this._delegateItems = new Array(count).fill(null);

      this._setPropertyValue('contentHeight', this._totalContentHeight());
      this._updateVirtualization();
    } finally {
      this._rebuilding = false;
    }
  }

  _updateVirtualization() {
    const count = _modelCount(this.model);
    if (count === 0 || !(this.delegate instanceof Component)) {
      this._setPropertyValue('contentHeight', 0);
      return;
    }

    this._setPropertyValue('contentHeight', this._totalContentHeight());

    const viewH = this.height || 0;
    const contentY = Math.max(0, this.contentY || 0);
    const buffer = this.cacheBuffer || 0;
    const rowH = this._rowHeight();

    const firstVisible = Math.max(0, Math.floor((contentY - buffer) / rowH));
    const lastVisible = Math.min(
      count - 1,
      Math.ceil((contentY + viewH + buffer) / rowH),
    );

    // Ensure sparse array is large enough
    if (this._delegateItems.length < count) {
      this._delegateItems.length = count;
    }

    // Destroy items outside visible range
    for (let i = 0; i < this._delegateItems.length; i++) {
      const item = this._delegateItems[i];
      if (item && (i < firstVisible || i > lastVisible)) {
        item.destroy();
        this._delegateItems[i] = null;
      }
    }

    // Create and position items within visible range
    for (let i = firstVisible; i <= lastVisible && i < count; i++) {
      if (!this._delegateItems[i]) {
        this._delegateItems[i] = this._createDelegateAt(i);
        // Measure height from first item
        if (i === 0 && this._delegateItems[i]) {
          const h = this._delegateItems[i].height || this._delegateItems[i].implicitHeight || 40;
          if (h > 0) {
            this._delegateHeight = h;
            this._setPropertyValue('contentHeight', this._totalContentHeight());
          }
        }
      }
      const item = this._delegateItems[i];
      if (item) {
        item.y = i * this._rowHeight() - contentY;
        item.x = 0;
      }
    }
  }

  _createDelegateAt(index) {
    const delegate = this.delegate;
    if (!(delegate instanceof Component)) return null;

    const model = this.model;
    const rowData = _modelRowData(model, index);
    const parentContext = this.getContext();
    const delegateContext = _buildDelegateContext(parentContext, model, index, rowData);
    const scope = this.getComponentScope();

    return delegate.createObject(this, {}, delegateContext, scope);
  }

  _onDataChanged(index) {
    const old = this._delegateItems[index];
    if (old) {
      old.destroy();
      this._delegateItems[index] = null;
    }
    // Will be recreated on next _updateVirtualization call
    this._updateVirtualization();
  }

  // Return number of currently created (non-null) delegate items
  get createdCount() {
    return this._delegateItems.filter(Boolean).length;
  }

  itemAt(index) {
    return this._delegateItems[index] ?? null;
  }

  positionViewAtIndex(index, mode = 0) {
    const count = _modelCount(this.model);
    if (index < 0 || index >= count) return;
    const rowH = this._rowHeight();
    this.contentY = index * rowH;
  }

  destroy() {
    this._disconnectModel();
    for (const item of this._delegateItems) {
      if (item) item.destroy();
    }
    this._delegateItems = [];
    super.destroy();
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
  Text,
  // Stage A: animations
  Easing,
  AnimationTicker,
  Animation,
  NumberAnimation,
  ColorAnimation,
  SequentialAnimation,
  ParallelAnimation,
  // Stage A: states / transitions / behaviors
  PropertyChanges,
  State,
  Transition,
  Behavior,
  // Stage B: models / views
  ListElement,
  ListModel,
  Repeater,
  ListView,
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
