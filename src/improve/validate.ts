// Guards against the usual ways an optimizer goes wrong: breaking the
// template, dropping safety rules, overfitting to case details, bloating.
export function validateProposal(current: string, proposed: string) {
	const problems: string[] = [];
	for (const variable of ["{{today}}", "{{customer}}"]) {
		if (!proposed.includes(variable)) problems.push(`it must keep ${variable}`);
	}
	for (const section of ["## Safety", "## Untrusted content"]) {
		if (!proposed.includes(section))
			problems.push(`it must keep the "${section}" section`);
	}
	if (/\b(cus|ord|crd)_\w+/.test(proposed)) {
		problems.push("it mentions specific customer, order or credit ids");
	}
	if (proposed.length > current.length * 1.6) {
		problems.push("it's more than 60% longer than the current prompt");
	}
	if (proposed.length < current.length * 0.8) {
		problems.push("it dropped more than 20% of the current prompt");
	}
	if (proposed.trim() === current.trim()) problems.push("it's unchanged");
	return problems;
}
