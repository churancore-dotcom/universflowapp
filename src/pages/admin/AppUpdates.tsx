import { confirmAction } from '@/lib/confirmDialog';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Download, Trash2, Smartphone, CheckCircle2 } from 'lucide-react';

interface AppVersion {
  id: string;
  version_code: number;
  version_name: string;
  apk_url: string;
  release_notes: string | null;
  is_mandatory: boolean;
  is_active: boolean;
  min_supported_version_code: number;
  created_at: string;
}

export default function AppUpdates() {
  const [versions, setVersions] = useState<AppVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    version_code: '',
    version_name: '',
    apk_url: '',
    release_notes: '',
    is_mandatory: false,
    min_supported_version_code: '0',
  });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .order('version_code', { ascending: false });
    if (error) {
      toast.error('Failed to load versions');
    } else {
      setVersions((data as AppVersion[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = Number(form.version_code);
    if (!Number.isFinite(code) || code < 1) {
      toast.error('Version code must be a positive number');
      return;
    }
    if (!form.version_name.trim() || !form.apk_url.trim()) {
      toast.error('Version name and APK URL are required');
      return;
    }

    setSaving(true);

    // Deactivate older active rows so only the new one is current
    await supabase.from('app_versions').update({ is_active: false }).eq('is_active', true);

    const { error } = await supabase.from('app_versions').insert({
      version_code: code,
      version_name: form.version_name.trim(),
      apk_url: form.apk_url.trim(),
      release_notes: form.release_notes.trim() || null,
      is_mandatory: form.is_mandatory,
      is_active: true,
      min_supported_version_code: Number(form.min_supported_version_code) || 0,
    });

    if (error) {
      setSaving(false);
      toast.error(error.message);
      return;
    }

    // Notify everyone with an in-app announcement so they actually see the update
    const { data: { user } } = await supabase.auth.getUser();
    const annErr = await supabase.from('announcements').insert({
      title: `🚀 New update available — v${form.version_name.trim()}`,
      message: form.release_notes.trim()
        ? `What's new:\n${form.release_notes.trim()}\n\nOpen Settings → Check for updates to install.`
        : `A new version of Universflow is ready. Open Settings → Check for updates to install.`,
      type: 'info',
      target_audience: 'all',
      created_by: user?.id,
    });

    setSaving(false);

    if (annErr.error) {
      toast.success('Update published (announcement failed: ' + annErr.error.message + ')');
    } else {
      toast.success('Update published & users notified');
    }
    setForm({
      version_code: '',
      version_name: '',
      apk_url: '',
      release_notes: '',
      is_mandatory: false,
      min_supported_version_code: '0',
    });
    load();
  };

  const setActive = async (id: string) => {
    await supabase.from('app_versions').update({ is_active: false }).eq('is_active', true);
    const { error } = await supabase.from('app_versions').update({ is_active: true }).eq('id', id);
    if (error) toast.error(error.message);
    else {
      toast.success('Set as active version');
      load();
    }
  };

  const remove = async (id: string) => {
    if (!await confirmAction('Delete this version?')) return;
    const { error } = await supabase.from('app_versions').delete().eq('id', id);
    if (error) toast.error(error.message);
    else {
      toast.success('Deleted');
      load();
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Smartphone className="size-6 text-[#FF2D55]" />
          App Updates
        </h1>
        <p className="text-sm text-white/60 mt-1">
          Publish a new APK version. Users on the old APK will see an in-app banner prompting them to download the update.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:p-5 space-y-4"
      >
        <h2 className="text-sm font-semibold text-white/90">Publish new version</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-white/60">Version code *</Label>
            <Input
              type="number"
              min={1}
              placeholder="e.g. 5"
              value={form.version_code}
              onChange={(e) => setForm({ ...form, version_code: e.target.value })}
              className="bg-white/5 border-white/10"
            />
            <p className="text-[10px] text-white/40 mt-1">Integer. Higher = newer.</p>
          </div>
          <div>
            <Label className="text-xs text-white/60">Version name *</Label>
            <Input
              placeholder="e.g. 1.2.0"
              value={form.version_name}
              onChange={(e) => setForm({ ...form, version_name: e.target.value })}
              className="bg-white/5 border-white/10"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs text-white/60">APK download URL *</Label>
          <Input
            type="url"
            placeholder="https://github.com/.../universflow.apk"
            value={form.apk_url}
            onChange={(e) => setForm({ ...form, apk_url: e.target.value })}
            className="bg-white/5 border-white/10"
          />
          <p className="text-[10px] text-white/40 mt-1">
            Direct .apk link (GitHub release, your CDN, etc.)
          </p>
        </div>

        <div>
          <Label className="text-xs text-white/60">Release notes</Label>
          <Textarea
            rows={4}
            placeholder="What's new in this version..."
            value={form.release_notes}
            onChange={(e) => setForm({ ...form, release_notes: e.target.value })}
            className="bg-white/5 border-white/10"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
            <div>
              <Label className="text-xs text-white/80">Mandatory</Label>
              <p className="text-[10px] text-white/40">Block app until updated</p>
            </div>
            <Switch
              checked={form.is_mandatory}
              onCheckedChange={(v) => setForm({ ...form, is_mandatory: v })}
            />
          </div>
          <div>
            <Label className="text-xs text-white/60">Min supported code</Label>
            <Input
              type="number"
              min={0}
              value={form.min_supported_version_code}
              onChange={(e) => setForm({ ...form, min_supported_version_code: e.target.value })}
              className="bg-white/5 border-white/10"
            />
            <p className="text-[10px] text-white/40 mt-1">Below this → forced update</p>
          </div>
        </div>

        <Button
          type="submit"
          disabled={saving}
          className="w-full bg-gradient-to-r from-[#FF2D55] to-[#FF6B9D] hover:opacity-90"
        >
          {saving ? 'Publishing...' : 'Publish update'}
        </Button>
      </form>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-white/90">History</h2>
        {loading ? (
          <p className="text-sm text-white/50">Loading...</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-white/50">No versions published yet.</p>
        ) : (
          versions.map((v) => (
            <div
              key={v.id}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white">v{v.version_name}</span>
                  <span className="text-[10px] text-white/40">code {v.version_code}</span>
                  {v.is_active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center gap-1">
                      <CheckCircle2 className="size-2.5" /> active
                    </span>
                  )}
                  {v.is_mandatory && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                      mandatory
                    </span>
                  )}
                </div>
                {v.release_notes && (
                  <p className="text-xs text-white/60 mt-1 line-clamp-2 whitespace-pre-wrap">
                    {v.release_notes}
                  </p>
                )}
                <a
                  href={v.apk_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-[#FF6B9D] hover:underline truncate block mt-1"
                >
                  {v.apk_url}
                </a>
              </div>
              <div className="flex flex-col gap-1">
                {!v.is_active && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setActive(v.id)}
                    className="h-7 text-[11px] text-white/70 hover:text-white"
                  >
                    Activate
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => window.open(v.apk_url, '_blank')}
                  className="h-7 text-[11px] text-white/70"
                >
                  <Download className="size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(v.id)}
                  className="h-7 text-[11px] text-red-400 hover:text-red-300"
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
