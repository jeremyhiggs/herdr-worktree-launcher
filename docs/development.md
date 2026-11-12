# Development

For user instructions, see the [README](../README.md). The [validation report](validation/worktree-launcher.md) records coverage and remaining manual checks.

## Set up

Use Go and Worktrunk from `mise.toml`, plus Node 24 or newer and pnpm 11.x. The repository pins pnpm 11.28.6.

Install Git and zsh (already supplied on macOS), then install the pinned tools and development dependencies:

```sh
mise install
pnpm install
```

## Check changes

The GitHub workflows use the same scripts as local development:

| Command | Checks or output |
| --- | --- |
| `./scripts/build-cli.sh` | Standalone executable in `dist/` |
| `./scripts/format.sh` | Format JavaScript, TypeScript, and JSON with Biome, Go with gofmt, and shell scripts with shfmt |
| `./scripts/format.sh --check` | Reject formatting drift without changing files |
| `./scripts/lint.sh` | Formatting checks, Biome lint, Go vet, JavaScript syntax, ShellCheck, and actionlint |
| `./scripts/deps-check.sh` | pnpm audit at moderate severity or higher, then govulncheck for Go code |
| `./scripts/security.sh` | Redacted Gitleaks scan of committed history, then dependency checks |
| `./scripts/test.sh` | Go tests with the race detector, then all Node tests |
| `./scripts/validate.sh` | Lint, security checks, tests, and the standalone CLI build |
| `./scripts/package.sh` | Four CLI archives, a desktop mod archive, and SHA256SUMS in `dist/packages/` |
| `./scripts/test-package.sh` | Verify archive checksums, install an extracted CLI, and run the packaged mod's install-script help |

Packaging supports `--output DIRECTORY`. It includes only distribution files; personal configuration, recovery records, generated API files, and screenshot fixtures are excluded.

CI runs `scripts/validate.sh` on Linux and macOS for pushes, pull requests, and manual runs. Both runners check formatting, lint, secrets, dependencies, tests, and the CLI build. The Packages workflow cross-compiles four CLI targets and uploads CLI and mod archives with checksums. It does not publish a GitHub release.

CI uses full-history checkouts without retained credentials. The weekly validation starts on Monday at 00:00 UTC. All workflow actions use full commit SHA pins. Biome, shfmt, ShellCheck, actionlint, Gitleaks, and govulncheck have exact versions in `mise.toml`.

Missing tools and scanner errors fail validation. Gitleaks findings fail the scan, with matched secrets redacted. It scans committed history, including the code checked out by CI. It does not scan uncommitted files.

Govulncheck fails for vulnerabilities reachable from this code; module-only advisories can be informational. It needs access to the Go vulnerability database. Neither scanner is a CLI runtime dependency.

For complete local validation, run:

```sh
./scripts/validate.sh
```

The pnpm shortcuts are `pnpm run format`, `pnpm run format:check`, `pnpm run lint`, `pnpm run deps:check`, and `pnpm run validate`.

Use `pnpm test` for both Go race tests and Node tests. Use `pnpm run test:js` for only the Node suite. `pnpm run build`, `pnpm run package`, and `pnpm run test:package` call the corresponding scripts.

## pnpm policy

The repository keeps pnpm 11.28.6 pinned. `pnpm-workspace.yaml` enforces engines and sets `frozenLockfile: true`. Plain `pnpm install` fails for a missing or outdated lockfile, locally and in CI. New package releases wait seven days before installation. Exotic transitive sources are blocked. Dependency build scripts are denied by default. Unapproved builds fail installation.

If a dependency needs a build script, review its installed version. Add only an exact-version entry to `allowBuilds`. Release-age exceptions also require exact reviewed versions. Do not use broad exceptions or disable the policy to make installation pass.

After policy or manifest changes, clear generated install state. Run `pnpm install --no-frozen-lockfile`, then a clean `pnpm install`. The explicit override updates the lockfile when needed. Preserve unrelated local files. CI uses plain `pnpm install` and the committed frozen policy.

There are no npm dependencies. `package.json` supplies ES-module settings and development commands for the JavaScript mod, tests, and installer. It is not required to run the Go executable.

