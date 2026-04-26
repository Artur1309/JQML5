const test = require('node:test');
const assert = require('node:assert/strict');

const {
  Binding,
  Context,
  QObject,
  QtObject,
  Item,
  Component,
  Loader,
  Rectangle,
  MouseArea,
  CanvasRenderer,
  Scene,
} = require('../src/runtime');

test('QObject properties emit change signal only on value change', () => {
  const obj = new QObject();
  obj.defineProperty('value', 1);

  const seen = [];
  obj.valueChanged.connect((next, previous) => {
    seen.push([next, previous]);
  });

  obj.value = 1;
  obj.value = 2;

  assert.deepEqual(seen, [[2, 1]]);
});

test('QtObject can define initial properties from constructor options', () => {
  const obj = new QtObject({
    properties: {
      title: 'hello',
      count: 3,
    },
  });

  assert.equal(obj.title, 'hello');
  assert.equal(obj.count, 3);
});

test('Item parentItem updates childItems and QObject parent linkage', () => {
  const root = new Item();
  const child = new Item();

  child.parentItem = root;

  assert.equal(child.parentItem, root);
  assert.equal(child.parent, root);
  assert.deepEqual(root.childItems, [child]);

  child.parentItem = null;

  assert.equal(child.parentItem, null);
  assert.equal(child.parent, null);
  assert.deepEqual(root.childItems, []);
});

test('bindings re-evaluate on dependency changes and can be replaced', () => {
  const obj = new QObject();
  obj.defineProperty('a', 2);
  obj.defineProperty('b', 3);
  obj.defineProperty('sum', 0);

  obj.sum = new Binding(() => obj.a + obj.b);
  assert.equal(obj.sum, 5);

  obj.a = 10;
  assert.equal(obj.sum, 13);

  obj.sum = 42;
  obj.a = 100;
  assert.equal(obj.sum, 42);
});

test('binding cycle is guarded from recursive re-entry', () => {
  const obj = new QObject();
  obj.defineProperty('value', 1);

  obj.value = () => obj.value + 1;
  assert.equal(obj.value, 2);
});

test('bindings are cleaned up on destroy', () => {
  const source = new QObject();
  source.defineProperty('value', 1);

  const target = new QObject();
  target.defineProperty('value', 0);
  target.value = () => source.value * 2;
  assert.equal(target.value, 2);

  target.destroy();
  source.value = 10;
  assert.equal(target.value, 2);
});

test('context lookup follows parent chain and object inheritance', () => {
  const rootContext = new Context(null, { title: 'root' });
  const childContext = new Context(rootContext, { subtitle: 'child' });

  const root = new QtObject();
  root.setContext(rootContext);
  const child = new QtObject({ parent: root });
  const explicit = new QtObject({ parent: root });
  explicit.setContext(childContext);

  assert.equal(child.getContext().lookup('title'), 'root');
  assert.equal(explicit.getContext().lookup('title'), 'root');
  assert.equal(explicit.getContext().lookup('subtitle'), 'child');
});

test('id registry works within the same component scope', () => {
  const root = new Item();
  const child = new Item({ parentItem: root });
  const grandChild = new Item({ parentItem: child });

  root.registerId('rootItem');
  child.registerId('childItem');

  assert.equal(grandChild.id('rootItem'), root);
  assert.equal(grandChild.id('childItem'), child);
});

test('alias property proxies target and emits changed signal', () => {
  const source = new QObject();
  source.defineProperty('value', 3);

  const proxy = new QObject();
  proxy.defineAlias('aliasValue', source, 'value');

  const seen = [];
  proxy.aliasValueChanged.connect((next, previous) => seen.push([next, previous]));

  source.value = 5;
  assert.equal(proxy.aliasValue, 5);

  proxy.aliasValue = 9;
  assert.equal(source.value, 9);
  assert.deepEqual(seen, [[5, 3], [9, 5]]);
});

