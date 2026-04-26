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

// ---------------------------------------------------------------------------
// Stage E: Transform math utilities
// ---------------------------------------------------------------------------

/**
 * Resolve a transformOrigin string/object to a { x, y } point in item-local
 * coordinates.  The names mirror Qt Quick's Item.TransformOrigin enum values.
 */
function _resolveTransformOrigin(transformOrigin, width, height) {
  if (transformOrigin && typeof transformOrigin === 'object') {
    return transformOrigin;
  }
  switch (transformOrigin) {
    case 'TopLeft':     return { x: 0,          y: 0 };
    case 'Top':         return { x: width / 2,  y: 0 };
    case 'TopRight':    return { x: width,       y: 0 };
    case 'Left':        return { x: 0,           y: height / 2 };
    case 'Right':       return { x: width,       y: height / 2 };
    case 'BottomLeft':  return { x: 0,           y: height };
    case 'Bottom':      return { x: width / 2,   y: height };
    case 'BottomRight': return { x: width,        y: height };
    default:            return { x: width / 2,   y: height / 2 }; // 'Center'
  }
}

/**
 * Compute the 2-D affine matrix that maps a point in item-local coordinates
 * to parent-item coordinates.  Format: { a, b, c, d, e, f } where
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */
function _itemLocalToParentMatrix(item) {
  const angle = ((item.rotation || 0) * Math.PI) / 180;
  const s = item.scale !== undefined ? item.scale : 1;

  if (angle === 0 && s === 1) {
    // Fast path: pure translation
    return { a: 1, b: 0, c: 0, d: 1, e: item.x, f: item.y };
  }

  const w = item.width || item.implicitWidth || 0;
  const h = item.height || item.implicitHeight || 0;
  const origin = _resolveTransformOrigin(item.transformOrigin, w, h);
  const ox = origin.x;
  const oy = origin.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const a = cos * s;
  const b = sin * s;
  const c = -sin * s;
  const d = cos * s;
  const e = item.x + ox + a * (-ox) + c * (-oy);
  const f = item.y + oy + b * (-ox) + d * (-oy);

  return { a, b, c, d, e, f };
}

/** Apply a 2-D affine matrix to a point. */
function _applyMatrix(m, x, y) {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** Invert a 2-D affine matrix.  Returns null if the matrix is singular. */
function _invertMatrix(m) {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-10) return null;
  return {
    a:  m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d:  m.a / det,
    e:  (m.c * m.f - m.d * m.e) / det,
    f:  (m.b * m.e - m.a * m.f) / det,
  };
}

// ---------------------------------------------------------------------------
// Stage E: Text measurement cache
// ---------------------------------------------------------------------------

const _textMeasureCache = new Map();

/**
 * Measure the pixel width of a string in the given CSS font string.
 * Results are memoised for the lifetime of the process / page.
 */
function _measureTextWidth(context, fontString, text) {
  const key = `${fontString}||${text}`;
  if (_textMeasureCache.has(key)) return _textMeasureCache.get(key);
  const saved = context.font;
  context.font = fontString;
  const w = context.measureText(text).width;
  context.font = saved;
  _textMeasureCache.set(key, w);
  return w;
}

// ---------------------------------------------------------------------------
// Text / TextInput value-normalization helpers
// ---------------------------------------------------------------------------

function _normalizeElide(v) {
  if (!v) return 'none';
  const s = String(v).toLowerCase();
  if (s === 'elidenone' || s === 'none') return 'none';
  if (s === 'elideright' || s === 'right') return 'right';
  if (s === 'elideleft' || s === 'left') return 'left';
  if (s === 'elidemiddle' || s === 'middle') return 'middle';
  return 'none';
}

function _normalizeWrapMode(v) {
  if (!v) return 'nowrap';
  const s = String(v).toLowerCase();
  if (s === 'wordwrap') return 'wordwrap';
  if (s === 'wrapanywhere') return 'wrapanywhere';
  return 'nowrap';
}

function _normalizeHAlign(v) {
  if (!v) return 'left';
  const s = String(v).toLowerCase();
  if (s === 'center' || s === 'alignhcenter' || s === 'hcenter') return 'center';
  if (s === 'right' || s === 'alignright') return 'right';
  if (s === 'justify' || s === 'alignjustify') return 'justify';
  return 'left';
}

function _normalizeVAlign(v) {
  if (!v) return 'top';
  const s = String(v).toLowerCase();
  if (s === 'vcenter' || s === 'alignvcenter') return 'vcenter';
  if (s === 'bottom' || s === 'alignbottom') return 'bottom';
  return 'top';
}

/**
 * Build a CSS font string from a font descriptor object.
 * Shared by Text, TextInput and any other item that renders text.
 *   @param {object} font - { family, pixelSize, bold, italic }
 */
function _buildFontString(font) {
  const f = font || {};
  const size = f.pixelSize || 14;
  const family = f.family || 'sans-serif';
  const bold = f.bold ? 'bold ' : '';
  const italic = f.italic ? 'italic ' : '';
  return `${italic}${bold}${size}px ${family}`;
}

/** Default blink interval (ms) for cursor in TextInput / TextField. */
const _CURSOR_BLINK_INTERVAL = 500;

// ---------------------------------------------------------------------------
// Stage E: Image asset cache
// ---------------------------------------------------------------------------

/**
 * Cache entry: { img: HTMLImageElement|null, status: 0|1|2|3 }
 *   0 = Null, 1 = Loading, 2 = Ready, 3 = Error
 */
const _imageCache = new Map();

// Capture the browser Image constructor *before* we define our own Image class.
const _HtmlImageCtor = (typeof globalThis !== 'undefined' && typeof globalThis.Image === 'function')
  ? globalThis.Image
  : null;

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

    // Stage E: rendering properties
    this.defineProperty('clip', false);
    this.defineProperty('scale', 1);
    this.defineProperty('rotation', 0);
    this.defineProperty('transformOrigin', 'Center');

    // Stage E: layer support (lazy backing object; layer.enabled = true activates caching)
    this._layer = { enabled: false };
    this._layerCache = null;
    this._layerDirty = true;

    // Stage C: focus properties
    this.defineProperty('focus', false);
    this.defineProperty('activeFocus', false);
    this.defineProperty('focusScope', false);
    this.defineProperty('focusable', false);
    this.defineProperty('activeFocusOnTab', false);

    // Stage C: Keys attached property (lazily created)
    this._keys = null;

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
    let pt = { x, y };

    while (current instanceof Item) {
      pt = _applyMatrix(_itemLocalToParentMatrix(current), pt.x, pt.y);
      current = current.parentItem;
    }

    return pt;
  }

  /**
   * Map a scene-space point to this item's local coordinate space by
   * applying the inverse of each ancestor's transform from root down to self.
   */
  _mapFromScene(sceneX, sceneY) {
    const chain = [];
    let current = this;
    while (current instanceof Item) {
      chain.push(current);
      current = current.parentItem;
    }

    let pt = { x: sceneX, y: sceneY };
    for (let i = chain.length - 1; i >= 0; i--) {
      const inv = _invertMatrix(_itemLocalToParentMatrix(chain[i]));
      if (inv) {
        pt = _applyMatrix(inv, pt.x, pt.y);
      }
    }
    return pt;
  }

  mapToItem(targetItem, x = 0, y = 0) {
    const scenePoint = this._mapToScene(x, y);
    if (!(targetItem instanceof Item)) {
      return scenePoint;
    }

    return targetItem._mapFromScene(scenePoint.x, scenePoint.y);
  }

  mapFromItem(sourceItem, x = 0, y = 0) {
    const scenePoint = sourceItem instanceof Item ? sourceItem._mapToScene(x, y) : { x, y };
    return this._mapFromScene(scenePoint.x, scenePoint.y);
  }

  containsPoint(sceneX, sceneY) {
    if (!this.visible) {
      return false;
    }

    const local = this._mapFromScene(sceneX, sceneY);
    return local.x >= 0 && local.y >= 0 && local.x <= (this.width || 0) && local.y <= (this.height || 0);
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

    // If this item clips its children, any point outside our bounds cannot
    // reach a child — skip all child hit-testing early.
    const insideSelf = this.containsPoint(sceneX, sceneY);
    if (this.clip && !insideSelf) {
      return null;
    }

    for (const child of this._sortedChildItemsDescending()) {
      const hit = child.hitTest(sceneX, sceneY);
      if (hit) {
        return hit;
      }
    }

    return insideSelf ? this : null;
  }

  // Stage C: Keys attached property accessor
  get keys() {
    if (!this._keys) {
      // eslint-disable-next-line no-use-before-define
      this._keys = new Keys();
    }
    return this._keys;
  }

  // Stage E: layer accessor – returns the backing layer config object.
  // Setting layer.enabled = true activates subtree layer caching.
  get layer() {
    return this._layer;
  }

  // Stage E: mark the layer cache as needing a re-render.
  _invalidateLayer() {
    this._layerDirty = true;
  }

  // Stage C: check if this item can receive keyboard focus via Tab
  _isFocusableByTab() {
    return this.enabled && this.visible && (this.activeFocusOnTab || this.focusable);
  }

  /**
   * Returns a content scroll offset {x, y} that CanvasRenderer applies as a
   * negative translate before drawing this item's children.  The default
   * implementation returns null (no offset).  Flickable overrides this.
   */
  _getContentOffset() {
    return null;
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

// ---------------------------------------------------------------------------
// Stage C: Keys attached property
// ---------------------------------------------------------------------------

class Keys {
  constructor() {
    this.onPressed = null;
    this.onReleased = null;
    this.enabled = true;
    // priority mirrors Qt Quick Keys.priority: 'BeforeItem' | 'AfterChildren'
    // Currently informational only; reserved for future handler-ordering support.
    this.priority = 'BeforeItem';
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

// ---------------------------------------------------------------------------
// Stage C: TapHandler
// ---------------------------------------------------------------------------

class TapHandler extends Item {
  constructor(options = {}) {
    super(options);

    this._pressedInside = false;

    this.defineSignal('tapped');
  }

  handlePointerEvent(type, event) {
    if (!this.enabled || !this.visible) {
      return false;
    }

    if (type === 'down') {
      this._pressedInside = true;
      return true;
    }

    if (type === 'up') {
      const wasPressed = this._pressedInside;
      this._pressedInside = false;
      if (wasPressed && this.containsPoint(event.sceneX, event.sceneY)) {
        this.tapped.emit(event);
        return true;
      }
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// Stage C: DragHandler
// ---------------------------------------------------------------------------

class DragHandler extends Item {
  constructor(options = {}) {
    super(options);

    this._pressedSceneX = 0;
    this._pressedSceneY = 0;
    this._pressedTargetX = 0;
    this._pressedTargetY = 0;
    this._pendingPress = false;

    this.defineProperty('active', false);
    this.defineProperty('translation', { x: 0, y: 0 });
    this.defineProperty('dragTarget', null);
    // Minimum pixel distance before a drag is recognized (arbitration threshold)
    this.defineProperty('grabThreshold', options.grabThreshold ?? 5);
    // grabPermissions mirrors the Qt PointerHandler API; exposed for QML-level
    // configuration. The runtime currently enforces threshold-based arbitration
    // rather than permission checks, but the property is available for future use.
    this.defineProperty('grabPermissions', options.grabPermissions ?? 'TakeOverForbidden');

    // activeChanged signal is automatically created by defineProperty('active')
  }

  // Returns the item that should be moved: explicit dragTarget or parentItem
  get _dragItem() {
    return this.dragTarget || this.parentItem;
  }

  handlePointerEvent(type, event) {
    if (!this.enabled || !this.visible) {
      return false;
    }

    if (type === 'down') {
      this._pressedSceneX = event.sceneX;
      this._pressedSceneY = event.sceneY;
      const target = this._dragItem;
      if (target) {
        this._pressedTargetX = target.x;
        this._pressedTargetY = target.y;
      }
      // Don't grab immediately – wait for threshold to be exceeded
      this._pendingPress = true;
      return false;
    }

    if (type === 'move') {
      const dx = event.sceneX - this._pressedSceneX;
      const dy = event.sceneY - this._pressedSceneY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!this.active && this._pendingPress && dist >= this.grabThreshold) {
        // Crossed threshold – activate the drag
        this._setPropertyValue('active', true);
      }

      if (this.active) {
        this._setPropertyValue('translation', { x: dx, y: dy });
        const target = this._dragItem;
        if (target) {
          target.x = this._pressedTargetX + dx;
          target.y = this._pressedTargetY + dy;
        }
        return true;
      }
      return false;
    }

    if (type === 'up') {
      this._pendingPress = false;
      if (this.active) {
        this._setPropertyValue('active', false);
        return true;
      }
      return false;
    }

    return false;
  }
}

// ---------------------------------------------------------------------------
// Stage H: HoverHandler
// ---------------------------------------------------------------------------

class HoverHandler extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('hovered', false);
    this.defineProperty('point', { x: 0, y: 0 });
    this.defineProperty('acceptedDevices', options.acceptedDevices ?? 'all');

    this.defineSignal('entered');
    this.defineSignal('exited');
  }

  // Called by Scene._dispatchHover on every pointer move
  _updateHover(sceneX, sceneY) {
    if (!this.enabled || !this.visible) {
      this._clearHover();
      return;
    }

    const isOver = this.containsPoint(sceneX, sceneY);
    if (isOver && !this.hovered) {
      const local = this.mapFromItem(null, sceneX, sceneY);
      this._setPropertyValue('point', { x: local.x, y: local.y });
      this._setPropertyValue('hovered', true);
      this.entered.emit();
    } else if (!isOver && this.hovered) {
      this._clearHover();
    } else if (isOver) {
      const local = this.mapFromItem(null, sceneX, sceneY);
      this._setPropertyValue('point', { x: local.x, y: local.y });
    }
  }

  _clearHover() {
    if (this.hovered) {
      this._setPropertyValue('hovered', false);
      this.exited.emit();
    }
  }
}

// ---------------------------------------------------------------------------
// Stage H: WheelHandler
// ---------------------------------------------------------------------------

class WheelHandler extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('orientation', options.orientation ?? 'vertical');
    this.defineProperty('active', false);
    this.defineProperty('acceptedDevices', options.acceptedDevices ?? 'all');

    this.defineSignal('wheel');
  }

  handleWheelEvent(originalEvent, sceneX, sceneY) {
    if (!this.enabled || !this.visible) return false;

    // If we have dimensions, check containsPoint; otherwise use parent bounds
    const hasOwnBounds = (this.width > 0 || this.height > 0);
    const checkItem = hasOwnBounds ? this : this.parentItem;
    if (checkItem && sceneX !== undefined && !checkItem.containsPoint(sceneX, sceneY)) {
      return false;
    }

    const orientation = this.orientation;
    const dx = originalEvent.deltaX || 0;
    const dy = originalEvent.deltaY || 0;

    const relevant =
      orientation === 'both' ||
      (orientation === 'vertical' && dy !== 0) ||
      (orientation === 'horizontal' && dx !== 0);

    if (!relevant) return false;

    this._setPropertyValue('active', true);

    const evt = {
      deltaX: dx,
      deltaY: dy,
      deltaMode: originalEvent.deltaMode || 0,
      accepted: false,
      originalEvent,
    };

    this.wheel.emit(evt);
    this._setPropertyValue('active', false);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Stage H: PinchHandler (MVP – ctrl+wheel as pinch fallback)
// ---------------------------------------------------------------------------

class PinchHandler extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('active', false);
    // 'scale' and 'rotation' are inherited from Item; set initial values if provided.
    // 'scaleChanged' and 'rotationChanged' are created by Item's defineProperty('scale')
    // and defineProperty('rotation') respectively.
    if (options.scale !== undefined) this.scale = options.scale;
    if (options.rotation !== undefined) this.rotation = options.rotation;
    this.defineProperty('centroid', { x: 0, y: 0 });
  }

  handleWheelEvent(originalEvent, sceneX, sceneY) {
    // ctrl+wheel is the browser pinch fallback
    if (!originalEvent.ctrlKey) return false;
    if (!this.enabled || !this.visible) return false;

    const hasOwnBounds = (this.width > 0 || this.height > 0);
    const checkItem = hasOwnBounds ? this : this.parentItem;
    if (checkItem && sceneX !== undefined && !checkItem.containsPoint(sceneX, sceneY)) {
      return false;
    }

    const dy = originalEvent.deltaY || 0;
    // 1.1 / 0.9 ≈ ±10 % per scroll step, matching common browser pinch-zoom feel.
    // Clamped to [0.01, 100] to prevent degenerate values.
    const factor = dy < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.01, Math.min(100, this.scale * factor));

    const local = (checkItem || this).mapFromItem(null, sceneX, sceneY);
    this._setPropertyValue('centroid', { x: local.x, y: local.y });
    // _setPropertyValue emits scaleChanged automatically
    this._setPropertyValue('scale', newScale);
    return true;
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

  _drawItem(item, inheritedOpacity, _skipLayer = false) {
    if (!item.visible) {
      return;
    }

    const context = this.context;
    const opacity = inheritedOpacity * item.opacity;
    if (opacity <= 0) {
      return;
    }

    // Stage E: layer caching – render subtree to an offscreen canvas and blit.
    if (!_skipLayer && item._layer && item._layer.enabled) {
      this._drawItemWithLayer(item, inheritedOpacity);
      return;
    }

    context.save();
    context.translate(item.x, item.y);

    // Stage E: apply rotation and scale transforms around transformOrigin.
    const rotation = item.rotation || 0;
    const scale = item.scale !== undefined ? item.scale : 1;
    if (rotation !== 0 || scale !== 1) {
      const w = item.width || item.implicitWidth || 0;
      const h = item.height || item.implicitHeight || 0;
      const origin = _resolveTransformOrigin(item.transformOrigin, w, h);
      context.translate(origin.x, origin.y);
      if (rotation !== 0) {
        context.rotate((rotation * Math.PI) / 180);
      }
      if (scale !== 1) {
        context.scale(scale, scale);
      }
      context.translate(-origin.x, -origin.y);
    }

    const previousAlpha = context.globalAlpha;
    context.globalAlpha = previousAlpha * opacity;

    // Stage E: clip children to item bounds when clip: true.
    if (item.clip) {
      const cw = item.width || item.implicitWidth || 0;
      const ch = item.height || item.implicitHeight || 0;
      context.beginPath();
      context.rect(0, 0, cw, ch);
      context.clip();
    }

    if (typeof item.draw === 'function') {
      item.draw(context);
    }

    // Flickable (and similar) may request a content scroll offset so that
    // their children are rendered shifted by -(contentX, contentY).
    const contentOffset = item._getContentOffset();
    if (contentOffset) {
      context.translate(-contentOffset.x, -contentOffset.y);
    }

    for (const child of item._sortedChildItemsAscending()) {
      this._drawItem(child, opacity);
    }

    context.restore();
  }

  /**
   * Stage E: Render an item whose layer.enabled is true.
   * In environments that support OffscreenCanvas the subtree is painted to an
   * offscreen surface and cached until _layerDirty is set.  In other
   * environments (e.g. Node tests) the item is drawn normally.
   */
  _drawItemWithLayer(item, inheritedOpacity) {
    const context = this.context;
    const opacity = inheritedOpacity * item.opacity;
    if (opacity <= 0) return;

    const w = item.width || item.implicitWidth || 0;
    const h = item.height || item.implicitHeight || 0;

    // Fallback: no OffscreenCanvas (e.g. Node.js) – draw without layer.
    if (typeof OffscreenCanvas === 'undefined' || w <= 0 || h <= 0) {
      this._drawItem(item, inheritedOpacity, true);
      return;
    }

    // Re-render offscreen surface when dirty or dimensions changed.
    if (
      !item._layerCache
      || item._layerCache.width !== w
      || item._layerCache.height !== h
      || item._layerDirty
    ) {
      const offscreen = new OffscreenCanvas(w, h);
      const offCtx = offscreen.getContext('2d');
      offCtx.clearRect(0, 0, w, h);
      const savedCtx = this.context;
      this.context = offCtx;
      if (typeof item.draw === 'function') item.draw(offCtx);
      const contentOffsetLayer = item._getContentOffset();
      if (contentOffsetLayer) {
        offCtx.translate(-contentOffsetLayer.x, -contentOffsetLayer.y);
      }
      for (const child of item._sortedChildItemsAscending()) {
        this._drawItem(child, 1);
      }
      this.context = savedCtx;
      item._layerCache = offscreen;
      item._layerDirty = false;
    }

    // Blit the cached surface at the item's position with transforms applied.
    context.save();
    context.translate(item.x, item.y);
    const rotation = item.rotation || 0;
    const scale = item.scale !== undefined ? item.scale : 1;
    if (rotation !== 0 || scale !== 1) {
      const origin = _resolveTransformOrigin(item.transformOrigin, w, h);
      context.translate(origin.x, origin.y);
      if (rotation !== 0) context.rotate((rotation * Math.PI) / 180);
      if (scale !== 1) context.scale(scale, scale);
      context.translate(-origin.x, -origin.y);
    }
    const previousAlpha = context.globalAlpha;
    context.globalAlpha = previousAlpha * opacity;
    if (item.clip) {
      context.beginPath();
      context.rect(0, 0, w, h);
      context.clip();
    }
    context.drawImage(item._layerCache, 0, 0);
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

    // Stage C: focus management
    this.activeFocusItem = null;

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

    // Stage C: ensure canvas can receive keyboard events
    if (canvas.tabIndex === undefined || canvas.tabIndex < 0) {
      canvas.tabIndex = 0;
    }

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
      // Stage C: keyboard events
      keydown: (event) => {
        this.dispatchKey('pressed', event);
      },
      keyup: (event) => {
        this.dispatchKey('released', event);
      },
      // Flickable / WheelHandler: wheel events
      wheel: (event) => {
        const point = toScenePoint(event);
        this.dispatchWheel(point.x, point.y, event);
      },
      // Stage H: clear hovers when pointer leaves canvas
      mouseleave: () => {
        this._clearAllHovers();
      },
    };

    canvas.addEventListener('mousedown', this._boundHandlers.mousedown);
    canvas.addEventListener('mouseup', this._boundHandlers.mouseup);
    canvas.addEventListener('mousemove', this._boundHandlers.mousemove);
    canvas.addEventListener('click', this._boundHandlers.click);
    canvas.addEventListener('keydown', this._boundHandlers.keydown);
    canvas.addEventListener('keyup', this._boundHandlers.keyup);
    canvas.addEventListener('wheel', this._boundHandlers.wheel, { passive: false });
    canvas.addEventListener('mouseleave', this._boundHandlers.mouseleave);
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
    this.canvas.removeEventListener('keydown', this._boundHandlers.keydown);
    this.canvas.removeEventListener('keyup', this._boundHandlers.keyup);
    this.canvas.removeEventListener('wheel', this._boundHandlers.wheel);
    this.canvas.removeEventListener('mouseleave', this._boundHandlers.mouseleave);

    this.canvas = null;
    this._boundHandlers = null;
  }

  dispatchPointer(type, sceneX, sceneY, originalEvent = null) {
    if (!(this.rootItem instanceof Item)) {
      return null;
    }

    // Stage I: collect open popups and handle modal blocking / CloseOnPressOutside
    if (type === 'down') {
      const openPopups = this._collectOpenPopups();
      if (openPopups.length > 0) {
        // Handle topmost popup first (highest z)
        const topPopup = openPopups[openPopups.length - 1];
        const insidePopup = topPopup.containsScenePoint(sceneX, sceneY);

        if (!insidePopup) {
          // CloseOnPressOutside: close the popup
          if (topPopup.closePolicy & Popup.CloseOnPressOutside) {
            topPopup.close();
            this.renderer.markDirty();
          }
          // Modal: block the event from reaching items behind
          if (topPopup.modal) {
            return null;
          }
        }
      }
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

    let acceptingItem = null;
    let current = target;
    while (current) {
      if (typeof current.handlePointerEvent === 'function') {
        const accepted = current.handlePointerEvent(type, event);
        if (accepted) {
          event.accepted = true;
          acceptingItem = current;
          break;
        }
      }
      current = current.parentItem;
    }

    // Stage D: auto-focus focusable controls when they accept a 'down' event
    if (type === 'down' && acceptingItem instanceof Item && acceptingItem._isFocusableByTab()) {
      this.forceActiveFocus(acceptingItem);
    }

    if (event.accepted) {
      this.renderer.markDirty();
    }

    // Stage H: update HoverHandlers on every move (even if no press-handler accepted)
    if (type === 'move') {
      this._dispatchHover(sceneX, sceneY);
    }

    return event;
  }

  // Stage I: collect all visible Popup instances from the item tree, sorted by z ascending
  _collectOpenPopups(item = this.rootItem, result = []) {
    if (!(item instanceof Item) || !item.visible) return result;
    if (item instanceof Popup) result.push(item);
    for (const child of item.childItems) {
      this._collectOpenPopups(child, result);
    }
    // Sort by z ascending so last element is topmost
    result.sort((a, b) => (a.z || 0) - (b.z || 0));
    return result;
  }

  // Stage C: Focus management

  // Collect all focusable items in depth-first order
  _collectFocusableItems(item = this.rootItem) {
    if (!(item instanceof Item) || !item.visible || !item.enabled) {
      return [];
    }
    const result = [];
    if (item._isFocusableByTab()) {
      result.push(item);
    }
    for (const child of item._sortedChildItemsAscending()) {
      result.push(...this._collectFocusableItems(child));
    }
    return result;
  }

  forceActiveFocus(item) {
    if (!(item instanceof Item)) {
      return;
    }
    const previous = this.activeFocusItem;
    if (previous === item) {
      return;
    }
    if (previous instanceof Item) {
      previous._setPropertyValue('activeFocus', false);
      previous._setPropertyValue('focus', false);
    }
    this.activeFocusItem = item;
    item._setPropertyValue('activeFocus', true);
    item._setPropertyValue('focus', true);
    this.renderer.markDirty();
  }

  clearFocus() {
    const previous = this.activeFocusItem;
    if (previous instanceof Item) {
      previous._setPropertyValue('activeFocus', false);
      previous._setPropertyValue('focus', false);
    }
    this.activeFocusItem = null;
    this.renderer.markDirty();
  }

  focusNext() {
    const items = this._collectFocusableItems();
    if (items.length === 0) return;
    const current = this.activeFocusItem;
    const idx = items.indexOf(current);
    const next = items[(idx + 1) % items.length];
    this.forceActiveFocus(next);
  }

  focusPrevious() {
    const items = this._collectFocusableItems();
    if (items.length === 0) return;
    const current = this.activeFocusItem;
    const idx = items.indexOf(current);
    const prev = items[(idx - 1 + items.length) % items.length];
    this.forceActiveFocus(prev);
  }

  // Stage C: Keyboard event dispatch
  dispatchKey(type, originalEvent) {
    // Stage I: handle Escape for open popups before normal key dispatch
    if (type === 'pressed' && originalEvent.key === 'Escape') {
      const openPopups = this._collectOpenPopups();
      if (openPopups.length > 0) {
        const topPopup = openPopups[openPopups.length - 1];
        if (topPopup.closePolicy & Popup.CloseOnEscape) {
          topPopup.close();
          this.renderer.markDirty();
          return { type, key: 'Escape', accepted: true };
        }
      }
    }

    const focusItem = this.activeFocusItem;
    if (!(focusItem instanceof Item)) {
      return null;
    }

    const event = {
      type,
      key: originalEvent.key,
      code: originalEvent.code,
      text: originalEvent.key && originalEvent.key.length === 1 ? originalEvent.key : '',
      ctrlKey: Boolean(originalEvent.ctrlKey),
      altKey: Boolean(originalEvent.altKey),
      shiftKey: Boolean(originalEvent.shiftKey),
      metaKey: Boolean(originalEvent.metaKey),
      // aliases for convenience
      ctrl: Boolean(originalEvent.ctrlKey),
      alt: Boolean(originalEvent.altKey),
      shift: Boolean(originalEvent.shiftKey),
      meta: Boolean(originalEvent.metaKey),
      originalEvent,
      accepted: false,
    };

    const handlerName = type === 'pressed' ? 'onPressed' : 'onReleased';

    // Bubble from activeFocusItem up via parentItem
    let current = focusItem;
    while (current instanceof Item) {
      if (current._keys && current._keys.enabled && typeof current._keys[handlerName] === 'function') {
        current._keys[handlerName].call(current, event);
        if (event.accepted) {
          break;
        }
      }
      current = current.parentItem;
    }

    // Handle Tab navigation at scene level
    if (!event.accepted && type === 'pressed' && originalEvent.key === 'Tab') {
      if (originalEvent.shiftKey) {
        this.focusPrevious();
      } else {
        this.focusNext();
      }
      if (originalEvent.preventDefault) {
        originalEvent.preventDefault();
      }
      event.accepted = true;
    }

    if (event.accepted) {
      this.renderer.markDirty();
    }
    return event;
  }

  // Flickable / WheelHandler / PinchHandler: Wheel event dispatch
  dispatchWheel(sceneX, sceneY, originalEvent) {
    if (!(this.rootItem instanceof Item)) return null;

    const target = this.rootItem.hitTest(sceneX, sceneY);
    if (!target) return null;

    // Walk up from target to find an item that accepts wheel events.
    // Pass sceneX/sceneY so WheelHandler/PinchHandler can check containsPoint.
    // Also scan each item's direct children for WheelHandler/PinchHandler
    // instances that have no own bounds (i.e. are attached to the parent).
    let current = target;
    while (current instanceof Item) {
      // First: check children for attached WheelHandler / PinchHandler
      for (const child of current.childItems) {
        if ((child instanceof WheelHandler || child instanceof PinchHandler) &&
            typeof child.handleWheelEvent === 'function' &&
            child !== target) {
          const accepted = child.handleWheelEvent(originalEvent, sceneX, sceneY);
          if (accepted) {
            if (originalEvent && typeof originalEvent.preventDefault === 'function') {
              originalEvent.preventDefault();
            }
            this.renderer.markDirty();
            return child;
          }
        }
      }

      // Then: check the item itself (e.g. Flickable, or WheelHandler found by hitTest)
      if (typeof current.handleWheelEvent === 'function') {
        const accepted = current.handleWheelEvent(originalEvent, sceneX, sceneY);
        if (accepted) {
          if (originalEvent && typeof originalEvent.preventDefault === 'function') {
            originalEvent.preventDefault();
          }
          this.renderer.markDirty();
          return current;
        }
      }
      current = current.parentItem;
    }

    return null;
  }

  // Stage H: HoverHandler support

  // Collect all HoverHandler instances depth-first
  _collectHoverHandlers(item = this.rootItem, result = []) {
    if (!(item instanceof Item)) return result;
    if (item instanceof HoverHandler) result.push(item);
    for (const child of item.childItems) {
      this._collectHoverHandlers(child, result);
    }
    return result;
  }

  // Update hover state for all HoverHandlers in the scene
  _dispatchHover(sceneX, sceneY) {
    const handlers = this._collectHoverHandlers();
    let dirty = false;
    for (const h of handlers) {
      const wasHovered = h.hovered;
      h._updateHover(sceneX, sceneY);
      if (h.hovered !== wasHovered) dirty = true;
    }
    if (dirty) this.renderer.markDirty();
  }

  // Clear all hover states (e.g. when pointer leaves canvas)
  _clearAllHovers() {
    const handlers = this._collectHoverHandlers();
    let dirty = false;
    for (const h of handlers) {
      if (h.hovered) {
        h._clearHover();
        dirty = true;
      }
    }
    if (dirty) this.renderer.markDirty();
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
    this.defineProperty('lineHeight', options.lineHeight ?? 1.0);
    this.defineProperty('lineHeightMode', options.lineHeightMode ?? 'ProportionalHeight');
    this.defineProperty('maximumLineCount', options.maximumLineCount ?? 0);
    this.defineProperty('textFormat', options.textFormat ?? 'PlainText');

    // Line layout cache; invalidated when any relevant property changes.
    this._lineCache = null;
    this._lineCacheKey = null;

    const invalidate = () => { this._lineCache = null; };
    this.connect('textChanged', invalidate);
    this.connect('fontChanged', invalidate);
    this.connect('wrapModeChanged', invalidate);
    this.connect('elideChanged', invalidate);
    this.connect('maximumLineCountChanged', invalidate);
    this.connect('widthChanged', invalidate);
  }

  /** Build a CSS font string from this item's font property. */
  _fontString() {
    return _buildFontString(this.font);
  }

  /**
   * Compute the array of visual text lines for the current properties.
   * Requires a canvas context for text-width measurement.
   */
  _buildLines(context) {
    const raw = String(this.text ?? '');
    if (!raw) return [];

    const fontString = this._fontString();
    const wrapMode = _normalizeWrapMode(this.wrapMode);
    const elide = _normalizeElide(this.elide);
    const maxLines = this.maximumLineCount || 0;
    const w = this.width || 0;

    // Split on explicit newlines first
    const paragraphs = raw.split('\n');
    const lines = [];

    for (const para of paragraphs) {
      if (wrapMode === 'wordwrap' && w > 0) {
        if (para === '') { lines.push(''); continue; }
        const words = para.split(' ');
        let cur = '';
        for (const word of words) {
          const candidate = cur ? cur + ' ' + word : word;
          if (cur !== '' && _measureTextWidth(context, fontString, candidate) > w) {
            lines.push(cur);
            cur = word;
          } else {
            cur = candidate;
          }
        }
        if (cur !== '') lines.push(cur);
      } else if (wrapMode === 'wrapanywhere' && w > 0) {
        if (para === '') { lines.push(''); continue; }
        let remaining = para;
        while (remaining.length > 0) {
          if (_measureTextWidth(context, fontString, remaining) <= w) {
            lines.push(remaining);
            break;
          }
          // Binary search for the break point
          let lo = 1;
          let hi = remaining.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (_measureTextWidth(context, fontString, remaining.slice(0, mid)) <= w) {
              lo = mid;
            } else {
              hi = mid - 1;
            }
          }
          lines.push(remaining.slice(0, lo));
          remaining = remaining.slice(lo);
        }
      } else {
        // NoWrap
        lines.push(para);
      }
    }

    if (lines.length === 0) lines.push('');

    // Apply maximumLineCount
    const capped = maxLines > 0 && lines.length > maxLines;
    if (capped) lines.splice(maxLines);

    // Apply elide on the last visible line
    if (elide !== 'none' && w > 0) {
      const lastLine = lines[lines.length - 1];
      const overflows = _measureTextWidth(context, fontString, lastLine) > w;
      if (capped || overflows) {
        if (elide === 'right') {
          let truncated = lastLine;
          while (truncated.length > 0 && _measureTextWidth(context, fontString, truncated + '\u2026') > w) {
            truncated = truncated.slice(0, -1);
          }
          lines[lines.length - 1] = truncated + '\u2026';
        }
      }
    }

    return lines;
  }

  /** Return cached lines, recomputing only when the cache key changes. */
  _getLines(context) {
    const key = `${this._fontString()}||${this.wrapMode}||${this.elide}||${this.maximumLineCount || 0}||${this.width || 0}||${String(this.text ?? '')}`;
    if (this._lineCache !== null && this._lineCacheKey === key) {
      return this._lineCache;
    }
    this._lineCache = this._buildLines(context);
    this._lineCacheKey = key;
    return this._lineCache;
  }

  /**
   * Recompute and update implicitWidth / implicitHeight from the current line layout.
   * Returns the array of lines.
   */
  _measure(context) {
    const lines = this._getLines(context);
    const fontString = this._fontString();
    const font = this.font || {};
    const pixelSize = font.pixelSize || 14;
    const lineH = pixelSize * (this.lineHeight || 1.0);
    let maxW = 0;
    for (const line of lines) {
      const lw = _measureTextWidth(context, fontString, line);
      if (lw > maxW) maxW = lw;
    }
    this.implicitWidth = maxW;
    this.implicitHeight = lines.length * lineH;
    return lines;
  }

  draw(context) {
    if (!context) return;
    const raw = String(this.text ?? '');
    if (!raw) return;

    const fontString = this._fontString();
    context.font = fontString;
    context.fillStyle = this.color || '#000000';
    context.textBaseline = 'top';

    const lines = this._measure(context);
    const font = this.font || {};
    const pixelSize = font.pixelSize || 14;
    const lineH = pixelSize * (this.lineHeight || 1.0);
    const totalH = lines.length * lineH;
    const w = this.width || 0;
    const h = this.height || 0;

    const ha = _normalizeHAlign(this.horizontalAlignment);
    const va = _normalizeVAlign(this.verticalAlignment);

    let startY = 0;
    if (va === 'vcenter' && h > 0) {
      startY = Math.max(0, (h - totalH) / 2);
    } else if (va === 'bottom' && h > 0) {
      startY = Math.max(0, h - totalH);
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineW = _measureTextWidth(context, fontString, line);
      let x = 0;
      if (ha === 'center' && w > 0) {
        x = (w - lineW) / 2;
      } else if (ha === 'right' && w > 0) {
        x = w - lineW;
      }
      context.fillText(line, x, startY + i * lineH);
    }
  }
}

