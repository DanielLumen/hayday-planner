(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HayDayPlannerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeIngredients(ingredients) {
    const totals = new Map();
    for (const ingredient of Array.isArray(ingredients) ? ingredients : []) {
      if (!ingredient || !ingredient.i) continue;
      const quantity = Math.max(1, Number.parseInt(ingredient.q, 10) || 1);
      totals.set(ingredient.i, (totals.get(ingredient.i) || 0) + quantity);
    }
    return Array.from(totals, ([i, q]) => ({ i, q }));
  }

  function calculateNeeds(items, state) {
    const dependents = new Map(items.map((item) => [item.id, []]));
    for (const item of items) {
      for (const ingredient of item.ing || []) {
        if (!dependents.has(ingredient.i)) dependents.set(ingredient.i, []);
        dependents.get(ingredient.i).push({ id: item.id, q: ingredient.q });
      }
    }

    const needs = {};
    const visiting = new Set();
    function get(itemId) {
      if (Object.prototype.hasOwnProperty.call(needs, itemId)) return needs[itemId];
      if (visiting.has(itemId)) return 0;
      visiting.add(itemId);
      const downstream = (dependents.get(itemId) || []).reduce(
        (total, dependent) => total + get(dependent.id) * dependent.q,
        0,
      );
      visiting.delete(itemId);
      const itemState = state[itemId] || {};
      const stock = Math.max(0, Number.parseInt(itemState.stock, 10) || 0);
      const target = Math.max(1, Number.parseInt(itemState.target, 10) || 1);
      needs[itemId] = Math.max(0, target + downstream - stock);
      return needs[itemId];
    }

    for (const item of items) get(item.id);
    return needs;
  }

  function createsCycle(items, itemId, ingredients) {
    const itemMap = new Map(items.map((item) => [item.id, item]));
    function reachesItem(id, visited) {
      if (id === itemId) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      const item = itemMap.get(id);
      return Boolean(
        item &&
          (item.ing || []).some((ingredient) => reachesItem(ingredient.i, new Set(visited))),
      );
    }
    return normalizeIngredients(ingredients).some((ingredient) =>
      reachesItem(ingredient.i, new Set()),
    );
  }

  return { calculateNeeds, createsCycle, normalizeIngredients };
});
