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
  TextInput,
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
// Flickable tests
// ---------------------------------------------------------------------------

test('Flickable has required Qt-like properties', () => {
  const { Flickable } = require('../src/runtime');

  const f = new Flickable();

  // Scroll content
  assert.equal(f.contentX, 0);
  assert.equal(f.contentY, 0);
  assert.equal(f.contentWidth, 0);
  assert.equal(f.contentHeight, 0);

  // Behavior
  assert.equal(f.interactive, true);
  assert.equal(f.flickableDirection, 'VerticalFlick');
  assert.equal(f.boundsBehavior, 'OvershootBounds');
  assert.equal(f.pressDelay, 0);

  // Read-only state
  assert.equal(f.moving, false);
  assert.equal(f.dragging, false);
  assert.equal(f.flicking, false);

  // Flick parameters
  assert.equal(f.maximumFlickVelocity, 2500);
  assert.equal(f.flickDeceleration, 1500);

  // Margins
  assert.equal(f.topMargin, 0);
  assert.equal(f.bottomMargin, 0);
  assert.equal(f.leftMargin, 0);
  assert.equal(f.rightMargin, 0);
});

test('Flickable drag updates contentY', () => {
  const { Flickable } = require('../src/runtime');

  const f = new Flickable();
  f.width = 200;
  f.height = 200;
  f.contentWidth = 200;
  f.contentHeight = 600;

  // Simulate pointer down at (100, 100)
  f.handlePointerEvent('down', { sceneX: 100, sceneY: 100, x: 100, y: 100, originalEvent: null });
  assert.equal(f.dragging, true);
  assert.equal(f.moving, true);

  // Simulate drag up (sceneY decreases → contentY increases)
  f.handlePointerEvent('move', { sceneX: 100, sceneY: 60, x: 100, y: 60, originalEvent: null });
  assert.ok(f.contentY > 0, `contentY should increase when dragging up, got ${f.contentY}`);

  // Release
  f.handlePointerEvent('up', { sceneX: 100, sceneY: 60, x: 100, y: 60, originalEvent: null });
  assert.equal(f.dragging, false);
});

test('Flickable StopAtBounds clamps contentY', () => {
  const { Flickable } = require('../src/runtime');

  const f = new Flickable({ boundsBehavior: 'StopAtBounds' });
  f.width = 200;
  f.height = 200;
  f.contentWidth = 200;
  f.contentHeight = 400;  // max scroll = 200

  // Drag so far that it would go beyond maxContentY
  f.handlePointerEvent('down', { sceneX: 100, sceneY: 300, x: 100, y: 300, originalEvent: null });
  // Drag up by 500px → would give contentY = 500, but max is 200
  f.handlePointerEvent('move', { sceneX: 100, sceneY: -200, x: 100, y: -200, originalEvent: null });

  assert.equal(f.contentY, 200, `StopAtBounds: contentY should be clamped to 200, got ${f.contentY}`);
  f.handlePointerEvent('up', { sceneX: 100, sceneY: -200, x: 100, y: -200, originalEvent: null });
});

test('Flickable OvershootBounds allows over-drag', () => {
  const { Flickable } = require('../src/runtime');

  const f = new Flickable({ boundsBehavior: 'OvershootBounds' });
  f.width = 200;
  f.height = 200;
  f.contentWidth = 200;
  f.contentHeight = 400;  // max scroll = 200

  // Drag up by 500px → contentY goes beyond 200 (with resistance)
  f.handlePointerEvent('down', { sceneX: 100, sceneY: 300, x: 100, y: 300, originalEvent: null });
  f.handlePointerEvent('move', { sceneX: 100, sceneY: -200, x: 100, y: -200, originalEvent: null });

  assert.ok(f.contentY > 200, `OvershootBounds: contentY should exceed 200 during drag, got ${f.contentY}`);
  assert.ok(f.contentY < 500, `OvershootBounds: contentY should have resistance, got ${f.contentY}`);
  f.handlePointerEvent('up', { sceneX: 100, sceneY: -200, x: 100, y: -200, originalEvent: null });
});

test('Flickable OvershootBounds rebounds after overshoot', () => {
  const { Flickable, AnimationTicker } = require('../src/runtime');

  const f = new Flickable({ boundsBehavior: 'OvershootBounds' });
  f.width = 200;
  f.height = 200;
  f.contentWidth = 200;
  f.contentHeight = 400;  // max scroll = 200

  // Force contentY into overshoot
  f._setPropertyValue('contentY', 250);  // 50px over max
  f._reboundY = true;
  f._startTicker();

  // Advance ticker several times to simulate animation
  const initialY = f.contentY;
  f._onFlickTick(50);  // 50ms
  assert.ok(f.contentY < initialY, `contentY should decrease toward bound, was ${initialY}, now ${f.contentY}`);

  // After many ticks the content should settle at the max bound
  for (let i = 0; i < 30; i++) {
    f._onFlickTick(50);
    if (!f._reboundY) break;
  }
  assert.ok(Math.abs(f.contentY - 200) < 1, `contentY should rebound to 200, got ${f.contentY}`);
  f.destroy();
});

test('Flickable flick inertia decelerates to stop', () => {
  const { Flickable } = require('../src/runtime');

  const f = new Flickable({ boundsBehavior: 'StopAtBounds' });
  f.width = 200;
  f.height = 200;
  f.contentWidth = 200;
  f.contentHeight = 10000;  // very long content

  // Give it a starting flick velocity
  f._flickVY = 1000;  // px/s downward
  f._flickingV = true;
  f._setPropertyValue('moving', true);
  f._setPropertyValue('flicking', true);
  f._startTicker();

  const startY = f.contentY;

  // Advance 200ms
  f._onFlickTick(200);
  const y200 = f.contentY;
  assert.ok(y200 > startY, `contentY should increase after 200ms of flicking, was ${startY}, now ${y200}`);
  assert.ok(f._flickVY < 1000, `velocity should have decreased, was 1000, now ${f._flickVY}`);

  // Advance many ticks until flick stops
  for (let i = 0; i < 50; i++) {
    if (!f._flickingV) break;
    f._onFlickTick(50);
  }
  assert.equal(f._flickingV, false, 'flick should have stopped');
  assert.equal(f._flickVY, 0, 'flick velocity should be 0');
  // velocity properties should have been cleared
  assert.equal(f.verticalVelocity, 0, 'verticalVelocity should be 0 after flick stops');
  f.destroy();
});

test('Flickable wheel event updates contentY', () => {
  const { Flickable } = require('../src/runtime');

  const f = new Flickable();
  f.width = 200;
  f.height = 200;
  f.contentWidth = 200;
  f.contentHeight = 600;

  // Simulate wheel scroll down by 80px (deltaMode=0)
  const accepted = f.handleWheelEvent({ deltaX: 0, deltaY: 80, deltaMode: 0 });
  assert.equal(accepted, true, 'wheel event should be accepted');
  assert.equal(f.contentY, 80, `contentY should be 80 after wheel, got ${f.contentY}`);

  // Wheel clamps at max
  f.handleWheelEvent({ deltaX: 0, deltaY: 1000, deltaMode: 0 });
  assert.equal(f.contentY, 400, `contentY should be clamped at max (400), got ${f.contentY}`);
});

test('Flickable wheel respects flickableDirection', () => {
  const { Flickable } = require('../src/runtime');

  const fV = new Flickable({ flickableDirection: 'VerticalFlick' });
  fV.width = 200;
  fV.height = 200;
  fV.contentWidth = 600;
  fV.contentHeight = 600;

  // Horizontal wheel should not scroll
  fV.handleWheelEvent({ deltaX: 80, deltaY: 0, deltaMode: 0 });
  assert.equal(fV.contentX, 0, 'VerticalFlick should not accept horizontal wheel');

  // Vertical wheel should scroll
  fV.handleWheelEvent({ deltaX: 0, deltaY: 80, deltaMode: 0 });
  assert.equal(fV.contentY, 80, 'VerticalFlick should accept vertical wheel');
});

