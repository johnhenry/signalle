import { effect } from './signal.mjs';

/**
 * Convert a signal into a ReadableStream that emits SSE-formatted strings.
 *
 * @template T
 * @param {import('./signal.mjs').Signal<T>} sig - The signal to observe
 * @param {Object} [options]
 * @param {(value: T) => string} [options.transform] - Transform value before sending (default: JSON.stringify)
 * @param {string} [options.event] - SSE event name (omit for default event)
 * @param {boolean} [options.sendInitial=true] - Whether to send the initial value
 * @returns {ReadableStream<string>}
 */
export const toReadableStream = (sig, options = {}) => {
  const {
    transform = JSON.stringify,
    event,
    sendInitial = true,
  } = options;

  let unsubscribe;
  let first = true;

  return new ReadableStream({
    start(controller) {
      unsubscribe = effect(sig, (value) => {
        if (first && !sendInitial) {
          first = false;
          return;
        }
        first = false;

        let chunk = "";
        if (event) {
          chunk += `event: ${event}\n`;
        }
        chunk += `data: ${transform(value)}\n\n`;

        try {
          controller.enqueue(chunk);
        } catch {
          // Stream already closed
        }
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
      }
    },
  });
};

/**
 * Convert a signal into a ready-to-send SSE Response.
 *
 * @template T
 * @param {import('./signal.mjs').Signal<T>} sig - The signal to observe
 * @param {Object} [options]
 * @param {(value: T) => string} [options.transform] - Transform value before sending (default: JSON.stringify)
 * @param {string} [options.event] - SSE event name (omit for default event)
 * @param {boolean} [options.sendInitial=true] - Whether to send the initial value
 * @param {boolean|string} [options.cors=false] - Set CORS header. true for "*", or a string origin.
 * @returns {Response}
 */
export const toSSEResponse = (sig, options = {}) => {
  const { cors = false, ...streamOpts } = options;
  const headers = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
  };
  if (cors) {
    headers["access-control-allow-origin"] = typeof cors === "string" ? cors : "*";
  }
  return new Response(toReadableStream(sig, streamOpts), { headers });
};
