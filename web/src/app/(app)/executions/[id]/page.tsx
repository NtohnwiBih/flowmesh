import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/shared/page-container";
import { ExecutionDetailView } from "@/components/executions/execution-detail";
import { executions, getExecution } from "@/lib/data/executions";

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return executions.map((e) => ({ id: e.id }));
}

// Static on purpose: with the auth gate above, a params-dependent title would be
// the page's only runtime access and Next refuses to prerender it. Revisit when this
// page loads real executions (Phase 4E).
export const metadata: Metadata = { title: "Execution details · FlowMesh" };

export default async function ExecutionPage({ params }: Props) {
  const { id } = await params;
  const execution = getExecution(id);
  if (!execution) notFound();

  return (
    <PageContainer
      title="Execution details"
      subtitle="Inspect every step, input, and output for a single run."
    >
      <ExecutionDetailView execution={execution} />
    </PageContainer>
  );
}