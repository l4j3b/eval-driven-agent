import { isToolUIPart, type UIMessage } from "ai";
import { ShieldAlertIcon } from "lucide-react";

import {
	Confirmation,
	ConfirmationAccepted,
	ConfirmationAction,
	ConfirmationActions,
	ConfirmationRejected,
	ConfirmationRequest,
	ConfirmationTitle,
} from "#/components/ai-elements/confirmation";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
	type ToolPart,
} from "#/components/ai-elements/tool";

type Part = UIMessage["parts"][number];

const LABELS: Record<string, (input: Record<string, unknown>) => string> = {
	searchKnowledge: (input) => `Searched "${input.query ?? ""}"`,
	findRecipes: () => "Found recipes",
	getRecipe: (input) => `Read recipe ${input.recipeId ?? ""}`,
	getMyAccount: () => "Looked up your account",
	getMyOrders: () => "Looked up your boxes",
	issueCredit: () => "Credit",
	requestSupportReview: () => "Support review",
};

function toolName(part: ToolPart) {
	return part.type === "dynamic-tool"
		? part.toolName
		: part.type.split("-").slice(1).join("-");
}

export function ToolCall({
	part,
	onApproval,
}: {
	part: Part;
	onApproval: (approvalId: string, approved: boolean) => void;
}) {
	if (!isToolUIPart(part)) return null;
	const tool = part as ToolPart;
	const name = toolName(tool);
	const input = (tool.input ?? {}) as Record<string, unknown>;
	const title = LABELS[name]?.(input) ?? name;
	const approval = "approval" in tool ? tool.approval : undefined;

	// A credit waiting on the customer: show the server's description of it
	// (amount computed from the policy) and ask.
	if (name === "issueCredit" && approval && !approval.isAutomatic) {
		return (
			<Confirmation approval={approval} className="my-2" state={tool.state}>
				<ConfirmationTitle>
					<ConfirmationRequest>
						{approval.requestReason ?? "Issue this credit?"}
					</ConfirmationRequest>
					<ConfirmationAccepted>Credit approved.</ConfirmationAccepted>
					<ConfirmationRejected>Credit declined.</ConfirmationRejected>
				</ConfirmationTitle>
				<ConfirmationActions>
					<ConfirmationAction
						onClick={() => onApproval(approval.id, false)}
						variant="outline"
					>
						Decline
					</ConfirmationAction>
					<ConfirmationAction onClick={() => onApproval(approval.id, true)}>
						Approve
					</ConfirmationAction>
				</ConfirmationActions>
			</Confirmation>
		);
	}

	return (
		<Tool className="my-2">
			<ToolHeader
				state={tool.state}
				title={title}
				{...(tool.type === "dynamic-tool"
					? { type: tool.type, toolName: tool.toolName }
					: { type: tool.type })}
			/>
			<ToolContent>
				{approval?.isAutomatic && approval.reason && (
					<p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
						<ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-300" />
						Refused by policy: {approval.reason}
					</p>
				)}
				<ToolInput input={tool.input} />
				<ToolOutput errorText={tool.errorText} output={tool.output} />
			</ToolContent>
		</Tool>
	);
}
