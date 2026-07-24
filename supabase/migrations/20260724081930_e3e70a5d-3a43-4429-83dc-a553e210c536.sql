-- Pass 3: Release scheduling support for artist_songs
ALTER TYPE public.artist_song_status ADD VALUE IF NOT EXISTS 'scheduled';
ALTER TYPE public.artist_song_status ADD VALUE IF NOT EXISTS 'draft';