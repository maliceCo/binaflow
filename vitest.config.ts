import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          include: [
            'test/architecture-boundaries.test.ts',
            'test/core-contracts.test.ts',
            'test/engine.test.ts',
            'test/interactive-review-contracts.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'application',
          include: [
            'test/application-*.test.ts',
            'test/execution-host*.test.ts',
            'test/guided-*.test.ts',
            'test/interactive-review-{persistence,workflow}.test.ts',
            'test/plan-build-qa-*.test.ts',
            'test/preparation*.test.ts',
            'test/project-transfer.test.ts',
            'test/research-workflow.test.ts',
            'test/task-contract*.test.ts',
            'test/todo-build-qa-workflow.test.ts',
            'test/workflow-surface-contract.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'cli',
          include: ['test/cli.test.ts', 'test/cli-*.test.ts'],
        },
      },
      {
        test: {
          name: 'tui',
          include: ['test/tui-*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'web',
          include: [
            'test/web-*.test.{ts,tsx}',
            'test/{device-identity,peer-auth,peer-transfer,peer-transport,project-browser,project-catalog,transfer-journal}.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'infrastructure',
          include: [
            'test/{artifacts,config,config-operations,data-directory-lock,directory-package,git-transfer,git-workspace,migrations,persistence,pi-discovery,public-sources,qa-history,sqlite-portability,update,workspace-execution}.test.ts',
            'test/portability-*.test.ts',
            'test/drivers/contract.test.ts',
          ],
        },
      },
    ],
  },
});
