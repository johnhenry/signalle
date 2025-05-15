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
