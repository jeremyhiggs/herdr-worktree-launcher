# Validation report

Last updated: 2026-11-12.

The launcher now uses a standalone Go CLI for repository and session operations. Earlier JavaScript backend measurements do not establish this implementation's performance.

## Current checks

| Check | Result | Coverage |
| --- | --- | --- |
| Go tests, race detector, and vet | Passed | Real Git and Worktrunk fixtures; discovery, naming, refs, fetch, preservation, partial failures, core context, hook suppression, and session matching |
| Node tests | 100 passed | CLI commands, installation, JSON client, UI form, recovery, focus, keyboard routing, settings, and sample app isolation |
| `scripts/lint.sh` | Passed | Biome/gofmt/shfmt formatting, Biome lint, Go vet, JavaScript syntax, ShellCheck, and actionlint |
| `scripts/security.sh` | Passed locally | Gitleaks found no secrets in 54 commits. pnpm audit found no vulnerabilities. Govulncheck found no reachable or imported-package vulnerabilities; see the module-level advisory below. |
| `scripts/validate.sh` | Passed locally | Formatting, lint, secret and dependency checks, Go race tests, 100 Node tests, and standalone CLI build |
| Clean pnpm installs | Passed locally | Fresh unfrozen and frozen installs with pnpm 11.28.6; lockfile unchanged |
| `scripts/package.sh` | Passed | Four CLI target archives, mod archive, checksums, extraction, and standalone installer smoke checks |
| `scripts/test-package.sh` | Passed | All archive checksums, extracted CLI installation without `--binary`, packaged `pnpm run install:cli`, help with an empty runtime PATH, and packaged `pnpm run install:mod --help` |
| `herdr-app check mods/worktree-launcher` | Passed | Native production mod loading in Herdr app 0.1.15 |
| Configured-core handoff without environment selectors | Passed | Production UI JSON client, real Git/Worktrunk creation, and a shell session on an isolated core. Both HC selectors absent. Standalone command still refused missing context. |
| Headless executable | Passed | Real core sessions with Node and Bun absent from PATH; distinct terminals and tabs; later desktop adoption |
| Disposable native UI | Passed | Discovery, remote fetch, existing-worktree opening, a fresh second tab, worktree creation, and current-space defaults through the CLI |

Current tools: Go 1.27.3, Worktrunk 0.81.0, Node 24.22.2, pnpm 11.28.6, Biome 2.6.5, shfmt 3.14.1, Herdr app 0.1.15, and core 0.1.20.

Linux amd64 cross-compilation also passed. Native execution was verified on macOS; the new remote executable has not been exercised on a connected host.

Govulncheck reported standard-library advisory [GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859), fixed in Go 1.27.4. The current Go 1.27.3 source does not import the affected package or call the vulnerable code. This is not a claim that the pinned toolchain has no known advisories.

Disposable negative checks confirmed that Gitleaks rejects a synthetic secret and redacts its value. A local package with a postinstall script failed installation under the pnpm policy; its script did not run. These probes used temporary files and did not add repository dependencies.

Plain `pnpm install` also rejected an outdated lockfile in a disposable project. A fresh unfrozen install followed by a clean plain install passed under the committed `frozenLockfile: true` policy.

Installer tests verify that unrelated directories, symlinks, external targets, settings, and keybindings are preserved on refusal. Failed native validation keeps the installed code and settings intact. A deterministic concurrent-creation test verifies that a new keybinding file is not overwritten between the final comparison and write. Fresh installation and repeated update also passed with the real native checker in an isolated app profile.

Keyboard tests verify that Enter on Save, Browse, Refresh, Close, or action buttons cannot create a worktree. Client tests cover extended fetch/create execution budgets within Herdr's ten-minute cap. The Go runner retains cancellation and gives Git fetch and Worktrunk creation five minutes instead of the metadata command limit.

Discovery tests cover unreadable contents within a repository and unsupported layouts, including bare-repository worktrees and unsafe origin names. Those candidates cannot hide healthy projects. Unreadable directories outside repositories and real Git permission failures still fail discovery. Both sample scripts are tested with inherited Git location variables pointing to a separate disposable repository; its commit, index, and files remain unchanged.

