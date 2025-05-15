import { broadcastSignal } from "../src/broadcast.mjs";

// Setup shared signal
const sharedText = broadcastSignal("", "sharedText");

// Log updates
sharedText.subscribe((value) => {
  console.log("Worker received:", value);
});
