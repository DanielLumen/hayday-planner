"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {
  isSameOrigin,
  loadData,
  resolveStaticPath,
  validateIncoming,
} = require("../server");

const root = path.resolve(__dirname, "..");
assert.equal(resolveStaticPath("/"), path.join(root, "index.html"));
assert.equal(resolveStaticPath("/icons/wheat.png"), path.join(root, "icons", "wheat.png"));
assert.equal(resolveStaticPath("/../package.json"), null);
assert.equal(resolveStaticPath("/%2e%2e/package.json"), null);
assert.equal(typeof loadData(), "object");

assert.equal(validateIncoming({ hd_inv: "{}", hd_edits: "{}" }), true);
assert.equal(validateIncoming({ config: "{}" }), false);
assert.equal(validateIncoming({ hd_inv: {} }), false);
assert.equal(validateIncoming([]), false);

assert.equal(isSameOrigin({ headers: { host: "127.0.0.1:8766" } }), true);
assert.equal(
  isSameOrigin({ headers: { host: "127.0.0.1:8766", origin: "http://127.0.0.1:8766" } }),
  true,
);
assert.equal(
  isSameOrigin({ headers: { host: "127.0.0.1:8766", origin: "https://example.com" } }),
  false,
);

console.log("server tests passed");
