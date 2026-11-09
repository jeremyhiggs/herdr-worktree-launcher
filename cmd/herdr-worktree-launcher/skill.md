# Herdr worktree launcher

Use the standalone `herdr-worktree-launcher` binary locally. It requires only
`git`, Worktrunk's `wt`, and `hc` at runtime. Set `HC_SOCKET` or `HC_SESSION` to an
already running local core; the launcher never starts a core or chooses a default
core when both variables are missing. Install Worktrunk if `wt` is missing.

```sh
herdr-worktree-launcher new feature/example --checkout /code/project --base main --json
herdr-worktree-launcher open origin/feature/example --checkout /code/project --fetch origin --program codex --json
herdr-worktree-launcher api --request '{"operation":"context"}'
herdr-worktree-launcher api --request '{"operation":"project","path":"/code/project"}'
```

`--checkout` overrides `HERDR_WORKTREE_LAUNCHER_CHECKOUT`, which overrides the
current directory. Linked checkouts resolve to the primary checkout. Naming uses
origin's repository name, root package.json name, pyproject project/Poetry name,
then folder name. New paths use `~/.herdr/worktrees/<repository>/<branch-slug>`.
Existing branches reuse their actual checkout path.

For human commands, `--fetch REMOTE` fetches only that configured remote before
resolving branch choices and invoking Worktrunk. Fetch failure stops creation.
Without the flag, refs are not fetched. API callers use the existing fetch
operation before prepare/create.

The API accepts `{operation,...arguments}`. Operations: context, validateRoot
(`config.project_root`), directories (`path`), discover (`config`), project and
identity (`path`), identities (`paths`), choices/remotes (`project`), fetch
(`project,remote`), destination (`project,name`), prepare
(`project,action,ref,name,checkout`), create/inspect/open (`request`), programs
(`agents` optional). Pass `recover:true` to inspect interrupted operations.
Prepare returns a request; create returns `{kind,path,request,error?}` with kind
created, partial, or absent. Open returns `{path,terminal,space,tab,program}`.
Errors use `{error:{kind,message,hint}}` with nonzero exit status.

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
