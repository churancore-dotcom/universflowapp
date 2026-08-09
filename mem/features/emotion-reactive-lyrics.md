---
name: Emotion-Reactive Lyric Visuals
description: Keyword-based per-line lyric emotion detection driving a canvas particle/wave visualizer behind synced lyrics
type: feature
---
Client-side only, free, no AI model.

- `src/lib/lyricEmotion.ts` — `emotionKeywords` map (sad, angry, happy, romantic, intense + Hindi/Punjabi terms), `detectEmotion(line)`, `annotateEmotions(lines)` (precomputed once per song, empty/instrumental lines inherit previous mood), `dominantEmotion`, and `EMOTION_STYLES` (colors, speed, chaos, pulse, amplitude, size, label per emotion).
- `src/components/EmotionVisualizer.tsx` — canvas particle + wave engine, requestAnimationFrame loop, ~800ms crossfade between emotion styles, respects prefers-reduced-motion, cleans up RAF/ResizeObserver.
- Audio reactivity: `getAnalyser()` in `src/lib/audioEngine.ts` is a read-only side-branch AnalyserNode off the live source (never connected to destination, audio routing untouched). Returns null on the native ExoPlayer path, where the visualizer falls back to a synthetic pulse.
- Wired into `SyncedLyricsView` (fullscreen player) and `KaraokeLyricsStage` (lock screen). Missing lyrics render "Lyrics not available" with visuals still running.

NOTE: this supersedes the old "no visualizer" UI exclusion — the visualizer only exists inside the lyrics surface, nowhere else.
