import type { Command } from 'commander';
import { inspectPackage } from '../../portability/directory-package.js';
import type {
  PortabilityExportPreview,
  PortabilityImportPreview,
  TransferManifest,
} from '../../application/portability.js';
import { cliUsageError, writeJsonResult } from '../protocol.js';

export function registerPortabilityCommands(cli: Command): void {
  cli
    .command('preview-export')
    .description('Preview a portable dataset export')
    .requiredOption('--request-id <uuid>', 'stable export request ID')
    .requiredOption('--output <path>', 'new transfer package directory')
    .action(async (options: { requestId: string; output: string }, command: Command) => {
      const root = rootOptions(command);
      rejectJsonl(root, 'preview-export');
      const context = await openPortabilityContext(root, true);
      try {
        const preview = await context.portability.previewExport({
          requestId: options.requestId,
          destination: options.output,
        });
        printPreview('preview-export', preview, root.json === true);
      } finally {
        context.close();
      }
    });

  cli
    .command('export')
    .description('Create and publish a portable dataset export')
    .requiredOption('--request-id <uuid>', 'stable export request ID')
    .requiredOption('--digest <sha256>', 'digest returned by preview-export')
    .requiredOption('--output <path>', 'new transfer package directory')
    .action(
      async (options: { requestId: string; digest: string; output: string }, command: Command) => {
        const root = rootOptions(command);
        rejectJsonl(root, 'export');
        const context = await openPortabilityContext(root, true);
        try {
          const result = await context.portability.exportPackage({
            requestId: options.requestId,
            digest: options.digest,
            destination: options.output,
          });
          if (root.json)
            writeJsonResult('export', sanitizeTransfer(result.transfer, result.packagePath));
          else {
            console.log(`Exported transfer ${result.transfer.transferId}`);
            console.log(`  package=${result.packagePath}`);
            console.log(`  state=exported (source is now frozen)`);
          }
        } finally {
          context.close();
        }
      },
    );

  cli
    .command('cancel-export')
    .description('Cancel an export intent before publication')
    .requiredOption('--request-id <uuid>', 'export request ID')
    .requiredOption('--digest <sha256>', 'digest returned by preview-export')
    .action(async (options: { requestId: string; digest: string }, command: Command) => {
      const root = rootOptions(command);
      rejectJsonl(root, 'cancel-export');
      const context = await openPortabilityContext(root, true);
      try {
        const state = await context.portability.cancelExportIntent(options);
        if (root.json) writeJsonResult('cancel-export', { state: state.state });
        else console.log(`Export intent cancelled; dataset state=${state.state}`);
      } finally {
        context.close();
      }
    });

  cli
    .command('inspect')
    .description('Inspect a portable transfer package without opening the configured dataDir')
    .argument('<package>', 'transfer package directory')
    .action(async (packagePath: string, _options: unknown, command: Command) => {
      const root = rootOptions(command);
      rejectJsonl(root, 'inspect');
      const manifest = await inspectPackage(packagePath);
      if (root.json) writeJsonResult('inspect', sanitizeManifest(manifest));
      else printManifest(manifest);
    });

  cli
    .command('preview-import')
    .description('Preview importing a portable dataset into a new dataDir')
    .requiredOption('--package <path>', 'transfer package directory')
    .requiredOption('--output-data-dir <path>', 'new destination dataDir')
    .action(async (options: { package: string; outputDataDir: string }, command: Command) => {
      const root = rootOptions(command);
      rejectJsonl(root, 'preview-import');
      const context = await openPortabilityContext(root, false);
      try {
        const preview = await context.portability.previewImport({
          packagePath: options.package,
          outputDataDir: options.outputDataDir,
        });
        printImportPreview('preview-import', preview, root.json === true);
      } finally {
        context.close();
      }
    });

  cli
    .command('import')
    .description('Import a portable dataset into a new dataDir')
    .requiredOption('--request-id <uuid>', 'stable import request ID')
    .requiredOption('--digest <sha256>', 'digest returned by preview-import')
    .requiredOption('--package <path>', 'transfer package directory')
    .requiredOption('--output-data-dir <path>', 'new destination dataDir')
    .action(
      async (
        options: { requestId: string; digest: string; package: string; outputDataDir: string },
        command: Command,
      ) => {
        const root = rootOptions(command);
        rejectJsonl(root, 'import');
        const context = await openPortabilityContext(root, false);
        try {
          const result = await context.portability.importPackage({
            requestId: options.requestId,
            digest: options.digest,
            packagePath: options.package,
            outputDataDir: options.outputDataDir,
          });
          if (root.json)
            writeJsonResult('import', {
              dataDir: result.dataDir,
              transfer: sanitizeTransfer(result.transfer, result.dataDir),
            });
          else {
            console.log(`Imported transfer ${result.transfer.transferId}`);
            console.log(`  dataDir=${result.dataDir}`);
            console.log('  next=review the directory, then update local configuration manually');
          }
        } finally {
          context.close();
        }
      },
    );
}

