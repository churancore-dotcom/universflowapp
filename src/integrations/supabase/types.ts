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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      albums: {
        Row: {
          artist: string
          cover_url: string | null
          created_at: string
          id: string
          release_year: number | null
          title: string
        }
        Insert: {
          artist: string
          cover_url?: string | null
          created_at?: string
          id?: string
          release_year?: number | null
          title: string
        }
        Update: {
          artist?: string
          cover_url?: string | null
          created_at?: string
          id?: string
          release_year?: number | null
          title?: string
        }
        Relationships: []
      }
      announcement_events: {
        Row: {
          announcement_id: string
          created_at: string
          event_type: string
          id: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          created_at?: string
          event_type: string
          id?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          created_at?: string
          event_type?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_events_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          created_at: string
          created_by: string | null
          deep_link: string | null
          ends_at: string | null
          id: string
          is_active: boolean
          message: string
          starts_at: string
          target_audience: string
          title: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deep_link?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          message: string
          starts_at?: string
          target_audience?: string
          title: string
          type?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deep_link?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          message?: string
          starts_at?: string
          target_audience?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          permissions: string[]
          usage_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          permissions?: string[]
          usage_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          permissions?: string[]
          usage_count?: number
        }
        Relationships: []
      }
      api_rate_limits: {
        Row: {
          endpoint: string
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          endpoint: string
          request_count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          endpoint?: string
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      app_reviews: {
        Row: {
          comment: string | null
          created_at: string
          display_name: string
          id: string
          rating: number
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          display_name: string
          id?: string
          rating: number
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          display_name?: string
          id?: string
          rating?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      app_versions: {
        Row: {
          apk_url: string
          created_at: string
          id: string
          is_active: boolean
          is_mandatory: boolean
          min_supported_version_code: number
          release_notes: string | null
          updated_at: string
          version_code: number
          version_name: string
        }
        Insert: {
          apk_url: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_mandatory?: boolean
          min_supported_version_code?: number
          release_notes?: string | null
          updated_at?: string
          version_code: number
          version_name: string
        }
        Update: {
          apk_url?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_mandatory?: boolean
          min_supported_version_code?: number
          release_notes?: string | null
          updated_at?: string
          version_code?: number
          version_name?: string
        }
        Relationships: []
      }
      artist_applications: {
        Row: {
          admin_note: string | null
          artist_photo_path: string | null
          auto_check_warnings: Json | null
          auto_checks_at: string | null
          country_code: string
          created_at: string
          face_match_platform_score: number | null
          face_match_platform_status: string | null
          face_match_score: number | null
          face_match_status: string | null
          id: string
          music_platform_url: string | null
          ownership_check_at: string | null
          ownership_code: string | null
          ownership_verified_at: string | null
          phone: string
          phone_hash: string | null
          platform_photo_url: string | null
          real_name: string
          reviewed_at: string | null
          reviewed_by: string | null
          selfie_path: string | null
          social_links: Json
          social_verified_status: string | null
          social_verified_url: string | null
          stage_name: string
          status: Database["public"]["Enums"]["artist_app_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          artist_photo_path?: string | null
          auto_check_warnings?: Json | null
          auto_checks_at?: string | null
          country_code: string
          created_at?: string
          face_match_platform_score?: number | null
          face_match_platform_status?: string | null
          face_match_score?: number | null
          face_match_status?: string | null
          id?: string
          music_platform_url?: string | null
          ownership_check_at?: string | null
          ownership_code?: string | null
          ownership_verified_at?: string | null
          phone: string
          phone_hash?: string | null
          platform_photo_url?: string | null
          real_name: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_path?: string | null
          social_links?: Json
          social_verified_status?: string | null
          social_verified_url?: string | null
          stage_name: string
          status?: Database["public"]["Enums"]["artist_app_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          artist_photo_path?: string | null
          auto_check_warnings?: Json | null
          auto_checks_at?: string | null
          country_code?: string
          created_at?: string
          face_match_platform_score?: number | null
          face_match_platform_status?: string | null
          face_match_score?: number | null
          face_match_status?: string | null
          id?: string
          music_platform_url?: string | null
          ownership_check_at?: string | null
          ownership_code?: string | null
          ownership_verified_at?: string | null
          phone?: string
          phone_hash?: string | null
          platform_photo_url?: string | null
          real_name?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_path?: string | null
          social_links?: Json
          social_verified_status?: string | null
          social_verified_url?: string | null
          stage_name?: string
          status?: Database["public"]["Enums"]["artist_app_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      artist_followers: {
        Row: {
          artist_user_id: string
          created_at: string
          follower_user_id: string
          id: string
        }
        Insert: {
          artist_user_id: string
          created_at?: string
          follower_user_id: string
          id?: string
        }
        Update: {
          artist_user_id?: string
          created_at?: string
          follower_user_id?: string
          id?: string
        }
        Relationships: []
      }
      artist_profiles: {
        Row: {
          accent_color: string | null
          avatar_url: string | null
          banner_url: string | null
          bio: string | null
          country_code: string | null
          created_at: string
          genres: string[] | null
          id: string
          is_verified: boolean
          location: string | null
          music_platform_url: string | null
          pronouns: string | null
          slug: string
          social_links: Json
          stage_name: string
          tagline: string | null
          total_followers: number
          total_likes: number
          total_plays: number
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          accent_color?: string | null
          avatar_url?: string | null
          banner_url?: string | null
          bio?: string | null
          country_code?: string | null
          created_at?: string
          genres?: string[] | null
          id?: string
          is_verified?: boolean
          location?: string | null
          music_platform_url?: string | null
          pronouns?: string | null
          slug: string
          social_links?: Json
          stage_name: string
          tagline?: string | null
          total_followers?: number
          total_likes?: number
          total_plays?: number
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          accent_color?: string | null
          avatar_url?: string | null
          banner_url?: string | null
          bio?: string | null
          country_code?: string | null
          created_at?: string
          genres?: string[] | null
          id?: string
          is_verified?: boolean
          location?: string | null
          music_platform_url?: string | null
          pronouns?: string | null
          slug?: string
          social_links?: Json
          stage_name?: string
          tagline?: string | null
          total_followers?: number
          total_likes?: number
          total_plays?: number
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      artist_push_throttle: {
        Row: {
          artist_user_id: string
          count_since_last: number
          event_kind: string
          last_notified_at: string
        }
        Insert: {
          artist_user_id: string
          count_since_last?: number
          event_kind: string
          last_notified_at?: string
        }
        Update: {
          artist_user_id?: string
          count_since_last?: number
          event_kind?: string
          last_notified_at?: string
        }
        Relationships: []
      }
      artist_songs: {
        Row: {
          artist_user_id: string
          cover_url: string | null
          created_at: string
          download_count: number
          duration: number | null
          id: string
          like_count: number
          lyrics_plain: string | null
          lyrics_source: string | null
          lyrics_synced: string | null
          play_count: number
          status: Database["public"]["Enums"]["artist_song_status"]
          stream_url: string
          takedown_reason: string | null
          title: string
          updated_at: string
          view_count: number
        }
        Insert: {
          artist_user_id: string
          cover_url?: string | null
          created_at?: string
          download_count?: number
          duration?: number | null
          id?: string
          like_count?: number
          lyrics_plain?: string | null
          lyrics_source?: string | null
          lyrics_synced?: string | null
          play_count?: number
          status?: Database["public"]["Enums"]["artist_song_status"]
          stream_url: string
          takedown_reason?: string | null
          title: string
          updated_at?: string
          view_count?: number
        }
        Update: {
          artist_user_id?: string
          cover_url?: string | null
          created_at?: string
          download_count?: number
          duration?: number | null
          id?: string
          like_count?: number
          lyrics_plain?: string | null
          lyrics_source?: string | null
          lyrics_synced?: string | null
          play_count?: number
          status?: Database["public"]["Enums"]["artist_song_status"]
          stream_url?: string
          takedown_reason?: string | null
          title?: string
          updated_at?: string
          view_count?: number
        }
        Relationships: []
      }
      artists: {
        Row: {
          bio: string | null
          created_at: string
          genre: string | null
          id: string
          is_premium_only: boolean
          name: string
          photo_url: string | null
          updated_at: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          genre?: string | null
          id?: string
          is_premium_only?: boolean
          name: string
          photo_url?: string | null
          updated_at?: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          genre?: string | null
          id?: string
          is_premium_only?: boolean
          name?: string
          photo_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          created_at: string
          details: Json
          event_type: string
          id: string
          ip_address: string | null
          severity: string
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          ip_address?: string | null
          severity?: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          ip_address?: string | null
          severity?: string
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      auto_playlists: {
        Row: {
          cover_urls: Json
          created_at: string
          expires_at: string
          generated_at: string
          id: string
          kind: string
          seed_song_id: string | null
          subtitle: string | null
          title: string
          tracks: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          cover_urls?: Json
          created_at?: string
          expires_at?: string
          generated_at?: string
          id?: string
          kind: string
          seed_song_id?: string | null
          subtitle?: string | null
          title: string
          tracks?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          cover_urls?: Json
          created_at?: string
          expires_at?: string
          generated_at?: string
          id?: string
          kind?: string
          seed_song_id?: string | null
          subtitle?: string | null
          title?: string
          tracks?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chart_tracks: {
        Row: {
          artist: string
          chart_type: string
          country_code: string
          cover_url: string | null
          created_at: string
          external_id: string | null
          fetched_at: string
          id: string
          metadata: Json
          rank: number
          source: string
          title: string
        }
        Insert: {
          artist: string
          chart_type: string
          country_code?: string
          cover_url?: string | null
          created_at?: string
          external_id?: string | null
          fetched_at?: string
          id?: string
          metadata?: Json
          rank: number
          source: string
          title: string
        }
        Update: {
          artist?: string
          chart_type?: string
          country_code?: string
          cover_url?: string | null
          created_at?: string
          external_id?: string | null
          fetched_at?: string
          id?: string
          metadata?: Json
          rank?: number
          source?: string
          title?: string
        }
        Relationships: []
      }
      content_reports: {
        Row: {
          action_taken: string | null
          content_id: string
          content_type: string
          created_at: string
          details: string | null
          id: string
          reason: string
          reporter_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          action_taken?: string | null
          content_id: string
          content_type: string
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reporter_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          action_taken?: string | null
          content_id?: string
          content_type?: string
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reporter_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          device_info: Json | null
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_info?: Json | null
          id?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_info?: Json | null
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_verifications: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          email: string
          expires_at: string
          last_sent_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          email: string
          expires_at: string
          last_sent_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          email?: string
          expires_at?: string
          last_sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      experiment_assignments: {
        Row: {
          assigned_at: string
          converted: boolean
          converted_at: string | null
          experiment_id: string
          id: string
          user_id: string
          variant: string
        }
        Insert: {
          assigned_at?: string
          converted?: boolean
          converted_at?: string | null
          experiment_id: string
          id?: string
          user_id: string
          variant: string
        }
        Update: {
          assigned_at?: string
          converted?: boolean
          converted_at?: string | null
          experiment_id?: string
          id?: string
          user_id?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_assignments_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          id: string
          name: string
          starts_at: string | null
          status: string
          updated_at: string
          variants: Json
          winner: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          name: string
          starts_at?: string | null
          status?: string
          updated_at?: string
          variants?: Json
          winner?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          starts_at?: string | null
          status?: string
          updated_at?: string
          variants?: Json
          winner?: string | null
        }
        Relationships: []
      }
      friends: {
        Row: {
          created_at: string
          friend_id: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          friend_id: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          friend_id?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      internal_secrets: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      ip_rate_limits: {
        Row: {
          endpoint: string
          ip_hash: string
          request_count: number
          window_start: string
        }
        Insert: {
          endpoint: string
          ip_hash: string
          request_count?: number
          window_start?: string
        }
        Update: {
          endpoint?: string
          ip_hash?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      listening_session_members: {
        Row: {
          id: string
          joined_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listening_session_members_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "listening_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      listening_sessions: {
        Row: {
          created_at: string
          current_song_data: Json | null
          host_user_id: string
          id: string
          is_active: boolean
          is_playing: boolean
          playback_position: number
          session_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_song_data?: Json | null
          host_user_id: string
          id?: string
          is_active?: boolean
          is_playing?: boolean
          playback_position?: number
          session_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_song_data?: Json | null
          host_user_id?: string
          id?: string
          is_active?: boolean
          is_playing?: boolean
          playback_position?: number
          session_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_requests: {
        Row: {
          amount_paise: number
          created_at: string
          id: string
          notes: string | null
          payer_name: string | null
          payer_upi: string | null
          plan: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
          utr_number: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          id?: string
          notes?: string | null
          payer_name?: string | null
          payer_upi?: string | null
          plan?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
          utr_number: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          id?: string
          notes?: string | null
          payer_name?: string | null
          payer_upi?: string | null
          plan?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          utr_number?: string
        }
        Relationships: []
      }
      perf_events: {
        Row: {
          created_at: string
          details: Json
          event_type: string
          id: string
          latency_ms: number | null
          message: string | null
          route: string | null
          severity: string
          source: string | null
          track_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          latency_ms?: number | null
          message?: string | null
          route?: string | null
          severity?: string
          source?: string | null
          track_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          latency_ms?: number | null
          message?: string | null
          route?: string | null
          severity?: string
          source?: string | null
          track_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      playback_state: {
        Row: {
          device_id: string | null
          device_label: string | null
          is_playing: boolean
          position_seconds: number
          queue: Json
          song: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          device_id?: string | null
          device_label?: string | null
          is_playing?: boolean
          position_seconds?: number
          queue?: Json
          song?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          device_id?: string | null
          device_label?: string | null
          is_playing?: boolean
          position_seconds?: number
          queue?: Json
          song?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      playlist_songs: {
        Row: {
          added_at: string
          id: string
          playlist_id: string
          position: number
          song_id: string
          track_source: string
        }
        Insert: {
          added_at?: string
          id?: string
          playlist_id: string
          position?: number
          song_id: string
          track_source?: string
        }
        Update: {
          added_at?: string
          id?: string
          playlist_id?: string
          position?: number
          song_id?: string
          track_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_songs_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlists: {
        Row: {
          cover_url: string | null
          created_at: string
          description: string | null
          id: string
          is_featured: boolean
          is_public: boolean
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_featured?: boolean
          is_public?: boolean
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_featured?: boolean
          is_public?: boolean
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_type: string
          avatar_url: string | null
          country_code: string | null
          created_at: string
          email: string | null
          email_verified: boolean
          email_verified_at: string | null
          id: string
          is_admin: boolean
          is_private: boolean
          last_mood_push_at: string | null
          mood_pushes_enabled: boolean
          share_code: string | null
          status: string
          updated_at: string
          user_id: string
          username: string | null
          username_changed: boolean
        }
        Insert: {
          account_type?: string
          avatar_url?: string | null
          country_code?: string | null
          created_at?: string
          email?: string | null
          email_verified?: boolean
          email_verified_at?: string | null
          id?: string
          is_admin?: boolean
          is_private?: boolean
          last_mood_push_at?: string | null
          mood_pushes_enabled?: boolean
          share_code?: string | null
          status?: string
          updated_at?: string
          user_id: string
          username?: string | null
          username_changed?: boolean
        }
        Update: {
          account_type?: string
          avatar_url?: string | null
          country_code?: string | null
          created_at?: string
          email?: string | null
          email_verified?: boolean
          email_verified_at?: string | null
          id?: string
          is_admin?: boolean
          is_private?: boolean
          last_mood_push_at?: string | null
          mood_pushes_enabled?: boolean
          share_code?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          username?: string | null
          username_changed?: boolean
        }
        Relationships: []
      }
      push_history: {
        Row: {
          body: string
          created_at: string
          deep_link: string | null
          failure_count: number
          id: string
          sent_by: string | null
          sent_count: number
          success_count: number
          target_audience: string
          target_user_ids: string[] | null
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          deep_link?: string | null
          failure_count?: number
          id?: string
          sent_by?: string | null
          sent_count?: number
          success_count?: number
          target_audience?: string
          target_user_ids?: string[] | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          deep_link?: string | null
          failure_count?: number
          id?: string
          sent_by?: string | null
          sent_count?: number
          success_count?: number
          target_audience?: string
          target_user_ids?: string[] | null
          title?: string
        }
        Relationships: []
      }
      recently_played: {
        Row: {
          id: string
          played_at: string
          song_id: string
          user_id: string
        }
        Insert: {
          id?: string
          played_at?: string
          song_id: string
          user_id: string
        }
        Update: {
          id?: string
          played_at?: string
          song_id?: string
          user_id?: string
        }
        Relationships: []
      }
      review_reactions: {
        Row: {
          created_at: string
          id: string
          reaction: string
          review_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reaction: string
          review_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reaction?: string
          review_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_reactions_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "app_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_reactions_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "app_reviews_public"
            referencedColumns: ["id"]
          },
        ]
      }
      song_dedications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string | null
          recipient_id: string
          sender_id: string
          song_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          recipient_id: string
          sender_id: string
          song_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string | null
          recipient_id?: string
          sender_id?: string
          song_id?: string
        }
        Relationships: []
      }
      song_play_events: {
        Row: {
          action: string
          artist: string
          city: string | null
          country_code: string | null
          country_name: string | null
          cover_url: string | null
          created_at: string
          id: string
          score_weight: number
          session_id: string | null
          song_id: string | null
          source: string
          title: string
          track_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          artist: string
          city?: string | null
          country_code?: string | null
          country_name?: string | null
          cover_url?: string | null
          created_at?: string
          id?: string
          score_weight: number
          session_id?: string | null
          song_id?: string | null
          source?: string
          title: string
          track_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          artist?: string
          city?: string | null
          country_code?: string | null
          country_name?: string | null
          cover_url?: string | null
          created_at?: string
          id?: string
          score_weight?: number
          session_id?: string | null
          song_id?: string | null
          source?: string
          title?: string
          track_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      songs: {
        Row: {
          album: string | null
          artist: string
          artist_id: string | null
          audio_url: string
          bitrate: number | null
          bpm: number | null
          cover_size: number | null
          cover_url: string | null
          created_at: string
          download_count: number | null
          duration: number | null
          file_size: number | null
          genre: string | null
          id: string
          is_premium_only: boolean
          is_visible: boolean
          mood: string | null
          play_count: number
          show_in_new_releases: boolean
          show_in_trending: boolean
          title: string
          updated_at: string
        }
        Insert: {
          album?: string | null
          artist: string
          artist_id?: string | null
          audio_url: string
          bitrate?: number | null
          bpm?: number | null
          cover_size?: number | null
          cover_url?: string | null
          created_at?: string
          download_count?: number | null
          duration?: number | null
          file_size?: number | null
          genre?: string | null
          id?: string
          is_premium_only?: boolean
          is_visible?: boolean
          mood?: string | null
          play_count?: number
          show_in_new_releases?: boolean
          show_in_trending?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          album?: string | null
          artist?: string
          artist_id?: string | null
          audio_url?: string
          bitrate?: number | null
          bpm?: number | null
          cover_size?: number | null
          cover_url?: string | null
          created_at?: string
          download_count?: number | null
          duration?: number | null
          file_size?: number | null
          genre?: string | null
          id?: string
          is_premium_only?: boolean
          is_visible?: boolean
          mood?: string | null
          play_count?: number
          show_in_new_releases?: boolean
          show_in_trending?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "songs_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      stream_songs: {
        Row: {
          album: string | null
          artist: string
          artist_image_url: string | null
          audio_url: string | null
          cover_url: string | null
          created_at: string
          duration: number | null
          genre: string | null
          last_seen_at: string
          metadata: Json
          mood: string | null
          source: string
          title: string
          track_id: string
          updated_at: string
        }
        Insert: {
          album?: string | null
          artist: string
          artist_image_url?: string | null
          audio_url?: string | null
          cover_url?: string | null
          created_at?: string
          duration?: number | null
          genre?: string | null
          last_seen_at?: string
          metadata?: Json
          mood?: string | null
          source?: string
          title: string
          track_id: string
          updated_at?: string
        }
        Update: {
          album?: string | null
          artist?: string
          artist_image_url?: string | null
          audio_url?: string | null
          cover_url?: string | null
          created_at?: string
          duration?: number | null
          genre?: string | null
          last_seen_at?: string
          metadata?: Json
          mood?: string | null
          source?: string
          title?: string
          track_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      stream_url_cache: {
        Row: {
          artist: string | null
          audio_url: string
          created_at: string
          duration: number | null
          expires_at: string
          thumbnail: string | null
          title: string | null
          updated_at: string
          video_id: string
        }
        Insert: {
          artist?: string | null
          audio_url: string
          created_at?: string
          duration?: number | null
          expires_at?: string
          thumbnail?: string | null
          title?: string | null
          updated_at?: string
          video_id: string
        }
        Update: {
          artist?: string | null
          audio_url?: string
          created_at?: string
          duration?: number | null
          expires_at?: string
          thumbnail?: string | null
          title?: string | null
          updated_at?: string
          video_id?: string
        }
        Relationships: []
      }
      support_chats: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
          status: string
          unread_for_admin: number
          unread_for_user: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          unread_for_admin?: number
          unread_for_user?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
          status?: string
          unread_for_admin?: number
          unread_for_user?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          body: string
          chat_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
          sender_role: string
        }
        Insert: {
          body: string
          chat_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
          sender_role: string
        }
        Update: {
          body?: string
          chat_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
          sender_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "support_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      user_artist_preferences: {
        Row: {
          artist_image: string | null
          artist_name: string
          artist_source: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          artist_image?: string | null
          artist_name: string
          artist_source?: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          artist_image?: string | null
          artist_name?: string
          artist_source?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_eq_settings: {
        Row: {
          settings: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          settings?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          settings?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_library: {
        Row: {
          added_at: string
          id: string
          song_id: string
          track_source: string
          user_id: string
        }
        Insert: {
          added_at?: string
          id?: string
          song_id: string
          track_source?: string
          user_id: string
        }
        Update: {
          added_at?: string
          id?: string
          song_id?: string
          track_source?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          notif_activated_at: string | null
          notif_expired_at: string | null
          notif_warn_1d_at: string | null
          notif_warn_3d_at: string | null
          platform: Database["public"]["Enums"]["subscription_platform"]
          purchase_token: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          subscription_type: Database["public"]["Enums"]["subscription_type"]
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          notif_activated_at?: string | null
          notif_expired_at?: string | null
          notif_warn_1d_at?: string | null
          notif_warn_3d_at?: string | null
          platform?: Database["public"]["Enums"]["subscription_platform"]
          purchase_token?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          subscription_type?: Database["public"]["Enums"]["subscription_type"]
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          notif_activated_at?: string | null
          notif_expired_at?: string | null
          notif_warn_1d_at?: string | null
          notif_warn_3d_at?: string | null
          platform?: Database["public"]["Enums"]["subscription_platform"]
          purchase_token?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          subscription_type?: Database["public"]["Enums"]["subscription_type"]
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      viral_chart_refreshes: {
        Row: {
          city: string | null
          country_code: string | null
          id: string
          scope: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          country_code?: string | null
          id?: string
          scope: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          country_code?: string | null
          id?: string
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      viral_picks: {
        Row: {
          artist: string
          audio_url: string | null
          cover_url: string | null
          id: string
          is_active: boolean
          pinned_at: string
          pinned_by: string | null
          position: number
          source: string
          title: string
          track_id: string
        }
        Insert: {
          artist: string
          audio_url?: string | null
          cover_url?: string | null
          id?: string
          is_active?: boolean
          pinned_at?: string
          pinned_by?: string | null
          position?: number
          source?: string
          title: string
          track_id: string
        }
        Update: {
          artist?: string
          audio_url?: string | null
          cover_url?: string | null
          id?: string
          is_active?: boolean
          pinned_at?: string
          pinned_by?: string | null
          position?: number
          source?: string
          title?: string
          track_id?: string
        }
        Relationships: []
      }
      welcome_email_sends: {
        Row: {
          email: string
          last_sent_at: string
          send_count: number
        }
        Insert: {
          email: string
          last_sent_at?: string
          send_count?: number
        }
        Update: {
          email?: string
          last_sent_at?: string
          send_count?: number
        }
        Relationships: []
      }
    }
    Views: {
      app_reviews_public: {
        Row: {
          comment: string | null
          created_at: string | null
          display_name: string | null
          id: string | null
          rating: number | null
          updated_at: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          rating?: number | null
          updated_at?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          rating?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      artist_applications_safe: {
        Row: {
          artist_photo_path: string | null
          auto_check_warnings: Json | null
          auto_checks_at: string | null
          country_code: string | null
          created_at: string | null
          face_match_platform_score: number | null
          face_match_platform_status: string | null
          face_match_score: number | null
          face_match_status: string | null
          id: string | null
          music_platform_url: string | null
          ownership_check_at: string | null
          ownership_code: string | null
          ownership_verified_at: string | null
          phone: string | null
          platform_photo_url: string | null
          real_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          selfie_path: string | null
          social_links: Json | null
          social_verified_status: string | null
          social_verified_url: string | null
          stage_name: string | null
          status: Database["public"]["Enums"]["artist_app_status"] | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          artist_photo_path?: string | null
          auto_check_warnings?: Json | null
          auto_checks_at?: string | null
          country_code?: string | null
          created_at?: string | null
          face_match_platform_score?: number | null
          face_match_platform_status?: string | null
          face_match_score?: number | null
          face_match_status?: string | null
          id?: string | null
          music_platform_url?: string | null
          ownership_check_at?: string | null
          ownership_code?: string | null
          ownership_verified_at?: string | null
          phone?: string | null
          platform_photo_url?: string | null
          real_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_path?: string | null
          social_links?: Json | null
          social_verified_status?: string | null
          social_verified_url?: string | null
          stage_name?: string | null
          status?: Database["public"]["Enums"]["artist_app_status"] | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          artist_photo_path?: string | null
          auto_check_warnings?: Json | null
          auto_checks_at?: string | null
          country_code?: string | null
          created_at?: string | null
          face_match_platform_score?: number | null
          face_match_platform_status?: string | null
          face_match_score?: number | null
          face_match_status?: string | null
          id?: string | null
          music_platform_url?: string | null
          ownership_check_at?: string | null
          ownership_code?: string | null
          ownership_verified_at?: string | null
          phone?: string | null
          platform_photo_url?: string | null
          real_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_path?: string | null
          social_links?: Json | null
          social_verified_status?: string | null
          social_verified_url?: string | null
          stage_name?: string | null
          status?: Database["public"]["Enums"]["artist_app_status"] | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_get_artist_application_note: {
        Args: { _app_id: string }
        Returns: string
      }
      admin_log_event: {
        Args: { p_details?: Json; p_event_type: string; p_severity?: string }
        Returns: string
      }
      admin_review_payment_request: {
        Args: { p_request_id: string; p_status: string }
        Returns: Json
      }
      check_and_increment_ip_rate_limit: {
        Args: { _endpoint: string; _ip_hash: string; _max_per_minute: number }
        Returns: boolean
      }
      check_and_increment_rate_limit: {
        Args: { _endpoint: string; _max_per_minute: number; _user_id: string }
        Returns: boolean
      }
      check_artist_phone_taken: {
        Args: { p_phone_hash: string }
        Returns: boolean
      }
      check_artist_stage_name_taken: {
        Args: { p_stage_name: string }
        Returns: boolean
      }
      consume_free_skip: { Args: never; Returns: Json }
      expire_old_subscriptions: { Args: never; Returns: number }
      find_profile_by_share_code: {
        Args: { p_share_code: string }
        Returns: {
          avatar_url: string
          user_id: string
          username: string
        }[]
      }
      get_artist_follower_count: {
        Args: { _artist_user_id: string }
        Returns: number
      }
      get_friend_profile: {
        Args: { _friend_user_id: string }
        Returns: {
          avatar_url: string
          user_id: string
          username: string
        }[]
      }
      get_my_artist_application_note: {
        Args: { _app_id: string }
        Returns: string
      }
      get_user_count: { Args: never; Returns: number }
      get_viral_song_events: {
        Args: {
          p_city?: string
          p_country_code?: string
          p_limit?: number
          p_since_hours?: number
        }
        Returns: {
          artist: string
          city: string
          country_code: string
          cover_url: string
          last_event_at: string
          playlist_add_count: number
          save_count: number
          score: number
          share_count: number
          skip_count: number
          song_id: string
          source: string
          stream_count: number
          title: string
          track_id: string
        }[]
      }
      has_premium_subscription: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_artist_song_download: {
        Args: { _song_id: string }
        Returns: undefined
      }
      increment_artist_song_play: {
        Args: { _song_id: string }
        Returns: undefined
      }
      increment_artist_song_view: {
        Args: { _song_id: string }
        Returns: undefined
      }
      is_following_artist: {
        Args: { _artist_user_id: string }
        Returns: boolean
      }
      join_jam_room: {
        Args: { p_code: string; p_display_name?: string }
        Returns: string
      }
      join_listening_session: {
        Args: { p_session_code: string }
        Returns: string
      }
      notify_system_push: {
        Args: {
          _body: string
          _deep_link?: string
          _title: string
          _user_ids: string[]
        }
        Returns: undefined
      }
      process_premium_expiry_notifications: { Args: never; Returns: Json }
      register_device_token: {
        Args: { _device_info?: Json; _platform?: string; _token: string }
        Returns: string
      }
      safe_jsonb_text: { Args: { _value: Json }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      submit_artist_application: {
        Args: {
          p_artist_photo_path: string
          p_country_code: string
          p_music_platform_url: string
          p_ownership_code?: string
          p_phone: string
          p_phone_hash: string
          p_real_name: string
          p_selfie_path: string
          p_social_links: Json
          p_social_verified_url?: string
          p_stage_name: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "artist"
      artist_app_status: "pending" | "approved" | "rejected"
      artist_song_status: "live" | "taken_down"
      subscription_platform: "android" | "ios" | "web" | "donation"
      subscription_status: "active" | "expired" | "cancelled" | "pending"
      subscription_type: "free" | "premium_monthly" | "premium_yearly"
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
      app_role: ["admin", "moderator", "user", "artist"],
      artist_app_status: ["pending", "approved", "rejected"],
      artist_song_status: ["live", "taken_down"],
      subscription_platform: ["android", "ios", "web", "donation"],
      subscription_status: ["active", "expired", "cancelled", "pending"],
      subscription_type: ["free", "premium_monthly", "premium_yearly"],
    },
  },
} as const
