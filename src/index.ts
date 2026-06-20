import app from "./app";
import { config } from "./config";

// Local / long-lived server entry point (e.g. `npm run dev`, `npm start`).
app.listen(config.port, () => {
  console.log(`Hotzonex Router API running on port ${config.port}`);
});
