import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Crown, 
  Search, 
  Calendar, 
  User, 
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  MoreVertical,
  Ban,
  Gift,
  Smartphone,
  Trash2,
  Timer
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Subscription {
  id: string;
  user_id: string;
  subscription_type: 'free' | 'premium_monthly' | 'premium_yearly';
  platform: 'android' | 'ios' | 'web' | 'donation';
  status: 'active' | 'expired' | 'cancelled' | 'pending';
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  user_email?: string;
  username?: string;
}

interface Stats {
  total: number;
  active: number;
  expired: number;
  cancelled: number;
  premiumMonthly: number;
  premiumYearly: number;
}

const ManageSubscriptions = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [stats, setStats] = useState<Stats>({
    total: 0,
    active: 0,
    expired: 0,
    cancelled: 0,
    premiumMonthly: 0,
    premiumYearly: 0,
  });

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    setLoading(true);
    try {
      const { data: subs, error: subsError } = await supabase
        .from('user_subscriptions')
        .select('*')
        .order('created_at', { ascending: false });

      if (subsError) throw subsError;

      // Fetch user profiles to get emails
      const userIds = [...new Set(subs?.map(s => s.user_id) || [])];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, email, username')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      const enrichedSubs = subs?.map(sub => ({
        ...sub,
        user_email: profileMap.get(sub.user_id)?.email || 'Unknown',
        username: profileMap.get(sub.user_id)?.username || null,
      })) || [];

      setSubscriptions(enrichedSubs as any);

      // Calculate stats
      const active = enrichedSubs.filter(s => s.status === 'active').length;
      const expired = enrichedSubs.filter(s => s.status === 'expired').length;
      const cancelled = enrichedSubs.filter(s => s.status === 'cancelled').length;
      const premiumMonthly = enrichedSubs.filter(s => s.subscription_type === 'premium_monthly' && s.status === 'active').length;
      const premiumYearly = enrichedSubs.filter(s => s.subscription_type === 'premium_yearly' && s.status === 'active').length;

      setStats({
        total: enrichedSubs.length,
        active,
        expired,
        cancelled,
        premiumMonthly,
        premiumYearly,
      });
    } catch (error: any) {
      console.error('Error fetching subscriptions:', error);
      toast.error('Failed to load subscriptions');
    } finally {
      setLoading(false);
    }
  };

  const updateSubscriptionStatus = async (id: string, status: 'active' | 'expired' | 'cancelled') => {
    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      toast.success(`Subscription ${status}`);
      fetchSubscriptions();
    } catch (error: any) {
      console.error('Error updating subscription:', error);
      toast.error('Failed to update subscription');
    }
  };

  const grantPremium = async (userId: string, type: 'premium_monthly' | 'premium_yearly') => {
    try {
      const expiresAt = new Date();
      if (type === 'premium_monthly') {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      } else {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      }

      const { error } = await supabase
        .from('user_subscriptions')
        .upsert({
          user_id: userId,
          subscription_type: type,
          platform: 'web',
          status: 'active',
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) throw error;
      toast.success('Premium granted successfully');
      fetchSubscriptions();
    } catch (error: any) {
      console.error('Error granting premium:', error);
      toast.error('Failed to grant premium');
    }
  };

  // Admin-driven custom expiry (minute precision). Resets warning flags so the
  // expiry-notification cron fires fresh 3d/1d warnings + downgrade + push.
  const setCustomExpiry = async (sub: Subscription) => {
    const raw = window.prompt(
      `Set custom expiry for ${sub.user_email || sub.username || sub.user_id}.\n\n` +
      `Options:\n` +
      `  • Minutes from now: "5m", "30m"\n` +
      `  • Hours from now:   "2h", "12h"\n` +
      `  • Days from now:    "7d", "30d"\n` +
      `  • Absolute ISO:     "2026-12-31T23:59"`,
      '7d'
    );
    if (!raw) return;

    let expiresAt: Date | null = null;
    const m = raw.trim().match(/^(\d+)\s*([mhd])$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2].toLowerCase();
      const ms = unit === 'm' ? n * 60_000 : unit === 'h' ? n * 3_600_000 : n * 86_400_000;
      expiresAt = new Date(Date.now() + ms);
    } else {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) expiresAt = d;
    }

    if (!expiresAt) {
      toast.error('Invalid format. Use 5m / 2h / 7d, or an ISO date.');
      return;
    }

    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .update({
          expires_at: expiresAt.toISOString(),
          status: 'active',
          // Reset notification trackers so warnings fire for the new window
          notif_warn_3d_at: null,
          notif_warn_1d_at: null,
          notif_expired_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sub.id);
      if (error) throw error;
      toast.success(`Expiry set: ${expiresAt.toLocaleString()}`);
      fetchSubscriptions();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to set expiry');
    }
  };


  const deleteSubscription = async (sub: Subscription) => {
    const label = sub.user_email || sub.username || sub.user_id;
    if (!window.confirm(`Delete subscription record for ${label}? This removes the plan record only.`)) return;
    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .delete()
        .eq('id', sub.id);

      if (error) throw error;
      toast.success('Subscription record deleted');
      fetchSubscriptions();
    } catch (error: any) {
      console.error('Error deleting subscription:', error);
      toast.error('Failed to delete subscription');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>;
      case 'expired':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" />Expired</Badge>;
      case 'cancelled':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
      case 'pending':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'premium_monthly':
        return <Badge className="bg-primary/20 text-primary border-primary/30"><Crown className="w-3 h-3 mr-1" />Monthly</Badge>;
      case 'premium_yearly':
        return <Badge className="bg-accent/20 text-accent border-accent/30"><Crown className="w-3 h-3 mr-1" />Yearly</Badge>;
      default:
        return <Badge variant="outline">Free</Badge>;
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'android':
        return <Smartphone className="w-4 h-4 text-green-400" />;
      case 'ios':
        return <Smartphone className="w-4 h-4 text-blue-400" />;
      default:
        return <User className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const filteredSubscriptions = subscriptions.filter(sub => {
    const matchesSearch = 
      sub.user_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.username?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || sub.status === statusFilter;
    const matchesType = typeFilter === 'all' || sub.subscription_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const statCards = [
    { label: 'Total Subscriptions', value: stats.total, icon: User, color: 'text-foreground' },
    { label: 'Active', value: stats.active, icon: CheckCircle, color: 'text-green-400' },
    { label: 'Premium Monthly', value: stats.premiumMonthly, icon: Crown, color: 'text-primary' },
    { label: 'Premium Yearly', value: stats.premiumYearly, icon: Crown, color: 'text-accent' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Manage Subscriptions</h1>
          <p className="text-muted-foreground">View and manage user subscription plans</p>
        </div>
        <Button onClick={fetchSubscriptions} variant="outline" className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </motion.div>

      {/* Stats Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        {statCards.map((stat, index) => (
          <div key={stat.label} className="glass rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-white/5 ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="flex flex-col md:flex-row gap-4"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by email or username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full md:w-40">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="premium_monthly">Monthly</SelectItem>
            <SelectItem value="premium_yearly">Yearly</SelectItem>
          </SelectContent>
        </Select>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass rounded-xl overflow-hidden"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : filteredSubscriptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Crown className="w-12 h-12 mb-4 opacity-50" />
            <p>No subscriptions found</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/5 hover:bg-transparent">
                <TableHead>User</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSubscriptions.map((sub) => (
                <TableRow key={sub.id} className="border-white/5">
                  <TableCell>
                    <div>
                      <p className="font-medium">{sub.username || 'No username'}</p>
                      <p className="text-xs text-muted-foreground">{sub.user_email}</p>
                    </div>
                  </TableCell>
                  <TableCell>{getTypeBadge(sub.subscription_type)}</TableCell>
                  <TableCell>{getStatusBadge(sub.status)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getPlatformIcon(sub.platform)}
                      <span className="text-sm capitalize">{sub.platform}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{formatDate(sub.expires_at)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(sub.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Subscription actions">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => grantPremium(sub.user_id, 'premium_monthly')}>
                          <Gift className="w-4 h-4 mr-2" />
                          Grant Monthly
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => grantPremium(sub.user_id, 'premium_yearly')}>
                          <Gift className="w-4 h-4 mr-2" />
                          Grant Yearly
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setCustomExpiry(sub)}>
                          <Timer className="w-4 h-4 mr-2" />
                          Set custom expiry…
                        </DropdownMenuItem>
                        {sub.status === 'active' && (
                          <DropdownMenuItem 
                            onClick={() => updateSubscriptionStatus(sub.id, 'cancelled')}
                            className="text-destructive"
                          >
                            <Ban className="w-4 h-4 mr-2" />
                            Cancel
                          </DropdownMenuItem>
                        )}
                        {sub.status !== 'active' && (
                          <DropdownMenuItem onClick={() => updateSubscriptionStatus(sub.id, 'active')}>
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Activate
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem 
                          onClick={() => deleteSubscription(sub)}
                          className="text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Record
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </motion.div>
    </div>
  );
};

export default ManageSubscriptions;
