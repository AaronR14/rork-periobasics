/* eslint-disable */
// AUTO-GENERATED — DO NOT EDIT
// Run migrations to regenerate.

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
      ai_chat_events: {
        Row: {
          attempts: number
          created_at: string | null
          delta: number
          event_type: string
          id: string
          is_correct: boolean
          precision_score: number
          session_id: string
          sub_topic_slug: string
          technical_language_score: number
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string | null
          delta: number
          event_type: string
          id?: string
          is_correct?: boolean
          precision_score?: number
          session_id: string
          sub_topic_slug: string
          technical_language_score?: number
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string | null
          delta?: number
          event_type?: string
          id?: string
          is_correct?: boolean
          precision_score?: number
          session_id?: string
          sub_topic_slug?: string
          technical_language_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_sessions: {
        Row: {
          created_at: string | null
          ended_at: string | null
          id: string
          last_message_at: string | null
          message_count: number
          module_name: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          ended_at?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          module_name?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          ended_at?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          module_name?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          role: string
          session_id: string
          text: string
          user_id: string
          video_suggestion: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          session_id: string
          text: string
          user_id: string
          video_suggestion?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          text?: string
          user_id?: string
          video_suggestion?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competency_tags: {
        Row: {
          created_at: string | null
          id: string
          label: string
          macro_competency_label: string
          macro_competency_slug: string
          module_name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          label: string
          macro_competency_label: string
          macro_competency_slug: string
          module_name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          label?: string
          macro_competency_label?: string
          macro_competency_slug?: string
          module_name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      module_meta: {
        Row: {
          module_name: string
          updated_at: string | null
          video_count: number
        }
        Insert: {
          module_name: string
          updated_at?: string | null
          video_count?: number
        }
        Update: {
          module_name?: string
          updated_at?: string | null
          video_count?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          id: string
          name?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      quiz_attempts: {
        Row: {
          correct_answers: number
          created_at: string | null
          duration_seconds: number
          id: string
          module_name: string
          score: number
          sub_topic_slug: string | null
          total_questions: number
          user_id: string
        }
        Insert: {
          correct_answers?: number
          created_at?: string | null
          duration_seconds?: number
          id?: string
          module_name: string
          score?: number
          sub_topic_slug?: string | null
          total_questions?: number
          user_id: string
        }
        Update: {
          correct_answers?: number
          created_at?: string | null
          duration_seconds?: number
          id?: string
          module_name?: string
          score?: number
          sub_topic_slug?: string | null
          total_questions?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reportes_progreso: {
        Row: {
          created_at: string | null
          id: string
          reporte_json: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          reporte_json?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          reporte_json?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reportes_progreso_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_progress: {
        Row: {
          chat_bonus: number
          chat_component: number
          chat_events_count: number
          final_score: number
          id: string
          last_chat_at: string | null
          last_quiz_at: string | null
          macro_competency_label: string
          macro_competency_slug: string
          module_name: string
          quiz_attempts_count: number
          quiz_score: number
          sub_topic_label: string
          sub_topic_slug: string
          updated_at: string | null
          user_id: string
          video_component: number
        }
        Insert: {
          chat_bonus?: number
          chat_component?: number
          chat_events_count?: number
          final_score?: number
          id?: string
          last_chat_at?: string | null
          last_quiz_at?: string | null
          macro_competency_label: string
          macro_competency_slug: string
          module_name: string
          quiz_attempts_count?: number
          quiz_score?: number
          sub_topic_label: string
          sub_topic_slug: string
          updated_at?: string | null
          user_id: string
          video_component?: number
        }
        Update: {
          chat_bonus?: number
          chat_component?: number
          chat_events_count?: number
          final_score?: number
          id?: string
          last_chat_at?: string | null
          last_quiz_at?: string | null
          macro_competency_label?: string
          macro_competency_slug?: string
          module_name?: string
          quiz_attempts_count?: number
          quiz_score?: number
          sub_topic_label?: string
          sub_topic_slug?: string
          updated_at?: string | null
          user_id?: string
          video_component?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_views: {
        Row: {
          id: string
          module_name: string | null
          user_id: string
          video_guid: string
          video_title: string | null
          watched_at: string | null
        }
        Insert: {
          id?: string
          module_name?: string | null
          user_id: string
          video_guid: string
          video_title?: string | null
          watched_at?: string | null
        }
        Update: {
          id?: string
          module_name?: string | null
          user_id?: string
          video_guid?: string
          video_title?: string | null
          watched_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      recalculate_all_progress: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      recalculate_module_progress: {
        Args: { p_module_name: string; p_user_id: string }
        Returns: undefined
      }
      recalculate_progress: {
        Args: { p_sub_topic_slug: string; p_user_id: string }
        Returns: undefined
      }
      seed_progress_for_user: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      user_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
