import { BookOpenIcon, ChefHatIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Badge } from "#/components/ui/badge";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "#/components/ui/hover-card";
import type { Source } from "#/lib/sources";

const CITATION = /\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g;

// "[2, 3]" → "[2](#source-2)[3](#source-3)", so the markdown renderer turns
// each citation into a link we can render as a chip.
export function linkCitations(text: string) {
	return text.replace(CITATION, (_, numbers: string) =>
		numbers
			.split(",")
			.map((n) => `[${n.trim()}](#source-${n.trim()})`)
			.join(""),
	);
}

export function citedNumbers(text: string) {
	return [...text.matchAll(CITATION)].flatMap((match) =>
		(match[1] ?? "").split(",").map((n) => Number(n.trim())),
	);
}

function SourceIcon({ kind }: { kind: Source["kind"] }) {
	return kind === "recipe" ? (
		<ChefHatIcon className="size-3.5" />
	) : (
		<BookOpenIcon className="size-3.5" />
	);
}

function SourceCard({ source }: { source: Source }) {
	return (
		<div className="grid gap-2">
			<div className="flex items-center gap-2 font-medium text-sm">
				<SourceIcon kind={source.kind} />
				{source.title}
			</div>
			{source.section && (
				<p className="text-muted-foreground text-xs">{source.section}</p>
			)}
			<p className="line-clamp-6 whitespace-pre-line text-muted-foreground text-xs">
				{source.text}
			</p>
			<p className="font-mono text-[10px] text-muted-foreground">
				{source.kind} · {source.sourceId}
			</p>
		</div>
	);
}

// The markdown renderer's <a>: citation links become chips with the source on
// hover; anything else stays a normal link.
export function citationLinks(sources: Map<number, Source>) {
	return function Link({ href, children, ...props }: ComponentProps<"a">) {
		const n = href?.startsWith("#source-") ? Number(href.slice(8)) : null;
		if (n === null) {
			return (
				<a href={href} rel="noreferrer" target="_blank" {...props}>
					{children}
				</a>
			);
		}
		const source = sources.get(n);
		return (
			<HoverCard closeDelay={100} openDelay={100}>
				<HoverCardTrigger asChild>
					<Badge
						className="mx-0.5 cursor-default rounded-full px-1.5 py-0 align-super font-mono text-[10px]"
						variant={source ? "secondary" : "destructive"}
					>
						{n}
					</Badge>
				</HoverCardTrigger>
				<HoverCardContent className="w-80">
					{source ? (
						<SourceCard source={source} />
					) : (
						<p className="text-sm">
							No source [{n}] was returned by a tool: the citation is invalid.
						</p>
					)}
				</HoverCardContent>
			</HoverCard>
		);
	};
}

export function SourceList({ sources }: { sources: Source[] }) {
	if (sources.length === 0) return null;
	return (
		<div className="mt-2 grid gap-1.5 border-t pt-2">
			<p className="text-muted-foreground text-xs">Sources</p>
			<div className="flex flex-wrap gap-1.5">
				{sources.map((source) => (
					<HoverCard closeDelay={100} key={source.n} openDelay={100}>
						<HoverCardTrigger asChild>
							<Badge
								className="cursor-default gap-1 font-normal"
								variant="outline"
							>
								<span className="font-mono">{source.n}</span>
								<SourceIcon kind={source.kind} />
								<span className="max-w-56 truncate">
									{source.title}
									{source.section ? ` · ${source.section}` : ""}
								</span>
							</Badge>
						</HoverCardTrigger>
						<HoverCardContent className="w-80">
							<SourceCard source={source} />
						</HoverCardContent>
					</HoverCard>
				))}
			</div>
		</div>
	);
}
