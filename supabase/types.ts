export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ausencia_requests: {
        Row: {
          created_at: string
          estado: Database["public"]["Enums"]["approval_status"]
          fecha_fin: string
          fecha_inicio: string
          id: string
          motivo_ausencia: Database["public"]["Enums"]["motivo_ausencia"]
          motivo_rechazo: string | null
          notas: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          estado?: Database["public"]["Enums"]["approval_status"]
          fecha_fin: string
          fecha_inicio: string
          id?: string
          motivo_ausencia: Database["public"]["Enums"]["motivo_ausencia"]
          motivo_rechazo?: string | null
          notas?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          estado?: Database["public"]["Enums"]["approval_status"]
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          motivo_ausencia?: Database["public"]["Enums"]["motivo_ausencia"]
          motivo_rechazo?: string | null
          notas?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ausencia_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ausencia_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          certificado_otros_texto: string | null
          certificado_tipo: Database["public"]["Enums"]["certificado_tipo"] | null
          created_at: string
          document_type: string
          estado: Database["public"]["Enums"]["approval_status"]
          fecha_vencimiento: string | null
          file_purged_at: string | null
          file_size: number | null
          filename: string
          id: string
          mime_type: string | null
          motivo_rechazo: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          storage_path: string
          updated_at: string
          uploaded_by: string
          user_id: string
        }
        Insert: {
          certificado_otros_texto?: string | null
          certificado_tipo?: Database["public"]["Enums"]["certificado_tipo"] | null
          created_at?: string
          document_type: string
          estado?: Database["public"]["Enums"]["approval_status"]
          fecha_vencimiento?: string | null
          file_purged_at?: string | null
          file_size?: number | null
          filename: string
          id?: string
          mime_type?: string | null
          motivo_rechazo?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          storage_path: string
          updated_at?: string
          uploaded_by: string
          user_id: string
        }
        Update: {
          certificado_otros_texto?: string | null
          certificado_tipo?: Database["public"]["Enums"]["certificado_tipo"] | null
          created_at?: string
          document_type?: string
          estado?: Database["public"]["Enums"]["approval_status"]
          fecha_vencimiento?: string | null
          file_purged_at?: string | null
          file_size?: number | null
          filename?: string
          id?: string
          mime_type?: string | null
          motivo_rechazo?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pasaje_requests: {
        Row: {
          created_at: string
          destino: string
          empleado_id: string
          estado: Database["public"]["Enums"]["approval_status"]
          fecha_viaje: string
          id: string
          motivo_rechazo: string | null
          motivo_viaje: Database["public"]["Enums"]["motivo_viaje"]
          notas: string | null
          origen: string
          reviewed_at: string | null
          reviewed_by: string | null
          solicitante_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          destino: string
          empleado_id: string
          estado?: Database["public"]["Enums"]["approval_status"]
          fecha_viaje: string
          id?: string
          motivo_rechazo?: string | null
          motivo_viaje: Database["public"]["Enums"]["motivo_viaje"]
          notas?: string | null
          origen: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          solicitante_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          destino?: string
          empleado_id?: string
          estado?: Database["public"]["Enums"]["approval_status"]
          fecha_viaje?: string
          id?: string
          motivo_rechazo?: string | null
          motivo_viaje?: Database["public"]["Enums"]["motivo_viaje"]
          notas?: string | null
          origen?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          solicitante_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pasaje_requests_empleado_id_fkey"
            columns: ["empleado_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pasaje_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pasaje_requests_solicitante_id_fkey"
            columns: ["solicitante_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      procedures: {
        Row: {
          category: string | null
          content: string | null
          created_at: string
          created_by: string
          id: string
          storage_path: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          content?: string | null
          created_at?: string
          created_by: string
          id?: string
          storage_path?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          content?: string | null
          created_at?: string
          created_by?: string
          id?: string
          storage_path?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procedures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procedures_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          apellido: string | null
          created_at: string
          cuit: string | null
          dni: string | null
          email: string
          entrevista_tecnica: Json | null
          fecha_ingreso: string | null
          full_name: string | null
          id: string
          nombre: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["employee_status"]
          supervisor_id: string | null
          updated_at: string
          winda_id: string | null
        }
        Insert: {
          apellido?: string | null
          created_at?: string
          cuit?: string | null
          dni?: string | null
          email: string
          entrevista_tecnica?: Json | null
          fecha_ingreso?: string | null
          full_name?: string | null
          id: string
          nombre?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["employee_status"]
          supervisor_id?: string | null
          updated_at?: string
          winda_id?: string | null
        }
        Update: {
          apellido?: string | null
          created_at?: string
          cuit?: string | null
          dni?: string | null
          email?: string
          entrevista_tecnica?: Json | null
          fecha_ingreso?: string | null
          full_name?: string | null
          id?: string
          nombre?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["employee_status"]
          supervisor_id?: string | null
          updated_at?: string
          winda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rotation_assignments: {
        Row: {
          created_at: string
          estado_dia: Database["public"]["Enums"]["estado_dia"]
          fecha: string
          id: string
          motivo_ausencia: Database["public"]["Enums"]["motivo_ausencia"] | null
          notas: string | null
          rotation_group_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          estado_dia?: Database["public"]["Enums"]["estado_dia"]
          fecha: string
          id?: string
          motivo_ausencia?:
            | Database["public"]["Enums"]["motivo_ausencia"]
            | null
          notas?: string | null
          rotation_group_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          estado_dia?: Database["public"]["Enums"]["estado_dia"]
          fecha?: string
          id?: string
          motivo_ausencia?:
            | Database["public"]["Enums"]["motivo_ausencia"]
            | null
          notas?: string | null
          rotation_group_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rotation_assignments_rotation_group_id_fkey"
            columns: ["rotation_group_id"]
            isOneToOne: false
            referencedRelation: "rotation_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rotation_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rotation_groups: {
        Row: {
          created_at: string
          descripcion: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          descripcion?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          descripcion?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_admin: { Args: never; Returns: boolean }
      log_audit: {
        Args: {
          p_action: string
          p_new_data?: Json
          p_old_data?: Json
          p_record_id: string
          p_table_name: string
        }
        Returns: undefined
      }
    }
    Enums: {
      approval_status: "pendiente" | "aprobado" | "rechazado"
      certificado_tipo:
        | "gwo"
        | "cursos_elevadores"
        | "espacio_confinado"
        | "manejo_defensivo"
        | "cursos_vestas"
        | "otros"
      employee_status: "activo" | "inactivo" | "pendiente"
      estado_dia:
        | "trabajando"
        | "en_viaje"
        | "en_franco"
        | "periodo_fuera_trabajo"
      motivo_ausencia:
        | "vacaciones"
        | "licencia_medica"
        | "dia_tramite"
        | "matrimonio"
        | "fallecimiento"
        | "otros"
      motivo_viaje: "inicio_franco" | "fin_franco" | "traslado_proyectos"
      user_role: "admin" | "supervisor" | "empleado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      approval_status: ["pendiente", "aprobado", "rechazado"],
      employee_status: ["activo", "inactivo", "pendiente"],
      estado_dia: [
        "trabajando",
        "en_viaje",
        "en_franco",
        "periodo_fuera_trabajo",
      ],
      motivo_ausencia: [
        "vacaciones",
        "licencia_medica",
        "dia_tramite",
        "matrimonio",
        "fallecimiento",
        "otros",
      ],
      motivo_viaje: ["inicio_franco", "fin_franco", "traslado_proyectos"],
      user_role: ["admin", "supervisor", "empleado"],
    },
  },
} as const
