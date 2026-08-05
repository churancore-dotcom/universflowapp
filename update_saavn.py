import re

with open('src/lib/jiosaavn.ts', 'r') as f:
    content = f.read()

# Fix looksSpammy to not block "Original" in artist names unless it's the ONLY word or generic
new_looks_spammy = """function looksSpammy(song: SaavnSong): boolean {
  const name = song.name || song.title || '';
  const artist = primaryArtists(song);
  const haystack = `${name} ${artist} ${albumName(song.album)}`;
  const duration = typeof song.duration === 'number' ? song.duration : Number(song.duration) || 0;
  
  // Reasonable song length: 60s to 11m
  if (duration && (duration < 60 || duration > 660)) return true;
  
  // Generic "Originals" artist check - common for low-quality automated uploads
  const artistNorm = artist.toLowerCase().trim();
  if (artistNorm === 'original' || artistNorm === 'originals') return true;
  
  return SPAM_TRACK_PATTERNS.some((pattern) => pattern.test(haystack));
}"""

content = re.sub(r'function looksSpammy\(song: SaavnSong\): boolean \{.*?\}', new_looks_spammy, content, flags=re.DOTALL)

with open('src/lib/jiosaavn.ts', 'w') as f:
    f.write(content)
