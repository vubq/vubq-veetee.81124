import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const simulatorPackageRoot = fileURLToPath(new URL('../', import.meta.url));
const fixtureDirectory = fileURLToPath(new URL('../../../packages/protocol-contracts/fixtures/', import.meta.url));
const fixtureNames = [
  'bootstrap-pairing-response.json',
  'activation-pending-response.json',
  'activation-claimed-response.json',
  'bootstrap-websocket-response.json',
  'server-hello.json',
  'listen-start.json',
  'listen-stop.json',
  'listen-detect.json',
  'mcp-initialize-request.json',
  'mcp-initialize-result.json',
  'mcp-tools-list-initial-request.json',
  'mcp-tools-list-initial-result.json',
  'mcp-tools-list-page-request.json',
  'mcp-tools-list-page-result.json',
  'mcp-tools-call-request.json',
  'mcp-tools-call-result.json',
  'tts-start.json',
  'tts-sentence-start.json',
  'tts-stop.json',
  'abort.json',
  'v1-opus-packet.bin',
] as const;

async function createSourceOnlyWorkspace(): Promise<string> {
  const directory = await mkdtemp(`${tmpdir()}/veetee-simulator-source-`);
  await cp(repositoryRoot, directory, {
    recursive: true,
    filter: (source) => ![
      '/node_modules',
      '/dist',
      '/.git',
      '/references',
      '/.venv',
      '/__pycache__',
      '/.pytest_cache',
      '/.mypy_cache',
      '/.ruff_cache',
      '/.ai',
      '.tsbuildinfo',
    ].some((segment) => source.includes(segment)),
  });
  return directory;
}

describe('device simulator CLI packaging', () => {
  it('runs the advertised workspace bin deterministically', async () => {
    const bin = fileURLToPath(new URL('../../../node_modules/.bin/veetee-device-simulator', import.meta.url));
    await access(bin, constants.X_OK);

    const first = await execFileAsync(bin, [], { cwd: repositoryRoot });
    const second = await execFileAsync(bin, [], { cwd: repositoryRoot });
    const npmExec = await execFileAsync('npm', ['exec', '--', 'veetee-device-simulator'], {
      cwd: repositoryRoot,
    });

    expect(first.stdout).toBe(second.stdout);
    expect(npmExec.stdout).toBe(first.stdout);
    expect(first.stdout).toContain('"state": "connected"');
    expect(first.stdout).toContain('"binary-opus"');
  });

  it('runs through npm exec in a source-only clean workspace immediately after npm ci', async () => {
    const directory = await createSourceOnlyWorkspace();
    try {
      await execFileAsync('npm', ['ci', '--ignore-scripts'], { cwd: directory });
      const output = await execFileAsync('npm', ['exec', '--', 'veetee-device-simulator'], {
        cwd: directory,
      });
      expect(output.stdout).toContain('"state": "connected"');
      expect(output.stdout).toContain('"binary-opus"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('does not copy built output into the source-only regression workspace', async () => {
    const source = await readFile(`${simulatorPackageRoot}package.json`, 'utf8');
    expect(source).toContain('"bin/veetee-device-simulator.mjs"');
  });
});
