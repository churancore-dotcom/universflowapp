// On-device YouTube Music "New releases" shelf (APK only).
//
// YouTube picks the release shelf from the caller's network location and
// ignores `gl` for anonymous requests. Our server sits in one country, so a
// server fetch gave every listener the same foreign list. Clients like Echo
// Music call InnerTube from the phone itself, so YouTube sees the listener's
// own network and returns their country's shelf. We do the same here through
// Capacitor's native HTTP (no CORS, phone's own IP). Shelf order is kept and
// every track must have a verified recent upload date, or it is dropped.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { IndexedTrack } from '@/lib/musicIndexer';

const BROWSE_URL = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false';
const PLAYER_URL = 'https://music.youtube.com/youtubei/v1/player?prettyPrint=false';
const CLIENT_VERSION = '1.20241218.01.00';
export const NEW_RELEASE_MAX_AGE_DAYS = 35;

export interface ReleaseCard {
  browseId: string;
  title: string;
  artist: string;
  cover?: string;
  type: 'single' | 'ep' | 'album';
}

const runsText = (r: any): string =>
  Array.isArray(r?.runs) ? r.runs.map((x: any) => x?.text || '').join('') : typeof r === 'string' ? r : '';

function* walk(node: any, key: string): Generator<any> {
  if (!node || typeof node !== 'object') return;
  if (node[key]) yield node[key];
  for (const v of Object.values(node)) if (v && typeof v === 'object') yield* walk(v, key);
}

const bestThumb = (thumbs: any[] | undefined): string | undefined => {
  if (!Array.isArray(thumbs) || !thumbs.length) return undefined;
  const url = [...thumbs].sort((a, b) => (b?.width || 0) - (a?.width || 0))[0]?.url;
  return typeof url === 'string' ? url.replace(/=w\d+-h\d+/, '=w544-h544') : undefined;
};

/** Parse the release tiles (singles/EPs/albums) from a new-releases browse response. */
export function parseReleaseCards(json: unknown): ReleaseCard[] {
  const out: ReleaseCard[] = [];
  const seen = new Set<string>();
  for (const item of walk(json, 'musicTwoRowItemRenderer')) {
    const title = runsText(item?.title).trim();
    const subtitle = runsText(item?.subtitle).trim();
    const browseId: string = item?.navigationEndpoint?.browseEndpoint?.browseId || '';
    if (!title || !browseId.startsWith('MPRE') || seen.has(browseId)) continue;
    // The subtitle is "<Type> • <Artist>", localized; the type word comes first.
    const [typeWord = '', ...rest] = subtitle.split('•').map((s) => s.trim());
    const artist = rest.join(' • ').trim();
    if (!artist || /youtube music/i.test(artist)) continue;
    const t = typeWord.toLowerCase();
    const type: ReleaseCard['type'] = /^ep$/.test(t) ? 'ep' : /album|álbum|アルバム|albüm/.test(t) ? 'album' : 'single';
    seen.add(browseId);
    out.push({
      browseId,
      title,
      artist,
      type,
      cover: bestThumb(item?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails),
    });
  }
  return out;
}

/** First playable track(s) of a release page. */
export function parseReleaseTracks(json: unknown, card: ReleaseCard): IndexedTrack[] {
  const out: IndexedTrack[] = [];
  for (const item of walk(json, 'musicResponsiveListItemRenderer')) {
    const col0 = item?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
    const videoId: string | undefined =
      item?.playlistItemData?.videoId ||
      col0?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId ||
      item?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    const title = runsText(col0).trim();
    if (!videoId || !title) continue;
    out.push({
      id: `ytm-${videoId}`,
      videoId,
      title,
      artist: card.artist,
      album: card.type === 'single' ? undefined : card.title,
      audio_url: `yt-video:${videoId}`,
      cover_url: card.cover,
      kind: 'song',
    });
    if (card.type === 'single' || out.length >= 2) break;
  }
  return out;
}

/** Verified freshness: only a real upload date inside the window counts. */
export function isFreshUpload(uploadDate: string | undefined | null, now = Date.now()): boolean {
  if (!uploadDate) return false;
  const t = Date.parse(uploadDate);
  if (!Number.isFinite(t)) return false;
  return t >= now - NEW_RELEASE_MAX_AGE_DAYS * 86400000 && t <= now + 86400000;
}

const context = (gl: string) => ({
  client: { clientName: 'WEB_REMIX', clientVersion: CLIENT_VERSION, hl: 'en', gl },
});

async function post(url: string, data: Record<string, unknown>): Promise<any | null> {
  try {
    const res = await CapacitorHttp.post({
      url,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://music.youtube.com',
        Referer: 'https://music.youtube.com/',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
        'X-Youtube-Client-Name': '67',
        'X-Youtube-Client-Version': CLIENT_VERSION,
      },
      data,
      connectTimeout: 7000,
      readTimeout: 7000,
    });
    if (res.status < 200 || res.status >= 300) return null;
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  } catch {
    return null;
  }
}

export const isDeviceReleaseShelfAvailable = (): boolean =>
  Capacitor.isNativePlatform() && typeof CapacitorHttp?.post === 'function';

export async function getDeviceNewReleases(country: string, limit: number): Promise<IndexedTrack[]> {
  if (!isDeviceReleaseShelfAvailable()) return [];
  const gl = /^[A-Z]{2}$/.test(country) ? country : 'US';
  const shelf = await post(BROWSE_URL, { context: context(gl), browseId: 'FEmusic_new_releases_albums' });
  if (!shelf) return [];
  // Singles first (one song each), keeping YouTube's order inside each group.
  const cards = parseReleaseCards(shelf)
    .sort((a, b) => (a.type === 'single' ? 0 : 1) - (b.type === 'single' ? 0 : 1))
    .slice(0, Math.min(40, limit + 10));
  const tracks = (await Promise.all(cards.map(async (card) => {
    const page = await post(BROWSE_URL, { context: context(gl), browseId: card.browseId });
    return page ? parseReleaseTracks(page, card) : [];
  }))).flat();
  const dated = await Promise.all(tracks.map(async (t) => {
    const player = await post(PLAYER_URL, { context: context(gl), videoId: t.videoId });
    const mf = player?.microformat?.playerMicroformatRenderer;
    return isFreshUpload(mf?.uploadDate || mf?.publishDate) ? t : null;
  }));
  const seen = new Set<string>();
  const out: IndexedTrack[] = [];
  for (const t of dated) {
    if (!t?.videoId || seen.has(t.videoId)) continue;
    seen.add(t.videoId);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}
