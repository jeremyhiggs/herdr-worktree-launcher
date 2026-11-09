# Install a package

Packages contain standalone CLI executables or the desktop mod. Download `SHA256SUMS` with the archives. Check each downloaded archive against its checksum before extraction. With all five archives present, run `sha256sum -c SHA256SUMS` on Linux, or `shasum -a 256 -c SHA256SUMS` on macOS.

## CLI

Choose `darwin` for macOS or `linux` for Linux. Choose `arm64` for Apple Silicon or ARM Linux, and `amd64` for Intel or AMD machines.

Extract the archive and enter its directory. Then run:

```sh
./scripts/install-cli.sh --binary ./herdr-worktree-launcher
```

This installs the command in `~/.local/bin`. Add that directory to PATH. Use `--update` to replace an existing installation.

The executable needs Git, Worktrunk (`wt`), and Herdr Core (`hc`) on PATH. It needs no Go or Node runtime.

Run from an environment with `HC_SOCKET` or `HC_SESSION` identifying an already running core. Missing context or Worktrunk stops creation. The CLI never starts a default core.

```sh
herdr-worktree-launcher --help
herdr-worktree-launcher --skill
```

Use `--checkout` to select one repository's canonical checkout from any directory. `USAGE.txt` lists commands and options.

## Desktop mod

Install the CLI and its dependencies on each target machine first. Extract `worktree-launcher-mod.tar.gz` and enter its directory.

With Node 24 or newer and `herdr-app` on PATH, run:

```sh
node scripts/install-mod.mjs
```

For an update, add `--update`. The installer checks native loading and assigns Command+Shift+G. Use `--no-shortcut` to preserve a different binding.

Node is required only for this installer. The running mod calls the standalone CLI. The executing core must expose its own `HC_SOCKET` or `HC_SESSION`.

The installed mod's README describes project roots, branch selection, remote fetch, agents, and recovery. Packages contain no personal settings or saved operation records.
