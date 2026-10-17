import { pgSchema } from "drizzle-orm/pg-core";

// Everything the demo stores lives in its own schema, owned by the agent_app role.
// Tables arrive in phase 1, with the dummy data.
export const agent = pgSchema("agent");