function printPreview(command: string, preview: PortabilityExportPreview, json: boolean): void {
  if (json)
    writeJsonResult(command, {
      ...sanitizeManifest(preview.manifest),
      digest: preview.digest,
      blockers: preview.blockers,
      sensitiveDataWarning: preview.sensitiveDataWarning,
    });
  else {
    console.log(`Export preview ${preview.transferId}`);
    console.log(`  destination=${preview.destination}`);
    console.log(`  digest=${preview.digest}`);
    printBlockers(preview.blockers);
    console.log(`  warning=${preview.sensitiveDataWarning}`);
  }
}

function printImportPreview(
  command: string,
  preview: PortabilityImportPreview,
  json: boolean,
): void {
  const data = { ...preview, blockers: preview.blockers };
  if (json) writeJsonResult(command, data);
  else {
    console.log(`Import preview ${preview.transferId}`);
    console.log(`  output-data-dir=${preview.outputDataDir}`);
    console.log(`  digest=${preview.digest}`);
    printBlockers(preview.blockers);
    console.log(`  warning=${preview.sensitiveDataWarning}`);
  }
}

function printManifest(manifest: TransferManifest): void {
  console.log(`Transfer ${manifest.transferId}`);
  console.log(`  dataset=${manifest.datasetId}  parent=${manifest.parentTransferId ?? '-'}`);
  console.log(`  branch=${manifest.git.branch}  head=${manifest.git.head}`);
  console.log(`  runs=${manifest.counts.runs}  artifacts=${manifest.counts.artifacts}`);
  console.log(`  warning=${manifest.warnings.join('; ')}`);
}

function sanitizeManifest(manifest: TransferManifest) {
  return {
    protocol: manifest.protocol,
    version: manifest.version,
    transferId: manifest.transferId,
    parentTransferId: manifest.parentTransferId,
    datasetId: manifest.datasetId,
    requestId: manifest.requestId,
    createdAt: manifest.createdAt,
    binaflowVersion: manifest.binaflowVersion,
    schemaVersion: manifest.schemaVersion,
    counts: manifest.counts,
    database: {
      sha256: manifest.files.database.sha256,
      sizeBytes: manifest.files.database.sizeBytes,
    },
    bundle: { sha256: manifest.files.bundle.sha256, sizeBytes: manifest.files.bundle.sizeBytes },
    git: manifest.git,
    source: manifest.source,
    warnings: manifest.warnings,
  };
}

function sanitizeTransfer(transfer: { transferId: string; state: string }, packagePath: string) {
  return { transferId: transfer.transferId, state: transfer.state, packagePath };
}

function printBlockers(blockers: readonly { code: string; detail: string }[]): void {
  if (blockers.length === 0) {
    console.log('  blockers=none');
    return;
  }
  for (const blocker of blockers) console.log(`  blocker=${blocker.code}: ${blocker.detail}`);
}

function rootOptions(command: Command) {
  let root = command;
  while (root.parent) root = root.parent;
  return root.opts<{
    config?: string;
    cwd?: string;
    verbose?: boolean;
    json?: boolean;
    jsonl?: boolean;
  }>();
}

function rejectJsonl(options: { json?: boolean; jsonl?: boolean }, command: string): void {
  if (options.jsonl) {
    throw cliUsageError(
      'UNSUPPORTED_OUTPUT_MODE',
      `The ${command} command supports --json, not --jsonl`,
    );
  }
}

async function openPortabilityContext(
  root: { config?: string; cwd?: string },
  createDatabase: boolean,
) {
  const { openPortabilityContext } = await import('../../application/runtime.js');
  return openPortabilityContext(root.config ?? '.binaflow/config.json', root.cwd ?? process.cwd(), {
    createDatabase,
  });
}
