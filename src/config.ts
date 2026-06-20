import dotenv from "dotenv";
dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  port: parseInt(process.env["PORT"] ?? "3001", 10),
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  encryptionKey: requireEnv("ENCRYPTION_KEY"),
  allowedOrigins: (process.env["ALLOWED_ORIGINS"] ?? "*").split(",").map((s) => s.trim()),
};
