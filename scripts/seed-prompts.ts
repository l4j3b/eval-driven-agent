// Loads every saved version of the agent prompt (prompts/versions.json, from
// `npm run seed:export`) into a fresh Langfuse, in order and with its labels.
//
//   npm run prompt:seed
//
// Version numbers must match the saved ones, because eval reports and
// improvement records refer to versions by number. So this only runs against
// a Langfuse that doesn't have the prompt yet; otherwise it checks that the
// versions it has match the files.
import { readFile } from "node:fs/promises";

import { AGENT_PROMPT_NAME } from "#/lib/prompts";
import { langfuse } from "#/server/langfuse.server";

export type PromptManifest = {
	version: number;
	file: string;
	labels: string[];
	commitMessage: string | null;
	config: Record<string, unknown>;
}[];

const manifest = JSON.parse(
	await readFile("prompts/versions.json", "utf8"),
) as PromptManifest;
const text = async (file: string) =>
	(await readFile(`prompts/${file}`, "utf8")).trimEnd();

const existing =
	(await langfuse.api.prompts.list({ name: AGENT_PROMPT_NAME })).data.find(
		(meta) => meta.name === AGENT_PROMPT_NAME,
	)?.versions ?? [];

if (existing.length > 0) {
	const mismatched: number[] = [];
	for (const entry of manifest) {
		if (!existing.includes(entry.version)) {
			mismatched.push(entry.version);
			continue;
		}
		const prompt = await langfuse.prompt.get(AGENT_PROMPT_NAME, {
			type: "text",
			version: entry.version,
			cacheTtlSeconds: 0,
		});
		if (prompt.prompt.trimEnd() !== (await text(entry.file)))
			mismatched.push(entry.version);
	}
	console.log(
		mismatched.length
			? `${AGENT_PROMPT_NAME} already exists, and versions ${mismatched.join(", ")} don't match prompts/. Use a fresh Langfuse project, or push new versions with npm run prompt:push.`
			: `${AGENT_PROMPT_NAME} already has versions ${manifest.map((entry) => entry.version).join(", ")}, matching prompts/.`,
	);
	process.exit(mismatched.length ? 1 : 0);
}

for (const entry of manifest) {
	const created = await langfuse.prompt.create({
		name: AGENT_PROMPT_NAME,
		type: "text",
		prompt: await text(entry.file),
		labels: entry.labels,
		...(entry.commitMessage ? { commitMessage: entry.commitMessage } : {}),
		config: entry.config,
	});
	if (created.version !== entry.version) {
		throw new Error(
			`Created v${created.version} for prompts/${entry.file}, expected v${entry.version}.`,
		);
	}
	console.log(
		`v${created.version} [${entry.labels.join(", ") || "no label"}] from prompts/${entry.file}`,
	);
}
