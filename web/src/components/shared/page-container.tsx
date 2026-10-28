import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageContainerProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  /** Set to false on pages that shouldn't show the "New workflow" button. */
  showNewWorkflow?: boolean;
  /** Replaces the default "New workflow" button. */
  actions?: React.ReactNode;
};

export function PageContainer({
  title,
  subtitle,
  children,
  showNewWorkflow = true,
  actions,
}: PageContainerProps) {
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {actions}
          {!actions && showNewWorkflow && (
            <Button asChild>
              <Link href="/workflows">
                <Plus /> New workflow
              </Link>
            </Button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}