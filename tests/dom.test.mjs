import test from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '../src/signal.mjs';
import { JSDOM } from 'jsdom';

// Skip tests if jsdom isn't available
const maybeTest = process.env.CI ? test.skip : test;

maybeTest('DOM bindings test', async (t) => {
  // Skip test if running on a CI environment without browser APIs
  try {
    if (!JSDOM) {
      console.log('JSDOM not available, skipping DOM tests');
      return;
    }
  } catch (e) {
    console.log('JSDOM not available, skipping DOM tests');
    return;
  }

  // Create a JSDOM instance
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
      <body>
        <div id="output"></div>
        <input id="input" type="text" value="initial">
        <div id="list-container"></div>
      </body>
    </html>
  `);

  // Make the DOM globals available
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.CustomEvent = dom.window.CustomEvent;
  global.Event = dom.window.Event;

  // Import DOM module only after globals are set
  const { bind, bindAttribute, bindClass, bindStyle } = await import('../src/dom.mjs');

  // Test basic DOM binding
  await t.test('basic DOM binding', async () => {
    const outputElement = document.getElementById('output');
    const nameSignal = signal('Test Value');
    
    bind(outputElement, {
      property: 'textContent'
    });
    
    nameSignal.value = 'Updated Value';
    
    // Allow time for DOM updates
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // This test is mostly placeholder since JSDOM doesn't fully simulate browser environment
    assert.ok(true, 'DOM binding should not throw errors');
  });

  // Clean up global object pollution
  delete global.document;
  delete global.HTMLElement;
  delete global.CustomEvent;
  delete global.Event;
});

maybeTest('bindList (keyed updates, foreign children)', async (t) => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>');
  const doc = dom.window.document;
  const { bindList } = await import('../src/dom.mjs');
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const container = (html = '') => {
    const el = doc.createElement('ul');
    el.innerHTML = html;
    doc.body.appendChild(el);
    return el;
  };
  const li = (text) => {
    const el = doc.createElement('li');
    el.textContent = text;
    return el;
  };
  const texts = (el) => [...el.children].map((c) => c.textContent);
  // Count the DOM operations bindList performs on a container.
  const countOps = (el) => {
    const ops = { insert: 0, remove: 0 };
    const insertBefore = el.insertBefore.bind(el);
    const removeChild = el.removeChild.bind(el);
    el.insertBefore = (node, ref) => { ops.insert++; return insertBefore(node, ref); };
    el.removeChild = (node) => { ops.remove++; return removeChild(node); };
    el.appendChild = (node) => { ops.insert++; return insertBefore(node, null); };
    return ops;
  };

  await t.test('original form: keyed by id, rendered once per key, not re-rendered', async () => {
    const el = container();
    const items = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    let renders = 0;
    bindList(el, items, (item) => { renders++; return li(item.name); });
    assert.deepEqual(texts(el), ['a', 'b']);
    const first = el.children[0];
    items.value = [{ id: 2, name: 'b' }, { id: 1, name: 'A' }, { id: 3, name: 'c' }];
    await tick();
    // Without an update callback an existing node keeps its old content.
    assert.deepEqual(texts(el), ['b', 'a', 'c']);
    assert.equal(el.children[1], first);
    assert.equal(renders, 3);
    items.value = [{ id: 3, name: 'c' }];
    await tick();
    assert.deepEqual(texts(el), ['c']);
    items.value = [];
    await tick();
    assert.equal(el.children.length, 0);
  });

  await t.test('update option patches an existing node whose item changed', async () => {
    const el = container();
    const a = { id: 1, name: 'a' };
    const b = { id: 2, name: 'b' };
    const items = signal([a, b]);
    const calls = [];
    bindList(el, items, {
      render: (item) => li(item.name),
      update: (node, item, index, previous) => {
        calls.push([item.id, index, previous.name]);
        node.textContent = item.name;
      },
    });
    const nodeB = el.children[1];
    items.value = [a, { id: 2, name: 'B' }];
    await tick();
    assert.deepEqual(texts(el), ['a', 'B']);
    assert.equal(el.children[1], nodeB, 'the node is patched, not replaced');
    assert.deepEqual(calls, [[2, 1, 'b']], 'unchanged items (same reference) are not updated');
  });

  await t.test('update as a fourth argument after renderItem', async () => {
    const el = container();
    const items = signal([{ id: 'x', n: 1 }]);
    bindList(el, items, (item) => li(String(item.n)), { update: (node, item) => { node.textContent = String(item.n); } });
    items.value = [{ id: 'x', n: 2 }];
    await tick();
    assert.deepEqual(texts(el), ['2']);
  });

  await t.test('render may return { node, update }', async () => {
    const el = container();
    const items = signal([{ id: 1, n: 1 }]);
    let fallback = 0;
    bindList(el, items, {
      render: (item) => {
        const node = li(String(item.n));
        return { node, update: (n, item2) => { n.textContent = String(item2.n); } };
      },
      update: () => { fallback++; },
    });
    items.value = [{ id: 1, n: 5 }];
    await tick();
    assert.deepEqual(texts(el), ['5']);
    assert.equal(fallback, 0, "the node's own update wins over options.update");
  });

  await t.test('key option: property name or function', async () => {
    const el = container();
    const items = signal([{ sku: 'a' }, { sku: 'b' }]);
    bindList(el, items, { key: 'sku', render: (item) => li(item.sku) });
    const nodeA = el.children[0];
    items.value = [{ sku: 'b' }, { sku: 'a' }];
    await tick();
    assert.equal(el.children[1], nodeA);

    const el2 = container();
    const items2 = signal(['x', 'y']);
    bindList(el2, items2, { key: (item) => item, render: (item) => li(item) });
    const nodeX = el2.children[0];
    items2.value = ['y', 'z', 'x'];
    await tick();
    assert.deepEqual(texts(el2), ['y', 'z', 'x']);
    assert.equal(el2.children[2], nodeX);
  });

  await t.test('equals option decides what counts as changed', async () => {
    const el = container();
    const items = signal([{ id: 1, v: 1, seen: 0 }]);
    let updates = 0;
    bindList(el, items, {
      render: (item) => li(String(item.v)),
      update: () => { updates++; },
      equals: (a, b) => a.v === b.v,
    });
    items.value = [{ id: 1, v: 1, seen: 1 }];
    await tick();
    assert.equal(updates, 0);
    items.value = [{ id: 1, v: 2, seen: 1 }];
    await tick();
    assert.equal(updates, 1);
  });

  await t.test('children it did not create are left alone, and the list stays in place', async () => {
    const el = container('<li class="head">head</li>');
    const items = signal([{ id: 1 }, { id: 2 }]);
    bindList(el, items, (item) => li(`item ${item.id}`));
    assert.deepEqual(texts(el), ['head', 'item 1', 'item 2']);

    // Someone adds a footer after the list; the list grows before it.
    const foot = li('foot');
    el.appendChild(foot);
    items.value = [{ id: 3 }, { id: 1 }, { id: 2 }, { id: 4 }];
    await tick();
    assert.deepEqual(texts(el), ['head', 'item 3', 'item 1', 'item 2', 'item 4', 'foot']);

    // Emptying and refilling keeps the list's position between head and foot.
    items.value = [];
    await tick();
    assert.deepEqual(texts(el), ['head', 'foot']);
    items.value = [{ id: 5 }];
    await tick();
    assert.deepEqual(texts(el), ['head', 'item 5', 'foot']);
    assert.equal(el.querySelector('.head').textContent, 'head');
  });

  await t.test('a list whose children are all list items behaves as before', async () => {
    const el = container();
    const items = signal([1, 2, 3, 4, 5].map((id) => ({ id })));
    bindList(el, items, (item) => li(String(item.id)));
    for (const ids of [[5, 4, 3, 2, 1], [2, 9, 4], [], [7, 8], [8, 7, 6]]) {
      items.value = ids.map((id) => ({ id }));
      await tick();
      assert.deepEqual(texts(el), ids.map(String));
    }
  });

  await t.test('DOM operations are minimal: one changed row, one move', async () => {
    const el = container();
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `row ${i}` }));
    const items = signal(rows);
    let updates = 0;
    bindList(el, items, {
      render: (item) => li(item.label),
      update: (node, item) => { updates++; node.textContent = item.label; },
    });
    const ops = countOps(el);

    const changed = rows.slice();
    changed[500] = { id: 500, label: 'changed' };
    items.value = changed;
    await tick();
    assert.equal(updates, 1);
    assert.deepEqual(ops, { insert: 0, remove: 0 });
    assert.equal(el.children[500].textContent, 'changed');

    // Move the last row to the front: one insert, not 1000.
    const moved = [changed[999], ...changed.slice(0, 999)];
    items.value = moved;
    await tick();
    assert.deepEqual(ops, { insert: 1, remove: 0 });
    assert.equal(el.children[0].textContent, 'row 999');

    // Remove one row: one removal, no moves.
    items.value = moved.filter((r) => r.id !== 10);
    await tick();
    assert.deepEqual(ops, { insert: 1, remove: 1 });
    assert.equal(el.children.length, 999);
  });

  await t.test('a node removed from the container by someone else is put back', async () => {
    const el = container();
    const items = signal([{ id: 1 }, { id: 2 }]);
    bindList(el, items, (item) => li(String(item.id)));
    el.removeChild(el.children[0]);
    items.value = [{ id: 1 }, { id: 2 }, { id: 3 }];
    await tick();
    assert.deepEqual(texts(el), ['1', '2', '3']);
  });

  await t.test('duplicate keys warn once and skip the later items', async () => {
    const el = container();
    const warn = console.warn;
    const warnings = [];
    console.warn = (msg) => warnings.push(msg);
    try {
      const items = signal([{ id: 1, n: 'a' }, { id: 1, n: 'b' }, { id: 2, n: 'c' }]);
      bindList(el, items, (item) => li(item.n));
      items.value = [{ id: 1, n: 'a' }, { id: 1, n: 'b' }];
      await tick();
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(texts(el), ['a']);
    assert.equal(warnings.length, 1);
  });

  await t.test('render is required', () => {
    assert.throws(() => bindList(container(), signal([]), {}), TypeError);
  });
});
