// The dummy data is anchored on this date: boxes before it are delivered,
// next week's is processing, the week after is scheduled. Freezing "today"
// keeps policy checks ("within 7 days of delivery") and eval results stable
// no matter when the demo runs. Override with DEMO_TODAY=YYYY-MM-DD.
export const TODAY = process.env.DEMO_TODAY ?? "2026-10-17";

export function daysBetween(fromIsoDate: string, toIsoDate: string) {
	const from = Date.parse(`${fromIsoDate}T00:00:00Z`);
	const to = Date.parse(`${toIsoDate}T00:00:00Z`);
	return Math.round((to - from) / 86_400_000);
}
