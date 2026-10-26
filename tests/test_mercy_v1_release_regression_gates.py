from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReleaseRegressionGates(unittest.TestCase):
    def test_ci_runs_all_regression_suites(self):
        ci = (ROOT / '.github/workflows/ci.yml').read_text()
        for command in ['npm run lint', 'npm run typecheck', 'npm test',
                        'npm run build', 'supabase db reset --no-seed',
                        'supabase test db supabase/tests/access.sql',
                        'npm run test:integration', 'npm run test:e2e']:
            with self.subTest(command=command):
                self.assertIn(command, ci)

    def test_deploy_requires_exact_main_regression_success(self):
        deploy = (ROOT / '.github/workflows/deploy-reg-ru.yml').read_text()
        for condition in ['Require all regression suites green on exact main commit',
                          'head_sha=${GITHUB_SHA}', '.conclusion == "success"',
                          'current_main', 'production_changed=1',
                          'REG_RU_CANDIDATE_READY']:
            with self.subTest(condition=condition):
                self.assertIn(condition, deploy)

    def test_role_migration_is_exact_sha_and_transactional(self):
        migration = (ROOT / '.github/workflows/mercy-v1-roles-migrate.yml').read_text()
        for condition in ['APPLY_MERCY_V1_ROLES', 'head_sha=${GITHUB_SHA}',
                          'read-only database preflight', '--single-transaction',
                          "if: ${{ inputs.operation == 'APPLY' }}",
                          'Row-level security',
                          'docker exec -i supabase-db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -At']:
            with self.subTest(condition=condition):
                self.assertIn(condition.lower(), migration.lower())


if __name__ == '__main__':
    unittest.main()
