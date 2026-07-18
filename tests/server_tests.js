"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createServer,
  isSameOrigin,
  loadData,
  parseStoredData,
  revisionForData,
  resolveStaticPath,
  validateIncoming,
} = require("../server");

const root = path.resolve(__dirname, "..");
assert.equal(resolveStaticPath("/"), path.join(root, "index.html"));
assert.equal(resolveStaticPath("/icons/wheat.png"), path.join(root, "icons", "wheat.png"));
assert.equal(resolveStaticPath("/planner-core.js"), path.join(root, "planner-core.js"));
assert.equal(resolveStaticPath("/catalog-migration.js"), path.join(root, "catalog-migration.js"));
assert.equal(resolveStaticPath("/icon-status.js"), path.join(root, "icon-status.js"));
assert.equal(resolveStaticPath("/item-image-store.js"), path.join(root, "item-image-store.js"));
assert.equal(resolveStaticPath("/catalog-mapping.html"), path.join(root, "catalog-mapping.html"));
assert.equal(resolveStaticPath("/catalog-mapping.css"), path.join(root, "catalog-mapping.css"));
assert.equal(resolveStaticPath("/catalog-mapping.js"), path.join(root, "catalog-mapping.js"));
assert.equal(resolveStaticPath("/catalog-mapping-data.js"), path.join(root, "catalog-mapping-data.js"));
assert.equal(resolveStaticPath("/catalog-id-image-mapping.json"), path.join(root, "catalog-id-image-mapping.json"));
assert.equal(resolveStaticPath("/catalog-reference.json"), path.join(root, "catalog-reference.json"));
assert.equal(resolveStaticPath("/catalog-local-base.json"), path.join(root, "catalog-local-base.json"));
assert.equal(resolveStaticPath("/node_modules/pinyin-pro/dist/index.js"), path.join(root, "node_modules", "pinyin-pro", "dist", "index.js"));
assert.equal(resolveStaticPath("/../package.json"), null);
assert.equal(resolveStaticPath("/%2e%2e/package.json"), null);
assert.equal(resolveStaticPath("/.git/config"), null);
assert.equal(resolveStaticPath("/backup/hayday_backup_2026-07-11.json"), null);
assert.equal(resolveStaticPath("/package.json"), null);
assert.equal(resolveStaticPath("/data.json"), null);
assert.equal(typeof loadData(), "object");
assert.deepEqual(parseStoredData(Buffer.from("\ufeff{\"hd_inv\":\"{}\"}")), { hd_inv: "{}" });
assert.throws(() => parseStoredData("[]"), /JSON object/);
assert.throws(() => parseStoredData("not json"), SyntaxError);

assert.equal(validateIncoming({ hd_inv: "{}", hd_edits: "{}" }), true);
assert.equal(validateIncoming({ config: "{}" }), false);
assert.equal(validateIncoming({ hd_inv: {} }), false);
assert.equal(validateIncoming([]), false);
assert.equal(revisionForData({ hd_inv: "{}" }), revisionForData({ hd_inv: "{}" }));

assert.equal(isSameOrigin({ headers: { host: "127.0.0.1:8766" } }), true);
assert.equal(
  isSameOrigin({ headers: { host: "127.0.0.1:8766", origin: "http://127.0.0.1:8766" } }),
  true,
);
assert.equal(
  isSameOrigin({ headers: { host: "127.0.0.1:8766", origin: "https://example.com" } }),
  false,
);

async function testRevisionProtectedSave() {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hayday-server-test-"));
  const tempDataFile = path.join(tempDirectory, "data.json");
  const original = { hd_inv: '{"wheat":{"n":20}}', hd_edits: '{"mod":{"bread":{}}}' };
  fs.writeFileSync(tempDataFile, `${JSON.stringify(original, null, 2)}\n`, "utf8");
  const server = createServer({ dataFile: tempDataFile });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/save`;
    const firstRead = await fetch(url);
    const firstRevision = firstRead.headers.get("x-hayday-revision");
    assert.equal(firstRead.status, 200);
    assert.equal(firstRevision, revisionForData(original));

    const missingRevision = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hd_inv: '{"wheat":{"n":0}}' }),
    });
    assert.equal(missingRevision.status, 428);
    assert.deepEqual(parseStoredData(fs.readFileSync(tempDataFile)), original);

    const accepted = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "If-Match": `"${firstRevision}"` },
      body: JSON.stringify({ hd_inv: '{"wheat":{"n":21}}' }),
    });
    const secondRevision = accepted.headers.get("x-hayday-revision");
    assert.equal(accepted.status, 200);
    assert.notEqual(secondRevision, firstRevision);

    const stale = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "If-Match": `"${firstRevision}"` },
      body: JSON.stringify({ hd_inv: '{"wheat":{"n":0}}' }),
    });
    assert.equal(stale.status, 409);
    assert.equal(JSON.parse(parseStoredData(fs.readFileSync(tempDataFile)).hd_inv).wheat.n, 21);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

testRevisionProtectedSave().then(() => console.log("server tests passed")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
