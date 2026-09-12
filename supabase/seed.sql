-- FICTIONAL TEST DATA ONLY. Supabase CLI local seed; aborts unless explicitly enabled.
do $$begin if current_setting('app.mercy_allow_test_seed',true) is distinct from 'true' then raise exception 'Set app.mercy_allow_test_seed=true on a disposable local database';end if;end$$;
-- Auth fixtures and application rows are created by tests so identities receive valid Auth credentials.
