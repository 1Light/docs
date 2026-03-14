// apps/ai-service/src/server.ts

import { createApp } from "./app";
import { config } from "./config/env";

const app = createApp();

app.listen(config.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `AI Service running on port ${config.PORT} (${config.NODE_ENV}) - provider: ${config.LLM_PROVIDER}`
  );
});