import { Activity, Bot, Boxes, Clock3, Sparkles, Zap, type LucideIcon } from "lucide-react";

export type Template = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  nodes: number;
};

export const templates: Template[] = [
  { id: "ai-support-triage", name: "AI support triage", description: "Classify and route incoming support requests", icon: Sparkles, nodes: 5 },
  { id: "data-enrichment", name: "Data enrichment", description: "Enrich new records from external sources", icon: Zap, nodes: 7 },
  { id: "scheduled-etl", name: "Scheduled ETL", description: "Transform and sync data on a schedule", icon: Clock3, nodes: 9 },
  { id: "incident-response", name: "Incident response", description: "Coordinate alerts across engineering teams", icon: Activity, nodes: 8 },
  { id: "content-moderation", name: "Content moderation", description: "Score, review, and route user content", icon: Bot, nodes: 6 },
  { id: "webhook-fan-out", name: "Webhook fan-out", description: "Reliably deliver events to many endpoints", icon: Boxes, nodes: 4 },
];