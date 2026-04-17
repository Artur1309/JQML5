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
