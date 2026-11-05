# Worktree Launcher validation

## Remote discovery performance — 2026-11-05

A scan of the connected devbox found the same 11 projects before and after batching. The original scan took 12.41 seconds and 411 remote commands; the batched scan took 0.90 seconds and 7 commands, including connection and root validation. These are observed single-run timings, not a latency guarantee. The project records matched exactly.

Remote filesystem and Git checks now run in one Bash invocation. No Node installation, remote helper files, network fetch, or cached project list is involved. Selection and creation retain their live validation. Tests compare local and batched discovery with ignored repositories, build directories, linked worktrees, bare/JJ directories, and literal shell characters in paths. Failed scans and missing completion markers reject partial results.

The full suite passed 68 tests, with the opt-in remote test skipped. The live devbox test passed separately across all four branch flows using disposable repositories.

## Original validation

Date: 2026-10-31.

Source implementation is complete. Full interactive acceptance remains incomplete because native keyboard and mouse automation was unavailable.

## Scope and versions

The user selected this standalone `herdr-worktree` repository after review of the plan in `herdr-worktree-workflows`.

The user selected source and isolated validation only, with a supplied Cmd+Shift+G binding. No live installation or keybinding change occurred.

The plan review covered coherence, feasibility, design, scope, and adversarial assumptions. It produced no actionable findings.

The independent-provider pass was unavailable because no separate provider CLI was installed.

| Component | Version |
| --- | --- |
| Herdr app | 0.1.10 |
| herdr-core | 0.1.15 |
| Git | 2.56.0 |
| Node (latest test suite) | 24.22.1 |
| pnpm | 11.28.6 |

## Commands and evidence

`pnpm test` passed 33 tests under Node 24.22.1. The first test runs failed because the new implementation modules did not exist.

The suite uses real repositories and local bare remotes. It proves Git outcomes independently of app mocks.

`herdr-app check <copied-mod-directory>` passed. The initial check exposed unsupported input focus metadata, which the implementation removed.

`just test` passed in the separate original workflow repository. Its original source files remained unchanged.

No lint or typecheck command is configured. Native module loading and the Node test suite supply the code checks.

The isolated app used a scratch `HOME`, `HERDR_APP_HOME`, `HC_SESSION`, and all four XDG directories.

The first session name exceeded the macOS socket-path limit. A shorter test-only session name resolved that problem.

The scratch app used the existing `hc` binary through its own `core` configuration. The live core remained separate.

Before creation, `herdr-app ls` and `hc ls` both reported empty lists. The mod reported the scratch home through `home()`.

A private test harness called the real model from the native overlay. It used the app's real commands and observed real spaces and panes.

These calls prove native app integration. They do not prove physical keyboard routing, mouse selection, or the shortcut.

The harness completed four creation scenarios: local existing branch, remote existing branch, new local base, and new remote base.

Each scenario verified the resulting checkout HEAD, attached branch, upstream, active space, focused shell, and live pane directory.

An injected opening error preserved the created checkout and exposed recovery. A retry selected a precreated space with its shell in a subdirectory.

The retry created no duplicate space. No agent ran in the isolated core.

The test app and its core stopped after evidence capture. Task-owned Git fixtures were removed. Screenshots and JSON observations remain in scratch storage.

Scratch evidence is under `/private/tmp/personal-worktrees-runtime`. Screenshots remain outside tracked source.

| Screenshot | Observation |
| --- | --- |
| `01-config-error.png` | Missing configuration, visible error, disabled Create |
| `02-new-preview.png` | New branch form and scratch destination preview |
| `03-new-local.png` | Selected checkout space and normal shell |
| `05-existing-preview.png` | Existing branch form |
| `08-recover.png` | Created checkout preserved after injected opening error |
| `09-recovered.png` | Selected existing space with a subdirectory shell |

## Acceptance matrix

“Blocked” means that a required interactive evidence layer is incomplete, even where fixtures passed.

