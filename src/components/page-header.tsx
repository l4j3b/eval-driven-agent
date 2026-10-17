import type { ReactNode } from "react";

import { Separator } from "#/components/ui/separator";
import { SidebarTrigger } from "#/components/ui/sidebar";

export function PageHeader({ children }: { children?: ReactNode }) {
	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
			<SidebarTrigger />
			<Separator className="mr-1 h-4" orientation="vertical" />
			<div className="min-w-0 flex-1 truncate font-medium text-sm">
				{children}
			</div>
		</header>
	);
}
