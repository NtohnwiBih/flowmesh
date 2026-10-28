import type { Metadata } from "next";
import { PageContainer } from "@/components/shared/page-container";
import { TemplateGrid } from "@/components/templates/template-grid";

export const metadata: Metadata = {
  title: "Templates · FlowMesh",
  description: "Start faster with production-ready patterns.",
};

export default function TemplatesPage() {
  return (
    <PageContainer
      title="Workflow templates"
      subtitle="Start faster with production-ready patterns."
    >
      <TemplateGrid />
    </PageContainer>
  );
}