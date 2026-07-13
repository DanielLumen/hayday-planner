const http = require("http");
const fs = require("fs");
const path = require("path");

const base = __dirname;
const dataFile = path.join(base, "data.json");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8766);
const maxBodySize = 2 * 1024 * 1024;
const publicFiles = new Set([
  "index.html",
  "planner-core.js",
  "node_modules/pinyin-pro/dist/index.js",
]);

const contentTypes = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml; charset=utf-8",
};

function send(res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(body);
}

function parseStoredData(raw) {
  let bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf-8");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.slice(3);
  const data = JSON.parse(bytes.toString("utf-8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("data file must contain a JSON object");
  }
  return data;
}

function loadData() {
  try {
    return parseStoredData(fs.readFileSync(dataFile));
  } catch (error) {
    error.status = 500;
    throw error;
  }
}

function saveData(obj) {
  const tempFile = `${dataFile}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(obj, null, 2)}\n`, "utf-8");
  fs.renameSync(tempFile, dataFile);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBodySize) {
        settled = true;
        const error = new Error("request body too large");
        error.status = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

function resolveStaticPath(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const isIcon = /^icons\/[a-z0-9_]+\.png$/.test(relative);
  if (!publicFiles.has(relative) && !isIcon) return null;
  return path.join(base, relative);
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function validateIncoming(incoming) {
  return Boolean(
    incoming &&
      typeof incoming === "object" &&
      !Array.isArray(incoming) &&
      Object.entries(incoming).every(
        ([key, value]) => /^hd_[a-z0-9_]+$/.test(key) && typeof value === "string",
      ),
  );
}

async function handleSave(req, res) {
  if (req.method === "GET") {
    try {
      send(res, 200, JSON.stringify(loadData()), {
        "Content-Type": "application/json; charset=utf-8",
      });
    } catch (error) {
      send(res, 500, `err:${error.message}`, {
        "Content-Type": "text/plain; charset=utf-8",
      });
    }
    return;
  }

  if (req.method !== "POST") {
    send(res, 405, "method not allowed", {
      "Content-Type": "text/plain; charset=utf-8",
      Allow: "GET, POST, OPTIONS",
    });
    return;
  }

  try {
    if ((req.headers["content-type"] || "").split(";")[0] !== "application/json") {
      const error = new Error("content type must be application/json");
      error.status = 415;
      throw error;
    }

    if (!isSameOrigin(req)) {
      const error = new Error("cross-origin save is not allowed");
      error.status = 403;
      throw error;
    }

    const incoming = JSON.parse(await readBody(req));
    if (!validateIncoming(incoming)) {
      throw new Error("payload contains an unsupported key or value");
    }
    saveData({ ...loadData(), ...incoming });
    send(res, 200, JSON.stringify({ ok: true }), {
      "Content-Type": "application/json; charset=utf-8",
    });
  } catch (error) {
    send(res, error.status || 400, `err:${error.message}`, {
      "Content-Type": "text/plain; charset=utf-8",
    });
  }
}

function handleStatic(req, res, urlPath) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "method not allowed", {
      "Content-Type": "text/plain; charset=utf-8",
      Allow: "GET, HEAD",
    });
    return;
  }

  const file = resolveStaticPath(urlPath);
  if (!file) {
    send(res, 403, "403", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      send(res, 404, "404", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }

    const ext = path.extname(file).slice(1);
    const headers = {
      "Content-Type": contentTypes[ext] || "text/plain; charset=utf-8",
      "Cache-Control": ext === "png" ? "public, max-age=86400" : "no-cache",
    };
    send(res, 200, req.method === "HEAD" ? "" : data, headers);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const urlPath = req.url || "/";

    if (urlPath.split("?")[0] === "/api/save") {
      handleSave(req, res);
      return;
    }

    handleStatic(req, res, urlPath);
  });
}

function start() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid PORT: ${process.env.PORT}`);
  }

  const server = createServer();

  server.on("error", (error) => {
    console.error(`server failed: ${error.message}`);
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`ready on http://${host}:${port}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  createServer,
  isSameOrigin,
  loadData,
  parseStoredData,
  resolveStaticPath,
  validateIncoming,
};
