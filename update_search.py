import re

with open('src/pages/Search.tsx', 'r') as f:
    lines = f.readlines()

def find_line(pattern, start_index=0):
    for i in range(start_index, len(lines)):
        if pattern in lines[i]:
            return i
    return -1

# 1. Update SPAM_RESULT_PATTERNS
spam_start = find_line('const SPAM_RESULT_PATTERNS = [')
spam_end = find_line('];', spam_start)
if spam_start != -1 and spam_end != -1:
    new_spam = [
        'const SPAM_RESULT_PATTERNS = [\n',
        '  /\\b(top|best)\\s*\\d+\\b/i,\n',
        '  /\\b\\d+\\s*(top|best|hit|hits|songs)\\b/i,\n',
        '  /\\b(non\\s*stop|jukebox|mashup|medley|playlist|compilation|collection|mixtape|full\\s*album|all\\s*songs)\\b/i,\n',
        '  /\\b(sped\\s*up|slowed(\\s*\\+?\\s*reverb)?|nightcore|8\\s*d|bass\\s*boost(ed)?|reverb(ed)?)\\b/i,\n',
        '  /\\b(karaoke|instrumental|backing\\s*track|minus\\s*one|tribute)\\b/i,\n',
        '  /\\b(cover(\\s*by)?|cover\\s*version|fan\\s*made|unofficial|ai\\s*cover|ai\\s*voice|ai\\s*song)\\b/i,\n',
        '  /\\b(lyric\\s*video|with\\s*lyrics?|tutorial|reaction|breakdown|explained|status\\s*video)\\b/i,\n',
        '  /\\b(whatsapp\\s*status|ringtone|bgm|loop(ed)?|tiktok\\s*version|reels?\\s*version|shorts?)\\b/i,\n',
        '  /\\b\\d+\\s*(hour|hours|hr|hrs|minute|minutes|min)\\b/i,\n',
        '  /\\b(dj\\s*remix|remix\\s*by|club\\s*mix|extended\\s*mix|edm\\s*remix|trap\\s*remix|phonk\\s*remix)\\b/i,\n',
        '];\n'
    ]
    lines[spam_start:spam_end+1] = new_spam

# 2. Update isSpamTrack
is_spam_start = find_line('function isSpamTrack(track: IndexedTrack, query: string) {')
# The original end was return SPAM_RESULT_PATTERNS.some(...) followed by }
is_spam_end = find_line('return SPAM_RESULT_PATTERNS.some', is_spam_start)
if is_spam_end != -1:
    # find the next }
    is_spam_end = find_line('}', is_spam_end)

if is_spam_start != -1 and is_spam_end != -1:
    new_is_spam = [
        'function isSpamTrack(track: IndexedTrack, query: string) {\n',
        '  const q = normalizeText(query);\n',
        '  const title = track.title || "";\n',
        '  const artist = track.artist || "";\n',
        '  const haystack = `${title} ${artist} ${track.album || ""}`;\n',
        '  const normalizedHaystack = normalizeText(haystack);\n',
        '  const duration = Number(track.duration || 0);\n',
        '  const allowLongForm = /\\b(lofi|mix|playlist|jukebox|medley|concert|live|full album)\\b/.test(q);\n',
        '  \n',
        '  if (!title || !artist) return true;\n',
        '  // Excessive duration check (too short or too long unless asked)\n',
        '  if (duration && (duration < 60 || (!allowLongForm && duration > 660))) return true;\n',
        '  \n',
        '  // Detect low-quality automated uploads (common on YouTube)\n',
        '  const isGenericArtist = /^(original|official|audio|music|songs|topic|records|vevo)$/i.test(normalizeText(artist).trim());\n',
        '  if (isGenericArtist && !q.includes("original") && !q.includes("topic")) return true;\n',
        '\n',
        '  if (!q.includes("lofi") && /\\blo\\s*fi\\b|\\blofi\\b/.test(normalizedHaystack)) return true;\n',
        '  if (SPAM_ARTIST_PATTERNS.some((pattern) => pattern.test(artist))) return true;\n',
        '  return SPAM_RESULT_PATTERNS.some((pattern) => pattern.test(haystack));\n',
        '}\n'
    ]
    lines[is_spam_start:is_spam_end+1] = new_is_spam

