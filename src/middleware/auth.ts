import { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase";

export interface AuthRequest extends Request {
  userId: string;
  orgId: string | null;
  isSuperAdmin: boolean;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "Authorization header required." });
    return;
  }

  // Validate the Supabase JWT by calling getUser (no need to know the JWT secret)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: "Invalid or expired token." });
    return;
  }

  // Load profile to get organization_id and role
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role, is_super_admin")
    .eq("id", user.id)
    .maybeSingle();

  const r = req as AuthRequest;
  r.userId = user.id;
  r.orgId = profile?.organization_id ?? null;
  r.isSuperAdmin = profile?.is_super_admin ?? false;

  next();
}

/** Load and decrypt a router record for the requesting org. */
export async function loadRouter(routerId: string, orgId: string | null) {
  const query = supabase
    .from("routers")
    .select("*")
    .eq("id", routerId);

  if (orgId) query.eq("organization_id", orgId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}
