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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          buyer_id: string
          created_at: string
          id: string
          listing_id: string
          seller_id: string
          updated_at: string
        }
        Insert: {
          buyer_id: string
          created_at?: string
          id?: string
          listing_id: string
          seller_id: string
          updated_at?: string
        }
        Update: {
          buyer_id?: string
          created_at?: string
          id?: string
          listing_id?: string
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_listing_seller_fkey"
            columns: ["listing_id", "seller_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id", "seller_id"]
          },
          {
            foreignKeyName: "conversations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          listing_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_images: {
        Row: {
          created_at: string
          id: string
          is_cover: boolean
          listing_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_cover?: boolean
          listing_id: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          is_cover?: boolean
          listing_id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_images_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_reports: {
        Row: {
          admin_note: string | null
          created_at: string
          details: string | null
          id: string
          listing_id: string
          reason: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          seller_id: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          details?: string | null
          id?: string
          listing_id: string
          reason: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          seller_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          details?: string | null
          id?: string
          listing_id?: string
          reason?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          seller_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_reports_listing_seller_fkey"
            columns: ["listing_id", "seller_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id", "seller_id"]
          },
          {
            foreignKeyName: "listing_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_reports_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_reports_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          category_id: string
          condition: string
          created_at: string
          description: string
          id: string
          price: number
          search_text: string | null
          seller_id: string
          status: string
          submission_token: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category_id: string
          condition: string
          created_at?: string
          description: string
          id?: string
          price: number
          search_text?: string | null
          seller_id: string
          status?: string
          submission_token?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          condition?: string
          created_at?: string
          description?: string
          id?: string
          price?: number
          search_text?: string | null
          seller_id?: string
          status?: string
          submission_token?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      meetups: {
        Row: {
          buyer_id: string
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          id: string
          listing_id: string
          location_details: string | null
          location_name: string
          notes: string | null
          reservation_id: string
          scheduled_at: string
          seller_id: string
          status: string
          updated_at: string
        }
        Insert: {
          buyer_id: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          listing_id: string
          location_details?: string | null
          location_name: string
          notes?: string | null
          reservation_id: string
          scheduled_at: string
          seller_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          buyer_id?: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          listing_id?: string
          location_details?: string | null
          location_name?: string
          notes?: string | null
          reservation_id?: string
          scheduled_at?: string
          seller_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetups_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetups_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetups_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetups_reservation_context_fkey"
            columns: ["reservation_id", "listing_id", "buyer_id", "seller_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id", "listing_id", "buyer_id", "seller_id"]
          },
          {
            foreignKeyName: "meetups_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetups_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          conversation_id: string | null
          created_at: string
          event_key: string
          id: string
          is_read: boolean
          listing_id: string | null
          meetup_id: string | null
          message: string
          read_at: string | null
          reservation_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          event_key: string
          id?: string
          is_read?: boolean
          listing_id?: string | null
          meetup_id?: string | null
          message: string
          read_at?: string | null
          reservation_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          event_key?: string
          id?: string
          is_read?: boolean
          listing_id?: string | null
          meetup_id?: string | null
          message?: string
          read_at?: string | null
          reservation_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_status: string
          avatar_path: string | null
          course: string | null
          created_at: string
          full_name: string | null
          id: string
          role: string
          student_id_number: string | null
          updated_at: string
          verification_status: string
          year_level: number | null
        }
        Insert: {
          account_status?: string
          avatar_path?: string | null
          course?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          role?: string
          student_id_number?: string | null
          updated_at?: string
          verification_status?: string
          year_level?: number | null
        }
        Update: {
          account_status?: string
          avatar_path?: string | null
          course?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          role?: string
          student_id_number?: string | null
          updated_at?: string
          verification_status?: string
          year_level?: number | null
        }
        Relationships: []
      }
      reservations: {
        Row: {
          buyer_id: string
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          id: string
          listing_id: string
          message: string | null
          responded_at: string | null
          seller_id: string
          status: string
          updated_at: string
        }
        Insert: {
          buyer_id: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          listing_id: string
          message?: string | null
          responded_at?: string | null
          seller_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          buyer_id?: string
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          listing_id?: string
          message?: string | null
          responded_at?: string | null
          seller_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_listing_seller_fkey"
            columns: ["listing_id", "seller_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id", "seller_id"]
          },
          {
            foreignKeyName: "reservations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_reports: {
        Row: {
          admin_note: string | null
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          subject_id: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          subject_id: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          subject_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_reports_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_reports_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verifications: {
        Row: {
          course_snapshot: string
          created_at: string
          document_path: string
          full_name_snapshot: string
          id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          student_id_number_snapshot: string
          submitted_at: string
          updated_at: string
          user_id: string
          year_level_snapshot: number
        }
        Insert: {
          course_snapshot: string
          created_at?: string
          document_path: string
          full_name_snapshot: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id_number_snapshot: string
          submitted_at?: string
          updated_at?: string
          user_id: string
          year_level_snapshot: number
        }
        Update: {
          course_snapshot?: string
          created_at?: string
          document_path?: string
          full_name_snapshot?: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          student_id_number_snapshot?: string
          submitted_at?: string
          updated_at?: string
          user_id?: string
          year_level_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "verifications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "marketplace_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verifications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      marketplace_profiles: {
        Row: {
          avatar_path: string | null
          course: string | null
          created_at: string | null
          full_name: string | null
          id: string | null
          verification_status: string | null
          year_level: number | null
        }
        Insert: {
          avatar_path?: string | null
          course?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          verification_status?: string | null
          year_level?: number | null
        }
        Update: {
          avatar_path?: string | null
          course?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string | null
          verification_status?: string | null
          year_level?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_reservation: {
        Args: { p_reservation_id: string }
        Returns: string
      }
      admin_moderate_listing: {
        Args: { p_listing_id: string; p_reason?: string }
        Returns: undefined
      }
      admin_moderate_user: {
        Args: { p_account_status: string; p_reason?: string; p_user_id: string }
        Returns: undefined
      }
      admin_remove_listing: {
        Args: { p_listing_id: string }
        Returns: undefined
      }
      admin_review_report: {
        Args: {
          p_admin_note?: string
          p_decision: string
          p_kind: string
          p_report_id: string
        }
        Returns: undefined
      }
      admin_set_account_status: {
        Args: { p_account_status: string; p_user_id: string }
        Returns: undefined
      }
      cancel_listing_reservation: {
        Args: { p_reservation_id: string }
        Returns: string
      }
      cancel_reservation: {
        Args: { p_reservation_id: string }
        Returns: string
      }
      complete_sale: { Args: { p_reservation_id: string }; Returns: string }
      discard_listing_draft: { Args: { p_listing_id: string }; Returns: string }
      get_admin_report_note: {
        Args: { p_kind: string; p_report_id: string }
        Returns: string
      }
      get_my_conversation_summaries: {
        Args: { p_conversation_id?: string }
        Returns: {
          can_send: boolean
          conversation_id: string
          created_at: string
          last_message_at: string
          last_message_body: string
          listing_id: string
          listing_image_path: string
          listing_price: number
          listing_status: string
          listing_title: string
          other_user_avatar_path: string
          other_user_id: string
          other_user_is_verified: boolean
          other_user_name: string
          unread_count: number
          updated_at: string
        }[]
      }
      get_my_listing_interaction_contexts: {
        Args: never
        Returns: {
          listing_id: string
          status: string
          title: string
        }[]
      }
      get_my_notification_state: {
        Args: never
        Returns: {
          snapshot_at: string
          unread_count: number
        }[]
      }
      get_my_reservation_summaries: {
        Args: { p_reservation_id?: string }
        Returns: {
          buyer_id: string
          can_view_listing: boolean
          cancelled_at: string
          completed_at: string
          conversation_id: string
          listing_id: string
          listing_image_path: string
          listing_price: number
          listing_status: string
          listing_title: string
          meetup_cancelled_at: string
          meetup_completed_at: string
          meetup_created_at: string
          meetup_id: string
          meetup_location_details: string
          meetup_location_name: string
          meetup_notes: string
          meetup_scheduled_at: string
          meetup_status: string
          meetup_updated_at: string
          other_user_avatar_path: string
          other_user_id: string
          other_user_is_verified: boolean
          other_user_name: string
          pending_request_count: number
          reservation_created_at: string
          reservation_id: string
          reservation_message: string
          reservation_status: string
          reservation_updated_at: string
          responded_at: string
          seller_id: string
          viewer_role: string
        }[]
      }
      mark_all_notifications_read: {
        Args: { p_before?: string }
        Returns: number
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: number
      }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      publish_listing: { Args: { p_listing_id: string }; Returns: string }
      reject_reservation: {
        Args: { p_reservation_id: string }
        Returns: string
      }
      report_listing: {
        Args: { p_details?: string; p_listing_id: string; p_reason: string }
        Returns: string
      }
      report_student: {
        Args: { p_details?: string; p_reason: string; p_subject_id: string }
        Returns: string
      }
      request_listing_reservation: {
        Args: { p_listing_id: string }
        Returns: string
      }
      request_reservation: {
        Args: { p_listing_id: string; p_message?: string }
        Returns: string
      }
      respond_to_listing_reservation: {
        Args: { p_decision: string; p_reservation_id: string }
        Returns: string
      }
      review_verification: {
        Args: {
          p_decision: string
          p_rejection_reason?: string
          p_verification_id: string
        }
        Returns: undefined
      }
      send_conversation_message: {
        Args: { p_body: string; p_conversation_id: string }
        Returns: string
      }
      set_listing_favorite: {
        Args: { p_listing_id: string; p_should_favorite: boolean }
        Returns: boolean
      }
      set_owned_listing_status: {
        Args: { p_listing_id: string; p_status: string }
        Returns: string
      }
      start_listing_conversation: {
        Args: { p_listing_id: string }
        Returns: string
      }
      start_reservation_conversation: {
        Args: { p_reservation_id: string }
        Returns: string
      }
      submit_verification: {
        Args: { p_document_path: string; p_verification_id: string }
        Returns: string
      }
      toggle_listing_favorite: {
        Args: { p_listing_id: string }
        Returns: boolean
      }
      update_owned_listing: {
        Args: {
          p_category_id: string
          p_condition: string
          p_description: string
          p_expected_updated_at: string
          p_image_paths: string[]
          p_listing_id: string
          p_price: number
          p_title: string
        }
        Returns: Json
      }
      upsert_meetup: {
        Args: {
          p_expected_updated_at?: string
          p_location_details: string
          p_location_name: string
          p_notes: string
          p_reservation_id: string
          p_scheduled_at: string
        }
        Returns: string
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
