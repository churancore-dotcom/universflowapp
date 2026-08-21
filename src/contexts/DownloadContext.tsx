import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Song } from './PlayerContext';
import { toast } from 'sonner';
import { canDownloadSong, getDownloadUnavailableMessage } from '@/lib/songSupport';
import { resolveIndexedTrack } from '@/lib/musicIndexer';
import { getRuntimePremium } from '@/lib/premiumState';
import { supabase } from '@/integrations/supabase/client';
import { isNativePlayerAvailable, resolveNativeMetadataStream } from '@/lib/nativePlayer';
import { retry } from '@/utils/retry';


// Build a proxy URL for cross-origin streams that fail direct fetch.
// Uses the same music-indexer audio proxy that the player uses.
const buildDownloadProxyUrl = (sourceUrl: string): string | null => {
  try {
    if (!sourceUrl?.startsWith('http')) return null;
    const projectUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!projectUrl) return null;
    if (sourceUrl.includes('/functions/v1/music-indexer?audio=')) return null;
    const parsed = new URL(sourceUrl);
    if (parsed.origin === window.location.origin) return null;
    return `${projectUrl}/functions/v1/music-indexer?audio=${encodeURIComponent(sourceUrl)}`;
  } catch { return null; }
};

// Try direct fetch first, fall back to proxy on CORS / network failure so
// every track with an audio URL can actually be downloaded.
// Ported from Musify's download service: a single failed request must not kill
// the download — mobile networks drop requests constantly. Retry with backoff,
// but only for transient failures (never for 4xx, which will never succeed).
const robustFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const attempt = async (): Promise<Response> => {
    try {
      const direct = await fetch(url, init);
      if (direct.ok) return direct;
      throw new Error(`HTTP ${direct.status}`);
    } catch (directErr) {
      const proxyUrl = buildDownloadProxyUrl(url);
      if (!proxyUrl) throw directErr;
      const proxied = await fetch(proxyUrl, { ...init, mode: 'cors', credentials: 'omit' });
      if (!proxied.ok) throw new Error(`Proxy HTTP ${proxied.status}`);
      return proxied;
    }
  };
  return retry(attempt, {
    retries: 2,
    baseDelayMs: 600,
    shouldRetry: (err) => {
      if ((err as DOMException)?.name === 'AbortError') return false;
      const msg = String((err as Error)?.message || '');
      const status = Number(msg.match(/HTTP (\d{3})/)?.[1] || 0);
      return !(status >= 400 && status < 500);
    },
  });
};


const getSongVideoId = (song: Song): string | undefined => {
  const raw = song.audio_url || '';
  if (raw.startsWith('yt-video:')) {
    const id = raw.replace('yt-video:', '').trim();
    if (id.length === 11) return id;
  }
  for (const prefix of ['ytm-', 'yt-', 'youtube-']) {
    if (song.id?.startsWith(prefix)) {
      const id = song.id.slice(prefix.length);
      if (id.length === 11) return id;
    }
  }
  return undefined;
};

const nativeFetchBlob = async (url: string): Promise<Blob | null> => {
  if (!isNativePlayerAvailable()) return null;
  try {
    const { CapacitorHttp } = await import('@capacitor/core');
    const res = await CapacitorHttp.get({
      url,
      responseType: 'arraybuffer' as never,
      connectTimeout: 15000,
      readTimeout: 45000,
    } as never);
    if (res.status < 200 || res.status >= 300 || res.data == null) return null;
    const contentType = String(res.headers?.['content-type'] || res.headers?.['Content-Type'] || 'audio/mpeg');
    const data = res.data as unknown;
    if (data instanceof ArrayBuffer) return new Blob([data], { type: contentType });
    if (data instanceof Blob) return data;
    if (typeof data === 'string') {
      if (data.startsWith('data:')) return await fetch(data).then((r) => r.blob());
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: contentType });
    }
  } catch { /* fall through */ }
  return null;
};

