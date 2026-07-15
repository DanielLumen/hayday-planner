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

const allocated = core.allocateReadyQuantities(
  [
    { id: "bread", shortage: 2, ing: [{ i: "wheat", q: 3 }] },
    { id: "cookie", shortage: 2, ing: [{ i: "wheat", q: 2 }] },
    { id: "corn", shortage: 4, ing: [] },
  ],
  { wheat: 8 },
);
assert.deepEqual(
  allocated.map(({ id, readyQty, readiness }) => ({ id, readyQty, readiness })),
  [
    { id: "bread", readyQty: 2, readiness: "ready" },
    { id: "cookie", readyQty: 1, readiness: "partial" },
    { id: "corn", readyQty: 4, readiness: "ready" },
  ],
);

const relationItems = [
  { id: "wheat", ing: [] },
  { id: "corn", ing: [] },
  { id: "cow_feed", ing: [{ i: "corn", q: 1 }, { i: "wheat", q: 2 }] },
  { id: "milk", ing: [] },
  { id: "cream", ing: [{ i: "milk", q: 2 }] },
  {
    id: "cake",
    ing: [{ i: "cream", q: 2 }, { i: "wheat", q: 3 }, { i: "mystery", q: 4 }],
  },
  { id: "red_lure", bld: "lure_workbench", ing: [] },
  { id: "hammer", ing: [] },
  { id: "diamond", ing: [] },
  { id: "ring", ing: [{ i: "diamond", q: 1 }] },
  { id: "cycle_a", ing: [{ i: "cycle_b", q: 1 }] },
  { id: "cycle_b", ing: [{ i: "cycle_a", q: 1 }] },
];
const originalRelationItems = JSON.parse(JSON.stringify(relationItems));
const milkSourceRelation = {
  i: "cow_feed",
  q: 1,
  kind: "source",
  mode: "animal-feed",
  label: "喂养奶牛",
  outputQty: 3,
};
const network = core.analyzeProductionNetwork(relationItems, {
  externalIds: ["hammer", "diamond"],
  relationsById: { milk: [milkSourceRelation] },
});

assert.deepEqual(relationItems, originalRelationItems);
assert.deepEqual(network.finalIds, ["cake", "ring"]);
assert.deepEqual(network.standaloneExternalIds, ["hammer"]);
assert.deepEqual(network.unplacedIds, ["red_lure"]);
assert.equal(network.rolesById.cake, "final");
assert.equal(network.rolesById.cream, "intermediate");
assert.equal(network.rolesById.wheat, "raw");
assert.equal(network.rolesById.diamond, "raw");
assert.equal(network.rolesById.red_lure, "unplaced");

const milkRelations = network.ingredientsById.milk;
assert.equal(milkRelations.length, 1);
assert.deepEqual(
  (({ from, to, q, quantity, kind, mode, label, outputQty, origin }) => ({
    from,
    to,
    q,
    quantity,
    kind,
    mode,
    label,
    outputQty,
    origin,
  }))(milkRelations[0]),
  {
    from: "milk",
    to: "cow_feed",
    q: 1,
    quantity: 1,
    kind: "source",
    mode: "animal-feed",
    label: "喂养奶牛",
    outputQty: 3,
    origin: "overlay",
  },
);
assert.deepEqual(relationItems.find((item) => item.id === "milk").ing, []);

assert.deepEqual(
  network.unknownIngredients.map(({ from, id, quantity }) => ({ from, id, quantity })),
  [{ from: "cake", id: "mystery", quantity: 4 }],
);
assert.equal(network.nodes.find((node) => node.id === "mystery").role, "unknown");
assert.deepEqual(network.cycles, [
  { ids: ["cycle_a", "cycle_b"], path: ["cycle_a", "cycle_b", "cycle_a"] },
]);
assert.deepEqual(network.unrootedIds, ["cycle_a", "cycle_b"]);

