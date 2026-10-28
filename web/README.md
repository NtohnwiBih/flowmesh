# FlowMesh

A production-style front end for **distributed workflow automation**. Design workflows on a visual canvas, run simulated executions, inspect every step of a run, browse templates, and connect integrations such as Gmail, Slack, GitHub and Stripe.

FlowMesh is a UI project. All data is static demo data and there is no backend, so nothing you do in the app is persisted or sent anywhere.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Routes](#routes)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [The workflow editor](#the-workflow-editor)
- [Integrations and logos](#integrations-and-logos)
- [Theming and styling](#theming-and-styling)
- [Data layer](#data-layer)
- [Next.js 16 notes](#nextjs-16-notes)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Features

- **Visual workflow editor** built on React Flow: drag nodes from a library, connect them from any side, rename them and edit their input expressions.
- **Simulated execution** with step-by-step status, animated edges, a live log panel, and a "simulate failed run" option.
- **Execution history and detail views** with a clickable step trace and per-step output.
- **22 integrations** across Google Workspace, Microsoft 365, Collaboration, and Developer & Data, each with an inline SVG logo.
- **Templates gallery** that links into the editor.
- **Workspace and environment switching** (Production / Staging) available across the app.
- **Light, dark, and system themes.**
- **Collapsible sidebar**, mobile navigation drawer, usage meter, and account menu.
- **Accessible by default.** Radix UI primitives, real links for navigation, and ARIA labels on icon buttons.

## Tech stack

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, Cache Components) |
| UI library | React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4, `tw-animate-css` |
| Components | shadcn/ui pattern on Radix UI primitives |
| Canvas | `@xyflow/react` (React Flow 12) |
| Icons | `lucide-react` plus custom inline SVG brand marks |
| Toasts | `sonner` |
| Fonts | `geist` (Geist Sans and Geist Mono, bundled locally) |
| Variants and class merging | `class-variance-authority`, `clsx`, `tailwind-merge` |

## Getting started

### Prerequisites

- Node.js **20.9 or newer**
- npm (or another package manager; the commands below use npm)

### Install and run

```bash
git clone https://github.com/NtohnwiBih/flowmesh-web.git flowmesh-web
cd flowmesh-web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production build

```bash
npm run build
npm run start
```

The build needs **no network access for fonts**. Geist ships inside the `geist` npm package, so it works offline and behind proxies.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the dev server with Turbopack |
| `npm run build` | Type-check and create a production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |

## Routes

| Route | Page | Notes |
|---|---|---|
| `/` | Workflow editor | Full-bleed canvas, no page header |
| `/dashboard` | Dashboard | Stats, volume chart, system health, recent executions |
| `/executions` | Executions list | Rows link to the detail page |
| `/executions/[id]` | Execution detail | Prerendered for known IDs via `generateStaticParams`; unknown IDs call `notFound()` |
| `/templates` | Templates | Cards link to `/workflows?template=<id>` |
| `/integrations` | Integrations | Connect, disconnect, and add to workflow |
| `/workers` | Worker fleet | Reuses the overview components |
| `/analytics` | Analytics | Reuses the overview components |
| `/settings` | Workspace settings | |

See the [roadmap](#roadmap) for which of these are implemented so far.

## Project structure

```
flowmesh/
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── README.md
└── src/
    ├── app/
    │   ├── layout.tsx                  Root layout: fonts and metadata
    │   ├── globals.css                 Design tokens and component classes
    │   └── (app)/
    │       ├── layout.tsx              AppProvider + AppShell
    │       ├── not-found.tsx
    │       ├── page.tsx                /  (dashboard)
    │       ├── workflows/page.tsx
    │       ├── executions/
    │       │   ├── page.tsx
    │       │   └── [id]/page.tsx
    │       ├── templates/page.tsx
    │       ├── integrations/page.tsx
    │       ├── workers/page.tsx
    │       ├── analytics/page.tsx
    │       └── settings/page.tsx
    │
    ├── components/
    │   ├── layout/                     Shell: sidebar, topbar, menus, usage meter
    │   ├── providers/app-provider.tsx  Workspace, environment, profile, theme, pending integration
    │   ├── shared/page-container.tsx   Title, subtitle, "New workflow" button
    │   ├── overview/                   Dashboard, workers, analytics widgets
    │   ├── executions/                 Execution list and detail views
    │   ├── templates/template-grid.tsx
    │   ├── integrations/
    │   │   ├── integration-grid.tsx
    │   │   └── integration-logo.tsx    Inline SVG brand marks
    │   ├── settings/settings-panel.tsx
    │   ├── workflows/workflows-view.tsx
    │   ├── workflow-editor.tsx         React Flow canvas (client component)
    │   ├── workflow-logs.tsx           Execution log panel (client component)
    │   ├── account-views.tsx           Profile, preferences, API keys dialogs
    │   └── ui/                         shadcn/ui primitives
    │
    ├── hooks/use-theme.ts
    └── lib/
        ├── nav.ts                      Sidebar items and active-route logic
        ├── integrations.ts             Integration catalog
        ├── utils.ts                    cn() helper
        └── data/
            ├── executions.ts
            ├── overview.ts
            ├── templates.ts
            └── workspaces.ts
```

## Architecture

### Server and client components

Pages under `src/app/(app)/` are **server components** wherever possible. They export `metadata` and render a thin client component for anything interactive. This pattern repeats throughout the project:

```tsx
// page.tsx (server): metadata + layout
export default function IntegrationsPage() {
  return (
    <PageContainer title="Integrations" subtitle="Connect the services your workflows depend on.">
      <IntegrationGrid />   {/* "use client" */}
    </PageContainer>
  );
}
```

Components that need state, effects, or router hooks start with `"use client"`. Purely presentational components, such as `TemplateGrid`, `PageContainer` and `IntegrationLogo`, stay on the server.

### Layout and scrolling

`(app)/layout.tsx` wraps every page in `AppProvider` and `AppShell`. The content area must be:

```tsx
<div className="min-h-0 flex-1">{children}</div>
```

Each page then controls its own scrolling:

- **Standard pages** use `PageContainer`, which renders `h-full overflow-y-auto p-4 sm:p-6 lg:p-8`.
- **The workflow editor** is full-bleed and fills the area with `h-full`.

If a page doesn't scroll, the `min-h-0` on this wrapper is the first thing to check.

### Global state

`AppProvider` (`components/providers/app-provider.tsx`) holds app-wide client state, exposed through a `useApp()` hook:

| State | Purpose |
|---|---|
| `workspace` | Active workspace (Acme Engineering, Acme Labs) |
| `environment` | Production or Staging |
| `profile` | Current user name, email, and role |
| `theme` | `system`, `light`, or `dark` |
| `pendingIntegration` | Set when you click "Add to workflow" on the Integrations page; consumed by the editor |

### Navigation

Navigation is real routing, not component state. `lib/nav.ts` defines the sidebar items and the active-route logic. Matching is by prefix so a parent item stays highlighted on child routes:

```ts
pathname === href || (href !== "/" && pathname.startsWith(`${href}/`))
```

This keeps "Execution Details" highlighted on `/executions/exec_9Jv3Q`.

## The workflow editor

`workflow-editor.tsx` is a client component built on `@xyflow/react`.

**Building**
- Drag items from the left library onto the canvas (triggers, core nodes, AI nodes, integrations).
- Every node has a handle on all four sides. Unused sides show a `+` stub that opens the **Add connected step** panel, which places and links the new node automatically.
- Click a node to open the **Configure node** panel and edit its display name and input expression.

**Running**
- **Run** executes a simulated run. Steps are ordered by dependency rather than canvas position, and a cycle blocks the run with an error.
- The run dropdown offers **Simulate successful run** and **Simulate failed run** (the last step fails).
- While running, nodes show a spinner, edges animate, editing is locked, and the log panel streams entries.
- The status bar shows progress (`Running · 3/6 steps`) and the final result.

**From other pages**
- Clicking **Add to workflow** on an integration sets `pendingIntegration` in `AppProvider` and navigates to `/workflows`. The editor adds the node, connects it after "Create incident", shows a toast, and clears the pending value.
- Template cards link to `/workflows?template=<id>`. The editor doesn't read this parameter yet. See the [roadmap](#roadmap).

**Save, Validate, and Publish** show toasts only. They are placeholders for real API calls.

## Integrations and logos

The catalog lives in `src/lib/integrations.ts`:

```ts
type Integration = {
  key: string;        // "gmail"
  name: string;       // "Gmail"
  category: string;   // one of integrationCategories
  action: string;     // "Send email"
  description: string;
  connected: boolean; // initial state
};
```

Logos are inline SVGs in `components/integrations/integration-logo.tsx`, looked up by `key`:

```tsx
<IntegrationLogo id="gmail" name="Gmail" className="size-5" />
```

They are simplified marks in brand colors, drawn from basic shapes. There are no image requests and no extra packages. Unknown keys fall back to the integration's initials.

**Adding an integration**
1. Add an entry to `integrations` in `lib/integrations.ts`.
2. Add a glyph to the `glyphs` map in `integration-logo.tsx` under the same `key`, using a `viewBox="0 0 24 24"` coordinate space.
3. Without step 2 the app still works and shows initials.

For exact artwork, put the official SVGs from each vendor's press kit in `public/logos/` and render them from `IntegrationLogo` instead. Follow each vendor's brand guidelines before a public release.

## Theming and styling

- Tailwind CSS 4 with design tokens defined in `globals.css` (`background`, `foreground`, `primary`, `success`, `warning`, `info`, `destructive`, and so on).
- Component classes such as `.panel`, `.panel-header`, `.metric-card`, `.data-table`, `.run-status`, `.template-card`, `.nav-item`, `.flow-node` and `.integration-logo` are defined in `globals.css`.
- Themes are `system`, `light`, and `dark`, managed by `hooks/use-theme.ts` and the account preferences. The root `<html>` has `suppressHydrationWarning` because the theme class is applied before hydration.
- Brand logos use fixed colors. Their containers use a neutral `bg-card` so they stay readable in both themes. GitHub uses `currentColor` and follows the text color.

## Data layer

Everything is static and typed, living in `src/lib/data/`:

| File | Contents |
|---|---|
| `executions.ts` | Execution summaries, step traces, `getExecution(id)` |
| `overview.ts` | Dashboard and worker stats, chart values, region health |
| `templates.ts` | Template catalog with icons and node counts |
| `workspaces.ts` | Workspaces and environments |

Components import from these files rather than hardcoding values, so the list and detail views for executions can't drift apart. To connect a real backend, replace the exports with fetches. The `getExecution(id)` signature is a natural place to start.

## Next.js 16 notes

This project enables **Cache Components** and **Partial Prefetching** in `next.config.ts`.

- Reading request-time data (cookies, headers, `searchParams`) outside a `<Suspense>` boundary can produce "uncached data" or "blocking route" build errors. The current pages use static data and `generateStaticParams`, so they build cleanly.
- `params` is a **Promise** in dynamic routes and must be awaited:

  ```tsx
  type Props = { params: Promise<{ id: string }> };
  export default async function Page({ params }: Props) {
    const { id } = await params;
  }
  ```

- When you start reading `?template=` in the editor, use `useSearchParams` in a client component wrapped in `<Suspense>`.

## Troubleshooting

**Build fails fetching Google Fonts**
`next/font/google` downloads fonts at build time. This project uses `geist/font/sans` and `geist/font/mono` from the `geist` package instead. Don't switch back to `next/font/google` on a machine without network access.

**TypeScript errors in `src/components/ui/`**
Type-checking covers every file under `src/`, including unused UI components. Keep only the primitives the app imports, and install the matching Radix package for each one you keep. At minimum:

```bash
npm install @radix-ui/react-dialog @radix-ui/react-slot clsx
```

Delete `calendar.tsx` and `chart.tsx` unless you need them. They were written for `react-day-picker` v9 and `recharts` v2, while this project uses v10 and v3.

**Leftover dependencies**
If you migrated from a TanStack Start project, remove packages the Next.js app doesn't use:

```bash
npm uninstall @tanstack/react-router @tanstack/react-start cn
```

The `cn` package on npm is unrelated to the `cn()` helper in `src/lib/utils.ts`.

**A page doesn't scroll**
Make sure the `(app)` layout wraps `{children}` in `<div className="min-h-0 flex-1">`, and that the page uses `PageContainer`.

**`Button asChild` isn't supported**
Check that `@radix-ui/react-slot` is installed and that `button.tsx` renders `Slot` when `asChild` is set.

**404 on a sidebar link**
Each sidebar item needs a matching `page.tsx` under `src/app/(app)/`.

## Roadmap

Status of each route in the Next.js migration:

| Route | Status |
|---|---|
| `/dashboard` | To do: `overview`, `stat-cards`, `volume-chart`, 
`system-health` |
| `/executions` and `/executions/[id]` | Done |
| `/templates` | Done |
| `/integrations` (with SVG logos) | Done |
| `/` (workflow) | Done |
| `/workers` | To do: reuses the overview components |
| `/analytics` | To do: reuses the overview components |
| `/settings` | To do: `settings-panel` |

Ideas beyond the migration:

- Read `?template=<id>` in the editor and pre-load that template's nodes.
- Persist connected integrations in `AppProvider` so they survive navigation.
- Replace the static data layer with a real API and authentication.
- Wire Save, Validate, and Publish to real endpoints.
- Add search (the `⌘K` command palette; `cmdk` is already installed).
- Add tests (Vitest and Testing Library) for the run-ordering logic and `getExecution`.

## License

Add your license here.