| ID | Status | Evidence |
| --- | --- | --- |
| V01 | Passed | Discovery test preserves distinct root-relative names |
| V02 | Passed | Real discovery excludes linked duplicates, ignored/build/bare/JJ-only entries |
| V03 | Blocked | Missing error rendered; malformed/relative/unreadable fixtures pass; other error screens need interaction |
| V04 | Blocked | Empty discovery fixture passes; physical Refresh interaction remains unverified |
| V05 | Passed | Local branch/tag collision uses the branch with the correct commit and attached HEAD |
| V06 | Passed | Checked-out primary and linked branches carry their checkout paths |
| V07 | Passed | Two remote identities remain distinct; symbolic remote HEAD is absent |
| V08 | Passed | Real local creation preserves tip and upstream; isolated local flow passed |
| V09 | Passed | Real remote creation tracks the selected remote; isolated remote flow passed |
| V10 | Passed | Remote choices with matching local names are unavailable |
| V11 | Passed | Empty, invalid, local, and fetched-remote name conflicts fail before mutation |
| V12 | Passed | A checked-out base can create a new branch |
| V13 | Passed | Local-base fixture and isolated app start from the selected older commit |
| V14 | Passed | Remote-base fixture and isolated app preserve the selected commit and unset upstream |
| V15 | Blocked | Out-of-order model test passes; physical project switching remains unverified |
| V16 | Passed | Real stale-ref, identity, eligibility, and model preparation failures prevent creation |
| V17 | Passed | Real metacharacter paths and branch names remain literal argv values |
| V18 | Passed | Real slug/basename/occupied-path collisions and symlink ancestors are rejected |
| V19 | Blocked | Double-submit model test proves one mutation; repeated physical input remains unverified |
| V20 | Blocked | Cancel/pending-close model tests pass; native Escape routing remains unverified |
| V21 | Passed | Isolated opening fault preserves checkout; retry succeeds; slow-probe deadline prevents late app commands |
| V22 | Passed | Real app selects the precreated subdirectory shell; model excludes nested and remote repositories |
| V23 | Passed | Real outside-root project symlink is rejected after canonical revalidation |
| V24 | Passed | Injected real Git nonzero/timeout outcomes reconcile checkout and branch-only artifacts |
| V25 | Passed | Real dirty-checkout snapshots preserve HEAD, index diff, tracked and untracked contents |
| V26 | Passed | Real fixture advances the selected ref before submission and uses the new commit |
| V27 | Blocked | Both forms render; actual keyboard, mouse, focus traversal, and scrolling need acceptance |
| V28 | Passed | Isolated app uses copied source without Launcher, Worktrunk, Node, or old server calls |
| V29 | Passed | Reinstall preserves config; documented removal preserves its backup, unrelated files, and recovery data |
| V30 | Passed | Original workflow fixture suite passes in its unchanged source repository |

## Remaining acceptance

Run both forms with physical keyboard and mouse input in an isolated app window. Exercise Tab/Shift+Tab, Enter, Cmd+Enter, Escape, scrolling, Refresh, and error states.

Native accessibility inspection stalled and returned only window controls. It supplied no reliable form-input automation.

Full completion requires this interactive evidence. Module checks, model tests, screenshots, and programmatic app integration do not replace it.

## Review fixes

The final code review found three defects. Each fix has regression evidence and a passing native module check.

- Re-selecting the current action could clear visible input while the model retained it. Input reset now requires an actual action change.
- Git prefix matching could confuse a longer branch with an incomplete artifact. Recovery now requires exact ref equality.
- A slow identity probe could exceed the opening deadline and send a late app command. One cancellable deadline now bounds the operation.

The regressions failed before their fixes. The slow-probe regression also verifies that a late result sends no app command.

Additional review coverage verifies changed-checkout refusal, journal-clear failure recovery, and explicit retry after a failure without artifacts.

All three code findings were resolved after review of the original snapshot. The review did not independently reassess the later fixes.

## Isolated test command

`pnpm run test:app` prepares a temporary app home, core store, and two disposable Git clones. It opens Worktree Launcher automatically.

The command sets `project_root` to the temporary `projects` directory and prints its configuration path and scoped stop command.

