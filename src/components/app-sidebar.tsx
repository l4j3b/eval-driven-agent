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
	FlaskConicalIcon,
	SearchIcon,
	SparklesIcon,
	SquarePenIcon,
	ThumbsUpIcon,
	Trash2Icon,
} from "lucide-react";
import { CustomerPicker, type SessionInfo } from "#/components/customer-picker";
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

// Everything besides chatting, in the order of the pipeline it demos.
const PAGES = [
	{ to: "/search", label: "Search", icon: SearchIcon },
	{ to: "/evals", label: "Evals", icon: FlaskConicalIcon },
	{ to: "/improve", label: "Improve", icon: SparklesIcon },
	{ to: "/feedback", label: "Feedback", icon: ThumbsUpIcon },
	{ to: "/data", label: "Data", icon: DatabaseIcon },
] as const;

export function AppSidebar({
	chats,
	session,
	langfuseUrl,
}: {
	chats: ChatSummary[];
	session: SessionInfo;
	langfuseUrl: string;
}) {
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
							{PAGES.map((page) => (
								<SidebarMenuItem key={page.to}>
									<SidebarMenuButton asChild isActive={pathname === page.to}>
										<Link to={page.to}>
											<page.icon />
											{page.label}
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
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
				<CustomerPicker session={session} />
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild>
							<a
								href={`${langfuseUrl}/traces`}
								rel="noreferrer"
								target="_blank"
							>
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
