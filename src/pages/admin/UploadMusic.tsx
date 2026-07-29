import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Music, Image, X, Check, Loader2, AlertCircle, Link, Globe, Youtube, Disc3, Zap, Shield, Database, ListChecks } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { compressImage, getCompressionStats, formatBytes } from '@/lib/imageCompression';
import { getUploadError } from '@/lib/errorMessages';
import { useFilePreview } from '@/lib/useFilePreview';

const genres = ['Pop', 'Rock', 'Hip Hop', 'R&B', 'Electronic', 'Jazz', 'Classical', 'Country', 'Indie', 'Metal', 'Phonk', 'Lo-Fi', 'Bollywood', 'Punjabi', 'Haryanvi'];
const moods = ['Happy', 'Sad', 'Energetic', 'Calm', 'Romantic', 'Dark', 'Uplifting', 'Chill', 'Slow Reverb', 'Bass Boosted'];

const MAX_AUDIO_SIZE = 100 * 1024 * 1024;
const MAX_COVER_SIZE = 10 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aac', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'];
const ALLOWED_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Platforms that need extraction via backend
const EXTRACTABLE_PLATFORMS = [
  'youtube.com', 'youtu.be', 'soundcloud.com', 'tiktok.com', 
  'twitter.com', 'x.com', 'instagram.com', 'facebook.com', 
  'fb.watch', 'vimeo.com', 'twitch.tv', 'reddit.com', 'bilibili.com'
];

// Extraction stages for visual feedback
type ExtractionStage = 'idle' | 'analyzing' | 'decrypting' | 'syncing' | 'complete' | 'fallback';

interface ValidationError {
  type: 'audio' | 'cover' | 'url';
  message: string;
}

interface AIMetadata {
  title?: string;
  artist?: string;
  genre?: string;
}

