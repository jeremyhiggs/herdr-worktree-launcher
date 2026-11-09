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
pnpm run install:mod --project-root /work/projects
```

An update preserves roots unless you supply `--project-root` again.

Older installations can store settings in `mods/worktree-launcher/config.json`. The installer migrates these settings. The launcher also reads them until its first save to the new location.

## Discovery and branches

The launcher searches below the saved root and uses root-relative project names. Linked Git worktrees share one project entry.

Discovery excludes ignored repositories, bare repositories, native JJ-only workspaces, and common build directories. Excluded directory names include `node_modules`, `vendor`, `target`, `build`, `dist`, `.next`, and `coverage`.

Explicit CLI checkouts use the path you supply, including folders excluded from discovery.

**Refresh** scans again. The launcher also refreshes when you open it. A failed or truncated scan reports an error instead of a partial project list.

Local and fetched remote branches appear in the branch picker. Symbolic remote HEAD entries do not appear. The launcher never fetches automatically.

After you select a project, choose a **Git remote** and select **Fetch**. If `origin` exists, it is the default. Otherwise, the first remote is selected.

Fetch updates that remote's branch refs on the selected machine. It leaves your local branch, index, files, and existing worktrees intact. Select `origin/main` as the base to use its refreshed remote tip.

While **Fetching…** appears, other controls stay disabled. The branch picker refreshes afterward and preserves its selected branch if that ref remains available. A removed ref clears the selection.

Fetch uses Git's configured remote refspecs and authentication. It skips automatic tag and submodule fetching. If authentication or connectivity fails, the overlay shows Git's error and allows another attempt.

For **Existing branch**, a checked-out local branch opens its existing folder with **Open worktree**. The launcher preserves its files, branch, and tracking settings.

The folder can be outside the standard worktree store, including the primary checkout. Missing or invalid checkouts remain unavailable. A remote branch remains unavailable when its local branch name already exists.

Selecting a remote branch for **Existing branch** creates a local branch that tracks that specific remote. **New branch** creates a branch without an upstream, including from a remote base.

The launcher rechecks repository identity, branch state, and destination before creation. It preserves changes in the primary checkout. Worktrunk owns worktree creation. Its project hooks are skipped; run trusted setup manually. Native Git hooks remain user-configured.

## Worktree destinations

The destination is `~/.herdr/worktrees/<repository-name>/<branch-slug>` on the selected machine. Its home directory supplies `~`.

The repository name comes from the `origin` URL without `.git`. Without an origin, the launcher checks these sources in order:

1. The selected project's root `package.json` name.
2. Literal `[project].name` or `[tool.poetry].name` strings in its root `pyproject.toml`.
3. The selected project folder.

Scoped npm names use their package component: `@team/sample-api` becomes `sample-api`. Names must contain letters, digits, dots, underscores, or hyphens and start with a letter or digit.

Manifest files larger than 64 KiB are ignored. Unsupported Python metadata forms fall back to folder naming. No package scripts or Python build backends run.

For a layout such as `team/sample-api/main`, checkouts named `main`, `master`, or `trunk` use the enclosing `sample-api` folder. That folder must be inside the configured project root. A checkout directly under the root keeps its own folder name.

The folder fallback does not depend on the current branch name. If manifest names change, Refresh and reselect the project. Existing worktree folders keep their paths.

The branch slug permits ASCII letters, digits, dots, underscores, and hyphens. Other character runs become a hyphen. Outer hyphens disappear.

Two repositories with the same name can share a destination. Different branch names can also produce the same slug. An occupied destination stops creation.

The launcher rejects symlinks in existing worktree-store ancestors. The home directory itself can resolve through a symlink. Existing worktrees keep their paths.

## Machines and agents

The initial machine follows the active Herdr space. Changing machines clears the project and branch choices and displays that machine's saved root.

All Git commands stay on the selected machine. A disconnected machine never falls back to local execution. Each target needs `herdr-worktree-launcher`, Git, Worktrunk (`wt`), and `hc` on PATH. The desktop routes calls to the selected machine; the CLI itself has no cross-machine execution.

**Open with** uses Herdr's detected programs and their launch settings. Only available Claude Code, Pi, OpenCode, and Codex programs appear. **Shell** remains available if detection fails.

If an agent is missing from the menu, check that Herdr can detect it on the selected machine. After installation or changes to Herdr's programs, select **Refresh**. Herdr can cache availability briefly.

The launcher creates or reuses the primary project space before opening the worktree. Herdr's standard Spaces sidebar supplies grouping. The launcher needs no `spaces-grouped` mod.

For an existing checkout, the launcher detects matching spaces on the selected machine through live core terminals and Git identity. It prefers a terminal’s foreground directory over its initial launch directory. An empty app-only space cannot be detected through the core.

If a matching space exists, **Open worktree** adds a new tab with a fresh shell or selected agent. Otherwise, it creates a space. It leaves older tabs running.

An opening retry can focus the new tab from the same attempt. A new launcher operation starts another tab.

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

### The CLI or Worktrunk is unavailable

Install `herdr-worktree-launcher` and `wt` on the selected machine. Ensure Herdr's execution environment can find them on PATH. A successful native module check does not verify runtime dependencies.

### Herdr context is missing or the core is unavailable

Set `HC_SOCKET` or `HC_SESSION` to identify the intended running core. The CLI refuses to start or select a default core. A desktop UI call needs these variables in the executing core's environment, not only in an unrelated terminal. A remote call needs the remote core's context.

Read-only project browsing remains available without core context. Creation and opening fail before mutation when context is missing or the selected core cannot be reached.

### The project root is unavailable

Check the machine and the full absolute path. Remote paths must exist on the remote machine.

For a local macOS folder, check System Settings → Privacy & Security → Files and Folders. Enable the relevant folder permission for Herdr, then select **Refresh**.

The CLI inherits the permissions of its executing Herdr process. These permissions can differ from your terminal. Check access from the same execution environment.

If Herdr shows a pending update, finish your work and fully quit and reopen Herdr. Then retry discovery.

### Projects are missing or discovery fails

Check the root and the [discovery exclusions](#discovery-and-branches). For an ignore-rule error, inspect the reported repository path and Git error. Repair its permissions or Git metadata, then select **Refresh**.

Herdr limits each external command to 30 seconds and 8 MiB of output. For a command-limit error, select a narrower project root.

### The worktree exists but its space did not open

Select **Open created worktree**. This action retries app opening without repeating Git creation. You can change **Open with** before the retry.

You can also close and reopen the launcher to select another project. A completed Git operation does not block later launches. The worktree and its running tabs stay unchanged.

Opening waits up to ten seconds for the correct checkout, selected program, and focus. A timeout preserves the worktree and offers an opening retry in the current window.

The CLI validates checkout identity and creates the session. The UI waits for the exact returned terminal and focuses its pane. In-window retries share an outstanding CLI request until it settles.

## Recovery after an interrupted operation

The UI records operations by machine in `<app-home>/data/worktree-launcher-operation.json`. Each record includes its machine and selected program. The UI clears the record once Git creation is verified, before opening or selecting a session. The CLI stores no recovery state between invocations.

After a reload or closure, the UI inspects the selected machine's record and Git. A complete checkout or an operation with no created artifacts clears that record and loads projects. Later commits, upstream changes, and project-name changes do not make an otherwise valid checkout incomplete. Its Git repository, checkout path, and selected branch must still match.

An older Git command can finish after closure. New requests recheck branches and destinations, and each attempt has a unique record ID. An older attempt cannot clear a newer recovery record.

An incomplete operation blocks new creation only on its original machine. Other machines remain usable, even when the original machine is offline or lacks the CLI. Recovery never changes the selected machine. The launcher preserves the branch, checkout, and record for inspection. It never removes worktrees or branches automatically.

The record persists because an interrupted Git command can still finish after its window closes. A new UI window must inspect that uncertain result before another creation on the same machine. Session-opening errors do not block later launches.

Select the original machine to inspect its operation. Install the CLI there if needed. For connection errors, reconnect and select **Refresh**. Older single-operation records remain readable and migrate on the next save without losing the original operation.

For an incomplete operation:

1. Wait for the original Git operation to finish.
2. On the reported machine, inspect the project with `git worktree list --porcelain` and `git branch -vv`.
3. Repair any incomplete artifact manually.
4. Back up the operation record after you understand the Git outcome.
5. Remove only the repaired machine's entry from `operations`. Preserve entries for other machines. For a legacy single-operation record, move the file aside instead.
6. Open the launcher again.

Closing the window does not roll back Git.

## Manual installation

Install the standalone CLI first with `./scripts/install-cli.sh`, or use `--binary FILE` for a prebuilt executable. The mod copy needs no Node or pnpm. From the repository root, copy these files:

```sh
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mkdir -p "$app_home/mods/worktree-launcher"
cp mods/worktree-launcher/main.js mods/worktree-launcher/model.js \
  mods/worktree-launcher/cli.js \
  mods/worktree-launcher/config.js mods/worktree-launcher/journal.js \
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
