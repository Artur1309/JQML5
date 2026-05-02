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
  lv.reuseItems = true;
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

  // press inside draggable — active remains false until drag threshold is exceeded
  scene.dispatchPointer('down', 100, 100);
  assert.equal(handler.active, false);

  // move beyond the grab threshold (default 5 px) — now active
  scene.dispatchPointer('move', 120, 130);
  assert.equal(handler.active, true);
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
// Stage E parity: ElideLeft, ElideMiddle, implicit sizing, layout propagation
// ---------------------------------------------------------------------------

test('Text ElideLeft truncates from left with ellipsis prefix', () => {
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
    elide: 'ElideLeft',
  });
  t.width = 40; // fits 5 chars

  const lines = t._getLines(fakeCtx);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith('\u2026'), `Expected leading ellipsis, got "${lines[0]}"`);
  // '\u2026orld' = 5 chars * 8 = 40 <= 40
  assert.ok(lines[0].length <= 5, `Line should be short: "${lines[0]}"`);
});

test('Text ElideMiddle truncates in the middle with ellipsis', () => {
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
    elide: 'ElideMiddle',
  });
  t.width = 56; // fits 7 chars total

  const lines = t._getLines(fakeCtx);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('\u2026'), `Expected middle ellipsis, got "${lines[0]}"`);
  assert.ok(!lines[0].startsWith('\u2026'), `Should not start with ellipsis: "${lines[0]}"`);
  assert.ok(!lines[0].endsWith('\u2026'), `Should not end with ellipsis: "${lines[0]}"`);
  // Total width must not exceed the constrained width
  const totalW = lines[0].length * 8;
  assert.ok(totalW <= 56, `Elided line width ${totalW} exceeds container width 56: "${lines[0]}"`);
});

test('Text ElideRight in NoWrap mode does not overflow container width (Qt-doc style)', () => {
  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const t = new Text({
    text: 'This is a long text that should be elided at the right side',
    font: { family: 'test', pixelSize: 12, bold: false },
    elide: 'ElideRight',
  });
  t.width = 120; // fits 15 chars

  const lines = t._getLines(fakeCtx);
  assert.equal(lines.length, 1, 'NoWrap with elide should produce exactly one line');
  assert.ok(lines[0].endsWith('\u2026'), `Expected trailing ellipsis`);
  // Verify it fits within the width (each char = 8px)
  const lineW = lines[0].length * 8;
  assert.ok(lineW <= 120, `Elided text width ${lineW} must not exceed container width 120`);
});

test('Text WordWrap in constrained width grows implicitHeight (Qt-doc style)', () => {
  // Derived from Qt 6 docs: "If a Text item is constrained in width, WordWrap
  // will cause implicitHeight to increase as more lines are needed."
  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const t = new Text({
    text: 'The quick brown fox',
    font: { family: 'test', pixelSize: 14, bold: false },
    wrapMode: 'WordWrap',
  });

  // Wide width: fits on one line
  t.width = 200;
  t._measure(fakeCtx);
  const oneLineH = t.implicitHeight;
  assert.equal(oneLineH, 14, 'Should be one line tall (14px pixelSize)');

  // Narrow width forces wrapping to multiple lines
  t.width = 48; // 6 chars * 8px = 48px, so each word fits but not "The quick"
  t._measure(fakeCtx);
  assert.ok(t.implicitHeight > oneLineH, `implicitHeight (${t.implicitHeight}) should grow beyond single-line height (${oneLineH}) when wrapping`);
});

test('Text WrapAnywhere in constrained width grows implicitHeight', () => {
  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const t = new Text({
    text: 'ABCDEFGHIJ',
    font: { family: 'test', pixelSize: 10, bold: false },
    wrapMode: 'WrapAnywhere',
  });

  t.width = 40; // 5 chars per line → 2 lines
  t._measure(fakeCtx);
  // 2 lines × 10px = 20px
  assert.equal(t.implicitHeight, 20, `Expected 20px for 2 wrapped lines`);
  // implicitWidth = max line width = 5*8 = 40
  assert.equal(t.implicitWidth, 40);
});

test('ColumnLayout with Text child updates implicitHeight when text changes (Qt-doc style)', async () => {
  // Derived from Qt 6 docs: a ColumnLayout whose child Text uses WordWrap
  // should resize when the text content changes and updates implicitHeight.
  const { ColumnLayout, Text } = require('../src/runtime');

  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const col = new ColumnLayout();
  col.spacing = 0;

  const t = new Text({
    font: { family: 'test', pixelSize: 16, bold: false },
    wrapMode: 'WordWrap',
    parentItem: col,
  });
  t.width = 80; // ~10 chars per line

  // Short text → 1 line
  t.text = 'Hi';
  t._measure(fakeCtx); // implicitHeight = 16

  await nextTick();
  assert.equal(t.implicitHeight, 16, 'Short text: 1 line = 16px');
  assert.equal(col.implicitHeight, 16, 'ColumnLayout should match single-line text height');

  // Longer text that wraps → 2 lines
  // 'Hello World': 'Hello'=5*8=40 ≤ 80, 'Hello World'=11*8=88 > 80 → 2 lines
  t.text = 'Hello World';
  t._measure(fakeCtx); // implicitHeight = 32

  await nextTick();
  assert.equal(t.implicitHeight, 32, 'Wrapped text: 2 lines = 32px');
  assert.equal(col.implicitHeight, 32, 'ColumnLayout should reflect updated text implicitHeight');
});

