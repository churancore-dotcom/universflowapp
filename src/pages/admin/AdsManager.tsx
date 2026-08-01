import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Upload, Eye, MousePointerClick, SkipForward, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { invalidateAdCampaign } from '@/lib/adEngine';

type Campaign = {
  id: string;
  name: string;
  advertiser: string | null;
  kind: 'premium' | 'brand';
  headline: string;
  subtext: string | null;
  image_url: string | null;
  cta_label: string;
  cta_url: string;
  duration_seconds: number;
  songs_interval: number;
  skippable: boolean;
  skip_after_seconds: number;
  is_active: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  impression_count: number;
  skip_count: number;
  click_count: number;
};

const COLS =
  'id,name,advertiser,kind,headline,subtext,image_url,cta_label,cta_url,duration_seconds,songs_interval,skippable,skip_after_seconds,is_active,priority,starts_at,ends_at,impression_count,skip_count,click_count';

const numField = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export default function AdsManager() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ad_campaigns')
      .select(COLS)
      .order('priority', { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    setRows((data ?? []) as unknown as Campaign[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (id: string, changes: Partial<Campaign>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));

  const save = async (row: Campaign) => {
    const duration = Math.max(3, Math.min(60, Math.round(row.duration_seconds || 8)));
    const interval = Math.max(1, Math.min(50, Math.round(row.songs_interval || 3)));
    const skipAfter = row.skippable
      ? Math.max(0, Math.min(duration, Math.round(row.skip_after_seconds || 0)))
      : 0;
    if (!row.name.trim() || !row.headline.trim() || !row.cta_label.trim()) {
      toast.error('Name, headline, and button label are required');
      return;
    }
    if (!row.cta_url.trim() || (!row.cta_url.startsWith('/') && !/^https?:\/\//i.test(row.cta_url))) {
      toast.error('Button link must start with / or http:// or https://');
      return;
    }
    if (row.starts_at && row.ends_at && new Date(row.ends_at) <= new Date(row.starts_at)) {
      toast.error('End time must be after start time');
      return;
    }
    const normalized = {
      ...row,
      name: row.name.trim(),
      headline: row.headline.trim(),
      cta_label: row.cta_label.trim(),
      cta_url: row.cta_url.trim(),
      duration_seconds: duration,
      songs_interval: interval,
      skip_after_seconds: skipAfter,
    };
    patch(row.id, normalized);
    setSavingId(row.id);
    const { id, impression_count, skip_count, click_count, ...update } = normalized;
    const { error } = await supabase.from('ad_campaigns').update(update).eq('id', id);
    setSavingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    invalidateAdCampaign();
    toast.success('Campaign saved — live for listeners now');
  };

  const create = async () => {
    const { data, error } = await supabase
      .from('ad_campaigns')
      .insert({ name: 'New campaign', kind: 'brand', headline: 'Your headline', cta_label: 'Learn more', cta_url: 'https://', is_active: false })
      .select(COLS)
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => [data as unknown as Campaign, ...prev]);
    invalidateAdCampaign();
  };

  const remove = async (row: Campaign) => {
    if (!window.confirm(`Delete "${row.name}"?`)) return;
    const { error } = await supabase.from('ad_campaigns').delete().eq('id', row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    invalidateAdCampaign();
  };

  const uploadImage = async (row: Campaign, file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Pick an image file');
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast.error('Image must be under 6 MB');
      return;
    }
    setUploadingId(row.id);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `ads/${row.id}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('covers').upload(path, file, {
      cacheControl: '31536000',
      upsert: true,
      contentType: file.type,
    });
    if (error) {
      setUploadingId(null);
      toast.error(error.message);
      return;
    }
    const { data } = supabase.storage.from('covers').getPublicUrl(path);
    patch(row.id, { image_url: data.publicUrl });
    const { error: updateError } = await supabase.from('ad_campaigns').update({ image_url: data.publicUrl }).eq('id', row.id);
    if (updateError) {
      setUploadingId(null);
      toast.error(updateError.message);
      return;
    }
    invalidateAdCampaign();
    setUploadingId(null);
    toast.success('Image updated');
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Megaphone className="h-5 w-5 text-primary" /> Ads Manager
          </h1>
          <p className="text-xs text-muted-foreground">
            Sponsored & Premium promos shown between songs. Premium users never see ads.
          </p>
        </div>
        <Button size="sm" onClick={create} className="gap-1.5">
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>

      {rows.length === 0 && (
        <p className="rounded-2xl border border-border/60 bg-card/60 p-6 text-center text-sm text-muted-foreground">
          No campaigns yet.
        </p>
      )}

      {rows.map((row) => {
        const ctr = row.impression_count ? ((row.click_count / row.impression_count) * 100).toFixed(1) : '0.0';
        return (
          <div key={row.id} className="space-y-4 rounded-2xl border border-border/60 bg-card/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input
                value={row.name}
                onChange={(e) => patch(row.id, { name: e.target.value })}
                className="h-9 max-w-xs font-semibold"
              />
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={row.is_active}
                    onCheckedChange={(v) => patch(row.id, { is_active: v })}
                  />
                  <span className="text-xs font-medium text-muted-foreground">
                    {row.is_active ? 'Live' : 'Paused'}
                  </span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => remove(row)}>
                  <Trash2 className="h-4 w-4 text-rose-400" />
                </Button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { icon: Eye, label: 'Views', value: row.impression_count },
                { icon: MousePointerClick, label: 'Clicks', value: row.click_count },
                { icon: SkipForward, label: 'Skips', value: row.skip_count },
                { icon: MousePointerClick, label: 'CTR', value: `${ctr}%` },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-xl border border-border/50 bg-background/40 p-2">
                  <Icon className="mx-auto h-3.5 w-3.5 text-primary" />
                  <p className="mt-1 text-sm font-bold text-foreground">{value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <select
                  value={row.kind}
                  onChange={(e) => patch(row.id, { kind: e.target.value as 'premium' | 'brand' })}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="premium">Premium promo</option>
                  <option value="brand">Brand / sponsor</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Advertiser</Label>
                <Input
                  value={row.advertiser ?? ''}
                  onChange={(e) => patch(row.id, { advertiser: e.target.value })}
                  placeholder="Univers Flow"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Headline</Label>
                <Input
                  value={row.headline}
                  onChange={(e) => patch(row.id, { headline: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Subtext</Label>
                <Textarea
                  value={row.subtext ?? ''}
                  onChange={(e) => patch(row.id, { subtext: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Button label</Label>
                <Input
                  value={row.cta_label}
                  onChange={(e) => patch(row.id, { cta_label: e.target.value })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Button link</Label>
                <Input
                  value={row.cta_url}
                  onChange={(e) => patch(row.id, { cta_url: e.target.value })}
                  placeholder="/premium or https://brand.com"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Duration (seconds)</Label>
                <Input
                  type="number"
                  min={3}
                  max={60}
                  value={row.duration_seconds}
                  onChange={(e) => patch(row.id, { duration_seconds: numField(e.target.value, 8) })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Show after every N songs</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={row.songs_interval}
                  onChange={(e) => patch(row.id, { songs_interval: numField(e.target.value, 3) })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Skip allowed after (seconds)</Label>
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={row.skip_after_seconds}
                  onChange={(e) => patch(row.id, { skip_after_seconds: numField(e.target.value, 5) })}
                  className="h-9"
                  disabled={!row.skippable}
                />
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Switch
                  checked={row.skippable}
                  onCheckedChange={(v) => patch(row.id, { skippable: v })}
                />
                <span className="text-xs font-medium text-muted-foreground">Skippable</span>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Priority (higher wins)</Label>
                <Input
                  type="number"
                  value={row.priority}
                  onChange={(e) => patch(row.id, { priority: numField(e.target.value, 0) })}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Starts at</Label>
                <Input
                  type="datetime-local"
                  value={row.starts_at ? row.starts_at.slice(0, 16) : ''}
                  onChange={(e) =>
                    patch(row.id, { starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })
                  }
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ends at</Label>
                <Input
                  type="datetime-local"
                  value={row.ends_at ? row.ends_at.slice(0, 16) : ''}
                  onChange={(e) =>
                    patch(row.id, { ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })
                  }
                  className="h-9"
                />
              </div>
            </div>

            {/* Image */}
            <div className="flex items-center gap-3">
              <div className="h-16 w-28 overflow-hidden rounded-xl border border-border/60 bg-background/40">
                {row.image_url ? (
                  <img src={row.image_url} alt={`${row.name} creative`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                    No image
                  </div>
                )}
              </div>
              <input
                ref={(el) => {
                  fileInputs.current[row.id] = el;
                }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadImage(row, file);
                  e.target.value = '';
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputs.current[row.id]?.click()}
                disabled={uploadingId === row.id}
                className="gap-1.5"
              >
                {uploadingId === row.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {row.image_url ? 'Replace image' : 'Upload image'}
              </Button>
            </div>

            <Button
              onClick={() => save(row)}
              disabled={savingId === row.id}
              className="w-full gap-1.5"
            >
              {savingId === row.id && <Loader2 className="h-4 w-4 animate-spin" />}
              Save campaign
            </Button>
          </div>
        );
      })}
    </div>
  );
}
