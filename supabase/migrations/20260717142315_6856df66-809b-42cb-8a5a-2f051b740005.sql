
ALTER TABLE public.artist_profiles
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS accent_color text,
  ADD COLUMN IF NOT EXISTS genres text[],
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS pronouns text,
  ADD COLUMN IF NOT EXISTS website text;

ALTER TABLE public.artist_profiles
  ADD CONSTRAINT artist_profiles_tagline_len CHECK (tagline IS NULL OR char_length(tagline) <= 80),
  ADD CONSTRAINT artist_profiles_pronouns_len CHECK (pronouns IS NULL OR char_length(pronouns) <= 24),
  ADD CONSTRAINT artist_profiles_location_len CHECK (location IS NULL OR char_length(location) <= 60),
  ADD CONSTRAINT artist_profiles_accent_hex CHECK (accent_color IS NULL OR accent_color ~* '^#([0-9a-f]{6})$');