test('Flickable _getContentOffset returns correct offset', () => {
  const { Flickable } = require('../src/runtime');

  const f = new Flickable();
  assert.equal(f._getContentOffset(), null, 'no offset when contentX/Y are 0');

  f._setPropertyValue('contentY', 100);
  const offset = f._getContentOffset();
  assert.ok(offset !== null, 'should return offset when contentY != 0');
  assert.equal(offset.x, 0);
  assert.equal(offset.y, 100);
});

test('Flickable hitTest accounts for content offset', () => {
  const { Flickable, Item } = require('../src/runtime');

  const root = new Item();
  root.width = 400;
  root.height = 400;

  const f = new Flickable({ parentItem: root });
  f.x = 0;
  f.y = 0;
  f.width = 200;
  f.height = 200;
  f.contentHeight = 400;

  const child = new Item({ parentItem: f });
  child.x = 0;
  child.y = 200;  // logical content position: 200px down
  child.width = 200;
  child.height = 40;

  // Before scroll: child is at y=200, outside viewport (0..200), should not be hit at y=50
  const hitBefore = f.hitTest(50, 50);
  assert.ok(hitBefore === f, 'should hit the Flickable itself since child is out of viewport');

  // Scroll to contentY=200: child should now be at visual y=0
  f._setPropertyValue('contentY', 200);

  // The child is now visible at visual y=0. Click at scene (50, 10) should hit the child.
  const hitAfter = f.hitTest(50, 10);
  assert.ok(hitAfter === child, `expected child to be hit after scroll, got ${hitAfter?.constructor?.name}`);
  root.destroy();
});

test('ListView inherits Flickable and scrolls via contentY', () => {
  const { ListView, Flickable, ListModel, Component, Item, Context } = require('../src/runtime');

  assert.ok(new ListView() instanceof Flickable, 'ListView should be a Flickable');

  const model = new ListModel();
  for (let i = 0; i < 20; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // Verify items are at logical content positions (not offset by contentY)
  assert.equal(lv.itemAt(0)?.y, 0, 'item 0 should be at y=0 in content space');
  assert.equal(lv.itemAt(4)?.y, 160, 'item 4 should be at y=160 in content space');

  // Scroll
  lv.contentY = 80;
  assert.equal(lv.itemAt(2)?.y, 80, 'item 2 y should be 80 (logical content position)');
  assert.equal(lv.contentY, 80, 'contentY should be 80 after scroll');
  lv.destroy();
});

test('ListView positionViewAtIndex scrolls to correct position', () => {
  const { ListView, ListModel, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 50; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  lv.positionViewAtIndex(10);
  assert.equal(lv.contentY, 400, 'positionViewAtIndex(10) should set contentY to 400');
  lv.destroy();
});

// ---------------------------------------------------------------------------
// ListView – currentIndex / currentItem / highlight
// ---------------------------------------------------------------------------

test('ListView currentIndex defaults to -1 and currentItem is null', () => {
  const { ListView } = require('../src/runtime');
  const lv = new ListView();
  assert.equal(lv.currentIndex, -1);
  assert.equal(lv.currentItem, null);
  lv.destroy();
});

test('ListView setting currentIndex updates currentItem and highlight geometry', () => {
  const { ListModel, ListView, Component, Item, Rectangle, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 10; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  const highlight = new Component(({ parent: p }) => {
    const r = new Rectangle({ parentItem: p });
    r.color = 'blue';
    return r;
  });

  lv.model = model;
  lv.delegate = delegate;
  lv.highlight = highlight;

  // Before setting currentIndex, highlight is hidden
  assert.ok(lv.highlightItem, 'highlightItem should be created');
  assert.equal(lv.highlightItem.visible, false, 'highlight should be hidden when currentIndex=-1');

  // Set currentIndex to row 2
  lv.currentIndex = 2;
  assert.ok(lv.currentItem !== null, 'currentItem should be non-null');
  assert.equal(lv.currentItem, lv.itemAt(2), 'currentItem should be itemAt(2)');
  assert.equal(lv.highlightItem.visible, true, 'highlight should be visible');
  assert.equal(lv.highlightItem.y, 2 * 40, 'highlight y should match item 2 position');
  assert.equal(lv.highlightItem.height, 40, 'highlight height should match delegateHeight');

  // Set currentIndex to row 5
  lv.currentIndex = 5;
  assert.equal(lv.highlightItem.y, 5 * 40, 'highlight y should match item 5 position');

  lv.destroy();
});

test('ListView count mirrors model count', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 7; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  assert.equal(lv.count, 7, 'count should equal model count');

  model.append({ n: 7 });
  assert.equal(lv.count, 8, 'count should update when model grows');

  lv.destroy();
});

// ---------------------------------------------------------------------------
// ListView – header / footer
// ---------------------------------------------------------------------------

test('ListView header and footer affect contentHeight and item positions', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 5; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 400;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  const header = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 60;
    return item;
  });

  const footer = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 50;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;
  lv.header = header;
  lv.footer = footer;

  // contentHeight = header(60) + 5*40(200) + footer(50) = 310
  assert.equal(lv.contentHeight, 310, 'contentHeight should include header and footer');

  // Delegate items should be offset by header height
  assert.equal(lv.itemAt(0)?.y, 60, 'first item y should be after header (60)');
  assert.equal(lv.itemAt(4)?.y, 60 + 4 * 40, 'last item y should be header + 4*rowH');

  // Footer should be positioned after all delegates
  assert.equal(lv._footerItem.y, 60 + 5 * 40, 'footer y should be after all delegates');

  lv.destroy();
});

test('ListView positionViewAtIndex respects header height', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 20; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  const header = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 80;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;
  lv.header = header;

  // positionViewAtIndex(5) should scroll to header(80) + 5*40 = 280
  lv.positionViewAtIndex(5);
  assert.equal(lv.contentY, 280, 'positionViewAtIndex should account for header height');

  lv.destroy();
});

// ---------------------------------------------------------------------------
// ListView – keyboard navigation
// ---------------------------------------------------------------------------

test('ListView keyboard navigation ArrowDown/Up changes currentIndex', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 5; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // Start at -1
  assert.equal(lv.currentIndex, -1);

  // ArrowDown from -1 → 0
  lv._handleListViewKey({ key: 'ArrowDown', accepted: false });
  assert.equal(lv.currentIndex, 0, 'ArrowDown from -1 should go to 0');

  // ArrowDown from 0 → 1
  lv._handleListViewKey({ key: 'ArrowDown', accepted: false });
  assert.equal(lv.currentIndex, 1, 'ArrowDown should increment currentIndex');

  // ArrowUp from 1 → 0
  lv._handleListViewKey({ key: 'ArrowUp', accepted: false });
  assert.equal(lv.currentIndex, 0, 'ArrowUp should decrement currentIndex');

  // ArrowUp from 0 → 0 (already at min)
  lv._handleListViewKey({ key: 'ArrowUp', accepted: false });
  assert.equal(lv.currentIndex, 0, 'ArrowUp at index 0 should stay at 0');

  // Navigate to last item
  lv.currentIndex = 4;
  lv._handleListViewKey({ key: 'ArrowDown', accepted: false });
  assert.equal(lv.currentIndex, 4, 'ArrowDown at last index should stay at last');

  lv.destroy();
});

test('ListView keyboard PageDown/PageUp changes currentIndex by viewHeight', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 20; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;  // 5 rows visible
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  lv.currentIndex = 0;

  // PageDown: 200/40 = 5 rows
  lv._handleListViewKey({ key: 'PageDown', accepted: false });
  assert.equal(lv.currentIndex, 5, 'PageDown should advance by viewHeight/rowH');

  lv._handleListViewKey({ key: 'PageUp', accepted: false });
  assert.equal(lv.currentIndex, 0, 'PageUp should retreat by viewHeight/rowH');

  lv.destroy();
});

