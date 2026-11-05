# Validation report

Last updated: 2026-11-05.

This report separates automated checks, native app observations, and remaining manual acceptance. A screenshot or module-loading check does not prove keyboard routing or agent startup.

## Current checks

| Check | Result | What it establishes |
| --- | --- | --- |
| `pnpm test` | 84 passed, 1 skipped | Git fixtures, form state, recovery, settings, installation, and test-app isolation |
| Native module checks | Passed | Production mod and sample driver load in Herdr app 0.1.13 |
| Fresh sample installation | Passed | Installer copies the mod, checks loading, and merges its shortcut in an isolated app home |
| Sample creation and opening | Passed | Real creation, existing checkout reuse, grouped worktree spaces, and focused shells |
| README screenshots | Four inspected images | New branch, selectable existing worktrees, available programs, and the resulting worktree |
| Remote integration | Passed separately on devbox | Four Git creation flows and opening each checkout in place through the remote Git adapter |

The current checks use Node 24.22.1, pnpm 11.28.6, Herdr app 0.1.13, and the installed core 0.1.18 binary.

## Automated coverage

The tests create real Git repositories and local bare remotes. App-opening tests also use model fixtures and test doubles.

| Area | Covered behavior |
| --- | --- |
| Discovery | Root-relative names, ignored/build/bare/JJ-only exclusions, linked-worktree deduplication, and broken Git metadata |
| Scan integrity | Batched local/remote scans, command-count bounds, failed commands, and truncated output |
| Existing branches | Attached local checkout, correct remote tracking, existing-folder reuse, and local-name collisions |
| New branches | Local or fetched remote base, no upstream, invalid names, collisions, and live ref changes |
| Filesystem safety | Literal shell characters, occupied destinations, symlink ancestors, and outside-root identity changes |
| Checkout preservation | Dirty primary checkout, index, tracked contents, and untracked files |
| Form state | Branch retention across actions, stale requests, machine changes, and duplicate submission |
| Settings | Per-machine roots, stale saves, migration, remote browsing, and save-button state |
| Programs | Per-machine availability, configured argv, shell fallback, retry reuse, and recovery persistence |
| Recovery | Git failures, partial artifacts, opening failures, pending operations, and open-only retry |
| Installation | File copying, native check, key conflicts, backups, explicit updates, settings preservation, and custom app homes |
| Sample app | Isolated app/core state, temporary Git fixtures, scoped shutdown, startup failures, and shell startup behavior |

Existing-checkout tests cover linked and primary checkouts on both machine adapters. They preserve staged, unstaged, and untracked contents, HEAD, upstream, and the worktree list.

Existing-checkout sessions accept later commits and upstream changes on the same branch. Opening never resets either value to the earlier selection.

Moved, missing, or switched checkouts fail revalidation. A branch checked out after preparation never causes creation of a second checkout. Session-opening recovery retains the existing path and selected program.

The program-selection tests cover local and remote requests. They do not start Claude Code, Pi, OpenCode, or Codex.

## Screenshot installation

`pnpm run screenshots` creates a fresh sample installation with two real projects and local bare remotes. A sample-only driver operates the production view and model.

The driver uses the app's real commands to create `feature/rate-limits` from `main`. Git reports an attached branch at the expected sample destination.

The app opens the primary project first, then the worktree space with a focused shell. The operation record clears after success. The captured sidebar shows the worktree beneath its project.

Another scene opens `feature/pagination` in a pre-existing custom checkout outside the worktree store. The worktree list stays unchanged. Its shell screenshot remains in the retained sample directory.

The sample uses separate home, app, core-session, socket, shell, and XDG directories. Its shutdown targets only that app and core. Logs and fixtures remain in the printed temporary directory.

The capture activates the sample window and dismisses its first-run overlays. `herdr-app shot` supplies the actual window images. All four images received a visual check for content and private data.

| Image | Demonstration |
| --- | --- |
| [New branch](../screenshots/new-branch.png) | Machine, saved root, project, base, name, destination, and enabled Create |
| [Existing branch](../screenshots/existing-branch.png) | Selectable existing checkouts, their paths, Open worktree, and unavailable remote-name collisions |
| [Open with](../screenshots/open-with.png) | Shell plus the OpenCode and Codex programs detected in the sample |
| [Opened worktree](../screenshots/worktree-opened.png) | Grouped worktree space and its shell |

No personal project, normal app settings, or live core restart forms part of this capture. The sample does not launch an agent or connect a remote machine.

The separate remote test uses disposable repositories on devbox. It creates each branch flow, prepares that checkout again, and reuses the same folder. It checks attached HEAD and upstream. This test does not open a remote app session.

## Earlier native observations

Earlier isolated app runs exercised all four Git flows: existing local, existing remote, new local base, and new remote base. They checked branch attachment, upstream, pane directory, and focus.

An injected opening failure preserved the checkout. An open-only retry reused an existing space with a shell in a checkout subdirectory. It created no duplicate space.

Earlier light and dark captures showed Herdr's semantic theme colors. These observations preceded the current documentation pass.

A prior connected-machine test exercised all four branch flows with disposable remote repositories. It passed separately from the default suite.

## Discovery performance

These figures are earlier single-run measurements. They are not latency guarantees. The before and after scans returned identical project records.

| Root | Projects | Before | Batched scan | App-level command calls |
| --- | --- | --- | --- | --- |
| Local | 265 | 11.59 seconds | 7.55 seconds | 5,271 → 5 |
| Connected machine | 11 | 12.41 seconds | 0.90 seconds | 411 → 7 |

The remote count includes connection and root validation. The local measurements use a Node runner and exclude native per-call scheduling overhead.

Both machines now use the same Bash scanner. Refresh scans again without a project cache. Branch selection and creation retain live validation.

## Remaining manual acceptance

Before publishing a release, exercise these controls in a fresh installation:

- Open with ⌘⇧G and close with Esc in both branch modes.
- Select projects, branches, and programs with the mouse and keyboard.
- Use Tab, Shift+Tab, arrows, Enter, and ⌘Enter, including Project root and open dropdowns.
- Save and browse local and remote roots, then reopen and check each saved root.
- Create on a connected machine and check the resulting remote shell.
- Start each supported agent available on your target machines.
- Check errors, scrolling, text selection, and light/dark appearance.

The current screenshot driver controls the form programmatically. It supplies no new physical keyboard or mouse acceptance evidence.

Documentation and screenshots are prepared locally. This work does not publish a release or tag.
