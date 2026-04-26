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
  Text,
  Image,
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

// ---------------------------------------------------------------------------
// Stage C: Focus system
// ---------------------------------------------------------------------------

test('Item has focus, activeFocus, focusable, activeFocusOnTab, focusScope properties', () => {
  const { Item } = require('../src/runtime');

  const item = new Item();
  assert.equal(item.focus, false);
  assert.equal(item.activeFocus, false);
  assert.equal(item.focusable, false);
  assert.equal(item.activeFocusOnTab, false);
  assert.equal(item.focusScope, false);
});

test('Scene.forceActiveFocus sets activeFocus on item', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200;
  root.height = 200;

  const child = new Item({ parentItem: root });
  child.width = 100;
  child.height = 100;
  child.focusable = true;

  const scene = new Scene({ rootItem: root });

  assert.equal(scene.activeFocusItem, null);
  scene.forceActiveFocus(child);

  assert.equal(scene.activeFocusItem, child);
  assert.equal(child.activeFocus, true);
  assert.equal(child.focus, true);
});

test('Scene.forceActiveFocus clears previous item activeFocus', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200;
  root.height = 200;

  const a = new Item({ parentItem: root });
  a.width = 50; a.height = 50; a.focusable = true;

  const b = new Item({ parentItem: root });
  b.x = 60; b.width = 50; b.height = 50; b.focusable = true;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(a);
  assert.equal(a.activeFocus, true);

  scene.forceActiveFocus(b);
  assert.equal(a.activeFocus, false);
  assert.equal(b.activeFocus, true);
  assert.equal(scene.activeFocusItem, b);
});

test('Scene.clearFocus removes activeFocus', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 100;
  root.height = 100;

  const child = new Item({ parentItem: root });
  child.width = 50; child.height = 50; child.focusable = true;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(child);
  assert.equal(child.activeFocus, true);

  scene.clearFocus();
  assert.equal(child.activeFocus, false);
  assert.equal(scene.activeFocusItem, null);
});

test('Scene.focusNext cycles through focusable items in depth-first order', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 300; root.height = 100;

  const a = new Item({ parentItem: root });
  a.width = 50; a.height = 50; a.activeFocusOnTab = true;

  const b = new Item({ parentItem: root });
  b.x = 60; b.width = 50; b.height = 50; b.activeFocusOnTab = true;

  const c = new Item({ parentItem: root });
  c.x = 120; c.width = 50; c.height = 50; c.activeFocusOnTab = true;

  const scene = new Scene({ rootItem: root });

  scene.focusNext();
  assert.equal(scene.activeFocusItem, a);

  scene.focusNext();
  assert.equal(scene.activeFocusItem, b);

  scene.focusNext();
  assert.equal(scene.activeFocusItem, c);

  // wraps around
  scene.focusNext();
  assert.equal(scene.activeFocusItem, a);
});

test('Scene.focusPrevious cycles backward', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 300; root.height = 100;

  const a = new Item({ parentItem: root });
  a.width = 50; a.height = 50; a.activeFocusOnTab = true;

  const b = new Item({ parentItem: root });
  b.x = 60; b.width = 50; b.height = 50; b.activeFocusOnTab = true;

  const scene = new Scene({ rootItem: root });

  scene.forceActiveFocus(b);
  scene.focusPrevious();
  assert.equal(scene.activeFocusItem, a);
});

test('_collectFocusableItems skips invisible and disabled items', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 300; root.height = 100;

  const visible = new Item({ parentItem: root });
  visible.width = 50; visible.height = 50; visible.activeFocusOnTab = true;

  const hidden = new Item({ parentItem: root });
  hidden.width = 50; hidden.height = 50; hidden.activeFocusOnTab = true;
  hidden.visible = false;

  const disabled = new Item({ parentItem: root });
  disabled.width = 50; disabled.height = 50; disabled.activeFocusOnTab = true;
  disabled.enabled = false;

  const scene = new Scene({ rootItem: root });
  const items = scene._collectFocusableItems();
  assert.equal(items.length, 1);
  assert.equal(items[0], visible);
});

// ---------------------------------------------------------------------------
// Stage C: Keys attached property
// ---------------------------------------------------------------------------