const UploadMusic = () => {
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverUrlPreview, setCoverUrlPreview] = useState<string | null>(null);
  const coverFilePreview = useFilePreview(coverFile);
  const coverPreview = coverFilePreview || coverUrlPreview;
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);
  const [isDraggingCover, setIsDraggingCover] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  
  const [audioUrl, setAudioUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [isValidatingUrl, setIsValidatingUrl] = useState(false);
  const [urlValidated, setUrlValidated] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedUrl, setExtractedUrl] = useState<string | null>(null);
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionSaved, setCompressionSaved] = useState<{ savedBytes: number; savedPercent: number } | null>(null);
  
  // New: Multi-stage extraction state
  const [extractionStage, setExtractionStage] = useState<ExtractionStage>('idle');
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [aiMetadata, setAiMetadata] = useState<AIMetadata | null>(null);
  
  const [metadata, setMetadata] = useState({
    title: '',
    artist: '',
    album: '',
    genre: '',
    mood: '',
    bpm: '',
    showInNewReleases: true,
    showInTrending: false,
    isPremiumOnly: false,
  });

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const validateAudioFile = (file: File): string | null => {
    if (!ALLOWED_AUDIO_TYPES.includes(file.type) && !file.name.match(/\.(mp3|wav|flac|aac|ogg|m4a)$/i)) {
      return 'Invalid audio format. Supported: MP3, WAV, FLAC, AAC, OGG, M4A';
    }
    if (file.size > MAX_AUDIO_SIZE) {
      return `Audio file too large. Maximum size: ${formatFileSize(MAX_AUDIO_SIZE)}`;
    }
    return null;
  };

  const validateCoverFile = (file: File): string | null => {
    if (!ALLOWED_COVER_TYPES.includes(file.type)) {
      return 'Invalid image format. Supported: JPG, PNG, WebP, GIF';
    }
    if (file.size > MAX_COVER_SIZE) {
      return `Cover image too large. Maximum size: ${formatFileSize(MAX_COVER_SIZE)}`;
    }
    return null;
  };

  const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      const objectUrl = URL.createObjectURL(file);
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(Math.round(audio.duration));
      };
      audio.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(0);
      };
      audio.src = objectUrl;
    });
  };

  const getAudioDurationFromUrl = (url: string): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.onloadedmetadata = () => resolve(Math.round(audio.duration));
      audio.onerror = () => resolve(0);
      audio.crossOrigin = 'anonymous';
      audio.src = url;
    });
  };

  // Check if URL needs extraction (YouTube, SoundCloud, etc.)
  const needsExtraction = (url: string): boolean => {
    return EXTRACTABLE_PLATFORMS.some(platform => url.toLowerCase().includes(platform));
  };

  // Transform URLs from various platforms to direct playable links
  const transformAudioUrl = (url: string): string => {
    let transformed = url.trim();
    
    // Google Drive: Convert sharing link to direct download
    if (transformed.includes('drive.google.com')) {
      const fileIdMatch = transformed.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        transformed = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
      }
    }
    
    // Dropbox: Change dl=0 to dl=1 for direct download
    if (transformed.includes('dropbox.com')) {
      transformed = transformed.replace('dl=0', 'dl=1').replace('www.dropbox.com', 'dl.dropboxusercontent.com');
    }
    
    // OneDrive: Convert to direct download link
    if (transformed.includes('1drv.ms') || transformed.includes('onedrive.live.com')) {
      transformed = transformed.replace('embed', 'download');
    }
    
    return transformed;
  };

  // Fetch AI metadata from YouTube URL
  const fetchAIMetadata = async (url: string): Promise<AIMetadata | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('ai-metadata', {
        body: { url },
      });

      if (error || !data?.success) {
        console.log('AI metadata fetch failed:', error || data?.error);
        return null;
      }

      return {
        title: data.title || undefined,
        artist: data.artist || undefined,
        genre: data.genre || undefined,
      };
    } catch (err) {
      console.log('AI metadata error:', err);
      return null;
    }
  };

  // Extract audio from platforms like YouTube, SoundCloud, etc.
  const extractAudioFromPlatform = async (url: string): Promise<{ 
    audioUrl: string; 
    platform: string; 
    title?: string;
    artist?: string;
    thumbnail?: string;
    duration?: number;
  } | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('extract-audio', {
        body: { url },
      });

      if (error) {
        console.error('Extraction error:', error);
        throw new Error(error.message || 'Failed to extract audio');
      }

      if (!data.success) {
        throw new Error(data.error || 'Failed to extract audio');
      }

      return {
        audioUrl: data.audioUrl,
        platform: data.platform,
        title: data.title,
        artist: data.artist,
        thumbnail: data.thumbnail,
        duration: data.duration,
      };
    } catch (error: any) {
      console.error('Error extracting audio:', error);
      throw error;
    }
  };

  const validateAudioUrl = async () => {
    if (!audioUrl.trim()) {
      toast.error('Please enter an audio URL');
      return;
    }

    try {
      new URL(audioUrl);
    } catch {
      setValidationErrors(prev => [...prev.filter(e => e.type !== 'url'), { type: 'url', message: 'Invalid URL format' }]);
      toast.error('Invalid URL format');
      return;
    }

    setIsValidatingUrl(true);
    setValidationErrors(prev => prev.filter(e => e.type !== 'url'));
    setExtractedUrl(null);
    setDetectedPlatform(null);
    setExtractionStage('idle');
    setExtractionError(null);
    setAiMetadata(null);

    try {
      // Check if this URL needs extraction (YouTube, SoundCloud, etc.)
      if (needsExtraction(audioUrl)) {
        setIsExtracting(true);
        
        // Stage 1: Analyzing (AI Metadata Pre-fetch)
        setExtractionStage('analyzing');
        
        // Fetch AI metadata in parallel with extraction attempt
        const aiMetadataPromise = fetchAIMetadata(audioUrl);
        
        // Stage 2: Decrypting (Audio Extraction)
        setTimeout(() => setExtractionStage('decrypting'), 1500);
        
        let extractionResult = null;
        let extractionFailed = false;
        
        try {
          extractionResult = await extractAudioFromPlatform(audioUrl);
        } catch (error: any) {
          console.log('Extraction failed, falling back to AI metadata:', error.message);
          extractionFailed = true;
        }
        
        // Get AI metadata result
        const aiResult = await aiMetadataPromise;
        if (aiResult) {
          setAiMetadata(aiResult);
        }
        
        if (extractionResult) {
          // Stage 3: Syncing (Success)
          setExtractionStage('syncing');
          
          setTimeout(() => {
            setExtractionStage('complete');
          }, 800);
          
          setExtractedUrl(extractionResult.audioUrl);
          setDetectedPlatform(extractionResult.platform);
          
          // Use duration from API if available
          if (extractionResult.duration && extractionResult.duration > 0) {
            setAudioDuration(extractionResult.duration);
          } else {
            const duration = await getAudioDurationFromUrl(extractionResult.audioUrl);
            if (duration > 0) {
              setAudioDuration(duration);
            }
          }
          
          // Auto-fill metadata from extracted video info
          if (extractionResult.title && !metadata.title) {
            setMetadata(prev => ({ ...prev, title: prev.title || extractionResult!.title! }));
          }
          if (extractionResult.artist && !metadata.artist) {
            setMetadata(prev => ({ ...prev, artist: prev.artist || extractionResult!.artist! }));
          }
          
          // Set thumbnail as cover URL if available
          if (extractionResult.thumbnail && !coverUrl && !coverFile) {
            setCoverUrl(extractionResult.thumbnail);
            setCoverUrlPreview(extractionResult.thumbnail);
          }
          
          setUrlValidated(true);
          toast.success(`Audio extracted from ${extractionResult.platform}!`);
        } else if (extractionFailed && aiResult) {
          // Graceful fallback with AI metadata
          setExtractionStage('fallback');
          
          // Pre-fill form with AI-generated metadata
          if (aiResult.title && !metadata.title) {
            setMetadata(prev => ({ ...prev, title: aiResult.title! }));
          }
          if (aiResult.artist && !metadata.artist) {
            setMetadata(prev => ({ ...prev, artist: aiResult.artist! }));
          }
          if (aiResult.genre && !metadata.genre) {
            setMetadata(prev => ({ ...prev, genre: aiResult.genre! }));
          }
          
          setExtractionError('Audio servers busy. Metadata recovered; please provide the direct audio link manually.');
          setUrlValidated(false);
          toast.warning('Metadata recovered via AI. Please provide a direct audio link.', { duration: 5000 });
        } else {
          // Complete failure
          setExtractionStage('idle');
          setExtractionError('Could not extract audio or metadata. Please try a direct audio link.');
          toast.error('Extraction failed. Please use a direct audio URL.');
        }
      } else {
        // Direct URL - transform and validate
        const transformedUrl = transformAudioUrl(audioUrl);
        
        const duration = await getAudioDurationFromUrl(transformedUrl);
        if (duration > 0) {
          setAudioDuration(duration);
          setUrlValidated(true);
          setExtractionStage('complete');
          toast.success('Audio URL validated!');
        } else {
          setUrlValidated(true);
          setExtractionStage('complete');
          toast.success('URL accepted - will be used as provided');
        }
      }
    } catch (error: any) {
      setExtractionStage('idle');
      toast.error(error.message || 'Failed to validate/extract audio');
      setValidationErrors(prev => [...prev.filter(e => e.type !== 'url'), { type: 'url', message: error.message }]);
    } finally {
      setIsValidatingUrl(false);
      setIsExtracting(false);
    }
  };

  const handleAudioDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingAudio(false);
    const file = e.dataTransfer.files[0];
    
    if (file) {
      const error = validateAudioFile(file);
      if (error) {
        setValidationErrors(prev => [...prev.filter(e => e.type !== 'audio'), { type: 'audio', message: error }]);
        toast.error(error);
        return;
      }
      
      setValidationErrors(prev => prev.filter(e => e.type !== 'audio'));
      setAudioFile(file);
      
      const duration = await getAudioDuration(file);
      setAudioDuration(duration);
      
      const name = file.name.replace(/\.[^/.]+$/, '');
      setMetadata(prev => ({ ...prev, title: prev.title || name }));
    }
  }, [validateAudioFile]);

  const handleCoverDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingCover(false);
    const file = e.dataTransfer.files[0];
    
    if (file) {
      const error = validateCoverFile(file);
      if (error) {
        setValidationErrors(prev => [...prev.filter(e => e.type !== 'cover'), { type: 'cover', message: error }]);
        toast.error(error);
        return;
      }
      
      setValidationErrors(prev => prev.filter(e => e.type !== 'cover'));
      setIsCompressing(true);
      
      try {
        const originalSize = file.size;
        const compressed = await compressImage(file);
        const stats = getCompressionStats(originalSize, compressed.size);
        
        setCoverFile(compressed);
        setCompressionSaved(stats);
        
        if (stats.savedPercent > 0) {
          toast.success(`Image compressed: saved ${formatBytes(stats.savedBytes)} (${stats.savedPercent}%)`);
        }
      } catch (err) {
        // Fallback to original if compression fails
        setCoverFile(file);
        setCompressionSaved(null);
      } finally {
        setIsCompressing(false);
      }
    }
  }, [validateCoverFile]);

  const handleAudioSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const error = validateAudioFile(file);
      if (error) {
        setValidationErrors(prev => [...prev.filter(e => e.type !== 'audio'), { type: 'audio', message: error }]);
        toast.error(error);
        return;
      }
      
      setValidationErrors(prev => prev.filter(e => e.type !== 'audio'));
      setAudioFile(file);
      
      const duration = await getAudioDuration(file);
      setAudioDuration(duration);
      
      const name = file.name.replace(/\.[^/.]+$/, '');
      setMetadata(prev => ({ ...prev, title: prev.title || name }));
    }
  };

  const handleCoverSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const error = validateCoverFile(file);
      if (error) {
        setValidationErrors(prev => [...prev.filter(e => e.type !== 'cover'), { type: 'cover', message: error }]);
        toast.error(error);
        return;
      }
      
      setValidationErrors(prev => prev.filter(e => e.type !== 'cover'));
      setIsCompressing(true);
      
      try {
        const originalSize = file.size;
        const compressed = await compressImage(file);
        const stats = getCompressionStats(originalSize, compressed.size);
        
        setCoverFile(compressed);
        setCompressionSaved(stats);
        
        if (stats.savedPercent > 0) {
          toast.success(`Image compressed: saved ${formatBytes(stats.savedBytes)} (${stats.savedPercent}%)`);
        }
      } catch (err) {
        // Fallback to original if compression fails
        setCoverFile(file);
        setCompressionSaved(null);
      } finally {
        setIsCompressing(false);
      }
    }
  };

  const handleUpload = async () => {
    if (uploadMode === 'file') {
      if (!audioFile || !metadata.title || !metadata.artist) {
        toast.error('Please fill in required fields');
        return;
      }
    } else {
      if (!audioUrl || !metadata.title || !metadata.artist) {
        toast.error('Please fill in required fields');
        return;
      }
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      let finalAudioUrl = audioUrl;
      let fileSize = 0;

      if (uploadMode === 'file' && audioFile) {
        const audioExt = audioFile.name.split('.').pop();
        const audioPath = `${Date.now()}-${Math.random().toString(36).substring(7)}.${audioExt}`;
        
        setUploadProgress(20);
        const { error: audioError } = await supabase.storage
          .from('music')
          .upload(audioPath, audioFile);

        if (audioError) throw audioError;

        const { data: audioUrlData } = supabase.storage.from('music').getPublicUrl(audioPath);
        finalAudioUrl = audioUrlData.publicUrl;
        fileSize = audioFile.size;
      } else if (uploadMode === 'url') {
        // Use extracted URL if available, otherwise transform the original URL
        finalAudioUrl = extractedUrl || transformAudioUrl(audioUrl);
      }

      setUploadProgress(50);

      let finalCoverUrl = coverUrl || null;
      let coverSize = 0;

      // Upload cover file if provided (works in both file and URL modes)
      if (coverFile) {
        const coverExt = coverFile.name.split('.').pop();
        const coverPath = `${Date.now()}-${Math.random().toString(36).substring(7)}.${coverExt}`;
        
        const { error: coverError } = await supabase.storage
          .from('covers')
          .upload(coverPath, coverFile);

        if (!coverError) {
          const { data } = supabase.storage.from('covers').getPublicUrl(coverPath);
          finalCoverUrl = data.publicUrl;
          coverSize = coverFile.size;
        }
      }

      setUploadProgress(75);

      const { error: dbError } = await supabase.from('songs').insert({
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album || null,
        genre: metadata.genre || null,
        mood: metadata.mood || null,
        bpm: metadata.bpm ? parseInt(metadata.bpm) : null,
        audio_url: finalAudioUrl,
        cover_url: finalCoverUrl,
        is_visible: true,
        file_size: fileSize,
        duration: audioDuration,
        cover_size: coverSize,
        show_in_new_releases: metadata.showInNewReleases,
        show_in_trending: metadata.showInTrending,
        is_premium_only: metadata.isPremiumOnly,
      });

      if (dbError) throw dbError;

      setUploadProgress(100);
      toast.success('Song added successfully!');

      setTimeout(() => {
        setAudioFile(null);
        setCoverFile(null);
        setCoverUrlPreview(null);
        setAudioDuration(0);
        setAudioUrl('');
        setCoverUrl('');
        setUrlValidated(false);
        setExtractedUrl(null);
        setDetectedPlatform(null);
        setCompressionSaved(null);
        setMetadata({ title: '', artist: '', album: '', genre: '', mood: '', bpm: '', showInNewReleases: true, showInTrending: false, isPremiumOnly: false });
        setUploadProgress(0);
        setIsUploading(false);
      }, 1000);

    } catch (error: any) {
      toast.error(getUploadError(error));
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const canSubmit = uploadMode === 'file' 
    ? (audioFile && metadata.title && metadata.artist)
    : (audioUrl && metadata.title && metadata.artist);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto pb-24">
      {/* iOS 18 Style Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Upload Music</h1>
        <p className="text-muted-foreground/70 text-sm mt-1">Add new tracks to your library</p>
      </div>

      {/* iOS 18 Segmented Control */}
      <Tabs value={uploadMode} onValueChange={(v) => setUploadMode(v as 'file' | 'url')} className="mb-6">
        <TabsList className="grid w-full grid-cols-2 h-11 p-1 bg-muted/40 rounded-xl">
          <TabsTrigger value="file" className="rounded-lg text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Upload className="w-4 h-4 mr-2" />
            File
          </TabsTrigger>
          <TabsTrigger value="url" className="rounded-lg text-sm font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Link className="w-4 h-4 mr-2" />
            URL
          </TabsTrigger>
        </TabsList>

        <TabsContent value="file" className="mt-5 space-y-5">
          {/* Audio Upload Card - iOS 18 Style */}
          <div className="ios-card p-4">
            <Label className="text-sm font-medium mb-3 block">Audio File *</Label>
            <div
              className={`relative border-2 border-dashed rounded-2xl p-6 text-center transition-colors ${
                isDraggingAudio ? 'border-primary bg-primary/5' :
                audioFile ? 'border-green-500/50 bg-green-500/5' :
                'border-muted-foreground/20 hover:border-muted-foreground/40'
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingAudio(true); }}
              onDragLeave={() => setIsDraggingAudio(false)}
              onDrop={handleAudioDrop}
            >
              <input
                type="file"
                accept="audio/*"
                onChange={handleAudioSelect}
                className="absolute inset-0 z-0 opacity-0 cursor-pointer"
              />
              {audioFile ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Check className="w-5 h-5 text-green-500" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{audioFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(audioFile.size)} • {audioDuration > 0 ? formatDuration(audioDuration) : 'Loading...'}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setAudioFile(null); setAudioDuration(0); }}
                    className="relative z-10 p-2 hover:bg-white/10 rounded-full"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div>
                  <Music className="w-10 h-10 mx-auto mb-2 text-muted-foreground/50" />
                  <p className="font-medium text-sm">Drop audio file here</p>
                  <p className="text-xs text-muted-foreground mt-1">MP3, WAV, FLAC, AAC, OGG, M4A</p>
                </div>
              )}
            </div>
          </div>

          {/* Cover Upload Card */}
          <div className="ios-card p-4">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-sm font-medium">Cover Art</Label>
              {compressionSaved && compressionSaved.savedPercent > 0 && (
                <div className="flex items-center gap-1 text-xs text-green-500">
                  <Zap className="w-3 h-3" />
                  <span>Saved {compressionSaved.savedPercent}%</span>
                </div>
              )}
            </div>
            <div
              className={`relative border-2 border-dashed rounded-2xl p-6 text-center transition-colors ${
                isDraggingCover ? 'border-accent bg-accent/5' :
                coverFile ? 'border-accent/50 bg-accent/5' :
                'border-muted-foreground/20 hover:border-muted-foreground/40'
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingCover(true); }}
              onDragLeave={() => setIsDraggingCover(false)}
              onDrop={handleCoverDrop}
            >
              <input
                type="file"
                accept="image/*"
                onChange={handleCoverSelect}
                className="absolute inset-0 z-0 opacity-0 cursor-pointer"
              />
              {isCompressing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Compressing image...</p>
                </div>
              ) : coverPreview ? (
                <div className="relative inline-block">
                  <img src={coverPreview} alt="Cover" className="w-24 h-24 rounded-xl object-cover mx-auto" />
                  <button
                    onClick={(e) => { e.stopPropagation(); setCoverFile(null); setCoverUrlPreview(null); setCompressionSaved(null); }}
                    className="absolute -top-2 -right-2 z-10 p-1 bg-destructive rounded-full"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  {coverFile && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatBytes(coverFile.size)}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <Image className="w-10 h-10 mx-auto mb-2 text-muted-foreground/50" />
                  <p className="font-medium text-sm">Drop cover image here</p>
                  <p className="text-xs text-muted-foreground mt-1">Auto-compressed to WebP</p>
                </div>
              )}
            </div>
          </div>

          {/* Metadata Card */}
          <MetadataCard 
            metadata={metadata} 
            setMetadata={setMetadata} 
            genres={genres} 
            moods={moods}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            canSubmit={!!canSubmit}
            onSubmit={handleUpload}
          />
        </TabsContent>

        <TabsContent value="url" className="mt-5 space-y-5">
          {/* URL Input Card */}
          <div className="ios-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-primary" />
              <Label className="text-sm font-medium">Audio URL *</Label>
            </div>
            <div className="flex gap-2">
              <Input
                value={audioUrl}
                onChange={(e) => { 
                  setAudioUrl(e.target.value); 
                  setUrlValidated(false); 
                  setExtractedUrl(null);
                  setDetectedPlatform(null);
                  setExtractionStage('idle');
                  setExtractionError(null);
                }}
                placeholder="YouTube, SoundCloud, or direct audio URL"
                className="flex-1 h-11 rounded-xl bg-muted/30 border-0"
              />
              <Button
                onClick={validateAudioUrl}
                disabled={isValidatingUrl || isExtracting || !audioUrl}
                variant="outline"
                className="h-11 px-4 rounded-xl"
              >
                {isValidatingUrl || isExtracting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : urlValidated ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Disc3 className="w-4 h-4" />
                )}
              </Button>
            </div>
            
            {/* Multi-stage extraction animation */}
            <AnimatePresence mode="wait">
              {extractionStage !== 'idle' && extractionStage !== 'complete' && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mt-3 p-3 rounded-xl bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 border border-primary/20"
                >
                  <div className="flex items-center gap-3">
                    {extractionStage === 'analyzing' && (
                      <>
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                          <Disc3 className="w-5 h-5 text-primary" />
                        </motion.div>
                        <div>
                          <p className="text-sm font-medium text-primary">Reading metadata...</p>
                          <p className="text-xs text-muted-foreground">Extracting metadata from URL</p>
                        </div>
                      </>
                    )}
                    {extractionStage === 'decrypting' && (
                      <>
                        <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
                          <Shield className="w-5 h-5 text-accent" />
                        </motion.div>
                        <div>
                          <p className="text-sm font-medium text-accent">Decrypting Stream...</p>
                          <p className="text-xs text-muted-foreground">Connecting to proxy servers</p>
                        </div>
                      </>
                    )}
                    {extractionStage === 'syncing' && (
                      <>
                        <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 0.5, repeat: Infinity }}>
                          <Database className="w-5 h-5 text-green-500" />
                        </motion.div>
                        <div>
                          <p className="text-sm font-medium text-green-500">Syncing to Vault...</p>
                          <p className="text-xs text-muted-foreground">Preparing audio stream</p>
                        </div>
                      </>
                    )}
                    {extractionStage === 'fallback' && (
                      <>
                        <AlertCircle className="w-5 h-5 text-yellow-500" />
                        <div>
                          <p className="text-sm font-medium text-yellow-500">Metadata Recovered</p>
                          <p className="text-xs text-muted-foreground">{extractionError}</p>
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            {/* Success/validated status */}
            {urlValidated && detectedPlatform && extractionStage === 'complete' && (
              <div className="mt-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20">
                <p className="text-xs text-green-500 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Audio extracted from {detectedPlatform}
                  {audioDuration > 0 && ` • ${formatDuration(audioDuration)}`}
                </p>
              </div>
            )}
            
            {urlValidated && !detectedPlatform && audioDuration > 0 && (
              <p className="text-xs text-green-500 mt-2">✓ Duration: {formatDuration(audioDuration)}</p>
            )}
          </div>

          {/* Cover Image Card - File Upload OR URL */}
          <div className="ios-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Image className="w-4 h-4 text-accent" />
                <Label className="text-sm font-medium">Cover Image</Label>
              </div>
              {compressionSaved && compressionSaved.savedPercent > 0 && (
                <div className="flex items-center gap-1 text-xs text-green-500">
                  <Zap className="w-3 h-3" />
                  <span>Saved {compressionSaved.savedPercent}%</span>
                </div>
              )}
            </div>
            
            {/* Cover File Upload */}
            <div
              className={`relative border-2 border-dashed rounded-2xl p-4 text-center transition-colors mb-3 ${
                isDraggingCover ? 'border-accent bg-accent/5' :
                coverFile ? 'border-accent/50 bg-accent/5' :
                'border-muted-foreground/20 hover:border-muted-foreground/40'
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDraggingCover(true); }}
              onDragLeave={() => setIsDraggingCover(false)}
              onDrop={handleCoverDrop}
            >
              <input
                type="file"
                accept="image/*"
                onChange={handleCoverSelect}
                className="absolute inset-0 z-0 opacity-0 cursor-pointer"
              />
              {isCompressing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <p className="text-xs text-muted-foreground">Compressing...</p>
                </div>
              ) : coverPreview ? (
                <div className="relative inline-block">
                  <img src={coverPreview} alt="Cover" className="w-20 h-20 rounded-xl object-cover mx-auto" />
                  <button
                    onClick={(e) => { e.stopPropagation(); setCoverFile(null); setCoverUrlPreview(null); setCompressionSaved(null); }}
                    className="absolute -top-2 -right-2 z-10 p-1 bg-destructive rounded-full"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  {coverFile && (
                    <p className="text-xs text-muted-foreground mt-2">{formatBytes(coverFile.size)}</p>
                  )}
                </div>
              ) : (
                <div>
                  <Image className="w-8 h-8 mx-auto mb-1.5 text-muted-foreground/50" />
                  <p className="font-medium text-sm">Tap to select or drop image</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Auto-compressed to WebP</p>
                </div>
              )}
            </div>

            {/* OR use URL */}
            {!coverFile && (
              <>
                <div className="flex items-center gap-2 my-2">
                  <div className="flex-1 h-px bg-muted-foreground/20" />
                  <span className="text-xs text-muted-foreground">OR paste URL</span>
                  <div className="flex-1 h-px bg-muted-foreground/20" />
                </div>
                <Input
                  value={coverUrl}
                  onChange={(e) => setCoverUrl(e.target.value)}
                  placeholder="https://example.com/cover.jpg"
                  className="h-11 rounded-xl bg-muted/30 border-0"
                />
                {coverUrl && (
                  <div className="mt-3 flex justify-center">
                    <img 
                      src={coverUrl} 
                      alt="Cover" 
                      className="w-20 h-20 rounded-xl object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Tips */}
          <div className="ios-card p-4 bg-gradient-to-br from-green-500/10 to-accent/5 border-green-500/20">
            <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
              <Check className="w-4 h-4 text-green-500" />
              Recommended: Direct Audio Links
            </h3>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• <span className="text-foreground font-medium">Direct links</span> - MP3, WAV, FLAC, M4A, OGG files</li>
              <li>• <span className="text-foreground font-medium">Google Drive</span> - Shared audio files</li>
              <li>• <span className="text-foreground font-medium">Dropbox</span> - Direct download links</li>
              <li>• <span className="text-foreground font-medium">OneDrive</span> - Shared audio files</li>
              <li>• <span className="text-foreground font-medium">Any CDN</span> - Direct audio file URLs</li>
            </ul>
          </div>
          
          <div className="ios-card p-4 bg-gradient-to-br from-yellow-500/10 to-orange-500/5 border-yellow-500/20">
            <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-500" />
              Platform Extraction (Limited)
            </h3>
            <p className="text-xs text-muted-foreground mb-2">
              Extraction from these platforms may not work due to bot protection:
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li>• YouTube, SoundCloud, TikTok, Twitter/X, Instagram</li>
            </ul>
            <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2 font-medium">
              💡 Tip: Download audio using a tool like yt-dlp, then upload directly or use a cloud storage link.
            </p>
          </div>

          {/* Metadata Card */}
          <MetadataCard 
            metadata={metadata} 
            setMetadata={setMetadata} 
            genres={genres} 
            moods={moods}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            canSubmit={!!canSubmit}
            onSubmit={handleUpload}
            isUrlMode
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

// iOS 18 Style Metadata Card
const MetadataCard = ({ metadata, setMetadata, genres, moods, isUploading, uploadProgress, canSubmit, onSubmit, isUrlMode }: {
  metadata: { title: string; artist: string; album: string; genre: string; mood: string; bpm: string; showInNewReleases: boolean; showInTrending: boolean; isPremiumOnly: boolean };
  setMetadata: React.Dispatch<React.SetStateAction<{ title: string; artist: string; album: string; genre: string; mood: string; bpm: string; showInNewReleases: boolean; showInTrending: boolean; isPremiumOnly: boolean }>>;
  genres: string[];
  moods: string[];
  isUploading: boolean;
  uploadProgress: number;
  canSubmit: boolean;
  onSubmit: () => void;
  isUrlMode?: boolean;
}) => (
  <div className="ios-card p-4 space-y-4">
    <h3 className="font-semibold text-base">Song Details</h3>
    
    <div>
      <Label className="text-sm">Title *</Label>
      <Input
        value={metadata.title}
        onChange={(e) => setMetadata(prev => ({ ...prev, title: e.target.value }))}
        className="mt-1.5 h-11 rounded-xl bg-muted/30 border-0"
        placeholder="Song title"
      />
    </div>

    <div>
      <Label className="text-sm">Artist *</Label>
      <Input
        value={metadata.artist}
        onChange={(e) => setMetadata(prev => ({ ...prev, artist: e.target.value }))}
        className="mt-1.5 h-11 rounded-xl bg-muted/30 border-0"
        placeholder="Artist name"
      />
    </div>

    <div>
      <Label className="text-sm">Album</Label>
      <Input
        value={metadata.album}
        onChange={(e) => setMetadata(prev => ({ ...prev, album: e.target.value }))}
        className="mt-1.5 h-11 rounded-xl bg-muted/30 border-0"
        placeholder="Album name"
      />
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label className="text-sm">Genre</Label>
        <Select value={metadata.genre} onValueChange={(v) => setMetadata(prev => ({ ...prev, genre: v }))}>
          <SelectTrigger className="mt-1.5 h-11 rounded-xl bg-muted/30 border-0">
            <SelectValue placeholder="Genre" />
          </SelectTrigger>
          <SelectContent>
            {genres.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-sm">Mood</Label>
        <Select value={metadata.mood} onValueChange={(v) => setMetadata(prev => ({ ...prev, mood: v }))}>
          <SelectTrigger className="mt-1.5 h-11 rounded-xl bg-muted/30 border-0">
            <SelectValue placeholder="Mood" />
          </SelectTrigger>
          <SelectContent>
            {moods.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>

    <div>
      <Label className="text-sm">BPM</Label>
      <Input
        type="number"
        value={metadata.bpm}
        onChange={(e) => setMetadata(prev => ({ ...prev, bpm: e.target.value }))}
        className="mt-1.5 h-11 rounded-xl bg-muted/30 border-0"
        placeholder="120"
      />
    </div>

    {/* Section Placement */}
    <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 space-y-3">
      <Label className="text-sm font-semibold flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-primary" />
        Display Sections
      </Label>
      <p className="text-xs text-muted-foreground">Choose where this song should appear</p>
      
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-3 p-3 rounded-lg bg-background/50 cursor-pointer">
          <input
            type="checkbox"
            checked={metadata.showInNewReleases}
            onChange={(e) => setMetadata(prev => ({ ...prev, showInNewReleases: e.target.checked }))}
            className="w-5 h-5 rounded accent-primary"
          />
          <div>
            <span className="font-medium text-sm">New Releases</span>
            <p className="text-xs text-muted-foreground">Show in New Releases section</p>
          </div>
        </label>
        
        <label className="flex items-center gap-3 p-3 rounded-lg bg-background/50 cursor-pointer">
          <input
            type="checkbox"
            checked={metadata.showInTrending}
            onChange={(e) => setMetadata(prev => ({ ...prev, showInTrending: e.target.checked }))}
            className="w-5 h-5 rounded accent-primary"
          />
          <div>
            <span className="font-medium text-sm">Trending Now</span>
            <p className="text-xs text-muted-foreground">Show in Trending Now section</p>
          </div>
        </label>
        
        <label className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 cursor-pointer">
          <input
            type="checkbox"
            checked={metadata.isPremiumOnly}
            onChange={(e) => setMetadata(prev => ({ ...prev, isPremiumOnly: e.target.checked }))}
            className="w-5 h-5 rounded accent-amber-500"
          />
          <div>
            <span className="font-medium text-sm text-amber-400">Premium Only</span>
            <p className="text-xs text-muted-foreground">Only premium users can play this</p>
          </div>
        </label>
      </div>
    </div>

    {/* Progress */}
    <AnimatePresence>
      {isUploading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-primary to-accent"
              initial={{ width: 0 }}
              animate={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">{uploadProgress}%</p>
        </motion.div>
      )}
    </AnimatePresence>

    <Button
      onClick={onSubmit}
      disabled={isUploading || !canSubmit}
      className="w-full h-12 rounded-xl font-semibold bg-gradient-to-r from-primary to-accent text-white"
    >
      {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <>
          {isUrlMode ? <Link className="w-4 h-4 mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
          {isUrlMode ? 'Add from URL' : 'Upload Song'}
        </>
      )}
    </Button>
  </div>
);

export default UploadMusic;
