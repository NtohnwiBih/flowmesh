import { Suspense } from "react";
import { WorkflowEditorPage } from "@/components/workflows/workflow-editor-page";

// params is a promise that is only known per request, so it is read inside a
// Suspense boundary (required with cacheComponents).
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
      <Loaded params={params} />
    </Suspense>
  );
}

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkflowEditorPage id={id} />;
}
