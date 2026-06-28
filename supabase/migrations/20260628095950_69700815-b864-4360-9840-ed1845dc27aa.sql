CREATE OR REPLACE FUNCTION public.prevent_profile_sensitive_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role'
     OR current_user IN ('service_role', 'postgres', 'supabase_admin')
     OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    NEW.email := OLD.email;
  END IF;
  IF NEW.share_code IS DISTINCT FROM OLD.share_code THEN
    NEW.share_code := OLD.share_code;
  END IF;
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    NEW.is_admin := OLD.is_admin;
  END IF;
  IF NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN
    NEW.email_verified := OLD.email_verified;
  END IF;
  IF NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at THEN
    NEW.email_verified_at := OLD.email_verified_at;
  END IF;
  -- Lock status so banned/suspended users cannot self-reinstate via PATCH.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$function$;