test('component createObject wires parent/context and emits completed in post-order', () => {
  const lifecycle = [];
  const rootContext = new Context(null, { title: 'demo' });
  const parent = new Item();
  parent.setContext(rootContext);

  const component = new Component(({ parent: parentObject, context }) => {
    const root = new Item({ parentItem: parentObject });
    root.onCompleted = () => lifecycle.push('root');
    root.registerId('root');
    root.setContext(context);

    const child = new Item({ parentItem: root });
    child.onCompleted = () => lifecycle.push('child');

    return root;
  });

  const instance = component.createObject(parent);

  assert.equal(instance.parentItem, parent);
  assert.equal(instance.getContext().lookup('title'), 'demo');
  assert.deepEqual(lifecycle, ['child', 'root']);
  assert.equal(instance.id('root'), instance);
});

test('loader switches and unloads component instances', () => {
  const host = new Item();

  const first = new Component(({ parent }) => {
    const item = new Item({ parentItem: parent });
    item.defineProperty('name', 'first');
    return item;
  });

  const second = new Component(({ parent }) => {
    const item = new Item({ parentItem: parent });
    item.defineProperty('name', 'second');
    return item;
  });

  const loader = new Loader({ parentItem: host, sourceComponent: first });
  assert.equal(loader.item.name, 'first');

  loader.sourceComponent = second;
  assert.equal(loader.item.name, 'second');

  loader.active = false;
  assert.equal(loader.item, null);
});

test('anchors fill and centerIn compute geometry', () => {
  const root = new Item();
  root.width = 200;
  root.height = 100;

  const fillItem = new Item({ parentItem: root, anchors: { fill: root, margins: 10 } });
  assert.equal(fillItem.x, 10);
  assert.equal(fillItem.y, 10);
  assert.equal(fillItem.width, 180);
  assert.equal(fillItem.height, 80);

  const centered = new Item({ parentItem: root });
  centered.width = 50;
  centered.height = 20;
  centered.setAnchors({ centerIn: root });
  assert.equal(centered.x, 75);
  assert.equal(centered.y, 40);

  const container = new Item({ parentItem: root });
  container.x = 20;
  container.y = 15;
  container.width = 80;
  container.height = 60;
  const fillParent = new Item({ parentItem: container, anchors: { fill: container } });
  assert.equal(fillParent.x, 0);
  assert.equal(fillParent.y, 0);
  assert.equal(fillParent.width, 80);
  assert.equal(fillParent.height, 60);
});

test('mapToItem/mapFromItem and hitTest respect hierarchy', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const child = new Item({ parentItem: root });
  child.x = 20;
  child.y = 10;
  child.width = 50;
  child.height = 40;

  const grand = new Item({ parentItem: child });
  grand.x = 5;
  grand.y = 5;
  grand.width = 10;
  grand.height = 10;

  assert.deepEqual(grand.mapToItem(root, 0, 0), { x: 25, y: 15 });
  assert.deepEqual(root.mapFromItem(grand, 0, 0), { x: 25, y: 15 });
  assert.equal(root.hitTest(26, 16), grand);
});

test('scene dispatches pointer events to topmost MouseArea', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const bottom = new MouseArea({ parentItem: root });
  bottom.width = 100;
  bottom.height = 100;
  bottom.z = 0;

  const top = new MouseArea({ parentItem: root });
  top.width = 100;
  top.height = 100;
  top.z = 1;

  let clickedBottom = 0;
  let clickedTop = 0;
  bottom.clicked.connect(() => clickedBottom += 1);
  top.clicked.connect(() => clickedTop += 1);

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 10, 10);
  scene.dispatchPointer('up', 10, 10);

  assert.equal(clickedTop, 1);
  assert.equal(clickedBottom, 0);
});

test('canvas renderer draws children in z ascending order', () => {
  const calls = [];
  const fakeContext = {
    globalAlpha: 1,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: () => {},
    clearRect: () => calls.push('clear'),
  };

  const root = new Item();
  root.width = 100;
  root.height = 100;

  const low = new Rectangle({ parentItem: root, color: '#111' });
  low.width = 10;
  low.height = 10;
  low.z = -1;
  low.draw = () => calls.push('low');

  const high = new Rectangle({ parentItem: root, color: '#222' });
  high.width = 10;
  high.height = 10;
  high.z = 2;
  high.draw = () => calls.push('high');

  const renderer = new CanvasRenderer({
    rootItem: root,
    context2d: fakeContext,
    canvas: { width: 100, height: 100 },
    autoSchedule: false,
  });

  renderer.render();

  assert.deepEqual(calls.filter((entry) => entry === 'low' || entry === 'high'), ['low', 'high']);
});