test('RowLayout with Text child updates implicitWidth when text changes', async () => {
  const { RowLayout, Text } = require('../src/runtime');

  const fakeCtx = {
    font: '',
    measureText: (str) => ({ width: str.length * 8 }),
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const row = new RowLayout();
  row.spacing = 0;

  const t = new Text({
    font: { family: 'test', pixelSize: 12, bold: false },
    parentItem: row,
  });

  // Short text
  t.text = 'Hi';
  t._measure(fakeCtx); // implicitWidth = 2*8 = 16
  await nextTick();
  assert.equal(t.implicitWidth, 16);
  assert.equal(row.implicitWidth, 16, 'RowLayout width should match text implicitWidth');

  // Longer text
  t.text = 'Hello World';
  t._measure(fakeCtx); // implicitWidth = 11*8 = 88
  await nextTick();
  assert.equal(t.implicitWidth, 88);
  assert.equal(row.implicitWidth, 88, 'RowLayout should update when text implicitWidth changes');
});

test('Text draw stores context for proactive re-measurement', () => {
  let measureCalls = 0;
  const fakeCtx = {
    font: '',
    measureText: (str) => { measureCalls++; return { width: str.length * 8 }; },
    fillText: () => {},
    fillStyle: '',
    textBaseline: '',
  };

  const t = new Text({
    text: 'Hello',
    font: { family: 'test', pixelSize: 12, bold: false },
  });

  // After first draw, _lastCtx should be set
  assert.equal(t._lastCtx, null, '_lastCtx should be null before first draw');
  t.draw(fakeCtx);
  assert.ok(t._lastCtx === fakeCtx, '_lastCtx should be set after draw');
});

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

// ---------------------------------------------------------------------------
// Stage H: HoverHandler
// ---------------------------------------------------------------------------

test('HoverHandler enter/leave toggles hovered and emits signals', () => {
  const { Item, HoverHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const handler = new HoverHandler({ parentItem: root });
  handler.width = 100; handler.height = 100;

  const events = [];
  handler.entered.connect(() => events.push('entered'));
  handler.exited.connect(() => events.push('exited'));

  const scene = new Scene({ rootItem: root });

  // move inside bounds → enter
  scene.dispatchPointer('move', 50, 50);
  assert.equal(handler.hovered, true, 'should be hovered after move inside');
  assert.deepEqual(handler.point, { x: 50, y: 50 }, 'point should track cursor');

  // move outside bounds → leave
  scene.dispatchPointer('move', 150, 150);
  assert.equal(handler.hovered, false, 'should not be hovered after move outside');

  assert.deepEqual(events, ['entered', 'exited']);
});

test('HoverHandler point updates while hovered', () => {
  const { Item, HoverHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const handler = new HoverHandler({ parentItem: root });
  handler.width = 100; handler.height = 100;

  const scene = new Scene({ rootItem: root });

  scene.dispatchPointer('move', 20, 30);
  assert.deepEqual(handler.point, { x: 20, y: 30 });

  scene.dispatchPointer('move', 60, 70);
  assert.deepEqual(handler.point, { x: 60, y: 70 });
});

test('HoverHandler clearAllHovers clears hovered state', () => {
  const { Item, HoverHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const handler = new HoverHandler({ parentItem: root });
  handler.width = 100; handler.height = 100;

  const scene = new Scene({ rootItem: root });

  scene.dispatchPointer('move', 50, 50);
  assert.equal(handler.hovered, true);

  scene._clearAllHovers();
  assert.equal(handler.hovered, false);
});

// ---------------------------------------------------------------------------
// Stage H: WheelHandler
// ---------------------------------------------------------------------------

test('WheelHandler emits wheel signal when cursor is over item', () => {
  const { Item, WheelHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const handler = new WheelHandler({ parentItem: root });
  handler.width = 100; handler.height = 100;

  const wheelEvents = [];
  handler.wheel.connect((e) => wheelEvents.push(e));

  const scene = new Scene({ rootItem: root });
  scene.dispatchWheel(50, 50, { deltaX: 0, deltaY: 100, deltaMode: 0 });

  assert.equal(wheelEvents.length, 1, 'wheel signal should fire once');
  assert.equal(wheelEvents[0].deltaY, 100);
});

test('WheelHandler does not fire when cursor is outside bounds', () => {
  const { Item, WheelHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  // handler covers only top-left quadrant
  const handler = new WheelHandler({ parentItem: root });
  handler.width = 100; handler.height = 100;

  let fired = false;
  handler.wheel.connect(() => { fired = true; });

  const scene = new Scene({ rootItem: root });
  scene.dispatchWheel(150, 150, { deltaX: 0, deltaY: 100, deltaMode: 0 });

  assert.equal(fired, false, 'wheel should not fire outside handler bounds');
});

test('WheelHandler orientation=horizontal ignores vertical scroll', () => {
  const { Item, WheelHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const handler = new WheelHandler({ parentItem: root, orientation: 'horizontal' });
  handler.width = 200; handler.height = 200;

  let fired = false;
  handler.wheel.connect(() => { fired = true; });

  const scene = new Scene({ rootItem: root });
  scene.dispatchWheel(50, 50, { deltaX: 0, deltaY: 100, deltaMode: 0 });

  assert.equal(fired, false, 'horizontal WheelHandler should ignore vertical scroll');
});

test('WheelHandler with no dimensions uses parent containsPoint', () => {
  const { Item, WheelHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const parent = new Item({ parentItem: root });
  parent.x = 0; parent.y = 0;
  parent.width = 100; parent.height = 100;

  // WheelHandler has no explicit bounds; should use parent item
  const handler = new WheelHandler({ parentItem: parent });

  let fired = false;
  handler.wheel.connect(() => { fired = true; });

  const scene = new Scene({ rootItem: root });
  scene.dispatchWheel(50, 50, { deltaX: 0, deltaY: 50, deltaMode: 0 });

  assert.equal(fired, true, 'WheelHandler should fire when cursor is over parent');
});

// ---------------------------------------------------------------------------
// Stage H: PinchHandler (ctrl+wheel fallback)
// ---------------------------------------------------------------------------

test('PinchHandler scales up on ctrl+wheel with negative deltaY', () => {
  const { Item, PinchHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const handler = new PinchHandler({ parentItem: root });
  handler.width = 200; handler.height = 200;

  const scaleValues = [];
  handler.scaleChanged.connect((s) => scaleValues.push(s));

  const scene = new Scene({ rootItem: root });
  scene.dispatchWheel(100, 100, { ctrlKey: true, deltaX: 0, deltaY: -10, deltaMode: 0 });

  assert.equal(scaleValues.length, 1, 'scaleChanged should fire exactly once');
  assert.ok(scaleValues[0] > 1.0, 'scale should increase on ctrl+wheelUp');
});

test('PinchHandler scales down on ctrl+wheel with positive deltaY', () => {
  const { Item, PinchHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const handler = new PinchHandler({ parentItem: root });
  handler.width = 200; handler.height = 200;

  const scene = new Scene({ rootItem: root });
  scene.dispatchWheel(100, 100, { ctrlKey: true, deltaX: 0, deltaY: 10, deltaMode: 0 });

  assert.ok(handler.scale < 1.0, 'scale should decrease on ctrl+wheelDown');
});

test('PinchHandler ignores wheel without ctrlKey', () => {
  const { Item, PinchHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const handler = new PinchHandler({ parentItem: root });
  handler.width = 200; handler.height = 200;

  const scene = new Scene({ rootItem: root });
  const initialScale = handler.scale;
  scene.dispatchWheel(100, 100, { ctrlKey: false, deltaX: 0, deltaY: 50, deltaMode: 0 });

  assert.equal(handler.scale, initialScale, 'scale should not change without ctrlKey');
});

// ---------------------------------------------------------------------------
// Stage H: Drag + Tap arbitration
// ---------------------------------------------------------------------------

test('TapHandler fires when DragHandler threshold is not exceeded', () => {
  const { Item, TapHandler, DragHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  // TapHandler and DragHandler on the same parent item at the same area.
  // TapHandler has higher z so it is hit-tested first.
  const tap = new TapHandler({ parentItem: root });
  tap.width = 100; tap.height = 100; tap.z = 1;

  const drag = new DragHandler({ parentItem: root });
  drag.width = 100; drag.height = 100; drag.z = 0;

  let tapped = 0;
  tap.tapped.connect(() => { tapped += 1; });

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 50, 50);
  // No move – pointer stays in place (no drag)
  scene.dispatchPointer('up', 50, 50);

  assert.equal(tapped, 1, 'TapHandler should fire when no drag threshold exceeded');
  assert.equal(drag.active, false, 'DragHandler should remain inactive');
});

test('DragHandler activates when move exceeds grab threshold', () => {
  const { Item, DragHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const box = new Item({ parentItem: root });
  box.x = 0; box.y = 0;
  box.width = 200; box.height = 200;

  const handler = new DragHandler({ parentItem: box });
  handler.width = 200; handler.height = 200;

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 50, 50);
  // Move only 2px – below default threshold of 5px
  scene.dispatchPointer('move', 52, 50);
  assert.equal(handler.active, false, 'should not activate below threshold');

  // Move further to exceed threshold
  scene.dispatchPointer('move', 60, 60);
  assert.equal(handler.active, true, 'should activate after exceeding threshold');
});

// =============================================================================
// Stage I: Popup / Dialog / Menu / MenuItem tests
// =============================================================================

test('Popup defaults to hidden', () => {
  const { Popup } = require('../src/runtime');
  const p = new Popup();
  assert.equal(p.visible, false);
});

test('Popup.open() makes popup visible and emits opened', () => {
  const { Popup } = require('../src/runtime');
  const p = new Popup();
  const events = [];
  p.opened.connect(() => events.push('opened'));
  p.open();
  assert.equal(p.visible, true);
  assert.deepEqual(events, ['opened']);
});

test('Popup.close() hides popup and emits closed', () => {
  const { Popup } = require('../src/runtime');
  const p = new Popup();
  const events = [];
  p.closed.connect(() => events.push('closed'));
  p.open();
  p.close();
  assert.equal(p.visible, false);
  assert.deepEqual(events, ['closed']);
});

test('Popup.open() is idempotent (does not emit opened twice)', () => {
  const { Popup } = require('../src/runtime');
  const p = new Popup();
  let count = 0;
  p.opened.connect(() => count++);
  p.open();
  p.open(); // second call should be a no-op
  assert.equal(count, 1);
});

test('Popup has default high z-order', () => {
  const { Popup } = require('../src/runtime');
  const p = new Popup();
  assert.equal(p.z, 1000);
});

test('Popup CloseOnEscape constant equals 1', () => {
  const { Popup } = require('../src/runtime');
  assert.equal(Popup.CloseOnEscape, 1);
});

test('Popup CloseOnPressOutside constant equals 2', () => {
  const { Popup } = require('../src/runtime');
  assert.equal(Popup.CloseOnPressOutside, 2);
});

test('Popup NoAutoClose constant equals 0', () => {
  const { Popup } = require('../src/runtime');
  assert.equal(Popup.NoAutoClose, 0);
});

test('Scene.dispatchKey Escape closes popup with CloseOnEscape policy', () => {
  const { Item, Popup, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const popup = new Popup({ parentItem: root, closePolicy: Popup.CloseOnEscape });
  popup.width = 200; popup.height = 200;
  popup.open();

  const scene = new Scene({ rootItem: root });
  // Give the scene a focusable item so dispatchKey doesn't bail early
  const btn = new Item({ parentItem: root });
  btn.activeFocusOnTab = true;
  btn.focusable = true;
  scene.forceActiveFocus(btn);

  assert.equal(popup.visible, true);
  scene.dispatchKey('pressed', { key: 'Escape', code: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(popup.visible, false);
});

test('Scene.dispatchKey Escape does NOT close popup with NoAutoClose policy', () => {
  const { Item, Popup, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const popup = new Popup({ parentItem: root, closePolicy: Popup.NoAutoClose });
  popup.width = 200; popup.height = 200;
  popup.open();

  const scene = new Scene({ rootItem: root });
  const btn = new Item({ parentItem: root });
  btn.activeFocusOnTab = true;
  btn.focusable = true;
  scene.forceActiveFocus(btn);

  scene.dispatchKey('pressed', { key: 'Escape', code: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(popup.visible, true, 'popup should stay open with NoAutoClose');
});

test('Scene.dispatchPointer CloseOnPressOutside closes popup on outside click', () => {
  const { Item, Popup, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const popup = new Popup({ parentItem: root, closePolicy: Popup.CloseOnPressOutside });
  popup.x = 100; popup.y = 100;
  popup.width = 200; popup.height = 200;
  popup.open();

  const scene = new Scene({ rootItem: root });

  // Click well outside the popup
  scene.dispatchPointer('down', 10, 10);
  assert.equal(popup.visible, false, 'popup should close on outside click');
});

test('modal popup blocks click-through to items behind', () => {
  const { Item, Popup, Button, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  // Background button that should NOT be clicked when modal popup is open
  const bgButton = new Button({ parentItem: root });
  bgButton.x = 0; bgButton.y = 0;
  bgButton.width = 400; bgButton.height = 400;
  bgButton.text = 'Background';

  let bgClicked = false;
  bgButton.clicked.connect(() => { bgClicked = true; });

  const popup = new Popup({ parentItem: root, modal: true });
  popup.x = 100; popup.y = 100;
  popup.width = 200; popup.height = 200;
  // modal popup with no auto-close so it stays open
  popup.closePolicy = Popup.NoAutoClose;
  popup.open();

  const scene = new Scene({ rootItem: root });

  // Click outside the popup, inside the background button
  scene.dispatchPointer('down', 10, 10);
  scene.dispatchPointer('up', 10, 10);
  assert.equal(bgClicked, false, 'modal popup should block clicks to items behind');
});

test('Dialog has accepted and rejected signals', () => {
  const { Dialog } = require('../src/runtime');
  const d = new Dialog({ title: 'Test' });
  assert.ok(typeof d.accepted.connect === 'function');
  assert.ok(typeof d.rejected.connect === 'function');
});

test('Dialog defaults to modal', () => {
  const { Dialog } = require('../src/runtime');
  const d = new Dialog();
  assert.equal(d.modal, true);
});

test('Dialog standardButton constants', () => {
  const { Dialog } = require('../src/runtime');
  assert.equal(Dialog.Ok,       1);
  assert.equal(Dialog.Cancel,   2);
  assert.equal(Dialog.NoButton, 0);
});

test('MenuItem triggered signal fires on click', () => {
  const { Item, MenuItem, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 200; root.height = 200;

  const mi = new MenuItem({ parentItem: root, text: 'Copy' });
  mi.x = 0; mi.y = 0;
  mi.width = 200; mi.height = 32;

  let triggered = false;
  mi.triggered.connect(() => { triggered = true; });

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 100, 16);
  scene.dispatchPointer('up', 100, 16);

  assert.equal(triggered, true, 'MenuItem triggered should fire on click');
});

test('MenuItem triggered closes parent Menu', () => {
  const { Item, Menu, MenuItem, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const menu = new Menu({ parentItem: root });
  menu.x = 0; menu.y = 0;
  menu.width = 160;

  const mi = new MenuItem({ parentItem: menu, text: 'Delete' });
  mi.width = 160; mi.height = 32;

  menu.open();
  assert.equal(menu.visible, true);

  const scene = new Scene({ rootItem: root });
  // Click on the menu item (Menu renders at y=0, MenuItem at y=4 because of padding)
  scene.dispatchPointer('down', 80, 20);
  scene.dispatchPointer('up', 80, 20);

  assert.equal(menu.visible, false, 'Menu should close after MenuItem is triggered');
});

test('Menu defaults to non-modal', () => {
  const { Menu } = require('../src/runtime');
  const m = new Menu();
  assert.equal(m.modal, false);
});

test('Popup containsScenePoint returns correct values', () => {
  const { Item, Popup } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const popup = new Popup({ parentItem: root });
  popup.x = 100; popup.y = 100;
  popup.width = 200; popup.height = 200;

  assert.equal(popup.containsScenePoint(150, 150), true,  'inside should return true');
  assert.equal(popup.containsScenePoint(50,  50),  false, 'outside should return false');
  assert.equal(popup.containsScenePoint(300, 300), false, 'upper bound is exclusive');
  assert.equal(popup.containsScenePoint(299, 299), true,  'just inside upper bound should return true');
});

// ---------------------------------------------------------------------------
// ListView – delegate context parity (model.index / modelData)
// ---------------------------------------------------------------------------

test('ListView delegate context exposes index, model.index and modelData for numeric model', () => {
  const { ListView, Component, Item, Context } = require('../src/runtime');

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const captured = [];
  const delegate = new Component(({ parent: p, context }) => {
    captured.push({
      index:      context.lookup('index'),
      modelIndex: context.lookup('model') && context.lookup('model').index,
      modelData:  context.lookup('modelData'),
    });
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = 5;
  lv.delegate = delegate;

  assert.ok(captured.length > 0, 'delegate should have been called');
  for (const c of captured) {
    assert.equal(typeof c.index, 'number', 'index should be a number');
    assert.equal(c.modelIndex, c.index, 'model.index should equal index');
    assert.equal(c.modelData, c.index, 'modelData should equal index for numeric model');
  }

  lv.destroy();
});

test('ListView delegate context exposes model.index and role fields for ListModel', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  model.append({ name: 'Alice' });
  model.append({ name: 'Bob' });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const captured = [];
  const delegate = new Component(({ parent: p, context }) => {
    const m = context.lookup('model');
    captured.push({
      index:      context.lookup('index'),
      modelIndex: m && m.index,
      name:       m && m.name,
      modelData:  context.lookup('modelData'),
    });
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  assert.equal(captured.length, 2);
  assert.equal(captured[0].index, 0);
  assert.equal(captured[0].modelIndex, 0, 'model.index should be 0 for first item');
  assert.equal(captured[0].name, 'Alice', 'model.name should be Alice');
  assert.deepEqual(captured[0].modelData, { name: 'Alice' }, 'modelData should be the row object');
  assert.equal(captured[1].modelIndex, 1, 'model.index should be 1 for second item');

  lv.destroy();
});

// ---------------------------------------------------------------------------
// ListView – reuseItems property
// ---------------------------------------------------------------------------

test('ListView reuseItems defaults to false', () => {
  const { ListView } = require('../src/runtime');
  const lv = new ListView();
  assert.equal(lv.reuseItems, false);
  lv.destroy();
});

test('ListView reuseItems=false does not pool items; creation count grows on scroll', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 30; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.reuseItems = false;
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
  assert.ok(initialCreations > 0, 'should have created items initially');

  // Scroll down – items going out of view must be destroyed, not pooled
  lv.contentY = 800;
  assert.equal(lv._reusePool.length, 0, 'pool must be empty when reuseItems=false');

  // Scroll back – all new items must be freshly created
  const countBeforeScrollBack = creationCount;
  lv.contentY = 0;
  assert.equal(lv._reusePool.length, 0, 'pool must remain empty after scroll-back');
  assert.ok(
    creationCount > countBeforeScrollBack,
    'new items must be created on scroll-back when reuseItems=false',
  );

  lv.destroy();
});

test('ListView reuseItems=true pools items and fires pooled/reused signals', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 30; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.reuseItems = true;
  lv.setContext(new Context(null, {}));

  const pooledEvents = [];
  const reusedEvents = [];
  lv.connect('pooled', (item, index) => pooledEvents.push({ item, index }));
  lv.connect('reused', (item, index) => reusedEvents.push({ item, index }));

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
  assert.ok(initialCreations > 0, 'should create items on load');

  // Scroll down – items going offscreen should be pooled → pooled signal fires
  // (pooled items may be consumed immediately to fill the new visible range,
  //  so we check events rather than pool size)
  lv.contentY = 800;
  assert.ok(pooledEvents.length > 0, 'pooled signal should have fired on scroll down');
  assert.ok(reusedEvents.length > 0, 'reused signal should fire when pool items fill new range');

  // Validate reused event carries correct new index
  for (const ev of reusedEvents) {
    assert.equal(typeof ev.index, 'number', 'reused event index should be a number');
  }

  lv.destroy();
});

// ---------------------------------------------------------------------------
// ListView – attached handlers (ListView.onPooled / ListView.onReused)
// ---------------------------------------------------------------------------

test('ListView attached onPooled/onReused handlers fire with 0 args when reuseItems=true', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 30; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.reuseItems = true;
  lv.setContext(new Context(null, {}));

  const attachedPooledCalls = [];
  const attachedReusedCalls = [];

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    // Attach Qt-like handlers to the delegate item
    ListView._getAttached(item).onPooled = function () {
      attachedPooledCalls.push({ argCount: arguments.length, self: this });
    };
    ListView._getAttached(item).onReused = function () {
      attachedReusedCalls.push({ argCount: arguments.length, self: this });
    };
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // Scroll far enough to pool items and reuse them in the new visible range
  lv.contentY = 800;

  assert.ok(attachedPooledCalls.length > 0, 'attached onPooled should have fired');
  assert.ok(attachedReusedCalls.length > 0, 'attached onReused should have fired');

  // Qt parity: handlers called with 0 arguments
  for (const call of attachedPooledCalls) {
    assert.equal(call.argCount, 0, 'onPooled must be called with 0 args');
  }
  for (const call of attachedReusedCalls) {
    assert.equal(call.argCount, 0, 'onReused must be called with 0 args');
  }

  lv.destroy();
});

test('ListView attached onReused receives updated item as `this`', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 20; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 100;
  lv._delegateHeight = 40;
  lv.cacheBuffer = 0;
  lv.reuseItems = true;
  lv.setContext(new Context(null, {}));

  const reusedItems = [];

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    ListView._getAttached(item).onReused = function () {
      reusedItems.push(this);
    };
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;
  lv.contentY = 600;

  assert.ok(reusedItems.length > 0, 'onReused should have fired');
  for (const item of reusedItems) {
    assert.ok(item instanceof Item, 'onReused `this` should be the delegate Item');
  }

  lv.destroy();
});

// ---------------------------------------------------------------------------
// ListView – variable height delegates (vertical)
// ---------------------------------------------------------------------------

test('ListView variable heights: contentHeight equals sum of all delegate heights', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  const count = 10;
  for (let i = 0; i < count; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  // Make viewport large enough to show all items
  lv.height = 2000;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p, context: ctx }) => {
    const item = new Item({ parentItem: p });
    // Variable height: 30 + index * 10
    const idx = (ctx && ctx.lookup) ? (ctx.lookup('index') ?? 0) : 0;
    item.height = 30 + idx * 10;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // Expected: sum(30 + i*10 for i in 0..9) = 10*30 + 10*9/2*10 = 300 + 450 = 750
  const expectedHeight = Array.from({ length: count }, (_, i) => 30 + i * 10)
    .reduce((a, b) => a + b, 0);
  assert.equal(lv.contentHeight, expectedHeight,
    `contentHeight should be ${expectedHeight} (sum of all variable delegate heights)`);

  lv.destroy();
});

test('ListView variable heights: delegates do not overlap (y positions correct)', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  const count = 8;
  for (let i = 0; i < count; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 2000;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const sizes = [50, 80, 30, 60, 45, 70, 25, 55];
  let callIdx = 0;

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = sizes[callIdx++] ?? 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // Check that each item starts where the previous one ends
  let expectedY = 0;
  for (let i = 0; i < count; i++) {
    const item = lv.itemAt(i);
    assert.ok(item !== null, `item at index ${i} should exist`);
    assert.equal(item.y, expectedY, `item[${i}].y should be ${expectedY}`);
    expectedY += sizes[i];
  }

  lv.destroy();
});

test('ListView variable heights: scrolling shows correct visible items', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 20; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 100;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  // All items have height=50
  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 50;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // At contentY=0, items 0 and 1 are visible
  assert.ok(lv.itemAt(0) !== null, 'item 0 should be visible at contentY=0');
  assert.ok(lv.itemAt(1) !== null, 'item 1 should be visible at contentY=0');

  // Scroll to item 4 (y=200)
  lv.contentY = 200;

  // Items 0-1 should be gone (or pooled/destroyed)
  assert.ok(lv.itemAt(0) === null || !lv.itemAt(0)?.visible,
    'item 0 should not be visible after scrolling past it');
  // Items around index 4-5 should be visible
  assert.ok(lv.itemAt(4) !== null, 'item 4 should be visible at contentY=200');

  lv.destroy();
});

test('ListView dynamic height change triggers layout recompute', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 5; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 1000;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 50;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  const originalContentHeight = lv.contentHeight; // should be 5 * 50 = 250
  assert.equal(originalContentHeight, 250, 'initial contentHeight should be 250');

  // Dynamically change item 2's height
  const item2 = lv.itemAt(2);
  assert.ok(item2 !== null, 'item 2 should exist');
  item2.height = 100;  // was 50, now 100 → contentHeight should increase by 50

  assert.equal(lv.contentHeight, 300, 'contentHeight should update after delegate height change');
  // Item 3 should have shifted down by 50
  const item3 = lv.itemAt(3);
  assert.ok(item3 !== null, 'item 3 should exist');
  assert.equal(item3.y, 200, 'item 3 y should be 200 after item 2 height increase (50+50+100)');

  lv.destroy();
});

// ---------------------------------------------------------------------------
// ListView – variable width delegates (horizontal)
// ---------------------------------------------------------------------------

test('ListView horizontal orientation: contentWidth equals sum of delegate widths', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  const count = 8;
  for (let i = 0; i < count; i++) model.append({ n: i });

  const lv = new ListView();
  lv.orientation = 'horizontal';
  lv.width = 2000;
  lv.height = 100;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const widths = [60, 80, 40, 70, 50, 90, 30, 65];
  let callIdx = 0;

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.width = widths[callIdx++] ?? 50;
    item.height = 100;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  const expectedWidth = widths.reduce((a, b) => a + b, 0);
  assert.equal(lv.contentWidth, expectedWidth,
    `contentWidth should be ${expectedWidth} for horizontal ListView`);

  lv.destroy();
});

test('ListView horizontal orientation: delegates do not overlap (x positions correct)', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  const count = 6;
  for (let i = 0; i < count; i++) model.append({ n: i });

  const lv = new ListView();
  lv.orientation = 'horizontal';
  lv.width = 2000;
  lv.height = 100;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const widths = [60, 80, 40, 70, 50, 90];
  let callIdx = 0;

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.width = widths[callIdx++] ?? 50;
    item.height = 100;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  let expectedX = 0;
  for (let i = 0; i < count; i++) {
    const item = lv.itemAt(i);
    assert.ok(item !== null, `item at index ${i} should exist`);
    assert.equal(item.x, expectedX, `item[${i}].x should be ${expectedX}`);
    expectedX += widths[i];
  }

  lv.destroy();
});

test('ListView horizontal orientation: scrolling via contentX shows correct items', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 20; i++) model.append({ n: i });

  const lv = new ListView();
  lv.orientation = 'horizontal';
  lv.width = 100;
  lv.height = 100;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.width = 60;
    item.height = 100;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  assert.ok(lv.itemAt(0) !== null, 'item 0 should be visible initially');

  // Scroll to offset 300 (items 0-4 are at 0,60,120,180,240 – so item 5 starts at 300)
  lv.contentX = 300;

  assert.ok(lv.itemAt(0) === null || !lv.itemAt(0)?.visible,
    'item 0 should not be visible after scrolling past it');
  assert.ok(lv.itemAt(5) !== null, 'item 5 should be visible at contentX=300');

  lv.destroy();
});

test('ListView horizontal dynamic width change triggers layout recompute', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 4; i++) model.append({ n: i });

  const lv = new ListView();
  lv.orientation = 'horizontal';
  lv.width = 2000;
  lv.height = 100;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.width = 50;
    item.height = 100;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  assert.equal(lv.contentWidth, 200, 'initial contentWidth should be 4 * 50 = 200');

  const item1 = lv.itemAt(1);
  assert.ok(item1 !== null, 'item 1 should exist');
  item1.width = 100;  // was 50

  assert.equal(lv.contentWidth, 250, 'contentWidth should increase by 50 after width change');
  // item 2 should shift right by 50
  const item2 = lv.itemAt(2);
  assert.ok(item2 !== null, 'item 2 should exist');
  assert.equal(item2.x, 150, 'item 2 x should be 150 after item 1 width change (50+100)');

  lv.destroy();
});

// ---------------------------------------------------------------------------
// ListView – prefix-sum internal helpers
// ---------------------------------------------------------------------------

test('ListView _buildPrefixSums correctly computes offsets with variable sizes', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 5; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 2000;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const sizes = [10, 20, 30, 40, 50];
  let callIdx = 0;

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = sizes[callIdx++] ?? 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // _offsetAtIndex(i) should give cumulative start
  assert.equal(lv._offsetAtIndex(0), 0,   'offset[0] = 0');
  assert.equal(lv._offsetAtIndex(1), 10,  'offset[1] = 10');
  assert.equal(lv._offsetAtIndex(2), 30,  'offset[2] = 30');
  assert.equal(lv._offsetAtIndex(3), 60,  'offset[3] = 60');
  assert.equal(lv._offsetAtIndex(4), 100, 'offset[4] = 100');
  assert.equal(lv._totalDelegateSize(), 150, 'total delegate size = 150');

  lv.destroy();
});

test('ListView _indexAtOffset binary-search returns correct index', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 5; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 2000;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const sizes = [10, 20, 30, 40, 50];
  let callIdx = 0;

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = sizes[callIdx++] ?? 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // offsets: 0, 10, 30, 60, 100
  assert.equal(lv._indexAtOffset(0),   0, 'offset 0   → item 0');
  assert.equal(lv._indexAtOffset(5),   0, 'offset 5   → item 0');
  assert.equal(lv._indexAtOffset(10),  1, 'offset 10  → item 1');
  assert.equal(lv._indexAtOffset(29),  1, 'offset 29  → item 1');
  assert.equal(lv._indexAtOffset(30),  2, 'offset 30  → item 2');
  assert.equal(lv._indexAtOffset(60),  3, 'offset 60  → item 3');
  assert.equal(lv._indexAtOffset(100), 4, 'offset 100 → item 4');
  assert.equal(lv._indexAtOffset(149), 4, 'offset 149 → item 4');

  lv.destroy();
});

// =============================================================================
// PR-B: QtQuick.Controls parity – new controls and popup improvements
// =============================================================================

// ---------------------------------------------------------------------------
// Popup: CloseOnReleaseOutside
// ---------------------------------------------------------------------------

test('Popup CloseOnReleaseOutside constant equals 4', () => {
  const { Popup } = require('../src/runtime');
  assert.equal(Popup.CloseOnReleaseOutside, 4);
});

test('Scene.dispatchPointer CloseOnReleaseOutside closes popup on pointer up outside', () => {
  const { Item, Popup, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const popup = new Popup({ parentItem: root, closePolicy: Popup.CloseOnReleaseOutside });
  popup.x = 100; popup.y = 100;
  popup.width = 200; popup.height = 200;
  popup.open();

  const scene = new Scene({ rootItem: root });

  // pointer-down outside should NOT close (policy is release-outside, not press-outside)
  scene.dispatchPointer('down', 10, 10);
  assert.equal(popup.visible, true, 'popup should stay open after press-outside with CloseOnReleaseOutside');

  // pointer-up outside SHOULD close
  scene.dispatchPointer('up', 10, 10);
  assert.equal(popup.visible, false, 'popup should close on release-outside with CloseOnReleaseOutside');
});

test('Scene handles multiple stacked popups: topmost closes first on outside click', () => {
  const { Item, Popup, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const popup1 = new Popup({ parentItem: root, closePolicy: Popup.CloseOnPressOutside });
  popup1.x = 50; popup1.y = 50; popup1.width = 100; popup1.height = 100; popup1.z = 1000;
  popup1.open();

  const popup2 = new Popup({ parentItem: root, closePolicy: Popup.CloseOnPressOutside });
  popup2.x = 200; popup2.y = 200; popup2.width = 100; popup2.height = 100; popup2.z = 1001;
  popup2.open();

  const scene = new Scene({ rootItem: root });

  // Click outside both – topmost (popup2) should close first
  scene.dispatchPointer('down', 10, 10);
  assert.equal(popup2.visible, false, 'topmost popup should close on outside click');
  assert.equal(popup1.visible, true,  'lower popup should remain open');
});

// ---------------------------------------------------------------------------
// Menu: keyboard navigation
// ---------------------------------------------------------------------------

test('Menu.handleKeyEvent ArrowDown moves to first item', () => {
  const { Menu, MenuItem } = require('../src/runtime');

  const menu = new Menu();
  menu.width = 160;
  const item1 = new MenuItem({ parentItem: menu, text: 'Cut'  });
  const item2 = new MenuItem({ parentItem: menu, text: 'Copy' });
  menu.open();

  assert.equal(menu._currentIndex, -1, 'starts with no selection');
  menu.handleKeyEvent({ key: 'ArrowDown' });
  assert.equal(menu._currentIndex, 0, 'ArrowDown should select first item');
  menu.handleKeyEvent({ key: 'ArrowDown' });
  assert.equal(menu._currentIndex, 1, 'ArrowDown again should select second item');
});

test('Menu.handleKeyEvent ArrowUp navigates backward', () => {
  const { Menu, MenuItem } = require('../src/runtime');

  const menu = new Menu();
  menu.width = 160;
  new MenuItem({ parentItem: menu, text: 'Cut'   });
  new MenuItem({ parentItem: menu, text: 'Copy'  });
  new MenuItem({ parentItem: menu, text: 'Paste' });
  menu.open();

  menu.handleKeyEvent({ key: 'ArrowDown' });
  menu.handleKeyEvent({ key: 'ArrowDown' });
  assert.equal(menu._currentIndex, 1);
  menu.handleKeyEvent({ key: 'ArrowUp' });
  assert.equal(menu._currentIndex, 0, 'ArrowUp should move back');
});

test('Menu.handleKeyEvent Enter triggers focused item and closes menu', () => {
  const { Menu, MenuItem } = require('../src/runtime');

  const menu = new Menu();
  menu.width = 160;
  const item = new MenuItem({ parentItem: menu, text: 'Cut' });
  menu.open();

  let triggered = false;
  item.triggered.connect(() => { triggered = true; });

  menu.handleKeyEvent({ key: 'ArrowDown' }); // select item 0
  menu.handleKeyEvent({ key: 'Enter' });

  assert.equal(triggered, true,          'Enter should trigger focused item');
  assert.equal(menu.visible, false,      'menu should close after Enter');
});

test('Scene.dispatchKey routes arrow keys to open Menu', () => {
  const { Item, Menu, MenuItem, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const menu = new Menu({ parentItem: root });
  menu.x = 10; menu.y = 10; menu.width = 160;
  const mi1 = new MenuItem({ parentItem: menu, text: 'Alpha' });
  const mi2 = new MenuItem({ parentItem: menu, text: 'Beta'  });
  menu.open();

  const scene = new Scene({ rootItem: root });
  const btn = new Item({ parentItem: root });
  btn.activeFocusOnTab = true; btn.focusable = true;
  scene.forceActiveFocus(btn);

  scene.dispatchKey('pressed', { key: 'ArrowDown', code: 'ArrowDown', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(menu._currentIndex, 0, 'ArrowDown via Scene should focus first menu item');
});

test('Menu.open() resets _currentIndex to -1', () => {
  const { Menu, MenuItem } = require('../src/runtime');
  const menu = new Menu();
  new MenuItem({ parentItem: menu, text: 'A' });
  menu.open();
  menu.handleKeyEvent({ key: 'ArrowDown' });
  assert.equal(menu._currentIndex, 0);
  menu.close();
  assert.equal(menu._currentIndex, -1, 'close() should reset _currentIndex');
  menu.open();
  assert.equal(menu._currentIndex, -1, 'open() should reset _currentIndex');
});

// ---------------------------------------------------------------------------
// ComboBox
// ---------------------------------------------------------------------------

test('ComboBox defaults: currentIndex=0, model=[]', () => {
  const { ComboBox } = require('../src/runtime');
  const cb = new ComboBox();
  assert.equal(cb.currentIndex, 0);
  assert.deepEqual(cb.model, []);
});

test('ComboBox.currentText reflects model[currentIndex]', () => {
  const { ComboBox } = require('../src/runtime');
  const cb = new ComboBox({ model: ['Red', 'Green', 'Blue'], currentIndex: 1 });
  assert.equal(cb.currentText, 'Green');
});

test('ComboBox._getModelItems handles array model', () => {
  const { ComboBox } = require('../src/runtime');
  const cb = new ComboBox({ model: ['A', 'B', 'C'] });
  assert.deepEqual(cb._getModelItems(), ['A', 'B', 'C']);
});

test('ComboBox._getModelItems handles numeric model', () => {
  const { ComboBox } = require('../src/runtime');
  const cb = new ComboBox({ model: 3 });
  assert.deepEqual(cb._getModelItems(), ['0', '1', '2']);
});

test('ComboBox emits activated and currentIndexChanged on _selectIndex', () => {
  const { ComboBox } = require('../src/runtime');
  const cb = new ComboBox({ model: ['X', 'Y', 'Z'], currentIndex: 0 });

  const events = [];
  cb.activated.connect((idx) => events.push({ e: 'activated', idx }));
  cb.currentIndexChanged.connect(() => events.push({ e: 'changed', idx: cb.currentIndex }));

  cb._openDropdown();
  cb._selectIndex(2);

  assert.ok(events.some(e => e.e === 'activated' && e.idx === 2), 'activated(2) should fire');
  assert.ok(events.some(e => e.e === 'changed'), 'currentIndexChanged should fire');
  assert.equal(cb.currentIndex, 2);
  assert.equal(cb._dropdownOpen, false, 'dropdown should close after selection');
});

test('ComboBox._openDropdown / _closeDropdown toggles state and z', () => {
  const { ComboBox } = require('../src/runtime');
  const cb = new ComboBox({ model: ['A', 'B'] });
  const origZ = cb.z;

  cb._openDropdown();
  assert.equal(cb._dropdownOpen, true);
  assert.ok(cb.z > origZ, 'z should be elevated while dropdown is open');

  cb._closeDropdown();
  assert.equal(cb._dropdownOpen, false);
  assert.equal(cb.z, origZ, 'z should return to original after close');
});

test('ComboBox.containsPoint includes dropdown area when open', () => {
  const { Item, ComboBox } = require('../src/runtime');
  const root = new Item();
  root.width = 400; root.height = 400;

  const cb = new ComboBox({ parentItem: root, model: ['A', 'B', 'C'] });
  cb.x = 50; cb.y = 50; cb.width = 120; cb.height = 36;

  // Closed – point below button should not hit
  assert.equal(cb.containsPoint(110, 100), false, 'below button should not hit when closed');

  cb._openDropdown();
  // Open – point in dropdown area should hit
  assert.equal(cb.containsPoint(110, 100), true, 'dropdown area should be hit-testable when open');
});

test('ComboBox pointer: down then up opens dropdown', () => {
  const { Item, ComboBox, Scene } = require('../src/runtime');
  const root = new Item();
  root.width = 400; root.height = 400;

  const cb = new ComboBox({ parentItem: root, model: ['One', 'Two'] });
  cb.x = 10; cb.y = 10; cb.width = 120; cb.height = 36;

  const scene = new Scene({ rootItem: root });
  scene.dispatchPointer('down', 70, 28);
  scene.dispatchPointer('up',   70, 28);

  assert.equal(cb._dropdownOpen, true, 'dropdown should open after press+release on button');
});

test('ComboBox Scene: outside click closes dropdown', () => {
  const { Item, ComboBox, Scene } = require('../src/runtime');
  const root = new Item();
  root.width = 400; root.height = 400;

  const cb = new ComboBox({ parentItem: root, model: ['One', 'Two', 'Three'] });
  cb.x = 10; cb.y = 10; cb.width = 120; cb.height = 36;

  const scene = new Scene({ rootItem: root });

  // Open the dropdown
  cb._openDropdown();
  assert.equal(cb._dropdownOpen, true);

  // Click outside
  scene.dispatchPointer('down', 300, 300);
  assert.equal(cb._dropdownOpen, false, 'dropdown should close on outside click');
});

test('ComboBox keyboard: ArrowDown opens dropdown', () => {
  const { Item, ComboBox, Scene } = require('../src/runtime');
  const root = new Item();
  root.width = 400; root.height = 400;

  const cb = new ComboBox({ parentItem: root, model: ['A', 'B', 'C'] });
  cb.x = 10; cb.y = 10; cb.width = 120; cb.height = 36;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(cb);

  scene.dispatchKey('pressed', { key: 'ArrowDown', code: 'ArrowDown', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(cb._dropdownOpen, true, 'ArrowDown should open ComboBox dropdown');
});

// ---------------------------------------------------------------------------
// ToolTip
// ---------------------------------------------------------------------------

test('ToolTip defaults to hidden with text property', () => {
  const { ToolTip } = require('../src/runtime');
  const tt = new ToolTip({ text: 'Hello' });
  assert.equal(tt.visible, false);
  assert.equal(tt.text, 'Hello');
});

test('ToolTip.open() makes tooltip visible', () => {
  const { ToolTip } = require('../src/runtime');
  const tt = new ToolTip({ text: 'Tip', timeout: 0 });
  tt.open();
  assert.equal(tt.visible, true);
  tt.close();
});

test('ToolTip.close() hides tooltip and cancels timers', () => {
  const { ToolTip } = require('../src/runtime');
  const tt = new ToolTip({ text: 'Tip', timeout: 0 });
  tt.open();
  tt.close();
  assert.equal(tt.visible, false);
});

test('ToolTip has high z (above regular popups)', () => {
  const { ToolTip } = require('../src/runtime');
  const { Popup } = require('../src/runtime');
  const tt = new ToolTip();
  const p  = new Popup();
  assert.ok(tt.z > p.z, 'ToolTip z should be higher than regular Popup z');
});

test('ToolTip.show() static creates/shows shared instance', () => {
  const { ToolTip } = require('../src/runtime');
  ToolTip._shared = null; // reset
  const tt = ToolTip.show('Quick tip', 0);
  assert.ok(tt instanceof ToolTip);
  assert.equal(tt.visible, true);
  assert.equal(tt.text, 'Quick tip');
  ToolTip.hide();
  assert.equal(tt.visible, false);
});

test('ToolTip is a Popup subclass (CloseOnEscape works)', () => {
  const { Item, ToolTip, Scene } = require('../src/runtime');
  const root = new Item();
  root.width = 400; root.height = 400;

  const tt = new ToolTip({ parentItem: root, text: 'Press Escape', timeout: 0 });
  tt.open();

  const scene = new Scene({ rootItem: root });
  const focusItem = new Item({ parentItem: root });
  focusItem.activeFocusOnTab = true; focusItem.focusable = true;
  scene.forceActiveFocus(focusItem);

  scene.dispatchKey('pressed', { key: 'Escape', code: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(tt.visible, false, 'Escape should close ToolTip');
});

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

test('Drawer defaults to hidden with edge=Qt.LeftEdge', () => {
  const { Drawer, Qt } = require('../src/runtime');
  const d = new Drawer({ width: 200 });
  assert.equal(d.visible,  false);
  assert.equal(d.edge,     Qt.LeftEdge);
  assert.equal(d.position, 0);
});

test('Drawer.open() makes visible and sets position=1.0', () => {
  const { Drawer } = require('../src/runtime');
  const d = new Drawer({ width: 200 });
  d.open();
  assert.equal(d.visible,  true);
  assert.equal(d.position, 1.0);
});

test('Drawer.close() hides and resets position=0', () => {
  const { Drawer } = require('../src/runtime');
  const d = new Drawer({ width: 200 });
  d.open();
  d.close();
  assert.equal(d.visible,  false);
  assert.equal(d.position, 0);
});

test('Drawer emits opened/closed signals', () => {
  const { Drawer } = require('../src/runtime');
  const d = new Drawer({ width: 200 });
  const log = [];
  d.opened.connect(() => log.push('opened'));
  d.closed.connect(() => log.push('closed'));
  d.open();
  d.close();
  assert.deepEqual(log, ['opened', 'closed']);
});

test('Drawer is modal by default', () => {
  const { Drawer } = require('../src/runtime');
  const d = new Drawer({ width: 200 });
  assert.equal(d.modal, true);
});

test('Drawer.containsScenePoint respects position and edge', () => {
  const { Item, Drawer, Qt } = require('../src/runtime');
  const root = new Item();
  root.width = 400; root.height = 300;

  const d = new Drawer({ parentItem: root, edge: Qt.LeftEdge, width: 200 });
  d.open(); // position = 1.0

  // Left edge drawer with position=1 should cover (0,0) to (200, 300)
  assert.equal(d.containsScenePoint(100, 150), true,  'inside left drawer panel');
  assert.equal(d.containsScenePoint(250, 150), false, 'outside left drawer panel');
});

test('Qt edge constants are correct', () => {
  const { Qt } = require('../src/runtime');
  assert.equal(Qt.LeftEdge,   1);
  assert.equal(Qt.RightEdge,  2);
  assert.equal(Qt.TopEdge,    4);
  assert.equal(Qt.BottomEdge, 8);
});

// ---------------------------------------------------------------------------
// SpinBox
// ---------------------------------------------------------------------------

test('SpinBox defaults: value=0, from=0, to=100, stepSize=1', () => {
  const { SpinBox } = require('../src/runtime');
  const sb = new SpinBox();
  assert.equal(sb.value,    0);
  assert.equal(sb.from,     0);
  assert.equal(sb.to,       100);
  assert.equal(sb.stepSize, 1);
});

test('SpinBox._increment increases value by stepSize', () => {
  const { SpinBox } = require('../src/runtime');
  const sb = new SpinBox({ value: 5, stepSize: 2 });
  sb._increment();
  assert.equal(sb.value, 7);
});

test('SpinBox._decrement decreases value by stepSize', () => {
  const { SpinBox } = require('../src/runtime');
  const sb = new SpinBox({ value: 5, stepSize: 2 });
  sb._decrement();
  assert.equal(sb.value, 3);
});

test('SpinBox._increment clamps to to', () => {
  const { SpinBox } = require('../src/runtime');
  const sb = new SpinBox({ value: 99, to: 100 });
  sb._increment();
  assert.equal(sb.value, 100);
  sb._increment(); // no-op at max
  assert.equal(sb.value, 100);
});

test('SpinBox._decrement clamps to from', () => {
  const { SpinBox } = require('../src/runtime');
  const sb = new SpinBox({ value: 1, from: 0 });
  sb._decrement();
  assert.equal(sb.value, 0);
  sb._decrement(); // no-op at min
  assert.equal(sb.value, 0);
});

test('SpinBox emits valueChanged signal', () => {
  const { SpinBox } = require('../src/runtime');
  const sb = new SpinBox({ value: 10 });
  let count = 0;
  sb.valueChanged.connect(() => count++);
  sb._increment();
  sb._decrement();
  assert.equal(count, 2);
});

test('SpinBox keyboard ArrowUp/Down change value', () => {
  const { Item, SpinBox, Scene } = require('../src/runtime');
  const root = new Item();
  root.width = 300; root.height = 100;

  const sb = new SpinBox({ parentItem: root, value: 50, stepSize: 5 });
  sb.x = 10; sb.y = 10; sb.width = 120; sb.height = 36;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(sb);

  scene.dispatchKey('pressed', { key: 'ArrowUp', code: 'ArrowUp', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(sb.value, 55, 'ArrowUp should increment');

  scene.dispatchKey('pressed', { key: 'ArrowDown', code: 'ArrowDown', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(sb.value, 50, 'ArrowDown should decrement');
});

// ---------------------------------------------------------------------------
// TextArea
// ---------------------------------------------------------------------------

test('TextArea defaults', () => {
  const { TextArea } = require('../src/runtime');
  const ta = new TextArea();
  assert.equal(ta.text,            '');
  assert.equal(ta.placeholderText, '');
  assert.equal(ta.readOnly,        false);
  assert.equal(ta.wrapMode,        TextArea.Wrap);
});

test('TextArea wrapMode constants', () => {
  const { TextArea } = require('../src/runtime');
  assert.equal(TextArea.NoWrap,     0);
  assert.equal(TextArea.Wrap,       1);
  assert.equal(TextArea.WordWrap,   2);
  assert.equal(TextArea.WrapAnywhere, 3);
});

test('TextArea typing via keyboard when focused', () => {
  const { Item, TextArea, Scene } = require('../src/runtime');
  const root = new Item();
  root.width = 300; root.height = 200;

  const ta = new TextArea({ parentItem: root, text: '' });
  ta.x = 10; ta.y = 10; ta.width = 200; ta.height = 80;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(ta);

  scene.dispatchKey('pressed', { key: 'a', code: 'KeyA', text: 'a', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(ta.text, 'a', 'typing "a" should append to text');

  scene.dispatchKey('pressed', { key: 'b', code: 'KeyB', text: 'b', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(ta.text, 'ab');

  scene.dispatchKey('pressed', { key: 'Backspace', code: 'Backspace', text: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(ta.text, 'a', 'Backspace should remove last character');
});

test('TextArea readOnly prevents editing', () => {
  const { Item, TextArea, Scene } = require('../src/runtime');
  const root = new Item();
  root.width = 300; root.height = 200;

  const ta = new TextArea({ parentItem: root, text: 'fixed', readOnly: true });
  ta.x = 10; ta.y = 10; ta.width = 200; ta.height = 80;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(ta);

  scene.dispatchKey('pressed', { key: 'x', code: 'KeyX', text: 'x', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  assert.equal(ta.text, 'fixed', 'readOnly TextArea should not change text');
});

test('TextArea is focusable', () => {
  const { TextArea } = require('../src/runtime');
  const ta = new TextArea();
  assert.equal(ta.activeFocusOnTab, true);
  assert.equal(ta.focusable,        true);
});

// ---------------------------------------------------------------------------
// PR-C: Loader enhancements
// ---------------------------------------------------------------------------

test('Loader status transitions: Null -> Loading -> Ready', () => {
  const { Item, Component, Loader } = require('../src/runtime');
  const host = new Item();

  const comp = new Component(({ parent }) => {
    return new Item({ parentItem: parent });
  });

  const loader = new Loader({ parentItem: host, active: false });
  assert.equal(loader.status, Loader.Null, 'inactive loader should be Null');

  loader.sourceComponent = comp;
  loader.active = true;
  assert.equal(loader.status, Loader.Ready, 'after load status should be Ready');
  assert.equal(loader.progress, 1.0, 'progress should be 1.0 when ready');
  assert.ok(loader.item instanceof Item, 'item should be an Item');
});

test('Loader unloads when active set to false: status returns to Null', () => {
  const { Item, Component, Loader } = require('../src/runtime');
  const host = new Item();

  const comp = new Component(({ parent }) => new Item({ parentItem: parent }));
  const loader = new Loader({ parentItem: host, sourceComponent: comp });
  assert.equal(loader.status, Loader.Ready);

  loader.active = false;
  assert.equal(loader.status, Loader.Null);
  assert.equal(loader.item, null);
  assert.equal(loader.progress, 0);
});

test('Loader emits loaded signal when item created', () => {
  const { Item, Component, Loader } = require('../src/runtime');
  const host = new Item();

  const comp = new Component(({ parent }) => new Item({ parentItem: parent }));
  let loadedCalled = 0;

  const loader = new Loader({ parentItem: host, active: false });
  loader.loaded.connect(() => { loadedCalled += 1; });

  loader.sourceComponent = comp;
  loader.active = true;
  assert.equal(loadedCalled, 1, 'loaded signal should fire once');
});

test('Loader.item is parented to Loader', () => {
  const { Item, Component, Loader } = require('../src/runtime');
  const host = new Item();

  const comp = new Component(({ parent }) => new Item({ parentItem: parent }));
  const loader = new Loader({ parentItem: host, sourceComponent: comp });

  assert.ok(loader.item instanceof Item);
  assert.equal(loader.item.parentItem, loader, 'item parentItem should be the Loader');
});

test('Loader.source resolves via Qt.registerComponent', () => {
  const { Item, Component, Loader, Qt } = require('../src/runtime');
  const host = new Item();

  Qt.registerComponent('mycomp://page', ({ parent }) => new Item({ parentItem: parent }));

  const loader = new Loader({ parentItem: host, source: 'mycomp://page' });
  assert.equal(loader.status, Loader.Ready, 'source-loaded Loader should be Ready');
  assert.ok(loader.item instanceof Item);
});

// ---------------------------------------------------------------------------
// PR-C: Timer tests
// ---------------------------------------------------------------------------

test('Timer defaults: interval=1000, repeat=false, running=false', () => {
  const { Timer } = require('../src/runtime');
  const t = new Timer();
  assert.equal(t.interval, 1000);
  assert.equal(t.repeat,   false);
  assert.equal(t.running,  false);
  assert.equal(t.triggeredOnStart, false);
  t.destroy();
});

test('Timer fires triggered via manual ticker advance', () => {
  const { Timer, AnimationTicker } = require('../src/runtime');

  const ticker = new AnimationTicker();
  // Patch _globalTicker temporarily
  const runtime = require('../src/runtime');
  const originalAdd    = runtime._globalTicker ? runtime._globalTicker.add.bind(runtime._globalTicker) : null;

  // We'll drive the timer manually by calling _tickerObj._tick directly.
  const t = new Timer({ interval: 100, repeat: false });

  let fired = 0;
  t.triggered.connect(() => { fired += 1; });

  t.start();
  assert.equal(t.running, true);

  // Manually tick to simulate time passing
  assert.ok(t._tickerObj, 'tickerObj should exist when running');
  t._tickerObj._tick(50);  // not yet
  assert.equal(fired, 0);
  t._tickerObj._tick(60);  // total 110ms >= 100ms
  assert.equal(fired, 1);
  assert.equal(t.running, false, 'non-repeat timer stops after firing');

  t.destroy();
});

test('Timer repeats when repeat=true', () => {
  const { Timer } = require('../src/runtime');
  const t = new Timer({ interval: 50, repeat: true });

  let fired = 0;
  t.triggered.connect(() => { fired += 1; });
  t.start();

  t._tickerObj._tick(60);   // 1st fire
  t._tickerObj._tick(60);   // 2nd fire
  assert.equal(fired, 2);
  assert.equal(t.running, true, 'repeating timer keeps running');

  t.stop();
  assert.equal(t.running, false);
  t.destroy();
});

test('Timer triggeredOnStart fires immediately', () => {
  const { Timer } = require('../src/runtime');
  let fired = 0;
  const t = new Timer({ interval: 1000, repeat: false, triggeredOnStart: true });
  t.triggered.connect(() => { fired += 1; });
  t.start();
  assert.equal(fired, 1, 'triggeredOnStart should fire immediately on start');
  // After immediate fire with repeat=false, timer should stop
  assert.equal(t.running, false);
  t.destroy();
});

test('Timer restart resets elapsed', () => {
  const { Timer } = require('../src/runtime');
  const t = new Timer({ interval: 100 });
  let fired = 0;
  t.triggered.connect(() => { fired += 1; });
  t.start();
  t._tickerObj._tick(80);
  t.restart();
  // After restart, _tickerObj is replaced – capture the new one
  const ticker = t._tickerObj;
  ticker._tick(30);  // should not fire yet (only 30ms since restart)
  assert.equal(fired, 0, 'should not have fired after restart with insufficient elapsed');
  ticker._tick(80);  // 110ms total since restart
  assert.equal(fired, 1);
  t.destroy();
});

// ---------------------------------------------------------------------------
// PR-C: Connections tests
// ---------------------------------------------------------------------------

test('Connections wires onSomeSignal to target signal', () => {
  const { QObject, Connections } = require('../src/runtime');

  const emitter = new QObject();
  emitter.defineSignal('clicked');

  let clickCount = 0;
  const conn = new Connections({
    target: emitter,
    onClicked: () => { clickCount += 1; },
  });

  emitter.clicked.emit();
  assert.equal(clickCount, 1);

  emitter.clicked.emit();
  assert.equal(clickCount, 2);

  conn.destroy();
});

test('Connections enabled=false suppresses handler', () => {
  const { QObject, Connections } = require('../src/runtime');

  const emitter = new QObject();
  emitter.defineSignal('tapped');

  let count = 0;
  const conn = new Connections({ target: emitter, enabled: false, onTapped: () => { count += 1; } });

  emitter.tapped.emit();
  assert.equal(count, 0, 'disabled Connections should not forward signals');

  conn.enabled = true;
  emitter.tapped.emit();
  assert.equal(count, 1, 're-enabled Connections should forward signals');

  conn.destroy();
});

test('Connections supports dynamic target switch', () => {
  const { QObject, Connections } = require('../src/runtime');

  const a = new QObject();
  a.defineSignal('fired');
  const b = new QObject();
  b.defineSignal('fired');

  let log = [];
  const conn = new Connections({
    target: a,
    onFired: () => { log.push('a'); },
  });

  a.fired.emit();
  assert.deepEqual(log, ['a']);

  // Switch target to b and update handler
  conn.setHandler('onFired', () => { log.push('b'); });
  conn.target = b;

  b.fired.emit();
  assert.deepEqual(log, ['a', 'b']);

  // Old target no longer fires handler
  a.fired.emit();
  assert.deepEqual(log, ['a', 'b'], 'old target should not trigger after switch');

  conn.destroy();
});

test('Connections.setHandler registers new handler', () => {
  const { QObject, Connections } = require('../src/runtime');

  const emitter = new QObject();
  emitter.defineSignal('valueChanged');

  let values = [];
  const conn = new Connections({ target: emitter });
  conn.setHandler('onValueChanged', (v) => { values.push(v); });

  emitter.valueChanged.emit(42);
  assert.deepEqual(values, [42]);

  conn.destroy();
});

// ---------------------------------------------------------------------------
// PR-C: BindingElement tests
// ---------------------------------------------------------------------------

// Step C: Loader enhancements
// ---------------------------------------------------------------------------

test('Loader has status constants', () => {
  const { Loader } = require('../src/runtime');
  assert.equal(Loader.Null,    0);
  assert.equal(Loader.Ready,   1);
  assert.equal(Loader.Loading, 2);
  assert.equal(Loader.Error,   3);
});

test('Loader starts with Null status and zero progress', () => {
  const { Loader } = require('../src/runtime');
  const loader = new Loader();
  assert.equal(loader.status,   Loader.Null);
  assert.equal(loader.progress, 0);
  assert.equal(loader.item,     null);
});

test('Loader sets Ready status and progress=1 after loading a sourceComponent', () => {
  const { Item, Component, Loader } = require('../src/runtime');
  const comp = new Component(({ parent }) => {
    return new Item({ parentItem: parent });
  });
  const host = new Item();
  const loader = new Loader({ parentItem: host, sourceComponent: comp });
  assert.equal(loader.status,   Loader.Ready);
  assert.equal(loader.progress, 1);
  assert.ok(loader.item instanceof Item);
});

test('Loader sets Null status when active=false', () => {
  const { Item, Component, Loader } = require('../src/runtime');
  const comp = new Component(({ parent }) => new Item({ parentItem: parent }));
  const host = new Item();
  const loader = new Loader({ parentItem: host, sourceComponent: comp });
  assert.equal(loader.status, Loader.Ready);
  loader.active = false;
  assert.equal(loader.status,   Loader.Null);
  assert.equal(loader.progress, 0);
  assert.equal(loader.item,     null);
});

test('Loader emits loaded signal when item is created', () => {
  const { Item, Component, Loader } = require('../src/runtime');
  const comp = new Component(({ parent }) => new Item({ parentItem: parent }));
  const host = new Item();
  const loader = new Loader({ parentItem: host, active: false });

  let fired = false;
  loader.loaded.connect(() => { fired = true; });

  loader.sourceComponent = comp;
  loader.active = true;
  assert.equal(fired, true);
});

test('Loader item is parented to the Loader itself', () => {
  const { Item, Component, Loader } = require('../src/runtime');
  const comp = new Component(({ parent }) => new Item({ parentItem: parent }));
  const host = new Item();
  const loader = new Loader({ parentItem: host, sourceComponent: comp });
  assert.equal(loader.item.parentItem, loader, 'loaded item should be a child of Loader');
});

test('Loader source property exists and defaults to empty string', () => {
  const { Loader } = require('../src/runtime');
  const loader = new Loader();
  assert.equal(loader.source, '');
});

test('Loader.source with Qt.registerComponent loads synchronously', () => {
  const { Item, Component, Loader, Qt } = require('../src/runtime');
  const url = 'test://MyPage.qml';
  const comp = new Component(({ parent }) => new Item({ parentItem: parent }));
  Qt.registerComponent(url, comp);

  const host = new Item();
  const loader = new Loader({ parentItem: host, source: url });
  assert.equal(loader.status,   Loader.Ready);
  assert.ok(loader.item instanceof Item, 'item should be loaded from source URL');

  // Cleanup registry
  Qt._componentRegistry.delete(url);
});

test('Loader sets Error status when source is set but component not found', () => {
  const { Loader } = require('../src/runtime');
  const loader = new Loader({ source: 'nonexistent://Unknown.qml' });
  assert.equal(loader.status, Loader.Error);
});

// ---------------------------------------------------------------------------
// Step C: Timer
// ---------------------------------------------------------------------------

test('Timer has correct default properties', () => {
  const { Timer } = require('../src/runtime');
  const t = new Timer();
  assert.equal(t.interval,         1000);
  assert.equal(t.repeat,           false);
  assert.equal(t.running,          false);
  assert.equal(t.triggeredOnStart, false);
});

test('Timer emits triggered signal after interval', () => {
  const { Timer, AnimationTicker } = require('../src/runtime');
  const ticker = new AnimationTicker();
  const t = new Timer({ interval: 100, repeat: false, ticker });

  let count = 0;
  t.triggered.connect(() => { count++; });

  t.start();
  ticker.advance(50);
  assert.equal(count, 0, 'should not fire before interval');

  ticker.advance(60);
  assert.equal(count, 1, 'should fire once after interval');
  assert.equal(t.running, false, 'non-repeat timer stops after firing');
});

test('Timer repeat fires multiple times', () => {
  const { Timer, AnimationTicker } = require('../src/runtime');
  const ticker = new AnimationTicker();
  const t = new Timer({ interval: 100, repeat: true, ticker });

  let count = 0;
  t.triggered.connect(() => { count++; });

  t.start();
  ticker.advance(110);
  assert.equal(count, 1);

  ticker.advance(110);
  assert.equal(count, 2);

  t.stop();
  assert.equal(t.running, false);
});

test('Timer triggeredOnStart fires immediately when started', () => {
  const { Timer, AnimationTicker } = require('../src/runtime');
  const ticker = new AnimationTicker();
  const t = new Timer({ interval: 500, repeat: false, triggeredOnStart: true, ticker });

  let count = 0;
  t.triggered.connect(() => { count++; });

  t.start();
  assert.equal(count, 1, 'should fire once on start');
});

test('Timer onTriggered callback is called', () => {
  const { Timer, AnimationTicker } = require('../src/runtime');
  const ticker = new AnimationTicker();
  const t = new Timer({ interval: 10, repeat: false, ticker });

  let called = false;
  t.onTriggered = () => { called = true; };

  t.start();
  ticker.advance(20);
  assert.equal(called, true);
});

test('Timer restart resets elapsed time', () => {
  const { Timer, AnimationTicker } = require('../src/runtime');
  const ticker = new AnimationTicker();
  const t = new Timer({ interval: 100, repeat: false, ticker });

  let count = 0;
  t.triggered.connect(() => { count++; });

  t.start();
  ticker.advance(80);
  t.restart();        // reset elapsed to 0
  ticker.advance(80); // only 80ms since restart – should not fire
  assert.equal(count, 0, 'should not fire if restarted before interval');

  ticker.advance(30); // now 110ms since restart – should fire
  assert.equal(count, 1);
});

// ---------------------------------------------------------------------------
// Step C: Connections
// ---------------------------------------------------------------------------

test('Connections target property defaults to null', () => {
  const { Connections } = require('../src/runtime');
  const conn = new Connections();
  assert.equal(conn.target,  null);
  assert.equal(conn.enabled, true);
});

test('Connections forwards signal from target', () => {
  const { QObject, Connections } = require('../src/runtime');
  const target = new QObject();
  target.defineSignal('pinged');

  const conn = new Connections({ target });
  const received = [];
  conn.connect('pinged', (val) => received.push(val));

  target.pinged.emit('hello');
  assert.deepEqual(received, ['hello']);
});

test('Connections reconnects when target changes', () => {
  const { QObject, Connections } = require('../src/runtime');
  const t1 = new QObject();
  t1.defineSignal('fired');

  const t2 = new QObject();
  t2.defineSignal('fired');

  const conn = new Connections({ target: t1 });
  const received = [];
  conn.connect('fired', (v) => received.push(v));

  t1.fired.emit('from-t1');
  assert.deepEqual(received, ['from-t1']);

  conn.target = t2;
  t1.fired.emit('from-t1-again'); // should not reach conn
  t2.fired.emit('from-t2');
  assert.deepEqual(received, ['from-t1', 'from-t2']);
});

test('Connections enabled=false stops forwarding', () => {
  const { QObject, Connections } = require('../src/runtime');
  const target = new QObject();
  target.defineSignal('poke');

  const conn = new Connections({ target });
  const log = [];
  conn.connect('poke', () => log.push('poke'));

  target.poke.emit();
  assert.deepEqual(log, ['poke']);

  conn.enabled = false;
  target.poke.emit();
  assert.deepEqual(log, ['poke'], 'disabled – should not receive');

  conn.enabled = true;
  target.poke.emit();
  assert.deepEqual(log, ['poke', 'poke'], 're-enabled – should receive again');
});

test('Connections destroy disconnects handlers', () => {
  const { QObject, Connections } = require('../src/runtime');
  const target = new QObject();
  target.defineSignal('tick');

  const conn = new Connections({ target });
  const log = [];
  conn.connect('tick', () => log.push('tick'));

  target.tick.emit();
  assert.deepEqual(log, ['tick']);

  conn.destroy();
  target.tick.emit();
  assert.deepEqual(log, ['tick'], 'after destroy – no more events');
});

// ---------------------------------------------------------------------------
// Step C: BindingElement
// ---------------------------------------------------------------------------

test('BindingElement applies value to target property when when=true', () => {
  const { QObject, BindingElement } = require('../src/runtime');

  const target = new QObject();
  target.defineProperty('x', 0);

  const be = new BindingElement({ target, property: 'x', value: 42 });
  assert.equal(target.x, 42, 'BindingElement should apply value immediately');

  be.destroy();
});

test('BindingElement deactivates and restores when when=false', () => {
  const { QObject, BindingElement } = require('../src/runtime');

  const target = new QObject();
  target.defineProperty('count', 10);

  const be = new BindingElement({
    target,
    property: 'count',
    value: 99,
    restoreMode: BindingElement.RestorePreviousValue,
  });
  assert.equal(target.count, 99);

  be.when = false;
  assert.equal(target.count, 10, 'should restore previous value when deactivated');

  be.destroy();
});

test('BindingElement does not apply when when=false', () => {
  const { QObject, BindingElement } = require('../src/runtime');
  const target = new QObject();
  target.defineProperty('x', 10);

  const be = new BindingElement({ target, property: 'x', value: 99, when: false });
  assert.equal(target.x, 10, 'value should not be applied when when=false');
  be.destroy();
});

test('BindingElement activates when when changes to true', () => {
  const { QObject, BindingElement } = require('../src/runtime');
  const target = new QObject();
  target.defineProperty('label', 'original');

  const be = new BindingElement({ target, property: 'label', value: 'overridden', when: false });
  assert.equal(target.label, 'original', 'value should not be applied when when=false');

  be.when = true;
  assert.equal(target.label, 'overridden');
  be.destroy();
});

test('BindingElement restores saved value when when changes back to false', () => {
  const { QObject, BindingElement } = require('../src/runtime');
  const target = new QObject();
  target.defineProperty('opacity', 1);

  const be = new BindingElement({ target, property: 'opacity', value: 0.5, when: true });
  assert.equal(target.opacity, 0.5);

  be.when = false;
  assert.equal(target.opacity, 1, 'should restore saved value');
  be.destroy();
});

test('BindingElement updates target when value changes while active', () => {
  const { QObject, BindingElement } = require('../src/runtime');
  const target = new QObject();
  target.defineProperty('count', 0);

  const be = new BindingElement({ target, property: 'count', value: 5, when: true });
  assert.equal(target.count, 5);

  be.value = 10;
  assert.equal(target.count, 10);
  be.destroy();
});

// ---------------------------------------------------------------------------
// PR-C: Qt.createComponent / Qt.createQmlObject tests
// ---------------------------------------------------------------------------

test('Qt.createComponent returns Component for registered URL', () => {
  const { Qt, QObject, Item, Component } = require('../src/runtime');

  Qt.registerComponent('test://mypage', ({ parent }) => {
    const item = new Item({ parentItem: parent });
    item.defineProperty('pageId', 'mypage');
    return item;
  });

  const comp = Qt.createComponent('test://mypage');
  assert.ok(comp instanceof Component, 'createComponent should return a Component');

  const host = new Item();
  const instance = comp.createObject(host);
  assert.ok(instance instanceof Item);
  assert.equal(instance.pageId, 'mypage');
});

test('Qt.createComponent returns stub for unknown URL', () => {
  const { Qt, Component } = require('../src/runtime');

  const comp = Qt.createComponent('test://unknown-xyz');
  assert.ok(comp instanceof Component, 'stub should be a Component');
  assert.ok(comp._error, 'stub should have an error message');
});

test('Qt.createQmlObject with factory function creates object', () => {
  const { Qt, Item } = require('../src/runtime');

  const host = new Item();
  const factory = ({ parent }) => {
    const item = new Item({ parentItem: parent });
    item.defineProperty('dynamic', true);
    return item;
  };

  const obj = Qt.createQmlObject(factory, host);
  assert.ok(obj instanceof Item);
  assert.equal(obj.dynamic, true);
});

// ---------------------------------------------------------------------------
// Stage D: GridView – basic virtualization and layout
// ---------------------------------------------------------------------------

test('GridView creates delegates for visible range with uniform cell size', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 20; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 300;
  gv.height = 200;
  gv.cellWidth = 100;
  gv.cellHeight = 100;
  gv.cacheBuffer = 0;
  gv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    return item;
  });

  gv.model = model;
  gv.delegate = delegate;

  // 3 columns × 2 rows visible (300/100=3 cols, 200/100=2 rows) → items 0-5 visible
  assert.ok(gv.itemAt(0) !== null, 'item 0 should be visible');
  assert.ok(gv.itemAt(5) !== null, 'item 5 should be visible (2 full rows)');
  assert.equal(gv.itemAt(6), null, 'item 6 should not be created with cacheBuffer=0');

  gv.destroy();
});

test('GridView contentHeight equals rows * cellHeight (LeftToRight flow)', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 9; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 300;
  gv.height = 1000;
  gv.cellWidth = 100;
  gv.cellHeight = 80;
  gv.spacing = 0;
  gv.cacheBuffer = 0;
  gv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => new Item({ parentItem: p }));

  gv.model = model;
  gv.delegate = delegate;

  // 3 cols, 9 items → 3 rows; contentHeight = 3 * 80 = 240
  assert.equal(gv.contentHeight, 240, 'contentHeight should be rows * cellHeight');
  assert.equal(gv.count, 9, 'count should match model count');

  gv.destroy();
});

test('GridView cell positions do not overlap (LeftToRight flow)', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 9; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 300;
  gv.height = 1000;
  gv.cellWidth = 100;
  gv.cellHeight = 80;
  gv.spacing = 0;
  gv.cacheBuffer = 0;
  gv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => new Item({ parentItem: p }));
  gv.model = model;
  gv.delegate = delegate;

  // Row 0: items 0,1,2 → x=0,100,200  y=0
  assert.equal(gv.itemAt(0).x, 0);   assert.equal(gv.itemAt(0).y, 0);
  assert.equal(gv.itemAt(1).x, 100); assert.equal(gv.itemAt(1).y, 0);
  assert.equal(gv.itemAt(2).x, 200); assert.equal(gv.itemAt(2).y, 0);
  // Row 1: items 3,4,5 → x=0,100,200  y=80
  assert.equal(gv.itemAt(3).x, 0);   assert.equal(gv.itemAt(3).y, 80);
  assert.equal(gv.itemAt(4).x, 100); assert.equal(gv.itemAt(4).y, 80);
  // Row 2: items 6,7,8 → y=160
  assert.equal(gv.itemAt(6).x, 0);   assert.equal(gv.itemAt(6).y, 160);

  gv.destroy();
});

test('GridView respects spacing between cells', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 4; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 250;  // (100+10)*2 = 220 → 2 cols
  gv.height = 1000;
  gv.cellWidth = 100;
  gv.cellHeight = 80;
  gv.spacing = 10;
  gv.cacheBuffer = 0;
  gv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => new Item({ parentItem: p }));
  gv.model = model;
  gv.delegate = delegate;

  // 2 cols with spacing=10: item 0 at (0,0), item 1 at (110,0), item 2 at (0,90), item 3 at (110,90)
  assert.equal(gv.itemAt(0).x, 0);
  assert.equal(gv.itemAt(1).x, 110, 'second column x = cellWidth + spacing');
  assert.equal(gv.itemAt(2).y, 90, 'second row y = cellHeight + spacing');

  gv.destroy();
});

test('GridView virtualization: scrolling pools items above viewport', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 30; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 300;   // 3 cols
  gv.height = 200;  // 2 rows visible
  gv.cellWidth = 100;
  gv.cellHeight = 100;
  gv.spacing = 0;
  gv.cacheBuffer = 0;
  gv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => new Item({ parentItem: p }));
  gv.model = model;
  gv.delegate = delegate;

  assert.ok(gv.itemAt(0) !== null, 'item 0 visible initially');

  // Scroll down 300px (3 rows × 100)
  gv.contentY = 300;

  assert.equal(gv.itemAt(0), null, 'item 0 should be pooled after scroll');
  assert.ok(gv.itemAt(9) !== null, 'item 9 should be visible after scrolling to row 3');

  gv.destroy();
});

test('GridView reuseItems=true pools and reuses delegates', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 30; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 300;
  gv.height = 200;
  gv.cellWidth = 100;
  gv.cellHeight = 100;
  gv.spacing = 0;
  gv.cacheBuffer = 0;
  gv.reuseItems = true;
  gv.setContext(new Context(null, {}));

  let creationCount = 0;
  const pooledEvents = [];
  const reusedEvents = [];
  gv.connect('pooled', (item, idx) => pooledEvents.push(idx));
  gv.connect('reused', (item, idx) => reusedEvents.push(idx));

  const delegate = new Component(({ parent: p }) => {
    creationCount++;
    return new Item({ parentItem: p });
  });
  gv.model = model;
  gv.delegate = delegate;

  const initialCreations = creationCount;
  assert.ok(initialCreations > 0, 'should create items initially');

  // Scroll down to trigger pooling and reuse
  gv.contentY = 600;

  assert.ok(pooledEvents.length > 0, 'pooled signal should have fired');

  // Scroll back – reuse should kick in
  gv.contentY = 0;
  assert.ok(reusedEvents.length > 0, 'reused signal should have fired');
  assert.ok(
    creationCount < initialCreations + 20,
    'reuse should limit new delegate creations',
  );

  gv.destroy();
});

test('GridView TopToBottom flow places items column-first', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 6; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 1000;
  gv.height = 300;  // 3 rows (300/100=3)
  gv.cellWidth = 100;
  gv.cellHeight = 100;
  gv.spacing = 0;
  gv.flow = 'TopToBottom';
  gv.cacheBuffer = 0;
  gv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => new Item({ parentItem: p }));
  gv.model = model;
  gv.delegate = delegate;

  // TopToBottom, 3 rows: col 0 → items 0,1,2; col 1 → items 3,4,5
  assert.equal(gv.itemAt(0).x, 0);   assert.equal(gv.itemAt(0).y, 0);
  assert.equal(gv.itemAt(1).x, 0);   assert.equal(gv.itemAt(1).y, 100);
  assert.equal(gv.itemAt(2).x, 0);   assert.equal(gv.itemAt(2).y, 200);
  assert.equal(gv.itemAt(3).x, 100); assert.equal(gv.itemAt(3).y, 0);
  assert.equal(gv.itemAt(4).x, 100); assert.equal(gv.itemAt(4).y, 100);
  assert.equal(gv.itemAt(5).x, 100); assert.equal(gv.itemAt(5).y, 200);

  gv.destroy();
});

test('GridView currentIndex/currentItem and highlight', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 9; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 300;
  gv.height = 1000;
  gv.cellWidth = 100;
  gv.cellHeight = 100;
  gv.spacing = 0;
  gv.cacheBuffer = 0;
  gv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => new Item({ parentItem: p }));
  gv.model = model;
  gv.delegate = delegate;

  assert.equal(gv.currentIndex, -1, 'currentIndex defaults to -1');
  assert.equal(gv.currentItem, null, 'currentItem defaults to null');

  gv.currentIndex = 4;
  assert.ok(gv.currentItem !== null, 'currentItem should be set');
  assert.equal(gv.currentItem, gv.itemAt(4), 'currentItem should be item at currentIndex');

  gv.destroy();
});

test('GridView keyboard navigation ArrowRight/Left/Down/Up (LeftToRight flow)', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 9; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 300;   // 3 cols
  gv.height = 1000;
  gv.cellWidth = 100;
  gv.cellHeight = 100;
  gv.spacing = 0;
  gv.cacheBuffer = 0;
  gv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => new Item({ parentItem: p }));
  gv.model = model;
  gv.delegate = delegate;
  gv.currentIndex = 0;

  const ev = (key) => ({ key, accepted: false });
  let e;

  e = ev('ArrowRight'); gv.keys.onPressed(e);
  assert.equal(gv.currentIndex, 1, 'ArrowRight should advance by 1');

  e = ev('ArrowDown'); gv.keys.onPressed(e);
  assert.equal(gv.currentIndex, 4, 'ArrowDown should advance by cols (3) from 1→4');

  e = ev('ArrowLeft'); gv.keys.onPressed(e);
  assert.equal(gv.currentIndex, 3, 'ArrowLeft should go back by 1 from 4→3');

  e = ev('ArrowUp'); gv.keys.onPressed(e);
  assert.equal(gv.currentIndex, 0, 'ArrowUp should go back by cols (3) from 3→0');

  gv.destroy();
});

test('GridView attached onPooled/onReused fire with reuseItems=true', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 30; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 300;
  gv.height = 200;
  gv.cellWidth = 100;
  gv.cellHeight = 100;
  gv.spacing = 0;
  gv.cacheBuffer = 0;
  gv.reuseItems = true;
  gv.setContext(new Context(null, {}));

  const pooledLog = [];
  const reusedLog = [];

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    GridView._getAttached(item).onPooled = function () { pooledLog.push(true); };
    GridView._getAttached(item).onReused = function () { reusedLog.push(true); };
    return item;
  });

  gv.model = model;
  gv.delegate = delegate;

  gv.contentY = 600;  // scroll away
  gv.contentY = 0;    // scroll back (triggers reuse)

  assert.ok(pooledLog.length > 0, 'onPooled attached handler should have fired');
  assert.ok(reusedLog.length > 0, 'onReused attached handler should have fired');

  gv.destroy();
});

test('GridView model update (append) increases count and contentHeight', () => {
  const { ListModel, GridView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 3; i++) model.append({ n: i });

  const gv = new GridView();
  gv.width = 300;
  gv.height = 1000;
  gv.cellWidth = 100;
  gv.cellHeight = 100;
  gv.spacing = 0;
  gv.cacheBuffer = 0;
  gv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => new Item({ parentItem: p }));
  gv.model = model;
  gv.delegate = delegate;

  assert.equal(gv.count, 3);
  assert.equal(gv.contentHeight, 100, '1 row of 100px');

  model.append({ n: 3 });
  assert.equal(gv.count, 4);
  // 4 items in 3 cols → ceil(4/3) = 2 rows
  assert.equal(gv.contentHeight, 200, '2 rows after 4 items with 3 cols');

  gv.destroy();
});

// ---------------------------------------------------------------------------
// ListView – incremental model changes (insert/remove without full rebuild)
// ---------------------------------------------------------------------------

test('ListView incremental insert: new item appears without recreating existing ones', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 5; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 2000;
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

  const countAfterInit = creationCount;
  assert.equal(countAfterInit, 5, 'should create 5 items initially');

  // Capture refs to existing items
  const item0 = lv.itemAt(0);
  const item4 = lv.itemAt(4);

  // Insert a new item at position 2
  model.insert(2, { n: 99 });

  assert.equal(lv.count, 6, 'count should reflect insert');
  assert.equal(creationCount, 6, 'only 1 new delegate should be created');
  assert.equal(lv.itemAt(0), item0, 'item 0 reference should be preserved');
  // Previous item4 is now at index 5
  assert.equal(lv.itemAt(5), item4, 'item previously at 4 should now be at 5');

  lv.destroy();
});

test('ListView incremental insert: contentHeight grows correctly', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 3; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 2000;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 50;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  assert.equal(lv.contentHeight, 150, 'initial contentHeight = 3 * 50');

  model.append({ n: 3 });
  assert.equal(lv.contentHeight, 200, 'contentHeight should grow by 50 after append');
  assert.equal(lv.count, 4);

  lv.destroy();
});

test('ListView incremental remove: items destroyed and contentHeight shrinks', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 5; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 2000;
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

  const countAfterInit = creationCount;
  assert.equal(countAfterInit, 5);
  assert.equal(lv.contentHeight, 200);

  // Remove item at index 1
  const item0 = lv.itemAt(0);
  model.remove(1);

  assert.equal(lv.count, 4, 'count should decrease');
  assert.equal(lv.contentHeight, 160, 'contentHeight should shrink');
  assert.equal(lv.itemAt(0), item0, 'item 0 should be preserved');
  assert.equal(creationCount, 5, 'no new delegates should be created on remove');

  lv.destroy();
});

test('ListView incremental remove: positions of remaining items are correct', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 4; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 2000;
  lv.spacing = 0;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // Positions before: 0→0, 1→40, 2→80, 3→120
  assert.equal(lv.itemAt(0).y, 0);
  assert.equal(lv.itemAt(1).y, 40);
  assert.equal(lv.itemAt(2).y, 80);

  // Remove item at index 0
  model.remove(0);

  // Remaining items shift: 0→0, 1→40 (old items 1,2,3 are now 0,1,2)
  assert.equal(lv.itemAt(0).y, 0, 'first remaining item should be at y=0');
  assert.equal(lv.itemAt(1).y, 40, 'second remaining item should be at y=40');
  assert.equal(lv.itemAt(2).y, 80, 'third remaining item should be at y=80');

  lv.destroy();
});

test('ListView incremental remove with reuseItems: removed items go to pool', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 5; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 2000;
  lv.cacheBuffer = 0;
  lv.reuseItems = true;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // Remove one item – it should go to the pool
  model.remove(2);

  assert.ok(lv._reusePool.length > 0, 'removed item should be in pool when reuseItems=true');

  lv.destroy();
});

test('ListView incremental insert: positions after insert are correct', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 3; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 2000;
  lv.spacing = 0;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  // Insert at index 1
  model.insert(1, { n: 99 });

  // Expected positions: 0→0, 1→40(new), 2→80(old 1), 3→120(old 2)
  assert.equal(lv.itemAt(0).y, 0);
  assert.equal(lv.itemAt(1).y, 40, 'inserted item should be at y=40');
  assert.equal(lv.itemAt(2).y, 80, 'shifted item should be at y=80');
  assert.equal(lv.itemAt(3).y, 120, 'last shifted item should be at y=120');

  lv.destroy();
});

test('ListView clear() triggers full rebuild and count resets to 0', () => {
  const { ListModel, ListView, Component, Item, Context } = require('../src/runtime');

  const model = new ListModel();
  for (let i = 0; i < 5; i++) model.append({ n: i });

  const lv = new ListView();
  lv.width = 200;
  lv.height = 200;
  lv.cacheBuffer = 0;
  lv.setContext(new Context(null, {}));

  const delegate = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.height = 40;
    return item;
  });

  lv.model = model;
  lv.delegate = delegate;

  assert.equal(lv.count, 5);

  model.clear();

  assert.equal(lv.count, 0, 'count should be 0 after clear()');
  assert.equal(lv.contentHeight, 0, 'contentHeight should be 0 after clear()');

  lv.destroy();
});

