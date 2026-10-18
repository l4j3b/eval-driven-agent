// Makes a password for the agent_app role and prints the SQL that sets it as a
// SCRAM-SHA-256 verifier, so the plain-text password never reaches the
// database or its logs. Run the SQL as `postgres` (Supabase SQL editor), and
// put the password in DATABASE_URL in .env.local.
//
//   npm run db:password
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 4096;

// Hex, so it needs no escaping in a connection URL.
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16);

const salted = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
const hmac = (key: Buffer, text: string) =>
	createHmac("sha256", key).update(text).digest();
const storedKey = createHash("sha256")
	.update(hmac(salted, "Client Key"))
	.digest();
const serverKey = hmac(salted, "Server Key");

const verifier = `SCRAM-SHA-256$${ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;

console.log(`Run this as postgres:

  alter role agent_app with password '${verifier}';

Then set the password in .env.local:

  DATABASE_URL=postgresql://agent_app.<project-ref>:${password}@aws-1-<region>.pooler.supabase.com:5432/postgres
`);
