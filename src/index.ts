import express from "express";
import cors from "cors";
import { config } from "./config";
import routerRoutes from "./routes/routers";
import voucherRoutes from "./routes/vouchers";
import userRoutes from "./routes/users";

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

// Health check — Railway uses this
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use("/routers", routerRoutes);
app.use("/vouchers", voucherRoutes);
app.use("/users", userRoutes);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`Hotzonex Router API running on port ${config.port}`);
});

export default app;