const resolveDownloadableSong = async (song: Song): Promise<Song> => {
  const audioUrl = song.audio_url?.trim();
  const needsResolve = !audioUrl || audioUrl === 'pending' || audioUrl === 'resolving' || audioUrl.startsWith('yt-video:');
  if (!needsResolve && audioUrl.startsWith('http')) return song;

  // Downloads honour the *download* quality tier, which is independent of the
  // streaming tier (defaults to Ultra). Ask the catalogue for the variant that
  // matches the user's chosen bitrate before falling back to generic resolvers.
  try {
    const [{ findSongStreamUrl }, { getDownloadBitrateCap }] = await Promise.all([
      import('@/lib/jiosaavn'),
      import('@/lib/userPrefs'),
    ]);
    const match = await findSongStreamUrl(song.title, song.artist, {
      forceRefresh: true,
      bitrateCap: getDownloadBitrateCap(),
    });
    if (match?.streamUrl?.startsWith('http')) {
      return { ...song, audio_url: match.streamUrl };
    }
  } catch { /* fall through to generic resolvers */ }

  if (isNativePlayerAvailable()) {

    const nativeUrl = await resolveNativeMetadataStream({
      videoId: getSongVideoId(song),
      title: song.title,
      artist: song.artist,
    }).catch(() => null);
    if (nativeUrl?.startsWith('http')) {
      return { ...song, audio_url: nativeUrl };
    }
  }

  const resolved = await resolveIndexedTrack(song.artist, song.title, { forceRefresh: needsResolve }).catch(() => null);
  if (resolved?.streamUrl) {
    return {
      ...song,
      audio_url: resolved.streamUrl,
      cover_url: song.cover_url || resolved.cover_url || undefined,
      duration: song.duration || resolved.duration || undefined,
    };
  }
  return song;
};

interface DownloadedSong extends Song {
  downloadedAt: string;
  blobUrl: string;
  size: number;
}

interface DownloadProgress {
  songId: string;
  progress: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
}

export interface QueuedSong extends Song {
  queuedAt: string;
  position: number;
}

interface DownloadContextType {
  downloads: DownloadedSong[];
  downloadProgress: Record<string, DownloadProgress>;
  downloadQueue: QueuedSong[];
  currentDownloadId: string | null;
  downloadSong: (song: Song) => Promise<void>;
  cancelDownload: (songId: string) => void;
  addToQueue: (songs: Song[]) => void;
  removeFromQueue: (songId: string) => void;
  clearQueue: () => void;
  removeSong: (songId: string) => void;
  isDownloaded: (songId: string) => boolean;
  isInQueue: (songId: string) => boolean;
  getDownloadedUrl: (songId: string) => string | null;
  totalStorageUsed: number;
  clearAllDownloads: () => void;
  isIndexedDBSupported: boolean;
  isProcessingQueue: boolean;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

const requirePremiumDownload = (): boolean => {
  if (getRuntimePremium()) return true;
  toast.error('Downloads are a Premium feature');
  return false;
};

const DB_NAME = 'MusicAppOffline';
const STORE_NAME = 'songs';

// Check if IndexedDB is supported (not available in some WebViews)
const checkIndexedDBSupport = (): boolean => {
  try {
    if (typeof indexedDB === 'undefined') return false;
    // Test if we can actually use it
    const testRequest = indexedDB.open('test_db_support', 1);
    testRequest.onerror = () => {};
    testRequest.onsuccess = () => {
      testRequest.result.close();
      indexedDB.deleteDatabase('test_db_support');
    };
    return true;
  } catch {
    return false;
  }
};

// IndexedDB helper functions with error handling
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      
      const request = indexedDB.open(DB_NAME, 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    } catch (error: any) {
      reject(error);
    }
  });
};

const saveToDB = async (song: DownloadedSong, audioBlob: Blob, coverBlob?: Blob | null): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const songData = {
        ...song,
        audioBlob,
        coverBlob: coverBlob ?? null,
      };
      
      const request = store.put(songData);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error: any) {
    console.warn('Failed to save to IndexedDB:', error);
    throw error;
  }
};

const getFromDB = async (id: string): Promise<{ song: DownloadedSong; audioBlob: Blob; coverBlob?: Blob | null } | null> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (request.result) {
          const { audioBlob, coverBlob, ...song } = request.result;
          resolve({ song, audioBlob, coverBlob });
        } else {
          resolve(null);
        }
      };
    });
  } catch (error: any) {
    console.warn('Failed to get from IndexedDB:', error);
    return null;
  }
};

