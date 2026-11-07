ALTER TABLE public.account_deletion_requests ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'Prefer not to say', ADD COLUMN IF NOT EXISTS feedback text NOT NULL DEFAULT '';
GRANT SELECT ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;
CREATE POLICY "Admins read deletion requests" ON public.account_deletion_requests FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.request_account_deletion_with_feedback(_reason text, _details text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_deadline timestamptz; v_existing public.account_deletion_requests;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF _reason NOT IN ('Playback or audio issues','Songs or discovery','Too expensive','Privacy concerns','Not using the app','Other','Prefer not to say') OR _reason IS NULL THEN RAISE EXCEPTION 'Invalid reason'; END IF;
 IF char_length(coalesce(_details,'')) > 1500 THEN RAISE EXCEPTION 'Feedback too long'; END IF;
 PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() FOR UPDATE;
 SELECT * INTO v_existing FROM public.account_deletion_requests WHERE user_id=auth.uid() FOR UPDATE;
 IF FOUND AND v_existing.cancelled_at IS NULL THEN RETURN v_existing.delete_after; END IF;
 v_deadline := now() + interval '7 days';
 INSERT INTO public.account_deletion_requests(user_id,requested_at,delete_after,cancelled_at,completed_at,reason,feedback)
 VALUES(auth.uid(),now(),v_deadline,NULL,NULL,_reason,coalesce(_details,''))
 ON CONFLICT(user_id) DO UPDATE SET requested_at=excluded.requested_at,delete_after=excluded.delete_after,cancelled_at=NULL,completed_at=NULL,reason=excluded.reason,feedback=excluded.feedback;
 RETURN v_deadline;
END $$;
REVOKE ALL ON FUNCTION public.request_account_deletion_with_feedback(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion_with_feedback(text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.request_account_deletion() RETURNS timestamptz LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT public.request_account_deletion_with_feedback('Prefer not to say',''); $$;

CREATE OR REPLACE FUNCTION public.admin_account_deletion_requests(_offset integer DEFAULT 0, _status text DEFAULT 'pending')
RETURNS TABLE(user_id uuid,email text,username text,requested_at timestamptz,delete_after timestamptz,cancelled_at timestamptz,completed_at timestamptz,reason text,feedback text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
 IF _offset < 0 OR _status NOT IN ('pending','cancelled','all') THEN RAISE EXCEPTION 'Invalid filter'; END IF;
 RETURN QUERY SELECT d.user_id,p.email,p.username,d.requested_at,d.delete_after,d.cancelled_at,d.completed_at,d.reason,d.feedback
 FROM public.account_deletion_requests d LEFT JOIN public.profiles p ON p.user_id=d.user_id
 WHERE _status='all' OR (_status='pending' AND d.cancelled_at IS NULL AND d.completed_at IS NULL) OR (_status='cancelled' AND d.cancelled_at IS NOT NULL)
 ORDER BY d.requested_at DESC LIMIT 50 OFFSET _offset;
END $$;
REVOKE ALL ON FUNCTION public.admin_account_deletion_requests(integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_account_deletion_requests(integer,text) TO authenticated;

CREATE TABLE public.account_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
 event_key text NOT NULL UNIQUE,
 kind text NOT NULL,
 title text NOT NULL,
 message text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz
);
GRANT SELECT ON public.account_notices TO authenticated;
GRANT UPDATE(read_at) ON public.account_notices TO authenticated;
GRANT ALL ON public.account_notices TO service_role;
ALTER TABLE public.account_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read account notices" ON public.account_notices FOR SELECT TO authenticated USING(auth.uid()=user_id);
CREATE POLICY "Owners acknowledge account notices" ON public.account_notices FOR UPDATE TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE INDEX account_notices_unread ON public.account_notices(user_id,created_at) WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION public.record_premium_notice(_user_id uuid,_event_key text,_kind text,_title text,_message text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 INSERT INTO public.account_notices(user_id,event_key,kind,title,message) VALUES(_user_id,_event_key,_kind,_title,_message) ON CONFLICT(event_key) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NOT NULL THEN PERFORM public.notify_system_push(ARRAY[_user_id],_title,_message,'/premium'); END IF;
 RETURN v_id IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.record_premium_notice(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_premium_notice(uuid,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.on_premium_activated() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_was_premium boolean := false; v_is_premium boolean;
BEGIN
 v_is_premium := NEW.status='active' AND NEW.subscription_type IN ('premium_monthly','premium_yearly') AND (NEW.expires_at IS NULL OR NEW.expires_at>now());
 IF TG_OP='UPDATE' THEN v_was_premium := OLD.status='active' AND OLD.subscription_type IN ('premium_monthly','premium_yearly') AND (OLD.expires_at IS NULL OR OLD.expires_at>now()); END IF;
 IF v_is_premium AND (NOT v_was_premium OR (TG_OP='UPDATE' AND NEW.expires_at IS DISTINCT FROM OLD.expires_at)) THEN
 NEW.notif_activated_at:=now(); NEW.notif_warn_3d_at:=NULL; NEW.notif_warn_1d_at:=NULL; NEW.notif_expired_at:=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.after_premium_notice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status='active' AND NEW.subscription_type IN ('premium_monthly','premium_yearly') AND (NEW.expires_at IS NULL OR NEW.expires_at>now()) THEN
 IF TG_OP='INSERT' OR NEW.notif_activated_at IS DISTINCT FROM OLD.notif_activated_at THEN
 PERFORM public.record_premium_notice(NEW.user_id,NEW.id::text||':'||coalesce(NEW.expires_at::text,'unlimited')||':activated:'||NEW.notif_activated_at::text,'activated','Premium is active',CASE WHEN NEW.expires_at IS NULL THEN 'Your Premium access is ready.' ELSE 'Your Premium access is ready. It ends on '||to_char(NEW.expires_at AT TIME ZONE 'UTC','DD Mon YYYY HH24:MI')||' UTC.' END);
 END IF; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.after_premium_notice() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER account_premium_notice AFTER INSERT OR UPDATE ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION public.after_premium_notice();

CREATE OR REPLACE FUNCTION public.process_premium_expiry_notifications() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; v_warn integer:=0; v_exp integer:=0; v_key text;
BEGIN
 FOR r IN SELECT * FROM public.user_subscriptions WHERE subscription_type IN ('premium_monthly','premium_yearly') AND expires_at IS NOT NULL AND ((status='active' AND expires_at<=now()+interval '3 days') OR (status='expired' AND notif_expired_at IS NULL)) FOR UPDATE SKIP LOCKED LOOP
 v_key := r.id::text||':'||r.expires_at::text||':'||coalesce(r.notif_activated_at::text,'legacy');
 IF r.expires_at<=now() AND r.notif_expired_at IS NULL THEN
 PERFORM public.record_premium_notice(r.user_id,v_key||':expired','expired','Your Premium has ended','Your account is now on Free. Your library and free downloads are still available.');
 UPDATE public.user_subscriptions SET status='expired',notif_expired_at=now(),updated_at=now() WHERE id=r.id;
 v_exp:=v_exp+1;
 ELSIF r.expires_at>now() AND r.expires_at<=now()+interval '1 day' AND r.notif_warn_1d_at IS NULL THEN
 PERFORM public.record_premium_notice(r.user_id,v_key||':1d','expiring_1d','Premium ends within 24 hours','Your Premium ends on '||to_char(r.expires_at AT TIME ZONE 'UTC','DD Mon YYYY HH24:MI')||' UTC.');
 UPDATE public.user_subscriptions SET notif_warn_1d_at=now(),notif_warn_3d_at=coalesce(notif_warn_3d_at,now()) WHERE id=r.id; v_warn:=v_warn+1;
 ELSIF r.expires_at>now()+interval '1 day' AND r.expires_at<=now()+interval '3 days' AND r.notif_warn_3d_at IS NULL THEN
 PERFORM public.record_premium_notice(r.user_id,v_key||':3d','expiring_3d','Premium ends within 3 days','Your Premium ends on '||to_char(r.expires_at AT TIME ZONE 'UTC','DD Mon YYYY HH24:MI')||' UTC.');
 UPDATE public.user_subscriptions SET notif_warn_3d_at=now() WHERE id=r.id; v_warn:=v_warn+1;
 END IF;
 END LOOP;
 RETURN jsonb_build_object('warnings',v_warn,'expired',v_exp);
END $$;
REVOKE ALL ON FUNCTION public.process_premium_expiry_notifications() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_premium_expiry_notifications() TO service_role;