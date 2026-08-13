import { execFile } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const defaultRoot = resolve(import.meta.dirname, '..');
const ignoredDirectories = new Set([
  '.git',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);
const runtimeRoots = ['apps', 'packages', 'tools'];
const textExtensions = new Set([
  '.cfg', '.cjs', '.conf', '.config', '.css', '.example', '.htm', '.html', '.ini', '.js',
  '.json', '.jsx', '.less', '.lock', '.md', '.mjs', '.mts', '.properties', '.py', '.rc',
  '.sass', '.scss', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml',
  '.xhtml', '.yaml', '.yml',
]);
const privateKeyExtensions = new Set(['.key', '.p12', '.pfx', '.pem']);
const runtimeSourceExtensions = new Set([
  '.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.py', '.ts', '.tsx', '.vue',
]);
const runtimeAssetExtensions = new Set([
  '.css', '.htm', '.html', '.less', '.sass', '.scss', '.svg', '.xhtml',
]);

function isTextFile(name) {
  const extension = extname(name).toLowerCase();
  return name.startsWith('.env') || extension === '' || textExtensions.has(extension);
}

function isRuntimeSourceFile(name) {
  return runtimeSourceExtensions.has(extname(name).toLowerCase());
}

function isRuntimeReferenceFile(name) {
  const extension = extname(name).toLowerCase();
  return isRuntimeSourceFile(name) || runtimeAssetExtensions.has(extension);
}

function isMissingPathError(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT';
}

function isIgnoredDirectory(path, name, repositoryRoot) {
  return ignoredDirectories.has(name) || path === resolve(repositoryRoot, 'references');
}

async function collectFiles(directory, predicate = isTextFile, repositoryRoot = directory) {
  const directories = [];
  const files = [];
  const symbolicLinks = [];

  async function visit(path) {
    let status;
    try {
      status = await lstat(path);
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }

      throw error;
    }

    if (status.isSymbolicLink()) {
      symbolicLinks.push(path);
      return;
    }

    if (status.isFile()) {
      if (predicate(path)) {
        files.push(path);
      }
      return;
    }

    if (!status.isDirectory()) {
      return;
    }

    directories.push(path);
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = resolve(path, entry.name);
      if (entry.isDirectory() && isIgnoredDirectory(entryPath, entry.name, repositoryRoot)) {
        continue;
      }

      await visit(entryPath);
    }
  }

  await visit(directory);
  return { directories, files, symbolicLinks };
}

function displayPath(path, repositoryRoot) {
  return relative(repositoryRoot, path).split(sep).join('/');
}

function formatSymbolicLinkMatches(symbolicLinks, repositoryRoot) {
  return symbolicLinks.map((path) => `${displayPath(path, repositoryRoot)}: symbolic link`);
}