// ---------------------------------------------------------------------------
// Stage E: Image – async image loading with cross-instance caching
// ---------------------------------------------------------------------------

class Image extends Item {
  constructor(options = {}) {
    super(options);

    /** Fill mode: 'Stretch' | 'PreserveAspectFit' | 'PreserveAspectCrop' | 'Pad' */
    this.defineProperty('source', options.source ?? '');
    this.defineProperty('fillMode', options.fillMode ?? 'Stretch');
    /**
     * Loading status:
     *   Image.Null    = 0
     *   Image.Loading = 1
     *   Image.Ready   = 2
     *   Image.Error   = 3
     */
    this.defineProperty('status', Image.Null);

    this._htmlImage = null;

    this.connect('sourceChanged', () => this._loadImage());

    if (this.source) {
      this._loadImage();
    }
  }

  _loadImage() {
    const src = this.source;
    if (!src) {
      this._htmlImage = null;
      this._setPropertyValue('status', Image.Null);
      return;
    }

    if (_imageCache.has(src)) {
      const cached = _imageCache.get(src);
      this._htmlImage = cached.img;
      this._setPropertyValue('status', cached.status);
      return;
    }

    this._setPropertyValue('status', Image.Loading);
    this._htmlImage = null;

    // Async loading only available in browser environments.
    if (!_HtmlImageCtor) {
      return;
    }

    const img = new _HtmlImageCtor();
    img.onload = () => {
      _imageCache.set(src, { img, status: Image.Ready });
      this._htmlImage = img;
      this._setPropertyValue('status', Image.Ready);
      if (this._layer) this._invalidateLayer();
    };
    img.onerror = () => {
      _imageCache.set(src, { img: null, status: Image.Error });
      this._htmlImage = null;
      this._setPropertyValue('status', Image.Error);
    };
    img.src = src;
  }

  draw(context) {
    if (!context || !this._htmlImage) return;

    const iw = this._htmlImage.naturalWidth || this._htmlImage.width || 0;
    const ih = this._htmlImage.naturalHeight || this._htmlImage.height || 0;

    const dw = this.width || this.implicitWidth || iw;
    const dh = this.height || this.implicitHeight || ih;
    if (dw <= 0 || dh <= 0) return;

    if (this.fillMode === 'PreserveAspectFit' && iw > 0 && ih > 0) {
      const s = Math.min(dw / iw, dh / ih);
      const fw = iw * s;
      const fh = ih * s;
      context.drawImage(this._htmlImage, (dw - fw) / 2, (dh - fh) / 2, fw, fh);
    } else if (this.fillMode === 'PreserveAspectCrop' && iw > 0 && ih > 0) {
      const s = Math.max(dw / iw, dh / ih);
      const fw = iw * s;
      const fh = ih * s;
      const sx = (fw - dw) / 2;
      const sy = (fh - dh) / 2;
      // Clip to item bounds before drawing
      context.save();
      context.rect(0, 0, dw, dh);
      context.clip();
      context.drawImage(this._htmlImage, -sx, -sy, fw, fh);
      context.restore();
    } else if (this.fillMode === 'Pad' && iw > 0 && ih > 0) {
      context.drawImage(this._htmlImage, 0, 0, iw, ih);
    } else {
      // Stretch (default)
      context.drawImage(this._htmlImage, 0, 0, dw, dh);
    }
  }
}

