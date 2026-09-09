/**
 * Native offline audio files.
 *
 * Downloads are stored as Blobs in IndexedDB, which works on the web because a
 * `blob:` URL can feed the WebView `<audio>` element. On Android the audible
 * player is ExoPlayer, which runs OUTSIDE the WebView and cannot open a
 * `blob:` URL at all — that is why downloaded songs looked saved but played
 * nothing in the APK.
 *
 * So on native we ALSO write a real file into the app's private data directory
 * and hand ExoPlayer that `file://` path. Web behaviour is untouched.
 */
import { isNativePlayerAvailable } from '@/lib/nativePlayer';

const DIR = 'uf-offline';

const extensionFor = (type?: string): string => {
  const t = (type || '').toLowerCase();
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'm4a';
  if (t.includes('webm')) return 'webm';
  if (t.includes('ogg') || t.includes('opus')) return 'ogg';
  if (t.includes('wav')) return 'wav';
  if (t.includes('flac')) return 'flac';
  return 'mp3';
};

const safeName = (id: string) => id.replace(/[^a-zA-Z0-9._-]/g, '_');

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });

/**
 * Persist a downloaded audio blob as a real device file.
 * Returns a `file://` URI ExoPlayer can play offline, or null on web/failure.
 */
export async function saveOfflineAudioFile(id: string, blob: Blob): Promise<string | null> {
  if (!isNativePlayerAvailable()) return null;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const path = `${DIR}/${safeName(id)}.${extensionFor(blob.type)}`;
    try {
      await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true });
    } catch { /* already exists */ }
    await Filesystem.writeFile({
      path,
      directory: Directory.Data,
      data: await blobToBase64(blob),
      recursive: true,
    });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
    return uri?.startsWith('file://') ? uri : uri ? `file://${uri}` : null;
  } catch (error) {
    console.warn('[offline] native file write failed', (error as Error)?.message);
    return null;
  }
}

/** Confirm a previously stored native file still exists before playing it. */
export async function offlineAudioFileExists(uri?: string | null): Promise<boolean> {
  if (!uri || !isNativePlayerAvailable()) return false;
  try {
    const { Filesystem } = await import('@capacitor/filesystem');
    await Filesystem.stat({ path: uri });
    return true;
  } catch {
    return false;
  }
}

/** Remove the native copy for a download (best effort). */
export async function deleteOfflineAudioFile(uri?: string | null): Promise<void> {
  if (!uri || !isNativePlayerAvailable()) return;
  try {
    const { Filesystem } = await import('@capacitor/filesystem');
    await Filesystem.deleteFile({ path: uri });
  } catch { /* nothing to clean up */ }
}
