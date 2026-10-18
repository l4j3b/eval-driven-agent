import {
	Link,
	useNavigate,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import {
	ActivityIcon,
	ChefHatIcon,
	DatabaseIcon,
	SearchIcon,
	SquarePenIcon,
	Trash2Icon,
} from "lucide-react";

import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "#/components/ui/sidebar";
import { deleteChat } from "#/server/chats";

export type ChatSummary = { id: string; title: string; updatedAt: Date };

const LANGFUSE_URL = "http://localhost:3000";

export function AppSidebar({ chats }: { chats: ChatSummary[] }) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const router = useRouter();
	const navigate = useNavigate();

	const remove = async (chat: ChatSummary) => {
		if (!window.confirm(`Delete "${chat.title}"?`)) return;
		await deleteChat({ data: { chatId: chat.id } });
		if (pathname === `/chat/${chat.id}`) await navigate({ to: "/" });
		await router.invalidate();
	};

	return (
		<Sidebar>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild size="lg">
							<Link to="/">
								<div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
									<ChefHatIcon className="size-4" />
								</div>
								<div className="grid leading-tight">
									<span className="font-semibold">Mise</span>
									<span className="text-muted-foreground text-xs">
										Agent Lab
									</span>
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton asChild>
									<Link to="/">
										<SquarePenIcon />
										New chat
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton asChild isActive={pathname === "/search"}>
									<Link to="/search">
										<SearchIcon />
										Search
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton asChild isActive={pathname === "/data"}>
									<Link to="/data">
										<DatabaseIcon />
										Data
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				<SidebarGroup>
					<SidebarGroupLabel>History</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{chats.length === 0 && (
								<p className="px-2 py-1 text-muted-foreground text-xs">
									No chats yet.
								</p>
							)}
							{chats.map((chat) => (
								<SidebarMenuItem key={chat.id}>
									<SidebarMenuButton
										asChild
										isActive={pathname === `/chat/${chat.id}`}
									>
										<Link params={{ chatId: chat.id }} to="/chat/$chatId">
											<span className="truncate">{chat.title}</span>
										</Link>
									</SidebarMenuButton>
									<SidebarMenuAction
										onClick={() => void remove(chat)}
										showOnHover
										title="Delete chat"
									>
										<Trash2Icon />
									</SidebarMenuAction>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild>
							<a href={LANGFUSE_URL} rel="noreferrer" target="_blank">
								<ActivityIcon />
								Traces in Langfuse
							</a>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
