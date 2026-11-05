# Worktree Launcher

## Requirements

- macOS with Herdr app/core.
- Git, `find`, `realpath`, `test`, and `mkdir` on each target machine.
- Linux or macOS for remote targets, connected through Herdr Core.
- Bash at `/bin/bash` on each target for batched project discovery.
- One absolute, readable project directory per machine, configured in the launcher.

The mod was checked with Herdr app 0.1.13 and core 0.1.18. The installer runs a fresh module check on your installed version.

## Install

From the repository root, run:

```sh
pnpm run install:mod
```

Installation requires Node 24 or newer and pnpm 11.x. The installed mod does not need Node or pnpm.

The installer copies the mod into `${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/worktree-launcher`, checks native loading, and adds Cmd+Shift+G. Open the launcher to configure project roots. To set the local root during installation, add `--project-root "$HOME/Documents/Code"`.

Existing keybindings are preserved. The installer backs up `keys.json` before adding the shortcut. If Cmd+Shift+G is already assigned, installation stops before copying files. Add `--no-shortcut` to install while keeping that binding.

An existing mod directory requires `--update`. This replaces its distributable code files and preserves project-root settings, recovery records, and unrelated files. Supply `--project-root` again only to change that setting.

```sh
pnpm run install:mod --update
```

The installer does not start or restart the app/core, open spaces, or fetch Git refs. Open the installed launcher with Cmd+Shift+G or:

```sh
herdr-app do mod.open --name worktree-launcher
```

Herdr's [mod installation guidance](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md#layouts-and-mods-other-people-made) recommends copying mod files, merging keys without replacing existing bindings, and running `herdr-app check`. Mods belong to the app; herdr-core runs terminals and needs no separate mod installation.

### Manual installation

To install without the script, copy the distributable files:

```sh
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mkdir -p "$app_home/mods/worktree-launcher"
cp mods/worktree-launcher/main.js mods/worktree-launcher/model.js \
  mods/worktree-launcher/git.js mods/worktree-launcher/config.js mods/worktree-launcher/mod.json \
  mods/worktree-launcher/config.example.json mods/worktree-launcher/keys.json \
  mods/worktree-launcher/README.md "$app_home/mods/worktree-launcher/"
```

Open the launcher to configure its roots, or create `<app-home>/data/worktree-launcher-config.json`. Local and remote paths belong to their respective machines:

```json
{
  "project_root": "/absolute/path/to/local/projects",
  "remote_project_roots": {
    "devbox": "/absolute/path/on/devbox"
  }
}
```

The mod does not expand `~`. Select Browse to choose a local folder or list folders on the selected remote machine. Remote browsing starts at the entered absolute path, or at the remote home when the field is empty. Select a child folder or the parent entry to navigate, then Save to use the displayed directory. The saved path stays visible and editable. Configuration errors appear in the overlay.

Mutable settings live outside the watched mod folder, so saving does not reload the launcher. The installer migrates an existing `mods/worktree-launcher/config.json`, preserving all machine roots and unrelated settings. The launcher also reads that legacy file when the new settings file is absent; its next save writes the new location.

Run the module check against the installed directory:

```sh
herdr-app check "$app_home/mods/worktree-launcher"
```

Open the overlay:

```sh
herdr-app do mod.open --name worktree-launcher
```

## Shortcut

The supplied `keys.json` contains:

```json
{
  "global": {
    "cmd-shift-g": "mod.open:worktree-launcher"
  }
}
```

Merge this entry into the app-home `keys.json`. Preserve its other entries. Do not replace an existing binding without approval.

## Use

1. Open **Worktree Launcher**.
2. Select **Local** or a connected machine, such as **devbox**. The initial target follows the active space.
3. Enter an absolute project root or use **Browse**, then select **Save**. Remote paths are validated on that remote machine. **Saving…** appears on Save until the save and project refresh finish; the other controls are disabled during that operation.
4. Search for a project and select a result with the mouse or Up/Down and Enter.
5. Choose **New branch** or **Existing branch**.
6. Select a local or fetched remote branch. New branch uses it as a base; Existing branch checks it out directly. Switching actions preserves the selected branch.
7. For a new branch, enter the name in the field below the branch picker. This field is hidden for Existing branch.
8. Read the destination and activate **Create** or press Cmd+Enter.

The project-root field always remains visible. Changing machine clears the previous machine's path immediately and displays the selected machine's saved root before project discovery finishes. Saving preserves other machines' roots and unrelated configuration. Changing machine clears project and branch selections. Creation stays on the selected machine even if another space becomes active.

The UI mod is installed only in the local app. Remote discovery, validation, and Git commands use Herdr Core on the selected machine. No separate remote mod or Node installation is needed.

