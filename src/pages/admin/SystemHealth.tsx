import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Server, 
  Database, 
  HardDrive, 
  Wifi, 
  Shield, 
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Activity,
  Zap,
  Users,
  Music
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

interface HealthCheck {
  name: string;
  status: 'healthy' | 'warning' | 'error' | 'checking';
  message: string;
  responseTime?: number;
}

interface PerfEvent {
  id: string;
  event_type: string;
  severity: string;
  message: string | null;
  route: string | null;
  created_at: string;
}

interface SystemStats {
  totalSongs: number;
  totalUsers: number;
  totalPlays: number;
  storageUsed: number;
  avgResponseTime: number;
}

const SystemHealth = () => {
  const [checks, setChecks] = useState<HealthCheck[]>([
    { name: 'Database Connection', status: 'checking', message: 'Checking...' },
    { name: 'Authentication Service', status: 'checking', message: 'Checking...' },
    { name: 'Storage Service', status: 'checking', message: 'Checking...' },
    { name: 'Realtime Service', status: 'checking', message: 'Checking...' },
  ]);
  const [stats, setStats] = useState<SystemStats>({
    totalSongs: 0,
    totalUsers: 0,
    totalPlays: 0,
    storageUsed: 0,
    avgResponseTime: 0,
  });
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [errorFeed, setErrorFeed] = useState<PerfEvent[]>([]);

  useEffect(() => {
    runHealthChecks();
    fetchStats();
    fetchErrorFeed();
    const channel = supabase
      .channel('admin-health-errors')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'perf_events' }, fetchErrorFeed)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchErrorFeed = async () => {
    const { data } = await supabase
      .from('perf_events')
      .select('id, event_type, severity, message, route, created_at')
      .in('severity', ['error', 'warning'])
      .order('created_at', { ascending: false })
      .limit(20);
    setErrorFeed((data as PerfEvent[] | null) || []);
  };

  const fetchStats = async () => {
    const startTime = performance.now();
    
    const [songsRes, usersRes] = await Promise.all([
      supabase.from('songs').select('id, play_count, file_size, cover_size'),
      supabase.from('profiles').select('id'),
    ]);

    const responseTime = performance.now() - startTime;
    
    const songs = songsRes.data || [];
    const totalPlays = songs.reduce((acc, s) => acc + (s.play_count || 0), 0);
    const storageUsed = songs.reduce((acc, s) => acc + (s.file_size || 0) + (s.cover_size || 0), 0);

    setStats({
      totalSongs: songs.length,
      totalUsers: usersRes.data?.length || 0,
      totalPlays,
      storageUsed,
      avgResponseTime: Math.round(responseTime),
    });
  };

  const runHealthChecks = async () => {
    setIsChecking(true);
    const newChecks: HealthCheck[] = [];

    // Database Check
    try {
      const start = performance.now();
      const { error } = await supabase.from('songs').select('id').limit(1);
      const time = Math.round(performance.now() - start);
      
      newChecks.push({
        name: 'Database Connection',
        status: error ? 'error' : 'healthy',
        message: error ? error.message : 'Connected successfully',
        responseTime: time,
      });
    } catch (e) {
      newChecks.push({
        name: 'Database Connection',
        status: 'error',
        message: 'Connection failed',
      });
    }

    // Auth Check
    try {
      const start = performance.now();
      const { data, error } = await supabase.auth.getUser();
      const time = Math.round(performance.now() - start);
      
      newChecks.push({
        name: 'Authentication Service',
        status: error || !data.user ? 'error' : 'healthy',
        message: error ? error.message : data.user ? 'Account verified by authentication service' : 'No authenticated account',
        responseTime: time,
      });
    } catch (e) {
      newChecks.push({
        name: 'Authentication Service',
        status: 'error',
        message: 'Service unavailable',
      });
    }

    // Storage Check
    try {
      const start = performance.now();
      const { error } = await supabase.storage.from('music').list('', { limit: 1 });
      const time = Math.round(performance.now() - start);
      
      newChecks.push({
        name: 'Storage Service',
        status: error ? 'warning' : 'healthy',
        message: error ? 'Limited access' : 'Operational',
        responseTime: time,
      });
    } catch (e) {
      newChecks.push({
        name: 'Storage Service',
        status: 'warning',
        message: 'Unable to verify',
      });
    }

    // Realtime Check
    try {
      const start = performance.now();
      const channel = supabase.channel('health-check');
      const result = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('TIMED_OUT'), 5000);
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { clearTimeout(timer); resolve(status); }
        });
      });
      const time = Math.round(performance.now() - start);
      await supabase.removeChannel(channel);
      newChecks.push({ name: 'Realtime Service', status: result === 'SUBSCRIBED' ? 'healthy' : 'warning', message: result === 'SUBSCRIBED' ? 'Subscription connected' : `Subscription not verified: ${result}`, responseTime: time });
    } catch (e) {
      newChecks.push({
        name: 'Realtime Service',
        status: 'warning',
        message: 'Check manually',
      });
    }

    setChecks(newChecks);
    setLastChecked(new Date());
    setIsChecking(false);
  };

  const getStatusIcon = (status: HealthCheck['status']) => {
    switch (status) {
      case 'healthy': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'warning': return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      case 'error': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'checking': return <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />;
    }
  };

  const getStatusColor = (status: HealthCheck['status']) => {
    switch (status) {
      case 'healthy': return 'bg-green-500/20 border-green-500/30';
      case 'warning': return 'bg-yellow-500/20 border-yellow-500/30';
      case 'error': return 'bg-red-500/20 border-red-500/30';
      case 'checking': return 'bg-muted/50 border-muted';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const overallHealth = checks.every(c => c.status === 'healthy') ? 'healthy' 
    : checks.some(c => c.status === 'error') ? 'error' 
    : checks.some(c => c.status === 'warning') ? 'warning' 
    : 'checking';


  return (
    <div className="p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">System Health</h1>
          <p className="text-muted-foreground mt-1">Monitor platform status and performance</p>
        </div>
        <Button onClick={runHealthChecks} disabled={isChecking} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
          Run Health Check
        </Button>
      </motion.div>

      {/* Overall Status */}
      <motion.div
        className={`glass rounded-2xl p-6 mb-8 border ${getStatusColor(overallHealth)}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
            overallHealth === 'healthy' ? 'bg-green-500/20' :
            overallHealth === 'warning' ? 'bg-yellow-500/20' :
            overallHealth === 'error' ? 'bg-red-500/20' : 'bg-muted/50'
          }`}>
            {overallHealth === 'checking' ? (
              <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <Server className={`w-8 h-8 ${
                overallHealth === 'healthy' ? 'text-green-500' :
                overallHealth === 'warning' ? 'text-yellow-500' : 'text-red-500'
              }`} />
            )}
          </div>
          <div>
            <h2 className="text-xl font-bold">
              {overallHealth === 'healthy' ? 'Checked Services Operational' :
               overallHealth === 'warning' ? 'Minor Issues Detected' :
               overallHealth === 'error' ? 'System Issues' : 'Checking...'}
            </h2>
            <p className="text-muted-foreground">
              {lastChecked ? `Last checked: ${lastChecked.toLocaleTimeString()}` : 'Running initial check...'}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { icon: Music, label: 'Total Songs', value: stats.totalSongs, color: 'from-primary to-cyan-400' },
          { icon: Users, label: 'Total Users', value: stats.totalUsers, color: 'from-accent to-pink-400' },
          { icon: Activity, label: 'Total Plays', value: stats.totalPlays, color: 'from-green-500 to-emerald-400' },
          { icon: Zap, label: 'Stats query time', value: `${stats.avgResponseTime}ms`, color: 'from-yellow-500 to-amber-400' },
        ].map((stat, index) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              className="glass rounded-xl p-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center mb-3`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <p className="text-2xl font-bold">{typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Catalog File Sizes */}
      <motion.div
        className="glass rounded-2xl p-6 mb-8"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <HardDrive className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold">Catalog File Sizes</h2>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Used</span>
            <span className="font-medium">
              {formatBytes(stats.storageUsed)}
            </span>
          </div>
        </div>
      </motion.div>

      {/* Health Checks */}
      <motion.div
        className="glass rounded-2xl overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <div className="p-4 border-b border-white/5">
          <h2 className="font-bold">Service Status</h2>
        </div>
        <div className="divide-y divide-white/5">
          {checks.map((check, index) => (
            <motion.div
              key={check.name}
              className="flex items-center gap-4 p-4"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + index * 0.1 }}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                check.status === 'healthy' ? 'bg-green-500/20' :
                check.status === 'warning' ? 'bg-yellow-500/20' :
                check.status === 'error' ? 'bg-red-500/20' : 'bg-muted/50'
              }`}>
                {check.name === 'Database Connection' && <Database className="w-5 h-5" />}
                {check.name === 'Authentication Service' && <Shield className="w-5 h-5" />}
                {check.name === 'Storage Service' && <HardDrive className="w-5 h-5" />}
                {check.name === 'Realtime Service' && <Wifi className="w-5 h-5" />}
                {check.name === 'Edge Functions' && <Zap className="w-5 h-5" />}
              </div>
              <div className="flex-1">
                <p className="font-medium">{check.name}</p>
                <p className="text-sm text-muted-foreground">{check.message}</p>
              </div>
              <div className="flex items-center gap-3">
                {check.responseTime !== undefined && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {check.responseTime}ms
                  </span>
                )}
                {getStatusIcon(check.status)}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Live Error Feed */}
      <motion.div
        className="glass rounded-2xl overflow-hidden mt-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" /> Live Error Feed
          </h2>
          <span className="text-xs text-muted-foreground">Latest {errorFeed.length} warnings & errors</span>
        </div>
        {errorFeed.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500 opacity-60" />
            No errors or warnings recorded — everything looks clean.
          </div>
        ) : (
          <div className="divide-y divide-white/5 max-h-96 overflow-y-auto">
            {errorFeed.map((e) => (
              <div key={e.id} className="flex items-start gap-3 p-3">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${e.severity === 'error' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{e.event_type}</p>
                  {e.message && <p className="text-xs text-muted-foreground truncate">{e.message}</p>}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {e.route ? `${e.route} · ` : ''}{new Date(e.created_at).toLocaleString()}
                  </p>
                </div>
                <span className={`text-[10px] uppercase font-bold ${e.severity === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
                  {e.severity}
                </span>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default SystemHealth;