// Image status constants (mirrors Qt Quick)
Image.Null    = 0;
Image.Loading = 1;
Image.Ready   = 2;
Image.Error   = 3;

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
    Object.defineProperty(this._rows[index], role, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
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
  // Build a model proxy object that exposes model.index (and role fields when
  // rowData is an object), matching desktop QtQuick delegate context semantics.
  const modelObject = { index };
  if (rowData !== null && typeof rowData === 'object') {
    for (const key of Object.keys(rowData)) {
      if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
        modelObject[key] = rowData[key];
      }
    }
  } else {
    // For simple models (numeric / primitive array items), mirror modelData
    modelObject.modelData = rowData;
  }

  const contextValues = {
    index,
    model: modelObject,
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
// Flickable – QtQuick-like scrollable viewport
// ---------------------------------------------------------------------------

class Flickable extends Item {
  constructor(options = {}) {
    super(options);

    // --- Scrollable content dimensions ---
    this.defineProperty('contentX', options.contentX ?? 0);
    this.defineProperty('contentY', options.contentY ?? 0);
    this.defineProperty('contentWidth', options.contentWidth ?? 0);
    this.defineProperty('contentHeight', options.contentHeight ?? 0);

    // --- Behavior ---
    this.defineProperty('interactive', options.interactive ?? true);
    // 'HorizontalFlick' | 'VerticalFlick' | 'HorizontalAndVerticalFlick'
    this.defineProperty('flickableDirection', options.flickableDirection ?? 'VerticalFlick');
    // 'StopAtBounds' | 'DragOverBounds' | 'OvershootBounds'
    this.defineProperty('boundsBehavior', options.boundsBehavior ?? 'OvershootBounds');
    this.defineProperty('pressDelay', options.pressDelay ?? 0);

    // --- Read-only state (use _setPropertyValue internally) ---
    this.defineProperty('moving', false, { readOnly: true });
    this.defineProperty('dragging', false, { readOnly: true });
    this.defineProperty('flicking', false, { readOnly: true });

    // --- Velocity (read-only) ---
    this.defineProperty('velocity', { x: 0, y: 0 }, { readOnly: true });
    this.defineProperty('horizontalVelocity', 0, { readOnly: true });
    this.defineProperty('verticalVelocity', 0, { readOnly: true });

    // --- Flick parameters ---
    this.defineProperty('maximumFlickVelocity', options.maximumFlickVelocity ?? 2500);
    this.defineProperty('flickDeceleration', options.flickDeceleration ?? 1500);

    // --- Margins ---
    this.defineProperty('topMargin', options.topMargin ?? 0);
    this.defineProperty('bottomMargin', options.bottomMargin ?? 0);
    this.defineProperty('leftMargin', options.leftMargin ?? 0);
    this.defineProperty('rightMargin', options.rightMargin ?? 0);

    // --- Signals ---
    this.defineSignal('movementStarted');
    this.defineSignal('movementEnded');
    this.defineSignal('flickStarted');
    this.defineSignal('flickEnded');

    // --- Internal drag state ---
    this._dragActive = false;
    this._dragStartSceneX = 0;
    this._dragStartSceneY = 0;
    this._dragStartContentX = 0;
    this._dragStartContentY = 0;
    this._velocityPoints = [];   // [{ t, x, y }, ...]

    // --- Internal flick/rebound state ---
    this._flickVX = 0;
    this._flickVY = 0;
    this._flickingH = false;
    this._flickingV = false;
    this._reboundX = false;
    this._reboundY = false;

    // Ticker wrapper: _globalTicker calls _tick(dt) on registered objects
    this._flickTickerObj = { _tick: (dt) => this._onFlickTick(dt) };
    this._tickerActive = false;
  }

  // -----------------------------------------------------------------------
  // Rendering: tell CanvasRenderer to apply -contentX/-contentY before
  // drawing children.
  // -----------------------------------------------------------------------

  _getContentOffset() {
    const x = this.contentX || 0;
    const y = this.contentY || 0;
    return (x !== 0 || y !== 0) ? { x, y } : null;
  }

  // -----------------------------------------------------------------------
  // Hit testing: children are in logical content space, so adjust the scene
  // coordinates by the content offset before forwarding to children.
  // -----------------------------------------------------------------------

  hitTest(sceneX, sceneY) {
    if (!this.visible || !this.enabled) return null;

    const insideSelf = this.containsPoint(sceneX, sceneY);
    // Always block hits outside our own bounds (acts as viewport)
    if (!insideSelf) return null;

    const cX = this.contentX || 0;
    const cY = this.contentY || 0;

    let adjustedX = sceneX;
    let adjustedY = sceneY;

    if (cX !== 0 || cY !== 0) {
      // Map scene → local, add content offset, map back to scene.
      // This handles any rotation / scale applied to the Flickable itself.
      const local = this._mapFromScene(sceneX, sceneY);
      const adjusted = this._mapToScene(local.x + cX, local.y + cY);
      adjustedX = adjusted.x;
      adjustedY = adjusted.y;
    }

    for (const child of this._sortedChildItemsDescending()) {
      const hit = child.hitTest(adjustedX, adjustedY);
      if (hit) return hit;
    }

    // The Flickable itself is always a valid hit target within its bounds
    // so that drag / wheel events can be captured.
    return this;
  }

  // -----------------------------------------------------------------------
  // Bounds helpers
  // -----------------------------------------------------------------------

  _minContentX() { return -(this.leftMargin || 0); }
  _maxContentX() {
    return Math.max(0, (this.contentWidth || 0) - (this.width || 0)) + (this.rightMargin || 0);
  }
  _minContentY() { return -(this.topMargin || 0); }
  _maxContentY() {
    return Math.max(0, (this.contentHeight || 0) - (this.height || 0)) + (this.bottomMargin || 0);
  }

  _canFlickH() {
    const d = this.flickableDirection || 'VerticalFlick';
    return d === 'HorizontalFlick' || d === 'HorizontalAndVerticalFlick';
  }
  _canFlickV() {
    const d = this.flickableDirection || 'VerticalFlick';
    return d === 'VerticalFlick' || d === 'HorizontalAndVerticalFlick';
  }

  // Apply bounds behavior during drag (returns the adjusted coordinate).
  _applyDragBoundsX(x) {
    const min = this._minContentX();
    const max = this._maxContentX();
    if (this.boundsBehavior === 'StopAtBounds') {
      return Math.max(min, Math.min(max, x));
    }
    // DragOverBounds / OvershootBounds: resistance beyond limits
    if (x < min) return min + (x - min) * 0.3;
    if (x > max) return max + (x - max) * 0.3;
    return x;
  }
  _applyDragBoundsY(y) {
    const min = this._minContentY();
    const max = this._maxContentY();
    if (this.boundsBehavior === 'StopAtBounds') {
      return Math.max(min, Math.min(max, y));
    }
    if (y < min) return min + (y - min) * 0.3;
    if (y > max) return max + (y - max) * 0.3;
    return y;
  }

  _clampX(x) {
    return Math.max(this._minContentX(), Math.min(this._maxContentX(), x));
  }
  _clampY(y) {
    return Math.max(this._minContentY(), Math.min(this._maxContentY(), y));
  }

  _isOutOfBoundsX() {
    const x = this.contentX || 0;
    return x < this._minContentX() || x > this._maxContentX();
  }
  _isOutOfBoundsY() {
    const y = this.contentY || 0;
    return y < this._minContentY() || y > this._maxContentY();
  }

  // -----------------------------------------------------------------------
  // Velocity tracking
  // -----------------------------------------------------------------------

  _computeVelocity() {
    const pts = this._velocityPoints;
    if (pts.length < 2) return { x: 0, y: 0 };

    const now = pts[pts.length - 1].t;
    // Walk from the oldest sample toward the newest; stop at the first sample
    // that falls within the last 100 ms.  That gives us the oldest sample in
    // the recent window so we compute velocity over the longest stable interval.
    let oldest = pts[pts.length - 2]; // sensible fallback: second-to-last
    for (let i = 0; i < pts.length; i++) {
      if (now - pts[i].t <= 100) {
        oldest = pts[i];
        break;
      }
    }

    const dt = (now - oldest.t) / 1000;
    if (dt <= 0) return { x: 0, y: 0 };

    const latest = pts[pts.length - 1];
    return {
      x: (latest.x - oldest.x) / dt,
      y: (latest.y - oldest.y) / dt,
    };
  }

  // -----------------------------------------------------------------------
  // Pointer event handling (drag-to-scroll)
  // -----------------------------------------------------------------------

  handlePointerEvent(type, event) {
    if (!this.interactive) return false;

    if (type === 'down') {
      this._dragActive = true;
      this._dragStartSceneX = event.sceneX;
      this._dragStartSceneY = event.sceneY;
      this._dragStartContentX = this.contentX || 0;
      this._dragStartContentY = this.contentY || 0;
      this._velocityPoints = [{ t: Date.now(), x: event.sceneX, y: event.sceneY }];
      this._stopFlick();
      if (!this.moving) {
        this._setPropertyValue('moving', true);
        this.movementStarted.emit();
      }
      this._setPropertyValue('dragging', true);
      return true;
    }

    if (type === 'move' && this._dragActive) {
      const dx = event.sceneX - this._dragStartSceneX;
      const dy = event.sceneY - this._dragStartSceneY;

      this._velocityPoints.push({ t: Date.now(), x: event.sceneX, y: event.sceneY });
      if (this._velocityPoints.length > 20) this._velocityPoints.shift();

      if (this._canFlickH()) {
        this.contentX = this._applyDragBoundsX(this._dragStartContentX - dx);
      }
      if (this._canFlickV()) {
        this.contentY = this._applyDragBoundsY(this._dragStartContentY - dy);
      }

      // Update velocity read-only properties while dragging
      const dragVel = this._computeVelocity();
      const dvX = -dragVel.x;
      const dvY = -dragVel.y;
      this._setPropertyValue('horizontalVelocity', dvX);
      this._setPropertyValue('verticalVelocity', dvY);
      this._setPropertyValue('velocity', { x: dvX, y: dvY });

      return true;
    }

    if (type === 'up' && this._dragActive) {
      this._dragActive = false;
      this._setPropertyValue('dragging', false);

      const vel = this._computeVelocity();
      // Scene velocity: positive sceneX = moved right → content moved left → contentX decreased
      const flickVX = -vel.x;
      const flickVY = -vel.y;

      const maxV = this.maximumFlickVelocity || 2500;
      const cvx = Math.max(-maxV, Math.min(maxV, flickVX));
      const cvy = Math.max(-maxV, Math.min(maxV, flickVY));

      const threshold = 50;
      let willFlick = false;

      if (this._canFlickH() && Math.abs(cvx) > threshold) {
        this._flickVX = cvx;
        this._flickingH = true;
        willFlick = true;
      }
      if (this._canFlickV() && Math.abs(cvy) > threshold) {
        this._flickVY = cvy;
        this._flickingV = true;
        willFlick = true;
      }

      // Rebound if content was dragged out of bounds
      if (!this._flickingH && this._isOutOfBoundsX()) {
        this._reboundX = true;
        willFlick = true;
      }
      if (!this._flickingV && this._isOutOfBoundsY()) {
        this._reboundY = true;
        willFlick = true;
      }

      if (willFlick) {
        const anyKineticFlick = this._flickingH || this._flickingV;
        if (anyKineticFlick) {
          this._setPropertyValue('flicking', true);
          this.flickStarted.emit();
        }
        this._startTicker();
      } else {
        // No flick: clear velocity read-only properties
        this._setPropertyValue('horizontalVelocity', 0);
        this._setPropertyValue('verticalVelocity', 0);
        this._setPropertyValue('velocity', { x: 0, y: 0 });
        this._setPropertyValue('moving', false);
        this.movementEnded.emit();
      }

      return true;
    }

    return false;
  }

  // -----------------------------------------------------------------------
  // Wheel event handling
  // -----------------------------------------------------------------------

  handleWheelEvent(event) {
    if (!this.interactive) return false;

    // deltaMode: 0 = pixels, 1 = lines (~40 px), 2 = pages
    const lineSize = 40;
    const pageH = this.height || 400;
    const pageW = this.width || 400;
    let dx = event.deltaX || 0;
    let dy = event.deltaY || 0;
    if (event.deltaMode === 1) { dx *= lineSize; dy *= lineSize; }
    else if (event.deltaMode === 2) { dx *= pageW; dy *= pageH; }

    this._stopFlick();

    if (this._canFlickH() && dx !== 0) {
      this.contentX = this._clampX((this.contentX || 0) + dx);
    }
    if (this._canFlickV() && dy !== 0) {
      this.contentY = this._clampY((this.contentY || 0) + dy);
    }

    return (this._canFlickH() && dx !== 0) || (this._canFlickV() && dy !== 0);
  }

  // -----------------------------------------------------------------------
  // Kinetic flick / rebound animation via _globalTicker
  // -----------------------------------------------------------------------

  _startTicker() {
    if (!this._tickerActive) {
      this._tickerActive = true;
      _globalTicker.add(this._flickTickerObj);
    }
  }

  _stopTicker() {
    if (this._tickerActive) {
      _globalTicker.remove(this._flickTickerObj);
      this._tickerActive = false;
    }
  }

  _stopFlick() {
    this._flickingH = false;
    this._flickingV = false;
    this._reboundX = false;
    this._reboundY = false;
    this._flickVX = 0;
    this._flickVY = 0;
    this._stopTicker();
  }

  _onFlickTick(dt) {
    if (dt <= 0) return;
    const dtSec = dt / 1000;
    const decel = this.flickDeceleration || 1500;
    const bb = this.boundsBehavior || 'OvershootBounds';

    // --- Horizontal flick ---
    if (this._flickingH) {
      const sign = this._flickVX > 0 ? 1 : -1;
      this._flickVX -= sign * decel * dtSec;
      // Deceleration crossed zero → stop
      if (sign > 0 ? this._flickVX <= 0 : this._flickVX >= 0) {
        this._flickVX = 0;
        this._flickingH = false;
      }

      let newX = (this.contentX || 0) + this._flickVX * dtSec;
      const minX = this._minContentX();
      const maxX = this._maxContentX();

      if (newX < minX) {
        if (bb === 'OvershootBounds') {
          this._flickVX = 0;
          this._flickingH = false;
          this._reboundX = true;
        } else {
          newX = minX;
          this._flickVX = 0;
          this._flickingH = false;
        }
      } else if (newX > maxX) {
        if (bb === 'OvershootBounds') {
          this._flickVX = 0;
          this._flickingH = false;
          this._reboundX = true;
        } else {
          newX = maxX;
          this._flickVX = 0;
          this._flickingH = false;
        }
      }

      this.contentX = newX;
    }

    // --- Vertical flick ---
    if (this._flickingV) {
      const sign = this._flickVY > 0 ? 1 : -1;
      this._flickVY -= sign * decel * dtSec;
      if (sign > 0 ? this._flickVY <= 0 : this._flickVY >= 0) {
        this._flickVY = 0;
        this._flickingV = false;
      }

      let newY = (this.contentY || 0) + this._flickVY * dtSec;
      const minY = this._minContentY();
      const maxY = this._maxContentY();

      if (newY < minY) {
        if (bb === 'OvershootBounds') {
          this._flickVY = 0;
          this._flickingV = false;
          this._reboundY = true;
        } else {
          newY = minY;
          this._flickVY = 0;
          this._flickingV = false;
        }
      } else if (newY > maxY) {
        if (bb === 'OvershootBounds') {
          this._flickVY = 0;
          this._flickingV = false;
          this._reboundY = true;
        } else {
          newY = maxY;
          this._flickVY = 0;
          this._flickingV = false;
        }
      }

      this.contentY = newY;
    }

    // --- Rebound X (spring back to bounds) ---
    if (this._reboundX) {
      const minX = this._minContentX();
      const maxX = this._maxContentX();
      const x = this.contentX || 0;
      const targetX = x < minX ? minX : x > maxX ? maxX : x;
      if (x !== targetX) {
        const factor = 1 - Math.exp(-10 * dtSec);
        const newX = x + (targetX - x) * factor;
        if (Math.abs(newX - targetX) < 0.5) {
          this.contentX = targetX;
          this._reboundX = false;
        } else {
          this.contentX = newX;
        }
      } else {
        this._reboundX = false;
      }
    }

    // --- Rebound Y (spring back to bounds) ---
    if (this._reboundY) {
      const minY = this._minContentY();
      const maxY = this._maxContentY();
      const y = this.contentY || 0;
      const targetY = y < minY ? minY : y > maxY ? maxY : y;
      if (y !== targetY) {
        const factor = 1 - Math.exp(-10 * dtSec);
        const newY = y + (targetY - y) * factor;
        if (Math.abs(newY - targetY) < 0.5) {
          this.contentY = targetY;
          this._reboundY = false;
        } else {
          this.contentY = newY;
        }
      } else {
        this._reboundY = false;
      }
    }

    // --- Stop ticker when everything has settled ---
    const anyActive = this._flickingH || this._flickingV || this._reboundX || this._reboundY;

    // Keep read-only velocity properties in sync with current flick velocity
    this._setPropertyValue('horizontalVelocity', this._flickVX);
    this._setPropertyValue('verticalVelocity', this._flickVY);
    this._setPropertyValue('velocity', { x: this._flickVX, y: this._flickVY });

    if (!anyActive) {
      const wasFlicking = this.flicking;
      this._stopTicker();
      this._setPropertyValue('flicking', false);
      this._setPropertyValue('moving', false);
      if (wasFlicking) this.flickEnded.emit();
      this.movementEnded.emit();
    }
  }

  destroy() {
    this._stopTicker();
    super.destroy();
  }
}

// ---------------------------------------------------------------------------
// Stage B: ListView – virtualized list, inherits Flickable for scrolling
// ---------------------------------------------------------------------------

class ListView extends Flickable {
  constructor(options = {}) {
    super(options);

    this._delegateItems = [];        // sparse array of created delegate instances
    this._modelDisconnectors = [];
    this._rebuilding = false;

    // Header / footer item instances
    this._headerItem = null;
    this._footerItem = null;

    // Reuse pool: offscreen delegates are parked here instead of destroyed
    this._reusePool = [];
    this._maxPoolSize = 20;

    // Variable-size cache: _sizeCache[i] = measured size (height for vertical,
    // width for horizontal) of delegate at index i.  Undefined means "use default".
    this._sizeCache = [];
    // Default size estimate used for unmeasured items. Updated from the first
    // measured item (mirroring old _delegateHeight behaviour).
    // Also settable as `lv._delegateHeight = N` for backwards compatibility.
    this._defaultDelegateSize = 40;

    // Prefix-sum array: _prefixSums[i] = position offset of item i in content space.
    // _prefixSums[count] = total delegate area including trailing spacing removed.
    this._prefixSums = [0];

    // Disconnector functions for size-change listeners on live delegate items.
    this._sizeDisconnectors = [];  // indexed by delegate index

    this.defineProperty('model', null);
    // reuseItems controls whether offscreen delegates are pooled for reuse
    // (false by default, matching desktop QtQuick behaviour).
    this.defineProperty('reuseItems', false);
    this.defineProperty('delegate', null);
    this.defineProperty('spacing', 0);
    this.defineProperty('cacheBuffer', 40);  // extra pixels above/below to pre-create

    // Orientation: 'vertical' (default) stacks items top-to-bottom;
    // 'horizontal' stacks items left-to-right.
    const _initialOrientation = options.orientation ?? 'vertical';
    this.defineProperty('orientation', _initialOrientation);
    // Sync flickableDirection with initial orientation.
    if (_initialOrientation === 'horizontal') {
      this.flickableDirection = 'HorizontalFlick';
    }

    // Selection / current
    this.defineProperty('currentIndex', -1);
    this.defineProperty('currentItem', null);
    this.defineProperty('highlight', null);
    this.defineProperty('highlightItem', null);
    this.defineProperty('highlightFollowsCurrentItem', true);

    // Header / footer components or items
    this.defineProperty('header', null);
    this.defineProperty('footer', null);

    // Read-only count mirror
    this.defineProperty('count', 0);

    // Viewport boundary flags
    this.defineProperty('atYBegin', true);
    this.defineProperty('atYEnd', false);

    // ListView is focusable so it can receive keyboard events
    this.focusable = true;

    // Delegate reuse signals – kept for backwards compatibility.
    // Primary Qt-like path: ListView.onPooled / ListView.onReused attached
    // handlers on the delegate item (see _invokeAttachedHandler).
    this.defineSignal('pooled');   // pooled(item, index)
    this.defineSignal('reused');   // reused(item, index)

    // Wire up change listeners
    this.connect('modelChanged', (newModel, oldModel) => this._onModelReplaced(newModel, oldModel));
    this.connect('delegateChanged', () => this._rebuild());
    this.connect('orientationChanged', () => {
      // Adjust flickableDirection to match the new orientation.
      this.flickableDirection = this._isVertical() ? 'VerticalFlick' : 'HorizontalFlick';
      this._rebuild();
    });
    this.connect('contentYChanged', () => {
      this._updateVirtualization();
      this._updateAtBounds();
    });
    this.connect('contentXChanged', () => {
      this._updateVirtualization();
      this._updateAtBounds();
    });
    this.connect('heightChanged', () => {
      this._updateVirtualization();
      this._updateAtBounds();
    });
    this.connect('widthChanged', () => {
      this._updateVirtualization();
      this._updateAtBounds();
    });
    this.connect('currentIndexChanged', () => this._onCurrentIndexChanged());
    this.connect('highlightChanged', () => this._onHighlightChanged());
    this.connect('headerChanged', () => this._onHeaderFooterChanged('header'));
    this.connect('footerChanged', () => this._onHeaderFooterChanged('footer'));

    // Keyboard navigation: ArrowUp/Down/Left/Right, PageUp/Down
    this.keys.onPressed = (event) => this._handleListViewKey(event);

    if (options.orientation !== undefined) this.orientation = options.orientation;
    if (options.model !== undefined) this.model = options.model;
    if (options.delegate !== undefined) this.delegate = options.delegate;
    if (options.contentY !== undefined) this.contentY = options.contentY;
    if (options.contentX !== undefined) this.contentX = options.contentX;
  }

  // -----------------------------------------------------------------------
  // Backwards-compat: _delegateHeight getter/setter maps to _defaultDelegateSize
  // -----------------------------------------------------------------------

  get _delegateHeight() { return this._defaultDelegateSize; }
  set _delegateHeight(v) { this._defaultDelegateSize = v; }

  // -----------------------------------------------------------------------
  // Orientation helpers
  // -----------------------------------------------------------------------

  _isVertical() {
    return (this.orientation || 'vertical') === 'vertical';
  }

  // Returns the "main-axis" size of a created delegate item.
  _getItemMainSize(item) {
    if (this._isVertical()) {
      return item.height || item.implicitHeight || this._defaultDelegateSize;
    }
    return item.width || item.implicitWidth || this._defaultDelegateSize;
  }

  // Returns the cached size for index i, falling back to the default.
  _getDelegateSize(i) {
    const s = this._sizeCache[i];
    return (s !== undefined && s > 0) ? s : this._defaultDelegateSize;
  }

  // -----------------------------------------------------------------------
  // Prefix-sum helpers (variable-size virtualization)
  // -----------------------------------------------------------------------

  // Rebuild the full prefix-sum array from _sizeCache.
  // _prefixSums[i] = position offset (start) of item i in the delegate content area.
  // _prefixSums[count] = totalDelegateSize + spacing (used for total-size calc).
  _buildPrefixSums() {
    const count = _modelCount(this.model);
    const sp = this.spacing || 0;
    const ps = new Array(count + 1);
    ps[0] = 0;
    for (let i = 0; i < count; i++) {
      ps[i + 1] = ps[i] + this._getDelegateSize(i) + sp;
    }
    this._prefixSums = ps;
  }

  // Position offset (start of item i) in delegate content area.
  _offsetAtIndex(i) {
    if (i <= 0) return 0;
    if (i < this._prefixSums.length) return this._prefixSums[i];
    // Extend on-the-fly if prefix sums haven't been fully built yet.
    const psLen = this._prefixSums.length;
    const last = psLen > 0 ? this._prefixSums[psLen - 1] : 0;
    const missing = i - (psLen - 1);
    return last + missing * (this._defaultDelegateSize + (this.spacing || 0));
  }

  // Binary search: returns the last index i such that _prefixSums[i] <= offset.
  // This is the index of the item whose start position is <= offset.
  // Uses upper-biased midpoint so the search always converges.
  _indexAtOffset(offset) {
    const count = _modelCount(this.model);
    if (count === 0) return 0;
    if (offset <= 0) return 0;
    const ps = this._prefixSums;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;  // upper-biased midpoint (avoids infinite loop)
      if (ps[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  // Total size occupied by all delegates (including inter-item spacing, excluding trailing).
  _totalDelegateSize() {
    const count = _modelCount(this.model);
    if (count === 0) return 0;
    const sp = this.spacing || 0;
    // _prefixSums[count] = sum of (size + spacing) for all items.
    // Subtract one trailing spacing.
    if (this._prefixSums.length > count) {
      return this._prefixSums[count] - sp;
    }
    // Fallback: sum directly
    let s = 0;
    for (let i = 0; i < count; i++) {
      s += this._getDelegateSize(i);
      if (i < count - 1) s += sp;
    }
    return s;
  }

  // -----------------------------------------------------------------------
  // Attached handler support (Qt-like ListView.onPooled / ListView.onReused)
  // -----------------------------------------------------------------------

  // Returns (creating if needed) the _listViewAttached bag on a delegate item.
  static _getAttached(item) {
    if (!item._listViewAttached) {
      item._listViewAttached = { onPooled: null, onReused: null };
    }
    return item._listViewAttached;
  }

  // Invoke an attached handler (0 args, called with item as `this`).
  static _invokeAttachedHandler(item, handlerName) {
    const bag = item._listViewAttached;
    if (!bag) return;
    const fn = bag[handlerName];
    if (typeof fn === 'function') fn.call(item);
  }

  // Alias: viewportHeight reads height
  get viewportHeight() {
    return this._isVertical() ? (this.height || 0) : (this.width || 0);
  }

  // -----------------------------------------------------------------------
  // Header / footer helpers
  // -----------------------------------------------------------------------

  _headerSize() {
    if (!this._headerItem) return 0;
    return this._isVertical()
      ? (this._headerItem.height || 0)
      : (this._headerItem.width || 0);
  }

  _footerSize() {
    if (!this._footerItem) return 0;
    return this._isVertical()
      ? (this._footerItem.height || 0)
      : (this._footerItem.width || 0);
  }

  // Keep backwards-compat aliases used by Flickable internals
  _headerHeight() { return this._isVertical() ? this._headerSize() : 0; }
  _footerHeight()  { return this._isVertical() ? this._footerSize() : 0; }

  _onHeaderFooterChanged(which) {
    const isHeader = which === 'header';
    const existingItem = isHeader ? this._headerItem : this._footerItem;
    if (existingItem) existingItem.destroy();
    if (isHeader) this._headerItem = null;
    else this._footerItem = null;

    const value = isHeader ? this.header : this.footer;
    let created = null;
    if (value instanceof Component) {
      created = value.createObject(this, {}, this.getContext(), this.getComponentScope());
    } else if (value instanceof Item) {
      created = value;
      created.parentItem = this;
    }
    if (created) {
      if (this._isVertical()) {
        created.x = 0;
        created.y = isHeader ? 0 : this._headerSize() + this._totalDelegateSize();
      } else {
        created.y = 0;
        created.x = isHeader ? 0 : this._headerSize() + this._totalDelegateSize();
      }
    }
    if (isHeader) this._headerItem = created;
    else this._footerItem = created;

    this._rebuild();
  }

  _positionFooter() {
    if (!this._footerItem) return;
    if (this._isVertical()) {
      this._footerItem.y = this._headerSize() + this._totalDelegateSize();
      this._footerItem.x = 0;
    } else {
      this._footerItem.x = this._headerSize() + this._totalDelegateSize();
      this._footerItem.y = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Content size helpers
  // -----------------------------------------------------------------------

  _totalContentSize() {
    return this._headerSize() + this._totalDelegateSize() + this._footerSize();
  }

  // -----------------------------------------------------------------------
  // Model helpers
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Size-change listener helpers
  // -----------------------------------------------------------------------

  // Connect to size changes on a live delegate so the layout reacts.
  _connectSizeListener(item, index) {
    const prop = this._isVertical() ? 'heightChanged' : 'widthChanged';
    const handler = () => this._onDelegateSizeChanged(index);
    const disconnect = item.connect(prop, handler);
    this._sizeDisconnectors[index] = disconnect;
  }

  _disconnectSizeListener(index) {
    const d = this._sizeDisconnectors[index];
    if (typeof d === 'function') {
      d();
      this._sizeDisconnectors[index] = undefined;
    }
  }

  // Called when a live delegate's size changes.
  _onDelegateSizeChanged(index) {
    const item = this._delegateItems[index];
    if (!item) return;
    const newSize = this._getItemMainSize(item);
    if (this._sizeCache[index] === newSize) return;  // no actual change
    this._sizeCache[index] = newSize;
    this._buildPrefixSums();
    this._updateContentSize();
    this._positionAllVisible();
    this._positionFooter();
    this._updateHighlight();
  }

  // Update the Flickable's contentHeight (vertical) or contentWidth (horizontal).
  _updateContentSize() {
    const total = this._totalContentSize();
    if (this._isVertical()) {
      this._setPropertyValue('contentHeight', total);
    } else {
      this._setPropertyValue('contentWidth', total);
    }
  }

  // -----------------------------------------------------------------------
  // Rebuild / virtualization
  // -----------------------------------------------------------------------

  _rebuild() {
    if (this._rebuilding) return;
    this._rebuilding = true;
    try {
      // Disconnect all size listeners
      for (let i = 0; i < this._sizeDisconnectors.length; i++) {
        this._disconnectSizeListener(i);
      }
      this._sizeDisconnectors = [];

      // Drain reuse pool
      for (const item of this._reusePool) {
        item.destroy();
      }
      this._reusePool = [];

      for (const item of this._delegateItems) {
        if (item) item.destroy();
      }
      this._delegateItems = [];

      const count = _modelCount(this.model);
      this._delegateItems = new Array(count).fill(null);

      // Reset size cache but keep measured sizes for indices still in range
      this._sizeCache = new Array(count).fill(undefined);

      this._buildPrefixSums();
      this._setPropertyValue('count', count);
      this._updateContentSize();
      this._positionFooter();
      this._updateVirtualization();
    } finally {
      this._rebuilding = false;
    }
  }

  _updateVirtualization() {
    const count = _modelCount(this.model);
    if (count === 0 || !(this.delegate instanceof Component)) {
      this._setPropertyValue('count', 0);
      if (this._isVertical()) {
        this._setPropertyValue('contentHeight', this._headerSize() + this._footerSize());
      } else {
        this._setPropertyValue('contentWidth', this._headerSize() + this._footerSize());
      }
      this._positionFooter();
      return;
    }

    this._setPropertyValue('count', count);
    this._updateContentSize();
    this._positionFooter();

    const vert = this._isVertical();
    const viewSize = vert ? (this.height || 0) : (this.width || 0);
    const scrollPos = Math.max(0, vert ? (this.contentY || 0) : (this.contentX || 0));
    const buffer = this.cacheBuffer || 0;
    const headerS = this._headerSize();

    // Visible range in delegate content space (after header)
    const delegateOffset = scrollPos - headerS;
    const firstVisible = Math.max(0, this._indexAtOffset(Math.max(0, delegateOffset - buffer)));
    const lastVisible = Math.min(
      count - 1,
      this._indexAtOffset(delegateOffset + viewSize + buffer),
    );

    // Ensure sparse array is large enough
    if (this._delegateItems.length < count) {
      this._delegateItems.length = count;
    }

    // Pool or destroy items outside visible range
    for (let i = 0; i < this._delegateItems.length; i++) {
      const item = this._delegateItems[i];
      if (item && (i < firstVisible || i > lastVisible)) {
        this._disconnectSizeListener(i);
        if (this.reuseItems && this._reusePool.length < this._maxPoolSize) {
          item.visible = false;
          ListView._invokeAttachedHandler(item, 'onPooled');
          this.pooled.emit(item, i);
          this._reusePool.push(item);
        } else {
          item.destroy();
        }
        this._delegateItems[i] = null;
      }
    }

    // Create and position items within visible range.
    // Items are placed at their LOGICAL content position (not offset by
    // contentY/contentX) because the Flickable applies the translate via
    // _getContentOffset().
    for (let i = firstVisible; i <= lastVisible && i < count; i++) {
      if (!this._delegateItems[i]) {
        this._delegateItems[i] = this._reuseOrCreateDelegateAt(i);
        if (this._delegateItems[i]) {
          // Measure and cache the actual size for this index.
          const s = this._getItemMainSize(this._delegateItems[i]);
          if (s > 0 && this._sizeCache[i] !== s) {
            this._sizeCache[i] = s;
            // Update the default size estimate from the first measured item so
            // that unmeasured (off-screen) items use a realistic fallback.
            if (i === 0) this._defaultDelegateSize = s;
            this._buildPrefixSums();
            this._updateContentSize();
          }
          this._connectSizeListener(this._delegateItems[i], i);
        }
      }
      this._positionDelegateItem(i);
    }

    // Keep currentItem reference in sync after virtualization
    const ci = this.currentIndex;
    if (ci >= 0 && ci < count) {
      this._setPropertyValue('currentItem', this._delegateItems[ci] ?? null);
    }

    this._updateAtBounds();
    this._updateHighlight();
  }

  // Re-position all currently-visible items (used after size changes).
  _positionAllVisible() {
    for (let i = 0; i < this._delegateItems.length; i++) {
      if (this._delegateItems[i]) {
        this._positionDelegateItem(i);
      }
    }
  }

  _positionDelegateItem(i) {
    const item = this._delegateItems[i];
    if (!item) return;
    const headerS = this._headerSize();
    const pos = headerS + this._offsetAtIndex(i);
    if (this._isVertical()) {
      item.y = pos;
      item.x = 0;
    } else {
      item.x = pos;
      item.y = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Delegate creation with reuse pool
  // -----------------------------------------------------------------------

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

  _reuseOrCreateDelegateAt(index) {
    if (this._reusePool.length > 0) {
      const item = this._reusePool.pop();
      const model = this.model;
      const rowData = _modelRowData(model, index);
      const parentContext = this.getContext();
      const newContext = _buildDelegateContext(parentContext, model, index, rowData);
      // Update the item's context and re-evaluate all bindings so that
      // context-bound expressions (index, modelData, named role props) refresh.
      item.setContext(newContext);
      this._reevaluateBindings(item);
      item.visible = true;
      // Fire attached handler (0 args) then backwards-compat signal.
      ListView._invokeAttachedHandler(item, 'onReused');
      this.reused.emit(item, index);
      return item;
    }
    return this._createDelegateAt(index);
  }

  // Re-evaluate all property bindings on item and its subtree so that
  // context-derived expressions pick up new context values.
  _reevaluateBindings(item) {
    for (const [name, state] of item._propertyBindings.entries()) {
      for (const disconnect of state.dependencies.values()) {
        disconnect();
      }
      state.dependencies.clear();
      item._evaluateBinding(name, state);
    }
    for (const child of item._children) {
      if (child instanceof QObject) {
        this._reevaluateBindings(child);
      }
    }
  }

  _onDataChanged(index) {
    this._disconnectSizeListener(index);
    const old = this._delegateItems[index];
    if (old) {
      old.destroy();
      this._delegateItems[index] = null;
    }
    // Clear size cache for this index so it gets re-measured on recreation.
    if (index < this._sizeCache.length) {
      this._sizeCache[index] = undefined;
    }
    // Will be recreated on next _updateVirtualization call
    this._updateVirtualization();
  }

  // -----------------------------------------------------------------------
  // Selection / current index
  // -----------------------------------------------------------------------

  _onCurrentIndexChanged() {
    const count = _modelCount(this.model);
    const ci = this.currentIndex;
    const valid = ci >= 0 && ci < count;

    if (valid) {
      // Ensure the delegate item for this index exists
      if (!this._delegateItems[ci] && this.delegate instanceof Component) {
        if (this._delegateItems.length <= ci) {
          this._delegateItems.length = ci + 1;
        }
        this._delegateItems[ci] = this._reuseOrCreateDelegateAt(ci);
        if (this._delegateItems[ci]) {
          const s = this._getItemMainSize(this._delegateItems[ci]);
          if (s > 0 && this._sizeCache[ci] !== s) {
            this._sizeCache[ci] = s;
            this._buildPrefixSums();
            this._updateContentSize();
          }
          this._connectSizeListener(this._delegateItems[ci], ci);
        }
        this._positionDelegateItem(ci);
      }
      this._setPropertyValue('currentItem', this._delegateItems[ci] ?? null);
    } else {
      this._setPropertyValue('currentItem', null);
    }

    if (valid) this._scrollToCurrentIfNeeded();
    this._updateHighlight();
  }

  _scrollToCurrentIfNeeded() {
    const ci = this.currentIndex;
    if (ci < 0) return;
    const headerS = this._headerSize();
    const itemStart = headerS + this._offsetAtIndex(ci);
    const itemSize = this._getDelegateSize(ci);
    const itemEnd = itemStart + itemSize;

    if (this._isVertical()) {
      const viewTop = this.contentY || 0;
      const viewBottom = viewTop + (this.height || 0);
      if (itemStart < viewTop) {
        this.contentY = this._clampY(itemStart);
      } else if (itemEnd > viewBottom) {
        this.contentY = this._clampY(itemEnd - (this.height || 0));
      }
    } else {
      const viewLeft = this.contentX || 0;
      const viewRight = viewLeft + (this.width || 0);
      if (itemStart < viewLeft) {
        this.contentX = this._clampX(itemStart);
      } else if (itemEnd > viewRight) {
        this.contentX = this._clampX(itemEnd - (this.width || 0));
      }
    }
  }

  // -----------------------------------------------------------------------
  // Highlight
  // -----------------------------------------------------------------------

  _onHighlightChanged() {
    const existing = this.highlightItem;
    if (existing) {
      existing.destroy();
      this._setPropertyValue('highlightItem', null);
    }
    const h = this.highlight;
    let hi = null;
    if (h instanceof Component) {
      hi = h.createObject(this, {}, this.getContext(), this.getComponentScope());
    } else if (h instanceof Item) {
      hi = h;
      hi.parentItem = this;
    }
    if (hi) {
      hi.z = -1;  // render behind delegates
    }
    this._setPropertyValue('highlightItem', hi);
    this._updateHighlight();
  }

  _updateHighlight() {
    const hi = this.highlightItem;
    if (!hi || !this.highlightFollowsCurrentItem) return;
    const ci = this.currentIndex;
    if (ci < 0 || ci >= _modelCount(this.model)) {
      hi.visible = false;
      return;
    }
    const headerS = this._headerSize();
    const pos = headerS + this._offsetAtIndex(ci);
    const size = this._getDelegateSize(ci);
    if (this._isVertical()) {
      hi.y = pos;
      hi.x = 0;
      hi.width = this.width || 0;
      hi.height = size;
    } else {
      hi.x = pos;
      hi.y = 0;
      hi.height = this.height || 0;
      hi.width = size;
    }
    hi.visible = true;
  }

  // -----------------------------------------------------------------------
  // Keyboard navigation
  // -----------------------------------------------------------------------

  _handleListViewKey(event) {
    const count = _modelCount(this.model);
    if (count === 0) return;
    const current = this.currentIndex;
    const vert = this._isVertical();

    const forward  = vert ? 'ArrowDown' : 'ArrowRight';
    const backward = vert ? 'ArrowUp'   : 'ArrowLeft';

    if (event.key === forward) {
      const next = current < 0 ? 0 : Math.min(count - 1, current + 1);
      if (next !== current) { this.currentIndex = next; event.accepted = true; }
    } else if (event.key === backward) {
      const next = current < 0 ? 0 : Math.max(0, current - 1);
      if (next !== current) { this.currentIndex = next; event.accepted = true; }
    } else if (event.key === 'PageDown') {
      const viewSize = vert ? (this.height || 0) : (this.width || 0);
      const avgSize = this._getDelegateSize(Math.max(0, current));
      const viewItems = Math.max(1, Math.floor(viewSize / (avgSize + (this.spacing || 0))));
      const next = Math.min(count - 1, (current < 0 ? 0 : current) + viewItems);
      if (next !== current) { this.currentIndex = next; event.accepted = true; }
    } else if (event.key === 'PageUp') {
      const viewSize = vert ? (this.height || 0) : (this.width || 0);
      const avgSize = this._getDelegateSize(Math.max(0, current));
      const viewItems = Math.max(1, Math.floor(viewSize / (avgSize + (this.spacing || 0))));
      const next = Math.max(0, current - viewItems);
      if (next !== current) { this.currentIndex = next; event.accepted = true; }
    }
  }

  // -----------------------------------------------------------------------
  // Boundary flags
  // -----------------------------------------------------------------------

  _updateAtBounds() {
    const minY = this._minContentY();
    const maxY = this._maxContentY();
    const y = this.contentY || 0;
    this._setPropertyValue('atYBegin', y <= minY);
    this._setPropertyValue('atYEnd', maxY <= 0 || y >= maxY);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

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
    const headerS = this._headerSize();
    const pos = headerS + this._offsetAtIndex(index);
    if (this._isVertical()) {
      this.contentY = this._clampY(pos);
    } else {
      this.contentX = this._clampX(pos);
    }
  }

  destroy() {
    this._disconnectModel();
    // Disconnect all size listeners
    for (let i = 0; i < this._sizeDisconnectors.length; i++) {
      this._disconnectSizeListener(i);
    }
    this._sizeDisconnectors = [];
    // Drain reuse pool
    for (const item of this._reusePool) {
      item.destroy();
    }
    this._reusePool = [];
    for (const item of this._delegateItems) {
      if (item) item.destroy();
    }
    this._delegateItems = [];
    if (this._headerItem) {
      this._headerItem.destroy();
      this._headerItem = null;
    }
    if (this._footerItem) {
      this._footerItem.destroy();
      this._footerItem = null;
    }
    const hi = this.highlightItem;
    if (hi) {
      hi.destroy();
      this._setPropertyValue('highlightItem', null);
    }
    super.destroy();
  }
}

// ---------------------------------------------------------------------------
// Stage D: Controls MVP – shared helpers
// ---------------------------------------------------------------------------

// Default visual theme used by all controls
const Theme = {
  palette: {
    background: '#f5f5f5',
    surface: '#ffffff',
    primary: '#4a79ff',
    primaryHover: '#3a69ef',
    primaryPressed: '#2858c5',
    text: '#1a1a2e',
    textSecondary: '#999999',
    border: '#c0c0d0',
    borderFocus: '#4a79ff',
    disabled: '#d0d0d8',
    disabledText: '#aaaaaa',
    checkmark: '#ffffff',
    sliderTrack: '#c0c0d0',
    sliderFill: '#4a79ff',
    sliderHandle: '#ffffff',
    inputBackground: '#ffffff',
    inputBorder: '#c0c0d0',
    cursor: '#1a1a2e',
  },
  font: {
    family: 'sans-serif',
    pixelSize: 14,
    bold: false,
  },
};

// Shared rounded-rectangle drawing helper
function _ctrlRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Stage D: Button
// ---------------------------------------------------------------------------

class Button extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('text', options.text ?? '');
    this.defineProperty('hovered', false);
    this.defineProperty('pressed', false);

    this.defineSignal('clicked');
    this.defineSignal('released');

    // Make focusable by default
    this.activeFocusOnTab = true;
    this.focusable = true;

    // Default implicit size
    this.implicitWidth = 100;
    this.implicitHeight = 36;

    // Keyboard activation via Enter / Space
    this._keys = new Keys();
    this._keys.onPressed = (event) => {
      if (!this.enabled) return;
      if (event.key === 'Enter' || event.key === ' ') {
        this.clicked.emit();
        event.accepted = true;
      }
    };
  }

  handlePointerEvent(type, event) {
    if (!this.enabled) return false;

    if (type === 'down') {
      this._setPropertyValue('pressed', true);
      this._setPropertyValue('hovered', true);
      return true;
    }

    if (type === 'move') {
      const isOver = this.containsPoint(event.sceneX, event.sceneY);
      this._setPropertyValue('hovered', isOver);
      return this._propertyValues.get('pressed') === true;
    }

    if (type === 'up') {
      const wasPressed = this._propertyValues.get('pressed');
      this._setPropertyValue('pressed', false);
      const isOver = this.containsPoint(event.sceneX, event.sceneY);
      this._setPropertyValue('hovered', isOver);
      this.released.emit(event);
      if (wasPressed && isOver) {
        this.clicked.emit(event);
      }
      return Boolean(wasPressed);
    }

    return false;
  }

  draw(context) {
    const w = this.width || this.implicitWidth || 100;
    const h = this.height || this.implicitHeight || 36;
    if (w <= 0 || h <= 0) return;

    const p = Theme.palette;
    let bg;
    if (!this.enabled) {
      bg = p.disabled;
    } else if (this._propertyValues.get('pressed')) {
      bg = p.primaryPressed;
    } else if (this._propertyValues.get('hovered')) {
      bg = p.primaryHover;
    } else {
      bg = p.primary;
    }

    const radius = 6;
    _ctrlRoundRect(context, 0, 0, w, h, radius);
    context.fillStyle = bg;
    context.fill();

    // Focus ring
    if (this.activeFocus) {
      _ctrlRoundRect(context, -2, -2, w + 4, h + 4, radius + 2);
      context.strokeStyle = p.borderFocus;
      context.lineWidth = 2;
      context.stroke();
    }

    // Label
    const text = String(this.text ?? '');
    if (text) {
      const font = Theme.font;
      context.font = `${font.bold ? 'bold ' : ''}${font.pixelSize}px ${font.family}`;
      context.fillStyle = !this.enabled ? p.disabledText : '#ffffff';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, w / 2, h / 2);
      context.textAlign = 'left';
      context.textBaseline = 'top';
    }
  }
}

// ---------------------------------------------------------------------------
// Stage D: Label
// ---------------------------------------------------------------------------

class Label extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('text', options.text ?? '');
    this.defineProperty('color', options.color ?? Theme.palette.text);
    this.defineProperty('font', options.font ?? { ...Theme.font });
  }

  draw(context) {
    const text = String(this.text ?? '');
    if (!text) return;
    const font = this.font || Theme.font;
    const size = font.pixelSize || 14;
    const family = font.family || 'sans-serif';
    const bold = font.bold ? 'bold ' : '';
    context.font = `${bold}${size}px ${family}`;
    context.fillStyle = this.color || Theme.palette.text;
    context.textBaseline = 'top';
    context.fillText(text, 0, 0);
  }
}

// ---------------------------------------------------------------------------
// Stage F: TextInput – single-line editable text item
// ---------------------------------------------------------------------------

class TextInput extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('text', options.text ?? '');
    this.defineProperty('color', options.color ?? '#000000');
    this.defineProperty('font', options.font ?? { family: 'sans-serif', pixelSize: 14, bold: false });
    this.defineProperty('cursorPosition', 0);
    this.defineProperty('cursorVisible', false);
    this.defineProperty('selectionStart', 0);
    this.defineProperty('selectionEnd', 0);
    this.defineProperty('selectedText', '');
    this.defineProperty('readOnly', options.readOnly ?? false);
    this.defineProperty('echoMode', options.echoMode ?? 'Normal');
    this.defineProperty('horizontalAlignment', options.horizontalAlignment ?? 'left');

    // Custom signals not auto-created by defineProperty
    this.defineSignal('accepted');
    this.defineSignal('editingFinished');
    this.defineSignal('selectionChanged');

    // Make focusable
    this.activeFocusOnTab = true;
    this.focusable = true;
    this.clip = options.clip !== undefined ? options.clip : true;
    this.implicitWidth = 120;
    this.implicitHeight = 28;

    // Internal state
    this._cursorBlinkTimer = null;
    this._anchorPos = 0;
    // Blink interval; 0 disables blinking (useful for deterministic tests).
    this._blinkInterval = options.blinkInterval !== undefined ? options.blinkInterval : _CURSOR_BLINK_INTERVAL;

    // Keyboard handler
    this._keys = new Keys();
    this._keys.onPressed = (event) => this._handleKeyInput(event);

    // Focus change → cursor blink
    this.connect('activeFocusChanged', (focused) => {
      if (focused) {
        this.cursorVisible = true;
        this._startCursorBlink();
      } else {
        this._stopCursorBlink();
        this.cursorVisible = false;
        this.signal('editingFinished').emit();
      }
    });

    // Initialize cursor position to end of initial text
    const initText = String(options.text ?? '');
    if (initText.length > 0) {
      this._setCursorPos(initText.length, false);
    }
  }

  _fontString() {
    return _buildFontString(this.font);
  }

  /** Returns the display text, applying echoMode (e.g. Password → bullets). */
  _displayText() {
    const text = String(this.text ?? '');
    const echo = this.echoMode || 'Normal';
    if (echo === 'Password' || echo === 'password') {
      return '\u2022'.repeat(text.length);
    }
    return text;
  }

  /** Move cursor to pos; optionally extend selection (Shift navigation). */
  _setCursorPos(pos, extendSelection) {
    const text = String(this.text ?? '');
    const newPos = Math.max(0, Math.min(pos, text.length));
    if (!extendSelection) {
      this._anchorPos = newPos;
      this._doUpdateSelection(newPos, newPos);
    } else {
      this._doUpdateSelection(this._anchorPos, newPos);
    }
    this.cursorPosition = newPos;
  }

  _doUpdateSelection(anchor, cursor) {
    const start = Math.min(anchor, cursor);
    const end = Math.max(anchor, cursor);
    const text = String(this.text ?? '');
    const changed = this.selectionStart !== start || this.selectionEnd !== end;
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectedText = text.slice(start, end);
    if (changed) this.signal('selectionChanged').emit();
  }

  /** Delete the current selection and position cursor at selection start. */
  _deleteSelection() {
    const start = this.selectionStart;
    const end = this.selectionEnd;
    if (start < end) {
      const text = String(this.text ?? '');
      this.text = text.slice(0, start) + text.slice(end);
      this._anchorPos = start;
      this._doUpdateSelection(start, start);
      this.cursorPosition = start;
    }
  }

  _handleKeyInput(event) {
    if (this.readOnly) return;

    const ctrl = event.ctrlKey || event.ctrl;
    const shift = event.shiftKey || event.shift;
    const text = String(this.text ?? '');
    const pos = this.cursorPosition;

    if (event.key === 'Enter' || event.key === 'Return') {
      this.signal('accepted').emit();
      event.accepted = true;
      return;
    }

    if (ctrl) {
      if (event.key === 'a' || event.key === 'A') {
        this._anchorPos = 0;
        this._doUpdateSelection(0, text.length);
        this.cursorPosition = text.length;
        event.accepted = true;
        return;
      }
      if (event.key === 'c' || event.key === 'C') {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(this.selectedText).catch(() => {});
        }
        event.accepted = true;
        return;
      }
      if (event.key === 'x' || event.key === 'X') {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(this.selectedText).catch(() => {});
        }
        this._deleteSelection();
        event.accepted = true;
        return;
      }
      if (event.key === 'v' || event.key === 'V') {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.readText().then((clipText) => {
            this._deleteSelection();
            const t = String(this.text ?? '');
            const p = this.cursorPosition;
            this.text = t.slice(0, p) + clipText + t.slice(p);
            this._setCursorPos(p + clipText.length, false);
          }).catch(() => {});
        }
        event.accepted = true;
        return;
      }
    }

    if (event.key === 'Backspace') {
      if (this.selectionStart < this.selectionEnd) {
        this._deleteSelection();
      } else if (pos > 0) {
        this.text = text.slice(0, pos - 1) + text.slice(pos);
        this._setCursorPos(pos - 1, false);
      }
      event.accepted = true;
    } else if (event.key === 'Delete') {
      if (this.selectionStart < this.selectionEnd) {
        this._deleteSelection();
      } else if (pos < text.length) {
        this.text = text.slice(0, pos) + text.slice(pos + 1);
      }
      event.accepted = true;
    } else if (event.key === 'ArrowLeft') {
      if (!shift && this.selectionStart < this.selectionEnd) {
        this._setCursorPos(this.selectionStart, false);
      } else if (pos > 0) {
        this._setCursorPos(pos - 1, shift);
      }
      event.accepted = true;
    } else if (event.key === 'ArrowRight') {
      if (!shift && this.selectionStart < this.selectionEnd) {
        this._setCursorPos(this.selectionEnd, false);
      } else if (pos < text.length) {
        this._setCursorPos(pos + 1, shift);
      }
      event.accepted = true;
    } else if (event.key === 'Home') {
      this._setCursorPos(0, shift);
      event.accepted = true;
    } else if (event.key === 'End') {
      this._setCursorPos(text.length, shift);
      event.accepted = true;
    } else if (event.key && event.key.length === 1 && !ctrl) {
      if (this.selectionStart < this.selectionEnd) {
        this._deleteSelection();
      }
      const p = this.cursorPosition;
      const t = String(this.text ?? '');
      this.text = t.slice(0, p) + event.key + t.slice(p);
      this._setCursorPos(p + 1, false);
      event.accepted = true;
    }
  }

  _startCursorBlink() {
    this._stopCursorBlink();
    this.cursorVisible = true;
    if (this._blinkInterval > 0 && typeof setInterval === 'function') {
      const timer = setInterval(() => {
        this.cursorVisible = !this.cursorVisible;
      }, this._blinkInterval);
      if (timer && typeof timer.unref === 'function') {
        timer.unref();
      }
      this._cursorBlinkTimer = timer;
    }
  }

  _stopCursorBlink() {
    if (this._cursorBlinkTimer != null) {
      if (typeof clearInterval === 'function') {
        clearInterval(this._cursorBlinkTimer);
      }
      this._cursorBlinkTimer = null;
    }
  }

  handlePointerEvent(type, event) {
    if (type === 'down') {
      // Best-effort: position cursor at end (no canvas context available here).
      this._setCursorPos(String(this.text ?? '').length, false);
      return true;
    }
    return false;
  }

  draw(context) {
    const w = this.width || this.implicitWidth || 120;
    const h = this.height || this.implicitHeight || 28;
    const fontString = this._fontString();
    context.font = fontString;
    context.textBaseline = 'middle';

    const displayText = this._displayText();
    const pos = this.cursorPosition;
    const selStart = this.selectionStart;
    const selEnd = this.selectionEnd;

    const ha = _normalizeHAlign(this.horizontalAlignment);
    const textW = _measureTextWidth(context, fontString, displayText);
    let textX = 0;
    if (ha === 'center') {
      textX = (w - textW) / 2;
    } else if (ha === 'right') {
      textX = w - textW;
    }

    // Selection highlight
    if (selStart < selEnd) {
      const beforeSel = displayText.slice(0, selStart);
      const selStr = displayText.slice(selStart, selEnd);
      const selX = textX + _measureTextWidth(context, fontString, beforeSel);
      const selW = _measureTextWidth(context, fontString, selStr);
      context.fillStyle = 'rgba(0, 120, 215, 0.3)';
      context.fillRect(selX, 0, selW, h);
    }

    // Text
    context.fillStyle = this.color || '#000000';
    context.fillText(displayText, textX, h / 2);

    // Cursor caret
    if (this.activeFocus && this.cursorVisible) {
      const beforeCursor = displayText.slice(0, pos);
      const cursorX = textX + _measureTextWidth(context, fontString, beforeCursor);
      context.strokeStyle = this.color || '#000000';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(cursorX, 2);
      context.lineTo(cursorX, h - 2);
      context.stroke();
    }
  }

  destroy() {
    this._stopCursorBlink();
    super.destroy();
  }
}

