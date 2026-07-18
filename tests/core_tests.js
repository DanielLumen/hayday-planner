"use strict";

const assert = require("node:assert/strict");
const core = require("../planner-core");
const itemImages = require("../item-image-store");
const placeholderIconIds = require("../icon-status");
const catalogMigration = require("../catalog-migration");

assert.equal(placeholderIconIds.includes("bacon_omelet"), true);
assert.equal(placeholderIconIds.includes("bread"), false);

const legacyBackup = {
  version: 3,
  items: {
    fish_taco: { n: 2, tg: 4 },
    veggie_taco: { n: 7, tg: 6 },
    peanut: { n: 9, tg: 5 },
  },
  edits: {
    mod: {
      veggie_taco: { bld: "hotdog_stand", ing: [{ i: "soybean", q: 2 }] },
    },
    add: [],
    del: ["apple_donut"],
  },
  checked: { peanut: true },
  itemOrders: { hotdog_stand: ["veggie_taco", "fish_taco"] },
  filterOrder: [{ bld: "hotdog_stand" }],
  order: ["hotdog_stand"],
  itemImages: { peanut: { id: "peanut", dataUrl: "data:image/png;base64,AA==" } },
};
const migratedBackup = catalogMigration.migrateBackupData(legacyBackup);
assert.equal(migratedBackup.version, 4);
assert.equal(migratedBackup.catalogIdVersion, 2);
assert.deepEqual(migratedBackup.items.fish_taco, { n: 7, tg: 6 });
assert.deepEqual(migratedBackup.items.taco, { n: 2, tg: 4 });
assert.deepEqual(migratedBackup.items.peanuts, { n: 9, tg: 5 });
assert.equal(migratedBackup.edits.mod.fish_taco.bld, "hot_dog_stand");
assert.deepEqual(migratedBackup.edits.mod.fish_taco.ing, [{ i: "soyabean", q: 2 }]);
assert.deepEqual(migratedBackup.edits.del, ["bacon_donut"]);
assert.deepEqual(migratedBackup.itemOrders.hot_dog_stand, ["fish_taco", "taco"]);
assert.equal(migratedBackup.itemImages.peanuts.id, "peanuts");
assert.deepEqual(catalogMigration.migrateBackupData(migratedBackup), migratedBackup);

const storedMigration = catalogMigration.migrateStoredValues({
  hd_inv: JSON.stringify(legacyBackup.items),
  hd_edits: JSON.stringify(legacyBackup.edits),
  hd_checked: JSON.stringify(legacyBackup.checked),
});
assert.equal(storedMigration.migrated, true);
assert.equal(storedMigration.values.hd_catalog_id_version, "2");
assert.deepEqual(JSON.parse(storedMigration.values.hd_inv), migratedBackup.items);
assert.deepEqual(
  catalogMigration.migrateStoredValues(storedMigration.values),
  { values: storedMigration.values, changedKeys: [], migrated: false },
);

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const normalizedImage = itemImages.normalizeRecord("bread", { dataUrl: tinyPng, width: 1, height: 1, updatedAt: "2026-07-16T00:00:00.000Z" });
assert.deepEqual(normalizedImage, {
  id: "bread",
  dataUrl: tinyPng,
  mimeType: "image/png",
  width: 1,
  height: 1,
  updatedAt: "2026-07-16T00:00:00.000Z",
});
assert.equal(itemImages.normalizeRecord("bread", { dataUrl: "https://example.com/image.png" }), null);
assert.equal(itemImages.normalizeRecord("", { dataUrl: tinyPng }), null);
assert.deepEqual(itemImages.normalizeBackup({ bread: normalizedImage, unsafe: { dataUrl: "javascript:alert(1)" } }), [normalizedImage]);
assert.equal(itemImages.shouldReplace(null, normalizedImage), true);
assert.equal(itemImages.shouldReplace({ updatedAt: "2026-07-17T00:00:00.000Z" }, normalizedImage), false);
assert.equal(itemImages.shouldReplace({ updatedAt: "2026-07-15T00:00:00.000Z" }, normalizedImage), true);
assert.equal(itemImages.shouldReplace({ updatedAt: "" }, normalizedImage), false);
assert.equal(typeof itemImages.migrateIds, "function");

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

