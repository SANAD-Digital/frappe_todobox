/* ToDoBox: assemble the UI component from independent parts (divide and conquer)
   Each file in hub/ adds a function: (Base, React) => class extends Base { ... }
   and Component in the template = TTCompose(DCLogic, React) + state and lifecycle only. */
window.TTParts = window.TTParts || [];
window.TTCompose = function (Base, React) {
  return window.TTParts.reduce(function (B, part) { return part(B, React); }, Base);
};
