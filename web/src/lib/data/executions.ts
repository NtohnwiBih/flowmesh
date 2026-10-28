export type RunStatus = "Succeeded" | "Running" | "Failed";

export type ExecutionSummary = {
  id: string;
  workflow: string;
  status: RunStatus;
  duration: string;
  time: string;
};

export type ExecutionStep = {
  name: string;
  kind: string;
  duration: string;
  status: RunStatus;
  attempt: string;
  output: Record<string, unknown>;
};

export type ExecutionDetail = ExecutionSummary & { steps: ExecutionStep[] };

export const executions: ExecutionSummary[] = [
  { id: "exec_9Jv3Q", workflow: "Support intake routing", status: "Succeeded", duration: "1.84s", time: "2m ago" },
  { id: "exec_9Jv2K", workflow: "Customer enrichment", status: "Succeeded", duration: "3.12s", time: "8m ago" },
  { id: "exec_9JuY7", workflow: "Invoice reconciliation", status: "Running", duration: "14.2s", time: "14m ago" },
  { id: "exec_9JtP1", workflow: "Churn risk monitor", status: "Failed", duration: "6.41s", time: "27m ago" },
];

const supportIntakeSteps: ExecutionStep[] = [
  { name: "Order webhook", kind: "Trigger", duration: "18ms", status: "Succeeded", attempt: "1 of 3", output: { event: "order.created", received: true } },
  { name: "Fetch customer", kind: "HTTP Request", duration: "264ms", status: "Succeeded", attempt: "1 of 3", output: { status: 200, customerId: "cus_4821", plan: "enterprise" } },
  { name: "Classify intent", kind: "AI Classifier", duration: "1.42s", status: "Succeeded", attempt: "1 of 3", output: { category: "urgent", confidence: 0.94, model: "classifier-v2", tokens: 286 } },
  { name: "High priority?", kind: "Condition", duration: "3ms", status: "Succeeded", attempt: "1 of 3", output: { result: true, branch: "high" } },
  { name: "Create incident", kind: "Action", duration: "137ms", status: "Succeeded", attempt: "1 of 3", output: { incidentId: "inc_1093", assignee: "on-call" } },
];

// Other runs reuse the same trace shape, with the last step reflecting the run status.
function buildFallbackSteps(status: RunStatus): ExecutionStep[] {
  return supportIntakeSteps.map((step, i, all) => {
    if (i < all.length - 1 || status === "Succeeded") return step;
    return status === "Failed"
      ? { ...step, status, attempt: "3 of 3", output: { error: "Upstream timeout", code: "ETIMEDOUT" } }
      : { ...step, status, duration: "—", output: { state: "in_progress" } };
  });
}

export function getExecution(id: string): ExecutionDetail | undefined {
  const summary = executions.find((e) => e.id === id);
  if (!summary) return undefined;
  return {
    ...summary,
    steps: id === "exec_9Jv3Q" ? supportIntakeSteps : buildFallbackSteps(summary.status),
  };
}