# Roadmap

- [x] APK background recovery: bounded repeated stream restarts, reduced neutral PCM maths, aligned startup buffer; 21 JVM audio/state tests and 154 web tests passed.
- [ ] Verify this background fix in a freshly built APK while switching apps; blocked on full Android CI build and physical-phone testing (service/plugin not compiled locally, room-builder thread requires Android).
- [ ] Restore delivery of current playback fixes to the APK build repository: checked 2026-11-14 17:18 UTC, GitHub main/latest successful APK still uses the 14:59 account/search commit and lacks PlaybackRetryBudget; requires Project settings → Git status/re-check (agent cannot operate sync settings). User confirms glitches affect streams, not downloads.

- [x] Connect GitHub API and Google Search Console after the latest workspace move (17:08 request; both verified).

- [x] Fix stale favorites, followed artists, and typing suggestions; 154 tests passed and signed-in search checked on mobile viewport.

- [x] Reconnect GitHub API and Google Search Console (another workspace move; both verified)
- [x] Unavailable songs: fixed false skips (longer start time, real retry, no cross-song client benching); needs fresh APK test
- [ ] Dead Studio Spaces on phone: code path looks correct and premium is active; needs on-phone check of whether EQ/bass work too

- [x] Connect GitHub API in the latest workspace (account read verified)
- [x] Connect Google Search Console in the latest workspace (verified sites listed)

- [x] APK app-switch stability and clean sound: corrected overlap/focus, recovery, lock renewal and native gain processing; native sound tests pass, phone listening still needs a fresh APK.

- [ ] Studio Spaces rebuilt as convolution with physically modelled rooms (measured -4..-9 dB room level on music vs old -10..-22 dB; 126 tests pass, demos rendered; needs fresh APK on a phone)
- [x] Connect GitHub API (workspace moved again, account read verified)
- [x] Connect Google Search Console (workspace moved again, sites listed)

- [x] Automatic Premium activation and expiry messages (activation, 3-day, 1-day and expired notices; delivery needs real event/device testing)
- [x] Account deletion reason/review/confirmation steps and admin request list (signed-in screens checked without submitting a destructive request)
- [ ] Account deletion confirmation email (sender setup required)
- [x] Connect GitHub API in the newly moved workspace (account read verified)
- [x] Connect Google Search Console in the newly moved workspace (verified properties read)

- [x] Advanced admin panel: user detail drawer, Content Control page, System Health live error feed
- [x] Fix offline player: player now prefers the downloaded local copy before any network resolve (needs fresh APK to verify on phone)
- [x] Merge GitHub PR #2 (Lovable sync) — sitemap conflict resolved, PR merged into main
- [x] Re-link GitHub API + Google Search Console connectors (new workspace)

- [x] Reconnect GitHub API and Search Console in new workspace
- [x] AI Command Center in admin
- [x] Connect GitHub API
- [x] Connect Google Search Console
- [x] Studio Spaces: every space must sound distinct and real (stadium/concert/etc.) — native room engine rebuilt (needs fresh APK on a phone)
- [x] Re-link GitHub API + Google Search Console in this workspace (new move)
- [x] Deliver background-playback changes to GitHub (pushed via API, APK build succeeded; phone test pending)

- [x] Link GitHub API and Google Search Console in the new workspace

- [x] Link GitHub API and Google Search Console in the new workspace (again)
- [x] Fix EQ: 1:1 slider mapping, matched high bands, bass-safe limiter (web tests pass; native compile + phone listening pending)

- [x] Reconnect GitHub API and Google Search Console after workspace move