// ---------------------------------------------------------------------------
// Stage A: Animations
// ---------------------------------------------------------------------------

test('AnimationTicker.advance steps all registered animations by dt', () => {
  const {
    AnimationTicker, NumberAnimation,
  } = require('../src/runtime');
  const {
    QObject,
  } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const target = new QObject();
  target.defineProperty('value', 0);

  const anim = new NumberAnimation({
    ticker,
    target,
    property: 'value',
    from: 0,
    to: 100,
    duration: 1000,
  });

  anim.start();
  assert.equal(anim.running, true);

  ticker.advance(500);
  assert.ok(target.value > 0 && target.value < 100, `Expected value between 0 and 100, got ${target.value}`);

  ticker.advance(500);
  assert.equal(target.value, 100);
  assert.equal(anim.running, false);
});

test('NumberAnimation interpolates from/to with easing', () => {
  const { AnimationTicker, NumberAnimation } = require('../src/runtime');
  const { QObject } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const target = new QObject();
  target.defineProperty('x', 0);

  const anim = new NumberAnimation({
    ticker,
    target,
    property: 'x',
    from: 0,
    to: 200,
    duration: 400,
    easing: 'Linear',
  });

  anim.start();
  ticker.advance(200);
  assert.equal(target.x, 100);
  ticker.advance(200);
  assert.equal(target.x, 200);
  assert.equal(anim.running, false);
});

test('NumberAnimation emits started and finished signals', () => {
  const { AnimationTicker, NumberAnimation } = require('../src/runtime');
  const { QObject } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const target = new QObject();
  target.defineProperty('val', 0);

  const anim = new NumberAnimation({ ticker, target, property: 'val', from: 0, to: 10, duration: 100 });

  let startedCount = 0;
  let finishedCount = 0;
  anim.started.connect(() => { startedCount += 1; });
  anim.finished.connect(() => { finishedCount += 1; });

  anim.start();
  assert.equal(startedCount, 1);
  ticker.advance(100);
  assert.equal(finishedCount, 1);
});

test('NumberAnimation loops correctly', () => {
  const { AnimationTicker, NumberAnimation } = require('../src/runtime');
  const { QObject } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const target = new QObject();
  target.defineProperty('v', 0);

  const anim = new NumberAnimation({ ticker, target, property: 'v', from: 0, to: 10, duration: 100, loops: 2 });
  anim.start();

  ticker.advance(100);
  assert.equal(anim.running, true); // still running – second loop
  ticker.advance(100);
  assert.equal(target.v, 10);
  assert.equal(anim.running, false);
});

test('Animation stop() halts progress and emits stopped', () => {
  const { AnimationTicker, NumberAnimation } = require('../src/runtime');
  const { QObject } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const target = new QObject();
  target.defineProperty('val', 0);

  const anim = new NumberAnimation({ ticker, target, property: 'val', from: 0, to: 100, duration: 200 });
  let stopped = false;
  anim.stopped.connect(() => { stopped = true; });

  anim.start();
  ticker.advance(100);
  const midValue = target.val;
  anim.stop();

  assert.equal(stopped, true);
  assert.equal(anim.running, false);

  ticker.advance(100);
  assert.equal(target.val, midValue); // no further change after stop
});

test('ColorAnimation interpolates hex colors', () => {
  const { AnimationTicker, ColorAnimation } = require('../src/runtime');
  const { QObject } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const target = new QObject();
  target.defineProperty('color', '#000000');

  const anim = new ColorAnimation({
    ticker,
    target,
    property: 'color',
    from: '#000000',
    to: '#ffffff',
    duration: 100,
  });

  anim.start();
  ticker.advance(50);
  // At 50% the color should be approximately grey
  assert.ok(typeof target.color === 'string' && target.color.startsWith('#'));

  ticker.advance(50);
  assert.equal(target.color, '#ffffff');
});