test('Item.keys lazily creates a Keys instance', () => {
  const { Item, Keys } = require('../src/runtime');

  const item = new Item();
  assert.equal(item._keys, null);
  const keys = item.keys;
  assert.ok(keys instanceof Keys);
  assert.equal(item.keys, keys); // same instance on repeated access
});

test('Scene.dispatchKey calls Keys.onPressed handler on activeFocusItem', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const child = new Item({ parentItem: root });
  child.width = 100; child.height = 100; child.focusable = true;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(child);

  const events = [];
  child.keys.onPressed = (event) => { events.push(event.key); };

  const fakeKeyEvent = { key: 'a', code: 'KeyA', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  scene.dispatchKey('pressed', fakeKeyEvent);

  assert.deepEqual(events, ['a']);
});

test('Scene.dispatchKey calls Keys.onReleased handler', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const child = new Item({ parentItem: root });
  child.width = 100; child.height = 100; child.focusable = true;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(child);

  const events = [];
  child.keys.onReleased = (event) => { events.push(event.key); };

  const fakeKeyEvent = { key: 'b', code: 'KeyB', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  scene.dispatchKey('released', fakeKeyEvent);

  assert.deepEqual(events, ['b']);
});

test('Scene.dispatchKey bubbles up to parentItem when not accepted', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const parent = new Item({ parentItem: root });
  parent.width = 150; parent.height = 150;

  const child = new Item({ parentItem: parent });
  child.width = 50; child.height = 50; child.focusable = true;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(child);

  const parentEvents = [];
  const childEvents = [];
  child.keys.onPressed = (event) => { childEvents.push(event.key); /* not accepted */ };
  parent.keys.onPressed = (event) => { parentEvents.push(event.key); };

  const fakeEvent = { key: 'x', code: 'KeyX', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  scene.dispatchKey('pressed', fakeEvent);

  assert.deepEqual(childEvents, ['x']);
  assert.deepEqual(parentEvents, ['x']);
});

test('Scene.dispatchKey stops bubbling when event is accepted', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const parent = new Item({ parentItem: root });
  parent.width = 150; parent.height = 150;

  const child = new Item({ parentItem: parent });
  child.width = 50; child.height = 50; child.focusable = true;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(child);

  const parentEvents = [];
  child.keys.onPressed = (event) => { event.accepted = true; };
  parent.keys.onPressed = (event) => { parentEvents.push(event.key); };

  const fakeEvent = { key: 'y', code: 'KeyY', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  scene.dispatchKey('pressed', fakeEvent);

  assert.deepEqual(parentEvents, []);
});

test('Keys.enabled = false prevents handler from being called', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const child = new Item({ parentItem: root });
  child.width = 100; child.height = 100; child.focusable = true;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(child);

  const events = [];
  child.keys.onPressed = (event) => { events.push(event.key); };
  child.keys.enabled = false;

  const fakeEvent = { key: 'z', code: 'KeyZ', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  scene.dispatchKey('pressed', fakeEvent);

  assert.deepEqual(events, []);
});

