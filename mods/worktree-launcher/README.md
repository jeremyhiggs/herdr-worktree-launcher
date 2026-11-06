# Worktree Launcher

A native Herdr overlay for Git worktrees on local and connected Linux or macOS machines.

## Install or update

From the source repository, run:

```sh
pnpm run install:mod
```

For an existing installation, run:

```sh
pnpm run install:mod --update
```

The installer requires Node 24 or newer, pnpm 11.x, and `herdr-app` in your terminal. The installed mod needs no Node process or additional mod.

It copies files into `${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/worktree-launcher` and runs a native loading check. Updates preserve saved roots and recovery records.

The installer adds **⌘⇧G** (Command+Shift+G) unless it already has another action. To preserve a conflicting shortcut, add `--no-shortcut`.

Open with **⌘⇧G**, or run:

```sh
herdr-app do mod.open --name worktree-launcher
```

## First use

1. Select **Local** or a connected machine.
2. Use **Browse…** to choose the directory that contains your projects, or enter its absolute path.
3. Select **Save**.
4. Search for a project and select it.
5. Choose **New branch** or **Existing branch**.
6. Select a branch. For a new branch, this is the base.
7. For a new branch, enter its name.
8. Choose **Open with**: **Shell** or an available coding agent.
9. Check the destination, then select **Create** or press **Enter**.

The launcher saves a separate project root for each machine. Remote browsing lists folders on the selected machine. No remote mod or Node installation is necessary.

Each target needs Git, `/bin/bash`, `find`, `realpath`, `test`, and `mkdir`. The mod was checked with Herdr app 0.1.13 and core 0.1.18.

## Branches and programs

The branch picker includes local and fetched remote branches. The launcher does not fetch automatically.

Checked-out branches show their paths. Select one and use **Open worktree** to open a session in its existing folder. Its files, branch, and tracking settings stay intact.

The launcher detects an existing Herdr space for the worktree and adds a **new tab**. If none exists, it creates a space. Each launch starts a fresh shell or agent.

Checked-out branches also remain available as bases for **New branch**.

An existing remote branch creates a local branch that tracks that remote. A new branch has no upstream.

**Open with** defaults to **Shell**. Claude Code, Pi, OpenCode, and Codex appear when Herdr detects them on the selected machine. Agents use their Herdr launch settings.

The launcher creates or reuses the primary project space, then opens the worktree space. Herdr's standard sidebar groups worktrees beneath their project. No `spaces-grouped` mod is required.

## Controls

| Key | Action |
| --- | --- |
| ↑ / ↓ | Move through an open choice list |
| Enter | Select a choice, or create/open when the form is ready |
| Enter in Project root | Save the root |
| ⌘Enter | Create/open directly, or save when Project root has focus |
| Tab / Shift+Tab | Move between controls |
| Esc | Close when no operation is in progress |

**Refresh** reloads settings and scans for projects. The UI follows Herdr's theme. Error messages and destination paths support text selection.

## Paths and settings

Worktrees go to `~/.herdr/worktrees/<repository-name>/<branch-slug>` on the selected machine. The repository name comes from `origin`, or the primary checkout folder when no origin exists.

For example, branch `feature/search` in `sample-api` uses `~/.herdr/worktrees/sample-api/feature-search`. An occupied destination stops creation. Existing worktrees keep their paths.

Roots live in `<app-home>/data/worktree-launcher-config.json`:

```json
{
  "project_root": "/absolute/projects",
  "remote_project_roots": {
    "devbox": "/srv/projects"
  }
}
```

Paths must be absolute. The launcher does not expand `~` or environment variables in this file. Old `mods/worktree-launcher/config.json` settings migrate on save or installation.

Discovery excludes ignored repositories, build directories, bare repositories, native JJ-only workspaces, and duplicate linked worktrees.

## Troubleshooting and recovery

If projects are missing, check the machine and root, then select **Refresh**. For local folder-access errors, check Herdr's Files and Folders permissions in macOS System Settings.

If Git succeeds but app opening fails, select **Open created worktree**. This retries opening without repeating Git creation.

The operation record lives in `<app-home>/data/worktree-launcher-operation.json`. After a reload, a complete checkout offers the same retry. An incomplete operation blocks new creation across machines.

For an incomplete operation:

1. Wait for the original Git operation to finish.
2. On the reported machine, inspect the project with `git worktree list --porcelain` and `git branch -vv`.
3. Repair any incomplete artifact manually.
4. Move the operation record aside only after you understand the Git outcome.
5. Open the launcher again.

The launcher never removes branches or worktrees automatically. Closing the window does not roll back Git.

## Remove

Resolve pending operations first. Back up any legacy `mods/worktree-launcher/config.json`, then remove the installed mod directory and its shortcut.

Settings under `data/`, Git worktrees, branches, and Herdr spaces remain.
