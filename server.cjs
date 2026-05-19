var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_dotenv = __toESM(require("dotenv"), 1);
import_dotenv.default.config();
async function startServer() {
  const app = (0, import_express.default)();
  const PORT = 3e3;
  app.use(import_express.default.json());
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "https://mikeshadows.github.io");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    next();
  });
  app.get("/api/iptv", async (req, res) => {
    let { url, username, password, ...rest } = req.query;
    if (!url || !username || !password) {
      return res.status(400).json({ error: "Missing identity (url, username, password)" });
    }
    try {
      let baseUrl = String(url).trim().replace(/\/+$/, "");
      if (!baseUrl.startsWith("http")) {
        baseUrl = "http://" + baseUrl;
      }
      let targetUrl = `${baseUrl}/player_api.php?username=${username}&password=${password}`;
      Object.entries(rest).forEach(([key, value]) => {
        if (value !== void 0) {
          targetUrl += `&${key}=${encodeURIComponent(String(value))}`;
        }
      });
      console.log(`[PROXY] Fetching: ${targetUrl}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6e4);
      try {
        const response = await fetch(targetUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Cache-Control": "no-cache"
          }
        });
        clearTimeout(timeoutId);
        const contentType = response.headers.get("content-type");
        if (contentType) {
          res.setHeader("Content-Type", contentType);
        }
        if (!response.ok) {
          console.error(`[PROXY] Provider error: ${response.status}`);
          const errorText = await response.text().catch(() => "Unknown error");
          return res.status(response.status).json({
            error: `IPTV Provider Error (${response.status})`,
            details: errorText.substring(0, 200)
          });
        }
        const arrayBuffer = await response.arrayBuffer();
        clearTimeout(timeoutId);
        res.send(Buffer.from(arrayBuffer));
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr.name === "AbortError") {
          return res.status(504).json({ error: "Connection timed out", details: "The IPTV provider took too long to respond." });
        }
        throw fetchErr;
      }
    } catch (error) {
      console.error("[PROXY] Critical error:", error.message);
      res.status(500).json({
        error: "Connection failed",
        details: error.message
      });
    }
  });
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      env: process.env.NODE_ENV || "development"
    });
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Mode: ${process.env.NODE_ENV || "development"}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
