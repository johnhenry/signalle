import { createBroadcastSignal } from "../src/broadcast.mjs";

// Setup shared signal
const sharedText = createBroadcastSignal("", "sharedText");

// Log updates
sharedText.subscribe((value) => {
  console.log("Worker received:", value);
});
