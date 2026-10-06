#!/usr/bin/env bash
# Fixed reviewed target; schema only, never runtime/auth/Notify activation.
set -euo pipefail
umask 077
root="${1:?isolated temporary directory required}"
mode="${2:?INSPECT or APPLY required}"
[[ "$root" =~ ^/tmp/menaion-issue-package\.[A-Za-z0-9]+$ ]]
[[ "$mode" = INSPECT || "$mode" = APPLY ]]
test -d "$root" && test ! -L "$root"
test "$(stat -c '%a' "$root")" = 700
test "$(stat -c '%u' "$root")" = "$(id -u)"
trap 'rm -rf -- "$root"' EXIT
stage='transport_target'
fail() {
  gate=not_applicable
  if [[ "$stage" = inspection_database || "$stage" = apply_database ]]; then
    gate="$(python3 "$root/build-transaction.py" diagnose "$root" 2>/dev/null)" || gate=database_unclassified
    # This value must be a fixed label from the reviewed builder, never raw stderr.
    case "$gate" in
      fixed_target|postgres_version|history_relation|history_structure|object_collision|queue_trigger_collision|rate_policy_collision|predecessor_roles|feedback_role|predecessor_objects|service_schema_usage|predecessor_rls|feedback_boundary|shared_authenticator|worker_privileges|policy11_authority|policy11_trigger|private_schema_usage|unledgered_policy11|history_mismatch|incomplete_history|role_attributes|role_memberships|content_policy|publisher_authority|pronunciation_catalog|moderation_tables|moderation_functions|publisher_function|queue_trigger|issue_tables|issue_functions|history_catalog|schema_catalog|predecessor_schema_catalog|pronunciation_predecessor|publisher_predecessor|issue_quota|predecessor_quota|legacy_submitter_authority|legacy_submitter_preservation|database_unclassified) ;;
      *) gate=database_unclassified;;
    esac
  fi
  printf 'MENAION_ISSUE_PACKAGE_FAILURE stage=%s gate=%s\n' "$stage" "$gate" >&2
  echo 'Menaion issue package outcome not confirmed; inspect before any retry.' >&2
  exit 1
}
# Neither environment overrides nor a selected Docker context may redirect the fixed target.
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || fail
docker_local=(docker --host unix:///var/run/docker.sock)
stage=input_files
for file in payload10.b64 payload12.b64 payload13.b64 pre13-guard.sql manifest.json contract.json build-transaction.py; do
  test -f "$root/$file" && test ! -L "$root/$file" || fail
done
check_hash() { test "$(sha256sum "$root/$1" 2>"$root/hash-error" | cut -d' ' -f1)" = "$2" || fail; }
stage=ciphertext_integrity
check_hash payload10.b64 '0462c0804ee37bb73edfbe468c16ccd5cfd5de69a7f1e1e108c4d50625e7fa57'
check_hash payload12.b64 '1bc348d8c88f45815a34defd25e77b44aa589892a4be150ff3dddeb2ae5ebe68'
check_hash payload13.b64 '3c84ef432b7ac4e0b7c46a14d4b8e6023818c01ddd0bf3722c0b937d430ea716'
stage=pre13_guard_integrity
check_hash pre13-guard.sql 'da9842f6392db9f8456b618e3fe705e59fde503a5e2a313d85b9cd15f3b5687f'
stage=manifest_integrity
check_hash manifest.json '613887b5920dcffae6cad1db2b107ba0f8e366ae8c21f809a0b31f7d2fbf91a6'
stage=contract_integrity
check_hash contract.json 'b4ba5f1c5950dc444f150d241b4a2e7311d798d00dcdefa1a3ae984aca1ad122'
stage=docker_running
test "$("${docker_local[@]}" inspect -f '{{.State.Running}}' supabase-db 2>"$root/transport-error")" = true || fail
stage=deployment_key_presence
test -s "$HOME/.living-menaion/deploy-private.pem" || fail
test -s "$HOME/.living-menaion/deploy-cert.pem" || fail
stage=certificate_validity
openssl x509 -in "$HOME/.living-menaion/deploy-cert.pem" -checkend 86400 -noout >/dev/null 2>&1 || fail
stage=certificate_identity
fingerprint="$(openssl x509 -in "$HOME/.living-menaion/deploy-cert.pem" -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)"
test "$fingerprint" = '1c445517d9fe95784a9caced337ce5f34b9132610afd1946f325bd5ad8d385c9' || fail
stage=inspection_build
python3 "$root/build-transaction.py" inspect "$root" 2>"$root/build-error" || fail
stage=inspection_database
"${docker_local[@]}" exec -e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=10000' \
  -i supabase-db env -u PGHOST -u PGHOSTADDR -u PGPORT -u PGSERVICE -u PGSERVICEFILE psql -X -qAt -w -U supabase_admin -d living_menaion -v ON_ERROR_STOP=1 \
  < "$root/inspection.sql" > "$root/inspection-result" 2> "$root/db-error" || fail
stage=inspection_output
mapfile -t inspection < "$root/inspection-result"
test "${#inspection[@]}" = 2 || fail
state="${inspection[0]}"
legacy="${inspection[1]}"
[[ "$legacy" =~ ^MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=(0|[1-9][0-9]{0,18})$ ]] || fail
case "$state" in
  MENAION_ISSUE_PACKAGE_13_PRESENT)
    printf '%s\n%s\n' "$state" "$legacy"
    [[ "$mode" = INSPECT ]] && exit 0
    stage=pre13_state
    fail
    ;;
  MENAION_ISSUE_PACKAGE_PRE13_LIVE_RATE_COUNTERS)
    printf '%s\n%s\n' "$state" "$legacy"
    [[ "$mode" = INSPECT ]] && exit 0
    stage=pre13_live_rate_counters
    fail
    ;;
  MENAION_ISSUE_PACKAGE_READY) ;;
  *) fail ;;
