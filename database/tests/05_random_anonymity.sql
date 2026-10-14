-- Campus+ database tests — 05 retired Random Chat privilege boundary
set role postgres;
do $$ declare sig text; begin
 foreach sig in array array['can_access_random_session(uuid,uuid)','end_random_session(uuid,text)','join_random_queue()','leave_random_queue()','random_other_participant(uuid,uuid)','random_queue_state()','random_session_state(uuid)','report_random_session(uuid,text,text)','send_random_message(uuid,text,jsonb)'] loop
  perform public.test_assert(not has_function_privilege('authenticated', 'public.'||sig, 'EXECUTE'), 'retired Random RPC must remain unavailable: '||sig);
  perform public.test_assert(not has_function_privilege('anon', 'public.'||sig, 'EXECUTE'), 'retired Random RPC must remain anonymous-inaccessible: '||sig);
 end loop;
 perform public.test_assert(to_regprocedure('public.purge_random_data(integer)') is not null,'maintenance purge remains unchanged');
 perform public.test_assert(to_regprocedure('public.sweep_random_state()') is not null,'maintenance sweep remains unchanged');
end $$;
