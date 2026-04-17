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

class QObject {
  constructor(parent = null) {
    this._signals = new Map();
    this._propertyValues = new Map();
    this._propertyDefinitions = new Map();
    this._children = [];
    this._parent = null;

    this.defineSignal('destroyed');

    if (parent !== null) {
      this.setParent(parent);
    }
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
    };

    this._propertyDefinitions.set(name, definition);
    this._propertyValues.set(name, definition.coerce(initialValue));
    this.defineSignal(`${name}Changed`);

    Object.defineProperty(this, name, {
      enumerable: true,
      configurable: false,
      get: () => this._propertyValues.get(name),
      set: (value) => {
        if (definition.readOnly) {
          throw new Error(`Property '${name}' is read-only.`);
        }
        this._setPropertyValue(name, value);
      },
    });
  }

  _setPropertyValue(name, rawValue) {
    const definition = this._propertyDefinitions.get(name);
    if (!definition) {
      throw new Error(`Property '${name}' is not defined.`);
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
    for (const child of [...this._children]) {
      child.destroy();
    }

    this.setParent(null);
    this.destroyed.emit(this);
  }
}

class QtObject extends QObject {
  constructor(options = {}) {
    const { parent = null, properties = {} } = options;
    super(parent);

    for (const [name, value] of Object.entries(properties)) {
      this.defineProperty(name, value);
    }
  }
}

class Item extends QtObject {
  constructor(options = {}) {
    const {
      parent = null,
      parentItem = null,
      properties = {},
    } = options;

    super({ parent, properties });

    this._childItems = [];
    this._syncingParentLinks = false;

    this.defineProperty('x', 0);
    this.defineProperty('y', 0);
    this.defineProperty('width', 0);
    this.defineProperty('height', 0);
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
      },
    });

    if (parentItem instanceof Item) {
      this.parentItem = parentItem;
    } else if (parent instanceof Item) {
      this.parentItem = parent;
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
}

module.exports = {
  Signal,
  QObject,
  QtObject,
  Item,
};
