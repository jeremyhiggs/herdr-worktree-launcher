import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function pinSampleCLI(mod, binary) {
  const path = join(mod, 'cli.js');
  const source = await readFile(path, 'utf8');
  const marker = "exec('herdr-worktree-launcher',";
  if (source.split(marker).length !== 2)
    throw new Error('Sample CLI adapter changed; update the sample binary binding.');
  await writeFile(path, source.replace(marker, `exec(${JSON.stringify(resolve(binary))},`));
}