// ---------------------------------------------------------------------------
// Stage D: TextField – styled single-line text control backed by TextInput
// ---------------------------------------------------------------------------

class TextField extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('text', options.text ?? '');
    this.defineProperty('placeholderText', options.placeholderText ?? '');

    // Make focusable
    this.activeFocusOnTab = true;
    this.focusable = true;
    this.implicitWidth = 120;
    this.implicitHeight = 32;

    // Internal TextInput carries all editing logic (cursor, selection, blink).
    this._textInput = new TextInput({
      text: options.text ?? '',
      blinkInterval: options.blinkInterval !== undefined ? options.blinkInterval : _CURSOR_BLINK_INTERVAL,
    });

    // Keep this.text ↔ _textInput.text in sync (guard against cycles).
    this._textInput.connect('textChanged', (v) => {
      if (this.text !== v) this.text = v;
    });
    this.connect('textChanged', (v) => {
      if (this._textInput.text !== v) this._textInput.text = v;
    });

    // Keyboard input delegates to the internal TextInput.
    this._keys = new Keys();
    this._keys.onPressed = (event) => {
      this._textInput._handleKeyInput(event);
    };

    // Focus changes are forwarded to TextInput so it manages cursor blinking.
    this.connect('activeFocusChanged', (focused) => {
      this._textInput.activeFocus = focused;
    });
  }

  draw(context) {
    const w = this.width || this.implicitWidth || 120;
    const h = this.height || this.implicitHeight || 32;
    const p = Theme.palette;
    const padding = 8;

    // Background / border
    _ctrlRoundRect(context, 0, 0, w, h, 4);
    context.fillStyle = p.inputBackground;
    context.fill();

    context.strokeStyle = this.activeFocus ? p.borderFocus : p.inputBorder;
    context.lineWidth = this.activeFocus ? 2 : 1;
    context.stroke();

    // Clip text area
    context.save();
    context.beginPath();
    context.rect(padding, 2, w - padding * 2, h - 4);
    context.clip();

    const font = Theme.font;
    context.font = `${font.pixelSize}px ${font.family}`;
    context.textBaseline = 'middle';

    const text = String(this.text ?? '');
    const placeholder = String(this.placeholderText ?? '');

    if (text) {
      context.fillStyle = p.text;
      context.fillText(text, padding, h / 2);
    } else if (placeholder) {
      context.fillStyle = p.textSecondary;
      context.fillText(placeholder, padding, h / 2);
    }

    // Cursor (state from internal TextInput)
    if (this.activeFocus && this._textInput.cursorVisible) {
      const cursorText = text.slice(0, this._textInput.cursorPosition);
      const cursorX = padding + context.measureText(cursorText).width;
      context.strokeStyle = p.cursor;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(cursorX, 4);
      context.lineTo(cursorX, h - 4);
      context.stroke();
    }

    context.restore();
  }

  destroy() {
    this._textInput.destroy();
    super.destroy();
  }
}

