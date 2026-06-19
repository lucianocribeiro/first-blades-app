'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  User, Users, Calendar, Plane, Clock, CheckCircle,
  FileText, Receipt, ClipboardList, Settings, LogOut,
  ExternalLink,
} from 'lucide-react';
import { copy } from '@/lib/copy';
import { canAccess } from '@/lib/roles';
import type { UserRole } from '@/lib/roles';
import { createClientComponent } from '@/lib/supabase/client';

type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  roles: UserRole[];
  external?: boolean;
};

const navItems: NavItem[] = [
  { key: 'miPerfil',          label: copy.nav.miPerfil,          href: '/mi-perfil',          icon: User,          roles: ['admin', 'supervisor', 'empleado'] },
  { key: 'equipo',            label: copy.nav.equipo,            href: '/equipo',              icon: Users,         roles: ['admin'] },
  { key: 'calendario',        label: copy.nav.calendario,        href: '/calendario',          icon: Calendar,      roles: ['admin', 'supervisor', 'empleado'] },
  { key: 'solicitudPasaje',   label: copy.nav.solicitudPasaje,   href: '/solicitud-pasaje',   icon: Plane,         roles: ['admin', 'supervisor', 'empleado'] },
  { key: 'solicitudAusencia', label: copy.nav.solicitudAusencia, href: '/solicitud-ausencia', icon: Clock,         roles: ['admin', 'supervisor', 'empleado'] },
  { key: 'aprobaciones',      label: copy.nav.aprobaciones,      href: '/aprobaciones',        icon: CheckCircle,   roles: ['admin'] },
  { key: 'procedimientos',    label: copy.nav.procedimientos,    href: '/procedimientos',      icon: FileText,      roles: ['admin', 'supervisor', 'empleado'] },
  { key: 'rendicionGastos',   label: copy.nav.rendicionGastos,   href: '#',                   icon: Receipt,       roles: ['admin', 'supervisor', 'empleado'], external: true },
  { key: 'formularios',       label: copy.nav.formularios,       href: '/formularios',         icon: ClipboardList, roles: ['admin', 'supervisor', 'empleado'] },
  { key: 'gestionUsuarios',   label: copy.nav.gestionUsuarios,   href: '/gestion-usuarios',   icon: Settings,      roles: ['admin'] },
];

type SidebarProps = {
  role: UserRole;
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ role, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClientComponent();

  const visibleItems = navItems.filter((item) =>
    canAccess(role, item.key as Parameters<typeof canAccess>[1])
  );

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function isActive(href: string) {
    if (href === '#') return false;
    return pathname === href || pathname.startsWith(href + '/');
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center justify-center h-16 bg-white shrink-0 px-4">
        <Image
          src="/logo.fb.png"
          alt={copy.general.logoAlt}
          width={140}
          height={40}
          className="object-contain max-h-10"
          priority
        />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          if (item.external) {
            return (
              <a
                key={item.key}
                href="#"
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/80 hover:bg-white/10 transition-colors"
                onClick={(e) => e.preventDefault()}
              >
                <Icon size={18} className="shrink-0" />
                <span className="truncate">{item.label}</span>
                <ExternalLink size={12} className="ml-auto shrink-0 opacity-60" />
              </a>
            );
          }

          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onClose}
              className={[
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-primary text-white font-medium'
                  : 'text-white/80 hover:bg-white/10',
              ].join(' ')}
            >
              <Icon size={18} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-white/10 shrink-0">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-white/80 hover:bg-white/10 transition-colors"
        >
          <LogOut size={18} className="shrink-0" />
          <span>{copy.auth.logout}</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={[
          'hidden lg:flex flex-col bg-secondary transition-all duration-200 shrink-0 h-screen sticky top-0',
          open ? 'w-60' : 'w-0 overflow-hidden',
        ].join(' ')}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-60 bg-secondary h-full flex flex-col">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
