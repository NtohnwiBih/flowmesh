import Link from "next/link";
import { templates } from "@/lib/data/templates";

export function TemplateGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {templates.map(({ id, name, description, icon: Icon, nodes }) => (
        <Link
          key={id}
          href={`/workflows?template=${id}`}
          className="template-card"
        >
          <div className="template-icon"><Icon /></div>
          <h3>{name}</h3>
          <p>{description}</p>
          <div>
            <span className="font-mono">{nodes} nodes</span>
            <span>Use template →</span>
          </div>
        </Link>
      ))}
    </div>
  );
}