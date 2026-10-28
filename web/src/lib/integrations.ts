export type Integration = { key: string; name: string; category: string; action: string; description: string; connected: boolean };

export const integrationCategories = ["Google Workspace", "Microsoft 365", "Collaboration", "Developer & Data"] as const;

export const integrations: Integration[] = [
  { key: "gmail", name: "Gmail", category: "Google Workspace", action: "Send email", description: "Send, label, and read messages", connected: true },
  { key: "gsheets", name: "Google Sheets", category: "Google Workspace", action: "Append row", description: "Read and write spreadsheet rows", connected: true },
  { key: "gdrive", name: "Google Drive", category: "Google Workspace", action: "Upload file", description: "Store and share files and folders", connected: false },
  { key: "gdocs", name: "Google Docs", category: "Google Workspace", action: "Create document", description: "Generate documents from templates", connected: false },
  { key: "gcal", name: "Google Calendar", category: "Google Workspace", action: "Create event", description: "Schedule meetings and reminders", connected: false },
  { key: "gmeet", name: "Google Meet", category: "Google Workspace", action: "Create meeting", description: "Spin up video meeting links", connected: false },
  { key: "outlook", name: "Outlook", category: "Microsoft 365", action: "Send email", description: "Mail and calendar automation", connected: true },
  { key: "teams", name: "Microsoft Teams", category: "Microsoft 365", action: "Post message", description: "Notify channels and chats", connected: false },
  { key: "excel", name: "Excel Online", category: "Microsoft 365", action: "Add table row", description: "Update workbooks in OneDrive", connected: false },
  { key: "onedrive", name: "OneDrive", category: "Microsoft 365", action: "Upload file", description: "Sync and share files", connected: false },
  { key: "sharepoint", name: "SharePoint", category: "Microsoft 365", action: "Create list item", description: "Manage sites, lists, and docs", connected: false },
  { key: "word", name: "Word", category: "Microsoft 365", action: "Create document", description: "Generate documents from templates", connected: false },
  { key: "slack", name: "Slack", category: "Collaboration", action: "Post message", description: "Send alerts to channels", connected: true },
  { key: "notion", name: "Notion", category: "Collaboration", action: "Create page", description: "Write to databases and pages", connected: false },
  { key: "jira", name: "Jira", category: "Collaboration", action: "Create issue", description: "Open and update tickets", connected: false },
  { key: "asana", name: "Asana", category: "Collaboration", action: "Create task", description: "Assign tasks to teams", connected: false },
  { key: "trello", name: "Trello", category: "Collaboration", action: "Create card", description: "Move cards across boards", connected: false },
  { key: "zoom", name: "Zoom", category: "Collaboration", action: "Create meeting", description: "Schedule video calls", connected: false },
  { key: "github", name: "GitHub", category: "Developer & Data", action: "Create issue", description: "Repos, issues, and pull requests", connected: true },
  { key: "stripe", name: "Stripe", category: "Developer & Data", action: "Create invoice", description: "Payments and billing events", connected: true },
  { key: "postgres", name: "PostgreSQL", category: "Developer & Data", action: "Run query", description: "Read and write tables", connected: false },
  { key: "hubspot", name: "HubSpot", category: "Developer & Data", action: "Upsert contact", description: "CRM contacts and deals", connected: false },
];

export const initials = (name: string) => name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