// ---------------------------------------------------------------------------
// ListView – reuse pool
// ---------------------------------------------------------------------------

test('ListView reuse pool reduces creations when scrolling', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 30; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  let creationCount = 0;
  const delegate = new Component(({ parent: p }) => {
    creationCount++;
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  const initialCreations = creationCount;
  assert.ok(initialCreations > 0, 'should have created some items initially');

  // Scroll to bottom
  lv.contentY = 800; // rows 20+
  const afterScrollDown = creationCount;

  // Scroll back to top
  lv.contentY = 0;
  const afterScrollBack = creationCount;

  // If pool is working, scrolling back to top should reuse pooled items
  // and create fewer new items than if everything was destroyed
  assert.ok(
    afterScrollBack - afterScrollDown < initialCreations,
    `Reuse pool should reduce creations on scroll-back (initial: ${initialCreations}, ` +
    `after scroll down: ${afterScrollDown}, after scroll back: ${afterScrollBack})`,
  );

  lv.destroy();
});

test('ListView atYBegin and atYEnd flags', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 20; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  assert.equal(lv.atYBegin, true, 'atYBegin should be true at start');
  assert.equal(lv.atYEnd, false, 'atYEnd should be false at start');

  // Scroll to bottom: contentHeight=800, viewH=200, maxY=600
  lv.contentY = 600;
  assert.equal(lv.atYBegin, false, 'atYBegin should be false after scroll');
  assert.equal(lv.atYEnd, true, 'atYEnd should be true at bottom');

  lv.destroy();
});

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

// ---------------------------------------------------------------------------
// Stage F: Text upgrade – multi-line layout, wrapMode, implicitSize
// ---------------------------------------------------------------------------

test('Text._getLines with WordWrap splits on word boundaries', () => {
  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const t = new Text({
    text: 'Hello World Foo',
    font: { family: 'test', pixelSize: 14, bold: false },
    wrapMode: 'WordWrap',
  });
  t.width = 48; // 6 chars * 8px = 48px per line maximum

  const lines = t._getLines(fakeCtx);
  // 'Hello' = 5*8=40 <=48, 'Hello World'=11*8=88 >48 → push 'Hello', cur='World'
  // 'World' = 5*8=40 <=48, 'World Foo'=9*8=72 >48 → push 'World', cur='Foo'
  // end → push 'Foo'
  assert.equal(lines.length, 3, `Expected 3 lines, got ${lines.length}: ${JSON.stringify(lines)}`);
  assert.equal(lines[0], 'Hello');
  assert.equal(lines[1], 'World');
  assert.equal(lines[2], 'Foo');
});

test('Text._measure computes implicitHeight from line count and pixelSize', () => {
  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const t = new Text({
    text: 'Hello World',
    font: { family: 'test', pixelSize: 16, bold: false },
    wrapMode: 'WordWrap',
  });
  t.width = 48; // fits 6 chars; 'Hello' and 'World' each fit, 'Hello World' doesn't

  t._measure(fakeCtx);
  // 2 lines * 16px = 32px
  assert.equal(t.implicitHeight, 32);
  // implicitWidth = max line width = 'Hello'.length * 8 = 5*8 = 40 or 'World' = 40
  assert.equal(t.implicitWidth, 40);
});

test('Text._getLines with lineHeight multiplier affects implicitHeight', () => {
  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const t = new Text({
    text: 'Hello\nWorld',
    font: { family: 'test', pixelSize: 10, bold: false },
    lineHeight: 1.5,
  });

  t._measure(fakeCtx);
  // 2 lines * 10px * 1.5 = 30px
  assert.equal(t.implicitHeight, 30);
});

test('Text elide right truncates with ellipsis (NoWrap)', () => {
  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const t = new Text({
    text: 'Hello World',
    font: { family: 'test', pixelSize: 12, bold: false },
    elide: 'ElideRight',
  });
  t.width = 40; // fits 5 chars

  const lines = t._getLines(fakeCtx);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith('\u2026'), `Expected ellipsis, got "${lines[0]}"`);
  // 'Hell\u2026' = 5 chars * 8 = 40 <= 40
  assert.ok(lines[0].length <= 5, `Line should be short: "${lines[0]}"`);
});

test('Text maximumLineCount limits lines and applies elide', () => {
  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const t = new Text({
    text: 'Line1\nLine2\nLine3\nLine4',
    font: { family: 'test', pixelSize: 12, bold: false },
    maximumLineCount: 2,
    elide: 'ElideRight',
  });
  t.width = 200; // wide enough for full text

  const lines = t._getLines(fakeCtx);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('\u2026'), `Last line should have ellipsis: "${lines[1]}"`);
});

test('Text draws multiple lines with correct positions', () => {
  const drawn = [];
  const fakeCtx = {
    font: '',
    fillStyle: '',
    textBaseline: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: (str, x, y) => { drawn.push({ str, x, y }); },
  };

  const t = new Text({
    text: 'Hello\nWorld',
    font: { family: 'test', pixelSize: 10, bold: false },
  });

  t.draw(fakeCtx);
  assert.equal(drawn.length, 2);
  assert.equal(drawn[0].str, 'Hello');
  assert.equal(drawn[0].y, 0);
  assert.equal(drawn[1].str, 'World');
  assert.equal(drawn[1].y, 10); // pixelSize * lineHeight = 10 * 1.0
});

test('Text horizontal center alignment positions text at (w - textW) / 2', () => {
  const drawn = [];
  const fakeCtx = {
    font: '',
    fillStyle: '',
    textBaseline: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: (str, x, y) => { drawn.push({ str, x }); },
  };

  const t = new Text({
    text: 'Hi',
    font: { family: 'test', pixelSize: 12, bold: false },
    horizontalAlignment: 'center',
  });
  t.width = 100;

  t.draw(fakeCtx);
  // 'Hi' = 2*8 = 16px; center x = (100 - 16) / 2 = 42
  assert.equal(drawn[0].x, 42);
});

test('Text vertical center alignment positions first line correctly', () => {
  const drawn = [];
  const fakeCtx = {
    font: '',
    fillStyle: '',
    textBaseline: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: (str, x, y) => { drawn.push({ str, y }); },
  };

  const t = new Text({
    text: 'Hi',
    font: { family: 'test', pixelSize: 10, bold: false },
    verticalAlignment: 'vcenter',
  });
  t.width = 100;
  t.height = 50;

  t.draw(fakeCtx);
  // 1 line * 10px = 10px totalH; startY = (50 - 10) / 2 = 20
  assert.equal(drawn[0].y, 20);
});

test('Text line cache is invalidated when text changes', () => {
  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const t = new Text({
    text: 'Hello',
    font: { family: 'test', pixelSize: 10, bold: false },
  });
  t.width = 200;

  const lines1 = t._getLines(fakeCtx);
  assert.equal(lines1[0], 'Hello');

  t.text = 'World'; // should invalidate cache
  const lines2 = t._getLines(fakeCtx);
  assert.equal(lines2[0], 'World');
});

// ---------------------------------------------------------------------------
// Stage F: TextInput tests
// ---------------------------------------------------------------------------

test('TextInput typing appends characters and updates cursorPosition', () => {
  const ti = new TextInput({ blinkInterval: 0 });

  const textChanges = [];
  ti.textChanged.connect((v) => textChanges.push(v));

  ti._handleKeyInput({ key: 'H', accepted: false });
  ti._handleKeyInput({ key: 'i', accepted: false });

  assert.equal(ti.text, 'Hi');
  assert.equal(ti.cursorPosition, 2);
  assert.deepEqual(textChanges, ['H', 'Hi']);
});

test('TextInput Backspace removes character before cursor', () => {
  const ti = new TextInput({ text: 'Hello', blinkInterval: 0 });

  ti._handleKeyInput({ key: 'Backspace', accepted: false });
  assert.equal(ti.text, 'Hell');
  assert.equal(ti.cursorPosition, 4);
});

