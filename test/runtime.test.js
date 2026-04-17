const test = require('node:test');
const assert = require('node:assert/strict');

const { QObject, QtObject, Item } = require('../src/runtime');

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
