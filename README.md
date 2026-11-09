# Worktree Launcher

Create Git worktrees or start a fresh Herdr session from the desktop launcher or a terminal.

Choose a project, select a branch, and open a shell or coding agent. Your primary checkout stays intact.

## Features

| Feature | What you can do |
| --- | --- |
| New branches | Select a local or fetched remote base and create a separate worktree. |
| Existing branches | Create a checkout for an available branch, or use its existing worktree folder. |
| Fetch remote branches | Fetch `origin` or another Git remote, then select new or updated branches without leaving the launcher. |
| Fresh sessions | Detect the worktree's existing Herdr space and open a new tab, or create a space. |
| Shells and agents | Start Shell, Claude Code, Pi, OpenCode, or Codex. Only agents detected on the selected machine appear. |
| Local and remote projects | Browse project folders and save a separate project root for each connected machine. |
| Native Herdr workflow | Keep worktrees grouped beneath their project, use keyboard controls, and follow Herdr's light or dark theme. |
| Terminal CLI | Run locally from any directory, including a mobile terminal, with an explicit canonical checkout. |

If a created worktree's session fails to open, you can retry opening it without repeating Git creation.

## Install the desktop launcher

You need:

- Herdr for macOS, with `herdr-app` and `hc` available in your terminal.
- Git, [Worktrunk](https://worktrunk.dev/) (`wt`), `hc`, and `herdr-worktree-launcher` on each target machine.
- Go for building the CLI. Node.js 24 or newer and pnpm 11.x for installing the desktop mod.

Download or clone this repository. In your terminal, change into its directory, then run:

```sh
./scripts/install-cli.sh
pnpm run install:mod
```

The installer copies the mod, checks it with your installed Herdr, and adds **⌘⇧G** (Command+Shift+G). It preserves existing settings and keybindings.

A dependency installation with `pnpm install` is not required.

If that shortcut is already assigned, use `pnpm run install:mod --no-shortcut`. You can open the launcher from your terminal:

```sh
herdr-app do mod.open --name worktree-launcher
```

The installed mod calls the CLI on the selected machine. It needs no Node process or additional mod. It was checked with Herdr app 0.1.13 and core 0.1.18.

### Choose a different shortcut

1. Open Herdr's `keys.json`, normally at `~/.config/herdr-app/keys.json`.
2. In `global`, add an unused key combination, such as **⌘⌥G** (Command+Option+G):

   ```json
   {
     "global": {
       "cmd-alt-g": "mod.open:worktree-launcher"
     }
   }
   ```

   Merge this entry into the existing `global` object. Keep the other bindings and sections.

3. If present, remove the old `"cmd-shift-g": "mod.open:worktree-launcher"` entry to replace the default shortcut.
4. Save the file, then press your new shortcut.

Herdr applies keybinding changes immediately. No restart is necessary. If you set `HERDR_APP_HOME`, edit `keys.json` in that directory instead.

Key names use `cmd`, `ctrl`, `alt` (Option), and `shift`, joined with hyphens. Bindings in `terminal` or `layout:<name>` override the same combination in `global`.

To install without the default shortcut, use `pnpm run install:mod --no-shortcut`. For later updates, use:

```sh
pnpm run install:mod --update --no-shortcut
```

This preserves your custom binding and prevents the installer from adding **⌘⇧G** again.

## Use the terminal CLI

`herdr-worktree-launcher` runs on Linux and macOS. It needs Git, [Worktrunk](https://worktrunk.dev/) (`wt`), and `hc` on that machine.

The installed command is a standalone executable. It needs no Node, Bun, pnpm, or npm packages. The desktop app can stay closed.

To build and install from this repository, install [Go](https://go.dev/doc/install), then run:

```sh
./scripts/install-cli.sh
```

Go is a build tool only. The CLI uses the Go standard library without third-party Go modules. The script installs one executable at `~/.local/bin/herdr-worktree-launcher`. Add `~/.local/bin` to your `PATH` if necessary. You can also use `pnpm run install:cli`; no dependency installation is required.

The repository includes `mise.toml` for Go and Worktrunk. If you use [mise](https://mise.jdx.dev/), run `mise install` first. Keep `wt` on the runtime `PATH`; the launcher reports a clear error if it is missing. Herdr supplies `hc` separately.

The CLI requires **`HC_SOCKET` or `HC_SESSION`** to identify an already running local Herdr core. Run it from a Herdr terminal that exposes this context. It refuses to guess or start a default core. The desktop launcher has the same requirement: its core execution environment must expose the context. Do not point it at an unrelated core.

The desktop UI delegates discovery, Git operations, program detection, and session creation to this CLI. For a remote target, install the binary and `wt` there too. Herdr routes the UI call; the CLI itself always operates locally.

To install an existing binary without build tools, run:

```sh
./scripts/install-cli.sh --binary ./dist/herdr-worktree-launcher
```

To build without installation, run `./scripts/build-cli.sh`. The output is `dist/herdr-worktree-launcher` for your platform.

To rebuild and update the installed command, run `./scripts/install-cli.sh --update`. For a prebuilt update, also supply `--binary FILE`.

### Choose the canonical checkout

`--checkout` points to **one repository's canonical checkout**, not a directory containing projects. By default, the CLI infers the repository from your current directory. Use `--checkout PATH` to select a different checkout or run from elsewhere.

From any directory, run:

```sh
herdr-worktree-launcher new feature/rate-limits \
  --checkout /work/projects/sample-api --base main

herdr-worktree-launcher open feature/rate-limits \
  --checkout /work/projects/sample-api --program codex
```

There is no environment-variable checkout default. You can also pass `--checkout .` explicitly. Linked checkouts resolve to their canonical checkout.

### Create or open a session

Run `herdr-worktree-launcher` without a command for text prompts. It asks for the checkout path, action, branch, base, and installed program. The checkout prompt offers your current directory.

`new` creates a branch from `--base`, or the canonical checkout's current branch. `open` uses an existing checkout when available. Otherwise, it creates a checkout for the selected local or fetched remote branch. Add `--fetch REMOTE` to refresh one configured remote before resolving branches and invoking Worktrunk:

```sh
herdr-worktree-launcher new feature/mobile --checkout /work/projects/sample-api --base origin/main --fetch origin
herdr-worktree-launcher open origin/feature/search --checkout /work/projects/sample-api --fetch origin
```

Omit `--checkout` when running inside the repository. Supply it when running from elsewhere. Fetching preserves the canonical checkout's branch, index, and files. If fetching fails, the command stops before creating a worktree or session. Without `--fetch`, it uses the refs already available locally.

Each successful command starts a **fresh terminal**. If a matching Herdr space exists, the CLI adds a new tab there. Otherwise, it creates a space. The desktop app adopts the space and tabs when it connects.

`--program` supports `shell`, `claude`, `pi`, `opencode`, and `codex`. The prompts offer only programs available on the local `PATH`. Shell is the default. The CLI uses local executables; desktop launch overrides do not apply.

Use `--attach` to enter the new terminal immediately. Otherwise, the output includes an `hc attach` command. `--json` returns the checkout path and terminal, space, and tab IDs for scripts.

The CLI operates only on the machine where it runs. To use devbox, run the command inside a devbox terminal. It has no machine-routing flags.

If session startup fails after Git succeeds, the CLI reports the preserved checkout path. Use `open` to retry session creation. The CLI stores no recovery state between invocations.

Run `herdr-worktree-launcher --help` for all flags, or `--skill` for the agent API and safety contract. Worktrunk project hooks are skipped; run trusted setup commands yourself after creation. The installer accepts `--prefix DIRECTORY` for a different installation location.

## Create your first worktree

1. Press **⌘⇧G**, or your custom shortcut, to open **Worktree Launcher**.
2. Select **Local** or a connected machine.
3. Use **Browse…** to choose the directory that contains your projects.
4. Select **Save**.
5. Search for your project and select it.
6. Optional: [fetch remote branches](#fetch-the-latest-remote-branches) to update the available choices.
7. Select **New branch**.
8. Select a **Base branch**.
9. Enter a **New branch name**, such as `feature/rate-limits`.
10. Keep **Open with** set to **Shell**, or select an available agent.
11. Check the destination, then select **Create** or press **Enter**.

You can also enter an absolute project-root path directly. The launcher saves a separate root for each machine. The root field stays visible for later changes.

![New branch form showing the project, base branch, name, destination, and Shell selection](docs/screenshots/new-branch.png)

*Create a separate checkout from the selected base. The destination preview shows where it will live.*

### Use an existing branch

Select **Existing branch**, then choose a local or fetched remote branch. The branch-name field disappears.

If the branch already has a checkout, its folder appears in the picker and preview. Select **Open worktree** to open a session in that folder.

The launcher reuses the checkout without changing its files or branches. You can also use checked-out branches as bases for new branches.

![Existing-branch picker showing an existing worktree folder and the Open worktree action](docs/screenshots/existing-branch.png)

*The picker shows existing checkout paths. Conflicting remote branch choices remain disabled, with an explanation.*

### Fetch the latest remote branches

If a branch exists on the remote but is missing from the picker, fetch that remote to load it.

After you select a project, the launcher shows **Git remote** and **Fetch**. It selects `origin` by default, or the first available remote.

1. Select the Git remote that you want to update.
2. Select **Fetch**.
3. Wait for **Fetching…** to finish.
4. Choose a branch from the refreshed **Base branch** or **Branch** picker.

![Git remote set to origin, a successful fetch message, and the newly available origin/feature/from-remote branch](docs/screenshots/fetch-remote.png)

*Fetch discovers `origin/feature/from-remote` in this sample repository. The branch exists only on the remote before the fetch.*

Fetch runs on the selected machine and preserves your checkout and uncommitted work. It does not pull or merge changes into your current branch.

To use the latest remote base, select a remote branch such as `origin/main`. If you select local `main`, the launcher uses its current local commit.

The launcher fetches only when you request it. Repositories without remotes keep these controls disabled.

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

The repository name comes from its `origin` URL. Without an origin, the launcher checks the selected project's root files in this order:

1. `name` in [`package.json`](https://docs.npmjs.com/cli/configuring-npm/package-json/).
2. `[project].name` in [`pyproject.toml`](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/), then `[tool.poetry].name`.
3. The selected project folder.

An npm name such as `@team/sample-api` uses `sample-api` for its destination folder. Missing or unusable names fall through to the next option.

For a layout such as `sample-api/main`, checkouts named `main`, `master`, or `trunk` use the enclosing `sample-api` folder. That folder must be inside the configured project root. Ordinary checkouts keep their folder names.

An occupied destination stops creation.

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
| ⌘⇧G (default) | Open the launcher |
| ↑ / ↓ | Move through an open choice list |
| Enter | Select an open choice, or create/open when the form is ready |
| Enter in Project root | Save the root |
| Enter on Fetch / ⌘Enter in Git remote | Fetch the selected remote |
| ⌘Enter | Create/open directly, or save when Project root has focus |
| Tab / Shift+Tab | Move between controls |
| Esc | Close the launcher when no operation is in progress |

The UI follows Herdr's light or dark theme, including system appearance when Herdr uses it. Destination paths and error messages support text selection.

## Update

From an updated copy of this repository, run:

```sh
./scripts/install-cli.sh --update
pnpm run install:mod --update
```

If you use a custom shortcut, add `--no-shortcut` to preserve it without restoring the default binding.

Updates preserve saved roots and recovery records. Installation does not restart Herdr or its core.

## Need help?

- **CLI unavailable:** install `herdr-worktree-launcher` and Worktrunk on the selected machine, and put both on its `PATH`.
- **Missing Herdr context:** run from an environment with `HC_SOCKET` or `HC_SESSION` for the intended running core. The launcher refuses to guess.
- **No projects:** check the selected machine and root, then select **Refresh**.
- **Cannot read a local folder:** check Herdr's permissions in System Settings → Privacy & Security → Files and Folders.
- **Git succeeded but the space did not open:** select **Open created worktree** to retry without creating another checkout.

See [settings and troubleshooting](docs/worktree-launcher.md) for manual installation, recovery, and removal.

For contributors, see [development](docs/development.md) and the [validation report](docs/validation/worktree-launcher.md).

The [scenario matrix](docs/validation/worktree-launcher.md#automated-worktree-scenarios) lists worktree and recovery tests, CI coverage, and separate native checks.

Build, lint, test, and package locally with `scripts/build-cli.sh`, `scripts/lint.sh`, `scripts/test.sh`, and `scripts/package.sh`. GitHub workflows run these scripts on pushes and pull requests. The Packages workflow uploads CLI and mod archives with checksums; see [package installation](docs/packages.md).

Screenshots use disposable sample projects in a separate Herdr installation. Only agents detected in that installation appear.

License: [MIT](LICENSE).