test('TextInput Delete removes character after cursor', () => {
  const ti = new TextInput({ text: 'Hello', blinkInterval: 0 });
  ti._setCursorPos(0, false); // cursor at start

  ti._handleKeyInput({ key: 'Delete', accepted: false });
  assert.equal(ti.text, 'ello');
  assert.equal(ti.cursorPosition, 0);
});

test('TextInput ArrowLeft / ArrowRight move cursor', () => {
  const ti = new TextInput({ text: 'abc', blinkInterval: 0 });
  assert.equal(ti.cursorPosition, 3); // starts at end

  ti._handleKeyInput({ key: 'ArrowLeft', accepted: false });
  assert.equal(ti.cursorPosition, 2);

  ti._handleKeyInput({ key: 'ArrowRight', accepted: false });
  assert.equal(ti.cursorPosition, 3);
});

test('TextInput Home / End move cursor to start / end', () => {
  const ti = new TextInput({ text: 'abcde', blinkInterval: 0 });
  assert.equal(ti.cursorPosition, 5);

  ti._handleKeyInput({ key: 'Home', accepted: false });
  assert.equal(ti.cursorPosition, 0);

  ti._handleKeyInput({ key: 'End', accepted: false });
  assert.equal(ti.cursorPosition, 5);
});

test('TextInput Shift+ArrowRight extends selection', () => {
  const ti = new TextInput({ text: 'Hello', blinkInterval: 0 });
  ti._setCursorPos(0, false); // cursor at start

  ti._handleKeyInput({ key: 'ArrowRight', shiftKey: true, accepted: false });
  ti._handleKeyInput({ key: 'ArrowRight', shiftKey: true, accepted: false });
  ti._handleKeyInput({ key: 'ArrowRight', shiftKey: true, accepted: false });

  assert.equal(ti.cursorPosition, 3);
  assert.equal(ti.selectionStart, 0);
  assert.equal(ti.selectionEnd, 3);
  assert.equal(ti.selectedText, 'Hel');
});

test('TextInput Ctrl+A selects all text', () => {
  const ti = new TextInput({ text: 'Hello World', blinkInterval: 0 });
  ti._setCursorPos(0, false);

  ti._handleKeyInput({ key: 'a', ctrlKey: true, accepted: false });

  assert.equal(ti.selectionStart, 0);
  assert.equal(ti.selectionEnd, 11);
  assert.equal(ti.selectedText, 'Hello World');
});

test('TextInput typing over selection replaces it', () => {
  const ti = new TextInput({ text: 'Hello', blinkInterval: 0 });
  ti._setCursorPos(0, false);
  // Select 'Hell'
  ti._handleKeyInput({ key: 'ArrowRight', shiftKey: true, accepted: false });
  ti._handleKeyInput({ key: 'ArrowRight', shiftKey: true, accepted: false });
  ti._handleKeyInput({ key: 'ArrowRight', shiftKey: true, accepted: false });
  ti._handleKeyInput({ key: 'ArrowRight', shiftKey: true, accepted: false });

  assert.equal(ti.selectedText, 'Hell');
  ti._handleKeyInput({ key: 'X', accepted: false });
  assert.equal(ti.text, 'Xo');
  assert.equal(ti.cursorPosition, 1);
});

test('TextInput Enter emits accepted signal', () => {
  const ti = new TextInput({ blinkInterval: 0 });
  ti.text = 'search';

  let acceptedCount = 0;
  ti.signal('accepted').connect(() => { acceptedCount += 1; });

  const event = { key: 'Enter', accepted: false };
  ti._handleKeyInput(event);

  assert.equal(acceptedCount, 1);
  assert.equal(event.accepted, true);
});

test('TextInput readOnly ignores key input', () => {
  const ti = new TextInput({ text: 'fixed', readOnly: true, blinkInterval: 0 });

  ti._handleKeyInput({ key: 'X', accepted: false });
  assert.equal(ti.text, 'fixed');
});

test('TextInput echoMode Password shows bullets', () => {
  const ti = new TextInput({ text: 'abc', echoMode: 'Password', blinkInterval: 0 });
  assert.equal(ti._displayText(), '\u2022\u2022\u2022');
});

test('TextInput editingFinished emits on focus loss', () => {
  const root = new Item();
  root.width = 200;
  root.height = 100;

  const ti = new TextInput({ parentItem: root, blinkInterval: 0 });
  ti.width = 150;
  ti.height = 28;

  const scene = new Scene({ rootItem: root });
  let finishedCount = 0;
  ti.signal('editingFinished').connect(() => { finishedCount += 1; });

  scene.forceActiveFocus(ti);
  assert.equal(ti.activeFocus, true);
  assert.equal(ti.cursorVisible, true);

  scene.clearFocus();
  assert.equal(ti.activeFocus, false);
  assert.equal(finishedCount, 1);
});

test('TextInput draw renders text and selection highlight', () => {
  const calls = [];
  const fakeCtx = {
    font: '',
    fillStyle: '',
    textBaseline: '',
    strokeStyle: '',
    lineWidth: 0,
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: (str, x, y) => { calls.push({ op: 'fillText', str, x, y }); },
    fillRect: (x, y, w, h) => { calls.push({ op: 'fillRect', x, y, w, h }); },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
  };

  const ti = new TextInput({ text: 'Hello', blinkInterval: 0 });
  ti.width = 200;
  ti.height = 28;
  ti._setCursorPos(0, false);
  // Select first 3 chars
  ti._doUpdateSelection(0, 3);

  ti.draw(fakeCtx);

  const fillRects = calls.filter((c) => c.op === 'fillRect');
  const fillTexts = calls.filter((c) => c.op === 'fillText');
  assert.ok(fillRects.length > 0, 'Expected selection highlight rectangle');
  assert.ok(fillTexts.length > 0, 'Expected text to be drawn');
  assert.equal(fillTexts[0].str, 'Hello');
});

// ---------------------------------------------------------------------------
// Fix: explicit `delegate: Component { ... }` – runtime smoke test
// ---------------------------------------------------------------------------

test('ListView with numeric model and explicit Component delegate does not throw and creates items', () => {
  const { ListView, Component, Rectangle, Context, ComponentScope } = require('../src/runtime');

  const listView = new ListView();
  listView.width = 200;
  listView.height = 200;
  listView._delegateHeight = 50;
  listView.cacheBuffer = 0;

  listView.setContext(new Context(null, {}));

  // Simulate what `delegate: Component { Rectangle { ... } }` compiles to:
  // __createObjectTree for a Component node returns a Component whose factory
  // returns the inner Rectangle (a QObject).  Previously the code would wrap
  // this Component in *another* Component, making the outer factory return a
  // Component instance rather than a QObject, which triggered:
  //   "Component factory must return a QObject instance."
  const innerDelegate = new Component(({ parent: p }) => {
    const rect = new Rectangle({ parentItem: p });
    rect.width = 50;
    rect.height = 50;
    return rect;
  });

  // Assign a numeric model (100 rows) and the delegate – must not throw.
  listView.model = 3;
  listView.delegate = innerDelegate;

  assert.ok(listView.createdCount > 0, `Expected at least one delegate to be created, got ${listView.createdCount}`);
});

// ---------------------------------------------------------------------------
// PR2: Row / Column / Flow positioner tests
// ---------------------------------------------------------------------------

test('Row positions children horizontally with spacing', async () => {
  const { Row, Item } = require('../src/runtime');

  const row = new Row();
  const a = new Item({ parentItem: row });
  a.width = 50; a.height = 30;
  const b = new Item({ parentItem: row });
  b.width = 60; b.height = 40;
  const c = new Item({ parentItem: row });
  c.width = 40; c.height = 20;

  row.spacing = 5;

  // Wait for async layout
  await new Promise((r) => Promise.resolve().then(r));

  assert.equal(a.x, 0);
  assert.equal(b.x, 55);  // 50 + 5
  assert.equal(c.x, 120); // 55 + 60 + 5
  assert.equal(row.implicitWidth, 160); // 120 + 40
  assert.equal(row.implicitHeight, 40); // tallest child
});