Six launcher tests use stand-in app/core executables. They cover environment isolation, real Git fixtures, shortcut installation, scoped shutdown, startup failure cleanup, unsupported Node versions, personal zsh startup files, and delayed overlay rendering.

A real native smoke test passed startup, the module check, empty app/core checks, automatic overlay opening, and scoped shutdown.

The launcher preserves its files and log after shutdown. This test did not add physical keyboard or mouse acceptance evidence.

## Development tooling

The repository pins pnpm 11.28.6 and requires pnpm 11.x with Node 24 or newer. Strict engine validation is enabled.

Clean unfrozen and frozen pnpm installs passed. Temporary incompatible-engine fixtures rejected both Node and pnpm requirements before script execution.

Direct launcher invocation also rejects a reported Node version below 24 before it starts an app or creates test directories.

## Feedback follow-up

The overlay now uses a project dropdown below Search projects and a branch dropdown below its own field.

For new branches, Base precedes New branch name. The name field stays disabled until a base is selected.

Opening now observes the primary project space before opening the worktree space. It reuses existing project spaces, including spaces without a live terminal cwd.

The native Spaces mod groups worktrees beneath the primary checkout by repository identity. No explicit parent identifier is required.

Real native validation created a project space and its worktree, then reused that project for another worktree. Screenshots showed the indented child beneath its project.

A later scenario exceeded the opening deadline after creating its space. Open-only recovery completed without duplicating that space.

After the lookup fixes, a fresh native creation completed with six total spaces. It reused its primary project, focused the attached worktree shell, and cleared the recovery record.

Native Git identity lookup took 1,291 ms across seven subprocesses. The revised lookup took 392 ms across two subprocesses.

The search also checks spaces with the expected folder first. Every candidate still requires a live canonical identity match.

The isolated launcher previously hid personal shell configuration by replacing HOME and XDG directories. It now restores the original environment inside zsh before loading personal startup files.

A generated test-only .zshenv pins HC_SOCKET to the temporary core. App/core storage and worktree destinations remain temporary; shell history and cache use their normal locations.

A real zsh probe loaded the user's ll alias and reported the same core identity as the isolated launcher. No live core was stopped or restarted.

Disposable Git fixture commits explicitly disable signing. This avoids waiting on the user's signer and does not change repository or global Git configuration.

The launcher also waits until Worktree Launcher is observed after mod.open. Fresh test app state skips the first-run welcome screen.

Feedback evidence remains in scratch directories. Keyboard, mouse, and shortcut acceptance is still incomplete.

## Form order follow-up — 2026-11-05

The overlay title is Worktree Launcher. The form now shows Project, the New/Existing actions, Base branch (Branch for Existing branch), and a name field for New branch only. The labels no longer say “select explicitly”. Tab order follows the fields, and action changes preserve the selected branch.

Checked-out branches remain available as new-branch bases. Existing branch disables these choices and shows their checkout path. Switching to Existing branch with a checked-out base selected preserves the selection, shows its reason, and disables Create.

The branch-selection regression checks selection retention, blocked submission for a checked-out branch, and reuse as a base after switching back.

The native module check and renamed isolated launcher passed with Herdr app 0.1.13 and core 0.1.18 installed. The final preview showed the new title and field order without mod errors. Light and dark screenshots were inspected at `/private/tmp/hw-VPDfR7/light.png` and `/private/tmp/hw-VPDfR7/dark.png`, outside tracked source.

The launcher uses Herdr's semantic theme colors. The installed app guide confirms that these colors follow both light and dark themes, and that system appearance applies unless overridden by Herdr settings. No live theme settings were changed.

This follow-up does not complete the outstanding physical keyboard, mouse, or shortcut acceptance and does not install the mod in the live app.

The package, mod directory, shortcut target, tests, and documentation now use `worktree-launcher`. The checkout directory remains `herdr-worktree` at the user's request. The isolated launcher's stop command still recognizes sessions created under the old project name.

`pnpm test` passed all 35 tests under Node 24.22.1 after the rename. The user also reported that the plugin UI looks good; this feedback does not establish each outstanding keyboard and mouse scenario.