const demandItems = [
  { id: "wheat", nameCN: "小麦", t: 120, ing: [] },
  { id: "corn", nameCN: "玉米", t: 300, ing: [] },
  { id: "cow_feed", nameCN: "奶牛饲料", bld: "feed_mill", t: 600, ing: [{ i: "wheat", q: 2 }, { i: "corn", q: 1 }] },
  { id: "milk", nameCN: "牛奶", bld: "cow", t: 1200, ing: [] },
  { id: "red_lure", nameCN: "红色鱼饵", t: 1800, ing: [] },
  { id: "fishing_net", nameCN: "渔网", t: 3600, ing: [] },
  { id: "fish_fillet", nameCN: "鱼片", t: 0, ing: [] },
];
const demandNetwork = core.analyzeProductionNetwork(demandItems, {
  relationsById: {
    milk: [{ i: "cow_feed", q: 1, label: "每份需 1 袋饲料" }],
    fish_fillet: [
      { i: "red_lure", q: 1, mode: "alternative", label: "每片需 1 个鱼饵" },
      { i: "fishing_net", q: 1, mode: "alternative", outputQty: 3, label: "每 3 片需 1 张" },
    ],
  },
});
const demandInventory = { milk: 0, cow_feed: 0, wheat: 10, corn: 1 };
const demandInventoryBefore = JSON.parse(JSON.stringify(demandInventory));
const milkDemand = core.simulateProductionDemand(demandNetwork, "milk", 5, demandInventory, {
  batchOutputs: { cow_feed: 3 },
});
assert.deepEqual(demandInventory, demandInventoryBefore);
assert.equal(milkDemand.root.productionNeeded, 5);
assert.deepEqual(
  milkDemand.tasks.map(({ id, productionNeeded, produced, batches, surplus }) => ({ id, productionNeeded, produced, batches, surplus })),
  [
    { id: "cow_feed", productionNeeded: 5, produced: 6, batches: 2, surplus: 1 },
    { id: "milk", productionNeeded: 5, produced: 5, batches: 5, surplus: 0 },
  ],
);
assert.deepEqual(milkDemand.shortages.map(({ id, shortage }) => ({ id, shortage })), [{ id: "corn", shortage: 1 }]);
assert.deepEqual(milkDemand.equipment.map(({ id, batches }) => ({ id, batches })), [
  { id: "feed_mill", batches: 2 },
  { id: "cow", batches: 5 },
]);
assert.deepEqual(milkDemand.criticalPath.ids, ["milk", "cow_feed", "corn"]);
assert.equal(milkDemand.nodeIds.includes("wheat") && milkDemand.edgeKeys.includes("milk\u0000cow_feed"), true);

const fishDemand = core.simulateProductionDemand(
  demandNetwork,
  "fish_fillet",
  5,
  { red_lure: 5, fishing_net: 0 },
);
assert.deepEqual(fishDemand.alternatives, [{ from: "fish_fillet", to: "red_lure", quantity: 5, optionCount: 2 }]);
assert.equal(fishDemand.nodeIds.includes("red_lure"), true);
assert.equal(fishDemand.nodeIds.includes("fishing_net"), false);
assert.deepEqual(fishDemand.shortages, []);

const netDemand = core.simulateProductionDemand(
  demandNetwork,
  "fish_fillet",
  5,
  { red_lure: 0, fishing_net: 2 },
);
assert.deepEqual(netDemand.alternatives, [{ from: "fish_fillet", to: "fishing_net", quantity: 2, optionCount: 2 }]);
assert.equal(netDemand.inventoryAfter.fishing_net, 0);
assert.deepEqual(netDemand.shortages, []);

const sharedBatchNetwork = core.analyzeProductionNetwork([
  { id: "wheat", ing: [] },
  { id: "corn", ing: [] },
  { id: "cow_feed", ing: [{ i: "wheat", q: 2 }, { i: "corn", q: 1 }] },
  { id: "left", ing: [{ i: "cow_feed", q: 2 }] },
  { id: "right", ing: [{ i: "cow_feed", q: 2 }] },
  { id: "root", ing: [{ i: "left", q: 1 }, { i: "right", q: 1 }] },
]);
const sharedBatchDemand = core.simulateProductionDemand(sharedBatchNetwork, "root", 1, {}, {
  batchOutputs: { cow_feed: 3 },
});
assert.deepEqual(
  (({ requested, stockUsed, productionNeeded, produced, batches, surplus }) => ({ requested, stockUsed, productionNeeded, produced, batches, surplus }))(sharedBatchDemand.totalsById.cow_feed),
  { requested: 4, stockUsed: 0, productionNeeded: 3, produced: 6, batches: 2, surplus: 2 },
);
assert.equal(sharedBatchDemand.inventoryAfter.cow_feed, 2);

const cycleDemand = core.simulateProductionDemand(network, "cycle_a", 1, {});
assert.deepEqual(cycleDemand.cycles, [["cycle_a", "cycle_b", "cycle_a"]]);
assert.equal(cycleDemand.shortages.some(({ id, shortage }) => id === "cycle_a" && shortage === 1), true);

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
