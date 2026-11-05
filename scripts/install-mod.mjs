import { access, copyFile, lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../mods/worktree-launcher');
const execute = promisify(execFile);
const files = ['main.js', 'model.js', 'git.js', 'config.js', 'mod.json', 'config.example.json', 'keys.json', 'README.md'];
async function readOptional(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}
function object(text, path) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`Invalid JSON in ${path}.`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected an object in ${path}.`);
  return value;
}
const json = value => `${JSON.stringify(value, null, 2)}\n`;

async function install() {
  if (Number.parseInt(process.versions.node, 10) < 24) throw new Error('Node.js 24 or newer is required.');
  const { values } = parseArgs({ options: {
    'project-root': { type: 'string' }, update: { type: 'boolean' },
    'no-shortcut': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: pnpm run install:mod [--project-root /absolute/projects] [--update] [--no-shortcut]\nProject roots can be configured in the launcher. Updates preserve configuration unless a new local root is supplied.');
    return;
  }
  const appHome = resolve(process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app'));
  const target = join(appHome, 'mods/worktree-launcher');
  let existing;
  try { existing = await lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || await realpath(target) === await realpath(source))) throw new Error(`Refusing to replace ${target}: expected a separate mod directory, not a file, symlink, or source checkout.`);
  if (existing && !values.update) throw new Error(`${target} already exists. Use --update to replace this mod's code and preserve its configuration.`);

  const configPath = join(appHome, 'data/worktree-launcher-config.json');
  const originalConfig = await readOptional(configPath);
  const legacyPath = join(target, 'config.json');
  const sourceConfig = originalConfig ?? await readOptional(legacyPath);
  const config = sourceConfig === null ? {} : object(sourceConfig, originalConfig === null ? legacyPath : configPath);
  const root = values['project-root'];
  if (root !== undefined) {
    if (!isAbsolute(root)) throw new Error('Supply --project-root with one absolute, readable project directory.');
    if (!(await stat(root)).isDirectory()) throw new Error('The project root must be a directory.');
    await access(root, constants.R_OK | constants.X_OK);
    config.project_root = root;
  }

  const keysPath = join(appHome, 'keys.json');
  let originalKeys, keys, changeKeys = false;
  if (!values['no-shortcut']) {
    originalKeys = await readOptional(keysPath);
    keys = originalKeys === null ? {} : object(originalKeys, keysPath);
    const global = keys.global ?? {};
    if (typeof global !== 'object' || Array.isArray(global)) throw new Error(`Expected a global keybinding object in ${keysPath}.`);
    const command = object(await readFile(join(source, 'keys.json'), 'utf8'), 'bundled keys.json').global['cmd-shift-g'];
    if (Object.hasOwn(global, 'cmd-shift-g') && global['cmd-shift-g'] !== command) throw new Error('Cmd+Shift+G is already assigned. Use --no-shortcut to preserve it and install without a shortcut.');
    changeKeys = global['cmd-shift-g'] !== command;
    keys.global = { ...global, 'cmd-shift-g': command };
  }

  await execute('herdr-app', ['--version'], { timeout: 10000 });
  await mkdir(target, { recursive: true });
  for (const file of files) await copyFile(join(source, file), join(target, file));
  if (originalConfig === null || values['project-root'] !== undefined) {
    await mkdir(dirname(configPath), { recursive: true });
    if (await readOptional(configPath) !== originalConfig) throw new Error('Project-root settings changed during installation. They were preserved; rerun with --update.');
    try { await writeFile(configPath, json(config), originalConfig === null ? { flag: 'wx' } : {}); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Project-root settings changed during installation. They were preserved; rerun with --update.');
      throw error;
    }
  }
  try {
    await execute('herdr-app', ['check', target], { env: { ...process.env, HERDR_APP_HOME: appHome }, timeout: 30000 });
  } catch (error) { throw new Error(`Native check failed. Mod files remain at ${target}; the shortcut was not changed.\n${error.stderr || error.message}`); }
  if (changeKeys) {
    if (await readOptional(keysPath) !== originalKeys) throw new Error('Keybindings changed during installation. Mod files are installed; rerun with --update to merge the shortcut.');
    if (originalKeys !== null) {
      const backup = `${keysPath}.worktree-launcher-${Date.now()}.bak`;
      await writeFile(backup, originalKeys, { flag: 'wx', mode: 0o600 });
      console.log(`Keybinding backup: ${backup}`);
    }
    await writeFile(keysPath, json(keys));
  }
  console.log(`Installed Worktree Launcher: ${target}\nLocal project root: ${config.project_root || 'configure in the launcher'}\nNative module check passed.`);
  console.log(values['no-shortcut'] ? 'Shortcut unchanged.' : 'Shortcut: Cmd+Shift+G');
  console.log('Open: herdr-app do mod.open --name worktree-launcher');
}

try { await install(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
