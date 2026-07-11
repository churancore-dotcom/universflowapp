
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

ALTER TABLE public.friends DROP CONSTRAINT IF EXISTS friends_status_check;
ALTER TABLE public.friends ADD CONSTRAINT friends_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'blocked'::text]));

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

  -- End users may only create a pending friend request OR a blocked entry.
  IF NEW.status NOT IN ('pending', 'blocked') THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$function$;
