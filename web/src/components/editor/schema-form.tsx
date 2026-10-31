"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Issue } from "@/lib/api/types";
import { fieldMessage } from "@/lib/issues";
import { clientErrors, parseJsonField, parseNumber, setField, type Config, type Field } from "@/lib/schema-form";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

/** A form built from a node type's JSON Schema. Each edit calls onChange with the whole new config. */
export function SchemaForm({
  fields, config, onChange, issues, disabled = false,
}: {
  fields: Field[];
  config: Config | undefined;
  onChange: (next: Config | undefined) => void;
  issues: Issue[]; // server-reported problems for this node
  disabled?: boolean;
}) {
  // Local checks show only after someone has visited a field, so a fresh step is not covered in red.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const errors = clientErrors(fields, config);

  if (fields.length === 0) return <p className="text-xs text-muted-foreground">This step has no settings.</p>;

  return (
    <div className="space-y-5">
      {fields.map((f) => {
        const id = `field-${f.key}`;
        const message = fieldMessage(issues, f.key) ?? (touched.has(f.key) ? errors[f.key] : undefined);
        const touch = () => setTouched((s) => (s.has(f.key) ? s : new Set(s).add(f.key)));
        const set = (value: unknown) => onChange(setField(config, f.key, value));
        const value = config?.[f.key];
        const common = { id, disabled, "aria-invalid": message ? true : undefined, "aria-describedby": message ? `${id}-error` : undefined } as const;

        return (
          <div className="config-section" key={f.key}>
            <Label htmlFor={id} className="config-label">
              {f.label}{f.required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
            </Label>

            {f.kind === "text" && (
              <Input
                {...common} className="font-mono text-xs" maxLength={f.maxLength} value={typeof value === "string" ? value : ""}
                onChange={(e) => set(e.target.value)} onBlur={touch}
              />
            )}

            {f.kind === "select" && (
              <select {...common} className={SELECT_CLASS} value={typeof value === "string" ? value : ""} onChange={(e) => { set(e.target.value); touch(); }}>
                {!f.required && <option value="">{f.defaultValue !== undefined ? `Default (${String(f.defaultValue)})` : "Not set"}</option>}
                {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}

            {(f.kind === "number" || f.kind === "integer") && (
              <Input
                {...common} type="number" step={f.kind === "integer" ? 1 : "any"} min={f.minimum} max={f.maximum}
                value={typeof value === "number" ? value : ""} onBlur={touch}
                onChange={(e) => { const n = parseNumber(e.target.value, f.kind as "number" | "integer"); if (n !== "invalid") set(n); }}
              />
            )}

            {f.kind === "boolean" && (
              <Switch
                id={id} disabled={disabled} aria-label={f.label}
                checked={typeof value === "boolean" ? value : f.defaultValue === true}
                onCheckedChange={(on) => { set(on); touch(); }}
              />
            )}

            {f.kind === "json" && <JsonField {...common} value={value} onValid={set} onBlur={touch} />}

            {message && <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-destructive">{message}</p>}
            {f.description && <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{f.description}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** A JSON editor that keeps what you typed while it is not yet valid, and only reports valid values. */
function JsonField({
  id, value, onValid, onBlur, disabled, ...aria
}: {
  id: string; value: unknown; onValid: (v: unknown) => void; onBlur: () => void; disabled?: boolean;
  "aria-invalid"?: boolean; "aria-describedby"?: string;
}) {
  const [text, setText] = useState(() => (value === undefined ? "" : JSON.stringify(value, null, 2)));
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Textarea
        {...aria} id={id} rows={5} spellCheck={false} disabled={disabled} className="font-mono text-xs" value={text} onBlur={onBlur}
        onChange={(e) => {
          setText(e.target.value);
          const r = parseJsonField(e.target.value);
          if (r.ok) { setError(null); onValid(r.value); } else setError(r.error);
        }}
      />
      {error && <p role="alert" className="mt-1.5 text-xs text-destructive">Not valid JSON: {error}</p>}
    </>
  );
}