const deleteFromDB = async (id: string): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error: any) {
    console.warn('Failed to delete from IndexedDB:', error);
  }
};

const getAllFromDB = async (): Promise<{ song: DownloadedSong; audioBlob: Blob; coverBlob?: Blob | null }[]> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const results = request.result.map((item: DownloadedSong & { audioBlob: Blob; coverBlob?: Blob }) => {
          const { audioBlob, coverBlob, ...song } = item;
          return { song: song as DownloadedSong, audioBlob, coverBlob };
        });
        resolve(results);
      };
    });
  } catch (error: any) {
    console.warn('Failed to get all from IndexedDB:', error);
    return [];
  }
};

const clearDB = async (): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error: any) {
    console.warn('Failed to clear IndexedDB:', error);
  }
};

export const DownloadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [downloads, setDownloads] = useState<DownloadedSong[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>({});
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [isIndexedDBSupported, setIsIndexedDBSupported] = useState(true);
  const [downloadQueue, setDownloadQueue] = useState<QueuedSong[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [currentDownloadId, setCurrentDownloadId] = useState<string | null>(null);
  const processingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledIdsRef = useRef<Set<string>>(new Set());

  // Load downloads from IndexedDB on mount
  useEffect(() => {
    const loadDownloads = async () => {
      // Check IndexedDB support first
      const supported = checkIndexedDBSupport();
      setIsIndexedDBSupported(supported);
      
      if (!supported) {
        console.warn('IndexedDB not supported in this environment');
        return;
      }

      try {
        const storedSongs = await getAllFromDB();
        const songs: DownloadedSong[] = [];
        const urls: Record<string, string> = {};
        
        for (const { song, audioBlob, coverBlob } of storedSongs) {
          try {
            const blobUrl = URL.createObjectURL(audioBlob);
            const coverBlobUrl = coverBlob ? URL.createObjectURL(coverBlob) : null;
            urls[song.id] = blobUrl;
            songs.push({ ...song, blobUrl, cover_url: coverBlobUrl || song.cover_url });
          } catch (e) {
            console.warn('Failed to create blob URL for song:', song.id);
          }
        }
        
        setDownloads(songs);
        setBlobUrls(urls);
      } catch (error: any) {
        console.warn('Failed to load downloads:', error);
      }
    };
    
    loadDownloads();
    
    // Cleanup blob URLs on unmount
    return () => {
      Object.values(blobUrls).forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          // Ignore errors during cleanup
        }
      });
    };
  }, []);

  const downloadSong = useCallback(async (song: Song) => {
    if (!requirePremiumDownload()) return;

    // Wi-Fi-only guard — uses Capacitor Network on native, navigator.connection on web.
    try {
      const { isDownloadAllowedNow } = await import('@/lib/userPrefs');
      const check = await isDownloadAllowedNow();
      if (!check.allowed) {
        toast.error(check.reason || 'Wi-Fi only downloads are on.');
        return;
      }
    } catch { /* ignore */ }

    if (!canDownloadSong(song)) {
      toast.error(getDownloadUnavailableMessage(song));
      return;
    }

    if (!isIndexedDBSupported) {
      console.warn('Downloads not available - IndexedDB not supported');
      toast.error('Downloads are not available on this device');
      return;
    }


    // Check if already downloaded
    if (downloads.some(d => d.id === song.id)) {
      return;
    }

    // Initialize progress
    setDownloadProgress(prev => ({
      ...prev,
      [song.id]: { songId: song.id, progress: 0, status: 'pending' }
    }));
    setCurrentDownloadId(song.id);
    cancelledIdsRef.current.delete(song.id);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Start download
      setDownloadProgress(prev => ({
        ...prev,
        [song.id]: { songId: song.id, progress: 5, status: 'downloading' }
      }));

      const downloadableSong = await resolveDownloadableSong(song);
      if (!downloadableSong.audio_url || !downloadableSong.audio_url.startsWith('http')) {
        throw new Error('No downloadable stream available');
      }

      let blob: Blob | null = null;
      try {
        const response = await robustFetch(downloadableSong.audio_url, {
          mode: 'cors',
          credentials: 'omit',
          signal: controller.signal,
        });
        
        if (!response.ok) {
          throw new Error('Failed to download');
        }

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader available');

        const chunks: ArrayBuffer[] = [];
        let received = 0;

        while (true) {
          if (controller.signal.aborted) {
            try { reader.cancel(); } catch {}
            throw new DOMException('Aborted', 'AbortError');
          }
          const { done, value } = await reader.read();

          if (done) break;

          // Copy to regular ArrayBuffer for blob compatibility
          chunks.push(value.buffer.slice(0) as ArrayBuffer);
          received += value.length;

          const progress = total > 0 ? Math.round((received / total) * 100) : 50;

          setDownloadProgress(prev => ({
            ...prev,
            [song.id]: { songId: song.id, progress: Math.min(progress, 95), status: 'downloading' }
          }));
        }

        // Keep the upstream container type. Saving an m4a/webm stream as
        // "audio/mpeg" makes some browsers refuse to decode it offline — the
        // download looked fine and then played silence.
        const upstreamType = (response.headers.get('content-type') || '').split(';')[0].trim();
        const blobType = /^audio\/|^video\/mp4$/.test(upstreamType) ? upstreamType : 'audio/mpeg';
        blob = new Blob(chunks, { type: blobType });

      } catch (fetchError) {
        if (controller.signal.aborted) throw fetchError;
        blob = await nativeFetchBlob(downloadableSong.audio_url);
        if (!blob) throw fetchError;
        setDownloadProgress(prev => ({
          ...prev,
          [song.id]: { songId: song.id, progress: 90, status: 'downloading' }
        }));
      }
      const blobUrl = URL.createObjectURL(blob);
      let coverBlob: Blob | null = null;
      let offlineCoverUrl = downloadableSong.cover_url;

      if (downloadableSong.cover_url && /^https?:\/\//i.test(downloadableSong.cover_url)) {
        try {
          const coverResponse = await robustFetch(downloadableSong.cover_url, { mode: 'cors', credentials: 'omit' });
          if (coverResponse.ok) {
            coverBlob = await coverResponse.blob();
            offlineCoverUrl = URL.createObjectURL(coverBlob);
          }
        } catch {
          // Cover caching is best effort; audio download must still succeed.
        }
      }

      const downloadedSong: DownloadedSong = {
        ...downloadableSong,
        cover_url: offlineCoverUrl,
        downloadedAt: new Date().toISOString(),
        blobUrl,
        size: blob.size,
      };

      // Save to IndexedDB
      await saveToDB({ ...downloadedSong, cover_url: downloadableSong.cover_url }, blob, coverBlob);

      // Update state
      setDownloads(prev => [...prev, downloadedSong]);
      setBlobUrls(prev => ({ ...prev, [song.id]: blobUrl }));

      setDownloadProgress(prev => ({
        ...prev,
        [song.id]: { songId: song.id, progress: 100, status: 'completed' }
      }));

      // Bump artist_songs.download_count for artist tracks so the artist
      // dashboard reflects real downloads live. RPC no-ops for non-artist ids.
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(song.id)) {
        supabase.rpc('increment_artist_song_download', { _song_id: song.id })
          .then(() => {}, () => {});
      }


      // Remove from progress after animation
      setTimeout(() => {
        setDownloadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[song.id];
          return newProgress;
        });
      }, 2000);

    } catch (error: any) {
      const wasCancelled = error?.name === 'AbortError' || cancelledIdsRef.current.has(song.id);
      if (wasCancelled) {
        toast.info('Download cancelled');
      } else {
        console.error('Download failed:', error);
        toast.error(getDownloadUnavailableMessage(song));
      }
      setDownloadProgress(prev => ({
        ...prev,
        [song.id]: { songId: song.id, progress: 0, status: 'error' }
      }));

      setTimeout(() => {
        setDownloadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[song.id];
          return newProgress;
        });
      }, wasCancelled ? 400 : 3000);
    } finally {
      cancelledIdsRef.current.delete(song.id);
      if (abortRef.current === controller) abortRef.current = null;
      setCurrentDownloadId(prev => (prev === song.id ? null : prev));
    }
  }, [downloads, isIndexedDBSupported]);

  const cancelDownload = useCallback((songId: string) => {
    // If song is in queue but not yet downloading, just drop it
    setDownloadQueue(prev => prev.filter(q => q.id !== songId));
    if (currentDownloadId === songId && abortRef.current) {
      cancelledIdsRef.current.add(songId);
      try { abortRef.current.abort(); } catch {}
    }
  }, [currentDownloadId]);

  const removeSong = useCallback(async (songId: string) => {
    try {
      await deleteFromDB(songId);
      
      // Revoke blob URL
      if (blobUrls[songId]) {
        try {
          URL.revokeObjectURL(blobUrls[songId]);
        } catch (e) {
          // Ignore errors
        }
      }
      
      setDownloads(prev => prev.filter(d => d.id !== songId));
      setBlobUrls(prev => {
        const newUrls = { ...prev };
        delete newUrls[songId];
        return newUrls;
      });
    } catch (error: any) {
      console.error('Failed to remove song:', error);
      toast.error('Could not remove this download. Please try again.');
    }
  }, [blobUrls]);

  const isDownloaded = useCallback((songId: string) => {
    return downloads.some(d => d.id === songId);
  }, [downloads]);

  const isInQueue = useCallback((songId: string) => {
    return downloadQueue.some(q => q.id === songId);
  }, [downloadQueue]);

  const getDownloadedUrl = useCallback((songId: string) => {
    return blobUrls[songId] || null;
  }, [blobUrls]);

  const totalStorageUsed = downloads.reduce((acc, song) => acc + song.size, 0);

  const clearAllDownloads = useCallback(async () => {
    try {
      await clearDB();
      Object.values(blobUrls).forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          // Ignore errors
        }
      });
      setDownloads([]);
      setBlobUrls({});
    } catch (error: any) {
      console.error('Failed to clear downloads:', error);
      toast.error('Could not clear your downloads. Please try again.');
    }
  }, [blobUrls]);

  // Queue management functions
  const addToQueue = useCallback((songs: Song[]) => {
    if (!requirePremiumDownload()) return;

    const newQueueItems: QueuedSong[] = songs
      .filter(song => !isDownloaded(song.id) && !isInQueue(song.id))
      .map((song, index) => ({
        ...song,
        queuedAt: new Date().toISOString(),
        position: downloadQueue.length + index,
      }));
    
    if (newQueueItems.length > 0) {
      setDownloadQueue(prev => [...prev, ...newQueueItems]);
    }
  }, [downloadQueue.length, isDownloaded, isInQueue]);

  const removeFromQueue = useCallback((songId: string) => {
    setDownloadQueue(prev => prev.filter(q => q.id !== songId));
  }, []);

  const clearQueue = useCallback(() => {
    setDownloadQueue([]);
  }, []);

  // Process queue automatically
  useEffect(() => {
    const processQueue = async () => {
      if (processingRef.current || downloadQueue.length === 0) return;
      
      processingRef.current = true;
      setIsProcessingQueue(true);
      
      const nextSong = downloadQueue[0];
      if (nextSong && !isDownloaded(nextSong.id)) {
        await downloadSong(nextSong);
      }
      
      // Remove from queue after download attempt
      setDownloadQueue(prev => prev.slice(1));
      
      processingRef.current = false;
      setIsProcessingQueue(false);
    };
    
    processQueue();
  }, [downloadQueue, downloadSong, isDownloaded]);

  return (
    <DownloadContext.Provider value={{
      downloads,
      downloadProgress,
      downloadQueue,
      currentDownloadId,
      downloadSong,
      cancelDownload,
      addToQueue,
      removeFromQueue,
      clearQueue,
      removeSong,
      isDownloaded,
      isInQueue,
      getDownloadedUrl,
      totalStorageUsed,
      clearAllDownloads,
      isIndexedDBSupported,
      isProcessingQueue,
    }}>
      {children}
    </DownloadContext.Provider>
  );
};

export const useDownloads = () => {
  const context = useContext(DownloadContext);
  if (context === undefined) {
    throw new Error('useDownloads must be used within a DownloadProvider');
  }
  return context;
};