test('Row respects padding', async () => {
  const { Row, Item } = require('../src/runtime');

  const row = new Row();
  row.padding = 10;
  const a = new Item({ parentItem: row });
  a.width = 50; a.height = 30;
  const b = new Item({ parentItem: row });
  b.width = 60; b.height = 40;

  await new Promise((r) => Promise.resolve().then(r));

  assert.equal(a.x, 10);
  assert.equal(a.y, 10);
  assert.equal(b.x, 60); // 10 + 50
  assert.equal(row.implicitWidth, 130); // 10 + 50 + 60 + 10
  assert.equal(row.implicitHeight, 60); // 10 + 40 + 10
});

test('Row RTL layoutDirection reverses child order', async () => {
  const { Row, Item } = require('../src/runtime');

  const row = new Row();
  row.layoutDirection = 'RightToLeft';
  row.spacing = 4;
  const a = new Item({ parentItem: row });
  a.width = 50; a.height = 20;
  const b = new Item({ parentItem: row });
  b.width = 30; b.height = 20;

  await new Promise((r) => Promise.resolve().then(r));

  // Total width = 50 + 4 + 30 = 84, implicitWidth = 84
  // RTL: a is rightmost, so a.x = 84 - 50 = 34; b.x = 34 - 4 - 30 = 0
  assert.equal(row.implicitWidth, 84);
  assert.equal(a.x, 34);
  assert.equal(b.x, 0);
});

test('Row ignores invisible children', async () => {
  const { Row, Item } = require('../src/runtime');

  const row = new Row();
  row.spacing = 5;
  const a = new Item({ parentItem: row });
  a.width = 50; a.height = 20;
  const hidden = new Item({ parentItem: row });
  hidden.width = 50; hidden.height = 20;
  hidden.visible = false;
  const b = new Item({ parentItem: row });
  b.width = 30; b.height = 20;

  await new Promise((r) => Promise.resolve().then(r));

  // Only a and b are visible: width = 50 + 5 + 30 = 85
  assert.equal(row.implicitWidth, 85);
  assert.equal(b.x, 55); // 50 + 5
});

test('Column positions children vertically with spacing', async () => {
  const { Column, Item } = require('../src/runtime');

  const col = new Column();
  col.spacing = 8;
  const a = new Item({ parentItem: col });
  a.width = 100; a.height = 30;
  const b = new Item({ parentItem: col });
  b.width = 80; b.height = 40;
  const c = new Item({ parentItem: col });
  c.width = 120; c.height = 20;

  await new Promise((r) => Promise.resolve().then(r));

  assert.equal(a.y, 0);
  assert.equal(b.y, 38);  // 30 + 8
  assert.equal(c.y, 86);  // 38 + 40 + 8
  assert.equal(col.implicitHeight, 106); // 86 + 20
  assert.equal(col.implicitWidth, 120);  // widest child
});

test('Column respects padding', async () => {
  const { Column, Item } = require('../src/runtime');

  const col = new Column();
  col.topPadding = 5;
  col.bottomPadding = 5;
  col.leftPadding = 8;
  col.rightPadding = 8;
  const a = new Item({ parentItem: col });
  a.width = 50; a.height = 20;

  await new Promise((r) => Promise.resolve().then(r));

  assert.equal(a.x, 8);
  assert.equal(a.y, 5);
  assert.equal(col.implicitWidth, 66);  // 8 + 50 + 8
  assert.equal(col.implicitHeight, 30); // 5 + 20 + 5
});

test('Flow LeftToRight wraps children based on available width', async () => {
  const { Flow, Item } = require('../src/runtime');

  const flow = new Flow();
  flow.width = 120;
  flow.spacing = 5;

  // Three 50-wide items; width=120 means only 2 fit per row (50+5+50=105 ≤ 120, but 105+5+50=160 > 120)
  const items = [];
  for (let i = 0; i < 3; i++) {
    const item = new Item({ parentItem: flow });
    item.width = 50;
    item.height = 30;
    items.push(item);
  }

  await new Promise((r) => Promise.resolve().then(r));

  // First row: items[0] at x=0, items[1] at x=55
  assert.equal(items[0].x, 0);
  assert.equal(items[0].y, 0);
  assert.equal(items[1].x, 55);
  assert.equal(items[1].y, 0);
  // Second row: items[2] wraps
  assert.equal(items[2].x, 0);
  assert.equal(items[2].y, 35); // 30 + 5
});

test('Flow RTL right-aligns items', async () => {
  const { Flow, Item } = require('../src/runtime');

  const flow = new Flow();
  flow.width = 200;
  flow.layoutDirection = 'RightToLeft';
  flow.spacing = 0;

  const a = new Item({ parentItem: flow });
  a.width = 60; a.height = 20;
  const b = new Item({ parentItem: flow });
  b.width = 80; b.height = 20;

  await new Promise((r) => Promise.resolve().then(r));

  // Total items fit in one row (60+80=140 ≤ 200).
  // RTL: row right edge = pl + availW = 0 + 200 = 200, rowW = 140
  // first item x = 200 - 140 = 60; second item x = 60 + 60 = 120
  assert.equal(a.x, 60);
  assert.equal(b.x, 120);
});

test('Flow TopToBottom wraps into columns', async () => {
  const { Flow, Item } = require('../src/runtime');

  const flow = new Flow();
  flow.flow = 'TopToBottom';
  flow.height = 70;  // only 2 items fit: 30+5+30=65 ≤ 70; 65+5+30=100 > 70
  flow.spacing = 5;

  // Three 30-tall items: first two fit, third wraps to a new column
  const items = [];
  for (let i = 0; i < 3; i++) {
    const item = new Item({ parentItem: flow });
    item.width = 40;
    item.height = 30;
    items.push(item);
  }

  await new Promise((r) => Promise.resolve().then(r));

  assert.equal(items[0].x, 0);
  assert.equal(items[0].y, 0);
  assert.equal(items[1].x, 0);
  assert.equal(items[1].y, 35); // 30 + 5
  // Third item wraps to second column
  assert.equal(items[2].x, 45); // 40 + 5
  assert.equal(items[2].y, 0);
});

test('Row implicitWidth and implicitHeight update when child size changes', async () => {
  const { Row, Item } = require('../src/runtime');

  const row = new Row();
  row.spacing = 0;
  const a = new Item({ parentItem: row });
  a.width = 50; a.height = 30;
  const b = new Item({ parentItem: row });
  b.width = 50; b.height = 20;

  await new Promise((r) => Promise.resolve().then(r));
  assert.equal(row.implicitWidth, 100);

  b.width = 80;
  await new Promise((r) => Promise.resolve().then(r));
  assert.equal(row.implicitWidth, 130);
});

test('Column with empty children reports zero implicit size', async () => {
  const { Column } = require('../src/runtime');

  const col = new Column();
  await new Promise((r) => Promise.resolve().then(r));

  assert.equal(col.implicitWidth, 0);
  assert.equal(col.implicitHeight, 0);
});

// ---------------------------------------------------------------------------
// QtQuick.Layouts: RowLayout / ColumnLayout / GridLayout tests
// ---------------------------------------------------------------------------

// Helper: wait one microtask for _scheduleLayout to run
const nextTick = () => new Promise((r) => Promise.resolve().then(r));

test('RowLayout distributes remaining width equally among fillWidth children', async () => {
  const { RowLayout, Item } = require('../src/runtime');

  const row = new RowLayout();
  row.width  = 300;
  row.height = 50;
  row.spacing = 0;

  // Two fill children
  const a = new Item({ parentItem: row });
  a.__layoutAttached = { fillWidth: true };

  const b = new Item({ parentItem: row });
  b.__layoutAttached = { fillWidth: true };

  await nextTick();

  // Each should receive 150px
  assert.equal(a.width, 150);
  assert.equal(b.width, 150);
  assert.equal(row.implicitWidth, 300);
});

