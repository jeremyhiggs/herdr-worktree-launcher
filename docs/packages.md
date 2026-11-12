# Install a package

Packages contain standalone CLI executables or the desktop mod. Download `SHA256SUMS` with the archives. Check each downloaded archive against its checksum before extraction. With all five archives present, run `sha256sum -c SHA256SUMS` on Linux, or `shasum -a 256 -c SHA256SUMS` on macOS.

## CLI

Choose `darwin` for macOS or `linux` for Linux. Choose `arm64` for Apple Silicon or ARM Linux, and `amd64` for Intel or AMD machines.

Extract the archive and enter its directory. Then run:

```sh
pnpm run install:cli
```

The installer detects the bundled executable. It needs no Go installation. It installs the command in `~/.local/bin`; add that directory to PATH. Run the same command again to update it. An unrelated existing command is preserved.

No dependency installation is required. If you do not use pnpm, run `./scripts/install-cli.sh` instead; the shell installer works without Node or pnpm.

The executable needs Git, Worktrunk (`wt`), and Herdr Core (`hc`) on PATH. It needs no Go or Node runtime.

Run from an environment with `HC_SOCKET` or `HC_SESSION` identifying an already running core. Missing context or Worktrunk stops creation. The CLI never starts a default core.

```sh
herdr-worktree-launcher --help
herdr-worktree-launcher --skill
```

`new` and `open` infer the repository from your current directory. Use `--checkout PATH` to select a checkout explicitly or run from elsewhere. Add `--fetch origin` (or another configured remote) to refresh branches before creation or opening. Fetch failure stops the command. `USAGE.txt` lists commands and options.

## Desktop mod

Install the CLI and its dependencies on each target machine first. Extract `worktree-launcher-mod.tar.gz` and enter its directory.

With Node 24 or newer, pnpm 11.x, and `herdr-app` on PATH, run:

```sh
pnpm run install:mod
```

Run the same command again to update the mod. Saved roots and existing settings are preserved. The installer checks native loading and assigns Command+Shift+G. Use `--no-shortcut` to preserve a different binding.

If you do not use pnpm, run `node scripts/install-mod.mjs` instead. No dependency installation is required.

Node is required only for this installer. The running mod calls the standalone CLI. The mod supplies a verified running core ID automatically. No manual core environment export is required for the desktop UI.

The installed mod's README describes project roots, branch selection, remote fetch, agents, and recovery. Packages contain no personal settings or saved operation records.
