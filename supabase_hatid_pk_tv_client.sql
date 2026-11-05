-- HATID pick-up TV: show the client's name beside the queue number (Rommel 2026-11-05)
CREATE OR REPLACE FUNCTION public.pk_tv(p_site text)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select jsonb_build_object('site', p_site, 'now', now(), 'visits', coalesce(jsonb_agg(jsonb_build_object('label', v.label, 'series', v.series, 'status', v.status,
           'at', v.arrived_at, 'ready_at', v.ready_at, 'client', coalesce(btrim(v.client_name), ''),
           'so', (select coalesce(jsonb_agg(o.so_no order by o.so_no), '[]') from pk_visit_orders vo join pk_orders o on o.id = vo.order_id
                  where vo.visit_id = v.id and nullif(btrim(o.so_no), '') is not null))
         order by v.series, v.queue_no), '[]'))
    from pk_visits v where v.site = p_site and v.queue_day = pk_today() and v.status in ('waiting','notified','accepted','ready');
$function$;