test('RowLayout respects minimumWidth and maximumWidth when distributing', async () => {
  const { RowLayout, Item } = require('../src/runtime');

  const row = new RowLayout();
  row.width  = 200;
  row.spacing = 0;

  const a = new Item({ parentItem: row });
  a.__layoutAttached = { fillWidth: true, maximumWidth: 60 };

  const b = new Item({ parentItem: row });
  b.__layoutAttached = { fillWidth: true, minimumWidth: 20 };

  await nextTick();

  // a is capped at 60; b gets the rest: 200 - 60 = 140
  assert.equal(a.width, 60);
  assert.equal(b.width, 140);
});

test('RowLayout places fixed-width children and then fillWidth child with remaining space', async () => {
  const { RowLayout, Item } = require('../src/runtime');

  const row = new RowLayout();
  row.width   = 400;
  row.height  = 40;
  row.spacing = 10;

  const fixed = new Item({ parentItem: row });
  fixed.width = 100;

  const filler = new Item({ parentItem: row });
  filler.__layoutAttached = { fillWidth: true };

  await nextTick();

  // filler gets 400 - 10 (spacing) - 100 = 290
  assert.equal(fixed.width,  100);
  assert.equal(filler.width, 290);
  assert.equal(fixed.x,   0);
  assert.equal(filler.x, 110); // 100 + 10
});

test('RowLayout vertical alignment: vcenter (default)', async () => {
  const { RowLayout, Item } = require('../src/runtime');

  const row = new RowLayout();
  row.width  = 200;
  row.height = 100;
  row.spacing = 0;

  const child = new Item({ parentItem: row });
  child.width = 50; child.height = 40;
  // No fillHeight, no alignment → vcenter by default

  await nextTick();

  // availH = 100, itemH = 40 → cy = 0 + (100-40)/2 = 30
  assert.equal(child.y, 30);
});

test('RowLayout vertical alignment: AlignTop', async () => {
  const { RowLayout, Item } = require('../src/runtime');

  const row = new RowLayout();
  row.width  = 200;
  row.height = 100;
  row.spacing = 0;

  const child = new Item({ parentItem: row });
  child.width = 50; child.height = 40;
  child.__layoutAttached = { alignment: 'AlignTop' };

  await nextTick();

  assert.equal(child.y, 0);
});

test('RowLayout vertical alignment: AlignBottom', async () => {
  const { RowLayout, Item } = require('../src/runtime');

  const row = new RowLayout();
  row.width  = 200;
  row.height = 100;
  row.spacing = 0;

  const child = new Item({ parentItem: row });
  child.width = 50; child.height = 40;
  child.__layoutAttached = { alignment: 'AlignBottom' };

  await nextTick();

  // cy = 0 + 100 - 0 (bm) - 40 = 60
  assert.equal(child.y, 60);
});

test('RowLayout fillHeight stretches child to available height', async () => {
  const { RowLayout, Item } = require('../src/runtime');

  const row = new RowLayout();
  row.width  = 200;
  row.height = 100;
  row.spacing = 0;

  const child = new Item({ parentItem: row });
  child.width = 50;
  child.__layoutAttached = { fillHeight: true };

  await nextTick();

  assert.equal(child.height, 100);
  assert.equal(child.y,      0);
});

test('RowLayout child margins reduce allocated space', async () => {
  const { RowLayout, Item } = require('../src/runtime');

  const row = new RowLayout();
  row.width   = 200;
  row.height  = 50;
  row.spacing = 0;

  const child = new Item({ parentItem: row });
  child.__layoutAttached = { fillWidth: true, margins: 10 };

  await nextTick();

  // margins: 10 on each side → content area 200 - 20 = 180; child placed at x=10
  assert.equal(child.width, 180);
  assert.equal(child.x,      10);
});

test('RowLayout updates implicit size when child is added', async () => {
  const { RowLayout, Item } = require('../src/runtime');

  const row = new RowLayout();
  row.spacing = 5;

  const a = new Item({ parentItem: row });
  a.width = 50; a.height = 30;

  await nextTick();
  assert.equal(row.implicitWidth, 50);

  const b = new Item({ parentItem: row });
  b.width = 70; b.height = 20;

  await nextTick();
  assert.equal(row.implicitWidth, 125); // 50 + 5 + 70
});

// ---------------------------------------------------------------------------
// ColumnLayout
// ---------------------------------------------------------------------------

test('ColumnLayout distributes remaining height among fillHeight children', async () => {
  const { ColumnLayout, Item } = require('../src/runtime');

  const col = new ColumnLayout();
  col.width  = 100;
  col.height = 300;
  col.spacing = 0;

  const a = new Item({ parentItem: col });
  a.__layoutAttached = { fillHeight: true };

  const b = new Item({ parentItem: col });
  b.__layoutAttached = { fillHeight: true };

  await nextTick();

  assert.equal(a.height, 150);
  assert.equal(b.height, 150);
});

test('ColumnLayout places fixed-height child then fillHeight child', async () => {
  const { ColumnLayout, Item } = require('../src/runtime');

  const col = new ColumnLayout();
  col.width  = 100;
  col.height = 300;
  col.spacing = 10;

  const fixed = new Item({ parentItem: col });
  fixed.height = 80;

  const filler = new Item({ parentItem: col });
  filler.__layoutAttached = { fillHeight: true };

  await nextTick();

  assert.equal(fixed.y,   0);
  assert.equal(filler.y, 90); // 80 + 10
  assert.equal(filler.height, 210); // 300 - 80 - 10
});

test('ColumnLayout horizontal alignment: AlignHCenter', async () => {
  const { ColumnLayout, Item } = require('../src/runtime');

  const col = new ColumnLayout();
  col.width  = 200;
  col.height = 200;
  col.spacing = 0;

  const child = new Item({ parentItem: col });
  child.width = 60; child.height = 40;
  child.__layoutAttached = { alignment: 'AlignHCenter' };

  await nextTick();

  // center: (200 - 60) / 2 = 70
  assert.equal(child.x, 70);
});

test('ColumnLayout horizontal alignment: AlignRight', async () => {
  const { ColumnLayout, Item } = require('../src/runtime');

  const col = new ColumnLayout();
  col.width  = 200;
  col.height = 200;
  col.spacing = 0;

  const child = new Item({ parentItem: col });
  child.width = 60; child.height = 40;
  child.__layoutAttached = { alignment: 'AlignRight' };

  await nextTick();

  assert.equal(child.x, 140); // 200 - 60
});

test('ColumnLayout fillWidth stretches child to available width', async () => {
  const { ColumnLayout, Item } = require('../src/runtime');

  const col = new ColumnLayout();
  col.width  = 200;
  col.height = 100;
  col.spacing = 0;

  const child = new Item({ parentItem: col });
  child.height = 40;
  child.__layoutAttached = { fillWidth: true };

  await nextTick();

  assert.equal(child.width, 200);
  assert.equal(child.x,     0);
});

test('ColumnLayout empty children reports zero implicit size', async () => {
  const { ColumnLayout } = require('../src/runtime');

  const col = new ColumnLayout();
  await nextTick();

  assert.equal(col.implicitWidth,  0);
  assert.equal(col.implicitHeight, 0);
});

// ---------------------------------------------------------------------------
// GridLayout
// ---------------------------------------------------------------------------

test('GridLayout places children in a single row by default (auto-placement)', async () => {
  const { GridLayout, Item } = require('../src/runtime');

  const grid = new GridLayout();
  grid.spacing = 5;

  const a = new Item({ parentItem: grid });
  a.width = 50; a.height = 30;

  const b = new Item({ parentItem: grid });
  b.width = 60; b.height = 40;

  await nextTick();

  // Auto-placement, no columns set → single row
  assert.equal(a.x, 0);
  assert.equal(b.x, 55); // 50 + 5
  assert.equal(a.y, 0);
  assert.equal(b.y, 0);
});