test('Scene.dispatchKey returns null when no activeFocusItem', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const scene = new Scene({ rootItem: root });
  const result = scene.dispatchKey('pressed', { key: 'a', code: 'KeyA', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Stage C: TapHandler
// ---------------------------------------------------------------------------

test('TapHandler emits tapped when pressed and released inside bounds', () => {
  const { Item, TapHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const handler = new TapHandler({ parentItem: root });
  handler.width = 100; handler.height = 100;

  let tappedCount = 0;
  handler.tapped.connect(() => { tappedCount += 1; });

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 50, 50);
  scene.dispatchPointer('up', 50, 50);

  assert.equal(tappedCount, 1);
});

test('TapHandler does not emit tapped when released outside bounds', () => {
  const { Item, TapHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const handler = new TapHandler({ parentItem: root });
  handler.width = 100; handler.height = 100;

  let tappedCount = 0;
  handler.tapped.connect(() => { tappedCount += 1; });

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 50, 50);
  scene.dispatchPointer('up', 150, 150); // outside

  assert.equal(tappedCount, 0);
});

// ---------------------------------------------------------------------------
// Stage C: DragHandler
// ---------------------------------------------------------------------------

test('DragHandler tracks active state and translation', () => {
  const { Item, DragHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 300; root.height = 300;

  const draggable = new Item({ parentItem: root });
  draggable.x = 50; draggable.y = 50;
  draggable.width = 100; draggable.height = 100;

  const handler = new DragHandler({ parentItem: draggable });
  handler.width = 100; handler.height = 100;

  const activeChanges = [];
  handler.activeChanged.connect((next) => { activeChanges.push(next); });

  const scene = new Scene({ rootItem: root });

  // press inside draggable
  scene.dispatchPointer('down', 100, 100);
  assert.equal(handler.active, true);

  // move
  scene.dispatchPointer('move', 120, 130);
  assert.equal(handler.translation.x, 20);
  assert.equal(handler.translation.y, 30);

  // release
  scene.dispatchPointer('up', 120, 130);
  assert.equal(handler.active, false);

  assert.deepEqual(activeChanges, [true, false]);
});

test('DragHandler moves parentItem when no explicit dragTarget', () => {
  const { Item, DragHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 300; root.height = 300;

  const box = new Item({ parentItem: root });
  box.x = 0; box.y = 0;
  box.width = 100; box.height = 100;

  const handler = new DragHandler({ parentItem: box });
  handler.width = 100; handler.height = 100;

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 50, 50);
  scene.dispatchPointer('move', 80, 90);

  assert.equal(box.x, 30);
  assert.equal(box.y, 40);
});

test('DragHandler grab continues after pointer leaves original position', () => {
  const { Item, DragHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const box = new Item({ parentItem: root });
  box.x = 0; box.y = 0;
  box.width = 100; box.height = 100;

  const handler = new DragHandler({ parentItem: box });
  handler.width = 100; handler.height = 100;

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 50, 50);

  // Move far outside original bounds — grab should keep handler active
  scene.dispatchPointer('move', 250, 250);
  assert.equal(handler.active, true);
  assert.equal(handler.translation.x, 200);
  assert.equal(handler.translation.y, 200);
});

// ---------------------------------------------------------------------------
// Stage D: Controls MVP
// ---------------------------------------------------------------------------

const { Button, Label, TextField, Slider, CheckBox, Theme } = require('../src/runtime');

test('Button emits clicked on pointer up inside bounds', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const btn = new Button({ parentItem: root });
  btn.x = 10; btn.y = 10;
  btn.width = 100; btn.height = 36;
  btn.text = 'OK';

  let clickCount = 0;
  btn.clicked.connect(() => { clickCount += 1; });

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 50, 28);
  scene.dispatchPointer('up', 50, 28);

  assert.equal(clickCount, 1);
});

test('Button does not emit clicked when released outside bounds', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const btn = new Button({ parentItem: root });
  btn.x = 10; btn.y = 10;
  btn.width = 100; btn.height = 36;

  let clickCount = 0;
  btn.clicked.connect(() => { clickCount += 1; });

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 50, 28);
  scene.dispatchPointer('up', 200, 200); // released outside

  assert.equal(clickCount, 0);
});

test('Button emits clicked via Enter key when focused', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const btn = new Button({ parentItem: root });
  btn.x = 10; btn.y = 10;
  btn.width = 100; btn.height = 36;

  let clickCount = 0;
  btn.clicked.connect(() => { clickCount += 1; });

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(btn);

  scene.dispatchKey('pressed', { key: 'Enter' });
  assert.equal(clickCount, 1);

  scene.dispatchKey('pressed', { key: ' ' });
  assert.equal(clickCount, 2);
});

test('Button keyboard activation is disabled when enabled=false', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const btn = new Button({ parentItem: root });
  btn.x = 0; btn.y = 0;
  btn.width = 100; btn.height = 36;
  btn.enabled = false;

  let clickCount = 0;
  btn.clicked.connect(() => { clickCount += 1; });

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(btn);
  scene.dispatchKey('pressed', { key: 'Enter' });

  assert.equal(clickCount, 0);
});

