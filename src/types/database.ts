import type {
  Database as GeneratedDatabase,
  Json,
} from "@/types/database.generated";

/**
 * Schema additions introduced by migrations committed locally but not yet
 * applied to the linked database. Keeping this overlay separate leaves the
 * generated file reproducible and makes schema drift explicit until the
 * migrations are pushed.
 */
type PendingMessagingFunctions = {
  mark_conversation_read: {
    Args: { p_conversation_id: string };
    Returns: number;
  };
  get_my_conversation_summaries: {
    Args: { p_conversation_id?: string };
    Returns: Array<{
      conversation_id: string;
      listing_id: string;
      other_user_id: string;
      other_user_name: string | null;
      other_user_avatar_path: string | null;
      other_user_is_verified: boolean;
      listing_title: string | null;
      listing_status: string;
      listing_price: number | null;
      listing_image_path: string | null;
      last_message_body: string | null;
      last_message_at: string | null;
      unread_count: number;
      created_at: string;
      updated_at: string;
      can_send: boolean;
    }>;
  };
};

type ReservationRow = GeneratedDatabase["public"]["Tables"]["reservations"]["Row"] & {
  message: string | null;
  responded_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
};

type PendingReservationTables = {
  reservations: Omit<
    GeneratedDatabase["public"]["Tables"]["reservations"],
    "Row" | "Insert" | "Update"
  > & {
    Row: ReservationRow;
    Insert: GeneratedDatabase["public"]["Tables"]["reservations"]["Insert"] & {
      message?: string | null;
      responded_at?: string | null;
      cancelled_at?: string | null;
      completed_at?: string | null;
    };
    Update: GeneratedDatabase["public"]["Tables"]["reservations"]["Update"] & {
      message?: string | null;
      responded_at?: string | null;
      cancelled_at?: string | null;
      completed_at?: string | null;
    };
  };
  meetups: {
    Row: {
      id: string;
      reservation_id: string;
      listing_id: string;
      buyer_id: string;
      seller_id: string;
      status: string;
      location_name: string;
      location_details: string | null;
      scheduled_at: string;
      notes: string | null;
      created_at: string;
      updated_at: string;
      cancelled_at: string | null;
      completed_at: string | null;
    };
    Insert: {
      id?: string;
      reservation_id: string;
      listing_id: string;
      buyer_id: string;
      seller_id: string;
      status?: string;
      location_name: string;
      location_details?: string | null;
      scheduled_at: string;
      notes?: string | null;
      created_at?: string;
      updated_at?: string;
      cancelled_at?: string | null;
      completed_at?: string | null;
    };
    Update: {
      id?: string;
      reservation_id?: string;
      listing_id?: string;
      buyer_id?: string;
      seller_id?: string;
      status?: string;
      location_name?: string;
      location_details?: string | null;
      scheduled_at?: string;
      notes?: string | null;
      created_at?: string;
      updated_at?: string;
      cancelled_at?: string | null;
      completed_at?: string | null;
    };
    Relationships: [];
  };
};

type PendingReservationFunctions = {
  request_reservation: {
    Args: { p_listing_id: string; p_message?: string | null };
    Returns: string;
  };
  accept_reservation: {
    Args: { p_reservation_id: string };
    Returns: string;
  };
  reject_reservation: {
    Args: { p_reservation_id: string };
    Returns: string;
  };
  cancel_reservation: {
    Args: { p_reservation_id: string };
    Returns: string;
  };
  upsert_meetup: {
    Args: {
      p_reservation_id: string;
      p_location_name: string;
      p_location_details: string | null;
      p_scheduled_at: string;
      p_notes: string | null;
      p_expected_updated_at?: string | null;
    };
    Returns: string;
  };
  complete_sale: {
    Args: { p_reservation_id: string };
    Returns: string;
  };
  start_reservation_conversation: {
    Args: { p_reservation_id: string };
    Returns: string;
  };
  get_my_reservation_summaries: {
    Args: { p_reservation_id?: string };
    Returns: Array<{
      reservation_id: string;
      listing_id: string;
      listing_title: string;
      listing_status: string;
      listing_price: number;
      listing_image_path: string | null;
      buyer_id: string;
      seller_id: string;
      viewer_role: string;
      other_user_id: string;
      other_user_name: string | null;
      other_user_avatar_path: string | null;
      other_user_is_verified: boolean;
      reservation_status: string;
      reservation_message: string | null;
      reservation_created_at: string;
      reservation_updated_at: string;
      responded_at: string | null;
      cancelled_at: string | null;
      completed_at: string | null;
      conversation_id: string | null;
      pending_request_count: number;
      can_view_listing: boolean;
      meetup_id: string | null;
      meetup_status: string | null;
      meetup_location_name: string | null;
      meetup_location_details: string | null;
      meetup_scheduled_at: string | null;
      meetup_notes: string | null;
      meetup_created_at: string | null;
      meetup_updated_at: string | null;
      meetup_cancelled_at: string | null;
      meetup_completed_at: string | null;
    }>;
  };
};

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  listing_id: string | null;
  conversation_id: string | null;
  reservation_id: string | null;
  meetup_id: string | null;
  event_key: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

type PendingNotificationTables = {
  notifications: {
    Row: NotificationRow;
    Insert: Pick<NotificationRow, "user_id" | "type" | "title" | "message" | "event_key"> &
      Partial<Omit<NotificationRow, "user_id" | "type" | "title" | "message" | "event_key">>;
    Update: Partial<NotificationRow>;
    Relationships: [];
  };
};

type PendingNotificationFunctions = {
  get_my_notification_state: {
    Args: Record<PropertyKey, never>;
    Returns: Array<{ unread_count: number; snapshot_at: string }>;
  };
  mark_notification_read: {
    Args: { p_notification_id: string };
    Returns: boolean;
  };
  mark_all_notifications_read: {
    Args: { p_before?: string | null };
    Returns: number;
  };
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Functions" | "Tables"> & {
    Tables: Omit<
      GeneratedDatabase["public"]["Tables"],
      keyof PendingReservationTables | keyof PendingNotificationTables
    > &
      PendingReservationTables & PendingNotificationTables;
    Functions: GeneratedDatabase["public"]["Functions"] &
      PendingMessagingFunctions &
      PendingReservationFunctions & PendingNotificationFunctions;
  };
};

export type { Json };
