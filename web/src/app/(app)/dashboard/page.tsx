import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CheckCircle2, ChevronDown, Gauge, Plus, Workflow } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const stats = [
  { label: "Executions", value: "68.2k", change: "+12.4%", icon: <Activity className="size-4 text-primary" /> },
  { label: "Success rate", value: "99.42%", change: "+0.18%", icon: <CheckCircle2 className="size-4 text-success" /> },
  { label: "Active workflows", value: "24", change: "+3", icon: <Workflow className="size-4 text-info" /> },
  { label: "P95 latency", value: "842ms", change: "-126ms", icon: <Gauge className="size-4 text-warning" /> },
];

const volume = [38, 52, 44, 66, 58, 72, 49, 76, 83, 68, 89, 74, 92, 86];

const regions = [
  { name: "us-east-1", latency: "42ms", health: 99 },
  { name: "eu-west-3", latency: "68ms", health: 96 },
  { name: "ap-southeast-2", latency: "104ms", health: 91 },
];

const executions = [
  { id: "exec_9Jv3Q", workflow: "Support intake routing", status: "Succeeded", duration: "1.84s", time: "2m ago" },
  { id: "exec_9Jv2K", workflow: "Customer enrichment", status: "Succeeded", duration: "3.12s", time: "8m ago" },
  { id: "exec_9JuY7", workflow: "Invoice reconciliation", status: "Running", duration: "14.2s", time: "14m ago" },
  { id: "exec_9JtP1", workflow: "Churn risk monitor", status: "Failed", duration: "6.41s", time: "27m ago" },
];

export default function DashboardPage() {
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        {/* Page header */}
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold">System overview</h1>
            <p className="mt-1 text-sm text-muted-foreground">Monitor workflows, executions, and worker health.</p>
          </div>
          <Link href="/workflows" className={buttonVariants()}>
            <Plus /> New workflow
          </Link>
        </div>

        {/* Stats */}
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((s) => (
            <div className="metric-card" key={s.label}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                {s.icon}
              </div>
              <p className="mt-4 font-mono text-2xl font-semibold">{s.value}</p>
              <p className="mt-1 text-[10px] text-success">
                {s.change} <span className="text-muted-foreground">vs last month</span>
              </p>
            </div>
          ))}
        </div>

        {/* Volume + health */}
        <div className="mb-6 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <section className="panel">
            <div className="panel-header">
              <div><h2>Execution volume</h2><p>Last 14 days</p></div>
              <button className="range-select">14 days <ChevronDown /></button>
            </div>
            <div className="chart-area">
              <div className="chart-grid">{[0, 1, 2, 3].map((i) => <span key={i} />)}</div>
              <div className="bars">
                {volume.map((height, i) => (
                  <div key={i} className="bar-track"><div className="bar" style={{ height: `${height}%` }} /></div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div><h2>System health</h2><p>All regions operational</p></div>
              <span className="status-live">Healthy</span>
            </div>
            <div className="space-y-1 p-4">
              {regions.map((r) => (
                <div className="health-row" key={r.name}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-success" />{r.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{r.latency}</span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
                    <div className="h-full bg-success" style={{ width: `${r.health}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Recent executions */}
        <section className="panel">
          <div className="panel-header">
            <div><h2>Recent executions</h2><p>Live across all environments</p></div>
            <Link href="/executions" className={buttonVariants({ variant: "ghost", size: "sm" })}>View all</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Execution ID</th><th>Workflow</th><th>Status</th><th>Duration</th><th>Started</th></tr>
              </thead>
              <tbody>
                {executions.map((run) => (
                  <tr key={run.id}>
                    <td className="font-mono text-primary">
                      <Link href={`/executions/${run.id}`} className="hover:underline">{run.id}</Link>
                    </td>
                    <td className="font-medium">{run.workflow}</td>
                    <td>
                      <span className={cn("run-status", run.status === "Failed" ? "run-failed" : run.status === "Running" ? "run-running" : "run-success")}>
                        <span />{run.status}
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
      </div>
    </div>
  );
}