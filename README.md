# Worktree Launcher

Create Git worktrees or start a fresh session in an existing checkout, without leaving Herdr.

Choose a project, select a branch, and open a shell or coding agent. Your primary checkout stays intact.

## Features

| Feature | What you can do |
| --- | --- |
| New branches | Select a local or fetched remote base and create a separate worktree. |
| Existing branches | Create a checkout for an available branch, or use its existing worktree folder. |
| Fresh sessions | Detect the worktree's existing Herdr space and open a new tab, or create a space. |
| Shells and agents | Start Shell, Claude Code, Pi, OpenCode, or Codex. Only agents detected on the selected machine appear. |
| Local and remote projects | Browse project folders and save a separate project root for each connected machine. |
| Native Herdr workflow | Keep worktrees grouped beneath their project, use keyboard controls, and follow Herdr's light or dark theme. |

If a created worktree's session fails to open, you can retry opening it without repeating Git creation.

## Install

You need:

- Herdr for macOS, with `herdr-app` and `hc` available in your terminal.
- Git and Bash on each machine that will contain worktrees.
- Node.js 24 or newer and pnpm 11.x for installation only.

Download or clone this repository. In your terminal, change into its directory, then run:

```sh
pnpm run install:mod
```

The installer copies the mod, checks it with your installed Herdr, and adds **⌘⇧G** (Command+Shift+G). It preserves existing settings and keybindings.

A dependency installation with `pnpm install` is not required.

If that shortcut is already assigned, use `pnpm run install:mod --no-shortcut`. You can open the launcher from your terminal:

```sh
herdr-app do mod.open --name worktree-launcher
```

The installed mod needs no Node process or additional mod. It was checked with Herdr app 0.1.13 and core 0.1.18.

## Create your first worktree

1. Press **⌘⇧G** to open **Worktree Launcher**.
2. Select **Local** or a connected machine.
3. Use **Browse…** to choose the directory that contains your projects.
4. Select **Save**.
5. Search for your project and select it.
6. Select **New branch**.
7. Select a **Base branch**.
8. Enter a **New branch name**, such as `feature/rate-limits`.
9. Keep **Open with** set to **Shell**, or select an available agent.
10. Check the destination, then select **Create** or press **Enter**.

You can also enter an absolute project-root path directly. The launcher saves a separate root for each machine. The root field stays visible for later changes.

![New branch form showing the project, base branch, name, destination, and Shell selection](docs/screenshots/new-branch.png)

*Create a separate checkout from the selected base. The destination preview shows where it will live.*

### Use an existing branch

Select **Existing branch**, then choose a local or fetched remote branch. The branch-name field disappears.

If the branch already has a checkout, its folder appears in the picker and preview. Select **Open worktree** to open a session in that folder.

The launcher reuses the checkout without changing its files or branches. You can also use checked-out branches as bases for new branches.

![Existing-branch picker showing an existing worktree folder and the Open worktree action](docs/screenshots/existing-branch.png)

*The picker shows existing checkout paths. Conflicting remote branch choices remain disabled, with an explanation.*

The launcher uses the refs already on your machine. To see newer remote branches, fetch them in your repository before opening the launcher.

### Start a fresh tab in an existing worktree

1. Select **Existing branch** and a branch with an existing checkout.
2. Check the **Existing worktree** folder.
3. Choose **Shell** or an available agent under **Open with**.
4. Select **Open worktree**, or press **Enter**.

The launcher automatically detects a matching Herdr space on the selected machine. If it finds one, it opens a **new tab** there. Otherwise, it creates a space.

Each launch starts a fresh shell or agent. Older tabs keep running. Retrying an interrupted opening can reuse the tab from that attempt.

![The same worktree session with a new second tab selected and the original first tab still open](docs/screenshots/fresh-tab.png)

*Reopening this worktree adds tab 2 to the existing session. Tab 1 keeps running in the same worktree.*

### Open a coding agent

**Open with** defaults to **Shell**. It also offers Claude Code, Pi, OpenCode, and Codex when Herdr detects them on the selected machine.

The selected agent starts in the worktree with its Herdr launch settings. The primary project keeps its existing terminals.

![Open with menu offering Shell and the agents available in this sample installation](docs/screenshots/open-with.png)

*This sample installation detects OpenCode and Codex. Your menu reflects the programs available on the selected machine.*

### Find the result

The launcher opens the worktree in a Herdr space and reuses the primary project space when available. Herdr's standard sidebar groups worktrees beneath their project.

![A new worktree grouped beneath sample-api with its shell open](docs/screenshots/worktree-opened.png)

*A worktree appears beneath its project. Its selected tab starts in the worktree folder.*

Worktrees go to `~/.herdr/worktrees/<repository-name>/<branch-slug>` on the selected machine. For example, `feature/rate-limits` becomes `sample-api/feature-rate-limits`.

The repository name comes from its `origin` URL, or its primary checkout folder when no origin exists. An occupied destination stops creation.

## Work on a remote machine

1. Add the machine in Herdr with **Add machine**.
2. Open Worktree Launcher.
3. Select the machine in **Machine**.
4. Use **Browse…** to list its directories, or enter an absolute remote path.
5. Select **Save**.

Project discovery, Git commands, worktrees, and agents all use the selected machine. Only the desktop app needs the mod. Remote machines need no Node installation.

## Keyboard controls

| Key | Action |
| --- | --- |
| ⌘⇧G | Open the launcher |
| ↑ / ↓ | Move through an open choice list |
| Enter | Select an open choice, or create/open when the form is ready |
| Enter in Project root | Save the root |
| ⌘Enter | Create/open directly, or save when Project root has focus |
| Tab / Shift+Tab | Move between controls |
| Esc | Close the launcher when no operation is in progress |

The UI follows Herdr's light or dark theme, including system appearance when Herdr uses it. Destination paths and error messages support text selection.

## Update

From an updated copy of this repository, run:

```sh
pnpm run install:mod --update
```

Updates preserve saved roots and recovery records. Installation does not restart Herdr or its core.

## Need help?

- **No projects:** check the selected machine and root, then select **Refresh**.
- **Cannot read a local folder:** check Herdr's permissions in System Settings → Privacy & Security → Files and Folders.
- **Git succeeded but the space did not open:** select **Open created worktree** to retry without creating another checkout.

See [settings and troubleshooting](docs/worktree-launcher.md) for manual installation, recovery, and removal.

For contributors, see [development](docs/development.md) and the [validation report](docs/validation/worktree-launcher.md).

Screenshots use disposable sample projects in a separate Herdr installation. Only agents detected in that installation appear.

License: [MIT](LICENSE).
