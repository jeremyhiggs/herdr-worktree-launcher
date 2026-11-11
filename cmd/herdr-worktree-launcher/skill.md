# Herdr worktree launcher

Use the standalone `herdr-worktree-launcher` binary locally. It requires only
`git`, Worktrunk's `wt`, and `hc` at runtime. For standalone commands, set
`HC_SOCKET` or `HC_SESSION` to an already running local core. The launcher never
starts a core. Install Worktrunk if `wt` is missing.

```sh
herdr-worktree-launcher new feature/example --checkout /code/project --base main --json
herdr-worktree-launcher open origin/feature/example --checkout /code/project --fetch origin --program codex --json
herdr-worktree-launcher api --request '{"operation":"context"}'
herdr-worktree-launcher api --request '{"operation":"project","path":"/code/project"}'
```

`--checkout PATH` overrides the Git checkout inferred from the current directory.
Interactive mode offers the current directory and lets the user change it.
No environment-variable repository default is used. Linked checkouts resolve to the primary checkout for repository identity.
Without `--base`, new branches use the selected checkout's current branch, including a linked checkout or subdirectory.
An explicit `--base` overrides that branch. A detached checkout requires `--base`. Naming uses
origin's repository name, root package.json name, pyproject project/Poetry name,
then folder name. New paths use `~/.herdr/worktrees/<repository>/<branch-slug>`.
Existing branches reuse their actual checkout path.

Use `--dry-run` with `new` or `open` to validate and print the plan without mutation.
Add `--json` for fields including checkout, project, action, branch, ref, commit,
path, worktree_action (create/reuse), program, argv, fetch, and session_action.
The plan uses local refs and reports `core_checked:false`. It needs runtime
dependencies on PATH, but no running core or HC selector. It never calls `wt`,
`hc`, the selected program, or Git fetch. With `--fetch`, the plan lists that
remote without contacting it; the actual run resolves refs again after fetching.
Unknown or ambiguous refs, invalid or duplicate branch names, occupied destinations,
unavailable checkouts, and missing programs fail with nonzero status in both modes.
The API rejects `--dry-run`; use the read-only prepare operation for an API preview.

For human commands, `--fetch REMOTE` fetches only that configured remote before
resolving branch choices and invoking Worktrunk. Fetch failure stops creation.
Without the flag, refs are not fetched. API callers use the existing fetch
operation before prepare/create.

The API accepts `{operation,...arguments}`. Operations: context, validateRoot
(`config.project_root`), directories (`path`), discover (`config`), project and
identity (`path`), selection (`path`), identities (`paths`), choices/remotes (`project`), fetch
(`project,remote`), destination (`project,name`), prepare
(`project,action,ref,name,checkout`), create/inspect/open (`request`), programs
(`agents` optional). Pass `recover:true` to inspect interrupted operations.
Prepare returns a request; create returns `{kind,path,request,error?}` with kind
created, partial, or absent. Open returns `{path,terminal,space,tab,program}`.
Errors use `{error:{kind,message,hint}}` with nonzero exit status.

Selection returns `{project,ref}` for a checkout or subdirectory. The project identifies the primary checkout;
`ref` identifies the requested checkout's branch, or an empty string for detached HEAD.

The context response includes `core_id` when `hc server status` proves that a
core is already running. Desktop API clients pass this value as `request.core_id`
on create/open, including retries. `hc` resolves its connection using its
environment, configuration, and defaults. The CLI compares the running core's ID
with `request.core_id` before mutation and rejects a mismatch. Refresh context
after a connection change. Standalone human
commands still require `HC_SOCKET` or `HC_SESSION`.

Creation uses `wt switch --path ... --no-cd --no-hooks --format=json`. Worktrunk
project hooks are skipped as a backend safety default; run trusted setup manually. The canonical
checkout's HEAD, index and files stay in place. No automatic deletion, reset,
rebase, cleanup, or clobber occurs. A failed open preserves the checkout. Inspect
and repair partial operations manually. The CLI keeps no recovery journal.

Every invocation opens a fresh terminal and tab, sharing an existing matching
checkout's space label where possible. An explicit request.attempt permits only
that attempt's terminal to be reused for an in-window retry. Remote terminal
addresses are ignored. There is no machine routing or automatic desktop focus.
Opening a linked checkout first ensures a live shell space for its primary
checkout. Existing matching primary spaces are reused; the selected agent runs
only in the target checkout.
Use the printed `hc attach` command, or `--attach`, for foreground interaction.
