# Make YouTube play reliably in the phone app (Echo Music approach)

## Why it keeps breaking
The phone app already asks YouTube for songs directly from the phone, but it uses our own copy of the unlocking logic. YouTube changes its lock every few weeks and our copy breaks until someone patches it by hand. Echo Music, InnerTune and ViMusic stay working because they use **NewPipe Extractor**, a free open-source library whose team fixes YouTube breaks within days. Echo Music also updates the app often. A "100%" guarantee doesn't exist, but this is how those apps stay close to it.

## What changes
1. **Add NewPipe Extractor as the first YouTube route on the phone.** It finds the best audio stream for a song and hands it to the player.
2. **Keep the current routes as backups.** If NewPipe fails, the order is: our own resolver, then the signed-in YouTube account, then JioSaavn. The music doesn't stop.
3. **Better handling for songs that fail:** a song that fails once is retried on the next route right away. Links are refreshed before they expire, so long queues and saved moments don't stall.
4. **Update check:** Settings shows "New version available" when a newer app build exists. Users then get YouTube fixes quickly, just like Echo Music users do.
5. **Honest status:** for each song, Up Next shows where it's playing from (YouTube or JioSaavn).

## What you need to do
- Build a fresh app file from GitHub Actions after this change. It can't be built or tested inside this preview.
- When YouTube breaks again, ask me to "update NewPipe". It's usually a one-line version bump.

## Licence note
NewPipe Extractor is GPL-3. Your app is MIT, so the phone app's source must stay public under GPL-3-compatible terms. Your app is already open source, so this is fine, but the licence file will mention it.

## Technical details
- `android/app/build.gradle`: add the JitPack repository and `com.github.TeamNewPipe:NewPipeExtractor:<latest>`. Enable `coreLibraryDesugaring` (the library needs java.time on older Android versions).
- New `NewPipeResolver.kt`: `NewPipe.init(OkHttpDownloader)` → `StreamInfo.getInfo(ServiceList.YouTube, url)` → choose the highest-bitrate `audioStreams` entry (prefer opus/m4a). Cache it until the `expire` param minus 5 minutes.
- `MasterResolver.kt`: insert NewPipe as race leg 0 with a 5 s budget. Existing `NativeYouTubeResolver` and the JioSaavn legs stay as they are.
- Record per-route hit/miss in the existing resolver diagnostics, so Resolver Health shows the NewPipe success rate.
- Update check: compare `APP_RELEASE.versionCode` with the latest GitHub release tag.

## Ideas for later (pick any)
- **Song Stories:** a shareable 15-second card with the lyric line and your Stem Lab mix, which works as free promotion.
- **Listen Together:** a link that syncs playback with a friend in real time.
- **Smart Offline:** automatically keeps your top 50 songs downloaded on Wi-Fi.
- **Lyrics translation:** translated lines under the original, for Hindi, Punjabi and K-pop.
