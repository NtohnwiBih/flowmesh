"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/client";
import { getDraft, publishDraft, putDraft, validateDefinition } from "@/lib/api/endpoints";
import type { Issue } from "@/lib/api/types";
import type { Definition } from "@/lib/definition";
import { describeProblems } from "@/lib/issues";

export type DraftMeta = {
  etag: string; // the version stamp we last saw; sent as If-Match
  revision: number;
  base_version: number | null;
  production_version: number | null;
  has_unpublished_changes: boolean;
  staging_verified: boolean;
};

const reason = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Save, validate and publish for one draft, plus conflict handling.
 *  `definition` is the draft as currently drawn; `initialDefinition` is what was loaded. */
export function useDraftActions({
  workflowId, definition, readOnly, initialMeta, initialDefinition, onPublished,
}: {
  workflowId: string;
  definition: Definition;
  readOnly: boolean;
  initialMeta: DraftMeta;
  initialDefinition: Definition;
  onPublished?: (version: number) => void;
}) {
  const [meta, setMeta] = useState(initialMeta);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialDefinition)); // the last saved (or loaded) content
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false); // a synchronous guard: state updates are too slow to stop a double click

  const json = useMemo(() => JSON.stringify(definition), [definition]);
  const dirty = !readOnly && json !== baseline;

  const saved = useCallback((res: { etag: string; revision: number; issues: Issue[] }, savedJson: string) => {
    setMeta((m) => ({ ...m, etag: res.etag, revision: res.revision, has_unpublished_changes: true }));
    setBaseline(savedJson); // what was SENT, so edits made while saving stay "unsaved"
    setIssues(res.issues);
  }, []);

  /** Returns the new ETag and any problems, or null if it failed (already reported to the user). */
  const save = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (readOnly || inFlight.current) return null;
    inFlight.current = true;
    setSaving(true);
    const sentJson = json;
    try {
      const res = await putDraft(workflowId, definition, meta.etag);
      saved(res, sentJson);
      if (!opts.quiet) {
        if (res.issues.length) toast.warning("Saved", { description: `${describeProblems(res.issues.length)} to fix before you can publish.` });
        else toast.success("Saved");
      }
      return { etag: res.etag, issues: res.issues };
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) setConflict(true);
      else toast.error("Could not save", { description: reason(err) });
      return null;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [readOnly, json, workflowId, definition, meta.etag, saved]);

  const validate = useCallback(async () => {
    if (readOnly) return;
    setValidating(true);
    try {
      const res = await validateDefinition(workflowId, definition);
      setIssues(res.issues);
      if (res.valid) toast.success("No problems found", { description: "This draft can be published." });
      else toast.error(describeProblems(res.issues.length), { description: "Steps with problems are marked on the canvas." });
    } catch (err) {
      toast.error("Could not validate", { description: reason(err) });
    } finally {
      setValidating(false);
    }
  }, [readOnly, workflowId, definition]);

  /** Saves first when there are unsaved changes, then publishes exactly what was saved. */
  const publish = useCallback(async (): Promise<boolean> => {
    if (readOnly || inFlight.current) return false;
    setPublishing(true);
    try {
      let etag = meta.etag;
      if (dirty) {
        const result = await save({ quiet: true });
        if (!result) return false;
        if (result.issues.length) {
          toast.error("Saved, but not published", { description: `${describeProblems(result.issues.length)} to fix first.` });
          return false;
        }
        etag = result.etag;
      }
      const res = await publishDraft(workflowId, etag);
      setMeta((m) => ({ ...m, base_version: res.version, production_version: res.version, has_unpublished_changes: false, staging_verified: res.staging_verified }));
      setIssues([]);
      onPublished?.(res.version);
      toast.success(`Version ${res.version} is now live`, { description: res.staging_verified ? undefined : "It was not verified in staging first." });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) setConflict(true);
      else if (err instanceof ApiError && err.status === 422 && err.issues.length > 0) {
        setIssues(err.issues);
        toast.error(`Cannot publish: ${describeProblems(err.issues.length)}`, { description: "Steps with problems are marked on the canvas." });
      } else toast.error("Could not publish", { description: reason(err) });
      return false;
    } finally {
      setPublishing(false);
    }
  }, [readOnly, meta.etag, dirty, save, workflowId, onPublished]);

  /** Conflict resolution: take the server's current stamp and save our version over theirs. */
  const overwrite = useCallback(async () => {
    setResolving(true);
    try {
      const latest = await getDraft(workflowId);
      const res = await putDraft(workflowId, definition, latest.etag);
      saved(res, json);
      setConflict(false);
      toast.success("Saved your version");
    } catch (err) {
      toast.error("Could not save", { description: reason(err) });
    } finally {
      setResolving(false);
    }
  }, [workflowId, definition, json, saved]);

  return {
    meta, issues, setIssues, dirty,
    saving, validating, publishing, resolving,
    conflict, dismissConflict: () => setConflict(false),
    save, validate, publish, overwrite,
  };
}
