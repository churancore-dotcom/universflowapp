import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Music, Users, PlayCircle, Calendar, HardDrive, Download, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface TopSong {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  play_count: number;
}

interface StorageStats {
  totalMusicSize: number;
  totalCoverSize: number;
  totalSongs: number;
  totalDownloads: number;
  avgFileSize: number;
  totalDuration: number;
}

const Analytics = () => {
  const [topSongs, setTopSongs] = useState<TopSong[]>([]);
  type RecentPlay = { id: string; played_at: string; songs?: { title?: string; artist?: string; cover_url?: string | null } | null };
  const [recentPlays, setRecentPlays] = useState<RecentPlay[]>([]);
  const [stats, setStats] = useState({
    totalPlays: 0,
    uniqueListeners: 0,
    songsThisMonth: 0,
  });
  const [storageStats, setStorageStats] = useState<StorageStats>({
    totalMusicSize: 0,
    totalCoverSize: 0,
    totalSongs: 0,
    totalDownloads: 0,
    avgFileSize: 0,
    totalDuration: 0,
  });

  useEffect(() => {
    fetchAnalytics();
    fetchStorageStats();
  }, []);

  const fetchAnalytics = async () => {
    // Fetch top songs
    const { data: songs } = await supabase
      .from('songs')
      .select('id, title, artist, cover_url, play_count')
      .order('play_count', { ascending: false })
      .limit(10);

    if (songs) setTopSongs(songs);

    // Fetch recent plays
    const { data: plays } = await supabase
      .from('recently_played')
      .select('*, songs(*)')
      .order('played_at', { ascending: false })
      .limit(20);

    if (plays) setRecentPlays(plays as unknown as RecentPlay[]);

    // Calculate stats
    const { data: allSongs } = await supabase.from('songs').select('play_count, created_at');
    const { data: profiles } = await supabase.from('profiles').select('id');

    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    setStats({
      totalPlays: allSongs?.reduce((acc, s) => acc + (s.play_count || 0), 0) || 0,
      uniqueListeners: profiles?.length || 0,
      songsThisMonth: allSongs?.filter(s => new Date(s.created_at) >= thisMonth).length || 0,
    });
  };

  const fetchStorageStats = async () => {
    const { data: songs } = await supabase
      .from('songs')
      .select('file_size, cover_size, duration, download_count');

    if (songs) {
      const totalMusicSize = songs.reduce((acc, s) => acc + (s.file_size || 0), 0);
      const totalCoverSize = songs.reduce((acc, s) => acc + (s.cover_size || 0), 0);
      const totalDownloads = songs.reduce((acc, s) => acc + (s.download_count || 0), 0);
      const totalDuration = songs.reduce((acc, s) => acc + (s.duration || 0), 0);
      
      setStorageStats({
        totalMusicSize,
        totalCoverSize,
        totalSongs: songs.length,
        totalDownloads,
        avgFileSize: songs.length > 0 ? totalMusicSize / songs.length : 0,
        totalDuration,
      });
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins} min`;
  };

  const totalStorage = storageStats.totalMusicSize + storageStats.totalCoverSize;

  return (
    <div className="p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-display font-bold">Analytics</h1>
        <p className="text-muted-foreground mt-1">Track your platform's performance</p>
      </motion.div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {[
          { icon: PlayCircle, label: 'Total Plays', value: stats.totalPlays, color: 'from-primary to-cyan-400' },
          { icon: Users, label: 'Registered Accounts', value: stats.uniqueListeners, color: 'from-accent to-pink-400' },
          { icon: Calendar, label: 'Songs This Month', value: stats.songsThisMonth, color: 'from-green-500 to-emerald-400' },
        ].map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              className="glass rounded-2xl p-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center mb-4`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
              <p className="text-3xl font-display font-bold mt-1">{stat.value.toLocaleString()}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Storage Dashboard */}
      <motion.div
        className="glass rounded-2xl p-6 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="flex items-center gap-2 mb-6">
          <HardDrive className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-display font-bold">Storage Overview</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="text-center p-4 bg-muted/30 rounded-xl">
            <Music className="w-8 h-8 mx-auto mb-2 text-primary" />
            <p className="text-2xl font-bold">{storageStats.totalSongs}</p>
            <p className="text-sm text-muted-foreground">Total Songs</p>
          </div>
          <div className="text-center p-4 bg-muted/30 rounded-xl">
            <HardDrive className="w-8 h-8 mx-auto mb-2 text-accent" />
            <p className="text-2xl font-bold">{formatFileSize(totalStorage)}</p>
            <p className="text-sm text-muted-foreground">Catalog File Sizes</p>
          </div>
          <div className="text-center p-4 bg-muted/30 rounded-xl">
            <Download className="w-8 h-8 mx-auto mb-2 text-green-500" />
            <p className="text-2xl font-bold">{storageStats.totalDownloads.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground">Total Downloads</p>
          </div>
          <div className="text-center p-4 bg-muted/30 rounded-xl">
            <BarChart3 className="w-8 h-8 mx-auto mb-2 text-orange-500" />
            <p className="text-2xl font-bold">{formatDuration(storageStats.totalDuration)}</p>
            <p className="text-sm text-muted-foreground">Total Duration</p>
          </div>
        </div>

        {/* Storage Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Storage Used</span>
            <span className="font-medium">
              {formatFileSize(totalStorage)}
            </span>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground mt-3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-primary" />
              Music: {formatFileSize(storageStats.totalMusicSize)}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-accent" />
              Covers: {formatFileSize(storageStats.totalCoverSize)}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-muted-foreground" />
              Avg per song: {formatFileSize(storageStats.avgFileSize)}
            </span>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Songs */}
        <motion.div
          className="glass rounded-2xl p-6"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-display font-bold">Top Songs</h2>
          </div>

          {topSongs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Music className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No data yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topSongs.map((song, index) => (
                <motion.div
                  key={song.id}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-all"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + index * 0.05 }}
                >
                  <span className={`w-6 text-center font-display font-bold ${
                    index < 3 ? 'text-primary' : 'text-muted-foreground'
                  }`}>
                    {index + 1}
                  </span>
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center overflow-hidden">
                    {song.cover_url ? (
                      <img src={song.cover_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{song.title}</p>
                    <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {song.play_count.toLocaleString()} plays
                  </span>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Recent Activity */}
        <motion.div
          className="glass rounded-2xl p-6"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="flex items-center gap-2 mb-6">
            <PlayCircle className="w-5 h-5 text-accent" />
            <h2 className="text-xl font-display font-bold">Recent Activity</h2>
          </div>

          {recentPlays.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <PlayCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No recent plays</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar">
              {recentPlays.map((play, index) => (
                <motion.div
                  key={play.id}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-all"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 + index * 0.03 }}
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/30 to-accent/30 flex items-center justify-center overflow-hidden">
                    {play.songs?.cover_url ? (
                      <img src={play.songs.cover_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{play.songs?.title || 'Unknown'}</p>
                    <p className="text-sm text-muted-foreground truncate">{play.songs?.artist}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(play.played_at).toLocaleTimeString()}
                  </span>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default Analytics;