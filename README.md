# Worktree Launcher for Herdr

A native Herdr overlay for two Git workflows:

- Create a worktree on an existing local or fetched remote branch.
- Create a new branch from an explicitly selected local or remote base.

The mod uses Herdr app/core, Git, and standard macOS utilities. It needs no Node process or other mod at runtime.

See [installation and use](mods/worktree-launcher/README.md) and the [validation report](docs/validation/worktree-launcher.md).

## Install

With Node 24 or newer and pnpm 11.x, run:

```sh
pnpm run install:mod --project-root "$HOME/Documents/Code"
```

Choose the directory containing your projects. The installer adds **Cmd+Shift+G** if it is unassigned, preserves other bindings, and checks native module loading. Use `--no-shortcut` to leave keybindings unchanged.

For updates, run `pnpm run install:mod --update`. This preserves your configuration. See the [installation guide](mods/worktree-launcher/README.md#install) for custom app homes and manual installation.

## Development

Development requires Node **24 or newer** and **pnpm 11.x**. The repository pins pnpm 11.28.6 and enforces both engine requirements.

With nvm, select Node 24:

```sh
nvm use
pnpm install --frozen-lockfile
```

Open an isolated test window:

```sh
pnpm run test:app
```

The command copies the current mod and creates two disposable repositories: `demo` and `other-demo`.

It uses the installed Herdr app/core binaries with a temporary home, app configuration, core session, and XDG directories.

Test zsh sessions load your normal startup files and use your normal shell history and cache. Herdr state and worktree destinations stay temporary.

Worktree Launcher opens automatically. Cmd+Shift+G applies only to this test window. The terminal prints the discovery root and configuration path.

For **New branch**, select `demo`, explicitly select `available` as the base, and enter `test/new`.

For **Existing branch**, select local `available` or remote `origin/remote-only`. Both repositories contain these choices.

Projects appear in a dropdown below Search projects. Branch choices appear below their own field.

The mod opens the primary checkout as a project space when needed. Herdr groups its worktree spaces beneath it.

The terminal also prints a stop command:

```sh
pnpm run test:app stop /path/printed/by/the/launcher
```

The stop command closes only that test app and core. It preserves temporary files and logs for inspection.

Repository discovery reads `<app-home>/mods/worktree-launcher/config.json`:

```json
{
  "project_root": "/absolute/path/to/projects"
}
```

The test command sets `project_root` to `<test-directory>/projects`. Normal installation uses your own absolute directory, with no fallback to `~/Documents/Code`.

Discovery searches below this directory. Build directories, ignored repositories, bare repositories, and duplicate linked worktrees remain excluded.

Run the tests with Node:

```sh
pnpm test
```

Run the native module check:

```sh
herdr-app check mods/worktree-launcher
```

The test suite uses disposable Git repositories and local bare remotes. Node is a development dependency only.

`git.js` owns repository discovery and Git operations. `model.js` owns form state and recovery. `main.js` owns the native overlay.

Discovery follows the policies in the earlier Herdr worktree workflow bundle. This repository contains the standalone desktop mod.

The implementation plan remains in the separate `herdr-worktree-workflows` repository. The original Launcher scripts remain there unchanged.

License: [MIT](LICENSE).
