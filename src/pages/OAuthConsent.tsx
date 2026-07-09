import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type AuthOAuth = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

function oauthApi(): AuthOAuth {
  return (supabase.auth as unknown as { oauth: AuthOAuth }).oauth;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization request.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      try {
        const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) {
          setError(error.message ?? "Could not load this authorization request.");
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      } catch (e: any) {
        if (active) setError(e?.message ?? String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const api = oauthApi();
      const { data, error } = approve
        ? await api.approveAuthorization(authorizationId)
        : await api.denyAuthorization(authorizationId);
      if (error) {
        setBusy(false);
        setError(error.message ?? "Could not complete this request.");
        return;
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setBusy(false);
        setError("No redirect returned by the authorization server.");
        return;
      }
      window.location.href = target;
    } catch (e: any) {
      setBusy(false);
      setError(e?.message ?? String(e));
    }
  }

  return (
    <main className="min-h-[100dvh] bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card/60 backdrop-blur p-6 space-y-5">
        {error ? (
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Authorization error</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : !details ? (
          <p className="text-sm text-muted-foreground">Loading authorization…</p>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">
                Connect {details.client?.name ?? "an app"} to Univers Flow
              </h1>
              <p className="text-sm text-muted-foreground">
                This lets {details.client?.name ?? "the client"} use Univers Flow tools as you.
              </p>
            </div>
            <div className="rounded-xl border border-border p-3 text-sm space-y-1">
              <div>
                <span className="text-muted-foreground">Client:</span>{" "}
                <span className="font-medium">{details.client?.name ?? "Unknown"}</span>
              </div>
              {details.client?.redirect_uri && (
                <div className="break-all">
                  <span className="text-muted-foreground">Redirects to:</span>{" "}
                  {details.client.redirect_uri}
                </div>
              )}
              {details.scope && (
                <div>
                  <span className="text-muted-foreground">Scope:</span> {details.scope}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              This does not bypass Univers Flow permissions or backend policies.
            </p>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => decide(true)}
                className="flex-1 rounded-full bg-primary text-primary-foreground py-2.5 font-medium disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={() => decide(false)}
                className="flex-1 rounded-full border border-border py-2.5 font-medium disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
