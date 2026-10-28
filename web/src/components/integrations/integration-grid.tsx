"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { integrations, integrationCategories } from "@/lib/integrations";
import { cn } from "@/lib/utils";
import { useApp } from "../app-provider";
import { IntegrationLogo } from "@/components/integrations/integration-logo";

export function IntegrationGrid() {
  const router = useRouter();
  const { setPendingIntegration } = useApp();

  const [filter, setFilter] = useState<string>("All");
  const [connected, setConnected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(integrations.map((i) => [i.key, i.connected]))
  );

  const list = integrations.filter((i) => filter === "All" || i.category === filter);

  const addToWorkflow = (key: string) => {
    setPendingIntegration(key);
    router.push("/workflows");
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        {["All", ...integrationCategories].map((c) => (
          <Button
            key={c}
            size="sm"
            variant={filter === c ? "default" : "outline"}
            onClick={() => setFilter(c)}
          >
            {c}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((item) => {
          const on = connected[item.key];
          return (
            <div className="panel flex flex-col gap-3 p-4" key={item.key}>
              <div className="flex items-start gap-3">
                <div className="integration-logo shrink-0">
                  <IntegrationLogo id={item.key} name={item.name} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">{item.name}</h3>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <span
                  className={cn(
                    "mt-1 size-2 shrink-0 rounded-full",
                    on ? "bg-success" : "bg-muted-foreground"
                  )}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase text-muted-foreground">
                  {item.category}
                </span>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setConnected((s) => ({ ...s, [item.key]: !on }));
                      toast.success(
                        on ? `${item.name} disconnected` : `${item.name} connected`
                      );
                    }}
                  >
                    {on ? "Disconnect" : "Connect"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!on}
                    onClick={() => addToWorkflow(item.key)}
                  >
                    <Plus /> Add to workflow
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}