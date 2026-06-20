import express from "express";
import cors from "cors";
import { config, assertConfigured } from "./config";
import routerRoutes from "./routes/routers";
import voucherRoutes from "./routes/vouchers";
import userRoutes from "./routes/users";

// Builds the Express app. Exported so it can run both as a long-lived local
// server (src/index.ts) and as a Vercel serverless function (api/index.ts).
const app = express();

// Any *.vercel.app URL belonging to this project (canonical + per-deployment
// preview URLs all share the vercel.app suffix). Auth is enforced per-request
// via the Supabase JWT, so CORS is a convenience layer, not the security
// boundary — allowing the platform's own subdomains is safe.
const VERCEL_APP = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

app.use(
  cors({
    origin: (origin, cb) => {
      if (
        !origin || // curl/Postman (no Origin header)
        config.allowedOrigins.includes("*") ||
        config.allowedOrigins.includes(origin) ||
        VERCEL_APP.test(origin)
      ) {
        cb(null, true);
      } else {
        // Don't throw (that turns the OPTIONS preflight into a 500); just
        // omit CORS headers so the browser blocks it cleanly.
        cb(null, false);
      }
    },
    credentials: true,
  }),
);

app.use(express.json());

// Health check — always answers, even before env vars are configured.
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Guard the DB-backed routes: return a clean 503 until the server is configured.
app.use(["/routers", "/vouchers", "/users"], (_req, res, next) => {
  try {
    assertConfigured();
    next();
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : "Not configured" });
  }
});

app.use("/routers", routerRoutes);
app.use("/vouchers", voucherRoutes);
app.use("/users", userRoutes);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? "Internal server error" });
});

export default app;
