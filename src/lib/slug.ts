export function slugify(text: string) {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f']/g, "") // accents (split off by NFKD) and apostrophes
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}
