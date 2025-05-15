/**
 * DOM Integration Example
 *
 * This example shows how to use Signalle's DOM integration
 * to build interactive applications.
 *
 * To run, serve this file with a web server and open in a browser.
 */

// HTML to be injected into the page
const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signalle DOM Example</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      transition: background-color 0.3s, color 0.3s;
    }
    body.dark-theme {
      background-color: #1a1a1c;
      color: #e9e9ea;
    }
    .counter {
      display: flex;
      align-items: center;
      gap: 16px;
      margin: 20px 0;
    }
    button {
      background-color: #8c7ae6;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    button:hover {
      background-color: #a192ea;
    }
    .counter-value {
      font-size: 24px;
      min-width: 50px;
      text-align: center;
    }
    .toggle-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 20px;
    }
    .toggle {
      position: relative;
      display: inline-block;
      width: 60px;
      height: 30px;
    }
    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #ccc;
      transition: .4s;
      border-radius: 30px;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 22px;
      width: 22px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }
    input:checked + .slider {
      background-color: #8c7ae6;
    }
    input:checked + .slider:before {
      transform: translateX(30px);
    }
    .user-form {
      margin-top: 30px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .form-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    input[type="text"], input[type="email"] {
      padding: 8px;
      border-radius: 4px;
      border: 1px solid #ccc;
    }
    body.dark-theme input[type="text"],
    body.dark-theme input[type="email"] {
      background-color: #27272a;
      border-color: #393941;
      color: #e9e9ea;
    }
    .output {
      margin-top: 20px;
      padding: 16px;
      background-color: #f5f5f5;
      border-radius: 4px;
      transition: background-color 0.3s;
    }
    body.dark-theme .output {
      background-color: #27272a;
    }
    .list-container {
      margin-top: 20px;
    }
    .list-item {
      padding: 12px;
      margin-bottom: 8px;
      background-color: #f5f5f5;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background-color 0.3s;
    }
    body.dark-theme .list-item {
      background-color: #27272a;
    }
    .list-item button {
      background-color: #e25f73;
    }
    .list-item button:hover {
      background-color: #ef7a8b;
    }
  </style>
</head>
<body>
  <h1>Signalle DOM Example</h1>
  
  <div class="counter">
    <button id="decrement">-</button>
    <div class="counter-value" id="counter-value">0</div>
    <button id="increment">+</button>
  </div>
  
  <div id="doubledDisplay">Doubled: 0</div>
  
  <div class="toggle-container">
    <span>Dark Theme</span>
    <label class="toggle">
      <input type="checkbox" id="themeToggle">
      <span class="slider"></span>
    </label>
  </div>
  
  <div class="user-form">
    <h2>User Form</h2>
    <div class="form-row">
      <label for="nameInput">Name</label>
      <input type="text" id="nameInput" placeholder="Enter your name">
    </div>
    <div class="form-row">
      <label for="emailInput">Email</label>
      <input type="email" id="emailInput" placeholder="Enter your email">
    </div>
  </div>
  
  <div class="output" id="formOutput">
    Name: <span id="nameOutput"></span><br>
    Email: <span id="emailOutput"></span>
  </div>
  
  <div class="list-container">
    <h2>Dynamic List</h2>
    <button id="addItem">Add Item</button>
    <div id="listContainer"></div>
  </div>
</body>
</html>
`;

// Script runs when imported in a browser environment
if (typeof document !== "undefined") {
  // Insert HTML
  document.documentElement.innerHTML = html;

  // Wait for DOM to be ready
  document.addEventListener("DOMContentLoaded", async () => {
    // Import signals
    const { signal, computed } = await import("../src/index.mjs");
    const { bind, bindAttribute, bindClass, bindList, computedBind } =
      await import("../src/dom.mjs");

    // ------ Counter Example ------
    const counterValue = signal(0);

    // Bind counter value to DOM
    bind(document.getElementById("counter-value"), {
      property: "textContent",
      render: (value) => String(value),
    });

    // Set up event listeners
    document.getElementById("increment").addEventListener("click", () => {
      counterValue.value++;
    });

    document.getElementById("decrement").addEventListener("click", () => {
      counterValue.value--;
    });

    // Computed example
    const doubledValue = computed(counterValue, async (value) => value * 2);
    computedBind(document.getElementById("doubledDisplay"), doubledValue, {
      render: (value) => `Doubled: ${value}`,
    });

    // ------ Theme Toggle Example ------
    const darkTheme = signal(false);

    // Two-way binding for the checkbox
    bind(document.getElementById("themeToggle"), {
      property: "checked",
      events: ["change"],
      twoWay: true,
    });

    // Bind dark theme to body class
    bindClass(document.body, "dark-theme", darkTheme);

    // ------ User Form Example ------
    const userName = signal("");
    const userEmail = signal("");

    // Two-way binding for inputs
    bind(document.getElementById("nameInput"), {
      property: "value",
      events: ["input", "change"],
      twoWay: true,
    });

    bind(document.getElementById("emailInput"), {
      property: "value",
      events: ["input", "change"],
      twoWay: true,
    });

    // Output bindings
    bind(document.getElementById("nameOutput"), {
      render: (value) => value || "-",
    });

    bind(document.getElementById("emailOutput"), {
      render: (value) => value || "-",
    });

    // ------ Dynamic List Example ------
    const items = signal([
      { id: 1, text: "Item 1" },
      { id: 2, text: "Item 2" },
    ]);

    // Render function for list items
    const renderListItem = (item) => {
      const div = document.createElement("div");
      div.className = "list-item";

      const text = document.createElement("span");
      text.textContent = item.text;

      const button = document.createElement("button");
      button.textContent = "Remove";
      button.addEventListener("click", () => {
        items.update((current) => current.filter((i) => i.id !== item.id));
      });

      div.appendChild(text);
      div.appendChild(button);

      return div;
    };

    // Bind list to container
    bindList(document.getElementById("listContainer"), items, renderListItem);

    // Add item button
    document.getElementById("addItem").addEventListener("click", () => {
      const newId =
        items.value.length > 0
          ? Math.max(...items.value.map((i) => i.id)) + 1
          : 1;

      items.update((current) => [
        ...current,
        { id: newId, text: `Item ${newId}` },
      ]);
    });
  });
}

// Export for Node.js environments
export default html;
