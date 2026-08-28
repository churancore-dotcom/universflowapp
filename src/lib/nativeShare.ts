/**
 * Image sharing / saving that actually works inside the Android APK.
 *
 * On native we write the PNG into app cache and hand the file URI to the
 * system share sheet, so Instagram / WhatsApp receive a real IMAGE (not a
 * link). On web we prefer the Web Share API with a File, then fall back to a
 * plain download.
 */
import { Capacitor } from '@capacitor/core';

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const safeName = (name: string) =>
  `${name.replace(/[^a-z0-9\-_ ]/gi, '').trim().slice(0, 60) || 'universflow'}.png`;

const dataUrlToBase64 = (dataUrl: string) => dataUrl.split(',')[1] ?? '';

const dataUrlToBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob();

/** Persist the card to the device so the user keeps it in their gallery/files. */
export async function saveImageToDevice(dataUrl: string, name: string): Promise<'saved' | 'downloaded'> {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path: safeName(name),
      data: dataUrlToBase64(dataUrl),
      directory: Directory.Documents,
      recursive: true,
    });
    return 'saved';
  }
  const blob = await dataUrlToBlob(dataUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

/**
 * Open the system share sheet with the generated card as an image file.
 * Returns false when no image-capable share path exists (caller can fall back).
 */
export async function shareImage(
  dataUrl: string,
  name: string,
  text: string,
): Promise<boolean> {
  if (isNative()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const path = safeName(name);
      await Filesystem.writeFile({
        path,
        data: dataUrlToBase64(dataUrl),
        directory: Directory.Cache,
        recursive: true,
      });
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
      await Share.share({ text, files: [uri], dialogTitle: 'Share this track' });
      return true;
    } catch {
      return false;
    }
  }

  try {
    const blob = await dataUrlToBlob(dataUrl);
    const file = new File([blob], safeName(name), { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ text, files: [file] });
      return true;
    }
  } catch {
    /* user dismissed or unsupported */
  }
  return false;
}