// ---------------------------------------------------------------------------
// Stage D: Slider
// ---------------------------------------------------------------------------

class Slider extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('from', options.from ?? 0);
    this.defineProperty('to', options.to ?? 1);
    this.defineProperty('value', options.value ?? 0, {
      coerce: (val) => {
        const from = typeof this.from === 'number' ? this.from : 0;
        const to = typeof this.to === 'number' ? this.to : 1;
        const step = typeof this.stepSize === 'number' ? this.stepSize : 0;
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        let v = Math.max(lo, Math.min(hi, typeof val === 'number' ? val : 0));
        if (step > 0) {
          v = Math.round((v - from) / step) * step + from;
          v = Math.max(lo, Math.min(hi, v));
        }
        return v;
      },
    });
    this.defineProperty('stepSize', options.stepSize ?? 0);

    this.activeFocusOnTab = true;
    this.focusable = true;

    this.implicitWidth = 200;
    this.implicitHeight = 24;

    this._dragging = false;

    // Keyboard: arrow keys adjust value
    this._keys = new Keys();
    this._keys.onPressed = (event) => {
      if (!this.enabled) return;
      const range = Math.abs(this.to - this.from);
      const step = this.stepSize > 0 ? this.stepSize : range / 10;
      const dir = this.to >= this.from ? 1 : -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        this.value = this._clamp(this.value + step * dir);
        event.accepted = true;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        this.value = this._clamp(this.value - step * dir);
        event.accepted = true;
      }
    };
  }

  _clamp(val) {
    const lo = Math.min(this.from, this.to);
    const hi = Math.max(this.from, this.to);
    let v = Math.max(lo, Math.min(hi, val));
    if (this.stepSize > 0) {
      v = Math.round((v - this.from) / this.stepSize) * this.stepSize + this.from;
      v = Math.max(lo, Math.min(hi, v));
    }
    return v;
  }

  _valueFromSceneX(sceneX) {
    const w = this.width || this.implicitWidth || 200;
    const trackStart = 12;
    const trackEnd = w - 12;
    const local = this.mapFromItem(null, sceneX, 0);
    const t = Math.max(0, Math.min(1, (local.x - trackStart) / (trackEnd - trackStart)));
    return this._clamp(this.from + t * (this.to - this.from));
  }

  handlePointerEvent(type, event) {
    if (!this.enabled) return false;

    if (type === 'down') {
      this._dragging = true;
      this.value = this._valueFromSceneX(event.sceneX);
      return true;
    }

    if (type === 'move' && this._dragging) {
      this.value = this._valueFromSceneX(event.sceneX);
      return true;
    }

    if (type === 'up') {
      const was = this._dragging;
      this._dragging = false;
      return was;
    }

    return false;
  }

  draw(context) {
    const w = this.width || this.implicitWidth || 200;
    const h = this.height || this.implicitHeight || 24;
    const p = Theme.palette;
    const trackY = h / 2;
    const trackStart = 12;
    const trackEnd = w - 12;
    const trackH = 4;

    // Track background
    _ctrlRoundRect(context, trackStart, trackY - trackH / 2, trackEnd - trackStart, trackH, 2);
    context.fillStyle = p.sliderTrack;
    context.fill();

    // Track fill
    const range = this.to - this.from;
    const pos = range !== 0 ? (this.value - this.from) / range : 0;
    const fillW = Math.max(0, (trackEnd - trackStart) * pos);
    if (fillW > 0) {
      _ctrlRoundRect(context, trackStart, trackY - trackH / 2, fillW, trackH, 2);
      context.fillStyle = p.sliderFill;
      context.fill();
    }

    // Handle knob
    const handleX = trackStart + fillW;
    const handleR = 9;
    context.beginPath();
    context.arc(handleX, trackY, handleR, 0, Math.PI * 2);
    context.fillStyle = p.sliderHandle;
    context.fill();
    context.strokeStyle = this.activeFocus ? p.borderFocus : p.border;
    context.lineWidth = this.activeFocus ? 2 : 1;
    context.stroke();
  }
}

// ---------------------------------------------------------------------------
// Stage D: CheckBox
// ---------------------------------------------------------------------------

class CheckBox extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('text', options.text ?? '');
    this.defineProperty('checked', Boolean(options.checked ?? false));

    this.defineSignal('clicked');

    this.activeFocusOnTab = true;
    this.focusable = true;

    this.implicitWidth = 120;
    this.implicitHeight = 24;

    // Keyboard: Enter / Space toggles
    this._keys = new Keys();
    this._keys.onPressed = (event) => {
      if (!this.enabled) return;
      if (event.key === 'Enter' || event.key === ' ') {
        this.checked = !this.checked;
        this.clicked.emit();
        event.accepted = true;
      }
    };
  }

  handlePointerEvent(type, event) {
    if (!this.enabled) return false;

    if (type === 'down') {
      return true;
    }

    if (type === 'up') {
      if (this.containsPoint(event.sceneX, event.sceneY)) {
        this.checked = !this.checked;
        this.clicked.emit(event);
        return true;
      }
    }

    return false;
  }

  draw(context) {
    const h = this.height || this.implicitHeight || 24;
    const p = Theme.palette;
    const boxSize = 18;
    const boxY = Math.round((h - boxSize) / 2);

    // Box
    _ctrlRoundRect(context, 0, boxY, boxSize, boxSize, 3);
    context.fillStyle = this.checked ? p.primary : p.inputBackground;
    context.fill();
    context.strokeStyle = this.activeFocus ? p.borderFocus : p.border;
    context.lineWidth = this.activeFocus ? 2 : 1;
    context.stroke();

    // Checkmark
    if (this.checked) {
      context.strokeStyle = p.checkmark;
      context.lineWidth = 2;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(3, boxY + boxSize / 2);
      context.lineTo(boxSize / 2 - 1, boxY + boxSize - 4);
      context.lineTo(boxSize - 3, boxY + 4);
      context.stroke();
      context.lineCap = 'butt';
      context.lineJoin = 'miter';
    }

    // Label
    const text = String(this.text ?? '');
    if (text) {
      const font = Theme.font;
      context.font = `${font.bold ? 'bold ' : ''}${font.pixelSize}px ${font.family}`;
      context.fillStyle = this.enabled ? p.text : p.disabledText;
      context.textBaseline = 'middle';
      context.fillText(text, boxSize + 8, h / 2);
      context.textBaseline = 'top';
    }
  }
}

// ---------------------------------------------------------------------------
// Stage PR2: Positioner base and Row / Column / Flow layout items
// ---------------------------------------------------------------------------

/**
 * Positioner — base class for Row, Column, Flow.
 *
 * Provides:
 *  - spacing, padding (and per-side paddingLeft/Right/Top/Bottom)
 *  - layoutDirection ('LeftToRight' | 'RightToLeft')
 *  - efficient child-watching: subscribes to x/y/width/height/
 *    implicitWidth/implicitHeight/visible changes on each child item,
 *    and to childItems list changes via overridden _addChildItem/_removeChildItem.
 *  - _scheduleLayout() / _doLayout() (abstract in base; overridden by subclasses)
 */
