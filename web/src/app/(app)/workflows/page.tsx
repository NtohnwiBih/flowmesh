import type { Metadata } from "next";
import { WorkflowsView } from "@/components/workflows/workflows-view";

export const metadata: Metadata = {
  title: "Workflows · FlowMesh",
  description: "Build and manage your automated processes.",
};

export default function WorkflowsPage() {
  return <WorkflowsView />;
}
