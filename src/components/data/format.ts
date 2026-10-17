const currency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

export const money = (amount: number) => currency.format(amount);

// Dates are stored as plain `date` strings (YYYY-MM-DD), so format them in UTC
// to avoid shifting a day in western time zones.
export const day = (isoDate: string | Date) =>
	new Date(
		typeof isoDate === "string" ? `${isoDate}T00:00:00Z` : isoDate,
	).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});

export const minutes = (total: number) =>
	total >= 60
		? `${Math.floor(total / 60)} h ${total % 60 ? `${total % 60} min` : ""}`.trim()
		: `${total} min`;
