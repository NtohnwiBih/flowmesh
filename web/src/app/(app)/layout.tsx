import type { ReactNode } from "react";

import { AppProvider } from "@/components/app-provider";
import { AuthGate } from "@/lib/auth";
import { AppLayout } from "@/layouts/app-layout";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppProvider>
        <AppLayout>{children}</AppLayout>
      </AppProvider>
    </AuthGate>
  );
}