import type { ReactNode } from "react";
import { initials } from "@/lib/integrations";
import { cn } from "@/lib/utils";

/** Shared page shape for Google Docs / Sheets. */
function Doc({ color, fold, children }: { color: string; fold: string; children: ReactNode }) {
  return (
    <>
      <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill={color} />
      <path d="M14 2l6 6h-4a2 2 0 0 1-2-2z" fill={fold} />
      {children}
    </>
  );
}

/** Shared "back page + front square" shape for Word / Excel. */
function OfficeApp({ back, front, children }: { back: string; front: string; children: ReactNode }) {
  return (
    <>
      <rect x="9" y="3.5" width="13" height="17" rx="2" fill={back} />
      <rect x="2" y="6" width="13" height="12" rx="2" fill={front} />
      {children}
    </>
  );
}

const slackPiece = (
  <>
    <rect x="13.5" y="2.5" width="3.5" height="8.5" rx="1.75" />
    <circle cx="8.25" cy="4.25" r="1.75" />
  </>
);

const glyphs: Record<string, ReactNode> = {
  // ── Google Workspace ──────────────────────────────────────────
  gmail: (
    <>
      <path d="M3.5 19H7V10.5L2 6.8v10.7A1.5 1.5 0 0 0 3.5 19z" fill="#4285F4" />
      <path d="M20.5 19H17V10.5l5-3.7v10.7a1.5 1.5 0 0 1-1.5 1.5z" fill="#34A853" />
      <path d="M2 6.8V6a2 2 0 0 1 2-2h.5L12 9.6 19.5 4H20a2 2 0 0 1 2 2v.8l-5 3.7-5 3.7-5-3.7z" fill="#EA4335" />
      <path d="M17 10.5V19h3.5a1.5 1.5 0 0 0 1.5-1.5V6.8z" fill="#34A853" opacity="0" />
    </>
  ),
  gsheets: (
    <Doc color="#0F9D58" fold="#87CEAC">
      <path d="M7.5 12h9v7h-9z" fill="none" stroke="#fff" strokeWidth="1.2" />
      <path d="M7.5 14.3h9M7.5 16.7h9M11.2 12v7" stroke="#fff" strokeWidth="1.2" />
    </Doc>
  ),
  gdocs: (
    <Doc color="#4285F4" fold="#A1C2FA">
      <path d="M8 12.5h8M8 15h8M8 17.5h5" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
    </Doc>
  ),
  gdrive: (
    <>
      <path d="M8 3h4L6 13.5H2z" fill="#34A853" />
      <path d="M12 3h4l6 10.5h-4z" fill="#FFBA00" />
      <path d="M2 13.5h20l-3.5 6h-13z" fill="#4285F4" />
    </>
  ),
  gcal: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#fff" stroke="#4285F4" strokeWidth="1.8" />
      <path d="M3 8h18V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3z" fill="#4285F4" />
      <text x="12" y="17.5" textAnchor="middle" fontSize="9" fontWeight="700" fontFamily="Arial, sans-serif" fill="#4285F4">31</text>
    </>
  ),
  gmeet: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2.2" fill="#00832D" />
      <path d="M15.5 10.5 21.5 6.5v11l-6-4z" fill="#00AC47" />
      <path d="M2.5 14.5v1.3A2.2 2.2 0 0 0 4.7 18H6z" fill="#EA4335" />
      <path d="M2.5 8.2A2.2 2.2 0 0 1 4.7 6H6L2.5 9.5z" fill="#FBBC04" />
    </>
  ),

  // ── Microsoft 365 ─────────────────────────────────────────────
  outlook: (
    <>
      <rect x="9" y="4.5" width="13" height="15" rx="2" fill="#28A8EA" />
      <rect x="2" y="6.5" width="13" height="11" rx="2" fill="#0364B8" />
      <circle cx="8.5" cy="12" r="2.8" fill="none" stroke="#fff" strokeWidth="1.6" />
    </>
  ),
  teams: (
    <>
      <circle cx="18.5" cy="7" r="2.2" fill="#5059C9" />
      <rect x="15" y="10" width="7" height="8" rx="2" fill="#5059C9" />
      <circle cx="11" cy="6.5" r="3" fill="#7B83EB" />
      <rect x="3" y="10" width="13" height="10" rx="2" fill="#4F52B2" />
      <path d="M6.8 12.8h5.4M9.5 12.8V17.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  excel: (
    <OfficeApp back="#21A366" front="#107C41">
      <path d="M5.5 9.5l5 5M10.5 9.5l-5 5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </OfficeApp>
  ),
  word: (
    <OfficeApp back="#41A5EE" front="#185ABD">
      <path d="M4.2 9.5 5.9 15 8.5 10.5 11.1 15l1.7-5.5" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </OfficeApp>
  ),
  onedrive: (
    <>
      <path d="M6.5 18.5a4 4 0 0 1-.4-7.98 5.5 5.5 0 0 1 10.6-1.1A4.5 4.5 0 0 1 17.5 18.5z" fill="#28A8EA" />
      <path d="M2 15.5a3.5 3.5 0 0 1 3.4-3.5 5 5 0 0 1 9.4 1.2A3 3 0 0 1 14.5 18.5H5a3 3 0 0 1-3-3z" fill="#0364B8" />
    </>
  ),
  sharepoint: (
    <>
      <circle cx="14" cy="7.5" r="5" fill="#036C70" />
      <circle cx="18" cy="13.5" r="4.5" fill="#1A9BA1" />
      <circle cx="13.5" cy="18" r="4" fill="#37C6D0" />
      <rect x="2" y="6.5" width="11" height="11" rx="2" fill="#03787C" />
      <text x="7.5" y="15" textAnchor="middle" fontSize="8" fontWeight="700" fontFamily="Arial, sans-serif" fill="#fff">S</text>
    </>
  ),

  // ── Collaboration ─────────────────────────────────────────────
  slack: (
    <>
      <g fill="#36C5F0">{slackPiece}</g>
      <g fill="#2EB67D" transform="rotate(90 12 12)">{slackPiece}</g>
      <g fill="#ECB22E" transform="rotate(180 12 12)">{slackPiece}</g>
      <g fill="#E01E5A" transform="rotate(270 12 12)">{slackPiece}</g>
    </>
  ),
  notion: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="#fff" stroke="#000" strokeWidth="1.6" />
      <path d="M8.7 16.5v-9l6.6 9v-9" fill="none" stroke="#000" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  jira: (
    <path
      fill="#2684FF"
      d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z"
    />
  ),
  asana: (
    <g fill="#F06A6A">
      <circle cx="12" cy="7" r="4" />
      <circle cx="6.5" cy="16.5" r="4" />
      <circle cx="17.5" cy="16.5" r="4" />
    </g>
  ),
  trello: (
    <>
      <rect x="2.5" y="2.5" width="19" height="19" rx="3.5" fill="#0079BF" />
      <rect x="5.5" y="5.5" width="5.2" height="12" rx="1.2" fill="#fff" />
      <rect x="13.3" y="5.5" width="5.2" height="7.5" rx="1.2" fill="#fff" />
    </>
  ),
  zoom: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill="#0B5CFF" />
      <rect x="5" y="8.5" width="9" height="7" rx="1.8" fill="#fff" />
      <path d="M15 11l4-2.5v7L15 13z" fill="#fff" />
    </>
  ),

  // ── Developer & Data ──────────────────────────────────────────
  github: (
    <path
      fill="currentColor"
      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
    />
  ),
  stripe: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#635BFF" />
      <path
        d="M15.3 9.2c0-1.2-1.4-2-3.3-2s-3.1.8-3.1 2c0 2.9 6.6 1.4 6.6 4.9 0 1.3-1.4 2.2-3.6 2.2-1.9 0-3.5-.7-3.9-2"
        fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"
      />
    </>
  ),
  postgres: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#336791" />
      <ellipse cx="12" cy="7.8" rx="5.5" ry="2.2" fill="none" stroke="#fff" strokeWidth="1.5" />
      <path d="M6.5 7.8v8.4c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V7.8M6.5 12c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2" fill="none" stroke="#fff" strokeWidth="1.5" />
    </>
  ),
  hubspot: (
    <>
      <circle cx="14" cy="13.5" r="4.2" fill="none" stroke="#FF7A59" strokeWidth="2.4" />
      <path d="M14 9.3V5" stroke="#FF7A59" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="14" cy="4" r="1.9" fill="#FF7A59" />
      <path d="M10.6 11 6.8 8.6" stroke="#FF7A59" strokeWidth="2" strokeLinecap="round" />
      <circle cx="5.6" cy="7.8" r="2" fill="#FF7A59" />
      <circle cx="8.2" cy="19" r="1.8" fill="#FF7A59" />
    </>
  ),
};

type IntegrationLogoProps = {
  /** Integration key, e.g. "gmail". */
  id: string;
  /** Used for the accessible label and the initials fallback. */
  name: string;
  className?: string;
};

export function IntegrationLogo({ id, name, className }: IntegrationLogoProps) {
  const glyph = glyphs[id];

  if (!glyph) {
    return <span className={cn("text-[10px] font-semibold", className)}>{initials(name)}</span>;
  }

  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={name}
      className={cn("size-5", className)}
    >
      {glyph}
    </svg>
  );
}