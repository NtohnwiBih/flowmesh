import { useState } from "react";
import { Check, Copy, KeyRound, Plus, SlidersHorizontal, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ThemeMode } from "@/hooks/use-theme";

export type AccountView = "profile" | "preferences" | "keys";
export type Profile = { name: string; email: string; role: string };
type DemoKey = { id: number; name: string; scope: string; created: string; lastUsed: string };

export function AccountViews({ view, onViewChange, profile, onSaveProfile, theme, onThemeChange, workspace }: {
  view: AccountView | null;
  onViewChange: (view: AccountView | null) => void;
  profile: Profile;
  onSaveProfile: (profile: Profile) => void;
  theme: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  workspace: string;
}) {
  const [draft, setDraft] = useState(profile);
  const [timezone, setTimezone] = useState("UTC");
  const [failures, setFailures] = useState(true);
  const [digest, setDigest] = useState(false);
  const [keys, setKeys] = useState<DemoKey[]>([
    { id: 1, name: "Local development", scope: "Read & write", created: "Oct 2, 2026", lastUsed: "2 hours ago" },
    { id: 2, name: "Monitoring", scope: "Read only", created: "Sep 18, 2026", lastUsed: "15 minutes ago" },
  ]);
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [scope, setScope] = useState("Read only");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const initials = profile.name.trim().split(/\s+/).map((word) => word[0]).slice(0, 2).join("").toUpperCase();

  return <Dialog open={view !== null} onOpenChange={(open) => { if (!open) { onViewChange(null); setDraft(profile); setCreating(false); setNewKey(null); setRevokeId(null); } }}>
    <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-lg p-0">
      <DialogHeader className="border-b border-border px-6 pb-5 pt-6 text-left">
        <DialogTitle className="font-display tracking-normal">Account settings</DialogTitle>
        <DialogDescription>{workspace}</DialogDescription>
      </DialogHeader>
      <Tabs value={view ?? "profile"} onValueChange={(value) => { if (value === "profile" || value === "preferences" || value === "keys") onViewChange(value); }} className="min-w-0 px-4 pb-6 sm:px-6">
        <TabsList className="mb-5 grid w-full grid-cols-3">
          <TabsTrigger value="profile" className="gap-1.5 px-1 text-xs sm:px-3"><UserRound className="size-3.5" />Profile</TabsTrigger>
          <TabsTrigger value="preferences" className="gap-1.5 px-1 text-xs sm:px-3"><SlidersHorizontal className="size-3.5" />Preferences</TabsTrigger>
          <TabsTrigger value="keys" className="gap-1.5 px-1 text-xs sm:px-3"><KeyRound className="size-3.5" />API keys</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <div className="mb-6 flex items-center gap-4"><div className="grid size-14 shrink-0 place-items-center rounded-full bg-secondary font-display text-lg font-semibold">{initials}</div><div className="min-w-0"><h2 className="truncate text-sm font-semibold">{profile.name}</h2><p className="truncate text-xs text-muted-foreground">{profile.email}</p><span className="mt-1 inline-block text-[10px] text-primary">Workspace admin</span></div></div>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); const saved = { ...draft, name: draft.name.trim(), email: draft.email.trim(), role: draft.role.trim() }; if (!saved.name) return; onSaveProfile(saved); setDraft(saved); toast.success("Profile updated", { description: "Saved for this preview session." }); }}>
            <div className="space-y-2"><Label htmlFor="profile-name">Full name</Label><Input id="profile-name" required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="profile-email">Email address</Label><Input id="profile-email" type="email" required value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="profile-role">Job title</Label><Input id="profile-role" maxLength={80} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} /></div>
            <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={() => setDraft(profile)}>Reset</Button><Button type="submit">Save profile</Button></div>
          </form>
        </TabsContent>
        <TabsContent value="preferences" className="space-y-5">
          <div className="space-y-2"><Label htmlFor="account-theme">Appearance</Label><Select value={theme} onValueChange={(value: string) => { const nextTheme = value as ThemeMode; if (nextTheme === "system" || nextTheme === "light" || nextTheme === "dark") onThemeChange(nextTheme); }}><SelectTrigger id="account-theme"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label htmlFor="account-timezone">Timezone</Label><Select value={timezone} onValueChange={setTimezone}><SelectTrigger id="account-timezone"><SelectValue /></SelectTrigger><SelectContent>{["UTC", "Europe/London", "Europe/Paris", "Africa/Douala", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"].map((zone) => <SelectItem key={zone} value={zone}>{zone}</SelectItem>)}</SelectContent></Select></div>
          <div className="divide-y divide-border border-y border-border">
            <div className="flex items-center justify-between gap-4 py-4"><div><Label htmlFor="failure-alerts">Execution failure alerts</Label><p className="mt-1 text-xs text-muted-foreground">Email notifications for failed runs</p></div><Switch id="failure-alerts" checked={failures} onCheckedChange={setFailures} /></div>
            <div className="flex items-center justify-between gap-4 py-4"><div><Label htmlFor="weekly-digest">Weekly activity digest</Label><p className="mt-1 text-xs text-muted-foreground">A summary of your workspace activity</p></div><Switch id="weekly-digest" checked={digest} onCheckedChange={setDigest} /></div>
          </div>
          <div className="flex justify-end"><Button onClick={() => toast.success("Preferences updated", { description: "Notification and timezone choices are simulated; no emails will be sent." })}>Save preferences</Button></div>
        </TabsContent>
        <TabsContent value="keys" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Personal API keys</h2><p className="mt-1 text-xs text-muted-foreground">Demo keys only · no API access</p></div><Button size="sm" onClick={() => { setCreating(true); setNewKey(null); setCopied(false); }}><Plus />Create key</Button></div>
          {creating && <form className="space-y-3 border-y border-border py-4" onSubmit={(event) => { event.preventDefault(); if (!keyName.trim()) return; const id = Date.now(); setKeys((current) => [...current, { id, name: keyName.trim(), scope, created: "Just now", lastUsed: "Never" }]); setNewKey(`fm_demo_not_valid_${id}`); setKeyName(""); setCreating(false); toast.success("Demo key created"); }}>
            <div className="space-y-2"><Label htmlFor="key-name">Key name</Label><Input id="key-name" autoFocus required maxLength={60} placeholder="e.g. Staging automation" value={keyName} onChange={(e) => setKeyName(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="key-scope">Permissions</Label><Select value={scope} onValueChange={setScope}><SelectTrigger id="key-scope"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Read only">Read only</SelectItem><SelectItem value="Read & write">Read &amp; write</SelectItem></SelectContent></Select></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit">Generate demo key</Button></div>
          </form>}
          {newKey && <div className="rounded-md border border-border bg-muted p-3"><p className="mb-2 text-xs font-medium">New demo key</p><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all font-mono text-xs">{newKey}</code><Button variant="ghost" size="icon" title="Copy demo key" aria-label="Copy demo key" onClick={async () => { try { await navigator.clipboard.writeText(newKey); setCopied(true); toast.success("Demo key copied"); } catch { toast.error("Could not copy. Select the key to copy it manually."); } }}>{copied ? <Check /> : <Copy />}</Button></div></div>}
          <div className="divide-y divide-border">
            {keys.map((key) => <div className="py-4" key={key.id}><div className="flex items-start gap-3"><KeyRound className="mt-1 size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{key.name}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">fm_demo_•••••••• · {key.scope}</p><p className="mt-2 text-[10px] text-muted-foreground">Created {key.created} · Last used {key.lastUsed}</p></div><Button variant="ghost" size="icon" className="shrink-0 text-destructive" title={`Revoke ${key.name}`} aria-label={`Revoke ${key.name}`} onClick={() => setRevokeId(key.id)}><Trash2 /></Button></div>{revokeId === key.id && <div className="mt-3 flex flex-wrap items-center justify-end gap-2"><span className="mr-auto text-xs">Revoke this demo key?</span><Button size="sm" variant="outline" onClick={() => setRevokeId(null)}>Cancel</Button><Button size="sm" variant="destructive" onClick={() => { setKeys((current) => current.filter((item) => item.id !== key.id)); setRevokeId(null); setNewKey(null); toast.success("Demo key revoked"); }}>Revoke key</Button></div>}</div>)}
            {keys.length === 0 && <div className="py-10 text-center"><KeyRound className="mx-auto mb-3 size-6 text-muted-foreground" /><p className="text-sm font-medium">No API keys</p></div>}
          </div>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>;
}