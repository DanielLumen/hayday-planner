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

  function positiveQuantity(value, fallback) {
    const quantity = Number(value);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : fallback;
  }

  function relationTarget(relation) {
    if (!relation || typeof relation !== "object") return "";
    return String(relation.i || relation.to || relation.id || "").trim();
  }

  function makeRelationEdge(from, relation, origin) {
    const to = relationTarget(relation);
    if (!to) return null;
    const quantity = Math.max(
      1,
      Number.parseInt(relation.q == null ? relation.quantity : relation.q, 10) || 1,
    );
    return {
      ...relation,
      from,
      to,
      i: to,
      q: quantity,
      quantity,
      origin,
    };
  }

  function canonicalCycle(path) {
    const ids = path.slice(0, -1);
    if (!ids.length) return { key: "", ids: [], path: [] };
    let best = ids;
    let bestKey = ids.join("\u0000");
    for (let index = 1; index < ids.length; index += 1) {
      const rotated = ids.slice(index).concat(ids.slice(0, index));
      const key = rotated.join("\u0000");
      if (key < bestKey) {
        best = rotated;
        bestKey = key;
      }
    }
    return { key: bestKey, ids: best, path: best.concat(best[0]) };
  }

  function analyzeProductionNetwork(items, options) {
    const itemList = Array.isArray(items) ? items : [];
    const settings = options && typeof options === "object" ? options : {};
    const relationsById =
      settings.relationsById && typeof settings.relationsById === "object"
        ? settings.relationsById
        : {};
    const requestedExternalIds =
      settings.externalIds instanceof Set
        ? Array.from(settings.externalIds)
        : Array.isArray(settings.externalIds)
          ? settings.externalIds
          : [];
    const externalSet = new Set(requestedExternalIds.map((id) => String(id)));
    const itemsById = Object.create(null);
    const itemOrder = [];

    for (const item of itemList) {
      if (!item || !item.id) continue;
      const id = String(item.id);
      if (!Object.prototype.hasOwnProperty.call(itemsById, id)) itemOrder.push(id);
      itemsById[id] = {
        ...item,
        id,
        ing: Array.isArray(item.ing) ? item.ing.map((ingredient) => ({ ...ingredient })) : [],
      };
    }

    const ingredientsById = Object.create(null);
    const dependentsById = Object.create(null);
    const edges = [];
    for (const id of itemOrder) {
      ingredientsById[id] = [];
      dependentsById[id] = [];
    }

    function appendRelations(from, relations, origin) {
      for (const relation of Array.isArray(relations) ? relations : []) {
        const edge = makeRelationEdge(from, relation, origin);
        if (!edge) continue;
        edges.push(edge);
        ingredientsById[from].push(edge);
        if (!dependentsById[edge.to]) dependentsById[edge.to] = [];
        dependentsById[edge.to].push(edge);
      }
    }

    for (const id of itemOrder) {
      appendRelations(id, itemsById[id].ing, "recipe");
      appendRelations(id, relationsById[id], "overlay");
    }

    const unknownIngredients = [];
    const unknownOrder = [];
    const seenUnknown = new Set();
    for (const edge of edges) {
      if (Object.prototype.hasOwnProperty.call(itemsById, edge.to)) continue;
      unknownIngredients.push({
        from: edge.from,
        id: edge.to,
        quantity: edge.q,
        edge,
      });
      if (!seenUnknown.has(edge.to)) {
        seenUnknown.add(edge.to);
        unknownOrder.push(edge.to);
        ingredientsById[edge.to] = [];
      }
    }

    const cycles = [];
    const seenCycles = new Set();
    const cycleIds = new Set();
    const visitState = Object.create(null);
    const stack = [];
    const stackIndexes = new Map();

    function visit(id) {
      visitState[id] = 1;
      stackIndexes.set(id, stack.length);
      stack.push(id);
      for (const edge of ingredientsById[id] || []) {
        if (!Object.prototype.hasOwnProperty.call(itemsById, edge.to)) continue;
        if (!visitState[edge.to]) {
          visit(edge.to);
        } else if (visitState[edge.to] === 1) {
          const cycleStart = stackIndexes.get(edge.to);
          const found = canonicalCycle(stack.slice(cycleStart).concat(edge.to));
          if (!seenCycles.has(found.key)) {
            seenCycles.add(found.key);
            cycles.push({ ids: found.ids, path: found.path });
          }
          found.ids.forEach((cycleId) => cycleIds.add(cycleId));
        }
      }
      stack.pop();
      stackIndexes.delete(id);
      visitState[id] = 2;
    }

    for (const id of itemOrder) {
      if (!visitState[id]) visit(id);
    }

    const rolesById = Object.create(null);
    const finalIds = [];
    const standaloneExternalIds = [];
    const unplacedIds = [];
    const knownExternalIds = [];
    for (const id of itemOrder) {
      const hasIngredients = ingredientsById[id].length > 0;
      const hasDependents = (dependentsById[id] || []).length > 0;
      const isExternal = externalSet.has(id);
      if (isExternal) knownExternalIds.push(id);
      let role;
      if (!hasIngredients && !hasDependents) {
        if (isExternal) {
          role = "external";
          standaloneExternalIds.push(id);
        } else {
          role = "unplaced";
          unplacedIds.push(id);
        }
      } else if (hasIngredients && !hasDependents && !isExternal) {
        role = "final";
        finalIds.push(id);
      } else if (hasIngredients && hasDependents) {
        role = "intermediate";
      } else if (!hasIngredients && hasDependents) {
        role = "raw";
      } else {
        role = "external";
      }
      rolesById[id] = role;
    }

    const reachable = new Set();
    function markReachable(id) {
      if (reachable.has(id) || !Object.prototype.hasOwnProperty.call(itemsById, id)) return;
      reachable.add(id);
      for (const edge of ingredientsById[id] || []) markReachable(edge.to);
    }
    finalIds.forEach(markReachable);
    const standaloneSet = new Set(standaloneExternalIds.concat(unplacedIds));
    const unrootedIds = itemOrder.filter((id) => !reachable.has(id) && !standaloneSet.has(id));

    const nodes = itemOrder.map((id) => ({
      ...itemsById[id],
      known: true,
      role: rolesById[id],
      isExternal: externalSet.has(id),
      inCycle: cycleIds.has(id),
      ingredientCount: ingredientsById[id].length,
      dependentCount: (dependentsById[id] || []).length,
    }));
    for (const id of unknownOrder) {
      nodes.push({
        id,
        known: false,
        role: "unknown",
        isExternal: false,
        inCycle: false,
        ingredientCount: 0,
        dependentCount: (dependentsById[id] || []).length,
      });
      rolesById[id] = "unknown";
    }

    return {
      nodes,
      edges,
      finalIds,
      externalIds: knownExternalIds,
      standaloneExternalIds,
      unplacedIds,
      standaloneIds: standaloneExternalIds.concat(unplacedIds),
      unrootedIds,
      unknownIngredients,
      cycles,
      itemsById,
      ingredientsById,
      dependentsById,
      rolesById,
    };
  }

  function expandProductionTree(network, rootId, options) {
    const graph = network && typeof network === "object" ? network : {};
    const settings = options && typeof options === "object" ? options : {};
    const ingredientsById = graph.ingredientsById || Object.create(null);
    const itemsById = graph.itemsById || Object.create(null);
    const rolesById = graph.rolesById || Object.create(null);
    const rootQuantity = positiveQuantity(settings.quantity, 1);
    const requestedDepth = Number(settings.maxDepth);
    const maxDepth = Number.isFinite(requestedDepth) && requestedDepth >= 0
      ? Math.floor(requestedDepth)
      : Infinity;

    function build(id, relation, totalQty, depth, ancestors) {
      const cycleStart = ancestors.indexOf(id);
      const known = Object.prototype.hasOwnProperty.call(itemsById, id);
      const unitQty = relation ? positiveQuantity(relation.q, 1) : 1;
      const base = {
        id,
        item: known ? itemsById[id] : null,
        known,
        status: cycleStart >= 0 ? "cycle" : known ? "known" : "unknown",
        role: rolesById[id] || "unknown",
        depth,
        unitQty,
        directQty: unitQty,
        totalQty,
        relation: relation || null,
        edge: relation || null,
        children: [],
      };
      if (relation) {
        for (const key of ["kind", "mode", "label", "outputQty"]) {
          if (Object.prototype.hasOwnProperty.call(relation, key)) base[key] = relation[key];
        }
      }
      if (cycleStart >= 0) {
        base.cyclePath = ancestors.slice(cycleStart).concat(id);
        return base;
      }
      const relations = ingredientsById[id] || [];
      if (!known || depth >= maxDepth) {
        if (known && relations.length) base.truncated = true;
        return base;
      }
      const nextAncestors = ancestors.concat(id);
      base.children = relations.map((childRelation) => {
        const childQuantity = positiveQuantity(childRelation.q, 1);
        return build(
          childRelation.to,
          childRelation,
          totalQty * childQuantity,
          depth + 1,
          nextAncestors,
        );
      });
      return base;
    }

    return build(String(rootId), null, rootQuantity, 0, []);
  }

  function layoutProductionNetwork(network, options) {
    const graph = network && typeof network === "object" ? network : {};
    const settings = options && typeof options === "object" ? options : {};
    const ingredientsById = graph.ingredientsById || Object.create(null);
    const dependentsById = graph.dependentsById || Object.create(null);
    const itemsById = graph.itemsById || Object.create(null);
    const rolesById = graph.rolesById || Object.create(null);
    const roots = (Array.isArray(settings.rootIds) ? settings.rootIds : graph.finalIds || [])
      .map((id) => String(id))
      .filter((id, index, ids) => id && ids.indexOf(id) === index);
    const nodeWidth = positiveQuantity(settings.nodeWidth, 128);
    const nodeHeight = positiveQuantity(settings.nodeHeight, 26);
    const rowGap = Math.max(0, Number(settings.rowGap) || 5);
    const columnGap = Math.max(0, Number(settings.columnGap) || 10);
    const bandGap = Math.max(20, Number(settings.bandGap) || 110);
    const padding = Math.max(0, Number(settings.padding) || 24);
    const headerHeight = Math.max(0, Number(settings.headerHeight) || 34);
    const targetAspect = positiveQuantity(settings.targetAspect, 1.85);
    const depthById = Object.create(null);
    const included = new Set();

    function visit(id, depth, path) {
      if (path.has(id)) return;
      included.add(id);
      const previous = depthById[id];
      if (previous != null && previous >= depth) return;
      depthById[id] = depth;
      const nextPath = new Set(path);
      nextPath.add(id);
      for (const edge of ingredientsById[id] || []) visit(edge.to, depth + 1, nextPath);
    }

    for (const rootId of roots) visit(rootId, 0, new Set());
    const ids = Array.from(included);
    const maxDepth = ids.reduce((maximum, id) => Math.max(maximum, depthById[id] || 0), 0);
    const layers = Array.from({ length: maxDepth + 1 }, () => []);
    for (const id of ids) layers[depthById[id] || 0].push(id);

    function nodeLabel(id) {
      const item = itemsById[id];
      return String((item && (item.nameCN || item.name)) || id);
    }

    const orderById = Object.create(null);
    layers.forEach((layer, depth) => {
      layer.sort((left, right) => {
        if (depth > 0) {
          const leftParents = (dependentsById[left] || [])
            .map((edge) => orderById[edge.from])
            .filter((rank) => Number.isFinite(rank));
          const rightParents = (dependentsById[right] || [])
            .map((edge) => orderById[edge.from])
            .filter((rank) => Number.isFinite(rank));
          const leftRank = leftParents.length
            ? leftParents.reduce((sum, rank) => sum + rank, 0) / leftParents.length
            : Number.MAX_SAFE_INTEGER;
          const rightRank = rightParents.length
            ? rightParents.reduce((sum, rank) => sum + rank, 0) / rightParents.length
            : Number.MAX_SAFE_INTEGER;
          if (leftRank !== rightRank) return leftRank - rightRank;
        }
        return nodeLabel(left).localeCompare(nodeLabel(right), "zh-CN") || left.localeCompare(right);
      });
      layer.forEach((id, index) => {
        orderById[id] = index;
      });
    });

    const pitch = nodeHeight + rowGap;
    function dimensionsForRows(rowsPerColumn) {
      const bands = layers.map((layer) => {
        const columns = Math.max(1, Math.ceil(layer.length / rowsPerColumn));
        return {
          columns,
          width: columns * nodeWidth + Math.max(0, columns - 1) * columnGap,
          rows: Math.min(rowsPerColumn, Math.max(1, layer.length)),
        };
      });
      const width = padding * 2 + bands.reduce((sum, band) => sum + band.width, 0)
        + Math.max(0, bands.length - 1) * bandGap;
      const height = padding * 2 + headerHeight
        + Math.max(1, ...bands.map((band) => band.rows)) * pitch - rowGap;
      return { bands, width, height };
    }

    let rowsPerColumn = Number.parseInt(settings.rowsPerColumn, 10);
    if (!Number.isFinite(rowsPerColumn) || rowsPerColumn < 1) {
      let bestRows = 36;
      let bestScore = Infinity;
      for (let candidate = 28; candidate <= 64; candidate += 1) {
        const measured = dimensionsForRows(candidate);
        const score = Math.abs(Math.log((measured.width / measured.height) / targetAspect));
        if (score < bestScore) {
          bestRows = candidate;
          bestScore = score;
        }
      }
      rowsPerColumn = bestRows;
    }

    const measured = dimensionsForRows(rowsPerColumn);
    const bandLabels = ["最终产物", "直接原料", "二级原料", "三级原料"];
    let bandX = padding;
    const bands = measured.bands.map((band, depth) => {
      const result = {
        depth,
        x: bandX,
        y: padding,
        width: band.width,
        height: measured.height - padding * 2,
        count: layers[depth].length,
        columns: band.columns,
        label: bandLabels[depth] || `第 ${depth} 层原料`,
      };
      bandX += band.width + bandGap;
      return result;
    });

    const nodes = [];
    const positionedById = Object.create(null);
    layers.forEach((layer, depth) => {
      const band = bands[depth];
      layer.forEach((id, index) => {
        const column = Math.floor(index / rowsPerColumn);
        const row = index % rowsPerColumn;
        const remaining = layer.length - column * rowsPerColumn;
        const rowsInColumn = Math.min(rowsPerColumn, remaining);
        const yOffset = (Math.min(rowsPerColumn, Math.max(1, band.count)) - rowsInColumn) * pitch / 2;
        const node = {
          id,
          depth,
          role: rolesById[id] || "unknown",
          known: Object.prototype.hasOwnProperty.call(itemsById, id),
          x: band.x + column * (nodeWidth + columnGap),
          y: padding + headerHeight + yOffset + row * pitch,
          width: nodeWidth,
          height: nodeHeight,
        };
        nodes.push(node);
        positionedById[id] = node;
      });
    });

    const edges = [];
    for (const from of ids) {
      for (const edge of ingredientsById[from] || []) {
        if (!positionedById[edge.to]) continue;
        edges.push({ ...edge, from, to: edge.to });
      }
    }

    return {
      bands,
      depthById,
      edges,
      height: measured.height,
      maxDepth,
      nodes,
      positionedById,
      rootIds: roots,
      rowsPerColumn,
      width: measured.width,
    };
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
    analyzeProductionNetwork,
    allocateReadyQuantities,
    calculateNeeds,
    createsCycle,
    expandProductionTree,
    layoutProductionNetwork,
    normalizeIngredients,
    rankShortages,
  };
});
