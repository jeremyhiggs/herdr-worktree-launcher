# Validation report

Last updated: 2026-11-09.

The launcher now uses a standalone Go CLI for repository and session operations. Earlier JavaScript backend measurements do not establish this implementation's performance.

## Current checks

| Check | Result | Coverage |
| --- | --- | --- |
| Go tests, race detector, and vet | Passed | Real Git and Worktrunk fixtures; discovery, naming, refs, fetch, preservation, partial failures, core context, hook suppression, and session matching |
| Node tests | 84 passed | CLI commands, installation, JSON client, UI form, recovery, focus, keyboard routing, settings, and sample app isolation |
| `scripts/lint.sh` | Passed | Go formatting/vet, JavaScript syntax, ShellCheck, and GitHub workflow validation |
| `scripts/package.sh` | Passed | Four CLI target archives, mod archive, checksums, extraction, and standalone installer smoke checks |
| `herdr-app check mods/worktree-launcher` | Passed | Native production mod loading in Herdr app 0.1.13 |
| Headless executable | Passed | Real core sessions with Node and Bun absent from PATH; distinct terminals and tabs; later desktop adoption |
| Disposable native UI | Passed | Discovery, remote fetch, existing-worktree opening, a fresh second tab, and worktree creation through the CLI |

Current tools: Go 1.27.3, Worktrunk 0.81.0, Node 24.22.2, pnpm 11.28.6, Herdr app 0.1.13, and core 0.1.18.

Linux amd64 cross-compilation also passed. Native execution was verified on macOS; the new remote executable has not been exercised on a connected host.

The GitHub workflows use the locally verified scripts. The recent recovery changes are local commits and are not yet pushed. Hosted results for those changes are not verified. The available GitHub connection could not read workflow runs during this review.

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
| Core context, Worktrunk, or the selected core is unavailable | Reject before branch or destination creation. Do not start a default core. | Go: missing-context, unavailable-core, and core-list-failure tests. |
| Worktrunk project hooks are configured | Skip those hooks during launcher creation. | Go: `TestWorktrunkProjectHooksAreSkipped`. |
| Checkout location needs inference or an override | Infer from the current repository or subdirectory. Honor `--checkout`. Reject an unspecified checkout outside Git. | CLI: checkout-inference test. |
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
| [CI](../../.github/workflows/ci.yml): build and test | Yes, on Linux and macOS | Build the CLI, run Go tests with the race detector, then run every `tests/worktree-launcher-*.test.mjs` file. This includes both recovery test files. |
| CI: lint | Yes, on Linux | Go formatting/vet, JavaScript syntax, ShellCheck, and actionlint. |
| [Packages](../../.github/workflows/packages.yml) | Yes, on Linux | Cross-compile four CLI targets, package the desktop mod, and upload archives and checksums. This does not run the native UI. |
| Native module loading | No | Separate macOS command: `herdr-app check mods/worktree-launcher`. |
| Real desktop keyboard, focus, theme, and mouse interaction | No | Manual checks and the isolated sample installation. Mocked control tests also run in CI, but do not establish native event routing. |
| Connected-machine creation and session opening | No | Manual test with the Go CLI and Worktrunk installed on the target machine. CI checks routing through fixtures. |
| Actual Claude Code, Pi, OpenCode, or Codex startup | No | CI checks detection and launch arguments with fixtures. Installed agents require separate acceptance checks. |

Both workflows trigger on pushes, pull requests, and manual dispatches. CI uses `mise.toml` for pinned tools. The test script checks prerequisites before running either suite.

Run the same tests locally:

```sh
./scripts/test.sh
```

For only the model and recovery-record scenarios:

```sh
node --test tests/worktree-launcher-model.test.mjs tests/worktree-launcher-journal.test.mjs
```

The latest local run passed 84 Node tests. A configured workflow is not evidence of a successful hosted run for an unpushed commit.

Other automated coverage includes discovery filters, repository naming, remote-root configuration, program selection, installation, overlay controls, and isolated sample-app setup.

## Native sample installation

The native sample uses separate home, app, core-session, socket, shell, and XDG directories. It exercises the production view, model, and executable with disposable repositories and bare remotes. It does not use personal projects or restart the normal app/core.

The fetch scene discovers a server-only branch from the selected remote. Existing-worktree opening preserves the worktree list. Reopening that checkout adds a fresh tab in the same space. New-branch creation opens a focused shell in its worktree.

The headless check installs a copied executable outside the source checkout. With Node and Bun absent from its runtime PATH, it creates sessions while the desktop is closed. The desktop later adopts those terminals.

These checks do not start Claude Code, Pi, OpenCode, or Codex. Program availability and launch arguments use fixtures or executable detection.

## Discovery measurement

A paired scan of the same large local project root returned 204 projects. Serial metadata checks took 10.82 seconds; four workers took 2.80 seconds. These are individual warm-run measurements, not latency guarantees. Each UI scan uses one CLI invocation.

## Screenshots and manual acceptance

The README images come from an isolated sample installation. The sample capture uses native window screenshots and a programmatic form driver. It does not establish physical keyboard or mouse routing.

Before release, check shortcut activation, Esc, Tab, arrows, Enter, root browsing/saving, text selection, theme changes, and each installed agent. Repeat remote creation with the Go binary and Worktrunk installed on the target. Earlier remote JavaScript adapter checks do not validate the new executable.

The UI execution environment must expose its own running core through `HC_SOCKET` or `HC_SESSION`. A normal app started without either variable receives a context error before creation; this work does not guess that app's core socket.

Documentation and binaries are prepared locally. No release, tag, or publication is implied.
