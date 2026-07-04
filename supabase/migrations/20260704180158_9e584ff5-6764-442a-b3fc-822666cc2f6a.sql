
-- Fix experiment_assignments: prevent users from tampering with conversion/variant/experiment fields.
DROP POLICY IF EXISTS "Users update own conversion" ON public.experiment_assignments;

CREATE OR REPLACE FUNCTION public.prevent_experiment_assignment_tamper()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_jwt_role text;
BEGIN
  BEGIN v_jwt_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN v_jwt_role := NULL; END;

  IF v_jwt_role = 'service_role'
     OR current_user IN ('service_role','postgres','supabase_admin')
     OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- Immutable fields: users cannot rewrite assignment identity or variant, and cannot
  -- un-convert or backdate their conversion. Only forward `converted=false -> true`
  -- with server-time `converted_at` is allowed.
  NEW.user_id       := OLD.user_id;
  NEW.experiment_id := OLD.experiment_id;
  NEW.variant       := OLD.variant;

  IF OLD.converted = true THEN
    NEW.converted    := OLD.converted;
    NEW.converted_at := OLD.converted_at;
  ELSIF NEW.converted = true THEN
    NEW.converted_at := now();
  ELSE
    NEW.converted_at := OLD.converted_at;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_experiment_assignment_tamper ON public.experiment_assignments;
CREATE TRIGGER trg_prevent_experiment_assignment_tamper
BEFORE UPDATE ON public.experiment_assignments
FOR EACH ROW EXECUTE FUNCTION public.prevent_experiment_assignment_tamper();

CREATE POLICY "Users update own conversion"
ON public.experiment_assignments
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Fix support_chats: add WITH CHECK and lock ownership/state fields for non-admin users.
DROP POLICY IF EXISTS "Users update own chat" ON public.support_chats;

CREATE OR REPLACE FUNCTION public.prevent_support_chat_tamper()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_jwt_role text;
BEGIN
  BEGIN v_jwt_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN v_jwt_role := NULL; END;

  IF v_jwt_role = 'service_role'
     OR current_user IN ('service_role','postgres','supabase_admin')
     OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- Non-admin end users cannot reassign ownership, flip status, or falsify counters.
  NEW.user_id          := OLD.user_id;
  IF to_jsonb(NEW) ? 'status' THEN
    NEW.status         := OLD.status;
  END IF;
  IF to_jsonb(NEW) ? 'unread_for_user' THEN
    NEW.unread_for_user  := OLD.unread_for_user;
  END IF;
  IF to_jsonb(NEW) ? 'unread_for_admin' THEN
    NEW.unread_for_admin := OLD.unread_for_admin;
  END IF;
  IF to_jsonb(NEW) ? 'last_message_at' THEN
    NEW.last_message_at  := OLD.last_message_at;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_support_chat_tamper ON public.support_chats;
CREATE TRIGGER trg_prevent_support_chat_tamper
BEFORE UPDATE ON public.support_chats
FOR EACH ROW EXECUTE FUNCTION public.prevent_support_chat_tamper();

CREATE POLICY "Users update own chat"
ON public.support_chats
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
