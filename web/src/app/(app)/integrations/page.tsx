import type { Metadata } from "next";
import { PageContainer } from "@/components/shared/page-container";
import { IntegrationGrid } from "@/components/integrations/integration-grid";

export const metadata: Metadata = {
  title: "Integrations · FlowMesh",
  description: "Connect the services your workflows depend on.",
};

export default function IntegrationsPage() {
  return (
    <PageContainer
      title="Integrations"
      subtitle="Connect the services your workflows depend on."
    >
      <IntegrationGrid />
    </PageContainer>
  );
}