test('Button auto-acquires focus on pointer down', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const btn = new Button({ parentItem: root });
  btn.x = 0; btn.y = 0;
  btn.width = 100; btn.height = 36;

  const scene = new Scene({ rootItem: root });
  assert.equal(scene.activeFocusItem, null);

  scene.dispatchPointer('down', 50, 18);
  assert.equal(scene.activeFocusItem, btn);
});

test('Button pressed state tracks pointer down/up', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const btn = new Button({ parentItem: root });
  btn.x = 0; btn.y = 0;
  btn.width = 100; btn.height = 36;

  const scene = new Scene({ rootItem: root });

  assert.equal(btn.pressed, false);
  scene.dispatchPointer('down', 50, 18);
  assert.equal(btn.pressed, true);
  scene.dispatchPointer('up', 50, 18);
  assert.equal(btn.pressed, false);
});

test('CheckBox toggles checked on pointer click', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const cb = new CheckBox({ parentItem: root });
  cb.x = 0; cb.y = 0;
  cb.width = 100; cb.height = 24;
  cb.text = 'Option';

  assert.equal(cb.checked, false);

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 50, 12);
  scene.dispatchPointer('up', 50, 12);

  assert.equal(cb.checked, true);

  scene.dispatchPointer('down', 50, 12);
  scene.dispatchPointer('up', 50, 12);

  assert.equal(cb.checked, false);
});

test('CheckBox emits clicked signal on toggle', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const cb = new CheckBox({ parentItem: root });
  cb.x = 0; cb.y = 0;
  cb.width = 100; cb.height = 24;

  let clicks = 0;
  cb.clicked.connect(() => { clicks += 1; });

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 50, 12);
  scene.dispatchPointer('up', 50, 12);

  assert.equal(clicks, 1);
});

test('CheckBox toggles via Space/Enter keyboard when focused', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const cb = new CheckBox({ parentItem: root });
  cb.x = 0; cb.y = 0;
  cb.width = 100; cb.height = 24;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(cb);

  assert.equal(cb.checked, false);
  scene.dispatchKey('pressed', { key: ' ' });
  assert.equal(cb.checked, true);
  scene.dispatchKey('pressed', { key: 'Enter' });
  assert.equal(cb.checked, false);
});

test('Slider clamps value to [from, to] range via public property', () => {
  const slider = new Slider();
  slider.from = 0;
  slider.to = 100;

  slider.value = -10;
  assert.equal(slider.value, 0);

  slider.value = 150;
  assert.equal(slider.value, 100);

  slider.value = 50;
  assert.equal(slider.value, 50);
});

test('Slider stepSize snaps value via public property', () => {
  const slider = new Slider();
  slider.from = 0;
  slider.to = 10;
  slider.stepSize = 2;

  slider.value = 3;    // rounds to nearest even step → 4
  assert.equal(slider.value, 4);

  slider.value = 5;    // rounds to nearest even step → 6
  assert.equal(slider.value, 6);

  slider.value = 1.1;  // rounds to nearest step → 2
  assert.equal(slider.value, 2);
});

test('Slider drag math: value computed from pointer position', () => {
  const root = new Item();
  root.width = 300;
  root.height = 100;

  const slider = new Slider({ parentItem: root });
  slider.x = 0; slider.y = 0;
  slider.width = 200;
  slider.height = 24;
  slider.from = 0;
  slider.to = 1;
  slider.stepSize = 0;

  const scene = new Scene({ rootItem: root });
  // Track goes from x=12 to x=188; click exactly in the middle => x=100 => pos=(100-12)/(188-12)=0.5
  scene.dispatchPointer('down', 100, 12);
  // Value should be approximately 0.5 (midpoint)
  assert.ok(Math.abs(slider.value - 0.5) < 0.01,
    `Expected value ≈ 0.5, got ${slider.value}`);
});

test('Slider adjusts value via arrow keys when focused', () => {
  const root = new Item();
  root.width = 300;
  root.height = 100;

  const slider = new Slider({ parentItem: root });
  slider.x = 0; slider.y = 0;
  slider.width = 200; slider.height = 24;
  slider.from = 0; slider.to = 10;
  slider.stepSize = 1;
  slider.value = 5;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(slider);

  scene.dispatchKey('pressed', { key: 'ArrowRight' });
  assert.equal(slider.value, 6);

  scene.dispatchKey('pressed', { key: 'ArrowLeft' });
  assert.equal(slider.value, 5);
});

