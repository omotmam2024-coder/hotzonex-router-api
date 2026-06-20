import { createClient } from "@supabase/supabase-js";
import { config } from "../config";

/** Service-role client — bypasses RLS. Never expose to the browser. */
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
});
