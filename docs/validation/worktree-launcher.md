# Validation report

Last updated: 2026-11-09.

The launcher now uses a standalone Go CLI for repository and session operations. Earlier JavaScript backend measurements do not establish this implementation's performance.

## Current checks

| Check | Result | Coverage |
| --- | --- | --- |
| Go tests, race detector, and vet | Passed | Real Git and Worktrunk fixtures; discovery, naming, refs, fetch, preservation, partial failures, core context, hook suppression, and session matching |
| Node tests | 78 passed | CLI commands, installation, JSON client, UI form, recovery, focus, keyboard routing, settings, and sample app isolation |
| `scripts/lint.sh` | Passed | Go formatting/vet, JavaScript syntax, ShellCheck, and GitHub workflow validation |
| `scripts/package.sh` | Passed | Four CLI target archives, mod archive, checksums, extraction, and standalone installer smoke checks |
| `herdr-app check mods/worktree-launcher` | Passed | Native production mod loading in Herdr app 0.1.13 |
| Headless executable | Passed | Real core sessions with Node and Bun absent from PATH; distinct terminals and tabs; later desktop adoption |
| Disposable native UI | Passed | Discovery, remote fetch, existing-worktree opening, a fresh second tab, and worktree creation through the CLI |

Current tools: Go 1.27.3, Worktrunk 0.81.0, Node 24.22.2, pnpm 11.28.6, Herdr app 0.1.13, and core 0.1.18.

Linux amd64 cross-compilation also passed. Native execution was verified on macOS; the new remote executable has not been exercised on a connected host.

The GitHub workflows use the locally verified scripts. Hosted workflow runs remain unverified until these changes are pushed.

## Safety and behavior

Go tests use real Git repositories and Worktrunk. They verify staged, unstaged, and untracked preservation; branch attachment; upstreams; remote collisions; changed eligibility; literal paths; symlink ancestors; and partially completed operations. Naming tests cover origin URLs and bounded package/Python manifest reads.

CLI selection tests cover inference from the current repository or a subdirectory, explicit overrides, rejection outside Git without an override, and ignoring the old environment default.

CLI fetch tests cover remote-only bases and branches, both flag forms, selecting one remote, dirty-checkout preservation, and stopping before Worktrunk/session creation on fetch errors.

Regression tests cover a symlinked home, explicit checkouts in excluded folders, and clearing recovery records for known failures before creation. Unknown outcomes retain recovery protection. A descendant holding process pipes cannot cause an unlimited wait; uncertain Worktrunk completion retains recovery protection.

Session tests use a core protocol fixture. They prefer live foreground directories, ignore remote terminal addresses, reuse a space for the exact checkout, and create a fresh tab for each new attempt. An in-window retry can reuse only its own terminal. A session failure leaves the checkout intact.

Human commands and API creation require explicit `HC_SOCKET` or `HC_SESSION` and an available core. They never start a default core. Missing Worktrunk produces an installation error. Worktrunk project hooks are skipped; native Git hooks remain user-configured.

The UI tests retain stale-result, duplicate-submit, journal, root-saving, remote-routing, and keyboard guards. The UI focuses only the terminal returned by the CLI. The CLI has no cross-machine flags or persistent recovery journal.

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