// ---------------------------------------------------------------------------
// Stage F: Engine lifecycle & event loop parity
// ---------------------------------------------------------------------------

// A) Component.onCompleted – order and final property values

test('Stage F: Component.onCompleted fires in post-order: children before parent', () => {
  const { Component, Item } = require('../src/runtime');
  const order = [];

  const comp = new Component(({ parent: p }) => {
    const root = new Item({ parentItem: p });
    root.onCompleted = () => order.push('root');

    const child1 = new Item({ parentItem: root });
    child1.onCompleted = () => order.push('child1');

    const child2 = new Item({ parentItem: root });
    child2.onCompleted = () => order.push('child2');

    return root;
  });

  const host = new Item();
  comp.createObject(host);

  // Qt post-order: innermost children first, then parent
  assert.deepEqual(order, ['child1', 'child2', 'root']);
});

test('Stage F: Component.onCompleted sees final property values after bindings applied', () => {
  const { Component, Item, Binding } = require('../src/runtime');
  let seenWidth = null;

  const comp = new Component(() => {
    const root = new Item();
    root.defineProperty('baseSize', 100);
    root.width = new Binding(() => root.baseSize * 2);
    root.onCompleted = () => { seenWidth = root.width; };
    return root;
  });

  comp.createObject(null);

  assert.equal(seenWidth, 200, 'onCompleted should see the bound (final) width value');
});

