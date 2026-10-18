// The self-improvement loop.
//
//   npm run improve                                # one iteration; approve on /improve
//   npm run improve -- --iterations 3 --auto-promote
//   npm run improve -- --gate 1,2 [--scorer 1]     # gate two existing versions
//   npm run improve -- --promote 2                 # move "production" (or roll back)
//
// Each iteration: production's failures on the train split → an optimizer
// proposes a revised prompt (label "proposed") → it's evaluated on every case
// → promoted only if it passes the gate (better on the held-out test split, no
// critical case broken in either split) and you approve it.
import "#/server/telemetry";

import { parseArgs } from "node:util";

import { sql } from "#/db/client";
import { gateVersions, improveOnce, promote } from "#/improve/loop";
import { flushTelemetry } from "#/server/telemetry";

const { values: args } = parseArgs({
	options: {
		iterations: { type: "string", default: "1" },
		"auto-promote": { type: "boolean", default: false },
		gate: { type: "string" },
		promote: { type: "string" },
		// Which scorer's reports to gate on (older reports were scored by v1).
		scorer: { type: "string" },
	},
});

const log = (message: string) =>
	console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

try {
	if (args.promote) {
		await promote(Number(args.promote));
		log(`v${args.promote} is now production`);
	} else if (args.gate) {
		const [base, candidate] = args.gate.split(",").map(Number);
		if (!base || !candidate)
			throw new Error("Use --gate <baseVersion>,<candidateVersion>");
		await gateVersions(
			base,
			candidate,
			log,
			args.scorer ? Number(args.scorer) : undefined,
		);
	} else {
		for (let iteration = 1; iteration <= Number(args.iterations); iteration++) {
			log(`iteration ${iteration}`);
			const record = await improveOnce({
				autoPromote: args["auto-promote"],
				log,
			});
			if (record.status === "nothing-to-improve") break;
			if (record.gate?.decision !== "promote") {
				log("stopping: the proposal didn't pass the gate");
				break;
			}
			if (!record.promoted) {
				log(
					`approve v${record.candidateVersion} on /improve (or rerun with --auto-promote)`,
				);
				break;
			}
		}
	}
} finally {
	await flushTelemetry();
	await sql.end();
}
