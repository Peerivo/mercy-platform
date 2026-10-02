#!/usr/bin/env bash
# Read-only inspection on the existing pinned Beget target. No secret output.
set -euo pipefail
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000'
test "$(docker inspect -f '{{.State.Running}}' supabase-db)" = true
test "$(docker inspect -f '{{.State.Running}}' living-menaion-rest)" = true
test -s "$HOME/.living-menaion/deploy-cert.pem"
test -s "$HOME/.living-menaion/deploy-private.pem"
# Public certificate only. Never read/export the private key.
openssl x509 -in "$HOME/.living-menaion/deploy-cert.pem" -checkend 86400 -noout >/dev/null
printf 'PUBLIC_DEPLOYMENT_CERTIFICATE_BEGIN\n'
openssl x509 -in "$HOME/.living-menaion/deploy-cert.pem" -outform PEM
printf 'PUBLIC_DEPLOYMENT_CERTIFICATE_END\n'
openssl x509 -in "$HOME/.living-menaion/deploy-cert.pem" -noout -fingerprint -sha256

state="$(docker exec -e PGOPTIONS="$PGOPTIONS" -i supabase-db psql -X -U supabase_admin -d living_menaion -At -v ON_ERROR_STOP=1 2>/dev/null <<'SQL'
select jsonb_build_object(
  'database', current_database(),
  'ledger', (select coalesce(jsonb_agg(jsonb_build_object('version',version,'checksum',checksum) order by version),'[]'::jsonb)
    from (select version, checksum from public.living_menaion_schema_migrations order by version limit 65) ledger),
  'required_base_roles', (select count(*) = 3 from pg_roles where rolname in ('living_menaion_owner','living_menaion_app','service_role')),
  'content_present', to_regclass('living_menaion.pronunciation_entries') is not null,
  'new_role_names_unused', not exists (select from pg_roles where rolname in ('menaion_feedback_submit','menaion_feedback_writer','menaion_rest_authenticator')),
  'new_schema_names_unused', not exists (select from pg_namespace where nspname in ('menaion_feedback','menaion_feedback_private'))
);
SQL
)" || { echo 'Database inspection failed' >&2; exit 1; }
printf '%s' "$state" | python3 -c '
import json,re,sys
state=json.load(sys.stdin)
ledger=state.get("ledger")
if not isinstance(ledger,list) or len(ledger)>64: raise SystemExit("Invalid migration ledger")
for row in ledger:
    if not isinstance(row,dict) or not isinstance(row.get("version"),str) or not isinstance(row.get("checksum"),str): raise SystemExit("Invalid migration ledger")
    if not re.fullmatch(r"[0-9]{14}",row["version"]) or not re.fullmatch(r"[0-9a-f]{64}",row["checksum"]): raise SystemExit("Invalid migration ledger")
print(json.dumps(state))
'

# Inspect runtime in memory; emit only allowlisted booleans/categories, never a URI,
# password, JWT, signing key, or complete environment. No runtime file is changed.
python3 - <<'PY'
import json, subprocess
from urllib.parse import urlsplit, unquote
try:
    raw = json.loads(subprocess.check_output(['docker','inspect','living-menaion-rest']))
    assert len(raw) == 1
    env = {}
    for item in raw[0]['Config']['Env']:
        name, sep, value = item.partition('=')
        if name in env: raise SystemExit('Duplicate runtime setting; inspection refused')
        env[name] = value
    uri = urlsplit(env.get('PGRST_DB_URI',''))
    schemas = [x.strip() for x in env.get('PGRST_DB_SCHEMAS','').split(',')]
    aud = env.get('PGRST_JWT_AUD','')
    print(json.dumps({'environment_observations_only': True, 'effective_runtime_verified': False, 'runtime': {
      'uri_shape_recognized': uri.scheme in ('postgres','postgresql') and not uri.query and not uri.fragment,
      'database_is_living_menaion': unquote(uri.path) == '/living_menaion',
      'database_host_is_supabase_db': uri.hostname == 'supabase-db',
      'authenticator_is_shared': unquote(uri.username or '') == 'authenticator',
      'authenticator_is_dedicated': unquote(uri.username or '') == 'menaion_rest_authenticator',
      'content_schema_exposed': 'living_menaion' in schemas,
      'private_schema_exposed': 'menaion_feedback_private' in schemas,
      'feedback_schema_exposed': 'menaion_feedback' in schemas,
      'audience': 'unset' if not aud else 'feedback' if aud == 'menaion-feedback' else 'other_requires_review'
    }}))
except Exception:
    raise SystemExit('Runtime inspection failed; no configuration disclosed')
PY