// A) Component.onDestruction

test('Stage F: Component.onDestruction fires when object is destroyed', () => {
  const { Item } = require('../src/runtime');
  const events = [];

  const item = new Item();
  item.onDestruction = () => events.push('destroyed');

  item.destroy();

  assert.deepEqual(events, ['destroyed']);
});

test('Stage F: Component.onDestruction fires in pre-order: parent before children', () => {
  const { Item } = require('../src/runtime');
  const order = [];

  const parent = new Item();
  parent.onDestruction = () => order.push('parent');

  const child1 = new Item({ parentItem: parent });
  child1.onDestruction = () => order.push('child1');

  const child2 = new Item({ parentItem: parent });
  child2.onDestruction = () => order.push('child2');

  parent.destroy();

  // Qt pre-order: parent fires first, then children
  assert.deepEqual(order, ['parent', 'child1', 'child2']);
});

test('Stage F: Component.onDestruction fires when Loader unloads its item', () => {
  const { Item, Component, Loader } = require('../src/runtime');
  const events = [];

  const comp = new Component(({ parent: p }) => {
    const item = new Item({ parentItem: p });
    item.onDestruction = () => events.push('unloaded');
    return item;
  });

  const loader = new Loader({ sourceComponent: comp });
  assert.equal(loader.status, Loader.Ready);
  assert.equal(events.length, 0, 'onDestruction should not fire before unload');

  loader.active = false;
  assert.deepEqual(events, ['unloaded'], 'onDestruction should fire when Loader unloads');
});

