import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env["PORT"] ?? "3001", 10),
  supabaseUrl: process.env["SUPABASE_URL"] ?? "",
  supabaseServiceKey: process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
  encryptionKey: process.env["ENCRYPTION_KEY"] ?? "",
  allowedOrigins: (process.env["ALLOWED_ORIGINS"] ?? "*").split(",").map((s) => s.trim()),
};

/**
 * Throws if a required secret is missing. Called by a guard in front of the DB
 * routes so the function still boots (and /health still answers) when env vars
 * aren't configured yet — instead of crashing the whole serverless function.
 */
export function assertConfigured(): void {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ENCRYPTION_KEY"].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    throw new Error(`Server not configured — missing env: ${missing.join(", ")}`);
  }
}
