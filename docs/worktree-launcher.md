# Settings and troubleshooting

For installation and your first worktree, start with the [README](../README.md).

## Project roots

The **Project root** field defines where the launcher searches for repositories. Use an absolute path on the selected machine.

**Browse…** opens a local folder chooser or lists directories on the selected remote machine. Remote browsing starts at the entered path, or the remote home when the field is empty.

For a remote root, navigate through the child and parent entries. Select **Save** to use the displayed directory.

The saved root stays visible. **Saving…** replaces **Save** until the save and project refresh finish. Other controls stay disabled during this operation.

The launcher saves roots in `<app-home>/data/worktree-launcher-config.json`:

```json
{
  "project_root": "/absolute/projects",
  "remote_project_roots": {
    "devbox": "/srv/projects"
  }
}
```

The default app home is `$HOME/.config/herdr-app`. For a custom app home, set `HERDR_APP_HOME` when you run the installer and Herdr.

Paths in the settings file must be absolute. The launcher does not expand `~` or environment variables in this file.

To set the local root during installation, run:

```sh
pnpm run install:mod --project-root "$HOME/Documents/Code"
```

Here, your shell expands `$HOME` before the installer runs. An update preserves roots unless you supply `--project-root` again.

Older installations can store settings in `mods/worktree-launcher/config.json`. The installer migrates these settings. The launcher also reads them until its first save to the new location.

## Discovery and branches

The launcher searches below the saved root and uses root-relative project names. Linked Git worktrees share one project entry.

Discovery excludes ignored repositories, bare repositories, native JJ-only workspaces, and common build directories. Excluded directory names include `node_modules`, `vendor`, `target`, `build`, `dist`, `.next`, and `coverage`.

**Refresh** scans again. The launcher also refreshes when you open it. A failed or truncated scan reports an error instead of a partial project list.

Local and fetched remote branches appear in the branch picker. Symbolic remote HEAD entries do not appear. The launcher never fetches automatically.

For **Existing branch**, a checked-out local branch opens its existing folder with **Open worktree**. The launcher preserves its files, branch, and tracking settings.

The folder can be outside the standard worktree store, including the primary checkout. Missing or invalid checkouts remain unavailable. A remote branch remains unavailable when its local branch name already exists.

Selecting a remote branch for **Existing branch** creates a local branch that tracks that specific remote. **New branch** creates a branch without an upstream, including from a remote base.

The launcher rechecks repository identity, branch state, and destination before creation. It preserves changes in the primary checkout. Git hooks run normally.

## Worktree destinations

The destination is `~/.herdr/worktrees/<repository-name>/<branch-slug>` on the selected machine. Its home directory supplies `~`.

The repository name comes from the `origin` URL without `.git`. Without an origin, the primary checkout folder supplies the name.

A checkout at `team/sample-api/main` with a `sample-api.git` origin therefore uses `worktrees/sample-api/<branch-slug>`.

The branch slug permits ASCII letters, digits, dots, underscores, and hyphens. Other character runs become a hyphen. Outer hyphens disappear.

Two repositories with the same name can share a destination. Different branch names can also produce the same slug. An occupied destination stops creation.

The launcher rejects symlinks in existing worktree-store ancestors. The home directory itself can resolve through a symlink. Existing worktrees keep their paths.

## Machines and agents

The initial machine follows the active Herdr space. Changing machines clears the project and branch choices and displays that machine's saved root.

All Git commands stay on the selected machine. A disconnected machine never falls back to local execution. The remote machine needs Git, `/bin/bash`, `find`, `realpath`, `test`, and `mkdir`.

**Open with** uses Herdr's detected programs and their launch settings. Only available Claude Code, Pi, OpenCode, and Codex programs appear. **Shell** remains available if detection fails.

If an agent is missing from the menu, check that Herdr can detect it on the selected machine. After installation or changes to Herdr's programs, select **Refresh**. Herdr can cache availability briefly.

The launcher creates or reuses the primary project space before opening the worktree. Herdr's standard Spaces sidebar supplies grouping. The launcher needs no `spaces-grouped` mod.

A custom sidebar controls its own presentation. Without grouping support, the worktree remains a separate space in that sidebar.

## Troubleshooting

### The shortcut does not open the launcher

Try the direct command:

```sh
herdr-app do mod.open --name worktree-launcher
```

If the command works, check `<app-home>/keys.json` for this entry under `global`:

```json
{
  "global": {
    "cmd-shift-g": "mod.open:worktree-launcher"
  }
}
```

Preserve other entries. If that key already has another action, assign a different key or use the direct command.

### The project root is unavailable

Check the machine and the full absolute path. Remote paths must exist on the remote machine.

For a local macOS folder, check System Settings → Privacy & Security → Files and Folders. Enable the relevant folder permission for Herdr, then select **Refresh**.

Local commands run in Herdr.app. Its folder permissions can differ from your terminal and Herdr Core. A successful terminal access check does not prove desktop-app access.

If Herdr shows a pending update, finish your work and fully quit and reopen Herdr. Then retry discovery.

### Projects are missing or discovery fails

Check the root and the [discovery exclusions](#discovery-and-branches). For an ignore-rule error, inspect the reported repository path and Git error. Repair its permissions or Git metadata, then select **Refresh**.

Herdr limits each external command to 30 seconds and 8 MiB of output. For a command-limit error, select a narrower project root.

### The worktree exists but its space did not open

Select **Open created worktree**. This action retries app opening without repeating Git creation. You can change **Open with** before the retry.

Opening waits up to ten seconds for the correct checkout, selected program, and focus. A timeout preserves the Git result for recovery.

## Recovery after an interrupted operation

The launcher records an operation before Git creation in `<app-home>/data/worktree-launcher-operation.json`. The record includes its machine and selected program.

After a reload or closure, the launcher inspects the record and Git. A complete checkout offers **Open created worktree**.

An incomplete operation blocks new creation across all machines. The launcher preserves the branch, checkout, and record for inspection. It never removes worktrees or branches automatically.

For an incomplete operation:

1. Wait for the original Git operation to finish.
2. On the reported machine, inspect the project with `git worktree list --porcelain` and `git branch -vv`.
3. Repair any incomplete artifact manually.
4. Move the operation record aside only after you understand the Git outcome.
5. Open the launcher again.

Closing the window does not roll back Git.

## Manual installation

Manual installation needs no Node or pnpm. From the repository root, copy these files:

```sh
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mkdir -p "$app_home/mods/worktree-launcher"
cp mods/worktree-launcher/main.js mods/worktree-launcher/model.js \
  mods/worktree-launcher/git.js mods/worktree-launcher/config.js \
  mods/worktree-launcher/mod.json mods/worktree-launcher/config.example.json \
  mods/worktree-launcher/keys.json mods/worktree-launcher/README.md \
  "$app_home/mods/worktree-launcher/"
herdr-app check "$app_home/mods/worktree-launcher"
```

Merge the shortcut into your app-home `keys.json`, or use the direct open command. Then set each project root in the launcher.

The native check validates initial module loading. It does not test live discovery or grant folder permissions.

## Remove

1. Resolve any pending operation first.
2. Back up legacy settings from `mods/worktree-launcher/config.json`, if present.
3. Remove the installed `mods/worktree-launcher` directory.
4. Remove its shortcut from the app-home `keys.json`.

Settings in `data/worktree-launcher-config.json` remain. Worktrees, branches, Herdr spaces, and unrelated app files remain.
