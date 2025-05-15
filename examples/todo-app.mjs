/**
 * Basic Todo App Example
 * 
 * This example shows how to use Signalle to create a simple todo application
 */

import { signal, computed, createEffect, batch } from '../src/signal.mjs';

// Create signals for our todo state
const todos = signal([
  { id: 1, text: 'Learn Signalle', completed: false },
  { id: 2, text: 'Build an app', completed: false }
]);

const newTodoText = signal('');
const filter = signal('all'); // 'all', 'active', 'completed'

// Computed signal for filtered todos
const filteredTodos = computed([todos, filter], async (allTodos, filterType) => {
  switch (filterType) {
    case 'active':
      return allTodos.filter(todo => !todo.completed);
    case 'completed':
      return allTodos.filter(todo => todo.completed);
    default:
      return allTodos;
  }
});

// Computed signal for remaining todos count
const remainingCount = computed(todos, async (allTodos) => {
  return allTodos.filter(todo => !todo.completed).length;
});

// Computed signal for completed todos count
const completedCount = computed(todos, async (allTodos) => {
  return allTodos.filter(todo => todo.completed).length;
});

// Function to add a new todo
const addTodo = () => {
  const text = newTodoText.value.trim();
  if (!text) return;
  
  todos.update(current => [
    ...current,
    {
      id: Date.now(),
      text,
      completed: false
    }
  ]);
  
  // Clear input
  newTodoText.value = '';
};

// Function to toggle todo completion
const toggleTodo = (id) => {
  todos.update(current => 
    current.map(todo => 
      todo.id === id 
        ? { ...todo, completed: !todo.completed } 
        : todo
    )
  );
};

// Function to remove a todo
const removeTodo = (id) => {
  todos.update(current => current.filter(todo => todo.id !== id));
};

// Function to clear completed todos
const clearCompleted = () => {
  todos.update(current => current.filter(todo => !todo.completed));
};

// Function to toggle all todos
const toggleAll = () => {
  // Check if all are completed
  const allCompleted = todos.value.every(todo => todo.completed);
  
  // Toggle all to the opposite state
  todos.update(current => 
    current.map(todo => ({ ...todo, completed: !allCompleted }))
  );
};

// Log state changes to console
createEffect(() => {
  console.log('Todos updated:', todos.value);
  console.log('Filtered todos:', filteredTodos.value);
  console.log(`${remainingCount.value} items left, ${completedCount.value} completed`);
});

// Example usage simulation
console.log('--- Initial State ---');

// Add a new todo
await batch(async () => {
  newTodoText.value = 'Write documentation';
  addTodo();
});

console.log('--- After adding a todo ---');

// Complete a todo
toggleTodo(1);

console.log('--- After completing a todo ---');

// Change filter
filter.value = 'active';

console.log('--- After filtering to active ---');

// Toggle all todos
toggleAll();

console.log('--- After toggling all ---');

// Clear completed
clearCompleted();

console.log('--- After clearing completed ---');
