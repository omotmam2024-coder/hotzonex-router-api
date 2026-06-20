// Vercel serverless entry point. Vercel's @vercel/node runtime invokes the
// exported Express app as the request handler; vercel.json rewrites every path
// to this function, and Express handles the internal routing (/health,
// /routers, /vouchers, /users).
import app from "../src/app";

export default app;
