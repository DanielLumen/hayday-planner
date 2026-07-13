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

  function allocateReadyQuantities(candidates, stock) {
    const available = {};
    for (const [id, quantity] of Object.entries(stock || {})) {
      available[id] = Math.max(0, Number.parseInt(quantity, 10) || 0);
    }

    return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
      const shortage = Math.max(0, Number.parseInt(candidate.shortage, 10) || 0);
      const ingredients = normalizeIngredients(candidate.ing);
      let readyQty = shortage;
      if (ingredients.length) {
        readyQty = Math.min(
          shortage,
          ...ingredients.map((ingredient) =>
            Math.floor((available[ingredient.i] || 0) / ingredient.q),
          ),
        );
      }
      readyQty = Math.max(0, readyQty);
      for (const ingredient of ingredients) {
        available[ingredient.i] = Math.max(
          0,
          (available[ingredient.i] || 0) - readyQty * ingredient.q,
        );
      }
      const readiness = readyQty >= shortage ? "ready" : readyQty > 0 ? "partial" : "blocked";
      return { ...candidate, ing: ingredients, readyQty, readiness };
    });
  }

  function rankShortages(items, state) {
    const needs = calculateNeeds(items, state);
    const useCounts = new Map(items.map((item) => [item.id, 0]));
    for (const item of items) {
      for (const ingredient of item.ing || []) {
        useCounts.set(ingredient.i, (useCounts.get(ingredient.i) || 0) + 1);
      }
    }

    return items
      .map((item) => {
        const itemState = state[item.id] || {};
        const stock = Math.max(0, Number.parseInt(itemState.stock, 10) || 0);
        const target = Math.max(1, Number.parseInt(itemState.target, 10) || 1);
        const ownShortage = Math.max(0, target - stock);
        const totalNeed = needs[item.id] || 0;
        const downstreamNeed = Math.max(0, totalNeed - ownShortage);
        const useCount = useCounts.get(item.id) || 0;
        const impact = 1 + Math.log2(useCount + 1);
        const score = totalNeed * impact + downstreamNeed * 2;
        return { id: item.id, totalNeed, ownShortage, downstreamNeed, useCount, score };
      })
      .filter((item) => item.totalNeed > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.downstreamNeed - a.downstreamNeed ||
          b.useCount - a.useCount ||
          b.totalNeed - a.totalNeed,
      );
  }

  return {
    allocateReadyQuantities,
    calculateNeeds,
    createsCycle,
    normalizeIngredients,
    rankShortages,
  };
});
