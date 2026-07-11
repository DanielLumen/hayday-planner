"use strict";

const assert = require("node:assert/strict");
const core = require("../planner-core");

const items = [
  { id: "wheat", ing: [] },
  { id: "bread", ing: [{ i: "wheat", q: 3 }] },
  { id: "sandwich", ing: [{ i: "bread", q: 2 }] },
];

const needs = core.calculateNeeds(items, {
  wheat: { stock: 20, target: 10 },
  bread: { stock: 2, target: 5 },
  sandwich: { stock: 4, target: 5 },
});

assert.deepEqual(needs, { sandwich: 1, bread: 5, wheat: 5 });
assert.deepEqual(core.normalizeIngredients([{ i: "wheat", q: 2 }, { i: "wheat", q: 3 }]), [
  { i: "wheat", q: 5 },
]);
assert.equal(core.createsCycle(items, "wheat", [{ i: "sandwich", q: 1 }]), true);
assert.equal(core.createsCycle(items, "sandwich", [{ i: "wheat", q: 1 }]), false);

const ranked = core.rankShortages(items, {
  wheat: { stock: 0, target: 2 },
  bread: { stock: 0, target: 2 },
  sandwich: { stock: 1, target: 2 },
});
assert.equal(ranked[0].id, "wheat");
assert.deepEqual(
  ranked.find((item) => item.id === "wheat"),
  { id: "wheat", totalNeed: 14, ownShortage: 2, downstreamNeed: 12, useCount: 1, score: 52 },
);

console.log("core tests passed");
