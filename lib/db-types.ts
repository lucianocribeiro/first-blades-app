// Aliases de conveniencia derivados del archivo generado supabase/types.ts.
// NO editar supabase/types.ts a mano — se regenera con `supabase gen types typescript --linked`.
// Agregar aquí cualquier alias nuevo que la app necesite importar por nombre.
import type { Database, Tables, TablesInsert, TablesUpdate, Enums } from '@/supabase/types';

// Enums
export type UserRole       = Enums<'user_role'>;
export type EmployeeStatus = Enums<'employee_status'>;
export type ApprovalStatus = Enums<'approval_status'>;
export type EstadoDia      = Enums<'estado_dia'>;
export type MotivoAusencia = Enums<'motivo_ausencia'>;
export type MotivoViaje    = Enums<'motivo_viaje'>;
export type CertificadoTipo = Enums<'certificado_tipo'>;
export type NotificationType = Enums<'notification_type'>;

// Row aliases para las tablas principales
export type Profile              = Tables<'profiles'>;
export type Document             = Tables<'documents'>;
export type AusenciaRequest      = Tables<'ausencia_requests'>;
export type PasajeRequest        = Tables<'pasaje_requests'>;
export type Procedure            = Tables<'procedures'>;
export type RotationAssignment   = Tables<'rotation_assignments'>;
export type RotationGroup        = Tables<'rotation_groups'>;
export type AuditLog             = Tables<'audit_log'>;
export type NotificationLog      = Tables<'notification_log'>;

// Insert / Update aliases para las tablas con escritura frecuente
export type ProfileInsert          = TablesInsert<'profiles'>;
export type ProfileUpdate          = TablesUpdate<'profiles'>;
export type DocumentInsert         = TablesInsert<'documents'>;
export type DocumentUpdate         = TablesUpdate<'documents'>;
export type NotificationLogInsert  = TablesInsert<'notification_log'>;
export type AusenciaRequestInsert  = TablesInsert<'ausencia_requests'>;
export type PasajeRequestInsert    = TablesInsert<'pasaje_requests'>;
export type RotationAssignmentInsert = TablesInsert<'rotation_assignments'>;
export type RotationAssignmentUpdate = TablesUpdate<'rotation_assignments'>;

// Tipos de documento (enforced en app layer; document_type es TEXT en la BD)
export const DOCUMENT_TYPES = ['dni', 'licencia', 'foto_carnet', 'certificado', 'estudio_medico'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// Tipo JSONB de entrevista_tecnica (checkboxes por tipo de trabajo)
export type EntrevistaTecnica = {
  aerogeneradores?:   boolean;
  palas_eolicas?:     boolean;
  trabajo_en_altura?: boolean;
  escalada_industrial?: boolean;
  inspeccion_visual?: boolean;
};

// Re-export Database para quienes necesiten el tipo raíz
export type { Database };
