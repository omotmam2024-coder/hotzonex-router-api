import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, loadRouter, type AuthRequest } from "../middleware/auth";
import { testConnection, getRouterStatus, type RouterConfig } from "../lib/mikrotik";
import { encrypt, decrypt } from "../lib/crypto";
import { supabase } from "../lib/supabase";

const router = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

const testSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().default(8728),
  username: z.string().min(1),
  password: z.string().min(1),
});

const saveSchema = z.object({
  id: z.string().uuid().optional(),            // omit for create, provide for update
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().default(8728),
  username: z.string().min(1),
  password: z.string().optional(),             // optional on update
  hotspot_server: z.string().optional(),
  currency: z.string().default("SSP"),
  branch_id: z.string().uuid().nullable().optional(),
});

// ── POST /routers/test ────────────────────────────────────────────────────────
router.post("/test", requireAuth, async (req: Request, res: Response) => {
  const parse = testSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }
  const { host, port, username, password } = parse.data;
  const cfg: RouterConfig = { host, port, username, password };

  try {
    const result = await testConnection(cfg);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : "Connection failed.",
    });
  }
});

// ── POST /routers ─────────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const auth = req as AuthRequest;
  if (!auth.orgId) {
    res.status(403).json({ error: "No organization found." });
    return;
  }

  const parse = saveSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const d = parse.data;
  if (!d.password) {
    res.status(400).json({ error: "Password is required when creating a router." });
    return;
  }

  const encrypted = encrypt(d.password);

  const { data, error } = await supabase
    .from("routers")
    .insert({
      organization_id: auth.orgId,
      branch_id: d.branch_id ?? null,
      name: d.name,
      ip_address: d.host,
      api_port: d.port,
      api_username: d.username,
      encrypted_password: encrypted,
      hotspot_server: d.hotspot_server ?? null,
      currency: d.currency,
      status: "unknown",
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // Never return the encrypted password to the client
  const { encrypted_password: _pw, ...safe } = data as Record<string, unknown>;
  void _pw;
  res.status(201).json(safe);
});

// ── PUT /routers/:id ──────────────────────────────────────────────────────────
router.put("/:id", requireAuth, async (req: Request, res: Response) => {
  const auth = req as AuthRequest;
  const row = await loadRouter((req.params["id"] as string), auth.orgId);
  if (!row) {
    res.status(404).json({ error: "Router not found." });
    return;
  }

  const parse = saveSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const d = parse.data;
  const updates: Record<string, unknown> = {
    name: d.name,
    ip_address: d.host,
    api_port: d.port,
    api_username: d.username,
    hotspot_server: d.hotspot_server ?? null,
    currency: d.currency,
    branch_id: d.branch_id ?? null,
  };
  if (d.password) {
    updates["encrypted_password"] = encrypt(d.password);
  }

  const { data, error } = await supabase
    .from("routers")
    .update(updates)
    .eq("id", (req.params["id"] as string))
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const { encrypted_password: _pw, ...safe } = data as Record<string, unknown>;
  void _pw;
  res.json(safe);
});

// ── GET /routers/:id/status ───────────────────────────────────────────────────
router.get("/:id/status", requireAuth, async (req: Request, res: Response) => {
  const auth = req as AuthRequest;
  const row = await loadRouter((req.params["id"] as string), auth.orgId);
  if (!row) {
    res.status(404).json({ error: "Router not found." });
    return;
  }

  try {
    const password = decrypt(row["encrypted_password"] as string);
    const cfg: RouterConfig = {
      host: row["ip_address"] as string,
      port: (row["api_port"] as number) ?? 8728,
      username: row["api_username"] as string,
      password,
    };
    const status = await getRouterStatus(cfg, row["hotspot_server"] as string | undefined);

    // Update last_seen_at
    await supabase
      .from("routers")
      .update({ last_seen_at: new Date().toISOString(), status: "online" })
      .eq("id", (req.params["id"] as string));

    res.json(status);
  } catch (err) {
    // Mark router offline
    await supabase
      .from("routers")
      .update({ status: "offline" })
      .eq("id", (req.params["id"] as string));

    res.json({
      online: false,
      error: err instanceof Error ? err.message : "Unreachable",
    });
  }
});

export default router;
