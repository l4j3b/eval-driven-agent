import { createServerFn } from "@tanstack/react-start";
import { asc } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/client";
import { customers } from "#/db/schema";
import {
	CUSTOMER_ID,
	currentCustomerId,
	setCurrentCustomerId,
} from "#/server/session.server";

export const getSession = createServerFn({ method: "GET" }).handler(
	async () => ({
		customerId: currentCustomerId(),
		customers: await db
			.select({
				id: customers.id,
				name: customers.name,
				allergies: customers.allergies,
			})
			.from(customers)
			.orderBy(asc(customers.id)),
	}),
);

export const setSessionCustomer = createServerFn({ method: "POST" })
	.validator(
		z.object({
			customerId: z.string().regex(CUSTOMER_ID).nullable(),
		}),
	)
	.handler(({ data }) => setCurrentCustomerId(data.customerId));
