import test from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, untrack, createEffect } from '../src/signal.mjs';

test('signal creation and basic operations', async (t) => {
  const count = signal(0);
  assert.equal(count.value, 0, 'Initial value should be set correctly');
  
  count.value = 5;
  assert.equal(count.value, 5, 'Value should update when set');
  
  count.update(v => v + 1);
  assert.equal(count.value, 6, 'Update function should work correctly');
  
  // Test peek
  const originalValue = count.peek();
  assert.equal(originalValue, 6, 'peek() should return current value');
});

test('computed signals', async (t) => {
  const count = signal(1);
  const doubled = computed(count, async (v) => v * 2);
  
  // First computation might need time to complete
  while (doubled.value === undefined) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  assert.equal(doubled.value, 2, 'Computed should calculate correctly');
  
  count.value = 5;
  
  // Wait for computed to update
  while (doubled.value !== 10) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  assert.equal(doubled.value, 10, 'Computed should update when dependencies change');
  
  // Try setting computed directly (should throw)
  assert.throws(() => {
    doubled.value = 20;
  }, /Cannot modify computed signal directly/, 'Should not allow setting computed directly');
});

test('effect and subscriptions', async (t) => {
  const name = signal('John');
  const callCount = {value: 0};
  const values = [];
  
  const unsubscribe = effect(name, (value) => {
    callCount.value++;
    values.push(value);
  });
  
  // Initial effect call
  assert.equal(callCount.value, 1, 'Effect should be called immediately');
  assert.deepEqual(values, ['John'], 'Effect should receive initial value');
  
  // Update the signal
  name.value = 'Jane';
  
  // Allow time for effects to process
  await new Promise(resolve => setTimeout(resolve, 10));
  
  assert.equal(callCount.value, 2, 'Effect should be called when signal changes');
  assert.deepEqual(values, ['John', 'Jane'], 'Effect should receive updated value');
  
  // Multiple updates with same value
  name.value = 'Jane';
  name.value = 'Jane';
  
  // Allow time for effects to process
  await new Promise(resolve => setTimeout(resolve, 10));
  
  assert.equal(callCount.value, 2, 'Effect should not be called if value does not change');
  
  // Unsubscribe and verify no more calls
  unsubscribe();
  name.value = 'Bob';
  
  // Allow time for effects to process
  await new Promise(resolve => setTimeout(resolve, 10));
  
  assert.equal(callCount.value, 2, 'Effect should not be called after unsubscribe');
  assert.deepEqual(values, ['John', 'Jane'], 'Values should not change after unsubscribe');
});

test('batching updates', async (t) => {
  const firstName = signal('John');
  const lastName = signal('Doe');
  const fullName = computed([firstName, lastName], async (first, last) => `${first} ${last}`);
  
  const updates = [];
  effect(fullName, (value) => {
    updates.push(value);
  });
  
  // Allow initial computation to complete
  while (updates.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  // Reset updates array
  updates.length = 0;
  
  await batch(async () => {
    firstName.value = 'Jane';
    lastName.value = 'Smith';
  });
  
  // Allow batch to complete
  await new Promise(resolve => setTimeout(resolve, 20));
  
  assert.equal(updates.length, 1, 'Batch should result in a single update');
  assert.equal(updates[0], 'Jane Smith', 'Batch should apply all updates correctly');
});

test('untrack function', async (t) => {
  const count = signal(0);
  let regularAccess = 0;
  let untrackedAccess = 0;
  
  createEffect(() => {
    // This will create a dependency
    regularAccess = count.value;
    
    // This should not create a dependency
    untrackedAccess = untrack(() => count.value);
  });
  
  // Initial run sets both values to 0
  assert.equal(regularAccess, 0);
  assert.equal(untrackedAccess, 0);
  
  // Update the signal
  count.value = 5;
  
  // Allow effect to run
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Regular access should be updated, but untracked should not have caused a rerun
  assert.equal(regularAccess, 5, 'Regular access should track and update');
  assert.equal(untrackedAccess, 5, 'Untracked access should still get latest value');
});

test('auto-dependency tracking with createEffect', async (t) => {
  const count = signal(0);
  const doubled = computed(count, async (v) => v * 2);
  const results = [];
  
  // Wait for initial computation to complete
  while (doubled.value === undefined) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  const cleanup = createEffect(() => {
    results.push({
      count: count.value,
      doubled: doubled.value
    });
  });
  
  // Allow initial effect to run
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Update one of the signals
  count.value = 5;
  
  // Allow effect to run
  await new Promise(resolve => setTimeout(resolve, 20));
  
  // We should have two results: initial and after update
  assert.equal(results.length, 2, 'Effect should run twice');
  assert.deepEqual(results[0], { count: 0, doubled: 0 }, 'Initial values should be tracked');
  assert.deepEqual(results[1], { count: 5, doubled: 10 }, 'Updates should be tracked');
  
  // Clean up
  cleanup();
  
  // Update again
  count.value = 10;
  
  // Allow time
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Should still have only two results
  assert.equal(results.length, 2, 'Effect should not run after cleanup');
});

test('linked list implementation', async (t) => {
  // Import the LinkedList directly to test it
  const { LinkedList } = await import('../src/linked-list.mjs');
  
  const list = new LinkedList();
  
  // Test adding items
  const removeA = list.add('A');
  list.add('B');
  list.add('C');
  
  assert.equal(list.size, 3, 'Size should be correct');
  assert.deepEqual(list.toArray(), ['A', 'B', 'C'], 'Items should be in correct order');
  
  // Test removing an item
  removeA();
  assert.equal(list.size, 2, 'Size should decrease after removal');
  assert.deepEqual(list.toArray(), ['B', 'C'], 'Items should be updated after removal');
  
  // Test contains
  assert.equal(list.has('B'), true, 'Should find existing item');
  assert.equal(list.has('A'), false, 'Should not find removed item');
  
  // Test forEach
  const values = [];
  list.forEach((value) => {
    values.push(value);
  });
  assert.deepEqual(values, ['B', 'C'], 'forEach should iterate over all items');
  
  // Test iteration
  const iteratedValues = [...list];
  assert.deepEqual(iteratedValues, ['B', 'C'], 'Iterator should work correctly');
  
  // Test clear
  list.clear();
  assert.equal(list.size, 0, 'Size should be zero after clearing');
  assert.deepEqual(list.toArray(), [], 'List should be empty after clearing');
});
