import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { checkBranding, checkReferences, checkSecrets } from './repository-check.mjs';

const execFileAsync = promisify(execFile);

async function createRepositoryFixture(files) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'veetee-repository-check-'));

  for (const [path, content] of Object.entries(files)) {
    const filePath = join(repositoryRoot, path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
  }

  return repositoryRoot;
}

async function withRepositoryFixture(files, assertion) {
  const repositoryRoot = await createRepositoryFixture(files);

  try {
    await assertion(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test('secret scanning includes extensionless and configuration files', async () => {
  const fakeApiKey = `s${'k'}-${'a'.repeat(24)}`;

  await withRepositoryFixture({
    '.npmrc': `//registry.example.test/:_authToken=${fakeApiKey}\n`,
    Dockerfile: `ARG PROVIDER_API_KEY=${fakeApiKey}\n`,
    'settings.config': `provider_key=${fakeApiKey}\n`,
  }, async (repositoryRoot) => {
    const matches = await checkSecrets(repositoryRoot);

    assert.deepEqual(matches.sort(), [
      '.npmrc: OpenAI-style API key',
      'Dockerfile: OpenAI-style API key',
      'settings.config: OpenAI-style API key',
    ]);
  });
});

test('secret scanning rejects private-key file extensions and encrypted key headers', async () => {
  const encryptedPrivateKey = ['-----BEGIN', 'ENCRYPTED', 'PRIVATE', 'KEY-----'].join(' ');
  const pgpPrivateKey = ['-----BEGIN', 'PGP', 'PRIVATE', 'KEY', 'BLOCK-----'].join(' ');

  await withRepositoryFixture({
    'archive.p12': 'binary container placeholder\n',
    'certificate.pem': 'public material placeholder\n',
    'encrypted-key.txt': `${encryptedPrivateKey}\n`,
    'identity.PFX': 'binary container placeholder\n',
    'legacy.key': 'legacy key placeholder\n',
    'pgp-key.txt': `${pgpPrivateKey}\n`,
  }, async (repositoryRoot) => {
    const matches = await checkSecrets(repositoryRoot);

    assert.deepEqual(matches.sort(), [
      'archive.p12: private key file extension',
      'certificate.pem: private key file extension',
      'encrypted-key.txt: private key',
      'identity.PFX: private key file extension',
      'legacy.key: private key file extension',
      'pgp-key.txt: private key',
    ]);
  });
});

test('branding scanning rejects forbidden runtime SVG content and path names', async () => {
  await withRepositoryFixture({
    'apps/assets/logo.svg': '<svg><title>Xiaozhi</title></svg>\n',
    'packages/xiaozhi-brand/identity.bin': '',
    'tools/placeholder.txt': '',
  }, async (repositoryRoot) => {
    const matches = await checkBranding(repositoryRoot);

    assert.deepEqual(matches.sort(), [
      'apps/assets/logo.svg: xiaozhi',
      'packages/xiaozhi-brand/identity.bin: path: xiaozhi',
      'packages/xiaozhi-brand: path: xiaozhi',
    ]);
  });
});

test('reference scanning detects Python reference imports', async () => {
  const fromImport = ['from', 'references.runtime.adapter', 'import', 'Adapter'].join(' ');
  const directImport = ['import', 'references.runtime.bootstrap', 'as', 'bootstrap'].join(' ');

  await withRepositoryFixture({
    'apps/from_import.py': `${fromImport}\n`,
    'apps/import.py': `${directImport}\n`,
  }, async (repositoryRoot) => {
    const matches = await checkReferences(repositoryRoot);

    assert.deepEqual(matches.sort(), [
      'apps/from_import.py: runtime reference import',
      'apps/import.py: runtime reference import',
    ]);
  });
});

test('reference scanning detects JavaScript side-effect and dynamic imports', async () => {
  const referenceModule = ['..', 'references', 'runtime.js'].join('/');
  const importKeyword = ['im', 'port'].join('');

  await withRepositoryFixture({
    'apps/dynamic.ts': `const runtime = await ${importKeyword}('${referenceModule}');\n`,
    'apps/side-effect.js': `${importKeyword} '${referenceModule}';\n`,
  }, async (repositoryRoot) => {
    const matches = await checkReferences(repositoryRoot);

    assert.deepEqual(matches.sort(), [
      'apps/dynamic.ts: runtime reference import',
      'apps/side-effect.js: runtime reference import',
    ]);
  });
});

test('reference scanning detects CSS and HTML asset references', async () => {
  await withRepositoryFixture({
    'apps/href.html': '<link href="../references/theme.css">\n',
    'apps/import.css': '@import url("../references/theme.css");\n',
    'apps/src.html': '<img src="../references/logo.svg">\n',
    'apps/url.css': '.hero { background: url(../references/logo.svg); }\n',
  }, async (repositoryRoot) => {
    const matches = await checkReferences(repositoryRoot);

    assert.deepEqual(matches.sort(), [
      'apps/href.html: runtime reference asset',
      'apps/import.css: runtime reference asset',
      'apps/src.html: runtime reference asset',
      'apps/url.css: runtime reference asset',
    ]);
  });
});

test('reference scanning rejects Git-indexed reference paths', async () => {
  await withRepositoryFixture({
    'references/tracked.ts': 'export const fixture = true;\n',
  }, async (repositoryRoot) => {
    await execFileAsync('git', ['init', '--quiet', repositoryRoot]);
    await execFileAsync('git', ['-C', repositoryRoot, 'add', 'references/tracked.ts']);

    assert.deepEqual(await checkReferences(repositoryRoot), [
      'references/tracked.ts: tracked reference path',
    ]);
  });
});

test('repository guards reject symbolic links in runtime trees', async () => {
  await withRepositoryFixture({
    'apps/target.ts': 'export const safe = true;\n',
    'packages/placeholder.txt': '',
    'tools/placeholder.txt': '',
  }, async (repositoryRoot) => {
    await symlink('../target.ts', join(repositoryRoot, 'apps', 'linked.ts'));

    assert.deepEqual(await checkBranding(repositoryRoot), ['apps/linked.ts: symbolic link']);
    assert.deepEqual(await checkReferences(repositoryRoot), ['apps/linked.ts: symbolic link']);
    assert.deepEqual(await checkSecrets(repositoryRoot), ['apps/linked.ts: symbolic link']);
  });
});

test('reference scanning does not flag legal provenance documents', async () => {
  const documentedImport = ['from', 'references.runtime.adapter', 'import', 'Adapter'].join(' ');

  await withRepositoryFixture({
    '.ai/PROVENANCE.md': `Studied path: references/upstream\nExample only: ${documentedImport}\n`,
    'provenance.lock.json': JSON.stringify({ localPath: 'references/upstream' }),
  }, async (repositoryRoot) => {
    assert.deepEqual(await checkReferences(repositoryRoot), []);
  });
});
