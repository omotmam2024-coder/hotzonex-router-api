import { createClient } from "@supabase/supabase-js";
import { config } from "../config";

/**
 * Service-role client — bypasses RLS. Never expose to the browser.
 * Falls back to placeholders so importing this module never throws when env
 * vars are missing; the assertConfigured() guard rejects DB requests until the
 * real values are set, so the placeholder client is never actually used.
 */
export const supabase = createClient(
  config.supabaseUrl || "https://placeholder.supabase.co",
  config.supabaseServiceKey || "placeholder-key",
  { auth: { persistSession: false } },
);