# 3. Update rankAndDedupeResults
rank_start = find_line('function rankAndDedupeResults')
rank_end = find_line('const Search = () => {')
if rank_start != -1 and rank_end != -1:
    # back up to the last } before Search
    while rank_end > rank_start and '}' not in lines[rank_end]:
        rank_end -= 1
    
    new_rank = [
        'function rankAndDedupeResults(query: string, youtube: IndexedTrack[], literal: IndexedTrack[], tagSets: IndexedTrack[][], allowDiscoveryFallback = false) {\n',
        '  const tokens = queryTokens(query);\n',
        '  const qNorm = normalizeText(query);\n',
        '  const allTracks: { track: IndexedTrack; score: number; sourcePriority: number; index: number }[] = [];\n',
        '\n',
        '  const processTrack = (track: IndexedTrack, base: number, index: number, sourcePriority: number) => {\n',
        '    if (isSpamTrack(track, query)) return;\n',
        '    const rawTitle = String(track.title || "");\n',
        '    const rawArtist = String(track.artist || "");\n',
        '    const title = normalizeText(rawTitle);\n',
        '    const artist = normalizeText(rawArtist);\n',
        '    const haystack = normalizeText(`${rawTitle} ${rawArtist} ${track.album || ""}`);\n',
        '    \n',
        '    const tokenHits = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);\n',
        '    const phraseHit = qNorm.length > 2 && haystack.includes(qNorm);\n',
        '    if (!allowDiscoveryFallback && tokens.length > 0 && tokenHits === 0 && !phraseHit) return;\n',
        '\n',
        '    // Relevance\n',
        '    const titleStartsWith = qNorm.length > 1 && title.startsWith(qNorm);\n',
        '    const titlePhraseHit = qNorm.length > 2 && title.includes(qNorm);\n',
        '    const titleAllTokens = tokens.length > 0 && tokens.every((t) => title.includes(t));\n',
        '    const titleTokenHits = tokens.reduce((sum, t) => sum + (title.includes(t) ? 1 : 0), 0);\n',
        '    const artistTokenHits = tokens.reduce((sum, t) => sum + (artist.includes(t) ? 1 : 0), 0);\n',
        '    \n',
        '    const relevance =\n',
        '      (titleStartsWith ? 1000 : 0) +\n',
        '      (titlePhraseHit ? 800 : 0) +\n',
        '      (titleAllTokens ? 600 : 0) +\n',
        '      titleTokenHits * 150 +\n',
        '      artistTokenHits * 130 +\n',
        '      (phraseHit ? 100 : 0);\n',
        '\n',
        '    // Popularity\n',
        '    const listeners = Math.max(0, Number(track.listeners) || 0);\n',
        '    const popularity = Math.min(200, Math.log10(1 + listeners) * 28);\n',
        '    const viralTier = listeners >= 5_000_000 ? 250 : listeners >= 500_000 ? 120 : 0;\n',
        '\n',
        '    // Quality signals\n',
        '    const isOfficial = /\\b(VEVO|Topic|Official)\\b/i.test(rawArtist) || /\\b(official\\s*video|official\\s*audio|official\\s*music\\s*video)\\b/i.test(rawTitle);\n',
        '    const officialBonus = isOfficial ? 400 : 0;\n',
        '    const kindBonus = track.kind === "song" ? 450 : 0;\n',
        '    \n',
        '    // Noise penalty (refined: don\'t penalize \'official\')\n',
        '    const actualNoise = /\\b(slowed|reverb|8d|lofi|karaoke|instrumental|lyrics?|nightcore|mashup|remix|fan\\s*made|unofficial|cover|tribute|ai\\s*cover|ai\\s*voice)\\b/i;\n',
        '    const parenNoise = (rawTitle.match(/\\([^\\)]{4,}\\)|\\[[^\\]]{4,}\\]/g) || []).length;\n',
        '    const noiseWords = actualNoise.test(rawTitle) ? 1 : 0;\n',
        '    const noisePenalty = parenNoise * 40 + noiseWords * 180 + (rawTitle.length > 70 ? 40 : 0);\n',
        '\n',
        '    const score = base + relevance + popularity + viralTier + officialBonus + kindBonus - noisePenalty - index * 0.8;\n',
        '    allTracks.push({ track, score, sourcePriority, index });\n',
        '  };\n',
        '\n',
        '  youtube.forEach((track, index) => processTrack(track, 360, index, 3));\n',
        '  literal.forEach((track, index) => processTrack(track, 520, index, 2));\n',
        '  tagSets.forEach((set, setIndex) => set.forEach((track, index) => processTrack(track, 220 + setIndex * 40, index, 1)));\n',
        '\n',
        '  // Deduplication: Pick the best track for each artist::title pair\n',
        '  const bestScores = new Map<string, number>();\n',
        '  for (const t of allTracks) {\n',
        '    const key = resultKey(t.track);\n',
        '    if (!bestScores.has(key) || t.score > bestScores.get(key)!) {\n',
        '      bestScores.set(key, t.score);\n',
        '    }\n',
        '  }\n',
        '\n',
        '  // Final list: if not the best for its key, apply a "duplicate" penalty\n',
        '  // This ranks official/best versions first and duplicates last.\n',
        '  return allTracks\n',
        '    .map((t) => {\n',
        '      const key = resultKey(t.track);\n',
        '      const isPrimary = t.score === bestScores.get(key);\n',
        '      const finalScore = isPrimary ? t.score : t.score - 5000;\n',
        '      return { ...t, finalScore };\n',
        '    })\n',
        '    .sort((a, b) => b.finalScore - a.finalScore || b.sourcePriority - a.sourcePriority || a.index - b.index)\n',
        '    .map((t) => t.track);\n',
        '}\n'
    ]
    lines[rank_start:rank_end+1] = new_rank

with open('src/pages/Search.tsx', 'w') as f:
    f.writelines(lines)