test('Stage F: Component.onDestruction fires only once even if destroy() is called twice', () => {
  const { Item } = require('../src/runtime');
  let count = 0;
  const item = new Item();
  item.onDestruction = () => { count += 1; };
  item.destroy();
  item.destroy(); // no-op
  assert.equal(count, 1, 'onDestruction should fire exactly once');
});

// B) Qt.callLater – deferred execution

test('Stage F: Qt.callLater runs the function after the current synchronous turn', async () => {
  const { Qt } = require('../src/runtime');
  const events = [];

  events.push('before');
  Qt.callLater(() => events.push('deferred'));
  events.push('after');

  // At this point the deferred call has not yet run
  assert.deepEqual(events, ['before', 'after']);

  // Await a microtask tick so the callLater callback is executed
  await Promise.resolve();

  assert.deepEqual(events, ['before', 'after', 'deferred']);
});

test('Stage F: Qt.callLater deduplicates: same function queued twice only runs once', async () => {
  const { Qt } = require('../src/runtime');
  let count = 0;
  const fn = () => { count += 1; };

  Qt.callLater(fn);
  Qt.callLater(fn);
  Qt.callLater(fn);

  await Promise.resolve();

  assert.equal(count, 1, 'callLater should coalesce duplicate calls to the same function');
});

