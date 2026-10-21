/** Rotation and headphone crossfeed are independent PCM effects, not Virtualizer aliases. */
export function nativeSpatialSettings(settings: { spatialAudio: boolean; headphoneSurround: boolean }) {
  return {
    spatialStrength: settings.spatialAudio ? 1000 : 0,
    surroundStrength: settings.headphoneSurround ? 1000 : 0,
  };
}