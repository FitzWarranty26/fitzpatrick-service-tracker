// Explicit seed entrypoint (`npm run seed`).
//
// Importing ./server/storage opens the configured DB (DB_PATH) and runs the
// versioned migrations, so the schema is guaranteed present. seedAdmin already
// ran during that import (S6 hardening for empty DBs); here we additionally load
// the initial CRM data, which is intentionally NOT run on every boot.

import { sqlite } from "../server/storage";
import { seedInitialData } from "../server/seed";

seedInitialData(sqlite);
console.log("Seed: initial data seed complete.");
