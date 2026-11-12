import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function clearGitEnvironment(env) {
  const { stdout } = await promisify(execFile)('git', ['rev-parse', '--local-env-vars'], { env });
  for (const key of stdout.trim().split('\n')) delete env[key];
}

export async function pinSampleCLI(mod, binary) {
  const path = join(mod, 'cli.js');
  const source = await readFile(path, 'utf8');
  const marker = "'herdr-worktree-launcher'";
  if (source.split(marker).length !== 2)
    throw new Error('Sample CLI adapter changed; update the sample binary binding.');
  await writeFile(path, source.replace(marker, JSON.stringify(resolve(binary))));
}