test('SequentialAnimation runs child animations in order', () => {
  const { AnimationTicker, NumberAnimation, SequentialAnimation } = require('../src/runtime');
  const { QObject } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const target = new QObject();
  target.defineProperty('x', 0);
  target.defineProperty('y', 0);

  const anim1 = new NumberAnimation({ ticker, target, property: 'x', from: 0, to: 50, duration: 100 });
  const anim2 = new NumberAnimation({ ticker, target, property: 'y', from: 0, to: 80, duration: 100 });
  const seq = new SequentialAnimation({ ticker, animations: [anim1, anim2] });

  seq.start();
  ticker.advance(100); // complete anim1
  assert.equal(target.x, 50);

  ticker.advance(100); // complete anim2
  assert.equal(target.y, 80);
  assert.equal(seq.running, false);
});

test('ParallelAnimation runs child animations concurrently', () => {
  const { AnimationTicker, NumberAnimation, ParallelAnimation } = require('../src/runtime');
  const { QObject } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const target = new QObject();
  target.defineProperty('x', 0);
  target.defineProperty('y', 0);

  const anim1 = new NumberAnimation({ ticker, target, property: 'x', from: 0, to: 100, duration: 200 });
  const anim2 = new NumberAnimation({ ticker, target, property: 'y', from: 0, to: 50, duration: 200 });
  const par = new ParallelAnimation({ ticker, animations: [anim1, anim2] });

  par.start();
  ticker.advance(100);
  assert.ok(target.x > 0 && target.x < 100, `x should be between 0 and 100, got ${target.x}`);
  assert.ok(target.y > 0 && target.y < 50, `y should be between 0 and 50, got ${target.y}`);

  ticker.advance(100);
  assert.equal(par.running, false);
});

// ---------------------------------------------------------------------------
// Stage A: States / PropertyChanges / Transitions
// ---------------------------------------------------------------------------

test('PropertyChanges.apply() sets target property values', () => {
  const { Item, PropertyChanges } = require('../src/runtime');

  const rect = new Item();
  rect.defineProperty('color', '#ffffff');

  const pc = new PropertyChanges({ target: rect, color: '#ff0000' });
  pc.apply();

  assert.equal(rect.color, '#ff0000');
});

test('Item state property switches applied PropertyChanges', () => {
  const { Item, PropertyChanges, State } = require('../src/runtime');

  const root = new Item();
  root.defineProperty('color', '#ffffff');

  const stateActive = new State({ name: 'active' });
  const pc = new PropertyChanges({ target: root, color: '#0000ff' });
  stateActive.addPropertyChanges(pc);
  root.addState(stateActive);

  assert.equal(root.color, '#ffffff');

  root.state = 'active';
  assert.equal(root.color, '#0000ff');

  root.state = '';
  assert.equal(root.color, '#ffffff'); // base value restored
});

test('Item state switching with multiple PropertyChanges targets', () => {
  const { Item, PropertyChanges, State, Rectangle } = require('../src/runtime');

  const root = new Item();
  const child = new Rectangle({ parentItem: root });
  // Rectangle extends Item which already has 'opacity' defined

  const pressed = new State({ name: 'pressed' });
  pressed.addPropertyChanges(new PropertyChanges({ target: child, opacity: 0.5 }));
  root.addState(pressed);

  assert.equal(child.opacity, 1);
  root.state = 'pressed';
  assert.equal(child.opacity, 0.5);

  root.state = '';
  assert.equal(child.opacity, 1);
});

test('Transition runs NumberAnimation when state changes', () => {
  const { Item, PropertyChanges, State, Transition, NumberAnimation, AnimationTicker } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const root = new Item();
  // Item already defines 'x', no need to defineProperty

  const stateRight = new State({ name: 'right' });
  stateRight.addPropertyChanges(new PropertyChanges({ target: root, x: 200 }));
  root.addState(stateRight);

  const anim = new NumberAnimation({ ticker, duration: 100, easing: 'Linear' });
  const transition = new Transition({ from: '*', to: 'right', animations: [anim] });
  root.addTransition(transition);

  root.state = 'right';

  // State should not be immediately applied (animation runs)
  assert.ok(root.x < 200, `x should be < 200, got ${root.x}`);
  assert.equal(root._activeStateAnimations.length, 1);

  ticker.advance(100);
  assert.equal(root.x, 200);
  assert.equal(root._activeStateAnimations[0].running, false);
});