## Installer follow-up — 2026-11-05

`pnpm run install:mod` copies the distributable files, configures one project root, checks native loading, and merges the supplied shortcut. Updates require `--update` and preserve user configuration unless a new root is explicitly supplied.

The installer follows the installed Herdr app guide's copy, merge, and check steps. It does not manage herdr-core installation or lifecycle. Shortcut conflicts and malformed key files stop before mod files are copied. Existing keys receive a backup before a merge, and a failed native check leaves the keys unchanged.

All 40 tests passed under Node 24.22.1. Five installer tests cover standalone copying, key merging and backup, configuration preservation, explicit updates, invalid roots, shortcut conflicts, malformed keys, skipped shortcuts, failed native checks, default/custom app homes, and symlink refusal.

First installation and update also passed using the real Herdr app 0.1.13 checker with core 0.1.18 installed. This smoke test used a temporary home, app home, core session, socket, project directory, and XDG paths under `/private/tmp/hwi-xNGnva`. It did not open a window, create spaces, restart a core, or alter the live installation.

## Desktop access and selectable diagnostics — 2026-11-05

The installed configuration contained a valid absolute project root. Terminal and core probes could read it, while a temporary diagnostic mod in the running desktop app observed a failed read-access check and `find` returning “Operation not permitted”. The probe mod was removed after collecting its results. This confirms an app-context access failure rather than a malformed configuration path.

The installed Herdr source runs local mod `exec()` calls as app subprocesses. They do not share the core's folder access context. The live core reported 0.1.17 while the installed binary reported 0.1.18, and the app showed a pending update. Whether an app restart resolves the access denial remains a separate live check; this source change does not grant macOS permissions.

The error now includes the failing root and macOS folder-permission guidance. Its regression test failed against the original generic error and passed after the change. All 41 tests passed.

Errors, destination paths, checkout explanations, and recovery instructions now use selectable native TextView components. Plain text is HTML-escaped before rendering. The native module check passed, and an isolated screenshot verified literal angle brackets and ampersands in an error path. Drag selection and clipboard interaction remain unverified: native accessibility inspection timed out.

The isolated test app and core were stopped. No live core was stopped or restarted. The normal installed project-root configuration was rechecked and remained unchanged.

## Remote machines and root setup — 2026-11-05

The user extended the scope to connected remote machines and project-root setup inside the launcher. The UI now lists Local and the app's connected machines. Missing roots open an editor with Save; local setup also offers the native folder picker. Roots are validated on the selected machine and stored independently, preserving existing local configuration and unrelated settings.

The selected machine scopes every Git and filesystem command, its home directory, destination paths, space matching, space creation, and the recovery record. Identical paths on different machines do not match. Legacy operation records without a machine remain local. An unresolved remote operation pins recovery to its saved machine, and disconnection never causes a local fallback.

`pnpm test` passed 54 tests, with the opt-in live remote test skipped. The suite covers config setup and persistence, legacy settings, stale-write rejection, machine switching, wrong-machine rejection before commands, remote home selection, unsupported/offline targets, recovery, same-path space isolation, and namespaced remote IDs.

Separately, `WORKTREE_TEST_MACHINE=devbox node --test tests/worktree-launcher-remote.test.mjs` passed against the connected Linux machine (Git 2.55.0). It created only disposable repositories and worktrees under a generated temporary directory. All four branch flows passed with correct attached HEAD, commit, upstream, destination, and read-only inspection. The original fixture checkout stayed clean, and the remote fixture was removed afterward.

The native module check passed. An isolated preview loaded the machine and root controls, but its separate test core had no devbox connection; that window was closed after inspection. Actual remote space opening has model coverage, while live devbox coverage here exercises Git operations. Full physical keyboard/mouse acceptance remains separate.

Review reproduced two stale-callback focus races, including identical project IDs on different machines. Both regression tests failed before generation guards were added and passed afterward. The focused reread found no remaining issue. Saving config reloads the native mod, so a short-lived shared setup target preserves the selected machine through that reload.
