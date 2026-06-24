import { copy } from '@/lib/copy';

export type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  status: string;
  supervisor_id: string | null;
};

export type DocRow = {
  id: string;
  user_id: string;
  document_type: string;
  certificado_tipo: string | null;
  certificado_otros_texto: string | null;
  fecha_vencimiento: string;
};

export type ProfileWithDocCounts = ProfileRow & {
  doc_vencidos: number;
  doc_por_vencer: number;
  supervisor_name: string | null;
};

export type ExpiredDocRow = {
  doc_id: string;
  user_id: string;
  empleado_name: string;
  tipo_label: string;
  fecha_vencimiento: string;
  dias_restantes: number;
};

export function getDiasRestantes(fechaVenc: string, today: string): number {
  const [vy, vm, vd] = fechaVenc.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const vencMs = Date.UTC(vy, vm - 1, vd);
  const todayMs = Date.UTC(ty, tm - 1, td);
  return Math.round((vencMs - todayMs) / (1000 * 60 * 60 * 24));
}

export function getUrgencyBgClass(dias: number): string {
  if (dias <= 5) return 'bg-error/10 text-error border border-error/30';
  if (dias <= 15) return 'bg-warning/10 text-warning border border-warning/30';
  return 'bg-primary/10 text-primary border border-primary/30';
}

export function formatDocTypeLabel(
  documentType: string,
  certificadoTipo: string | null,
  certificadoOtrosTexto: string | null
): string {
  const tipos = copy.documentos.tipos as Record<string, string>;
  const certTipos = copy.documentos.certificadoTipos as Record<string, string>;

  const tipoBase = tipos[documentType] ?? documentType;

  if (documentType === 'certificado' && certificadoTipo) {
    if (certificadoTipo === 'otros' && certificadoOtrosTexto) {
      return `${tipoBase} — ${certificadoOtrosTexto}`;
    }
    const certLabel = certTipos[certificadoTipo] ?? certificadoTipo;
    return `${tipoBase} — ${certLabel}`;
  }

  return tipoBase;
}

export function buildSupervisorMap(profiles: ProfileRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of profiles) {
    map.set(p.id, p.full_name || p.email);
  }
  return map;
}

export function computeDocCounts(
  docs: DocRow[],
  today: string
): Map<string, { vencidos: number; por_vencer: number }> {
  const map = new Map<string, { vencidos: number; por_vencer: number }>();

  for (const doc of docs) {
    const dias = getDiasRestantes(doc.fecha_vencimiento, today);
    const counts = map.get(doc.user_id) ?? { vencidos: 0, por_vencer: 0 };
    if (dias < 0) {
      counts.vencidos++;
    } else if (dias <= 30) {
      counts.por_vencer++;
    }
    map.set(doc.user_id, counts);
  }

  return map;
}

export function buildProximosAVencer(
  docs: DocRow[],
  profiles: ProfileRow[],
  today: string
): ExpiredDocRow[] {
  const profileMap = new Map<string, ProfileRow>();
  for (const p of profiles) {
    profileMap.set(p.id, p);
  }

  const rows: ExpiredDocRow[] = [];

  for (const doc of docs) {
    const dias = getDiasRestantes(doc.fecha_vencimiento, today);
    if (dias <= 30) {
      const profile = profileMap.get(doc.user_id);
      rows.push({
        doc_id: doc.id,
        user_id: doc.user_id,
        empleado_name: profile?.full_name || profile?.email || doc.user_id,
        tipo_label: formatDocTypeLabel(
          doc.document_type,
          doc.certificado_tipo,
          doc.certificado_otros_texto
        ),
        fecha_vencimiento: doc.fecha_vencimiento,
        dias_restantes: dias,
      });
    }
  }

  rows.sort((a, b) => a.dias_restantes - b.dias_restantes);
  return rows;
}

export function buildProfilesWithCounts(
  profiles: ProfileRow[],
  docCounts: Map<string, { vencidos: number; por_vencer: number }>,
  supervisorMap: Map<string, string>
): ProfileWithDocCounts[] {
  return profiles.map((p) => {
    const counts = docCounts.get(p.id) ?? { vencidos: 0, por_vencer: 0 };
    return {
      ...p,
      doc_vencidos: counts.vencidos,
      doc_por_vencer: counts.por_vencer,
      supervisor_name: p.supervisor_id
        ? (supervisorMap.get(p.supervisor_id) ?? null)
        : null,
    };
  });
}

export type DocRowNullableDate = Omit<DocRow, 'fecha_vencimiento'> & {
  fecha_vencimiento: string | null;
};

export function filterValidDocs(docs: DocRowNullableDate[]): DocRow[] {
  return docs.filter((d): d is DocRowNullableDate & { fecha_vencimiento: string } =>
    d.fecha_vencimiento !== null
  ) as DocRow[];
}

export function filterProfiles(
  profiles: ProfileWithDocCounts[],
  search: string,
  filterStatus: string
): ProfileWithDocCounts[] {
  const q = search.trim().toLowerCase();
  return profiles.filter((p) => {
    const matchesSearch =
      q.length === 0 ||
      (p.full_name ?? '').toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q);
    const matchesStatus = filterStatus === '' || p.status === filterStatus;
    return matchesSearch && matchesStatus;
  });
}

export function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

export function formatDiasRestantes(dias: number): string {
  if (dias === 0) return copy.equipo.diasHoy;
  const abs = Math.abs(dias);
  const unit = abs === 1 ? copy.equipo.diaLabel : copy.equipo.diasLabel;
  if (dias < 0) return `${copy.equipo.diasHace} ${abs} ${unit}`;
  return `${dias} ${unit}`;
}
