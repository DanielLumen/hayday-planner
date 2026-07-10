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

console.log("core tests passed");