test('TextField accepts text input when focused', () => {
  const root = new Item();
  root.width = 300;
  root.height = 100;

  const tf = new TextField({ parentItem: root });
  tf.x = 0; tf.y = 0;
  tf.width = 200; tf.height = 32;
  tf.placeholderText = 'Type here';

  const textChanges = [];
  tf.textChanged.connect((val) => { textChanges.push(val); });

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(tf);

  scene.dispatchKey('pressed', { key: 'H' });
  scene.dispatchKey('pressed', { key: 'i' });

  assert.equal(tf.text, 'Hi');
  assert.deepEqual(textChanges, ['H', 'Hi']);
});

test('TextField Backspace removes last character', () => {
  const root = new Item();
  root.width = 300;
  root.height = 100;

  const tf = new TextField({ parentItem: root, text: 'abc' });
  tf.x = 0; tf.y = 0;
  tf.width = 200; tf.height = 32;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(tf);

  scene.dispatchKey('pressed', { key: 'Backspace' });
  assert.equal(tf.text, 'ab');
});

test('TextField requires focus for text input', () => {
  const root = new Item();
  root.width = 300;
  root.height = 100;

  const tf = new TextField({ parentItem: root });
  tf.x = 0; tf.y = 0;
  tf.width = 200; tf.height = 32;
  // No focus given

  const scene = new Scene({ rootItem: root });
  scene.dispatchKey('pressed', { key: 'A' });

  assert.equal(tf.text, ''); // no input without focus
});

test('Theme object exposes palette and font', () => {
  assert.ok(typeof Theme.palette === 'object');
  assert.ok(typeof Theme.palette.primary === 'string');
  assert.ok(typeof Theme.font === 'object');
  assert.ok(typeof Theme.font.pixelSize === 'number');
});

test('Label is an Item with text/color/font properties', () => {
  const label = new Label({ text: 'Hello', color: '#ff0000' });
  assert.equal(label.text, 'Hello');
  assert.equal(label.color, '#ff0000');
  assert.ok(typeof label.font === 'object');
});

// ---------------------------------------------------------------------------
// Stage E: Rendering improvements – transforms, clip, Image, text cache
// ---------------------------------------------------------------------------

test('Item has clip, scale, rotation, transformOrigin, layer properties', () => {
  const item = new Item();
  assert.equal(item.clip, false);
  assert.equal(item.scale, 1);
  assert.equal(item.rotation, 0);
  assert.equal(item.transformOrigin, 'Center');
  assert.ok(typeof item.layer === 'object');
  assert.equal(item.layer.enabled, false);

  item.clip = true;
  item.scale = 2;
  item.rotation = 45;
  item.transformOrigin = 'TopLeft';
  item.layer.enabled = true;

  assert.equal(item.clip, true);
  assert.equal(item.scale, 2);
  assert.equal(item.rotation, 45);
  assert.equal(item.transformOrigin, 'TopLeft');
  assert.equal(item.layer.enabled, true);
});

test('_mapToScene accounts for scale transform', () => {
  const parent = new Item();
  parent.x = 100;
  parent.y = 100;
  parent.width = 200;
  parent.height = 200;
  parent.scale = 2; // scale=2 around center (100,100)

  const child = new Item({ parentItem: parent });
  child.x = 10;
  child.y = 10;

  // Parent matrix (px=100, py=100, ox=100, oy=100, s=2, rot=0):
  //   e = 100 + 100 + 2*(-100) + 0 = 0
  //   f = 100 + 100 + 0 + 2*(-100) = 0
  //   → T_parent(lx, ly) = (2*lx, 2*ly)
  //
  // child._mapToScene(0,0):
  //   child matrix is pure translation {e:10, f:10}
  //   → parent local (10, 10)
  //   apply parent matrix → scene (20, 20)
  const pt = child._mapToScene(0, 0);
  assert.ok(Math.abs(pt.x - 20) < 0.001, `Expected x≈20, got ${pt.x}`);
  assert.ok(Math.abs(pt.y - 20) < 0.001, `Expected y≈20, got ${pt.y}`);
});