test('Stage F: Qt.callLater passes arguments to the deferred function', async () => {
  const { Qt } = require('../src/runtime');
  let received = null;
  Qt.callLater((a, b) => { received = [a, b]; }, 'hello', 42);
  await Promise.resolve();
  assert.deepEqual(received, ['hello', 42]);
});

test('Stage F: Qt.callLater last-wins for args when same fn queued multiple times', async () => {
  const { Qt } = require('../src/runtime');
  let received = null;
  const fn = (...args) => { received = args; };
  Qt.callLater(fn, 1);
  Qt.callLater(fn, 2);
  Qt.callLater(fn, 3);
  await Promise.resolve();
  assert.deepEqual(received, [3], 'last args should win for deduplicated callLater');
});

test('Stage F: Qt.callLater different functions both execute', async () => {
  const { Qt } = require('../src/runtime');
  const results = [];
  Qt.callLater(() => results.push('a'));
  Qt.callLater(() => results.push('b'));
  await Promise.resolve();
  assert.deepEqual(results.sort(), ['a', 'b']);
});

// C) Binding coalescing – prevent re-entrancy loops

test('Stage F: Binding coalescing: chained bindings propagate correctly', () => {
  const { QObject, Binding } = require('../src/runtime');
  const obj = new QObject();
  obj.defineProperty('x', 0);
  obj.defineProperty('y', 0);
  obj.defineProperty('z', 0);

  // z depends on y, y depends on x – setting x should update both without error
  obj.y = new Binding(() => obj.x + 1);
  obj.z = new Binding(() => obj.y + 1);

  assert.equal(obj.y, 1);
  assert.equal(obj.z, 2);

  obj.x = 10;

  // After the change propagates, z should equal x + 2
  assert.equal(obj.y, 11);
  assert.equal(obj.z, 12, 'coalesced binding chain should propagate correctly');
});

