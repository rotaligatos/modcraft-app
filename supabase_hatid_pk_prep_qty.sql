-- HATID pick-up: the warehouse records how many it actually prepared (Rommel 2026-11-05)
-- New line field prep_qty (only when less than what the client takes this time). A line with prep_qty is prepared,
-- but short: Sales Support is alerted in the app, and the automatic "READY for pick-up" text to the client is not
-- sent while anything is short (it would promise the full order). Logistics' load form starts from the prepared qty.

create or replace function public.pk_set_lines(p_order uuid, p_field text, p_vals jsonb)
 returns pk_orders language plpgsql security definer set search_path to 'public' as $function$
declare o pk_orders; me job_staff := pk_me(); v_all boolean; v_was timestamptz; v_short text;
begin
  if p_field not in ('want','prep','plan','prep_qty') then raise exception 'bad field'; end if;
  if not pk_can(case when p_field in ('want','plan') then array['sales_support'] else array['warehouse'] end) then
    raise exception '%', case when p_field in ('want','plan') then 'Only Sales Support can change what the client will pick up.' else 'Only the warehouse can tick lines as prepared.' end;
  end if;
  select * into o from pk_orders where id = p_order for update;
  if o.id is null or not pk_sees(o.company) then raise exception 'Ticket not found.'; end if;
  if o.status in ('done','no_show','cancelled') then raise exception 'This ticket is closed.'; end if;
  if p_field = 'plan' then
    update pk_orders set lines = (select jsonb_agg(case when p_vals ? (l->>'i') then
        case when nullif(p_vals->>(l->>'i'), '') is null or (p_vals->>(l->>'i'))::numeric >= (l->>'qty')::numeric - (l->>'taken')::numeric
             then l - 'plan'
             when (p_vals->>(l->>'i'))::numeric <= 0 then jsonb_set(l - 'plan', '{want}', 'false')
             else jsonb_set(jsonb_set(l, '{plan}', to_jsonb((p_vals->>(l->>'i'))::numeric)), '{want}', 'true') end
      else l end order by (l->>'i')::int) from jsonb_array_elements(lines) l), updated_at = now()
     where id = p_order returning * into o;
  elsif p_field = 'prep_qty' then
    -- blank or at least what the client takes = fully prepared; 0 = not prepared; in between = prepared, short
    update pk_orders set lines = (select jsonb_agg(case when p_vals ? (l->>'i') then
        case when nullif(p_vals->>(l->>'i'), '') is null
               or (p_vals->>(l->>'i'))::numeric >= coalesce(nullif(l->>'plan', '')::numeric, (l->>'qty')::numeric - (l->>'taken')::numeric)
             then jsonb_set(l - 'prep_qty', '{prep}', 'true')
             when (p_vals->>(l->>'i'))::numeric <= 0 then jsonb_set(l - 'prep_qty', '{prep}', 'false')
             else jsonb_set(jsonb_set(l, '{prep_qty}', to_jsonb((p_vals->>(l->>'i'))::numeric)), '{prep}', 'true') end
      else l end order by (l->>'i')::int) from jsonb_array_elements(lines) l), updated_at = now()
     where id = p_order returning * into o;
  else
    update pk_orders set lines = (select jsonb_agg(case when p_vals ? (l->>'i') then
        case when p_field = 'prep' and not (p_vals->>(l->>'i'))::boolean then jsonb_set(l - 'prep_qty', '{prep}', 'false')
             else jsonb_set(l, array[p_field], to_jsonb((p_vals->>(l->>'i'))::boolean)) end else l end order by (l->>'i')::int)
                                    from jsonb_array_elements(lines) l), updated_at = now()
     where id = p_order returning * into o;
  end if;
  select coalesce(bool_and((l->>'prep')::boolean), false) into v_all from jsonb_array_elements(o.lines) l
   where (l->>'want')::boolean and (l->>'qty')::numeric > (l->>'taken')::numeric;
  select string_agg((l->>'desc') || ': ' || trim(to_char((l->>'prep_qty')::numeric, 'FM999999990.##')) || ' of '
           || trim(to_char(coalesce(nullif(l->>'plan', '')::numeric, (l->>'qty')::numeric - (l->>'taken')::numeric), 'FM999999990.##')), '; ')
    into v_short from jsonb_array_elements(o.lines) l
   where (l->>'want')::boolean and (l->>'qty')::numeric > (l->>'taken')::numeric and nullif(l->>'prep_qty', '') is not null;
  v_was := o.prepared_at;
  update pk_orders set prepared_at = case when v_all then coalesce(prepared_at, now()) end,
                       prepared_name = case when v_all then coalesce(prepared_name, coalesce(me.name, me.email)) end
   where id = p_order returning * into o;
  if p_field = 'prep_qty' and v_short is not null then
    perform pk_log(o.id, null, 'prep_short', v_short);
    perform pk_notify(o.site, o.company, array['sales_support'], 'pickup_short', o.so_no || ' — warehouse prepared only part',
      coalesce(o.client_name || ' · ', '') || v_short || '. Tell the client before they come.', null);
  end if;
  if v_all and v_was is null and v_short is null then perform pk_msg_ready(o.id); end if;
  return o;
end $function$;
