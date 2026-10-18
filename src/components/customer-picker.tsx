import { useNavigate, useRouter } from "@tanstack/react-router";
import { UserIcon } from "lucide-react";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { setSessionCustomer } from "#/server/session";

const GUEST = "guest";

export type SessionInfo = {
	customerId: string | null;
	customers: { id: string; name: string; allergies: string[] }[];
};

// Stands in for signing in: pick who you are, and the server treats every
// request as that customer. Switching starts a fresh chat.
export function CustomerPicker({ session }: { session: SessionInfo }) {
	const router = useRouter();
	const navigate = useNavigate();

	const change = async (value: string) => {
		await setSessionCustomer({
			data: { customerId: value === GUEST ? null : value },
		});
		await navigate({ to: "/" });
		await router.invalidate();
	};

	return (
		<div className="grid gap-1 px-2">
			<p className="text-muted-foreground text-xs">Signed in as</p>
			<Select
				onValueChange={(value) => void change(value)}
				value={session.customerId ?? GUEST}
			>
				<SelectTrigger className="w-full">
					<UserIcon className="size-4 text-muted-foreground" />
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={GUEST}>Guest (not signed in)</SelectItem>
					{session.customers.map((customer) => (
						<SelectItem key={customer.id} value={customer.id}>
							{customer.name}
							{customer.allergies.length > 0 && (
								<span className="text-muted-foreground text-xs">
									{" "}
									· {customer.allergies.join(", ")}
								</span>
							)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