test('Stage F: Binding coalescing: reactive bindings stay consistent after multiple updates', () => {
  const { QObject, Binding } = require('../src/runtime');

  const obj = new QObject();
  obj.defineProperty('counter', 0);
  obj.defineProperty('doubled', 0);

  obj.doubled = new Binding(() => obj.counter * 2);

  assert.equal(obj.doubled, 0);

  obj.counter = 5;
  assert.equal(obj.doubled, 10);

  obj.counter = 7;
  assert.equal(obj.doubled, 14, 'binding should stay reactive after multiple updates');
});


// ---------------------------------------------------------------------------
// Stage G: Focus / Input parity tests
// ---------------------------------------------------------------------------

test('TextInput without explicit height has a sensible non-zero implicitHeight', () => {
  const { TextInput } = require('../src/runtime');

  const ti = new TextInput({ blinkInterval: 0 });
  // Default font.pixelSize is 14; expected implicitHeight = max(20, 14+8) = 22
  assert.ok(ti.implicitHeight > 0, 'implicitHeight must be > 0 when no explicit height is set');
  assert.equal(ti.implicitHeight, 22, 'default implicitHeight should be font.pixelSize(14) + 8 = 22');
});

test('TextInput implicitHeight updates when font.pixelSize changes', () => {
  const { TextInput } = require('../src/runtime');

  const ti = new TextInput({ font: { family: 'sans-serif', pixelSize: 14, bold: false }, blinkInterval: 0 });
  assert.equal(ti.implicitHeight, 22, 'initial: pixelSize=14 → implicitHeight=22');

  // Change font to a larger size
  ti.font = { family: 'sans-serif', pixelSize: 24, bold: false };
  assert.equal(ti.implicitHeight, 32, 'after pixelSize=24 → implicitHeight=32');

  // Change font to a small size — minimum clamp applies
  ti.font = { family: 'sans-serif', pixelSize: 8, bold: false };
  assert.equal(ti.implicitHeight, 20, 'minimum clamp: pixelSize=8 → implicitHeight=20');
});

