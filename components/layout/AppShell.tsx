'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import type { UserRole } from '@/lib/roles';

type AppShellProps = {
  role: UserRole;
  userName: string;
  // FB-PI-01: solo llega para admin (ver app/(app)/layout.tsx).
  aprobacionesPendientes?: number;
  children: React.ReactNode;
};

export function AppShell({ role, userName, aprobacionesPendientes, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar
        role={role}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar
          onMenuToggle={() => setSidebarOpen((prev) => !prev)}
          userName={userName}
          aprobacionesPendientes={aprobacionesPendientes}
        />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