test('mapToItem / mapFromItem with no transforms (regression)', () => {
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

  const pt = grand.mapToItem(root, 0, 0);
  assert.ok(Math.abs(pt.x - 25) < 0.001, `Expected x=25, got ${pt.x}`);
  assert.ok(Math.abs(pt.y - 15) < 0.001, `Expected y=15, got ${pt.y}`);

  const pt2 = root.mapFromItem(grand, 0, 0);
  assert.ok(Math.abs(pt2.x - 25) < 0.001);
  assert.ok(Math.abs(pt2.y - 15) < 0.001);
});

test('mapToItem respects rotation transform', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  // A child rotated 90° around its top-left corner at (50, 50)
  const child = new Item({ parentItem: root });
  child.x = 50;
  child.y = 50;
  child.width = 100;
  child.height = 100;
  child.rotation = 90;
  child.transformOrigin = 'TopLeft'; // origin = (0,0)

  // child local (100, 0) → 90° rotation around (0,0) →  local rotated = (0, 100)
  // in parent space: (50 + 0, 50 + 100) = (50, 150)
  const pt = child.mapToItem(root, 100, 0);
  assert.ok(Math.abs(pt.x - 50) < 0.5, `Expected x≈50, got ${pt.x}`);
  assert.ok(Math.abs(pt.y - 150) < 0.5, `Expected y≈150, got ${pt.y}`);
});

test('containsPoint with 90° rotation', () => {
  const root = new Item();
  root.width = 200;
  root.height = 200;

  const child = new Item({ parentItem: root });
  child.x = 50;
  child.y = 50;
  child.width = 100;
  child.height = 10;
  child.rotation = 90;
  child.transformOrigin = 'TopLeft';

  // After 90° rotation around (0,0): the child occupies
  // scene rect x=[50-10,50], y=[50,150] roughly
  // Scene point (45, 80) should be inside the rotated child
  assert.equal(child.containsPoint(45, 80), true, 'Scene point inside rotated child');
  // Scene point (60, 80) should be outside (width is only 10 → 0–10 in local x becomes 0–(-10) in scene x after 90°)
  assert.equal(child.containsPoint(60, 80), false, 'Scene point outside rotated child');
});

test('hitTest respects clip flag', () => {
  const root = new Item();
  root.width = 100;
  root.height = 100;
  root.clip = true; // clip children to 100×100

  const child = new Rectangle({ parentItem: root });
  child.x = 0;
  child.y = 0;
  child.width = 200; // extends beyond root bounds
  child.height = 50;

  // Point inside both root and child
  assert.equal(root.hitTest(50, 25), child);

  // Point inside child but outside root (clip should exclude)
  assert.equal(root.hitTest(120, 25), null);
});

test('hitTest with no clip allows children outside parent bounds', () => {
  const root = new Item();
  root.width = 100;
  root.height = 100;
  root.clip = false;

  const child = new Rectangle({ parentItem: root });
  child.x = 0;
  child.y = 0;
  child.width = 200;
  child.height = 50;

  // Without clip, child extends and can receive hits outside root bounds
  assert.equal(root.hitTest(150, 25), child);
});

test('CanvasRenderer applies translation, rotation, scale and clip', () => {
  const ops = [];
  const fakeCtx = {
    globalAlpha: 1,
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    translate: (x, y) => ops.push(`translate(${x},${y})`),
    rotate: (r) => ops.push(`rotate(${r.toFixed(4)})`),
    scale: (sx, sy) => ops.push(`scale(${sx},${sy})`),
    beginPath: () => ops.push('beginPath'),
    rect: (x, y, w, h) => ops.push(`rect(${x},${y},${w},${h})`),
    clip: () => ops.push('clip'),
    clearRect: () => {},
  };

  const root = new Item();
  root.width = 200;
  root.height = 200;

  const box = new Item({ parentItem: root });
  box.x = 10;
  box.y = 20;
  box.width = 50;
  box.height = 50;
  box.rotation = 45;
  box.scale = 2;
  box.clip = true;
  box.transformOrigin = 'TopLeft'; // origin = (0,0)

  const renderer = new CanvasRenderer({
    rootItem: root,
    context2d: fakeCtx,
    canvas: { width: 200, height: 200 },
    autoSchedule: false,
  });

  renderer.render();

  // rotation 45° = PI/4 ≈ 0.7854 radians
  assert.ok(ops.includes(`rotate(${(Math.PI / 4).toFixed(4)})`), `Should include rotate: ${ops}`);
  assert.ok(ops.includes('scale(2,2)'), `Should include scale: ${ops}`);
  // translate to origin (0,0) → translate(0,0), no-op for TopLeft
  assert.ok(ops.includes('clip'), `Should include clip: ${ops}`);
  assert.ok(ops.includes('rect(0,0,50,50)'), `Should include clip rect: ${ops}`);
});