// ---------------------------------------------------------------------------
// Stage A: Behavior
// ---------------------------------------------------------------------------

test('Behavior intercepts plain-value assignment and animates to target', () => {
  const { Item, Behavior, NumberAnimation, AnimationTicker } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const item = new Item();
  // Item already defines 'x'

  const anim = new NumberAnimation({ ticker, duration: 100, easing: 'Linear' });
  const behavior = new Behavior({ animation: anim });
  item.addBehavior('x', behavior);

  item.x = 100;

  // Value should not have jumped immediately
  assert.ok(item.x < 100, `x should be animating, got ${item.x}`);

  ticker.advance(50);
  assert.ok(item.x >= 50 && item.x < 100, `x should be ~50, got ${item.x}`);

  ticker.advance(50);
  assert.equal(item.x, 100);
});

test('Behavior does not intercept binding assignments', () => {
  const { Item, Behavior, NumberAnimation, AnimationTicker, Binding } = require('../src/runtime');

  const ticker = new AnimationTicker();
  const source = new Item();
  source.defineProperty('offset', 50);

  const item = new Item();
  // Item already defines 'x'

  const anim = new NumberAnimation({ ticker, duration: 200 });
  const behavior = new Behavior({ animation: anim });
  item.addBehavior('x', behavior);

  // Assign a binding — should bypass behavior
  item.x = new Binding(() => source.offset * 2);
  assert.equal(item.x, 100); // binding evaluated immediately

  source.offset = 75;
  assert.equal(item.x, 150); // binding re-evaluated
  assert.equal(anim.running, false);
});

// ---------------------------------------------------------------------------
// Stage B: ListModel
// ---------------------------------------------------------------------------

test('ListModel append adds rows and emits countChanged and rowsInserted', () => {
  const { ListModel } = require('../src/runtime');

  const model = new ListModel();
  const insertedEvents = [];
  const countEvents = [];

  model.rowsInserted.connect((index, count) => insertedEvents.push({ index, count }));
  model.countChanged.connect((n) => countEvents.push(n));

  model.append({ name: 'Alice', age: 30 });
  model.append({ name: 'Bob', age: 25 });

  assert.equal(model.count, 2);
  assert.deepEqual(insertedEvents, [{ index: 0, count: 1 }, { index: 1, count: 1 }]);
  assert.deepEqual(countEvents, [1, 2]);
  assert.deepEqual(model.get(0), { name: 'Alice', age: 30 });
  assert.deepEqual(model.get(1), { name: 'Bob', age: 25 });
});

test('ListModel insert places row at correct index', () => {
  const { ListModel } = require('../src/runtime');

  const model = new ListModel();
  model.append({ name: 'Alice' });
  model.append({ name: 'Charlie' });
  model.insert(1, { name: 'Bob' });

  assert.equal(model.count, 3);
  assert.deepEqual(model.get(0), { name: 'Alice' });
  assert.deepEqual(model.get(1), { name: 'Bob' });
  assert.deepEqual(model.get(2), { name: 'Charlie' });
});

test('ListModel remove deletes rows and emits rowsRemoved', () => {
  const { ListModel } = require('../src/runtime');

  const model = new ListModel({ rows: [{ n: 1 }, { n: 2 }, { n: 3 }] });
  const removedEvents = [];
  model.rowsRemoved.connect((index, count) => removedEvents.push({ index, count }));

  model.remove(1);

  assert.equal(model.count, 2);
  assert.deepEqual(model.get(0), { n: 1 });
  assert.deepEqual(model.get(1), { n: 3 });
  assert.deepEqual(removedEvents, [{ index: 1, count: 1 }]);
});

test('ListModel remove with count removes multiple rows', () => {
  const { ListModel } = require('../src/runtime');

  const model = new ListModel({ rows: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] });
  model.remove(1, 2);

  assert.equal(model.count, 2);
  assert.deepEqual(model.get(0), { n: 1 });
  assert.deepEqual(model.get(1), { n: 4 });
});