Project discovery batches filesystem and Git metadata checks into one Bash scan on the selected machine. This avoids thousands of calls through the app for large local roots and avoids remote round trips. Refresh always scans again. Branch selection and creation still revalidate current repository state. A failed or truncated scan reports an error instead of showing a partial project list.

Enter in a search field selects a choice. It does not submit the form. Tab and Shift+Tab move between controls.

The new-name field stays disabled until you select a base. Each choice list opens below its own search field.

The launcher uses Herdr's theme colors for light and dark themes. It follows system appearance when Herdr follows it; an explicit appearance setting in Herdr takes precedence.

Error messages, checkout explanations, and destination paths support text selection and copying. Buttons and choice rows retain their normal control behavior.

The mod reuses a space for the primary checkout or creates it first. Herdr groups the new worktree space beneath this project space.

The mod requests Herdr's normal default shell, with no custom terminal command.

Checked-out local branches are disabled for Existing branch and show their checkout path. They remain available as bases for new branches. If you select one as a base and switch to Existing branch, Create stays disabled and the checkout path explains why.

A remote selection creates its local branch and tracks that specific remote. A new branch has no upstream, including from a remote base.

Refresh rereads the configuration and discovers projects again. Opening the overlay also refreshes it.

## Destination and limits

The destination is `~/.herdr/worktrees/<repository-name>/<branch-slug>` on the selected machine, using that machine's home directory. The repository name comes from the configured `origin` URL, without its `.git` suffix. Without an origin, the primary checkout folder supplies the name. For example, a checkout at `OlympusDAO/coingecko-api/master` with a `coingecko-api.git` origin uses `worktrees/coingecko-api/<branch-slug>`.

The slug replaces runs outside ASCII letters, digits, dot, underscore, and hyphen with a hyphen. It trims outer hyphens.

Repositories with the same name can collide. Different branch names can also produce the same slug. An occupied destination stops creation. Existing worktrees stay at their current paths.

The mod rejects symlinks in existing worktree-store ancestors. The home directory itself can resolve through a symlink.

Discovery excludes build directories, ignored nested repositories, bare repositories, and native JJ-only workspaces. Linked Git worktrees share one primary-project identity.

The mod uses fetched refs without fetching. It preserves changes in the primary checkout. Git hooks retain their normal behavior.

Herdr limits each external command to 30 seconds and 8 MiB of output. Discovery reports command-limit errors without presenting partial results.

Git operations and app opening have separate outcomes. App opening must observe the correct checkout, a normal shell, and focus within ten seconds.

Existing matching spaces use live shell directories. A shell in a checkout subdirectory matches. A shell in a nested repository does not match.

In the isolated development launcher, zsh loads your normal startup files, history, and cache. App/core storage and worktree destinations remain temporary.

The launcher pins `HC_SOCKET` to the temporary core so restored shell configuration does not route `hc` to your live session.

## Recovery

If app opening fails after Git creation, select **Open created worktree**. This action never repeats Git creation.

The mod saves its operation record in `<app-home>/data/worktree-launcher-operation.json` before Git creation.

After a reload or window closure, the mod inspects this record and Git. A complete checkout offers the same open-only action.

An incomplete operation blocks new creation. The mod preserves its checkout, branch, and operation record for manual inspection.

The operation record includes its machine. Reopening selects that target before inspection or an open-only retry. One unresolved operation blocks new creation across machines. A disconnected machine never falls back to running locally.

1. Wait for the original Git operation to finish.
2. On the reported machine, inspect the repository with `git worktree list --porcelain` and `git branch -vv`.
3. Repair any incomplete artifact manually.
4. Move the operation record aside after you understand the outcome.
5. Open the overlay again.

The mod does not remove branches or worktrees. It does not claim that window closure rolls back Git.

## Project directory access on macOS

`project_root` must be an absolute path. The shell expands `$HOME` in the install command; the mod does not expand `~` in JSON.

If a directory exists but Herdr cannot read it, check System Settings → Privacy & Security → Files and Folders. For projects in Documents, enable Documents Folder for Herdr, then select Refresh in the launcher.

Local mod commands run in Herdr.app. Its folder permissions can differ from your terminal and Herdr Core. A successful installer access check or `hc exec` check does not prove that the desktop app can read the directory.

`herdr-app check` checks initial native loading. It does not verify asynchronous discovery in the running desktop app or grant folder access.

## Update and remove

For an update, run `pnpm run install:mod --update`. The manual source-file copy also preserves your configuration.

Root settings remain in `data/worktree-launcher-config.json` after removing the mod. Back up any legacy `mods/worktree-launcher/config.json` before deleting that folder.

Then remove the installed `mods/worktree-launcher` directory and its optional keybinding. Preserve any recovery record until its operation is resolved.

Removal does not remove Git worktrees, branches, app spaces, or unrelated app files.
