import { getCookie, setCookie } from "@tanstack/react-start/server";

// A stand-in for real authentication: the customer picked in the sidebar is
// stored in a cookie, and the server reads it on every request. Tools get the
// customer id from here, never from the model's arguments, so the agent can't
// be talked into reading someone else's account.
//
// Server-only (.server.ts): reading cookies must never reach the browser bundle.
const COOKIE = "mise_customer";
export const CUSTOMER_ID = /^cus_\d{3}$/;

export function currentCustomerId(): string | null {
	const value = getCookie(COOKIE);
	return value && CUSTOMER_ID.test(value) ? value : null;
}

export function setCurrentCustomerId(customerId: string | null) {
	setCookie(COOKIE, customerId ?? "", {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		maxAge: customerId ? 60 * 60 * 24 * 30 : 0,
	});
}