const cakeTree = core.expandProductionTree(network, "cake", { quantity: 2 });
const creamNode = cakeTree.children.find((node) => node.id === "cream");
const directWheatNode = cakeTree.children.find((node) => node.id === "wheat");
const mysteryNode = cakeTree.children.find((node) => node.id === "mystery");
const milkNode = creamNode.children.find((node) => node.id === "milk");
const feedNode = milkNode.children.find((node) => node.id === "cow_feed");
const feedWheatNode = feedNode.children.find((node) => node.id === "wheat");
assert.deepEqual(
  {
    root: cakeTree.totalQty,
    creamUnit: creamNode.unitQty,
    creamTotal: creamNode.totalQty,
    milkUnit: milkNode.unitQty,
    milkTotal: milkNode.totalQty,
    feedTotal: feedNode.totalQty,
    feedWheatUnit: feedWheatNode.unitQty,
    feedWheatTotal: feedWheatNode.totalQty,
    directWheatTotal: directWheatNode.totalQty,
    mysteryTotal: mysteryNode.totalQty,
  },
  {
    root: 2,
    creamUnit: 2,
    creamTotal: 4,
    milkUnit: 2,
    milkTotal: 8,
    feedTotal: 8,
    feedWheatUnit: 2,
    feedWheatTotal: 16,
    directWheatTotal: 6,
    mysteryTotal: 8,
  },
);
assert.equal(mysteryNode.status, "unknown");
assert.deepEqual(
  (({ kind, mode, label, outputQty }) => ({ kind, mode, label, outputQty }))(feedNode),
  { kind: "source", mode: "animal-feed", label: "喂养奶牛", outputQty: 3 },
);

const cycleTree = core.expandProductionTree(network, "cycle_a");
const repeatedCycleNode = cycleTree.children[0].children[0];
assert.equal(repeatedCycleNode.status, "cycle");
assert.deepEqual(repeatedCycleNode.cyclePath, ["cycle_a", "cycle_b", "cycle_a"]);
assert.deepEqual(repeatedCycleNode.children, []);

const sharedNetwork = core.analyzeProductionNetwork([
  { id: "wheat", ing: [] },
  { id: "left", ing: [{ i: "wheat", q: 2 }] },
  { id: "right", ing: [{ i: "wheat", q: 3 }] },
  { id: "root", ing: [{ i: "left", q: 1 }, { i: "right", q: 1 }] },
]);
const sharedTree = core.expandProductionTree(sharedNetwork, "root");
const sharedWheatNodes = sharedTree.children.flatMap((branch) => branch.children);
assert.equal(sharedNetwork.nodes.filter((node) => node.id === "wheat").length, 1);
assert.deepEqual(sharedWheatNodes.map((node) => node.totalQty), [2, 3]);
assert.equal(sharedWheatNodes.every((node) => node.status === "known"), true);

const appendedNetwork = core.analyzeProductionNetwork(
  [{ id: "raw_a", ing: [] }, { id: "raw_b", ing: [] }, { id: "product", ing: [{ i: "raw_a", q: 2 }] }],
  { relationsById: { product: [{ i: "raw_b", q: 3, label: "补充来源" }] } },
);
assert.deepEqual(
  appendedNetwork.ingredientsById.product.map(({ to, q, origin }) => ({ to, q, origin })),
  [
    { to: "raw_a", q: 2, origin: "recipe" },
    { to: "raw_b", q: 3, origin: "overlay" },
  ],
);

const graphLayout = core.layoutProductionNetwork(network, { rowsPerColumn: 2 });
assert.equal(graphLayout.positionedById.cake.depth, 0);
assert.equal(graphLayout.positionedById.ring.depth, 0);
assert.equal(graphLayout.positionedById.cream.depth > graphLayout.positionedById.cake.depth, true);
assert.equal(graphLayout.positionedById.milk.depth > graphLayout.positionedById.cream.depth, true);
assert.equal(graphLayout.positionedById.cow_feed.depth > graphLayout.positionedById.milk.depth, true);
assert.equal(graphLayout.nodes.some((node) => node.id === "hammer"), false);
assert.equal(graphLayout.nodes.some((node) => node.id === "red_lure"), false);
assert.equal(
  graphLayout.edges.every((edge) =>
    graphLayout.positionedById[edge.to].depth > graphLayout.positionedById[edge.from].depth),
  true,
);
assert.equal(graphLayout.bands[0].columns, 1);
assert.equal(graphLayout.width > 0 && graphLayout.height > 0, true);

console.log("core tests passed");
