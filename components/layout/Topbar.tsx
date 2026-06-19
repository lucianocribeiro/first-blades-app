'use client';

import { useSelectedLayoutSegment } from 'next/navigation';
import { Menu, Bell, ChevronDown, Calendar } from 'lucide-react';
import {
  User, Users, CalendarDays, Plane, Clock, CheckCircle,
  FileText, Receipt, ClipboardList, Settings, Home,
} from 'lucide-react';
import { copy } from '@/lib/copy';

type TopbarProps = {
  onMenuToggle: () => void;
  userName: string;
};

type PageMeta = {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const pageMeta: Record<string, PageMeta> = {
  dashboard:          { title: copy.pages.dashboard.title,          subtitle: copy.pages.dashboard.subtitle,          icon: Home },
  'mi-perfil':        { title: copy.pages.miPerfil.title,           subtitle: copy.pages.miPerfil.subtitle,           icon: User },
  equipo:             { title: copy.pages.equipo.title,             subtitle: copy.pages.equipo.subtitle,             icon: Users },
  calendario:         { title: copy.pages.calendario.title,         subtitle: copy.pages.calendario.subtitle,         icon: CalendarDays },
  'solicitud-pasaje': { title: copy.pages.solicitudPasaje.title,    subtitle: copy.pages.solicitudPasaje.subtitle,    icon: Plane },
  'solicitud-ausencia':{ title: copy.pages.solicitudAusencia.title, subtitle: copy.pages.solicitudAusencia.subtitle,  icon: Clock },
  aprobaciones:       { title: copy.pages.aprobaciones.title,       subtitle: copy.pages.aprobaciones.subtitle,       icon: CheckCircle },
  procedimientos:     { title: copy.pages.procedimientos.title,     subtitle: copy.pages.procedimientos.subtitle,     icon: FileText },
  'rendicion-gastos': { title: copy.pages.rendicionGastos.title,    subtitle: copy.pages.rendicionGastos.subtitle,    icon: Receipt },
  formularios:        { title: copy.pages.formularios.title,        subtitle: copy.pages.formularios.subtitle,        icon: ClipboardList },
  'gestion-usuarios': { title: copy.pages.gestionUsuarios.title,    subtitle: copy.pages.gestionUsuarios.subtitle,    icon: Settings },
};

function currentDate(): string {
  return new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function Topbar({ onMenuToggle, userName }: TopbarProps) {
  const segment = useSelectedLayoutSegment() ?? 'dashboard';
  const meta = pageMeta[segment] ?? pageMeta['dashboard'];
  const Icon = meta.icon;

  return (
    <header className="h-16 bg-white border-b border-color-border flex items-center px-4 gap-4 sticky top-0 z-20 shrink-0">
      {/* Left */}
      <button
        onClick={onMenuToggle}
        className="p-2 rounded-lg text-secondary hover:bg-surface transition-colors"
        aria-label={copy.topbar.menuButton}
      >
        <Menu size={20} />
      </button>

      <div className="flex items-center gap-2 min-w-0">
        <Icon size={20} className="text-primary shrink-0" />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-secondary leading-tight truncate">
            {meta.title}
          </h1>
          <p className="text-xs text-neutral leading-tight truncate hidden sm:block">
            {meta.subtitle}
          </p>
        </div>
      </div>

      {/* Right */}
      <div className="ml-auto flex items-center gap-3">
        {/* Fecha */}
        <div className="hidden md:flex items-center gap-1.5 text-xs text-neutral">
          <Calendar size={14} className="text-primary" />
          <span className="capitalize">{currentDate()}</span>
        </div>

        {/* Notificaciones */}
        <button
          className="relative p-2 rounded-lg text-neutral hover:bg-surface transition-colors"
          aria-label={copy.topbar.notifications}
        >
          <Bell size={18} />
          {/* Badge — futuro: conectar a conteo real */}
        </button>

        {/* Avatar */}
        <button
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-surface transition-colors"
          aria-label={copy.topbar.userMenu}
        >
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-xs font-semibold shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm text-secondary font-medium hidden sm:block max-w-[120px] truncate">
            {userName}
          </span>
          <ChevronDown size={14} className="text-neutral hidden sm:block" />
        </button>
      </div>
    </header>
  );
}
