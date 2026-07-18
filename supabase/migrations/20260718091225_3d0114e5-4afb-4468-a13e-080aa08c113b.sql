CREATE OR REPLACE FUNCTION public.enforce_friends_pending_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_jwt_role text;
BEGIN
  BEGIN v_jwt_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN v_jwt_role := NULL; END;

  IF v_jwt_role = 'service_role'
     OR current_user IN ('service_role','postgres','supabase_admin')
     OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- End users may only create a pending friend request. Transitioning to
  -- 'blocked' requires an authorized UPDATE path, never a direct INSERT.
  NEW.status := 'pending';
  RETURN NEW;
END;
$function$;