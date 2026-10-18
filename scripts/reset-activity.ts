// Removes what the agent did to accounts (credits it issued, tickets it
// opened), so evals start from the seeded state. Chats are kept.
//
//   npm run db:reset-activity
import { eq } from "drizzle-orm";

import { db, sql } from "#/db/client";
import { credits, supportTickets } from "#/db/schema";

const removedCredits = await db
	.delete(credits)
	.where(eq(credits.issuedBy, "agent"))
	.returning({ id: credits.id });
const removedTickets = await db
	.delete(supportTickets)
	.returning({ id: supportTickets.id });
console.log(
	`Removed ${removedCredits.length} agent-issued credit(s) and ${removedTickets.length} support ticket(s).`,
);
await sql.end();
