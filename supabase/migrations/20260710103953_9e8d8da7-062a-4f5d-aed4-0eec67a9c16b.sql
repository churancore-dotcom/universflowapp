
CREATE OR REPLACE FUNCTION public.enforce_friends_pending_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_jwt_role text;
BEGIN
  BEGIN v_jwt_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN v_jwt_role := NULL; END;

  IF v_jwt_role = 'service_role'
     OR current_user IN ('service_role','postgres','supabase_admin')
     OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  NEW.status := 'pending';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_friends_pending_on_insert ON public.friends;
CREATE TRIGGER trg_friends_pending_on_insert
  BEFORE INSERT ON public.friends
  FOR EACH ROW EXECUTE FUNCTION public.enforce_friends_pending_on_insert();
