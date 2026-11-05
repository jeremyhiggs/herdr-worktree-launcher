# Worktree Launcher

## Requirements

- macOS with Herdr app/core and Git.
- Standard macOS `find`, `realpath`, `test`, and `mkdir` utilities.
- One absolute, readable project directory.

The mod was checked with Herdr app 0.1.10 and core 0.1.15. Other versions need a fresh module check.

## Install

From the repository root, copy the distributable files:

```sh
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
mkdir -p "$app_home/mods/worktree-launcher"
cp mods/worktree-launcher/main.js mods/worktree-launcher/model.js \
  mods/worktree-launcher/git.js mods/worktree-launcher/mod.json \
  mods/worktree-launcher/config.example.json mods/worktree-launcher/keys.json \
  mods/worktree-launcher/README.md "$app_home/mods/worktree-launcher/"
```

Create `config.json` in the installed mod directory. Replace this example path with your project directory:

```json
{
  "project_root": "/absolute/path/to/projects"
}
```

The mod does not expand `~` or choose a fallback directory. Configuration errors appear in the overlay.

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
2. Search for a project.
3. Select a result from the project dropdown with the mouse or Up/Down and Enter.
4. Choose **New branch** or **Existing branch**.
5. Select a local or fetched remote branch. New branch uses it as a base; Existing branch checks it out directly. Switching actions preserves the selected branch.
6. For a new branch, enter the name in the field below the branch picker. This field is hidden for Existing branch.
7. Read the destination.
8. Activate **Create** or press Cmd+Enter.

Enter in a search field selects a choice. It does not submit the form. Tab and Shift+Tab move between controls.

The new-name field stays disabled until you select a base. Each choice list opens below its own search field.

The launcher uses Herdr's theme colors for light and dark themes. It follows system appearance when Herdr follows it; an explicit appearance setting in Herdr takes precedence.

The mod reuses a space for the primary checkout or creates it first. Herdr groups the new worktree space beneath this project space.

The mod requests Herdr's normal default shell, with no custom terminal command.

Checked-out local branches are disabled for Existing branch and show their checkout path. They remain available as bases for new branches. If you select one as a base and switch to Existing branch, Create stays disabled and the checkout path explains why.

A remote selection creates its local branch and tracks that specific remote. A new branch has no upstream, including from a remote base.

Refresh rereads the configuration and discovers projects again. Opening the overlay also refreshes it.

## Destination and limits

The destination is `~/.herdr/worktrees/<primary-repo-basename>/<branch-slug>`.

The slug replaces runs outside ASCII letters, digits, dot, underscore, and hyphen with a hyphen. It trims outer hyphens.

Repositories with the same basename can collide. Different branch names can also produce the same slug. An occupied destination stops creation.

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

1. Wait for the original Git operation to finish.
2. Inspect the reported repository with `git worktree list --porcelain` and `git branch -vv`.
3. Repair any incomplete artifact manually.
4. Move the operation record aside after you understand the outcome.
5. Open the overlay again.

The mod does not remove branches or worktrees. It does not claim that window closure rolls back Git.

## Update and remove

For an update, repeat the source-file copy from Install. The copy excludes `config.json` and preserves your configuration.

Before removal, move `config.json` to a backup directory outside the mod folder.

Then remove the installed `mods/worktree-launcher` directory and its optional keybinding. Preserve any recovery record until its operation is resolved.

Removal does not remove Git worktrees, branches, app spaces, or unrelated app files.
