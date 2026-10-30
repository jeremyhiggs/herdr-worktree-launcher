# Personal Worktrees for Herdr

A native Herdr overlay for two Git workflows:

- Create a worktree on an existing local or fetched remote branch.
- Create a new branch from an explicitly selected local or remote base.

The mod uses Herdr app/core, Git, and standard macOS utilities. It needs no Node process or other mod at runtime.

See [installation and use](mods/personal-worktrees/README.md) and the [validation report](docs/validation/personal-worktrees.md).

The supplied shortcut is **Cmd+Shift+G**. Installation does not change your keybindings automatically.

## Development

Run the tests with Node:

```sh
npm test
```

Run the native module check:

```sh
herdr-app check mods/personal-worktrees
```

The test suite uses disposable Git repositories and local bare remotes. Node is a development dependency only.

`git.js` owns repository discovery and Git operations. `model.js` owns form state and recovery. `main.js` owns the native overlay.

Discovery follows the policies in the earlier Herdr worktree workflow bundle. This repository contains the standalone desktop mod.

The implementation plan remains in the separate `herdr-worktree-workflows` repository. The original Launcher scripts remain there unchanged.

License: [MIT](LICENSE).
