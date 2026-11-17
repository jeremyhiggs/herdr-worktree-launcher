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

With [mise](https://mise.jdx.dev/getting-started.html), install a current Worktrunk runtime globally:

```sh
mise use --global worktrunk@latest
```

Activate mise in the shell used by Herdr so `wt` remains available outside this package folder. Git and `hc` use their system or upstream installers. Mise's `herdr` registry entry installs the separate TUI, not `hc`.

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

To obtain the installer tools through mise, run `mise use --global node@24 pnpm@11` first. These version prefixes allow newer patches within Node 24 and pnpm 11. The prebuilt mod needs no Go installation or validation tools.

Run the same command again to update the mod. Saved roots and existing settings are preserved. The installer checks native loading before replacing installed code or settings and assigns Command+Shift+G. Use `--no-shortcut` to preserve a different binding.

Avoid editing project roots or keybindings while installation is running. Concurrent edits to existing settings files can be overwritten because the conflict check and write are separate.

If you do not use pnpm, run `node scripts/install-mod.mjs` instead. No dependency installation is required.

Node is required only for this installer. The running mod calls the standalone CLI. The mod supplies a verified running core ID automatically. No manual core environment export is required for the desktop UI.

The installed mod's README describes project roots, branch selection, remote fetch, agents, and recovery. Packages contain no personal settings or saved operation records.
