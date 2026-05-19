import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://mikeshadows.github.io');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

    // IPTV Proxy Endpoint
    app.get("/api/iptv", async (req, res) => {
      let { url, username, password, ...rest } = req.query;
  
      if (!url || !username || !password) {
        return res.status(400).json({ error: "Missing identity (url, username, password)" });
      }
  
      try {
        // Normalize URL: remove trailing slash and ensure protocol
        let baseUrl = String(url).trim().replace(/\/+$/, "");
        if (!baseUrl.startsWith('http')) {
          baseUrl = 'http://' + baseUrl;
        }
  
        let targetUrl = `${baseUrl}/player_api.php?username=${username}&password=${password}`;
        
        // Append all other query parameters
        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined) {
            targetUrl += `&${key}=${encodeURIComponent(String(value))}`;
          }
        });
  
        console.log(`[PROXY] Fetching: ${targetUrl}`);
  
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for large playlists
  
        try {
          const response = await fetch(targetUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
              'Accept': 'application/json, text/plain, */*',
              'Cache-Control': 'no-cache'
            }
          });
          
          clearTimeout(timeoutId);
          const contentType = response.headers.get('content-type');
          if (contentType) {
            res.setHeader('Content-Type', contentType);
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
        } catch (fetchErr: any) {
          clearTimeout(timeoutId);
          if (fetchErr.name === 'AbortError') {
            return res.status(504).json({ error: "Connection timed out", details: "The IPTV provider took too long to respond." });
          }
          throw fetchErr;
        }
      } catch (error: any) {
        console.error("[PROXY] Critical error:", error.message);
        res.status(500).json({ 
          error: "Connection failed", 
          details: error.message 
        });
      }
    });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      env: process.env.NODE_ENV || 'development'
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer();