test('ListModel move reorders rows and emits rowsMoved', () => {
  const { ListModel } = require('../src/runtime');

  const model = new ListModel({ rows: [{ n: 1 }, { n: 2 }, { n: 3 }] });
  const movedEvents = [];
  model.rowsMoved.connect((from, to, count) => movedEvents.push({ from, to, count }));

  model.move(0, 2, 1);

  assert.equal(model.count, 3);
  assert.deepEqual(model.get(0), { n: 2 });
  assert.deepEqual(model.get(1), { n: 3 });
  assert.deepEqual(model.get(2), { n: 1 });
  assert.deepEqual(movedEvents, [{ from: 0, to: 2, count: 1 }]);
});

test('ListModel clear empties all rows', () => {
  const { ListModel } = require('../src/runtime');

  const model = new ListModel({ rows: [{ n: 1 }, { n: 2 }] });
  model.clear();

  assert.equal(model.count, 0);
  assert.equal(model.get(0), null);
});

test('ListModel set updates existing row and emits dataChanged', () => {
  const { ListModel } = require('../src/runtime');

  const model = new ListModel({ rows: [{ name: 'Alice', age: 30 }] });
  const changed = [];
  model.dataChanged.connect((index, roles) => changed.push({ index, roles }));

  model.set(0, { age: 31 });

  assert.deepEqual(model.get(0), { name: 'Alice', age: 31 });
  assert.deepEqual(changed, [{ index: 0, roles: ['age'] }]);
});

test('ListModel setProperty updates single role and emits dataChanged', () => {
  const { ListModel } = require('../src/runtime');

  const model = new ListModel({ rows: [{ x: 1, y: 2 }] });
  const changed = [];
  model.dataChanged.connect((index, roles) => changed.push({ index, roles }));

  model.setProperty(0, 'x', 99);

  assert.equal(model.get(0).x, 99);
  assert.equal(model.get(0).y, 2);
  assert.deepEqual(changed, [{ index: 0, roles: ['x'] }]);
});

test('ListModel get returns a copy (not a reference)', () => {
  const { ListModel } = require('../src/runtime');

  const model = new ListModel({ rows: [{ name: 'Alice' }] });
  const row = model.get(0);
  row.name = 'Modified';

  assert.equal(model.get(0).name, 'Alice');
});

// ---------------------------------------------------------------------------
// Stage B: Repeater
// ---------------------------------------------------------------------------

test('Repeater creates delegate items for each model row', () => {
  const { ListModel, Repeater, Component, Item, Context, ComponentScope } = require('../src/runtime');

  const model = new ListModel({ rows: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] });

  const parent = new Item();
  parent.width = 200;
  parent.height = 400;

  const scope = new ComponentScope();
  const ctx = new Context(null, {});

  const delegate = new Component(({ parent: p, context }) => {
    const item = new Item({ parentItem: p });
    item.defineProperty('label', context ? context.lookup('label') : '');
    return item;
  });

  const repeater = new Repeater({
    parentItem: parent,
    model,
    delegate,
    context: ctx,
    componentScope: scope,
  });

  assert.equal(repeater.count, 3);
  assert.ok(repeater.itemAt(0) !== null);
  assert.ok(repeater.itemAt(1) !== null);
  assert.ok(repeater.itemAt(2) !== null);
});

test('Repeater updates when model rows are inserted', () => {
  const { ListModel, Repeater, Component, Item, Context, ComponentScope } = require('../src/runtime');

  const model = new ListModel({ rows: [{ n: 1 }, { n: 2 }] });
  const parent = new Item();
  const ctx = new Context(null, {});
  const scope = new ComponentScope();

  const delegate = new Component(({ parent: p }) => new Item({ parentItem: p }));
  const repeater = new Repeater({ parentItem: parent, model, delegate, context: ctx, componentScope: scope });

  assert.equal(repeater.count, 2);

  model.append({ n: 3 });
  assert.equal(repeater.count, 3);

  model.insert(0, { n: 0 });
  assert.equal(repeater.count, 4);
});