esac
if [[ "$mode" = INSPECT ]]; then
  printf '%s\n%s\n' "$state" "$legacy"
  exit 0
fi
for version in 10 12 13; do
  stage="decode_$version"
  base64 -d "$root/payload$version.b64" > "$root/payload$version.cms" 2>"$root/decode-error" || fail
  stage="decrypt_$version"
  openssl cms -decrypt -binary -inform DER -in "$root/payload$version.cms" \
    -recip "$HOME/.living-menaion/deploy-cert.pem" -inkey "$HOME/.living-menaion/deploy-private.pem" \
    -out "$root/migration$version.sql" 2>"$root/decrypt-error" || fail
done
stage=source10_integrity
check_hash migration10.sql 'ee2bf27553ca0a71baa275ad607b7ddbf0893e9e64d5687d8029d94bf592b499'
stage=source12_integrity
check_hash migration12.sql '57661d31ed4bc5f441b94a1b9f44b704e17ac6b98c390c8a4bddfcdd16a076a3'
stage=source13_integrity
check_hash migration13.sql '97dc3c7e3e76bdad2d3448dfbd75adef8c3f3c62ecd0248856b729c6d403cf2f'
stage=apply_build
python3 "$root/build-transaction.py" apply "$root" 2>"$root/build-error" || fail
# One transaction checks exact history under lock, skips recorded10/12, applies13,
# verifies all catalogs/unchanged roles/content11 and records missing ledger rows.
# Never print raw PostgreSQL errors, which may include private source or row data.
stage=apply_database
"${docker_local[@]}" exec -i supabase-db env -u PGHOST -u PGHOSTADDR -u PGPORT -u PGSERVICE -u PGSERVICEFILE -u PGOPTIONS psql -X -qAt -w -U supabase_admin -d living_menaion \
  -v ON_ERROR_STOP=1 < "$root/transaction.sql" > "$root/result" 2> "$root/db-error" || fail
stage=apply_output
mapfile -t result < "$root/result"
test "${#result[@]}" = 2 || fail
[[ "${result[0]}" =~ ^MENAION_ISSUE_PACKAGE_LEGACY_UNMAPPED_ATTEMPTED=(0|[1-9][0-9]{0,18})$ ]] || fail
test "${result[1]}" = MENAION_ISSUE_PACKAGE_VERIFIED || fail
printf '%s\n%s\n' MENAION_ISSUE_PACKAGE_VERIFIED "${result[0]}"
