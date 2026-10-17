export function slugify(text: string) {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ']/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}
