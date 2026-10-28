import type { Metadata } from "next";
import { PageContainer } from "@/components/shared/page-container";
import { RecentExecutions } from "@/components/executions/recent-executions";

export const metadata: Metadata = {
  title: "Executions · FlowMesh",
  description: "Inspect every step, input, and output for a single run.",
};

export default function ExecutionsPage() {
  return (
    <PageContainer
      title="Executions"
      subtitle="Inspect every step, input, and output for a single run."
    >
      <RecentExecutions
        title="All executions"
        description="Live across all environments"
      />
    </PageContainer>
  );
}