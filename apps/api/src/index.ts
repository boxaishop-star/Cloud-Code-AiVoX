import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { app } from './app.js';

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`AiVoX API listening on http://localhost:${PORT}`);
});