test('TextInput implicitHeight with large font stays proportional', () => {
  const { TextInput } = require('../src/runtime');

  const ti = new TextInput({ font: { family: 'sans-serif', pixelSize: 32, bold: false }, blinkInterval: 0 });
  assert.equal(ti.implicitHeight, 40, 'pixelSize=32 → implicitHeight=40');
});

test('Tab traversal skips disabled items', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const a = new Item({ parentItem: root });
  a.activeFocusOnTab = true; a.focusable = true;
  a.width = 100; a.height = 30;

  const b = new Item({ parentItem: root });
  b.activeFocusOnTab = true; b.focusable = true;
  b.enabled = false; // disabled – should be skipped
  b.width = 100; b.height = 30;

  const c = new Item({ parentItem: root });
  c.activeFocusOnTab = true; c.focusable = true;
  c.width = 100; c.height = 30;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(a);

  scene.focusNext();
  assert.equal(scene.activeFocusItem, c, 'Tab should skip disabled item b and land on c');
});

test('Tab traversal skips invisible items', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const a = new Item({ parentItem: root });
  a.activeFocusOnTab = true; a.focusable = true;
  a.width = 100; a.height = 30;

  const b = new Item({ parentItem: root });
  b.activeFocusOnTab = true; b.focusable = true;
  b.visible = false; // invisible – should be skipped
  b.width = 100; b.height = 30;

  const c = new Item({ parentItem: root });
  c.activeFocusOnTab = true; c.focusable = true;
  c.width = 100; c.height = 30;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(a);

  scene.focusNext();
  assert.equal(scene.activeFocusItem, c, 'Tab should skip invisible item b and land on c');
});

test('Tab traversal skips items with activeFocusOnTab=false', () => {
  const { Item, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  const a = new Item({ parentItem: root });
  a.activeFocusOnTab = true; a.focusable = true;
  a.width = 100; a.height = 30;

  const b = new Item({ parentItem: root });
  b.activeFocusOnTab = false; b.focusable = false; // not in tab chain
  b.width = 100; b.height = 30;

  const c = new Item({ parentItem: root });
  c.activeFocusOnTab = true; c.focusable = true;
  c.width = 100; c.height = 30;

  const scene = new Scene({ rootItem: root });
  scene.forceActiveFocus(a);

  scene.focusNext();
  assert.equal(scene.activeFocusItem, c, 'Tab should skip b (not focusable by tab) and land on c');
});

test('Wheel propagation: inner Flickable at boundary lets outer Flickable scroll', () => {
  const { Flickable } = require('../src/runtime');

  // Outer Flickable: 200x200 viewport, 200x600 content
  const outer = new Flickable();
  outer.width = 200; outer.height = 200;
  outer.contentWidth = 200; outer.contentHeight = 600;
  outer.contentY = 0;

  // Inner Flickable: 200x200 viewport, 200x400 content, already scrolled to bottom
  const inner = new Flickable();
  inner.width = 200; inner.height = 200;
  inner.contentWidth = 200; inner.contentHeight = 400;
  inner.contentY = 200; // at the bottom (max = contentHeight - height = 400 - 200 = 200)

  // Scroll down 50px on inner: it's at the boundary, should return false
  const innerAccepted = inner.handleWheelEvent({ deltaX: 0, deltaY: 50, deltaMode: 0 });
  assert.equal(innerAccepted, false, 'Inner Flickable at boundary must not accept the wheel event');

  // Outer Flickable should still be able to scroll
  const outerAccepted = outer.handleWheelEvent({ deltaX: 0, deltaY: 50, deltaMode: 0 });
  assert.equal(outerAccepted, true, 'Outer Flickable should accept wheel event');
  assert.equal(outer.contentY, 50, 'Outer Flickable should have scrolled');
});

test('Wheel propagation: inner Flickable with room scrolls and does not propagate', () => {
  const { Flickable } = require('../src/runtime');

  const outer = new Flickable();
  outer.width = 200; outer.height = 200;
  outer.contentWidth = 200; outer.contentHeight = 600;
  outer.contentY = 0;

  const inner = new Flickable();
  inner.width = 200; inner.height = 200;
  inner.contentWidth = 200; inner.contentHeight = 400;
  inner.contentY = 0; // at the top, has room to scroll

  // Scroll down 50px on inner: it has room, should accept
  const innerAccepted = inner.handleWheelEvent({ deltaX: 0, deltaY: 50, deltaMode: 0 });
  assert.equal(innerAccepted, true, 'Inner Flickable with room should accept wheel event');
  assert.equal(inner.contentY, 50, 'Inner Flickable should have scrolled');

  // Outer Flickable should not have scrolled (event was handled by inner)
  assert.equal(outer.contentY, 0, 'Outer Flickable should NOT have scrolled');
});

test('WheelHandler accepting event stops outer Flickable from scrolling', () => {
  const { Item, Flickable, WheelHandler, Scene } = require('../src/runtime');

  const root = new Item();
  root.width = 400; root.height = 400;

  // Outer Flickable
  const flick = new Flickable({ parentItem: root });
  flick.width = 400; flick.height = 400;
  flick.contentWidth = 400; flick.contentHeight = 1200;
  flick.contentY = 0;

  // WheelHandler inside Flickable that accepts all vertical wheel events
  let handlerFired = false;
  const wh = new WheelHandler({ parentItem: flick });
  // No explicit bounds so it uses parent bounds (the Flickable)
  wh.wheel.connect((event) => {
    handlerFired = true;
    event.accepted = true;
  });

  const scene = new Scene({ rootItem: root });

  // Dispatch a wheel event in the center of the Flickable
  scene.dispatchWheel(200, 200, { deltaX: 0, deltaY: 60, deltaMode: 0 });

  assert.equal(handlerFired, true, 'WheelHandler should have fired');
  assert.equal(flick.contentY, 0, 'Flickable should NOT scroll when WheelHandler accepted the event');
});