function isReferencePath(specifier) {
  const path = specifier.trim().split(/[?#]/, 1)[0];
  return path.split(/[\\/]/).includes('references');
}

function containsJavaScriptReferenceImport(content) {
  const expressions = [
    /\b(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
  ];

  return expressions.some((expression) => {
    for (const match of content.matchAll(expression)) {
      if (isReferencePath(match[1])) {
        return true;
      }
    }

    return false;
  });
}

function containsPythonReferenceImport(content) {
  const fromExpression = /^\s*from\s+([\w.]+)\s+import\b/gm;
  for (const match of content.matchAll(fromExpression)) {
    if (match[1].split('.').includes('references')) {
      return true;
    }
  }

  const importExpression = /^\s*import\s+([^#\n]+)/gm;
  for (const match of content.matchAll(importExpression)) {
    const modules = match[1].split(',').map((binding) => binding.split(/\s+as\s+/)[0].trim());
    if (modules.some((moduleName) => moduleName.split('.').includes('references'))) {
      return true;
    }
  }

  return false;
}

function containsReferenceAsset(content) {
  const expressions = [
    /@import\s+url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi,
    /@import\s+(?:"([^"]+)"|'([^']+)')/gi,
    /\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi,
    /\b(?:data|href|poster|src)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>"']+))/gi,
    /\bsrcset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>"']+))/gi,
  ];

  return expressions.some((expression) => {
    for (const match of content.matchAll(expression)) {
      const specifier = match.slice(1).find((value) => value !== undefined);
      if (specifier && isReferencePath(specifier)) {
        return true;
      }
    }

    return false;
  });
}

async function getTrackedReferencePaths(repositoryRoot) {
  try {
    await lstat(resolve(repositoryRoot, '.git'));
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw error;
  }

  const { stdout } = await execFileAsync('git', [
    '-C',
    repositoryRoot,
    'ls-files',
    '--cached',
    '--full-name',
    '-z',
    '--',
    'references/**',
  ]);

  return stdout.split('\0').filter(Boolean);
}

export async function checkBranding(repositoryRoot = defaultRoot) {
  const collected = await Promise.all(runtimeRoots.map(async (path) => (
    collectFiles(resolve(repositoryRoot, path), () => true, repositoryRoot)
  )));
  const directories = collected.flatMap(({ directories: paths }) => paths);
  const files = collected.flatMap(({ files: paths }) => paths);
  const symbolicLinks = collected.flatMap(({ symbolicLinks: paths }) => paths);
  const disallowed = ['xiaozhi', 'xiaozhi-esp32', 'xiaozhi-server'];
  const matches = formatSymbolicLinkMatches(symbolicLinks, repositoryRoot);

  for (const directory of directories) {
    const path = displayPath(directory, repositoryRoot).toLowerCase();
    for (const term of disallowed) {
      if (path.includes(term)) {
        matches.push(`${displayPath(directory, repositoryRoot)}: path: ${term}`);
      }
    }
  }

  for (const file of files) {
    const path = displayPath(file, repositoryRoot).toLowerCase();
    for (const term of disallowed) {
      if (path.includes(term)) {
        matches.push(`${displayPath(file, repositoryRoot)}: path: ${term}`);
      }
    }

    if (!isTextFile(basename(file))) {
      continue;
    }

    const content = (await readFile(file, 'utf8')).toLowerCase();
    for (const term of disallowed) {
      if (content.includes(term)) {
        matches.push(`${displayPath(file, repositoryRoot)}: ${term}`);
      }
    }
  }

  return matches;
}

export async function checkSecrets(repositoryRoot = defaultRoot) {
  const { files, symbolicLinks } = await collectFiles(repositoryRoot, () => true, repositoryRoot);
  const patterns = [
    {
      name: 'private key',
      expression: /-----BEGIN(?: [A-Z0-9][A-Z0-9 _-]*)? PRIVATE KEY(?: BLOCK)?-----/i,
    },
    { name: 'OpenAI-style API key', expression: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
    { name: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { name: 'AWS access key', expression: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'Google API key', expression: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  ];
  const matches = formatSymbolicLinkMatches(symbolicLinks, repositoryRoot);

  for (const file of files) {
    if (privateKeyExtensions.has(extname(file).toLowerCase())) {
      matches.push(`${displayPath(file, repositoryRoot)}: private key file extension`);
    }

    if (!isTextFile(basename(file))) {
      continue;
    }

    const content = await readFile(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.expression.test(content)) {
        matches.push(`${displayPath(file, repositoryRoot)}: ${pattern.name}`);
      }
    }
  }

  return matches;
}

export async function checkReferences(repositoryRoot = defaultRoot) {
  const collected = await Promise.all(runtimeRoots.map(async (path) => (
    collectFiles(resolve(repositoryRoot, path), isRuntimeReferenceFile, repositoryRoot)
  )));
  const files = collected.flatMap(({ files: paths }) => paths);
  const symbolicLinks = collected.flatMap(({ symbolicLinks: paths }) => paths);
  const matches = formatSymbolicLinkMatches(symbolicLinks, repositoryRoot);

  for (const file of files) {
    const relativePath = displayPath(file, repositoryRoot);
    if (isReferencePath(relativePath)) {
      matches.push(`${relativePath}: runtime reference path`);
      continue;
    }

    const content = await readFile(file, 'utf8');
    const extension = extname(file).toLowerCase();
    const hasReferenceImport = extension === '.py'
      ? containsPythonReferenceImport(content)
      : isRuntimeSourceFile(file) && containsJavaScriptReferenceImport(content);
    const hasReferenceAsset = runtimeAssetExtensions.has(extension)
      || extension === '.vue'
      ? containsReferenceAsset(content)
      : false;

    if (hasReferenceImport) {
      matches.push(`${relativePath}: runtime reference import`);
    } else if (hasReferenceAsset) {
      matches.push(`${relativePath}: runtime reference asset`);
    }
  }

  for (const path of await getTrackedReferencePaths(repositoryRoot)) {
    matches.push(`${path}: tracked reference path`);
  }

  return matches;
}

const checks = {
  branding: checkBranding,
  references: checkReferences,
  secrets: checkSecrets,
};

async function runCli() {
  const mode = process.argv[2];

  if (!(mode in checks)) {
    console.error(`Usage: node scripts/repository-check.mjs <${Object.keys(checks).join('|')}>`);
    process.exitCode = 2;
    return;
  }

  const matches = await checks[mode]();
  if (matches.length > 0) {
    console.error(`${mode} check failed:`);
    for (const match of matches) {
      console.error(`- ${match}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`${mode} check passed`);
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (entryPoint === import.meta.url) {
  await runCli();
}