For the tested worktree cases and CI limits, see the [scenario matrix](validation/worktree-launcher.md#automated-worktree-scenarios).

For package contents and installation, see [Install a package](packages.md).

Tests use disposable Git repositories, real Worktrunk, and core/app protocol fixtures. They need no live Herdr instance. Native mod loading remains a separate macOS check:

```sh
herdr-app check mods/worktree-launcher
```

That check validates initial loading, not the full interactive workflow. Biome checks JavaScript and TypeScript syntax and lint rules. There are no handwritten TypeScript sources or a separate type checker. Generated declaration files are excluded from formatting and linting.

## Open an isolated test app

```sh
pnpm run build:cli
pnpm run test:app
```

This command copies the current mod and creates two sample projects, `demo` and `other-demo`. It opens the launcher automatically.

The app uses temporary settings, core storage, worktrees, and XDG directories. Its zsh terminals load your normal startup files and use your normal shell history and cache.

For a new branch, select `demo`, choose base `available`, and enter `test/new`. For an existing branch, choose local `available` or remote `origin/remote-only`.

The command prints a stop command with the temporary directory:

```sh
pnpm run test:app stop /path/printed/by/the/launcher
```

This stops only the test app and core. It preserves files and logs for inspection.

## Test a connected machine

Install the CLI and Worktrunk on the connected machine. Use the desktop launcher's machine picker to exercise remote discovery, fetch, creation, and session opening with disposable projects. This native remote check is separate from CI's local fixtures.

## Capture README screenshots

On macOS, with Herdr and its CLI tools installed, run:

```sh
pnpm run screenshots
```

This command creates a separate app/core profile and real sample repositories. It uses a clean shell profile for screenshots. Your normal Herdr settings and projects stay separate.

A sample-only driver selects fields in the real launcher. It captures new branches, remote fetch, existing branches, fresh tabs, available programs, and the resulting shell space.

Both sample launchers bind their copied JSON client to the built executable in `dist/`. Shell startup files cannot redirect these checks to an older installed CLI.

A fetch scene discovers a branch that exists only in the sample bare remote. It exports `fetch-remote.png` for the README.

The last scene creates a real sample branch and worktree through the launcher. Agent menus reflect detected programs. The script does not start an agent.

An additional scene opens a pre-existing checkout in its custom folder and checks that Git's worktree list stays unchanged. Its first screenshot remains in the sample directory.

Reopening that checkout must add a fresh terminal tab to the same space. The capture checks the space, tab count, and terminal identity. It exports this second opening as `fresh-tab.png`.

After creation, the capture opens a tab for the new worktree inside the primary project's space. It reopens the launcher and verifies automatic project and base-branch selection before exporting `current-space.png`. This catches stale lookups of the space's starting folder.

To verify the native flow without replacing README images, use a different output directory:

```sh
pnpm run screenshots --output /private/tmp/worktree-launcher-screenshots
```

Images replace the files in `docs/screenshots/`. The script stops its app and core and prints the retained sample directory for inspection.

The capture activates the sample window on your desktop. Its sample profile skips the first-run welcome and release notes.

Review every image before committing. Check the form, menu contents, sidebar, terminal, and visible paths. Screenshots demonstrate rendering and programmatic integration, not physical keyboard routing.

## Source layout

| File | Responsibility |
| --- | --- |
| `mods/worktree-launcher/main.js` | Native overlay and keyboard controls |
| `mods/worktree-launcher/model.js` | Form state, opening, and recovery |
| `mods/worktree-launcher/cli.js` | JSON client; UI routing to the selected machine |
| `cmd/herdr-worktree-launcher/` | Go CLI, discovery, worktrees, naming, and core sessions |
| `scripts/build-cli.sh` | Build the standalone Go CLI |
| `scripts/install-cli.sh` | Install the standalone binary, or build it with Go first |
| `mods/worktree-launcher/config.js` | Saved project roots |
| `mods/worktree-launcher/journal.js` | Recovery records, conflict matching, and stale-write protection |
| `scripts/install-mod.mjs` | Copy, native check, and shortcut merge |
| `scripts/test-app.mjs` | Interactive sample app |
| `scripts/capture-screenshots.mjs` | Disposable screenshot installation |

The installer distributes the mod's README with its code. Keep that guide self-contained. Repository-only images and guides belong in the root README.

## Before release

1. Run the tests and native check.
2. Follow the root README in a fresh sample installation.
3. Exercise keyboard and mouse controls in both branch modes.
4. Check a connected machine and each supported agent available to you.
5. Capture and inspect current screenshots.
6. Check documentation links and update the validation report.
7. Review the diff and scan for private data before committing.

Keep installation, local commits, publishing, and release tagging as separate steps.

## CLI builds

The CLI uses the Go standard library and has no external Go modules. The desktop mod is a JSON client for this executable.

Run `mise install` for the pinned Go and Worktrunk versions, then `./scripts/build-cli.sh`. The output is `dist/herdr-worktree-launcher`. It needs no Go or Node runtime. Runtime dependencies are `git`, `wt`, and `hc`.

For another platform, set Go's build variables:

```sh
GOOS=linux GOARCH=amd64 ./scripts/build-cli.sh --output dist/herdr-worktree-launcher-linux-amd64
```

Build outputs are ignored. Node and pnpm remain development tools for the UI tests and mod installation. CLI tests build the actual Go executable and use real Git/Worktrunk with a core protocol fixture. Go tests cover Git safety and core session matching.

Standalone commands require `HC_SOCKET` or `HC_SESSION`. The UI reads `core_id` from the context API and supplies it in creation and opening requests. The CLI checks that the running core still has that ID, including when environment selectors are absent. A mismatched ID fails before mutation.

The launcher never starts a core. Tests use isolated environments. Worktrunk project hooks are disabled for backend calls.

Use `herdr-worktree-launcher --skill` for JSON operations and response shapes. API requests use one argument containing JSON, without shell interpolation. The UI only selects and focuses the returned terminal; it does not create sessions itself.
