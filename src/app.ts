import express from "express";
import cors from "cors";
import { config, assertConfigured } from "./config";
import routerRoutes from "./routes/routers";
import voucherRoutes from "./routes/vouchers";
import userRoutes from "./routes/users";

// Builds the Express app. Exported so it can run both as a long-lived local
// server (src/index.ts) and as a Vercel serverless function (api/index.ts).
const app = express();

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, Postman) and configured origins
      if (!origin || config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error("Not allowed by CORS"));
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
