# Development

For user instructions, see the [README](../README.md). The [validation report](validation/worktree-launcher.md) records coverage and remaining manual checks.

## Set up

Use Go and Worktrunk from `mise.toml`, plus Node 24 or newer and pnpm 11.x. The repository pins pnpm 11.28.6.

With nvm, run:

```sh
nvm use
pnpm install --frozen-lockfile
```

## Check changes

```sh
go test ./...
pnpm test
herdr-app check mods/worktree-launcher
```

The tests use disposable Git repositories and local bare remotes. Some app interactions use test doubles. The native check validates initial loading, not the full interactive workflow.

No separate lint or typecheck command is configured.

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

The optional integration test creates and removes disposable Git repositories on the named machine:

```sh
WORKTREE_TEST_MACHINE=devbox node --test tests/worktree-launcher-remote.test.mjs
```

Replace `devbox` with a machine already connected in Herdr. The default test run skips this test.

## Capture README screenshots

On macOS, with Herdr and its CLI tools installed, run:

```sh
pnpm run screenshots
```

This command creates a separate app/core profile and real sample repositories. It uses a clean shell profile for screenshots. Your normal Herdr settings and projects stay separate.

A sample-only driver selects fields in the real launcher. It captures new branches, remote fetch, existing branches, fresh tabs, available programs, and the resulting shell space.

A fetch scene discovers a branch that exists only in the sample bare remote. It exports `fetch-remote.png` for the README.

The last scene creates a real sample branch and worktree through the launcher. Agent menus reflect detected programs. The script does not start an agent.

An additional scene opens a pre-existing checkout in its custom folder and checks that Git's worktree list stays unchanged. Its first screenshot remains in the sample directory.

Reopening that checkout must add a fresh terminal tab to the same space. The capture checks the space, tab count, and terminal identity. It exports this second opening as `fresh-tab.png`.

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

`HC_SOCKET` or `HC_SESSION` must identify a running core before creation or opening. The launcher never starts a core. Tests use isolated environments. Worktrunk project hooks are disabled for backend calls.

Use `herdr-worktree-launcher --skill` for JSON operations and response shapes. API requests use one argument containing JSON, without shell interpolation. The UI only selects and focuses the returned terminal; it does not create sessions itself.
