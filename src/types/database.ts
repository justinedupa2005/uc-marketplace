import type {
  Database as GeneratedDatabase,
  Json,
} from "@/types/database.generated";

/**
 * RPCs introduced by migrations committed locally but not yet applied to the
 * linked database. Keeping this overlay separate leaves the generated file
 * reproducible and makes schema drift explicit until the migration is pushed.
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

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Functions"> & {
    Functions: GeneratedDatabase["public"]["Functions"] &
      PendingMessagingFunctions;
  };
};

export type { Json };