test('Repeater updates when model rows are removed', () => {
  const { ListModel, Repeater, Component, Item, Context, ComponentScope } = require('../src/runtime');

  const model = new ListModel({ rows: [{ n: 1 }, { n: 2 }, { n: 3 }] });
  const parent = new Item();
  const ctx = new Context(null, {});
  const scope = new ComponentScope();

  const delegate = new Component(({ parent: p }) => new Item({ parentItem: p }));
  const repeater = new Repeater({ parentItem: parent, model, delegate, context: ctx, componentScope: scope });

  assert.equal(repeater.count, 3);

  model.remove(1);
  assert.equal(repeater.count, 2);
});

test('Repeater exposes index and modelData in delegate context', () => {
  const { ListModel, Repeater, Component, Item, Context, ComponentScope } = require('../src/runtime');

  const model = new ListModel({ rows: [{ name: 'Alice' }, { name: 'Bob' }] });
  const parent = new Item();
  const ctx = new Context(null, {});
  const scope = new ComponentScope();
  const captured = [];

  const delegate = new Component(({ parent: p, context }) => {
    captured.push({
      index: context.lookup('index'),
      modelData: context.lookup('modelData'),
      name: context.lookup('name'),
    });
    return new Item({ parentItem: p });
  });

  const repeater = new Repeater({ parentItem: parent, model, delegate, context: ctx, componentScope: scope });

  assert.equal(captured.length, 2);
  assert.equal(captured[0].index, 0);
  assert.deepEqual(captured[0].modelData, { name: 'Alice' });
  assert.equal(captured[0].name, 'Alice');
  assert.equal(captured[1].index, 1);
  assert.equal(captured[1].name, 'Bob');
});

// ---------------------------------------------------------------------------
// Stage B: ListView
// ---------------------------------------------------------------------------

test('ListView creates delegates for visible range', () => {
  const { ListModel, ListView, Component, Item, Context, ComponentScope } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 20; i++) model.append({ n: i });

  const listView = new ListView();
  listView.width = 200;
  listView.height = 200;  // shows 5 rows of 40px each
  listView._delegateHeight = 40;

  const ctx = new Context(null, {});
  listView.setContext(ctx);

  const delegate = new Component(({ parent: p, context }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  listView.model = model;
  listView.delegate = delegate;

  // With height=200, rowHeight=40, cacheBuffer=40:
  // firstVisible = max(0, floor((0-40)/40)) = 0
  // lastVisible = min(19, ceil((0+200+40)/40)) = min(19, ceil(6)) = 6
  // → creates items at indices 0..6 = 7 items total
  const created = listView.createdCount;
  assert.equal(created, 7, `Expected exactly 7 items created, got ${created}`);
});

test('ListView virtualization: scrolling changes which items are created', () => {
  const { ListModel, ListView, Component, Item, Context, ComponentScope } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 50; i++) model.append({ n: i });

  const listView = new ListView();
  listView.width = 200;
  listView.height = 200;
  listView._delegateHeight = 40;
  listView.cacheBuffer = 0;

  listView.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  listView.model = model;
  listView.delegate = delegate;

  const createdAtTop = listView.createdCount;
  assert.ok(listView.itemAt(0) !== null, 'item 0 should exist at top');
  assert.equal(listView.itemAt(40), null, 'item 40 should not exist at top');

  // Scroll to row 20 (offset 800)
  listView.contentY = 800;

  assert.equal(listView.itemAt(0), null, 'item 0 should be destroyed after scroll');
  assert.ok(listView.itemAt(20) !== null, 'item 20 should exist after scroll');
});

test('ListView contentHeight equals count * delegateHeight', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 10; i++) model.append({ n: i });

  const listView = new ListView();
  listView.width = 200;
  listView.height = 200;
  listView._delegateHeight = 50;
  listView.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 50;
    return item;
  });

  listView.model = model;
  listView.delegate = delegate;

  assert.equal(listView.contentHeight, 500); // 10 * 50
});

test('ListView rebuilds when model changes', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel({ rows: [{ n: 1 }, { n: 2 }] });
  const listView = new ListView();
  listView.width = 200;
  listView.height = 200;
  listView._delegateHeight = 40;
  listView.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  listView.model = model;
  listView.delegate = delegate;

  const before = listView.createdCount;

  model.append({ n: 3 });
  model.append({ n: 4 });

  // After appending, rebuild should have been triggered
  assert.ok(listView.contentHeight >= 40 * 4, 'contentHeight should cover 4 rows');
});
