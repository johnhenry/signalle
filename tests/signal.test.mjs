import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { signal, computed, Signal } from "../src/signal.mjs";

describe("Signal", async () => {
  it("should create a signal with initial value", () => {
    const count = signal(0);
    assert.equal(count.value, 0);
  });

  it("should update signal value", () => {
    const count = signal(0);
    count.value = 1;
    assert.equal(count.value, 1);
  });

  it("should notify subscribers of changes", async () => {
    const count = signal(0);
    let notified = false;

    count.subscribe(() => {
      notified = true;
    });

    count.value = 1;
    assert.equal(notified, true);
  });

  it("should update using update function", () => {
    const count = signal(0);
    count.update((n) => n + 1);
    assert.equal(count.value, 1);
  });

  it("should not notify if value is unchanged", () => {
    const count = signal(0);
    let notifications = 0;

    count.subscribe(() => notifications++);
    // First notification from initial subscription
    assert.equal(notifications, 1);

    count.value = 0; // Same value
    // Should not trigger another notification
    assert.equal(notifications, 1);
  });

  it("should support unsubscribe", () => {
    const count = signal(0);
    let notifications = 0;

    const unsubscribe = count.subscribe(() => notifications++);
    // First notification from initial subscription
    assert.equal(notifications, 1);

    unsubscribe();
    count.value = 1;
    // Should not trigger another notification after unsubscribe
    assert.equal(notifications, 1);
  });
});

describe("Computed", async () => {
  it("should compute derived value", async () => {
    const count = signal(1);
    const doubled = computed(count, async (value) => value * 2);

    // Wait for initial computation
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(doubled.value, 2);
  });

  it("should update when dependencies change", async () => {
    const count = signal(1);
    const doubled = computed(count, async (value) => value * 2);

    // Wait for initial computation
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(doubled.value, 2);

    count.value = 2;
    // Wait for recomputation
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(doubled.value, 4);
  });

  it("should handle multiple dependencies", async () => {
    const a = signal(1);
    const b = signal(2);
    const sum = computed([a, b], async (a, b) => a + b);

    // Wait for initial computation
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sum.value, 3);

    a.value = 2;
    // Wait for recomputation
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sum.value, 4);

    b.value = 3;
    // Wait for recomputation
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sum.value, 5);
  });

  it("should not allow direct modification", () => {
    const count = signal(1);
    const doubled = computed(count, async (value) => value * 2);

    assert.throws(() => {
      doubled.value = 4;
    }, Error);
  });

  it("should support cleanup", async () => {
    let cleaned = false;
    const count = signal(1);

    const withCleanup = computed(count, async (value) => [
      value,
      async () => {
        cleaned = true;
      },
    ]);

    // Wait for initial computation
    await new Promise((resolve) => setTimeout(resolve, 0));

    count.value = 2;
    // Wait for recomputation and cleanup
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(cleaned, true);
  });
});

describe("Batch Updates", async () => {
  it("should batch multiple updates", async () => {
    const count = signal(0);
    let notifications = 0;

    count.subscribe(() => notifications++);
    // First notification from initial subscription
    assert.equal(notifications, 1);

    await Signal.batch(async () => {
      count.value = 1;
      count.value = 2;
      count.value = 3;
    });

    // Should only get one more notification after batch
    assert.equal(notifications, 2);
    assert.equal(count.value, 3);
  });
});
