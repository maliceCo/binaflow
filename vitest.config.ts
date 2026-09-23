import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          testNamePattern:
            /(?:composes optional project instructions after the workflow prompt|is portable and serializable without harness-specific settings|rejects a dependency cycle before execution|rejects duplicate input-reference names and unreachable step-output refs|rejects malformed input and output contracts before execution|accepts the planner contract and rejects incomplete output|is serializable and keeps harness tools out of the workflow|runs plan before build and gives the builder the validated artifact|rejects resume when the persisted workflow version is incompatible|resumes a failed builder without rerunning the completed planner)$/,
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
          testNamePattern:
            /(?:emits a versioned JSON workflow contract without opening workspace storage|rejects conflicting machine output modes|reads machine-output flags only before the bare -- delimiter|emits a correlatable JSONL failure record|aborts and joins active work before closing context after stdout failure|defers second-signal force until operation and context cleanup complete|shows help for a no-argument non-TTY invocation|rejects the explicit TUI command without a TTY|keeps JSONL run lifecycle records ordered|keeps machine JSON stdout free of human progress text)$/,
          include: ['test/cli.test.ts', 'test/cli-*.test.ts'],
        },
      },
      {
        test: {
          name: 'tui',
          testNamePattern:
            /(?:rejects a second operation and keeps the context open until the first finishes|drains tracked requests before closing an owned context|aborts an attached operation before force cancellation|rejects new operations synchronously once shutdown starts|waits for a live snapshot request before closing its context|writes first-run setup only after review and confirmation|does not overwrite a configuration created before setup confirmation|does not write an edited profile when the configuration flow is cancelled|corrects required input and requires review before write-capable launch|invalidates confirmation when reviewed profile settings change)$/,
          include: ['test/tui-*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'web',
          testNamePattern:
            /(?:rejects unknown fields and requires TLS for non-loopback hosts|recovers cleanly when the port is occupied before listen succeeds|supports login, CSRF-protected logout, expiry, and bounded sessions|serves only explicit assets and protects session mutations|previews a waiting execution resume without exposing internal paths|maps a task that is not ready to a specific conflict|previews and starts without exposing workspace paths|does not expose an unavailable capability as a server error|sanitizes internal failures while preserving public error categories|validates transfer commands without accepting server paths)$/,
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
