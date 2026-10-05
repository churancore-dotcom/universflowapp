DROP TRIGGER IF EXISTS validate_payment_request_pricing_trigger ON public.payment_requests;
CREATE TRIGGER validate_payment_request_pricing_trigger
BEFORE INSERT OR UPDATE OF plan, amount_paise ON public.payment_requests
FOR EACH ROW
EXECUTE FUNCTION public.validate_payment_request_pricing();