test('GridLayout wraps at specified columns count', async () => {
  const { GridLayout, Item } = require('../src/runtime');

  const grid = new GridLayout();
  grid.columns = 2;
  grid.spacing = 0;

  const items = [];
  for (let i = 0; i < 4; i++) {
    const it = new Item({ parentItem: grid });
    it.width = 50; it.height = 30;
    items.push(it);
  }

  await nextTick();

  // 2 columns: (0,0) (0,1) (1,0) (1,1)
  assert.equal(items[0].x,  0); assert.equal(items[0].y,  0);
  assert.equal(items[1].x, 50); assert.equal(items[1].y,  0);
  assert.equal(items[2].x,  0); assert.equal(items[2].y, 30);
  assert.equal(items[3].x, 50); assert.equal(items[3].y, 30);
});

test('GridLayout respects explicit Layout.row / Layout.column', async () => {
  const { GridLayout, Item } = require('../src/runtime');

  const grid = new GridLayout();
  grid.spacing = 0;

  const a = new Item({ parentItem: grid });
  a.width = 40; a.height = 30;
  a.__layoutAttached = { row: 0, column: 1 }; // second column, first row

  const b = new Item({ parentItem: grid });
  b.width = 60; b.height = 25;
  b.__layoutAttached = { row: 1, column: 0 }; // first column, second row

  await nextTick();

  // a is at col 1 → x = colW[0] = 0 (no item in col 0, row 0) ... actually
  // col 0 width = prefW of b = 60; col 1 width = prefW of a = 40
  assert.equal(a.x, 60); // after col 0 (width 60)
  assert.equal(a.y, 0);
  assert.equal(b.x, 0);
  assert.equal(b.y, 30); // after row 0 (height 30)
});

test('GridLayout distributes extra width to fillWidth columns', async () => {
  const { GridLayout, Item } = require('../src/runtime');

  const grid = new GridLayout();
  grid.columns = 2;
  grid.width   = 200;
  grid.height  = 50;
  grid.spacing = 0;

  const a = new Item({ parentItem: grid });
  a.width = 50; a.height = 50;
  // No fill: stays at preferred width

  const b = new Item({ parentItem: grid });
  b.height = 50;
  b.__layoutAttached = { fillWidth: true };

  await nextTick();

  // col 0 = 50 (no fill); col 1 fills: 200 - 50 = 150
  assert.equal(a.width, 50);
  assert.equal(b.width, 150);
  assert.equal(b.x,      50);
});

test('GridLayout distributes extra height to fillHeight rows', async () => {
  const { GridLayout, Item } = require('../src/runtime');

  const grid = new GridLayout();
  grid.columns = 1;
  grid.width   = 100;
  grid.height  = 200;
  grid.spacing = 0;

  const a = new Item({ parentItem: grid });
  a.width = 100; a.height = 40;

  const b = new Item({ parentItem: grid });
  b.width = 100; b.height = 40;
  b.__layoutAttached = { fillHeight: true };

  await nextTick();

  // row 0 = 40; row 1 fills: 200 - 40 = 160
  assert.equal(a.height, 40);
  assert.equal(b.height, 160);
  assert.equal(b.y,       40);
});

test('GridLayout rowSpacing / columnSpacing work independently', async () => {
  const { GridLayout, Item } = require('../src/runtime');

  const grid = new GridLayout();
  grid.columns       = 2;
  grid.columnSpacing = 10;
  grid.rowSpacing    = 20;

  for (let i = 0; i < 4; i++) {
    const it = new Item({ parentItem: grid });
    it.width = 50; it.height = 30;
  }

  await nextTick();

  // Row 0: y=0; Row 1: y = 30 + 20 = 50
  // Col 0: x=0; Col 1: x = 50 + 10 = 60
  const kids = grid._childItems;
  assert.equal(kids[0].x,  0); assert.equal(kids[0].y,  0);
  assert.equal(kids[1].x, 60); assert.equal(kids[1].y,  0);
  assert.equal(kids[2].x,  0); assert.equal(kids[2].y, 50);
  assert.equal(kids[3].x, 60); assert.equal(kids[3].y, 50);
});

test('GridLayout implicit size matches content size', async () => {
  const { GridLayout, Item } = require('../src/runtime');

  const grid = new GridLayout();
  grid.columns = 3;
  grid.spacing = 4;

  for (let i = 0; i < 3; i++) {
    const it = new Item({ parentItem: grid });
    it.width = 50; it.height = 30;
  }

  await nextTick();

  // 3 cols × 50 + 2 × 4 spacing = 158; 1 row × 30 = 30
  assert.equal(grid.implicitWidth,  158);
  assert.equal(grid.implicitHeight,  30);
});

test('GridLayout TopToBottom flow places items in columns first', async () => {
  const { GridLayout, Item } = require('../src/runtime');

  const grid = new GridLayout();
  grid.flow  = 'TopToBottom';
  grid.rows  = 2;
  grid.spacing = 0;

  const items = [];
  for (let i = 0; i < 4; i++) {
    const it = new Item({ parentItem: grid });
    it.width = 50; it.height = 30;
    items.push(it);
  }

  await nextTick();

  // TopToBottom, rows=2: col 0 → items 0,1; col 1 → items 2,3
  assert.equal(items[0].x,  0); assert.equal(items[0].y,  0);
  assert.equal(items[1].x,  0); assert.equal(items[1].y, 30);
  assert.equal(items[2].x, 50); assert.equal(items[2].y,  0);
  assert.equal(items[3].x, 50); assert.equal(items[3].y, 30);
});

test('GridLayout child per-side margins offset placement', async () => {
  const { GridLayout, Item } = require('../src/runtime');

  const grid = new GridLayout();
  grid.columns = 1;
  grid.spacing = 0;

  const child = new Item({ parentItem: grid });
  child.width = 50; child.height = 30;
  child.__layoutAttached = { leftMargin: 8, topMargin: 5 };

  await nextTick();

  // Child placed at (8, 5)
  assert.equal(child.x, 8);
  assert.equal(child.y, 5);
});

test('RowLayout re-layouts when child size changes', async () => {
  const { RowLayout, Item } = require('../src/runtime');

  const row = new RowLayout();
  row.spacing = 0;

  const a = new Item({ parentItem: row });
  a.width = 100; a.height = 30;

  const b = new Item({ parentItem: row });
  b.width = 50; b.height = 30;

  await nextTick();
  assert.equal(row.implicitWidth, 150);

  b.width = 90;
  await nextTick();
  assert.equal(row.implicitWidth, 190);
});

// =============================================================================
// Stage G: ScrollBar tests
// =============================================================================

test('ScrollBar defaults to Vertical orientation and correct properties', () => {
  const { ScrollBar } = require('../src/runtime');
  const bar = new ScrollBar();
  assert.equal(bar.orientation, 'Vertical');
  assert.equal(bar.size, 1.0);
  assert.equal(bar.position, 0.0);
  assert.equal(bar.active, false);
  assert.equal(bar.policy, 'ScrollBarAsNeeded');
  assert.equal(bar.minimumSize, 0.05);
});

test('ScrollBar _shouldShow returns false when size >= 1 and policy is AsNeeded', () => {
  const { ScrollBar } = require('../src/runtime');
  const bar = new ScrollBar({ size: 1.0, policy: 'ScrollBarAsNeeded' });
  assert.equal(bar._shouldShow(), false);
});

test('ScrollBar _shouldShow returns true when size < 1 and policy is AsNeeded', () => {
  const { ScrollBar } = require('../src/runtime');
  const bar = new ScrollBar({ size: 0.5, policy: 'ScrollBarAsNeeded' });
  assert.equal(bar._shouldShow(), true);
});