test('Image class has correct status constants', () => {
  assert.equal(Image.Null,    0);
  assert.equal(Image.Loading, 1);
  assert.equal(Image.Ready,   2);
  assert.equal(Image.Error,   3);
});

test('Image item starts with Null status when no source', () => {
  const img = new Image();
  assert.equal(img.status, Image.Null);
  assert.equal(img.source, '');
});

test('Image item transitions to Loading when source is set', () => {
  const img = new Image();
  img.source = 'https://example.com/test.png';
  // In Node.js there is no HTMLImageElement, so it stays Loading
  assert.equal(img.status, Image.Loading);
});

test('Image cache is shared across instances for same source', () => {
  const source = 'http://example.com/shared-cache-test.png';
  const img1 = new Image({ source });
  // In Node.js there is no HTMLImageElement, so status stays Loading
  assert.equal(img1.status, Image.Loading);

  // Second instance with same source should pick up the same cache entry
  const img2 = new Image({ source });
  assert.equal(img1.status, img2.status, 'Both instances should share the same status');
});

test('Image item goes back to Null when source is cleared', () => {
  const img = new Image({ source: 'http://example.com/img.png' });
  assert.equal(img.status, Image.Loading);
  img.source = '';
  assert.equal(img.status, Image.Null);
});

test('Text._fontString builds correct CSS font string', () => {
  const t1 = new Text({ font: { family: 'Arial', pixelSize: 16, bold: false } });
  assert.equal(t1._fontString(), '16px Arial');

  const t2 = new Text({ font: { family: 'Helvetica', pixelSize: 12, bold: true } });
  assert.equal(t2._fontString(), 'bold 12px Helvetica');
});

test('Text.draw uses measurement cache for elide', () => {
  let callCount = 0;
  const drawnTexts = [];

  const fakeCtx = {
    font: '',
    fillStyle: '',
    textBaseline: '',
    measureText: (str) => {
      callCount += 1;
      // Return large width to trigger elide (20px per character)
      return { width: str.length * 20 };
    },
    fillText: (str) => { drawnTexts.push(str); },
  };

  // Use a font string unlikely to be in the cache from other tests
  const t = new Text({
    text: 'ElideTestString__unique__' + Date.now(),
    font: { family: 'monospace', pixelSize: 99, bold: true },
    elide: 'ElideRight',
  });
  // width must be set after construction (Item doesn't pick it up from options)
  t.width = 60; // small → will elide

  // First draw: should call measureText (cache miss)
  t.draw(fakeCtx);
  const firstCallCount = callCount;
  assert.ok(firstCallCount > 0, 'Should have called measureText on first draw');
  assert.ok(drawnTexts.length > 0, 'Should have drawn some text');
  assert.ok(drawnTexts[0].endsWith('…'), 'Should have elided the text with ellipsis');

  // Second draw: same text+font combination → cache hits reduce new measureText calls
  const callsBefore = callCount;
  t.draw(fakeCtx);
  const newCalls = callCount - callsBefore;
  // The ellipsis character ('…') itself is a new cache key, but the base text is cached.
  // Net new calls must be fewer than on the first draw (which measured many substrings).
  assert.ok(newCalls < firstCallCount, `Second draw (${newCalls} new calls) should use cache more than first (${firstCallCount} calls)`);
});