The GitHub workflows use the locally verified scripts. At `a9862df`, [CI](https://github.com/jeremyhiggs/herdr-worktree-launcher/actions/runs/43150812231) passed Linux and macOS builds/tests, lint, and the security job. [Packages](https://github.com/jeremyhiggs/herdr-worktree-launcher/actions/runs/43150812270) also passed. This includes current-space defaults, dry-run, the `--execute` flag, and supply-chain hardening.

## Automated worktree scenarios

All scenarios in these tables run through `./scripts/test.sh`. CI calls that script on Linux and macOS. The tests use disposable repositories and do not contact personal projects or a connected machine.

Creation and reuse tests use real Git and Worktrunk. Failure tests can substitute command fixtures. Herdr sessions use a core protocol fixture. UI and recovery tests use the production JavaScript model with backend and native-control fixtures.

| Scenario | Expected result | Test source |
| --- | --- | --- |
| Create a new branch from a selected base | Create the requested worktree and leave the canonical checkout on its original branch. | [Go](../../cmd/herdr-worktree-launcher/main_test.go): `TestRealWorktrunkCreationReuseAndRecovery`. [CLI](../../tests/worktree-launcher-cli.test.mjs): first test. |
| Open an existing local branch without a checkout | Create a worktree for that branch. | Go: `TestRealWorktrunkCreationReuseAndRecovery`. |
| Open a fetched remote branch | Create its local branch and set the upstream to the selected remote branch. | Go: `TestRemoteBranchTracksAndExistingExternalPathStays`. CLI: fetch tests. |
| Open a branch that already has a worktree | Reuse its existing folder, including a custom folder outside the default destination. | Go: `TestRealWorktrunkCreationReuseAndRecovery`, `TestRemoteBranchTracksAndExistingExternalPathStays`. |
| Open the same checkout again | Add a fresh terminal and tab in its matching space. Retry the same attempt without duplicate terminals. | Go: `TestCoreFreshSessionsAttemptRetryAndLocalIdentity`. CLI: first test. |
| Open a worktree without a canonical project space | Create the canonical shell space once. Run the selected program only in the worktree. | Go: `TestWorktreeOpeningEnsuresCanonicalShellSpaceWithoutDuplicates`. |
| Existing spaces point at other directories or machines | Match the live foreground directory and local terminal identity. Ignore stale or remote terminal matches. | Go: `TestCoreFreshSessionsAttemptRetryAndLocalIdentity`. CLI: explicit-checkout test. |
| Canonical checkout contains staged, unstaged, or untracked files | Preserve its files, index, HEAD, and branch during creation and fetch. | Go: creation and fetch tests. CLI: creation and fetch tests. |
| Fetch a specified remote before creation | Fetch only that remote. Resolve a newly available base or branch afterward. | Go: `TestFetchSelectedRemotePreservesDirtyPrimaryAndRejectsStaleProject`. CLI: fetch tests. |
| Fetch fails or the remote argument is invalid | Stop before Worktrunk or session creation. Preserve the worktree list. | CLI: `CLI fetch errors stop before Worktrunk or session creation`. |
| Branch name is invalid, already exists, or maps to an occupied destination | Reject the request. Treat shell-like characters in valid names literally. | Go: `TestValidationReconciliationAndLiteralBranchNames`. |
| A branch becomes checked out elsewhere after preparation | Reject the stale request without creating a fallback worktree. | Go: `TestValidationReconciliationAndLiteralBranchNames`. |
| Worktrunk exits unsuccessfully after creating a checkout or branch | Preserve the artifact and report a complete checkout or partial outcome accurately. | Go: `TestWorktrunkFailureRetainsCheckoutOrBranchArtifact`. |
| A descendant keeps Worktrunk output pipes open | Bound the wait and report an uncertain outcome. | Go: `TestWorktrunkUnclosedPipesHaveBoundedWaitAndUncertainOutcome`. |
| Herdr session startup fails after Git creation | Preserve the checkout. An opening retry does not repeat Git creation. | Go: core-session test. CLI: agent/startup test. [UI model](../../tests/worktree-launcher-model.test.mjs): opening-retry tests. |
| Standalone core context, Worktrunk, or the selected core is unavailable | Reject before branch or destination creation. Do not start a default core. | Go: missing-context, unavailable-core, and core-list-failure tests. |
| UI runs without inherited core environment variables | Use its explicitly supplied running core ID. Reject mismatched IDs before branch creation or terminal RPCs. | Go: `TestAppCoreIdentityWithoutInheritedCoreEnvironment`, `TestAppCoreIdentityMismatchRefusesCreationAndOpening`. Client: core-ID propagation assertions. |
| Worktrunk project hooks are configured | Skip those hooks during launcher creation. | Go: `TestWorktrunkProjectHooksAreSkipped`. |
| A custom worktree root is configured on the target machine | Use the config file or environment override, including a root outside home. Existing checkouts keep their folders after root changes. Invalid settings, changed roots, and symlinked children stop creation. | Go: `TestConfiguredWorktreeRootCreatesOutsideHomeAndReusesItsCheckout`, `TestWorktreeRootConfigurationErrorsStopBeforeCreation`, and `TestWorktreeRootChangesAndSymlinkedChildrenRefuseCreation`. |
| Checkout location needs inference or an override | Infer from the current repository or subdirectory. Honor `--checkout`. Reject an unspecified checkout outside Git. | CLI: checkout-inference test. |
| UI opens from a local or remote space | Resolve only its current project and branch first; do not scan the project root before preselection. Leave the branch name empty. | [UI controls](../../tests/worktree-launcher-ui.test.mjs): active-space preselection and gated picker tests. Client: machine routing/root assertions. Go: scoped selection API validation. |
| Live terminal folder differs from the space's starting folder | Prefer the focused terminal's live checkout, then a terminal in the active tab, then the stored folder. Ignore unrelated spaces and inactive tabs. Capture context before asynchronous loading. | UI controls: live-terminal-checkout test on local and remote machines. Separate native sample checks a worktree tab inside its primary project's space. |
| Checkout lookup or branch loading is slow | Keep form controls and submission disabled during initial selection, with Close and Esc available. Opening the project picker then scans once without blocking editing or resetting the selection. Cache results; reject late results from a previous machine/refresh or closed overlay. | UI controls: gated startup/picker and error/dismissal tests. Model: deferred scan, caching, error/retry and stale-result tests. Native sample: current-space scene asserts no project scan occurred. |
| Initial suggestions arrive after a manual choice, machine change, or close | Ignore the stale suggestion and preserve the user's choice. | UI controls: late initial checkout suggestions test. |
| Active checkout is unavailable, excluded, or detached | Keep manual selection available. Detached HEAD preselects only the project. | UI controls: unavailable/excluded/detached test. CLI: detached selection assertion. |
| CLI creates from a linked checkout or subdirectory without `--base` | Use that checkout's branch. Honor explicit `--checkout` and `--base` overrides. Require `--base` for detached HEAD. | CLI: checkout-inference test with distinct primary and linked tips. |
| Preview new, existing available, or checked-out branches with `--dry-run` | Print a text or JSON plan. Preserve refs, worktrees, index, staged/unstaged/untracked files, and sessions. Never invoke Worktrunk, Herdr, or the selected agent. | CLI: dry-run preview test with runtime command markers. |
| Preview with `--fetch` or without a running core | List the fetch without performing it. Use current local refs and report that core availability is unchecked. Still require runtime dependencies. | CLI: dry-run preview test. |
| Invalid plans in normal and dry-run modes | Reject unknown/ambiguous branches or bases, invalid/duplicate names, occupied destinations, unavailable checkouts, invalid remotes, and missing programs before worktree or session creation. | CLI: normal/dry-run failure-condition table. |
| Paths contain spaces, quotes, or symlinks | Preserve literal paths and reject unsafe destination ancestry. Canonicalize a symlinked home. | Go: API/path, discovery, validation, and symlinked-home tests. CLI fixtures contain a quoted checkout path. |

## Automated recovery scenarios

These scenarios use the production [UI model](../../tests/worktree-launcher-model.test.mjs) and [record store](../../tests/worktree-launcher-journal.test.mjs). Git inspection results and native file writes use fixtures. The tests do not interrupt a real connected-machine process or exercise concurrent native windows.

| Saved operation and new request | Expected result |
| --- | --- |
| Same machine and repository, different branch and destination | Allow the new worktree without inspecting the unrelated operation. |
| Same machine, different repository, same branch name, different destination | Allow the request. |
| Same machine and repository branch, different destination or linked checkout | Inspect the matching operation before preparation. Block only while its outcome remains unresolved. |
| Same machine and destination, different repository or branch | Inspect the matching operation before preparation. Block only while its outcome remains unresolved. |
| Saved devbox operation while Local is selected | Keep Local selected. Allow local creation and preserve the devbox record. No devbox connection is required. |
| UI opens or refreshes with a saved operation | Load projects normally. Read recovery records only when the user submits a request. |
| Matching operation is complete or has no artifacts | Clear only that record, then apply normal preparation checks. |
| Matching operation is partial | Preserve the record, stop that request, and leave the form editable. |
| Preparation returns a different destination from the preview | Inspect conflicts at the final destination before creation. |
| Multiple unrelated operations exist on one machine | Preserve them separately. Clearing one does not clear the others. |
| An older window tries to clear a replacement operation | Reject the clear and preserve the newer record. |
| Another operation appears during a record write | Use native stale-write protection to prevent overwriting it. |
| Known context, dependency, or core error occurs before creation | Clear the new record. Unknown creation outcomes retain it. |
| Git succeeds but session opening fails | Clear Git recovery before opening. Preserve the checkout and support an opening-only retry. |
| Recovery file uses the legacy single-operation format | Read it without changing it. Migrate on the next write without losing unrelated operations. |
| Recovery file is malformed or cannot be saved | Reject creation without replacing the file or calling Git creation. |

The model also tests duplicate-submit prevention, cancellation, changed checkout identity before an opening retry, and stale asynchronous responses.

## CI coverage and limits

| Workflow or check | Configured in CI? | Scope |
| --- | --- | --- |
| [CI](../../.github/workflows/ci.yml): validate | Yes, on Linux and macOS | Run `scripts/validate.sh`: formatting, lint, secrets, dependency checks, Go race tests, every Node test, and the CLI build. This includes both recovery test files. |
| CI: formatting and lint | Yes, on both runners | Biome for JavaScript/TypeScript and JSON, gofmt and Go vet, shfmt and ShellCheck, JavaScript syntax, and actionlint. |
| CI: dependency and secret checks | Yes, on both runners | Gitleaks scans full committed history with redacted output. pnpm audit fails at moderate severity or higher; govulncheck checks reachable Go vulnerabilities for the runner's platform. Scanner failures fail validation. |
| [Packages](../../.github/workflows/packages.yml) | Yes, on Linux | Cross-compile four CLI targets, package the mod, verify archive checksums and extracted installers, then upload artifacts. This does not run the native UI. |
| Native module loading | No | Separate macOS command: `herdr-app check mods/worktree-launcher`. |
| Real desktop keyboard, focus, theme, and mouse interaction | No | Manual checks and the isolated sample installation. Mocked control tests also run in CI, but do not establish native event routing. |
| Connected-machine creation and session opening | No | Manual test with the Go CLI and Worktrunk installed on the target machine. CI checks routing through fixtures. |
| Actual Claude Code, Pi, OpenCode, or Codex startup | No | CI checks detection and launch arguments with fixtures. Installed agents require separate acceptance checks. |

Both workflows trigger on pushes, pull requests, and manual dispatches. CI also runs weekly. CI uses `mise.toml` for pinned tools. Every action uses a full commit SHA, verified against its official repository. Checkout credentials are not persisted. The test script checks prerequisites before running either suite.

CLI test fixtures preserve the selected `git` and `wt` executables in their restricted `PATH`. A regression assertion compares the fixture's Git version with the host selection. This prevents a fallback to an older system Git on macOS.

Run the same tests locally:

```sh
./scripts/test.sh
```

For only the model and recovery-record scenarios:

```sh
node --test tests/worktree-launcher-model.test.mjs tests/worktree-launcher-journal.test.mjs
```

The latest local run passed 100 Node tests. A configured workflow is not evidence of a successful hosted run for an unpushed commit.

Other automated coverage includes discovery filters, repository naming, remote-root configuration, program selection, installation, overlay controls, and isolated sample-app setup.

## Native sample installation

The native sample uses separate home, app, core-session, socket, shell, and XDG directories. It exercises the production view, model, and executable with disposable repositories and bare remotes. It does not use personal projects or restart the normal app/core.

The fetch scene discovers a server-only branch from the selected remote. Existing-worktree opening preserves the worktree list. Reopening that checkout adds a fresh tab in the same space. New-branch creation opens a focused shell in its worktree.

The latest capture also reopens the launcher from that created worktree. It asserts the automatic project and base-branch selections, with an empty new-branch name, before taking `current-space.png`. All seven README screenshots were refreshed and visually inspected.

A later regression check opened a worktree tab inside the primary project's space, so the live folder differed from the stored space folder. The old lookup failed the selection assertion. The corrected lookup passed in the native sample app. The capture script now includes this case; its diagnostic images remain outside the README.

A sample-only startup delay also confirmed the visible loading message and disabled form controls. Close stayed enabled. The sample completed all creation, fetch, reuse, and current-checkout scenes after loading finished. The loading-state image was visually inspected and retained outside the README.

A separate native check opened the launcher from a linked-checkout subdirectory. It preselected the discovered project and `feature/context` base, with an empty new-branch name. This used the freshly built CLI and programmatic form-state assertions. Connected-machine defaults remain fixture-tested.

A native check also configured a worktree root outside the sample home. Creation used that root, and fetch, existing-checkout reuse, fresh-tab opening, and current-checkout defaults passed. Sample installers bind their copied client to the freshly built executable so an older installed CLI cannot shadow it.

The headless check installs a copied executable outside the source checkout. With Node and Bun absent from its runtime PATH, it creates sessions while the desktop is closed. The desktop later adopts those terminals.

These checks do not start Claude Code, Pi, OpenCode, or Codex. Program availability and launch arguments use fixtures or executable detection.

## Discovery measurement

A paired scan of the same large local project root returned 204 projects. Serial metadata checks took 10.82 seconds; four workers took 2.80 seconds. These are individual warm-run measurements, not latency guarantees. Each UI scan uses one CLI invocation.

## Screenshots and manual acceptance

Initial prompt coverage: Go tests check argument construction for all four agents, literal quotes/newlines/leading flags, Pi's leading `@` handling, and rejection of Shell/NUL prompts before branch creation. Identical in-window retries reuse the terminal; a changed prompt opens a fresh terminal without duplicating the primary shell. CLI tests check `new` and `open`, dry-run plans, and the argv sent to the core fixture. Model/UI tests cover the conditional field, keyboard navigation, submission, retry preservation, and omission when switching to Shell. Client tests verify that older local/remote CLIs fail before creation rather than silently ignoring a prompt. These tests run in the existing CI test suites; they do not contact paid agent services.

The README images come from an isolated sample installation. The sample capture uses native window screenshots and a programmatic form driver. It does not establish physical keyboard or mouse routing.

Before release, check shortcut activation, Esc, Tab, arrows, Enter, root browsing/saving, text selection, theme changes, and each installed agent. Repeat remote creation with the Go binary and Worktrunk installed on the target. Earlier remote JavaScript adapter checks do not validate the new executable.

The desktop UI passes a verified running core ID to the CLI. Go regression tests cover creation and opening without inherited `HC_SOCKET` or `HC_SESSION`, and rejection of a mismatched core ID. Client tests cover propagation of the current ID over stale request context. Standalone commands still require an explicit environment selector.

Documentation and binaries are prepared locally. No release, tag, or publication is implied.
