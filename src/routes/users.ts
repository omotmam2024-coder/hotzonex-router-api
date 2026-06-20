import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, loadRouter, type AuthRequest } from "../middleware/auth";
import {
  getActiveUsers,
  disconnectUser,
  disableHotspotUser,
  enableHotspotUser,
  type RouterConfig,
} from "../lib/mikrotik";
import { decrypt } from "../lib/crypto";

const router = Router();

async function getRouterCfg(
  routerId: string,
  orgId: string | null,
): Promise<RouterConfig | null> {
  const row = await loadRouter(routerId, orgId);
  if (!row) return null;
  const password = decrypt(row["encrypted_password"] as string);
  return {
    host: row["ip_address"] as string,
    port: (row["api_port"] as number) ?? 8728,
    username: row["api_username"] as string,
    password,
  };
}

// ── GET /users/:routerId/active ───────────────────────────────────────────────
router.get("/:routerId/active", requireAuth, async (req: Request, res: Response) => {
  const auth = req as AuthRequest;
  const cfg = await getRouterCfg((req.params["routerId"] as string), auth.orgId);
  if (!cfg) {
    res.status(404).json({ error: "Router not found." });
    return;
  }

  try {
    const users = await getActiveUsers(cfg);
    res.json(users);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Router unreachable." });
  }
});

// ── POST /users/:routerId/disconnect ─────────────────────────────────────────
router.post(
  "/:routerId/disconnect",
  requireAuth,
  async (req: Request, res: Response) => {
    const auth = req as AuthRequest;
    const { activeId } = z.object({ activeId: z.string() }).parse(req.body);

    const cfg = await getRouterCfg((req.params["routerId"] as string), auth.orgId);
    if (!cfg) {
      res.status(404).json({ error: "Router not found." });
      return;
    }

    try {
      await disconnectUser(cfg, activeId);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed." });
    }
  },
);

// ── POST /users/:routerId/disable ─────────────────────────────────────────────
router.post(
  "/:routerId/disable",
  requireAuth,
  async (req: Request, res: Response) => {
    const auth = req as AuthRequest;
    const { username } = z.object({ username: z.string() }).parse(req.body);

    const cfg = await getRouterCfg((req.params["routerId"] as string), auth.orgId);
    if (!cfg) {
      res.status(404).json({ error: "Router not found." });
      return;
    }

    try {
      await disableHotspotUser(cfg, username);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed." });
    }
  },
);

// ── POST /users/:routerId/enable ──────────────────────────────────────────────
router.post(
  "/:routerId/enable",
  requireAuth,
  async (req: Request, res: Response) => {
    const auth = req as AuthRequest;
    const { username } = z.object({ username: z.string() }).parse(req.body);

    const cfg = await getRouterCfg((req.params["routerId"] as string), auth.orgId);
    if (!cfg) {
      res.status(404).json({ error: "Router not found." });
      return;
    }

    try {
      await enableHotspotUser(cfg, username);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed." });
    }
  },
);

export default router;