class Positioner extends Item {
  constructor(options = {}) {
    super(options);

    this._layoutScheduled = false;
    this._childDisconnectors = new Map(); // child item → array of disconnect fns

    this.defineProperty('spacing', 0, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('padding', 0, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('topPadding', undefined, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('bottomPadding', undefined, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('leftPadding', undefined, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('rightPadding', undefined, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('layoutDirection', 'LeftToRight', { onChanged: () => this._scheduleLayout() });

    // Re-layout when our own width/height changes (needed for Flow)
    this.connect('widthChanged', () => this._scheduleLayout());
    this.connect('heightChanged', () => this._scheduleLayout());
  }

  // Resolved per-side padding helpers
  _pt() { return this.topPadding !== undefined ? this.topPadding : this.padding; }
  _pb() { return this.bottomPadding !== undefined ? this.bottomPadding : this.padding; }
  _pl() { return this.leftPadding !== undefined ? this.leftPadding : this.padding; }
  _pr() { return this.rightPadding !== undefined ? this.rightPadding : this.padding; }

  // ------------------------------------------------------------------
  // Child tracking
  // ------------------------------------------------------------------

  _watchChild(child) {
    if (!(child instanceof Item)) return;
    if (this._childDisconnectors.has(child)) return; // already watched

    const disconnectors = [];
    const schedule = () => this._scheduleLayout();
    // Watch size and visibility changes; deliberately exclude x/y since the
    // positioner itself writes those and watching them would cause loops.
    const watchedProps = ['width', 'height', 'implicitWidth', 'implicitHeight', 'visible'];
    for (const prop of watchedProps) {
      const signal = child[`${prop}Changed`];
      if (signal && typeof signal.connect === 'function') {
        disconnectors.push(signal.connect(schedule));
      }
    }
    this._childDisconnectors.set(child, disconnectors);
  }

  _unwatchChild(child) {
    const disconnectors = this._childDisconnectors.get(child);
    if (!disconnectors) return;
    for (const d of disconnectors) {
      if (typeof d === 'function') d();
    }
    this._childDisconnectors.delete(child);
  }

  _addChildItem(child) {
    super._addChildItem(child);
    this._watchChild(child);
    this._scheduleLayout();
  }

  _removeChildItem(child) {
    this._unwatchChild(child);
    super._removeChildItem(child);
    this._scheduleLayout();
  }

  // ------------------------------------------------------------------
  // Layout scheduling
  // ------------------------------------------------------------------

  _scheduleLayout() {
    if (this._layoutScheduled) return;
    this._layoutScheduled = true;
    // Micro-task: batch multiple changes into one layout pass
    Promise.resolve().then(() => {
      this._layoutScheduled = false;
      this._doLayout();
    });
  }

  /** Subclasses override this to perform their layout pass. */
  _doLayout() {}

  /** Effective (visible) children eligible for placement. */
  _layoutChildren() {
    return this._childItems.filter((c) => c.visible !== false);
  }

  /** Effective size of a child: use explicit width/height when > 0, otherwise fall back to implicit. */
  static _childW(child) {
    const w = child.width;
    return w > 0 ? w : (child.implicitWidth || 0);
  }

  static _childH(child) {
    const h = child.height;
    return h > 0 ? h : (child.implicitHeight || 0);
  }
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

class Row extends Positioner {
  constructor(options = {}) {
    super(options);
  }

  _doLayout() {
    const children = this._layoutChildren();
    if (children.length === 0) {
      this.implicitWidth = this._pl() + this._pr();
      this.implicitHeight = this._pt() + this._pb();
      return;
    }

    const rtl = this.layoutDirection === 'RightToLeft';
    const spacing = this.spacing || 0;
    const pt = this._pt();
    const pl = this._pl();
    const pr = this._pr();
    const pb = this._pb();

    if (rtl) {
      // In RTL mode, lay out right-to-left starting from x = pl,
      // but in Qt the children are placed so the rightmost child ends at
      // (implicitWidth - pr).  We compute total width first, then place.
      let totalW = 0;
      let maxH = 0;
      for (let i = 0; i < children.length; i++) {
        totalW += Positioner._childW(children[i]);
        if (i < children.length - 1) totalW += spacing;
        const ch = Positioner._childH(children[i]);
        if (ch > maxH) maxH = ch;
      }
      const implW = pl + totalW + pr;
      const implH = pt + maxH + pb;

      // Place children right-to-left
      let cursor = pl + totalW;
      for (const child of children) {
        const cw = Positioner._childW(child);
        cursor -= cw;
        child.x = cursor;
        child.y = pt;
        cursor -= spacing;
      }

      this.implicitWidth = implW;
      this.implicitHeight = implH;
    } else {
      // LTR
      let cursor = pl;
      let maxH = 0;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        child.x = cursor;
        child.y = pt;
        const cw = Positioner._childW(child);
        const ch = Positioner._childH(child);
        cursor += cw;
        if (i < children.length - 1) cursor += spacing;
        if (ch > maxH) maxH = ch;
      }
      this.implicitWidth = cursor + pr;
      this.implicitHeight = pt + maxH + pb;
    }
  }
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

class Column extends Positioner {
  constructor(options = {}) {
    super(options);
  }

  _doLayout() {
    const children = this._layoutChildren();
    if (children.length === 0) {
      this.implicitWidth = this._pl() + this._pr();
      this.implicitHeight = this._pt() + this._pb();
      return;
    }

    const spacing = this.spacing || 0;
    const pt = this._pt();
    const pl = this._pl();
    const pr = this._pr();
    const pb = this._pb();

    let cursor = pt;
    let maxW = 0;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      child.x = pl;
      child.y = cursor;
      const cw = Positioner._childW(child);
      const ch = Positioner._childH(child);
      cursor += ch;
      if (i < children.length - 1) cursor += spacing;
      if (cw > maxW) maxW = cw;
    }

    this.implicitWidth = pl + maxW + pr;
    this.implicitHeight = cursor + pb;
  }
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

class Flow extends Positioner {
  constructor(options = {}) {
    super(options);

    // 'LeftToRight': wrap into rows  (wraps when row exceeds width)
    // 'TopToBottom': wrap into columns (wraps when column exceeds height)
    this.defineProperty('flow', 'LeftToRight', { onChanged: () => this._scheduleLayout() });
  }

  _doLayout() {
    if (this.flow === 'TopToBottom') {
      this._doLayoutTopToBottom();
    } else {
      this._doLayoutLeftToRight();
    }
  }

  _doLayoutLeftToRight() {
    const children = this._layoutChildren();
    const spacing = this.spacing || 0;
    const pt = this._pt();
    const pl = this._pl();
    const pr = this._pr();
    const pb = this._pb();
    const rtl = this.layoutDirection === 'RightToLeft';

    // Available width for content (0 means no wrapping constraint)
    const availW = (this.width || 0) - pl - pr;

    let rowStartX = pl;
    let rowY = pt;
    let rowItems = [];
    let rowW = 0;
    let maxRowH = 0;
    let totalImplW = 0;

    const placeRow = () => {
      if (rowItems.length === 0) return;
      let x;
      if (rtl) {
        // Right-align the row within availW (or within rowW if no width set)
        const rowRight = availW > 0 ? pl + availW : pl + rowW;
        x = rowRight - rowW;
      } else {
        x = rowStartX;
      }
      for (const child of rowItems) {
        child.x = x;
        child.y = rowY;
        x += Positioner._childW(child) + spacing;
      }
      if (rowW > totalImplW) totalImplW = rowW;
      rowY += maxRowH + spacing;
      rowItems = [];
      rowW = 0;
      maxRowH = 0;
    };

    for (const child of children) {
      const cw = Positioner._childW(child);
      const ch = Positioner._childH(child);

      const needed = rowItems.length > 0 ? rowW + spacing + cw : cw;
      // Wrap if we have a known width and the row would overflow
      if (availW > 0 && rowItems.length > 0 && needed > availW) {
        placeRow();
      }

      rowItems.push(child);
      rowW = rowItems.length > 1 ? rowW + spacing + cw : cw;
      if (ch > maxRowH) maxRowH = ch;
    }
    placeRow(); // flush last row

    this.implicitWidth = pl + totalImplW + pr;
    this.implicitHeight = rowY - (children.length > 0 ? spacing : 0) + pb;
  }

  _doLayoutTopToBottom() {
    const children = this._layoutChildren();
    const spacing = this.spacing || 0;
    const pt = this._pt();
    const pl = this._pl();
    const pr = this._pr();
    const pb = this._pb();

    // Available height for content (0 means no wrapping constraint)
    const availH = (this.height || 0) - pt - pb;

    let colX = pl;
    let colStartY = pt;
    let colItems = [];
    let colH = 0;
    let maxColW = 0;
    let totalImplH = 0;

    const placeCol = () => {
      if (colItems.length === 0) return;
      let y = colStartY;
      for (const child of colItems) {
        child.x = colX;
        child.y = y;
        y += Positioner._childH(child) + spacing;
      }
      if (colH > totalImplH) totalImplH = colH;
      colX += maxColW + spacing;
      colItems = [];
      colH = 0;
      maxColW = 0;
    };

    for (const child of children) {
      const cw = Positioner._childW(child);
      const ch = Positioner._childH(child);

      const needed = colItems.length > 0 ? colH + spacing + ch : ch;
      if (availH > 0 && colItems.length > 0 && needed > availH) {
        placeCol();
      }

      colItems.push(child);
      colH = colItems.length > 1 ? colH + spacing + ch : ch;
      if (cw > maxColW) maxColW = cw;
    }
    placeCol();

    this.implicitWidth = colX - (children.length > 0 ? spacing : 0) + pr;
    this.implicitHeight = pt + totalImplH + pb;
  }
}

// ---------------------------------------------------------------------------
// QtQuick.Layouts: RowLayout, ColumnLayout, GridLayout
// ---------------------------------------------------------------------------

/** Floating-point epsilon used when comparing clamped fill sizes. */
const _FILL_EPSILON = 0.001;

/**
 * LayoutContainer – base class for RowLayout, ColumnLayout, GridLayout.
 *
 * Provides:
 *  - spacing, padding (and per-side paddingLeft/Right/Top/Bottom)
 *  - child tracking (watches width/height/implicitWidth/implicitHeight/visible)
 *  - _scheduleLayout() / _doLayout() (overridden by subclasses)
 *  - static helpers for reading Layout.* attached properties
 */
class LayoutContainer extends Item {
  constructor(options = {}) {
    super(options);

    this._layoutScheduled = false;
    this._childDisconnectors = new Map();

    this.defineProperty('spacing', 0, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('padding', 0, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('topPadding', undefined, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('bottomPadding', undefined, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('leftPadding', undefined, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('rightPadding', undefined, { onChanged: () => this._scheduleLayout() });

    this.connect('widthChanged', () => this._scheduleLayout());
    this.connect('heightChanged', () => this._scheduleLayout());
  }

  _pt() { return this.topPadding    !== undefined ? this.topPadding    : this.padding; }
  _pb() { return this.bottomPadding !== undefined ? this.bottomPadding : this.padding; }
  _pl() { return this.leftPadding   !== undefined ? this.leftPadding   : this.padding; }
  _pr() { return this.rightPadding  !== undefined ? this.rightPadding  : this.padding; }

  // ------------------------------------------------------------------
  // Layout.* attached-property helpers
  // ------------------------------------------------------------------

  /** Returns the __layoutAttached bag for a child (or an empty object). */
  static _la(child) {
    return child.__layoutAttached || {};
  }

  static _leftMargin(la)   { return la.leftMargin   !== undefined ? la.leftMargin   : (la.margins || 0); }
  static _rightMargin(la)  { return la.rightMargin  !== undefined ? la.rightMargin  : (la.margins || 0); }
  static _topMargin(la)    { return la.topMargin    !== undefined ? la.topMargin    : (la.margins || 0); }
  static _bottomMargin(la) { return la.bottomMargin !== undefined ? la.bottomMargin : (la.margins || 0); }

  static _prefW(child, la) {
    if (la.preferredWidth !== undefined && la.preferredWidth >= 0) return la.preferredWidth;
    const cw = child.width || 0;
    return cw > 0 ? cw : (child.implicitWidth || 0);
  }

  static _prefH(child, la) {
    if (la.preferredHeight !== undefined && la.preferredHeight >= 0) return la.preferredHeight;
    const ch = child.height || 0;
    return ch > 0 ? ch : (child.implicitHeight || 0);
  }

  static _minW(la) { return la.minimumWidth  !== undefined ? la.minimumWidth  : 0; }
  static _minH(la) { return la.minimumHeight !== undefined ? la.minimumHeight : 0; }
  static _maxW(la) { return la.maximumWidth  !== undefined ? la.maximumWidth  : Infinity; }
  static _maxH(la) { return la.maximumHeight !== undefined ? la.maximumHeight : Infinity; }

  /**
   * Decode horizontal alignment from a Layout.alignment value.
   * Qt flags: AlignLeft=1, AlignRight=2, AlignHCenter=4.
   * Returns 'left' | 'right' | 'hcenter'.
   */
  static _alignH(align) {
    if (align === 'AlignRight'   || align === 'Qt.AlignRight'   || (typeof align === 'number' && (align & 2)))  return 'right';
    if (align === 'AlignHCenter' || align === 'Qt.AlignHCenter' || (typeof align === 'number' && (align & 4)))  return 'hcenter';
    return 'left';
  }

  /**
   * Decode vertical alignment from a Layout.alignment value.
   * Qt flags: AlignTop=32, AlignBottom=64, AlignVCenter=128.
   * Returns 'top' | 'bottom' | 'vcenter'.
   */
  static _alignV(align) {
    if (align === 'AlignBottom' || align === 'Qt.AlignBottom' || (typeof align === 'number' && (align & 64)))  return 'bottom';
    if (align === 'AlignVCenter'|| align === 'Qt.AlignVCenter'|| (typeof align === 'number' && (align & 128))) return 'vcenter';
    return 'top';
  }

  // ------------------------------------------------------------------
  // Fill distribution helper
  // ------------------------------------------------------------------

  /**
   * Distribute `available` pixels among `items` that have a fill flag set.
   * Each item has { allocSize, minSize, maxSize, fill }.
   * Returns nothing; modifies allocSize in-place.
   */
  static _distributeFill(available, items) {
    let toFill = items.filter((d) => d.fill);
    let remain = available;
    while (toFill.length > 0 && remain > 0) {
      const share = remain / toFill.length;
      const capped   = [];
      const uncapped = [];
      for (const d of toFill) {
        const clamped = Math.max(d.minSize, Math.min(d.maxSize, share));
        if (clamped < share - _FILL_EPSILON) {
          capped.push(d);
          d.allocSize = clamped;
        } else {
          uncapped.push(d);
        }
      }
      if (capped.length === 0) {
        for (const d of uncapped) d.allocSize = Math.max(d.minSize, Math.min(d.maxSize, share));
        break;
      }
      remain -= capped.reduce((s, d) => s + d.allocSize, 0);
      toFill = uncapped;
    }
    if (toFill.length > 0 && remain <= 0) {
      for (const d of toFill) d.allocSize = d.minSize;
    }
  }

  // ------------------------------------------------------------------
  // Child tracking
  // ------------------------------------------------------------------

  _watchChild(child) {
    if (!(child instanceof Item)) return;
    if (this._childDisconnectors.has(child)) return;

    const schedule = () => this._scheduleLayout();
    const disconnectors = [];
    for (const prop of ['width', 'height', 'implicitWidth', 'implicitHeight', 'visible']) {
      const sig = child[`${prop}Changed`];
      if (sig && typeof sig.connect === 'function') {
        disconnectors.push(sig.connect(schedule));
      }
    }
    this._childDisconnectors.set(child, disconnectors);
  }

  _unwatchChild(child) {
    const disconnectors = this._childDisconnectors.get(child);
    if (!disconnectors) return;
    for (const d of disconnectors) {
      if (typeof d === 'function') d();
    }
    this._childDisconnectors.delete(child);
  }

  _addChildItem(child) {
    super._addChildItem(child);
    this._watchChild(child);
    this._scheduleLayout();
  }

  _removeChildItem(child) {
    this._unwatchChild(child);
    super._removeChildItem(child);
    this._scheduleLayout();
  }

  _scheduleLayout() {
    if (this._layoutScheduled) return;
    this._layoutScheduled = true;
    Promise.resolve().then(() => {
      this._layoutScheduled = false;
      this._doLayout();
    });
  }

  _doLayout() {}

  _layoutChildren() {
    return this._childItems.filter((c) => c.visible !== false);
  }
}

// ---------------------------------------------------------------------------
// RowLayout
// ---------------------------------------------------------------------------

class RowLayout extends LayoutContainer {
  _doLayout() {
    const children = this._layoutChildren();
    const spacing  = this.spacing || 0;
    const pt = this._pt(), pb = this._pb(), pl = this._pl(), pr = this._pr();
    const containerW = this.width  || 0;
    const containerH = this.height || 0;
    const availW = containerW - pl - pr;
    const availH = containerH - pt - pb;

    if (children.length === 0) {
      this.implicitWidth  = pl + pr;
      this.implicitHeight = pt + pb;
      return;
    }

    // Build per-child layout data
    const data = children.map((child) => {
      const la   = LayoutContainer._la(child);
      const lm   = LayoutContainer._leftMargin(la);
      const rm   = LayoutContainer._rightMargin(la);
      const tm   = LayoutContainer._topMargin(la);
      const bm   = LayoutContainer._bottomMargin(la);
      const prefW = LayoutContainer._prefW(child, la);
      const minW  = LayoutContainer._minW(la);
      const maxW  = LayoutContainer._maxW(la);
      const prefH = LayoutContainer._prefH(child, la);
      const minH  = LayoutContainer._minH(la);
      const maxH  = LayoutContainer._maxH(la);
      return {
        child, la, lm, rm, tm, bm,
        prefW, minW, maxW,
        prefH, minH, maxH,
        fill:     !!la.fillWidth,
        fillH:    !!la.fillHeight,
        align:    la.alignment,
        allocSize: Math.max(minW, Math.min(maxW, prefW)),
        minSize:   minW,
        maxSize:   maxW,
      };
    });

    // Total fixed horizontal consumption (margins + inter-item spacing)
    const totalMarginH = data.reduce((s, d) => s + d.lm + d.rm, 0);
    const totalSpacing = spacing * (children.length - 1);
    const sumNonFill   = data.filter((d) => !d.fill).reduce((s, d) => s + d.allocSize, 0);
    const fillAvail    = availW - totalMarginH - totalSpacing - sumNonFill;

    LayoutContainer._distributeFill(fillAvail, data);

    // Place children left-to-right
    let cursor = pl;
    let maxH    = 0;

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      cursor += d.lm;

      const w = d.allocSize;

      // Compute child height
      let h;
      if (d.fillH && availH > 0) {
        h = Math.max(d.minH, Math.min(d.maxH, availH - d.tm - d.bm));
      } else {
        h = Math.max(d.minH, Math.min(d.maxH, d.prefH));
      }

      d.child.width  = w;
      d.child.height = h;

      // Vertical position
      // RowLayout default is vcenter (Qt Quick Layouts behaviour).
      // Explicit alignment overrides only when the alignment value is defined.
      let cy;
      if (availH > 0) {
        const itemTotalH = h + d.tm + d.bm;
        // When no alignment is specified, RowLayout centres items vertically.
        const av = d.align !== undefined ? LayoutContainer._alignV(d.align) : 'vcenter';
        if (av === 'bottom') {
          cy = pt + availH - d.bm - h;
        } else if (av === 'top') {
          cy = pt + d.tm;
        } else {
          // vcenter
          cy = pt + d.tm + Math.max(0, (availH - itemTotalH) / 2);
        }
      } else {
        cy = pt + d.tm;
      }

      d.child.x = cursor;
      d.child.y = cy;

      const childHWithMargins = h + d.tm + d.bm;
      if (childHWithMargins > maxH) maxH = childHWithMargins;

      cursor += w + d.rm;
      if (i < data.length - 1) cursor += spacing;
    }

    this.implicitWidth  = cursor + pr;
    this.implicitHeight = pt + maxH + pb;
  }
}

// ---------------------------------------------------------------------------
// ColumnLayout
// ---------------------------------------------------------------------------

class ColumnLayout extends LayoutContainer {
  _doLayout() {
    const children = this._layoutChildren();
    const spacing  = this.spacing || 0;
    const pt = this._pt(), pb = this._pb(), pl = this._pl(), pr = this._pr();
    const containerW = this.width  || 0;
    const containerH = this.height || 0;
    const availW = containerW - pl - pr;
    const availH = containerH - pt - pb;

    if (children.length === 0) {
      this.implicitWidth  = pl + pr;
      this.implicitHeight = pt + pb;
      return;
    }

    const data = children.map((child) => {
      const la   = LayoutContainer._la(child);
      const lm   = LayoutContainer._leftMargin(la);
      const rm   = LayoutContainer._rightMargin(la);
      const tm   = LayoutContainer._topMargin(la);
      const bm   = LayoutContainer._bottomMargin(la);
      const prefH = LayoutContainer._prefH(child, la);
      const minH  = LayoutContainer._minH(la);
      const maxH  = LayoutContainer._maxH(la);
      const prefW = LayoutContainer._prefW(child, la);
      const minW  = LayoutContainer._minW(la);
      const maxW  = LayoutContainer._maxW(la);
      return {
        child, la, lm, rm, tm, bm,
        prefH, minH, maxH,
        prefW, minW, maxW,
        fill:     !!la.fillHeight,
        fillW:    !!la.fillWidth,
        align:    la.alignment,
        allocSize: Math.max(minH, Math.min(maxH, prefH)),
        minSize:   minH,
        maxSize:   maxH,
      };
    });

    const totalMarginV = data.reduce((s, d) => s + d.tm + d.bm, 0);
    const totalSpacing = spacing * (children.length - 1);
    const sumNonFill   = data.filter((d) => !d.fill).reduce((s, d) => s + d.allocSize, 0);
    const fillAvail    = availH - totalMarginV - totalSpacing - sumNonFill;

    LayoutContainer._distributeFill(fillAvail, data);

    let cursor = pt;
    let maxW    = 0;

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      cursor += d.tm;

      const h = d.allocSize;

      // Compute child width
      let w;
      if (d.fillW && availW > 0) {
        w = Math.max(d.minW, Math.min(d.maxW, availW - d.lm - d.rm));
      } else {
        w = Math.max(d.minW, Math.min(d.maxW, d.prefW));
      }

      d.child.width  = w;
      d.child.height = h;

      // Horizontal position (default: left)
      let cx;
      if (availW > 0) {
        const itemTotalW = w + d.lm + d.rm;
        const ah = LayoutContainer._alignH(d.align);
        if (ah === 'right') {
          cx = pl + availW - d.rm - w;
        } else if (ah === 'hcenter') {
          cx = pl + d.lm + Math.max(0, (availW - itemTotalW) / 2);
        } else {
          // left (default)
          cx = pl + d.lm;
        }
      } else {
        cx = pl + d.lm;
      }

      d.child.x = cx;
      d.child.y = cursor;

      const childWWithMargins = w + d.lm + d.rm;
      if (childWWithMargins > maxW) maxW = childWWithMargins;

      cursor += h + d.bm;
      if (i < data.length - 1) cursor += spacing;
    }

    this.implicitWidth  = pl + maxW + pr;
    this.implicitHeight = cursor + pb;
  }
}

// ---------------------------------------------------------------------------
// GridLayout
// ---------------------------------------------------------------------------

class GridLayout extends LayoutContainer {
  constructor(options = {}) {
    super(options);
    // columns / rows: 0 means "auto"
    this.defineProperty('columns', 0, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('rows',    0, { onChanged: () => this._scheduleLayout() });
    // columnSpacing / rowSpacing: undefined means use spacing
    this.defineProperty('rowSpacing',    undefined, { onChanged: () => this._scheduleLayout() });
    this.defineProperty('columnSpacing', undefined, { onChanged: () => this._scheduleLayout() });
    // flow: 'LeftToRight' | 'TopToBottom'
    this.defineProperty('flow', 'LeftToRight', { onChanged: () => this._scheduleLayout() });
    this.defineProperty('layoutDirection', 'LeftToRight', { onChanged: () => this._scheduleLayout() });
  }

  _colSpacing() { return this.columnSpacing !== undefined ? this.columnSpacing : (this.spacing || 0); }
  _rowSpacing() { return this.rowSpacing    !== undefined ? this.rowSpacing    : (this.spacing || 0); }

  _doLayout() {
    const children  = this._layoutChildren();
    const pt = this._pt(), pb = this._pb(), pl = this._pl(), pr = this._pr();
    const colSpc     = this._colSpacing();
    const rowSpc     = this._rowSpacing();
    const containerW = this.width  || 0;
    const containerH = this.height || 0;
    const availW = containerW - pl - pr;
    const availH = containerH - pt - pb;

    if (children.length === 0) {
      this.implicitWidth  = pl + pr;
      this.implicitHeight = pt + pb;
      return;
    }

    const numColsSpec = this.columns || 0;
    const numRowsSpec = this.rows    || 0;
    const flowIsLTR   = (this.flow !== 'TopToBottom');

    // Collect per-child info
    const items = children.map((child) => {
      const la = LayoutContainer._la(child);
      return {
        child, la,
        row:     (la.row     !== undefined) ? la.row     : -1,
        col:     (la.column  !== undefined) ? la.column  : -1,
        rowSpan: (la.rowSpan !== undefined) ? la.rowSpan : 1,
        colSpan: (la.columnSpan !== undefined) ? la.columnSpan : 1,
        lm: LayoutContainer._leftMargin(la),
        rm: LayoutContainer._rightMargin(la),
        tm: LayoutContainer._topMargin(la),
        bm: LayoutContainer._bottomMargin(la),
        prefW: LayoutContainer._prefW(child, la),
        minW:  LayoutContainer._minW(la),
        maxW:  LayoutContainer._maxW(la),
        prefH: LayoutContainer._prefH(child, la),
        minH:  LayoutContainer._minH(la),
        maxH:  LayoutContainer._maxH(la),
        fillW: !!la.fillWidth,
        fillH: !!la.fillHeight,
        align: la.alignment,
      };
    });

    // ------------------------------------------------------------------
    // Auto-placement: assign row/col to items without explicit positions
    // ------------------------------------------------------------------
    const occupied   = new Set();
    const isOccupied = (r, c) => occupied.has(`${r},${c}`);
    const occupy     = (r, c, rs, cs) => {
      for (let rr = r; rr < r + rs; rr++)
        for (let cc = c; cc < c + cs; cc++)
          occupied.add(`${rr},${cc}`);
    };

    // Place explicitly-positioned items first
    for (const it of items) {
      if (it.row >= 0 && it.col >= 0) {
        occupy(it.row, it.col, it.rowSpan, it.colSpan);
      }
    }

    // Auto-place the rest
    let autoRow = 0, autoCol = 0;
    for (const it of items) {
      if (it.row >= 0 && it.col >= 0) continue;

      // Find next free cell
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (!isOccupied(autoRow, autoCol)) {
          // Check if the span fits without hitting an occupied cell
          let fits = true;
          for (let rr = autoRow; rr < autoRow + it.rowSpan && fits; rr++)
            for (let cc = autoCol; cc < autoCol + it.colSpan && fits; cc++)
              if (isOccupied(rr, cc)) fits = false;
          if (fits) break;
        }
        // Advance cursor
        if (flowIsLTR) {
          autoCol++;
          if (numColsSpec > 0 && autoCol >= numColsSpec) { autoCol = 0; autoRow++; }
        } else {
          autoRow++;
          if (numRowsSpec > 0 && autoRow >= numRowsSpec) { autoRow = 0; autoCol++; }
        }
      }

      it.row = autoRow;
      it.col = autoCol;
      occupy(autoRow, autoCol, it.rowSpan, it.colSpan);

      // Advance cursor past the placed item
      if (flowIsLTR) {
        autoCol += it.colSpan;
        if (numColsSpec > 0 && autoCol >= numColsSpec) { autoCol = 0; autoRow++; }
      } else {
        autoRow += it.rowSpan;
        if (numRowsSpec > 0 && autoRow >= numRowsSpec) { autoRow = 0; autoCol++; }
      }
    }

    // ------------------------------------------------------------------
    // Determine grid dimensions
    // ------------------------------------------------------------------
    let gridRows = 0, gridCols = 0;
    for (const it of items) {
      gridRows = Math.max(gridRows, it.row + it.rowSpan);
      gridCols = Math.max(gridCols, it.col + it.colSpan);
    }

    // ------------------------------------------------------------------
    // Compute column widths and row heights from preferred sizes
    // ------------------------------------------------------------------
    const colW    = new Float64Array(gridCols);
    const rowH    = new Float64Array(gridRows);
    const colFill = new Uint8Array(gridCols);
    const rowFill = new Uint8Array(gridRows);

    for (const it of items) {
      if (it.colSpan === 1) {
        const pw = Math.max(it.minW, Math.min(it.maxW, it.prefW)) + it.lm + it.rm;
        if (pw > colW[it.col]) colW[it.col] = pw;
        if (it.fillW) colFill[it.col] = 1;
      }
      if (it.rowSpan === 1) {
        const ph = Math.max(it.minH, Math.min(it.maxH, it.prefH)) + it.tm + it.bm;
        if (ph > rowH[it.row]) rowH[it.row] = ph;
        if (it.fillH) rowFill[it.row] = 1;
      }
    }

    // Distribute extra space to fill columns/rows when container is larger
    if (availW > 0) {
      const usedW = Array.from(colW).reduce((s, w) => s + w, 0) + colSpc * (gridCols - 1);
      const extra = availW - usedW;
      if (extra > 0) {
        const nFill = Array.from(colFill).filter(Boolean).length;
        if (nFill > 0) {
          const share = extra / nFill;
          for (let c = 0; c < gridCols; c++) if (colFill[c]) colW[c] += share;
        }
      }
    }
    if (availH > 0) {
      const usedH = Array.from(rowH).reduce((s, h) => s + h, 0) + rowSpc * (gridRows - 1);
      const extra = availH - usedH;
      if (extra > 0) {
        const nFill = Array.from(rowFill).filter(Boolean).length;
        if (nFill > 0) {
          const share = extra / nFill;
          for (let r = 0; r < gridRows; r++) if (rowFill[r]) rowH[r] += share;
        }
      }
    }

    // ------------------------------------------------------------------
    // Compute cumulative offsets
    // ------------------------------------------------------------------
    const colOffsets = new Float64Array(gridCols);
    const rowOffsets = new Float64Array(gridRows);
    let cx = pl, cy = pt;
    for (let c = 0; c < gridCols; c++) { colOffsets[c] = cx; cx += colW[c] + colSpc; }
    for (let r = 0; r < gridRows; r++) { rowOffsets[r] = cy; cy += rowH[r] + rowSpc; }

    // ------------------------------------------------------------------
    // Place items
    // ------------------------------------------------------------------
    for (const it of items) {
      const cellX = colOffsets[it.col];
      const cellY = rowOffsets[it.row];

      // Cell extents for spanning items
      const cellW = it.colSpan === 1
        ? colW[it.col]
        : Array.from({ length: it.colSpan }, (_, i) => colW[it.col + i]).reduce((s, w) => s + w, 0) + colSpc * (it.colSpan - 1);
      const cellH = it.rowSpan === 1
        ? rowH[it.row]
        : Array.from({ length: it.rowSpan }, (_, i) => rowH[it.row + i]).reduce((s, h) => s + h, 0) + rowSpc * (it.rowSpan - 1);

      // Item dimensions
      const itemW = it.fillW
        ? Math.max(it.minW, Math.min(it.maxW, cellW - it.lm - it.rm))
        : Math.max(it.minW, Math.min(it.maxW, it.prefW));
      const itemH = it.fillH
        ? Math.max(it.minH, Math.min(it.maxH, cellH - it.tm - it.bm))
        : Math.max(it.minH, Math.min(it.maxH, it.prefH));

      it.child.width  = itemW;
      it.child.height = itemH;

      // Horizontal alignment
      const ah = LayoutContainer._alignH(it.align);
      let ix;
      if (ah === 'right') {
        ix = cellX + cellW - it.rm - itemW;
      } else if (ah === 'hcenter') {
        ix = cellX + it.lm + Math.max(0, (cellW - it.lm - it.rm - itemW) / 2);
      } else {
        ix = cellX + it.lm;
      }

      // Vertical alignment
      const av = LayoutContainer._alignV(it.align);
      let iy;
      if (av === 'bottom') {
        iy = cellY + cellH - it.bm - itemH;
      } else if (av === 'vcenter') {
        iy = cellY + it.tm + Math.max(0, (cellH - it.tm - it.bm - itemH) / 2);
      } else {
        iy = cellY + it.tm;
      }

      it.child.x = ix;
      it.child.y = iy;
    }

    // Update implicit size (based on preferred/minimum sizes, not container size)
    const totalW = Array.from(colW).reduce((s, w) => s + w, 0) + colSpc * Math.max(0, gridCols - 1);
    const totalH = Array.from(rowH).reduce((s, h) => s + h, 0) + rowSpc * Math.max(0, gridRows - 1);
    this.implicitWidth  = pl + totalW + pr;
    this.implicitHeight = pt + totalH + pb;
  }
}

// ---------------------------------------------------------------------------
// Stage G: ScrollBar – canvas-rendered scrollbar control (QtQuick.Controls 2)
// ---------------------------------------------------------------------------

class ScrollBar extends Item {
  constructor(options = {}) {
    super(options);

    // 'Vertical' | 'Horizontal'  (also accept Qt.Vertical / Qt.Horizontal ints)
    this.defineProperty('orientation', options.orientation ?? 'Vertical');
    // Fractional size of the visible viewport relative to content (0..1)
    this.defineProperty('size', options.size !== undefined ? options.size : 1.0);
    // Fractional position of the viewport start relative to full content (0..1)
    this.defineProperty('position', options.position !== undefined ? options.position : 0.0);
    // Whether the bar is active (thumb is being dragged or mouse is over)
    this.defineProperty('active', options.active !== undefined ? options.active : false);
    // 'ScrollBarAsNeeded' | 'ScrollBarAlwaysOff' | 'ScrollBarAlwaysOn'
    this.defineProperty('policy', options.policy ?? 'ScrollBarAsNeeded');
    // Minimum thumb size as a fraction (0..1); prevents thumb from becoming too tiny
    this.defineProperty('minimumSize', options.minimumSize !== undefined ? options.minimumSize : 0.05);

    this.defineSignal('moved');
    this.defineSignal('pressed');
    this.defineSignal('released');

    this.implicitWidth  = 8;
    this.implicitHeight = 8;

    // Internal drag state
    this._sbDragActive = false;
    this._sbDragStartPos = 0;      // pointer scene coord at drag start
    this._sbDragStartPosition = 0; // this.position at drag start
  }

  // Returns true if the bar should be visible given policy + size
  _shouldShow() {
    const policy = this.policy || 'ScrollBarAsNeeded';
    if (policy === 'ScrollBarAlwaysOff') return false;
    if (policy === 'ScrollBarAlwaysOn')  return true;
    // AsNeeded: hide when content fits viewport exactly
    const sz = Math.max(0, Math.min(1, this.size ?? 1));
    return sz < 1.0;
  }

  // Compute thumb rect in local coords
  _thumbRect() {
    const isV = this._isVertical();
    const w = this.width  || this.implicitWidth  || 8;
    const h = this.height || this.implicitHeight || 8;
    const trackLen = isV ? h : w;
    const sz  = Math.max(this.minimumSize ?? 0.05, Math.min(1, this.size ?? 1));
    const pos = Math.max(0, Math.min(1 - sz, this.position ?? 0));
    const thumbLen = sz * trackLen;
    const thumbOff = pos * trackLen;
    if (isV) {
      return { x: 0, y: thumbOff, width: w, height: thumbLen };
    } else {
      return { x: thumbOff, y: 0, width: thumbLen, height: h };
    }
  }

  _isVertical() {
    const o = this.orientation;
    // Accept numeric Qt enum values: Qt.Vertical = 2, Qt.Horizontal = 1
    return o === 'Vertical' || o === 2 || o === 'Qt.Vertical';
  }

  draw(context) {
    if (!this._shouldShow()) return;

    const w = this.width  || this.implicitWidth  || 8;
    const h = this.height || this.implicitHeight || 8;
    if (w <= 0 || h <= 0) return;

    // Track background
    context.fillStyle = 'rgba(0,0,0,0.08)';
    _ctrlRoundRect(context, 0, 0, w, h, Math.min(w, h) / 2);
    context.fill();

    // Thumb
    const t = this._thumbRect();
    const active = this._sbDragActive || (this.active ?? false);
    context.fillStyle = active ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)';
    const r = Math.min(t.width, t.height) / 2;
    _ctrlRoundRect(context, t.x, t.y, t.width, t.height, r);
    context.fill();
  }

  handlePointerEvent(type, event) {
    if (!this._shouldShow()) return false;
    if (!this.enabled) return false;

    const isV = this._isVertical();
    const w = this.width  || this.implicitWidth  || 8;
    const h = this.height || this.implicitHeight || 8;
    const trackLen = isV ? h : w;

    // Convert scene coordinates to local
    const localX = (event.sceneX ?? 0) - this._sceneX();
    const localY = (event.sceneY ?? 0) - this._sceneY();
    const localCoord = isV ? localY : localX;

    if (type === 'down') {
      const t = this._thumbRect();
      const thumbStart = isV ? t.y : t.x;
      const thumbEnd   = thumbStart + (isV ? t.height : t.width);

      // Click inside thumb → begin drag
      if (localCoord >= thumbStart && localCoord <= thumbEnd) {
        this._sbDragActive = true;
        this._sbDragStartPos = localCoord;
        this._sbDragStartPosition = this.position ?? 0;
        this._setPropertyValue('active', true);
        this.pressed.emit();
        return true;
      }

      // Click outside thumb → jump position
      const sz  = Math.max(this.minimumSize ?? 0.05, Math.min(1, this.size ?? 1));
      const halfThumb = sz * trackLen / 2;
      const newPos = Math.max(0, Math.min(1 - sz, (localCoord - halfThumb) / trackLen));
      this.position = newPos;
      this.moved.emit();
      return true;
    }

    if (type === 'move' && this._sbDragActive) {
      const sz  = Math.max(this.minimumSize ?? 0.05, Math.min(1, this.size ?? 1));
      const delta = localCoord - this._sbDragStartPos;
      const newPos = Math.max(0, Math.min(1 - sz, this._sbDragStartPosition + delta / trackLen));
      this.position = newPos;
      this.moved.emit();
      return true;
    }

    if (type === 'up' && this._sbDragActive) {
      this._sbDragActive = false;
      this._setPropertyValue('active', false);
      this.released.emit();
      return true;
    }

    return false;
  }

  // Helper: scene X of this item (walk parent chain)
  _sceneX() {
    let x = this.x || 0;
    let p = this.parentItem;
    while (p) { x += (p.x || 0); p = p.parentItem; }
    return x;
  }
  _sceneY() {
    let y = this.y || 0;
    let p = this.parentItem;
    while (p) { y += (p.y || 0); p = p.parentItem; }
    return y;
  }
}

// ---------------------------------------------------------------------------
// Stage G: ScrollView – viewport with automatic scrollbars
// ---------------------------------------------------------------------------

class ScrollView extends Item {
  constructor(options = {}) {
    super(options);

    this.clip = true;

    // ScrollBar policy defaults
    this.defineProperty('ScrollBarVerticalPolicy',   options.ScrollBarVerticalPolicy   ?? 'ScrollBarAsNeeded');
    this.defineProperty('ScrollBarHorizontalPolicy', options.ScrollBarHorizontalPolicy ?? 'ScrollBarAsNeeded');

    // Scrollbar thickness in pixels (used in constructor and _layout)
    this._scrollBarWidth = 8;

    // Internal Flickable that holds the content
    this._flickable = new Flickable({
      flickableDirection: 'HorizontalAndVerticalFlick',
      parentItem: this,
    });

    // Vertical scrollbar
    this._vBar = new ScrollBar({
      orientation: 'Vertical',
      parentItem: this,
      policy: options.ScrollBarVerticalPolicy ?? 'ScrollBarAsNeeded',
    });

    // Horizontal scrollbar
    this._hBar = new ScrollBar({
      orientation: 'Horizontal',
      parentItem: this,
      policy: options.ScrollBarHorizontalPolicy ?? 'ScrollBarAsNeeded',
    });

    // Wire Flickable ↔ ScrollBars
    this._flickable.connect('contentYChanged', () => this._syncBarsFromFlickable());
    this._flickable.connect('contentXChanged', () => this._syncBarsFromFlickable());
    this._flickable.connect('contentHeightChanged', () => this._syncBarsFromFlickable());
    this._flickable.connect('contentWidthChanged', () => this._syncBarsFromFlickable());
    this._vBar.connect('positionChanged', () => this._syncFlickableFromBar('v'));
    this._hBar.connect('positionChanged', () => this._syncFlickableFromBar('h'));

    // When size changes, re-layout
    this.connect('widthChanged',  () => this._layout());
    this.connect('heightChanged', () => this._layout());

    this._layout();
  }

  _layout() {
    const w = this.width  || 0;
    const h = this.height || 0;
    const barW = this._scrollBarWidth;
    const vVisible = this._vBar._shouldShow();
    const hVisible = this._hBar._shouldShow();
    const innerW = w - (vVisible ? barW : 0);
    const innerH = h - (hVisible ? barW : 0);

    this._flickable.x = 0;
    this._flickable.y = 0;
    this._flickable.width  = Math.max(0, innerW);
    this._flickable.height = Math.max(0, innerH);

    this._vBar.x = innerW;
    this._vBar.y = 0;
    this._vBar.width  = barW;
    this._vBar.height = Math.max(0, innerH);

    this._hBar.x = 0;
    this._hBar.y = innerH;
    this._hBar.width  = Math.max(0, innerW);
    this._hBar.height = barW;
  }

  _syncBarsFromFlickable() {
    const f = this._flickable;
    const cH = f.contentHeight || 0;
    const vH = f.height || 1;
    if (cH > 0) {
      this._vBar.size     = Math.min(1, vH / cH);
      this._vBar.position = Math.max(0, Math.min(1 - this._vBar.size, (f.contentY || 0) / cH));
    } else {
      this._vBar.size = 1; this._vBar.position = 0;
    }

    const cW = f.contentWidth || 0;
    const vW = f.width || 1;
    if (cW > 0) {
      this._hBar.size     = Math.min(1, vW / cW);
      this._hBar.position = Math.max(0, Math.min(1 - this._hBar.size, (f.contentX || 0) / cW));
    } else {
      this._hBar.size = 1; this._hBar.position = 0;
    }

    this._layout();
  }

  _syncFlickableFromBar(axis) {
    const f = this._flickable;
    if (axis === 'v') {
      const cH = f.contentHeight || 0;
      f.contentY = (this._vBar.position ?? 0) * cH;
    } else {
      const cW = f.contentWidth || 0;
      f.contentX = (this._hBar.position ?? 0) * cW;
    }
  }

  // Expose the inner flickable's contentItem-related properties
  get contentWidth()  { return this._flickable.contentWidth;  }
  set contentWidth(v) { this._flickable.contentWidth  = v; this._syncBarsFromFlickable(); }
  get contentHeight() { return this._flickable.contentHeight; }
  set contentHeight(v){ this._flickable.contentHeight = v; this._syncBarsFromFlickable(); }

  handlePointerEvent(type, event) {
    // Delegate to scrollbars first, then flickable
    if (this._vBar.handlePointerEvent(type, event)) return true;
    if (this._hBar.handlePointerEvent(type, event)) return true;
    return this._flickable.handlePointerEvent(type, event);
  }

  handleWheelEvent(event) {
    return this._flickable.handleWheelEvent(event);
  }
}

// ---------------------------------------------------------------------------
// Stage G: ApplicationWindow – root window container
// ---------------------------------------------------------------------------

class ApplicationWindow extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('title',   options.title   ?? '');
    this.defineProperty('visible', options.visible !== undefined ? options.visible : true);
    this.defineProperty('color',   options.color   ?? '#ffffff');

    this.implicitWidth  = options.width  || 800;
    this.implicitHeight = options.height || 600;

    // header / footer items (optional)
    this._header = null;
    this._footer = null;
  }

  get header() { return this._header; }
  set header(v) {
    this._header = v;
    if (v instanceof Item) {
      v.parentItem = this;
      this._layoutContent();
    }
  }

  get footer() { return this._footer; }
  set footer(v) {
    this._footer = v;
    if (v instanceof Item) {
      v.parentItem = this;
      this._layoutContent();
    }
  }

  _layoutContent() {
    const w = this.width  || this.implicitWidth  || 800;
    const h = this.height || this.implicitHeight || 600;
    const headerH = (this._header && this._header.height) ? this._header.height : 0;
    const footerH = (this._footer && this._footer.height) ? this._footer.height : 0;

    if (this._header) {
      this._header.x = 0; this._header.y = 0;
      this._header.width = w;
    }
    if (this._footer) {
      this._footer.x = 0;
      this._footer.y = h - footerH;
      this._footer.width = w;
    }
  }

  draw(context) {
    const w = this.width  || this.implicitWidth  || 800;
    const h = this.height || this.implicitHeight || 600;
    context.fillStyle = this.color || '#ffffff';
    context.fillRect(0, 0, w, h);
  }
}

// ---------------------------------------------------------------------------
// Stage G: Page – content page with optional header/footer
// ---------------------------------------------------------------------------

class Page extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('title',           options.title           ?? '');
    this.defineProperty('background',      options.background      ?? '#ffffff');
    this.defineProperty('padding',         options.padding         ?? 0);
    this.defineProperty('topPadding',      options.topPadding      ?? 0);
    this.defineProperty('bottomPadding',   options.bottomPadding   ?? 0);
    this.defineProperty('leftPadding',     options.leftPadding     ?? 0);
    this.defineProperty('rightPadding',    options.rightPadding    ?? 0);

    this._header = null;
    this._footer = null;
  }

  get header() { return this._header; }
  set header(v) {
    this._header = v;
    if (v instanceof Item) {
      v.parentItem = this;
      this._layoutContent();
    }
  }

  get footer() { return this._footer; }
  set footer(v) {
    this._footer = v;
    if (v instanceof Item) {
      v.parentItem = this;
      this._layoutContent();
    }
  }

  _layoutContent() {
    const w = this.width  || 0;
    const h = this.height || 0;
    if (this._header) { this._header.x = 0; this._header.y = 0; this._header.width = w; }
    if (this._footer) {
      const fh = (this._footer.height) ? this._footer.height : 0;
      this._footer.x = 0; this._footer.y = h - fh; this._footer.width = w;
    }
  }

  draw(context) {
    const w = this.width  || 0;
    const h = this.height || 0;
    if (w <= 0 || h <= 0) return;
    context.fillStyle = this.background || '#ffffff';
    context.fillRect(0, 0, w, h);
  }
}

// ---------------------------------------------------------------------------
// Stage G: StackView – push/pop page navigation
// ---------------------------------------------------------------------------

class StackView extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('depth',         0,    { readOnly: true });
    this.defineProperty('currentIndex',  -1,   { readOnly: true });
    this.defineProperty('busy',          false, { readOnly: true });

    this.defineSignal('pushed');
    this.defineSignal('popped');
    this.defineSignal('replaced');

    // Internal stack: array of instantiated Items
    this._stack = [];

    // Optional initial item
    if (options.initialItem) {
      // Push after construction
      Promise.resolve().then(() => this.push(options.initialItem));
    }
  }

  // currentItem property (read-only, derived from _stack)
  get currentItem() {
    return this._stack.length > 0 ? this._stack[this._stack.length - 1] : null;
  }

  /**
   * Push an item or component onto the stack.
   * @param {Item|Function|object} item  Item instance, factory function, or options
   * @param {object} [properties]        Properties to apply to the new item
   * @returns {Item} The newly created/pushed item
   */
  push(item, properties) {
    let page;
    if (typeof item === 'function') {
      // Component factory
      page = item();
    } else if (item instanceof Item) {
      page = item;
    } else {
      // Plain object treated as a Rectangle placeholder
      page = new Rectangle(item || {});
    }

    if (properties && typeof properties === 'object') {
      for (const [k, v] of Object.entries(properties)) {
        page[k] = v;
      }
    }

    // Attach to StackView
    page.parentItem = this;
    page.x = 0; page.y = 0;
    page.width  = this.width  || page.width  || 0;
    page.height = this.height || page.height || 0;

    // Hide all previous pages
    for (const prev of this._stack) { prev.visible = false; }

    this._stack.push(page);
    this._setPropertyValue('depth', this._stack.length);
    this._setPropertyValue('currentIndex', this._stack.length - 1);
    this.pushed.emit(page);
    return page;
  }

  /**
   * Pop the top item off the stack.
   * Returns null (without removing anything) when the stack has only one item –
   * the root page is preserved, consistent with Qt's StackView behaviour.
   * @returns {Item|null} The item that was removed, or null if stack depth <= 1.
   */
  pop() {
    if (this._stack.length <= 1) return null;
    const removed = this._stack.pop();
    removed.visible = false;
    removed.parentItem = null;

    const current = this._stack[this._stack.length - 1];
    if (current) current.visible = true;

    this._setPropertyValue('depth', this._stack.length);
    this._setPropertyValue('currentIndex', this._stack.length - 1);
    this.popped.emit(removed);
    return removed;
  }

  /**
   * Replace the current top item with a new one.
   * @param {Item|Function|object} item
   * @param {object} [properties]
   * @returns {Item} The new top item
   */
  replace(item, properties) {
    if (this._stack.length > 0) {
      const old = this._stack.pop();
      old.visible = false;
      old.parentItem = null;
    }
    return this.push(item, properties);
  }

  /**
   * Clear the stack, optionally keeping the bottom item.
   */
  clear() {
    for (const page of this._stack) {
      page.visible = false;
      page.parentItem = null;
    }
    this._stack = [];
    this._setPropertyValue('depth', 0);
    this._setPropertyValue('currentIndex', -1);
  }
}

// ---------------------------------------------------------------------------
// Stage I: Popup – base class for floating overlay panels
// ---------------------------------------------------------------------------

/**
 * Popup is the base class for Dialog, Menu and other floating panels.
 *
 * closePolicy is a bitmask:
 *   Popup.NoAutoClose        = 0  – never auto-close
 *   Popup.CloseOnEscape      = 1  – close when Escape is pressed
 *   Popup.CloseOnPressOutside = 2  – close when pointer presses outside bounds
 *
 * Default: CloseOnEscape | CloseOnPressOutside = 3.
 */
class Popup extends Item {
  constructor(options = {}) {
    super(options);

    // Popups default to hidden; use open() / close() to show/hide.
    this._setPropertyValue('visible', options.visible !== undefined ? options.visible : false);

    // Whether to block mouse events to items behind the popup.
    this.defineProperty('modal',       options.modal       !== undefined ? options.modal       : false);
    // Render a translucent dim overlay behind the popup when modal and dim.
    this.defineProperty('dim',         options.dim         !== undefined ? options.dim         : true);
    // closePolicy bitmask (see static constants).
    this.defineProperty('closePolicy', options.closePolicy !== undefined ? options.closePolicy : Popup.CloseOnEscape | Popup.CloseOnPressOutside);
    // Background fill colour of the popup panel.
    this.defineProperty('background',  options.background  !== undefined ? options.background  : '#ffffff');
    // Default padding around the content area.
    this.defineProperty('padding',     options.padding     !== undefined ? options.padding     : 0);

    this.defineSignal('opened');
    this.defineSignal('closed');

    // Render on top by default.
    if (options.z === undefined) {
      this.z = 1000;
    }

    // Implicit size – callers should set width/height explicitly.
    this.implicitWidth  = options.width  || 300;
    this.implicitHeight = options.height || 200;
  }

  /** Show the popup. */
  open() {
    if (!this.visible) {
      this._setPropertyValue('visible', true);
      this.opened.emit();
    }
  }

  /** Hide the popup. */
  close() {
    if (this.visible) {
      this._setPropertyValue('visible', false);
      this.closed.emit();
    }
  }

  draw(context) {
    const w = this.width  || this.implicitWidth  || 300;
    const h = this.height || this.implicitHeight || 200;
    if (w <= 0 || h <= 0) return;

    // When modal+dim, paint a full-scene translucent overlay behind this panel.
    // We walk up to find the scene (root item) dimensions.
    if (this.modal && this.dim) {
      const root = this._sceneRoot();
      if (root) {
        const rw = root.width || root.implicitWidth || 0;
        const rh = root.height || root.implicitHeight || 0;
        if (rw > 0 && rh > 0) {
          // Translate back to root coords
          const sx = this._sceneOffsetX();
          const sy = this._sceneOffsetY();
          context.save();
          context.translate(-sx, -sy);
          context.fillStyle = 'rgba(0,0,0,0.4)';
          context.fillRect(0, 0, rw, rh);
          context.restore();
        }
      }
    }

    // Panel background
    const radius = 8;
    context.fillStyle = this.background || '#ffffff';
    _ctrlRoundRect(context, 0, 0, w, h, radius);
    context.fill();

    // Drop shadow
    context.shadowColor   = 'rgba(0,0,0,0.25)';
    context.shadowBlur    = 12;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 4;
    _ctrlRoundRect(context, 0, 0, w, h, radius);
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur  = 0;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _sceneRoot() {
    let p = this.parentItem || this;
    while (p && p.parentItem) p = p.parentItem;
    return p;
  }

  _sceneOffsetX() {
    let x = this.x || 0;
    let p = this.parentItem;
    while (p) { x += (p.x || 0); p = p.parentItem; }
    return x;
  }

  _sceneOffsetY() {
    let y = this.y || 0;
    let p = this.parentItem;
    while (p) { y += (p.y || 0); p = p.parentItem; }
    return y;
  }

  /** Returns true if scene coordinate (sx, sy) is inside this popup's bounds. */
  containsScenePoint(sx, sy) {
    const px = this._sceneOffsetX();
    const py = this._sceneOffsetY();
    const w  = this.width  || this.implicitWidth  || 0;
    const h  = this.height || this.implicitHeight || 0;
    return sx >= px && sx < px + w && sy >= py && sy < py + h;
  }
}

// Static closePolicy constants
Popup.NoAutoClose         = 0;
Popup.CloseOnEscape       = 1;
Popup.CloseOnPressOutside = 2;

// ---------------------------------------------------------------------------
// Stage I: Dialog – modal dialog with title and standard buttons
// ---------------------------------------------------------------------------

class Dialog extends Popup {
  constructor(options = {}) {
    super({
      modal:      true,
      dim:        true,
      background: '#ffffff',
      padding:    16,
      ...options,
    });

    this.defineProperty('title',          options.title          ?? '');
    // Bitmask: Dialog.Ok=1, Dialog.Cancel=2, Dialog.NoButton=0
    this.defineProperty('standardButtons', options.standardButtons !== undefined ? options.standardButtons : Dialog.Ok | Dialog.Cancel);

    this.defineSignal('accepted');
    this.defineSignal('rejected');

    this.implicitWidth  = options.width  || 360;
    this.implicitHeight = options.height || 180;
  }

  draw(context) {
    // Draw the base popup panel (includes dim overlay when modal).
    super.draw(context);

    const w = this.width  || this.implicitWidth  || 360;
    const h = this.height || this.implicitHeight || 180;
    if (w <= 0 || h <= 0) return;

    const p = Theme.palette;
    const f = Theme.font;

    // Title bar
    const titleH = 40;
    context.fillStyle = p.primary || '#1976d2';
    _ctrlRoundRect(context, 0, 0, w, titleH, 8);
    context.fill();
    // Title text
    if (this.title) {
      context.font = `bold ${f.pixelSize || 14}px ${f.family || 'sans-serif'}`;
      context.fillStyle = '#ffffff';
      context.textBaseline = 'middle';
      context.textAlign = 'left';
      context.fillText(String(this.title), 12, titleH / 2);
      context.textAlign = 'left';
      context.textBaseline = 'top';
    }

    // Divider
    context.strokeStyle = 'rgba(0,0,0,0.1)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, titleH);
    context.lineTo(w, titleH);
    context.stroke();

    // Standard buttons (drawn at the bottom)
    const btnH = 36;
    const btnW = 80;
    const btnY = h - btnH - 12;
    const btns = this._buttons();
    let btnX = w - 12;
    for (const btn of btns.slice().reverse()) {
      btnX -= btnW;
      const isOk     = btn.role === 'accept';
      const hovered  = this[`_${btn.id}Hovered`] || false;
      const pressed  = this[`_${btn.id}Pressed`] || false;

      let bg;
      if (isOk) {
        bg = pressed ? (p.primaryPressed || '#1565c0') : hovered ? (p.primaryHover || '#1e88e5') : (p.primary || '#1976d2');
      } else {
        bg = pressed ? '#e0e0e0' : hovered ? '#f5f5f5' : '#eeeeee';
      }

      _ctrlRoundRect(context, btnX, btnY, btnW, btnH, 6);
      context.fillStyle = bg;
      context.fill();

      context.font = `${f.pixelSize || 14}px ${f.family || 'sans-serif'}`;
      context.fillStyle = isOk ? '#ffffff' : (p.text || '#212121');
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(btn.label, btnX + btnW / 2, btnY + btnH / 2);
      context.textAlign = 'left';
      context.textBaseline = 'top';

      btnX -= 8; // gap between buttons
    }
  }

  _buttons() {
    const result = [];
    const sb = this.standardButtons !== undefined ? this.standardButtons : (Dialog.Ok | Dialog.Cancel);
    if (sb & Dialog.Ok)     result.push({ id: 'ok',     label: 'OK',     role: 'accept' });
    if (sb & Dialog.Cancel) result.push({ id: 'cancel', label: 'Cancel', role: 'reject' });
    return result;
  }

  handlePointerEvent(type, event) {
    if (!this.visible || !this.enabled) return false;

    const w = this.width  || this.implicitWidth  || 360;
    const h = this.height || this.implicitHeight || 180;
    const btnH = 36;
    const btnW = 80;
    const btnY = h - btnH - 12;
    const btns = this._buttons();

    // Convert scene coords to local
    const lx = event.sceneX - this._sceneOffsetX();
    const ly = event.sceneY - this._sceneOffsetY();

    // Check if pointer is inside dialog bounds
    if (lx < 0 || lx > w || ly < 0 || ly > h) return false;

    // Check buttons
    let btnX = w - 12;
    for (const btn of btns.slice().reverse()) {
      btnX -= btnW;
      const inside = lx >= btnX && lx <= btnX + btnW && ly >= btnY && ly <= btnY + btnH;

      if (type === 'down') {
        this[`_${btn.id}Hovered`] = inside;
        this[`_${btn.id}Pressed`] = inside;
      } else if (type === 'move') {
        this[`_${btn.id}Hovered`] = inside;
      } else if (type === 'up') {
        const wasPressed = this[`_${btn.id}Pressed`];
        this[`_${btn.id}Pressed`] = false;
        if (wasPressed && inside) {
          if (btn.role === 'accept') {
            this.accepted.emit();
          } else {
            this.rejected.emit();
          }
          this.close();
        }
      }
      btnX -= 8;
    }

    return true; // consume event to prevent click-through
  }
}

// Standard button bitmask constants
Dialog.NoButton = 0;
Dialog.Ok       = 1;
Dialog.Cancel   = 2;

// ---------------------------------------------------------------------------
// Stage I: MenuItem – item in a Menu
// ---------------------------------------------------------------------------

class MenuItem extends Item {
  constructor(options = {}) {
    super(options);

    this.defineProperty('text',    options.text    ?? '');
    this.defineProperty('hovered', false);
    this.defineProperty('checked', options.checked !== undefined ? options.checked : false);

    // Apply enabled if provided (Item base already defines it defaulting to true)
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }

    this.defineSignal('triggered');

    this.implicitWidth  = 160;
    this.implicitHeight = 32;
  }

  handlePointerEvent(type, event) {
    if (!this.enabled) return false;

    const w = this.width  || this.implicitWidth  || 160;
    const h = this.height || this.implicitHeight || 32;
    const lx = event.sceneX - this._sceneOffsetX();
    const ly = event.sceneY - this._sceneOffsetY();
    const inside = lx >= 0 && lx < w && ly >= 0 && ly < h;

    if (type === 'move') {
      this._setPropertyValue('hovered', inside);
      return inside;
    }

    if (type === 'down' && inside) {
      return true;
    }

    if (type === 'up' && inside) {
      this.triggered.emit();
      // Close the parent Menu if present
      let p = this.parentItem;
      while (p) {
        if (p instanceof Menu) { p.close(); break; }
        p = p.parentItem;
      }
      return true;
    }

    return false;
  }

  draw(context) {
    const w = this.width  || this.implicitWidth  || 160;
    const h = this.height || this.implicitHeight || 32;
    if (w <= 0 || h <= 0) return;

    const hovered = this.hovered;
    if (hovered) {
      context.fillStyle = Theme.palette.primaryHover || '#e3f2fd';
      context.fillRect(0, 0, w, h);
    }

    const f = Theme.font;
    context.font = `${f.pixelSize || 14}px ${f.family || 'sans-serif'}`;
    const color = this.enabled ? (Theme.palette.text || '#212121') : (Theme.palette.disabledText || '#9e9e9e');
    context.fillStyle = color;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillText(String(this.text ?? ''), 12, h / 2);
    context.textAlign = 'left';
    context.textBaseline = 'top';
  }

  // Helper: scene X/Y offset of this item (consistent with Popup._sceneOffsetX/Y naming)
  _sceneOffsetX() {
    let x = this.x || 0;
    let p = this.parentItem;
    while (p) { x += (p.x || 0); p = p.parentItem; }
    return x;
  }

  _sceneOffsetY() {
    let y = this.y || 0;
    let p = this.parentItem;
    while (p) { y += (p.y || 0); p = p.parentItem; }
    return y;
  }
}

// ---------------------------------------------------------------------------
// Stage I: Menu – popup containing a column of MenuItems
// ---------------------------------------------------------------------------

class Menu extends Popup {
  constructor(options = {}) {
    super({
      modal:      false,
      dim:        false,
      closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside,
      background: '#ffffff',
      padding:    4,
      ...options,
    });

    this.implicitWidth  = options.width  || 160;
    this.implicitHeight = options.height || 8; // grows with items

    // Watch child changes to re-layout
    this._menuLayoutPending = false;
  }

  // Override parentItem setter to re-layout when items are added
  _onChildItemAdded(child) {
    this._relayoutMenu();
  }

  _relayoutMenu() {
    const padding = this.padding || 4;
    const itemH   = 32;
    let y = padding;
    let maxW = this.implicitWidth || 160;

    for (const child of this.childItems) {
      if (child instanceof MenuItem) {
        child.x = 0;
        child.y = y;
        child.width  = this.width  || this.implicitWidth  || maxW;
        child.height = itemH;
        y += itemH;
      }
    }

    const totalH = y + padding;
    this.implicitHeight = totalH;
    if (!this.height || this.height < totalH) {
      this._setPropertyValue('height', totalH);
    }
  }

  draw(context) {
    // Re-layout items before drawing to ensure correct positions.
    this._relayoutMenu();

    const w = this.width  || this.implicitWidth  || 160;
    const h = this.height || this.implicitHeight || 8;
    if (w <= 0 || h <= 0) return;

    // Menu panel background with shadow
    const radius = 4;
    context.shadowColor   = 'rgba(0,0,0,0.2)';
    context.shadowBlur    = 8;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 2;
    context.fillStyle = this.background || '#ffffff';
    _ctrlRoundRect(context, 0, 0, w, h, radius);
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur  = 0;

    // Thin border
    context.strokeStyle = 'rgba(0,0,0,0.12)';
    context.lineWidth   = 1;
    _ctrlRoundRect(context, 0.5, 0.5, w - 1, h - 1, radius);
    context.stroke();
  }

  handlePointerEvent(type, event) {
    if (!this.visible || !this.enabled) return false;

    // Delegate to child MenuItems first
    for (const child of this.childItems) {
      if (child instanceof MenuItem && typeof child.handlePointerEvent === 'function') {
        if (child.handlePointerEvent(type, event)) return true;
      }
    }

    // Consume any event that hits the menu panel itself to prevent click-through
    if (this.containsScenePoint(event.sceneX, event.sceneY)) return true;
    return false;
  }

  // When the menu is opened/closed, update children widths to match menu width.
  open() {
    this._relayoutMenu();
    super.open();
  }
}

// ---------------------------------------------------------------------------
// Stage I: Overlay – lightweight singleton-like overlay descriptor
// (matches Qt's ApplicationWindow.overlay attached property concept)
// ---------------------------------------------------------------------------

class Overlay extends Item {
  constructor(options = {}) {
    super(options);
    this.defineProperty('color', options.color ?? 'rgba(0,0,0,0.4)');
    this.z = 999; // just below popups
    this._setPropertyValue('visible', false);
  }

  draw(context) {
    const root = this._sceneRoot();
    if (!root) return;
    const w = root.width || root.implicitWidth || 0;
    const h = root.height || root.implicitHeight || 0;
    if (w <= 0 || h <= 0) return;
    const sx = this._sceneOffsetX();
    const sy = this._sceneOffsetY();
    context.save();
    context.translate(-sx, -sy);
    context.fillStyle = this.color || 'rgba(0,0,0,0.4)';
    context.fillRect(0, 0, w, h);
    context.restore();
  }

  _sceneRoot() {
    let p = this.parentItem || this;
    while (p && p.parentItem) p = p.parentItem;
    return p;
  }

  _sceneOffsetX() {
    let x = this.x || 0;
    let p = this.parentItem;
    while (p) { x += (p.x || 0); p = p.parentItem; }
    return x;
  }

  _sceneOffsetY() {
    let y = this.y || 0;
    let p = this.parentItem;
    while (p) { y += (p.y || 0); p = p.parentItem; }
    return y;
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
  // Stage F: TextInput
  TextInput,
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
  Flickable,
  ListView,
  // Stage C: focus / keys / pointer handlers
  Keys,
  TapHandler,
  DragHandler,
  // Stage H: pointer handler extensions
  HoverHandler,
  WheelHandler,
  PinchHandler,
  // Stage D: controls MVP
  Theme,
  Button,
  Label,
  TextField,
  Slider,
  CheckBox,
  // Stage E: rendering improvements
  Image,
  // PR2: layout positioners
  Positioner,
  Row,
  Column,
  Flow,
  // QtQuick.Layouts
  LayoutContainer,
  RowLayout,
  ColumnLayout,
  GridLayout,
  // Stage G: extended controls
  ScrollBar,
  ScrollView,
  ApplicationWindow,
  Page,
  StackView,
  // Stage I: popups / menus / dialogs
  Popup,
  Dialog,
  MenuItem,
  Menu,
  Overlay,
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
