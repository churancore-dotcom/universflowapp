# Project Memory

## Core
- Mobile-only UI (`h-[100dvh]`), Apple Music Bento-style layout. Rose accents (#FF2D55). Native Android shell using ExoPlayer (Media3) for background audio.
- Silent Feed Personalization: YouTube-style taste-based re-ranking for Trending/Fresh/Charts rails.
- Artist Platform: Identity verification via MediaPipe liveness (blink/smile) and music platform proof; editorial public pages with full SEO.
- Content Sourcing: Native InnerTube-on-device resolution (racing ANDROID_VR, IOS, CREATOR) with Rhino-based cipher deciphering; JioSaavn fast-path for Indian music.
- Constraints: NO browser-side Deezer calls; direct audio only (ExoPlayer/Native) on Android; iframe fallback completely removed to prevent CAPTCHA loops.
- UI EXCLUSIONS: Minimalist focus; No AI DJ, sleep timer, or voice search. Visualizer allowed ONLY inside the lyrics surface (emotion-reactive canvas).

## Memories
- [Native Architecture](mem://technical/native-architecture-capacitor) — Capacitor 8 + ExoPlayerService (MediaSession) + InnerTubePlugin; Direct native path on Android.
- [Native Hardening](mem://technical/native-performance-hardening) — WiFi/WakeLocks, parallel resolution racing, connection pre-warming, and Bluetooth resume.
- [Personalization Engine](mem://features/feed-personalization-engine) — 30-day TasteProfile re-ranking of editorial rails.
- [Artist Verification](mem://features/artist-verification) — MediaPipe liveness, music platform links, and zero-retention government ID policy.
- [Country and Phone Support](mem://features/country-and-phone-support) — Searchable ISO-3166-1 country/dial-code picker for artist signup.
- [Content Sourcing v2](mem://technical/youtube-extraction-logic) — On-device resolution racing 3 clients; Rhino-based signature/n-param deciphering; 'Song' priority.
- [Discovery Tools](mem://features/discovery-tools) — Innertube-powered Radio and Autocomplete suggestions.
- [Access Hardening](mem://security/access-hardening) — Profile status protection; authenticated-only stream URLs; worker CSP fixes.
- [Emotion Lyrics](mem://features/emotion-reactive-lyrics) — Keyword emotion per lyric line driving a canvas particle/wave visualizer behind synced lyrics.
- [Download System](mem://features/download-system) — IndexedDB offline caching; free for all users.
- [Advanced Audio](mem://features/advanced-audio-settings) — Native Android AudioEffect EQ + WebAudio fallback for web.
- [Security Hardening](mem://security/hardening-model) — JWT validation, secure RPCs, promo code UI removed.
- [Global Charts](mem://features/global-charts-system) — Auto-aggregated trending/viral charts from Apple, iTunes, Last.fm, Deezer.
- [Cross-Device Resume](mem://features/cross-device-resume) — playback_state table syncs song/queue/position for multi-device resume.
- [Performance Optimization](mem://technical/performance-state-management) — playerProgressStore pattern decouples high-frequency updates.
- [Theme Engine](mem://style/theme-engine) — Obsidian (default), Pearl (light), Onyx (OLED), Sunset, Aurora, Midnight Gold.
- [Project Documentation](mem://technical/project-documentation) — MIT License, Security policy, and REBUILD_PROMPT spec.
- [Build Environment](mem://technical/android-build-environment) — JVM Target 21, App ID 'com.universeflow.app', and self-healing Google Services logic.
