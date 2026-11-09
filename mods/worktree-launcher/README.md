# Worktree Launcher

A native Herdr overlay for Git worktrees on local and connected Linux or macOS machines.

## Install or update

From the source repository, run:

```sh
./scripts/install-cli.sh
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

The launcher saves a separate project root for each machine. Remote browsing lists folders on the selected machine. Install the CLI, Worktrunk (`wt`), Git, and `hc` on each target. No remote mod or Node installation is necessary.

The UI delegates repository and session operations to `herdr-worktree-launcher`. Its execution environment needs `HC_SOCKET` or `HC_SESSION` for an already running core. It never guesses a default core. The mod was checked with Herdr app 0.1.13 and core 0.1.18.

## Branches and programs

The branch picker includes local and fetched remote branches. The launcher does not fetch automatically.

After you select a project, choose a **Git remote** and select **Fetch** to update its branches. The default is `origin`, or the first available remote. **Fetching…** appears while other controls stay disabled.

The branch picker refreshes after fetching. A valid selection and your new branch name stay intact. Fetch runs on the selected machine and preserves your checkout and uncommitted work.

For the latest remote base, choose a branch such as `origin/main`. Repositories without remotes keep fetch controls disabled.

Checked-out branches show their paths. Select one and use **Open worktree** to open a session in its existing folder. Its files, branch, and tracking settings stay intact.

The launcher detects an existing Herdr space for the worktree and adds a **new tab**. If none exists, it creates a space. Each launch starts a fresh shell or agent.

Checked-out branches also remain available as bases for **New branch**.

An existing remote branch creates a local branch that tracks that remote. A new branch has no upstream.

**Open with** defaults to **Shell**. Claude Code, Pi, OpenCode, and Codex appear when Herdr detects them on the selected machine. The UI passes Herdr launch settings to the CLI, which checks the executable on the target machine.

The CLI reuses a space for the exact checkout, or assigns a new space to its terminal. Herdr's standard sidebar groups worktrees beneath their project. No `spaces-grouped` mod is required.

## Controls

| Key | Action |
| --- | --- |
| ↑ / ↓ | Move through an open choice list |
| Enter | Select a choice, or create/open when the form is ready |
| Enter in Project root | Save the root |
| Enter on Fetch / ⌘Enter in Git remote | Fetch the selected remote |
| ⌘Enter | Create/open directly, or save when Project root has focus |
| Tab / Shift+Tab | Move between controls |
| Esc | Close when no operation is in progress |

**Refresh** reloads settings and scans for projects. The UI follows Herdr's theme. Error messages and destination paths support text selection.

## Paths and settings

Worktrees go to `~/.herdr/worktrees/<repository-name>/<branch-slug>` on the selected machine. The repository name comes from `origin`.

Without an origin, the launcher checks the selected project's root `package.json` name, then `pyproject.toml` names under `[project]` or `[tool.poetry]`. An npm scope is removed. Missing or unusable names fall back to the selected project folder.

For a layout such as `sample-api/main`, checkouts named `main`, `master`, or `trunk` use the enclosing `sample-api` folder. That folder must be inside the configured project root. Ordinary checkouts keep their folder names.

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

The operation record lives in `<app-home>/data/worktree-launcher-operation.json`. It is cleared once Git creation is verified, before session opening. An opening failure offers an in-window retry; the next launcher run starts fresh. Recovery also clears a record when Git confirms no artifacts were created. An incomplete Git operation blocks new creation across machines.

For an incomplete operation:

1. Wait for the original Git operation to finish.
2. On the reported machine, inspect the project with `git worktree list --porcelain` and `git branch -vv`.
3. Repair any incomplete artifact manually.
4. Move the operation record aside only after you understand the Git outcome.
5. Open the launcher again.

The CLI uses Worktrunk for creation and skips Worktrunk project hooks. Run trusted setup manually. Missing `wt` or Herdr context stops creation.

The launcher never removes branches or worktrees automatically. Closing the window does not roll back Git.

## Remove

Resolve pending operations first. Back up any legacy `mods/worktree-launcher/config.json`, then remove the installed mod directory and its shortcut.

Settings under `data/`, Git worktrees, branches, and Herdr spaces remain.
