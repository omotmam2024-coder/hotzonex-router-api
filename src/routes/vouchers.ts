import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { requireAuth, loadRouter, type AuthRequest } from "../middleware/auth";
import { createHotspotUsers, type RouterConfig } from "../lib/mikrotik";
import { decrypt } from "../lib/crypto";
import { supabase } from "../lib/supabase";

const router = Router();

/** Unambiguous alphabet — no 0/O/1/I to avoid user confusion. */
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 8, prefix = "HZX"): string {
  const bytes = crypto.randomBytes(length);
  const chars = Array.from(bytes)
    .map((b) => ALPHA[b % ALPHA.length])
    .join("");
  return prefix ? `${prefix}${chars}` : chars;
}

const generateSchema = z.object({
  routerId: z.string().uuid(),
  profile: z.string().min(1),
  quantity: z.number().int().min(1).max(500),
  prefix: z.string().max(6).default("HZX"),
  planId: z.string().uuid().nullable().optional(),
  /** Duration in minutes — stored in DB and pushed to MikroTik comment */
  durationMinutes: z.number().int().positive().optional(),
  price: z.number().min(0).optional(),
});

// ── POST /vouchers ────────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const auth = req as AuthRequest;
  if (!auth.orgId) {
    res.status(403).json({ error: "No organization found." });
    return;
  }

  const parse = generateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { routerId, profile, quantity, prefix, planId, durationMinutes, price } = parse.data;

  const row = await loadRouter(routerId, auth.orgId);
  if (!row) {
    res.status(404).json({ error: "Router not found." });
    return;
  }

  const password = decrypt(row["encrypted_password"] as string);
  const cfg: RouterConfig = {
    host: row["ip_address"] as string,
    port: (row["api_port"] as number) ?? 8728,
    username: row["api_username"] as string,
    password,
  };
  const server = (row["hotspot_server"] as string | undefined) ?? undefined;

  // Generate codes
  const codes: string[] = [];
  for (let i = 0; i < quantity; i++) {
    codes.push(randomCode(8, prefix));
  }

  // Create a batch record in DB
  const { data: batch, error: batchErr } = await supabase
    .from("voucher_batches")
    .insert({
      organization_id: auth.orgId,
      plan_id: planId ?? null,
      prefix,
      quantity,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (batchErr) {
    res.status(500).json({ error: batchErr.message });
    return;
  }

  // Push all codes to MikroTik over a single connection, then save to DB.
  const batchResults = await createHotspotUsers(
    cfg,
    codes.map((code) => ({ name: code, password: code, profile })),
    server,
  );
  const results = batchResults.map((r) => ({
    code: r.name,
    success: r.success,
    error: r.error,
  }));

  // Save all successful vouchers to DB
  const successful = results.filter((r) => r.success).map((r) => ({
    organization_id: auth.orgId!,
    batch_id: (batch as Record<string, unknown>)["id"] as string,
    plan_id: planId ?? null,
    code: r.code,
    duration_minutes: durationMinutes ?? 60,
    price: price ?? 0,
    status: "unused" as const,
    created_by: auth.userId,
  }));

  if (successful.length > 0) {
    const { error: insertErr } = await supabase.from("vouchers").insert(successful);
    if (insertErr) {
      res.status(500).json({ error: insertErr.message });
      return;
    }
  }

  const failCount = results.filter((r) => !r.success).length;

  res.status(201).json({
    batchId: (batch as Record<string, unknown>)["id"],
    created: successful.length,
    failed: failCount,
    vouchers: results,
  });
});

export default router;