test('ScrollBar _shouldShow obeys AlwaysOn and AlwaysOff policies', () => {
  const { ScrollBar } = require('../src/runtime');
  const on  = new ScrollBar({ size: 1.0, policy: 'ScrollBarAlwaysOn' });
  const off = new ScrollBar({ size: 0.3, policy: 'ScrollBarAlwaysOff' });
  assert.equal(on._shouldShow(),  true);
  assert.equal(off._shouldShow(), false);
});

test('ScrollBar _thumbRect computes correct vertical thumb geometry', () => {
  const { ScrollBar } = require('../src/runtime');
  const bar = new ScrollBar({ orientation: 'Vertical', size: 0.5, position: 0.0 });
  bar.width = 8; bar.height = 100;
  const t = bar._thumbRect();
  assert.equal(t.y, 0);
  assert.equal(t.height, 50);
  assert.equal(t.x, 0);
  assert.equal(t.width, 8);
});

test('ScrollBar _thumbRect computes correct horizontal thumb position', () => {
  const { ScrollBar } = require('../src/runtime');
  const bar = new ScrollBar({ orientation: 'Horizontal', size: 0.25, position: 0.5 });
  bar.width = 200; bar.height = 8;
  const t = bar._thumbRect();
  // position=0.5, size=0.25 → thumbLen=50, thumbOff=100
  assert.equal(t.x, 100);
  assert.equal(t.width, 50);
});

test('ScrollBar position is clamped to [0, 1-size] in _thumbRect', () => {
  const { ScrollBar } = require('../src/runtime');
  const bar = new ScrollBar({ orientation: 'Vertical', size: 0.3, position: 0.9 });
  bar.width = 8; bar.height = 100;
  const t = bar._thumbRect();
  // position clamped to 0.7
  assert.ok(t.y <= 70 + 0.01);
});

test('ScrollBar emits moved signal when position changes via drag', () => {
  const { ScrollBar } = require('../src/runtime');
  const bar = new ScrollBar({ orientation: 'Vertical', size: 0.5, position: 0 });
  bar.width = 8; bar.height = 100;
  // Make the ScrollBar visible
  bar.policy = 'ScrollBarAlwaysOn';

  const moved = [];
  bar.moved.connect(() => moved.push(bar.position));

  // Simulate pointer-down on the thumb (thumb covers y 0..50)
  bar.handlePointerEvent('down', { sceneX: 4, sceneY: 25 });
  // Drag down by 30 pixels
  bar.handlePointerEvent('move', { sceneX: 4, sceneY: 55 });
  bar.handlePointerEvent('up',   { sceneX: 4, sceneY: 55 });

  assert.ok(moved.length > 0, 'moved signal should have been emitted');
  assert.ok(bar.position > 0, 'position should have increased after drag');
});

test('ScrollBar wires to Flickable via attached properties API', () => {
  const { ScrollBar, Flickable } = require('../src/runtime');

  const flickable = new Flickable({
    flickableDirection: 'VerticalFlick',
  });
  flickable.width  = 300;
  flickable.height = 200;
  flickable.contentWidth  = 300;
  flickable.contentHeight = 600;

  const bar = new ScrollBar({ orientation: 'Vertical' });

  // Manually wire (mimics what the codegen attached handler does)
  bar.parentItem = flickable;
  function syncV() {
    const cH = flickable.contentHeight || 0;
    const vH = flickable.height || 1;
    if (cH > 0) {
      bar.size     = Math.min(1, vH / cH);
      bar.position = Math.max(0, Math.min(1 - bar.size, (flickable.contentY || 0) / cH));
    } else { bar.size = 1; bar.position = 0; }
  }
  syncV();
  flickable.contentYChanged.connect(syncV);
  bar.moved.connect(() => {
    const cH = flickable.contentHeight || 0;
    flickable.contentY = (bar.position || 0) * cH;
  });

  // Initial size: viewport 200 / content 600 = 1/3
  assert.ok(Math.abs(bar.size - 1 / 3) < 0.001, 'initial bar.size should be 1/3');
  assert.equal(bar.position, 0, 'initial bar.position should be 0');

  // Scroll flickable to middle
  flickable.contentY = 200;
  assert.ok(Math.abs(bar.position - 200 / 600) < 0.001, 'position should track contentY');

  // Move the bar
  bar.position = 0;
  bar.moved.emit();
  assert.equal(flickable.contentY, 0, 'flickable should scroll when bar moves');
});

// =============================================================================
// Stage G: StackView tests
// =============================================================================

test('StackView starts empty', () => {
  const { StackView } = require('../src/runtime');
  const sv = new StackView();
  assert.equal(sv.depth, 0);
  assert.equal(sv.currentIndex, -1);
  assert.equal(sv.currentItem, null);
});

test('StackView push adds an item and updates depth/currentItem', () => {
  const { StackView, Rectangle } = require('../src/runtime');
  const sv = new StackView();
  sv.width = 400; sv.height = 300;

  const page = new Rectangle({ color: '#ff0000' });
  const pushed = sv.push(page);

  assert.equal(pushed, page);
  assert.equal(sv.depth, 1);
  assert.equal(sv.currentIndex, 0);
  assert.equal(sv.currentItem, page);
});

test('StackView push hides previous item', () => {
  const { StackView, Rectangle } = require('../src/runtime');
  const sv = new StackView();
  sv.width = 400; sv.height = 300;

  const page1 = new Rectangle({ color: '#ff0000' });
  const page2 = new Rectangle({ color: '#0000ff' });

  sv.push(page1);
  sv.push(page2);

  assert.equal(sv.depth, 2);
  assert.equal(sv.currentItem, page2);
  assert.equal(page1.visible, false, 'page1 should be hidden');
  assert.equal(page2.visible, true,  'page2 should be visible');
});

test('StackView pop removes top item and reveals previous', () => {
  const { StackView, Rectangle } = require('../src/runtime');
  const sv = new StackView();
  sv.width = 400; sv.height = 300;

  const page1 = new Rectangle({ color: '#ff0000' });
  const page2 = new Rectangle({ color: '#0000ff' });

  sv.push(page1);
  sv.push(page2);
  const removed = sv.pop();

  assert.equal(removed, page2);
  assert.equal(sv.depth, 1);
  assert.equal(sv.currentItem, page1);
  assert.equal(page1.visible, true,  'page1 should be visible again');
});

test('StackView pop on single item returns null and keeps stack intact', () => {
  const { StackView, Rectangle } = require('../src/runtime');
  const sv = new StackView();
  sv.width = 400; sv.height = 300;

  const page = new Rectangle();
  sv.push(page);
  const result = sv.pop();

  assert.equal(result, null, 'pop on single item should return null');
  assert.equal(sv.depth, 1, 'stack depth should remain 1');
});

test('StackView clear empties the stack', () => {
  const { StackView, Rectangle } = require('../src/runtime');
  const sv = new StackView();
  sv.width = 400; sv.height = 300;

  sv.push(new Rectangle());
  sv.push(new Rectangle());
  sv.clear();

  assert.equal(sv.depth, 0);
  assert.equal(sv.currentIndex, -1);
  assert.equal(sv.currentItem, null);
});

test('StackView replace swaps the top item', () => {
  const { StackView, Rectangle } = require('../src/runtime');
  const sv = new StackView();
  sv.width = 400; sv.height = 300;

  const page1 = new Rectangle({ color: '#ff0000' });
  const page2 = new Rectangle({ color: '#00ff00' });

  sv.push(page1);
  sv.replace(page2);

  assert.equal(sv.depth, 1);
  assert.equal(sv.currentItem, page2);
});

test('StackView push with factory function creates item', () => {
  const { StackView, Rectangle } = require('../src/runtime');
  const sv = new StackView();
  sv.width = 400; sv.height = 300;

  let created = false;
  const factory = () => { created = true; return new Rectangle({ color: '#abcdef' }); };
  const result = sv.push(factory);

  assert.equal(created, true, 'factory should have been called');
  assert.ok(result instanceof Rectangle);
  assert.equal(sv.depth, 1);
});
