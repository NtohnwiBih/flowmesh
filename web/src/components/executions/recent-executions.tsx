"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { executions, type RunStatus } from "@/lib/data/executions";

const statusClass: Record<RunStatus, string> = {
  Succeeded: "run-success",
  Running: "run-running",
  Failed: "run-failed",
};

type RecentExecutionsProps = {
  title?: string;
  description?: string;
  /** Show the "View all" link (dashboard only). */
  showViewAll?: boolean;
  /** Limit rows, e.g. 4 on the dashboard. */
  limit?: number;
};

export function RecentExecutions({
  title = "Recent executions",
  description = "Live across all environments",
  showViewAll = false,
  limit,
}: RecentExecutionsProps) {
  const router = useRouter();
  const rows = limit ? executions.slice(0, limit) : executions;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {showViewAll && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/executions">View all</Link>
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Execution ID</th>
              <th>Workflow</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => (
              <tr
                key={run.id}
                onClick={() => router.push(`/executions/${run.id}`)}
                className="cursor-pointer"
              >
                <td className="font-mono text-primary">
                  <Link
                    href={`/executions/${run.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {run.id}
                  </Link>
                </td>
                <td className="font-medium">{run.workflow}</td>
                <td>
                  <span className={cn("run-status", statusClass[run.status])}>
                    <span />
                    {run.status}
                  </span>
                </td>
                <td className="font-mono text-muted-foreground">{run.duration}</td>
                <td className="text-muted-foreground">{run.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}