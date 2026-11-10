package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fixtureCore struct {
	Terminals []terminal       `json:"terminals"`
	Calls     []map[string]any `json:"calls"`
}

// The test binary doubles as a tiny hc executable. Production still uses only
// git, wt and hc; no script interpreter is needed by these fixtures.
func TestMain(m *testing.M) {
	if os.Getenv("WL_FIXTURE_HOLD_PIPE") == "1" {
		time.Sleep(20 * time.Second)
		os.Exit(0)
	}
	if os.Getenv("WL_FIXTURE_WT_FAILURE") != "" && filepath.Base(os.Args[0]) == "wt" {
		args := os.Args[1:]
		if os.Getenv("WL_FIXTURE_WT_FAILURE") == "held-pipes" {
			binary, _ := os.Executable()
			child := exec.Command(binary)
			child.Env = append(os.Environ(), "WL_FIXTURE_HOLD_PIPE=1")
			child.Stdout, child.Stderr = os.Stdout, os.Stderr
			if err := child.Start(); err != nil {
				os.Exit(2)
			}
			_ = os.WriteFile(os.Getenv("WL_FIXTURE_CHILD_PID"), []byte(fmt.Sprint(child.Process.Pid)), 0600)
			os.Exit(0)
		}
		if os.Getenv("WL_FIXTURE_WT_FAILURE") == "branch-only" {
			for i, arg := range args {
				if arg == "--create" && i+1 < len(args) {
					cmd := exec.Command("git", "branch", args[i+1], "main")
					if err := cmd.Run(); err != nil {
						os.Exit(2)
					}
				}
			}
		} else {
			cmd := exec.Command(os.Getenv("WL_FIXTURE_REAL_WT"), args...)
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			if err := cmd.Run(); err != nil {
				os.Exit(2)
			}
		}
		fmt.Fprintln(os.Stderr, "fixture failure after mutation")
		os.Exit(1)
	}
	if os.Getenv("WL_FIXTURE_CORE") != "" && filepath.Base(os.Args[0]) == "hc" {
		if len(os.Args) > 2 && os.Args[1] == "server" && os.Args[2] == "status" {
			if os.Getenv("WL_FIXTURE_CORE_OFFLINE") != "" {
				fmt.Fprintln(os.Stderr, "fixture core offline")
				os.Exit(1)
			}
			fmt.Println(`{"pid":123,"core":{"id":"fixture-core"}}`)
			os.Exit(0)
		}
		if len(os.Args) < 2 || os.Args[1] != "connect" {
			os.Exit(2)
		}
		var req struct {
			ID     int            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if json.NewDecoder(os.Stdin).Decode(&req) != nil {
			os.Exit(2)
		}
		state := fixtureCore{}
		raw, _ := os.ReadFile(os.Getenv("WL_FIXTURE_CORE"))
		_ = json.Unmarshal(raw, &state)
		state.Calls = append(state.Calls, map[string]any{"method": req.Method, "params": req.Params})
		var result any
		switch req.Method {
		case "terminal.list":
			if os.Getenv("WL_FIXTURE_FAIL_LIST") != "" {
				_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"message": "fixture list failed"}})
				os.Exit(0)
			}
			result = map[string]any{"terminals": state.Terminals}
		case "terminal.run":
			if os.Getenv("WL_FIXTURE_FAIL_RUN") != "" {
				_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"message": "fixture spawn failed"}})
				os.Exit(0)
			}
			raw, _ := json.Marshal(req.Params)
			var term terminal
			_ = json.Unmarshal(raw, &term)
			term.Address = fmt.Sprintf("t%d", len(state.Terminals)+1)
			term.State = "live"
			term.Foreground.Cwd = term.Cwd
			state.Terminals = append(state.Terminals, term)
			result = term
		default:
			os.Exit(2)
		}
		raw, _ = json.Marshal(state)
		_ = os.WriteFile(os.Getenv("WL_FIXTURE_CORE"), raw, 0600)
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
		os.Exit(0)
	}
	os.Exit(m.Run())
}

type fixture struct {
	root, home, bin, repo, state string
	p                            Project
}

func setup(t *testing.T) fixture {
	t.Helper()
	root, err := os.MkdirTemp("", "wl-go-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	root, err = real(root)
	if err != nil {
		t.Fatal(err)
	}
	f := fixture{root: root, home: filepath.Join(root, "home"), bin: filepath.Join(root, "bin"), repo: filepath.Join(root, "projects", "sample checkout"), state: filepath.Join(root, "core.json")}
	for _, path := range []string{f.home, f.bin, f.repo} {
		if err = os.MkdirAll(path, 0755); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"git", "wt"} {
		path, e := exec.LookPath(name)
		if e != nil {
			t.Skip(name + " unavailable for integration fixture")
		}
		if e = os.Symlink(path, filepath.Join(f.bin, name)); e != nil {
			t.Fatal(e)
		}
		if name == "wt" {
			t.Setenv("WL_FIXTURE_REAL_WT", path)
		}
	}
	testBinary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(testBinary, filepath.Join(f.bin, "hc")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", f.home)
	t.Setenv("PATH", f.bin+":/usr/bin:/bin")
	t.Setenv("HC_SOCKET", filepath.Join(root, "fixture.sock"))
	t.Setenv("HC_SESSION", "")
	t.Setenv("WL_FIXTURE_CORE", f.state)
	t.Setenv("WORKTRUNK_CONFIG_PATH", filepath.Join(root, "worktrunk.toml"))
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(root, "gitconfig"))
	_ = os.WriteFile(filepath.Join(root, "worktrunk.toml"), nil, 0600)
	_ = os.WriteFile(f.state, []byte(`{"terminals":[],"calls":[]}`), 0600)
	f.git(t, "init", "-b", "main")
	f.git(t, "config", "user.name", "Fixture")
	f.git(t, "config", "user.email", "fixture@example.invalid")
	f.git(t, "config", "core.hooksPath", "/dev/null")
	f.git(t, "config", "commit.gpgsign", "false")
	f.git(t, "commit", "--allow-empty", "-m", "fixture")
	f.git(t, "remote", "add", "origin", "https://code.example.invalid/team/sample.git")
	f.p, err = project(f.repo, "")
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func (f fixture) git(t *testing.T, args ...string) string {
	t.Helper()
	out, err := git(f.repo, args...)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
func (f fixture) prepare(t *testing.T, action, ref, name string) Request {
	t.Helper()
	r, err := prepare(input{Project: f.p, Action: action, Ref: ref, Name: name})
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func (f fixture) core(t *testing.T) fixtureCore {
	t.Helper()
	raw, err := os.ReadFile(f.state)
	if err != nil {
		t.Fatal(err)
	}
	var state fixtureCore
	if err = json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	return state
}

func TestMissingContextAndWorktrunkRefuseBeforeCreation(t *testing.T) {
	f := setup(t)
	r := f.prepare(t, "new", "refs/heads/main", "refused")
	t.Setenv("HC_SOCKET", "")
	if _, err := create(r); err == nil || !strings.Contains(err.Error(), "HC_SOCKET") {
		t.Fatalf("missing context: %v", err)
	}
	if f.git(t, "branch", "--list", "refused") != "" {
		t.Fatal("branch created without context")
	}
	if _, err := os.Stat(r.Path); !os.IsNotExist(err) {
		t.Fatal("destination created without context")
	}
	t.Setenv("HC_SOCKET", filepath.Join(f.root, "fixture.sock"))
	if err := os.Remove(filepath.Join(f.bin, "wt")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", f.bin)
	if _, err := create(r); err == nil || !strings.Contains(err.Error(), "wt is not on PATH") {
		t.Fatalf("missing wt: %v", err)
	}
	if f.git(t, "branch", "--list", "refused") != "" {
		t.Fatal("branch created without wt")
	}
}

func TestAppCoreIdentityWithoutInheritedCoreEnvironment(t *testing.T) {
	f := setup(t)
	r := f.prepare(t, "new", "refs/heads/main", "from-app")
	t.Setenv("HC_SOCKET", "")
	t.Setenv("HC_SESSION", "")
	context, err := api(input{Operation: "context"})
	if err != nil || context.(map[string]any)["core_id"] != "fixture-core" {
		t.Fatalf("app core context: %+v %v", context, err)
	}
	r.CoreID = context.(map[string]any)["core_id"].(string)
	result, err := api(input{Operation: "create", Request: r})
	if err != nil {
		t.Fatalf("app's verified core must work without inherited selectors: %v", err)
	}
	if result.(Result).Kind != "created" {
		t.Fatalf("app creation: %+v", result)
	}
	r.Attempt = "app-opening"
	if _, err := api(input{Operation: "open", Request: r}); err != nil {
		t.Fatalf("app opening: %v", err)
	}
}

func TestAppCoreIdentityMismatchRefusesCreationAndOpening(t *testing.T) {
	f := setup(t)
	for _, inherited := range []bool{true, false} {
		if !inherited {
			t.Setenv("HC_SOCKET", "")
			t.Setenv("HC_SESSION", "")
		}
		r := f.prepare(t, "new", "refs/heads/main", "wrong-core")
		r.CoreID = "another-core"
		_, err := api(input{Operation: "create", Request: r})
		var detail *failure
		if !errors.As(err, &detail) || detail.Kind != "core_unavailable" {
			t.Fatalf("mismatched core accepted: %v", err)
		}
		if f.git(t, "branch", "--list", r.Name) != "" {
			t.Fatal("branch created on mismatched core")
		}
		if _, err := os.Stat(r.Path); !os.IsNotExist(err) {
			t.Fatal("destination created on mismatched core")
		}
		r = f.prepare(t, "existing", "refs/heads/main", "")
		r.CoreID = "another-core"
		if _, err = api(input{Operation: "open", Request: r}); !errors.As(err, &detail) || detail.Kind != "core_unavailable" {
			t.Fatalf("opening on mismatched core: %v", err)
		}
		if len(f.core(t).Calls) != 0 {
			t.Fatal("terminal RPC attempted on mismatched core")
		}
	}
}

func TestRealWorktrunkCreationReuseAndRecovery(t *testing.T) {
	f := setup(t)
	if err := os.WriteFile(filepath.Join(f.repo, "staged.txt"), []byte("keep staged"), 0600); err != nil {
		t.Fatal(err)
	}
	f.git(t, "add", "staged.txt")
	if err := os.WriteFile(filepath.Join(f.repo, "untracked.txt"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	before := f.git(t, "status", "--porcelain")
	head := f.git(t, "rev-parse", "HEAD")
	r := f.prepare(t, "new", "refs/heads/main", "feature/example")
	result, err := create(r)
	if err != nil || result.Kind != "created" || result.Error != "" {
		t.Fatalf("create: %+v %v", result, err)
	}
	if r.Path != filepath.Join(f.home, ".herdr", "worktrees", "sample", "feature-example") {
		t.Fatal(r.Path)
	}
	if f.git(t, "status", "--porcelain") != before || f.git(t, "rev-parse", "HEAD") != head || f.git(t, "symbolic-ref", "HEAD") != "refs/heads/main" {
		t.Fatal("primary checkout changed")
	}
	again := f.prepare(t, "existing", "refs/heads/feature/example", "")
	if !again.Reuse || again.Path != r.Path {
		t.Fatalf("reuse: %+v", again)
	}
	result, err = create(again)
	if err != nil || result.Kind != "created" {
		t.Fatalf("reuse: %+v %v", result, err)
	}
	if _, err = git(r.Path, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "later"); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(f.repo, "package.json"), []byte(`{"name":"changed"}`), 0600); err != nil {
		t.Fatal(err)
	}
	r.Project.Basename = "old-name"
	if got := inspect(r, true); got.Kind != "created" {
		t.Fatalf("recovery must accept later commit/name metadata: %+v", got)
	}
	f.git(t, "branch", "existing-only", "main")
	existing := f.prepare(t, "existing", "refs/heads/existing-only", "")
	result, err = create(existing)
	if err != nil || result.Kind != "created" || result.Error != "" {
		t.Fatalf("existing creation: %+v %v", result, err)
	}
}

func TestCoreFreshSessionsAttemptRetryAndLocalIdentity(t *testing.T) {
	f := setup(t)
	r := f.prepare(t, "existing", "refs/heads/main", "")
	state := fixtureCore{Terminals: []terminal{{Address: "remote/t1", State: "live", Cwd: f.repo, Labels: map[string]string{"herdr.space": "remote"}}, {Address: "t2", State: "live", Cwd: f.repo, Labels: map[string]string{"herdr.space": "stale"}}, {Address: "t3", State: "live", Cwd: f.root, Labels: map[string]string{"herdr.space": "matching"}}}}
	state.Terminals[1].Foreground.Cwd = f.root
	state.Terminals[2].Foreground.Cwd = f.repo
	raw, _ := json.Marshal(state)
	_ = os.WriteFile(f.state, raw, 0600)
	r.Attempt = "attempt-one"
	first, err := openCheckout(r)
	if err != nil {
		t.Fatal(err)
	}
	if first.Space != "matching" {
		t.Fatalf("wrong space: %+v", first)
	}
	retry, err := openCheckout(r)
	if err != nil || retry != first {
		t.Fatalf("retry: %+v %v", retry, err)
	}
	r.Attempt = "attempt-two"
	second, err := openCheckout(r)
	if err != nil {
		t.Fatal(err)
	}
	if second.Terminal == first.Terminal || second.Tab == first.Tab || second.Space != first.Space {
		t.Fatalf("not fresh: %+v %+v", first, second)
	}
	state = f.core(t)
	if len(state.Terminals) != 5 {
		t.Fatal(len(state.Terminals))
	}
	for _, call := range state.Calls {
		params := call["params"].(map[string]any)
		if _, ok := params["on"]; ok {
			t.Fatal("remote routing")
		}
		if call["method"] == "terminal.run" && params["no_parent"] != true {
			t.Fatal("inherited parent")
		}
	}
	t.Setenv("WL_FIXTURE_FAIL_RUN", "1")
	r.Attempt = "attempt-failing"
	if _, err = openCheckout(r); err == nil || !strings.Contains(err.Error(), "checkout preserved at "+r.Path) {
		t.Fatalf("missing preserved path: %v", err)
	}
}

func TestWorktreeOpeningEnsuresCanonicalShellSpaceWithoutDuplicates(t *testing.T) {
	f := setup(t)
	r := f.prepare(t, "new", "refs/heads/main", "nested")
	result, err := create(r)
	if err != nil || result.Kind != "created" || result.Error != "" {
		t.Fatalf("create: %+v %v", result, err)
	}
	r.Attempt = "target-attempt"
	r.Launch = Launch{Key: "codex", Argv: []string{"git"}}
	first, err := openCheckout(r)
	if err != nil {
		t.Fatal(err)
	}
	state := f.core(t)
	if len(state.Terminals) != 2 {
		t.Fatalf("want canonical and worktree terminals: %+v", state.Terminals)
	}
	canonical, target := state.Terminals[0], state.Terminals[1]
	if canonical.Cwd != f.repo || canonical.Labels["herdr.space"] == "" || canonical.Labels["herdr.tab"] == "" || canonical.Labels["herdr-worktree-launcher.program"] != "shell" {
		t.Fatalf("canonical shell: %+v", canonical)
	}
	if target.Cwd != r.Path || target.Address != first.Terminal || target.Labels["herdr.space"] == canonical.Labels["herdr.space"] || target.Labels["herdr-worktree-launcher.program"] != "codex" {
		t.Fatalf("target: %+v", target)
	}
	runs := []map[string]any{}
	for _, call := range state.Calls {
		if call["method"] == "terminal.run" {
			runs = append(runs, call["params"].(map[string]any))
		}
	}
	if len(runs) != 2 || len(runs[0]["argv"].([]any)) != 0 || len(runs[1]["argv"].([]any)) != 2 {
		t.Fatalf("selected program must run only in target: %+v", runs)
	}
	for _, params := range runs {
		if params["no_parent"] != true || params["keep"] != true {
			t.Fatal(params)
		}
	}
	retry, err := openCheckout(r)
	if err != nil || retry != first || len(f.core(t).Terminals) != 2 {
		t.Fatalf("retry duplicates: %+v %v", retry, err)
	}
	r.Attempt = "fresh-target-attempt"
	second, err := openCheckout(r)
	if err != nil || second.Terminal == first.Terminal || len(f.core(t).Terminals) != 3 {
		t.Fatalf("fresh target duplicated canonical: %+v %v", second, err)
	}
	state = f.core(t)
	state.Terminals[0].State = "finished"
	raw, _ := json.Marshal(state)
	_ = os.WriteFile(f.state, raw, 0600)
	if _, err = openCheckout(r); err != nil {
		t.Fatal(err)
	}
	if len(f.core(t).Terminals) != 4 {
		t.Fatal("retry did not restore missing canonical space")
	}
}

func TestAPIShapesProgramsAndSafePaths(t *testing.T) {
	f := setup(t)
	value, err := api(input{Operation: "context"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(value)
	if !strings.Contains(string(raw), `"protocol":1`) || !strings.Contains(string(raw), `"machine":null`) {
		t.Fatal(string(raw))
	}
	refs, err := choices(f.p)
	if err != nil || len(refs) != 1 || refs[0].Checkout == nil {
		t.Fatalf("refs %+v %v", refs, err)
	}
	r := f.prepare(t, "new", "refs/heads/main", "absent")
	if got := inspect(r, true); got.Kind != "absent" {
		t.Fatal(got)
	}
	if err = os.MkdirAll(filepath.Join(f.home, ".herdr"), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(f.root, filepath.Join(f.home, ".herdr", "worktrees")); err != nil {
		t.Fatal(err)
	}
	if _, err = prepare(input{Project: f.p, Action: "new", Ref: "refs/heads/main", Name: "unsafe"}); err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("symlink: %v", err)
	}
	ps := programs([]Program{{Key: "codex", Name: "Custom", Run: []string{"git", "custom"}}})
	if ps[4].Name != "Custom" || !ps[4].Installed || ps[4].Run[1] != "custom" {
		t.Fatal(ps)
	}
}

func TestRemoteBranchTracksAndExistingExternalPathStays(t *testing.T) {
	f := setup(t)
	head := f.git(t, "rev-parse", "HEAD")
	f.git(t, "update-ref", "refs/remotes/origin/remote-feature", head)
	r := f.prepare(t, "existing", "refs/remotes/origin/remote-feature", "")
	result, err := create(r)
	if err != nil || result.Kind != "created" || result.Error != "" {
		t.Fatalf("remote create: %+v %v", result, err)
	}
	upstream, err := git(r.Path, "for-each-ref", "--format=%(upstream)", "refs/heads/remote-feature")
	if err != nil || upstream != "refs/remotes/origin/remote-feature" {
		t.Fatalf("upstream %q %v", upstream, err)
	}
	f.git(t, "branch", "external", "main")
	external := filepath.Join(f.root, "external checkout")
	if _, err = command(f.repo, "wt", "switch", "external", "--path", external, "--no-cd", "--no-hooks", "--format=json"); err != nil {
		t.Fatal(err)
	}
	reuse := f.prepare(t, "existing", "refs/heads/external", "")
	if !reuse.Reuse || reuse.Path != external {
		t.Fatalf("external path moved: %+v", reuse)
	}
	result, err = create(reuse)
	if err != nil || result.Kind != "created" {
		t.Fatalf("external reuse: %+v %v", result, err)
	}
}

func TestNamingReadsPrimaryMetadataAndDiscoverySkipsIgnored(t *testing.T) {
	f := setup(t)
	f.git(t, "remote", "remove", "origin")
	if err := os.WriteFile(filepath.Join(f.repo, "package.json"), []byte(`{"name":"@scope/primary-name"}`), 0600); err != nil {
		t.Fatal(err)
	}
	p, err := project(f.repo, "")
	if err != nil || p.Basename != "primary-name" {
		t.Fatalf("package name %+v %v", p, err)
	}
	if err = os.Remove(filepath.Join(f.repo, "package.json")); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(f.repo, "pyproject.toml"), []byte("[tool.poetry]\nname = 'poetry-name'\n[project]\nname = \"project-name\" # static\n"), 0600); err != nil {
		t.Fatal(err)
	}
	p, err = project(f.repo, "")
	if err != nil || p.Basename != "project-name" {
		t.Fatalf("python name %+v %v", p, err)
	}
	rows, err := discover(filepath.Join(f.root, "projects"))
	if err != nil || len(rows) != 1 || rows[0].ID != f.p.ID {
		t.Fatalf("discovery %+v %v", rows, err)
	}
}

func TestPythonLiteralMetadata(t *testing.T) {
	for _, text := range []string{
		"[project]\nname = \"python-app\" # comment\n",
		"['project']\n'name' = 'python-app'\n",
		"project.name = \"python-app\"\n",
		"[tool.poetry]\nname = \"old\"\n[project]\nname = \"python-app\"\n",
		"[project]\nname = \"\"\"python-app\"\"\"\n",
		"[project]\nname = \"\"\"\npython-app\"\"\"\n",
		"[project]\nname = \"python\\u002dapp\"\n",
		"[project]\nname = \"python\\U0000002dapp\"\n",
		"[build-system]\nrequires = [\"setuptools\", \"wheel\"]\n[project]\nname = \"python-app\"\n",
		"[[plugins]]\nproject.name = \"plugin-app\"\n[project]\nname = \"python-app\"\n",
		"[project]\ndescription = \"\"\"\n[project]\nname = \"pretend\"\n\"\"\"\nname = \"python-app\"\n",
		"[project]\ndescription = '''\n[project]\nname = 'pretend'\n'''\nname = 'python-app'\n",
	} {
		if got := pythonName(text); got != "python-app" {
			t.Errorf("pythonName(%q) = %q", text, got)
		}
	}
	for _, text := range []string{"[build-system]\nname = \"other\"\n", "\"project.name\" = \"other\"\n", "[[plugins]]\nproject.name = \"plugin-app\"\n", "[project]\nname = \"@team/invalid\"\n", "[project]\nname = \"../escape\"\n", "[project]\nname = \"first\"\nname = \"second\"\n", "[project]\ndescription = \"\"\"unterminated\nname = \"pretend\"\n", "[project]\nname = \"invalid\\\ncontinuation\"\n"} {
		if got := pythonName(text); got != "" {
			t.Errorf("unsafe pythonName(%q) = %q", text, got)
		}
	}
}

func TestDiscoveryLiteralPathsIgnoresBrokenMarkersAndDeduplicates(t *testing.T) {
	f := setup(t)
	root := filepath.Join(f.root, "projects")
	initRepo := func(path string) {
		t.Helper()
		if err := os.MkdirAll(path, 0755); err != nil {
			t.Fatal(err)
		}
		if _, err := git(path, "init", "-b", "main"); err != nil {
			t.Fatal(err)
		}
	}
	other := filepath.Join(root, "literal ; $(no-shell)", "sample checkout")
	initRepo(other)
	initRepo(filepath.Join(root, "node_modules", "hidden"))
	initRepo(filepath.Join(f.repo, "ignored"))
	if err := os.WriteFile(filepath.Join(f.repo, ".gitignore"), []byte("ignored/\n"), 0600); err != nil {
		t.Fatal(err)
	}
	broken := filepath.Join(root, "broken")
	nested := filepath.Join(broken, "healthy")
	initRepo(nested)
	if err := os.WriteFile(filepath.Join(broken, ".git"), []byte("gitdir: ../missing\n"), 0600); err != nil {
		t.Fatal(err)
	}
	f.git(t, "branch", "linked")
	linked := filepath.Join(root, "linked")
	if _, err := command(f.repo, "wt", "switch", "linked", "--path", linked, "--no-hooks", "--no-cd", "--format=json"); err != nil {
		t.Fatal(err)
	}
	if _, err := git(root, "init", "--bare", "bare.git"); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "native-jj", ".jj"), 0755); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	rows, err := discover(root)
	t.Logf("four-worker discovery of mixed fixture (3 primary repositories, ignored/pruned/bare/broken/linked entries): %s", time.Since(started))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("discovery %+v", rows)
	}
	seen := map[string]bool{}
	for _, p := range rows {
		seen[p.Path] = true
	}
	for _, path := range []string{f.repo, other, nested} {
		if !seen[path] {
			t.Fatalf("missing %s: %+v", path, rows)
		}
	}
	alias := filepath.Join(f.root, "alias")
	if err := os.Symlink(f.repo, alias); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(f.repo, "sub")
	if err := os.Mkdir(sub, 0755); err != nil {
		t.Fatal(err)
	}
	result, err := api(input{Operation: "identities", Paths: []string{alias, sub, linked, nested, f.home, "invalid\npath"}})
	if err != nil {
		t.Fatal(err)
	}
	ids := result.(map[string]Identity)
	if len(ids) != 4 || ids[alias].Top != f.repo || ids[sub].ID != f.p.ID || ids[linked].Top != linked || ids[nested].ID == f.p.ID {
		t.Fatalf("identities %+v", ids)
	}
}

func TestValidationReconciliationAndLiteralBranchNames(t *testing.T) {
	f := setup(t)
	for _, name := range []string{"", "bad name", "-bad", "@{-1}", "main"} {
		if _, err := prepare(input{Project: f.p, Action: "new", Ref: "refs/heads/main", Name: name}); err == nil {
			t.Fatalf("accepted branch %q", name)
		}
	}
	r := f.prepare(t, "new", "refs/heads/main", "feature/$(literal);safe")
	result, err := create(r)
	if err != nil || result.Kind != "created" || result.Error != "" {
		t.Fatalf("literal create %+v %v", result, err)
	}
	if _, err = prepare(input{Project: f.p, Action: "new", Ref: "refs/heads/main", Name: "feature-literal-safe"}); err == nil {
		t.Fatal("slug collision accepted")
	}
	if _, err = git(r.Path, "checkout", "-b", "changed-branch"); err != nil {
		t.Fatal(err)
	}
	if result = inspect(r, true); result.Kind != "partial" {
		t.Fatalf("wrong branch accepted %+v", result)
	}
	r.Project.ID = "replaced"
	if result = inspect(r, true); result.Kind != "partial" {
		t.Fatal("replacement accepted")
	}
	f.git(t, "branch", "namespace/existing")
	conflict := f.prepare(t, "new", "refs/heads/main", "namespace")
	result, err = create(conflict)
	if err != nil || result.Kind != "absent" || result.Error == "" {
		t.Fatalf("namespace conflict %+v %v", result, err)
	}
	f.git(t, "branch", "free")
	pending := f.prepare(t, "existing", "refs/heads/free", "")
	elsewhere := filepath.Join(f.root, "elsewhere")
	if _, err = command(f.repo, "wt", "switch", "free", "--path", elsewhere, "--no-hooks", "--no-cd", "--format=json"); err != nil {
		t.Fatal(err)
	}
	result, err = create(pending)
	if err != nil || result.Kind != "absent" {
		t.Fatalf("moved eligibility %+v %v", result, err)
	}
	if _, err = os.Stat(pending.Path); !os.IsNotExist(err) {
		t.Fatal("created fallback checkout")
	}
}

func TestWorktrunkFailureRetainsCheckoutOrBranchArtifact(t *testing.T) {
	f := setup(t)
	testBinary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(f.bin, "wt")); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(testBinary, filepath.Join(f.bin, "wt")); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"nonzero", "branch-only"} {
		t.Setenv("WL_FIXTURE_WT_FAILURE", mode)
		r := f.prepare(t, "new", "refs/heads/main", mode)
		result, err := create(r)
		if err != nil {
			t.Fatal(err)
		}
		expected := "created"
		if mode == "branch-only" {
			expected = "partial"
		}
		if result.Kind != expected || result.Error == "" {
			t.Fatalf("%s: %+v", mode, result)
		}
		if f.git(t, "branch", "--list", mode) == "" {
			t.Fatal("branch deleted")
		}
		if mode == "nonzero" {
			if _, err = identity(r.Path); err != nil {
				t.Fatal("checkout lost", err)
			}
		}
	}
}

func TestFetchSelectedRemotePreservesDirtyPrimaryAndRejectsStaleProject(t *testing.T) {
	f := setup(t)
	origin := filepath.Join(f.root, "sample.git")
	upstream := filepath.Join(f.root, "upstream.git")
	for _, path := range []string{origin, upstream} {
		if _, err := command(f.root, "git", "clone", "--bare", f.repo, path); err != nil {
			t.Fatal(err)
		}
	}
	f.git(t, "remote", "set-url", "origin", origin)
	f.git(t, "remote", "add", "upstream", upstream)
	for _, path := range []string{origin, upstream} {
		if _, err := git(path, "branch", "fresh", "main"); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(f.repo, "tracked"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	f.git(t, "add", "tracked")
	f.git(t, "commit", "-m", "tracked")
	if err := os.WriteFile(filepath.Join(f.repo, "tracked"), []byte("staged"), 0600); err != nil {
		t.Fatal(err)
	}
	f.git(t, "add", "tracked")
	if err := os.WriteFile(filepath.Join(f.repo, "tracked"), []byte("unstaged"), 0600); err != nil {
		t.Fatal(err)
	}
	before := []string{f.git(t, "rev-parse", "HEAD"), f.git(t, "status", "--porcelain"), f.git(t, "diff"), f.git(t, "diff", "--cached")}
	value, err := api(input{Operation: "fetch", Project: f.p, Remote: "origin"})
	if err != nil {
		t.Fatal(err)
	}
	refs := value.([]Ref)
	found := false
	for _, r := range refs {
		if r.Ref == "refs/remotes/origin/fresh" {
			found = true
		}
		if r.Ref == "refs/remotes/upstream/fresh" {
			t.Fatal("fetched unrelated remote")
		}
	}
	if !found {
		t.Fatal("missing fetched branch")
	}
	after := []string{f.git(t, "rev-parse", "HEAD"), f.git(t, "status", "--porcelain"), f.git(t, "diff"), f.git(t, "diff", "--cached")}
	if fmt.Sprint(before) != fmt.Sprint(after) {
		t.Fatal("fetch changed primary checkout")
	}
	if _, err = api(input{Operation: "fetch", Project: f.p, Remote: "--all"}); err == nil {
		t.Fatal("option accepted as remote")
	}
	stale := f.p
	stale.ID = "replaced"
	if _, err = api(input{Operation: "fetch", Project: stale, Remote: "origin"}); err == nil {
		t.Fatal("stale identity accepted")
	}
	f.git(t, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
	refs, err = choices(f.p)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range refs {
		if r.Ref == "refs/remotes/origin/HEAD" {
			t.Fatal("symbolic ref exposed")
		}
		if r.Ref == "refs/remotes/origin/main" && r.Reason == "" {
			t.Fatal("remote collision allowed")
		}
	}
}

func TestUnreadableDiscoveryFailsWithoutPartialList(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root bypasses directory permissions")
	}
	f := setup(t)
	blocked := filepath.Join(f.root, "projects", "blocked")
	if err := os.Mkdir(blocked, 0000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(blocked, 0700) })
	if _, err := discover(filepath.Join(f.root, "projects")); err == nil {
		t.Fatal("unreadable directory returned partial list")
	}
	if err := os.Chmod(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(f.repo, ".git", "config")
	if err := os.Chmod(config, 0000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(config, 0600) })
	if _, err := discover(filepath.Join(f.root, "projects")); err == nil {
		t.Fatal("Git permission failure returned partial list")
	}
}

func TestManifestBoundsOriginFormsAndPrimaryNaming(t *testing.T) {
	f := setup(t)
	for _, url := range []string{"https://code.example.invalid/team/repository.git", "ssh://git@code.example.invalid/team/repository.git/", "git@code.example.invalid:repository.git", "/srv/git/repository.git", "https://code.example.invalid/team/repository.git?transport=fixture"} {
		f.git(t, "remote", "set-url", "origin", url)
		p, err := project(f.repo, "")
		if err != nil || p.Basename != "repository" {
			t.Fatalf("origin %s: %+v %v", url, p, err)
		}
	}
	f.git(t, "remote", "remove", "origin")
	if err := os.WriteFile(filepath.Join(f.repo, "pyproject.toml"), []byte("[project]\nname='python-app'\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, data := range []string{"{broken", "{}", "null", `{"name":"../../escape"}`, `{"name":"."}`, `{"name":"bad/name"}`, `{"name":3}`, "\x00{\"name\":\"binary\"}", string([]byte{0xff}), `{"name":"too-big","description":"` + strings.Repeat("x", 65536) + `"}`} {
		if err := os.WriteFile(filepath.Join(f.repo, "package.json"), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		if name := manifestName(f.repo); name != "python-app" {
			t.Fatalf("invalid package metadata yielded %q", name)
		}
	}
	if err := os.WriteFile(filepath.Join(f.repo, "package.json"), []byte("\ufeff{\"name\":\"@team/primary-name\"}"), 0600); err != nil {
		t.Fatal(err)
	}
	f.git(t, "branch", "linked-metadata")
	linked := filepath.Join(f.root, "linked metadata")
	if _, err := command(f.repo, "wt", "switch", "linked-metadata", "--path", linked, "--no-cd", "--no-hooks", "--format=json"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(linked, "package.json"), []byte(`{"name":"unrelated-checkout-name"}`), 0600); err != nil {
		t.Fatal(err)
	}
	p, err := project(linked, "")
	if err != nil || p.Path != f.repo || p.Basename != "primary-name" {
		t.Fatalf("linked naming %+v %v", p, err)
	}
}

func TestUnavailableCoreRefusesBeforeMutation(t *testing.T) {
	f := setup(t)
	r := f.prepare(t, "new", "refs/heads/main", "offline")
	t.Setenv("WL_FIXTURE_CORE_OFFLINE", "1")
	if _, err := create(r); err == nil || !strings.Contains(err.Error(), "not running") {
		t.Fatalf("unavailable core: %v", err)
	}
	if f.git(t, "branch", "--list", "offline") != "" {
		t.Fatal("branch created without reachable core")
	}
	if _, err := os.Stat(r.Path); !os.IsNotExist(err) {
		t.Fatal("destination created without reachable core")
	}
	if len(f.core(t).Calls) != 0 {
		t.Fatal("core RPC used after unavailable status")
	}
}

func TestWorktrunkProjectHooksAreSkipped(t *testing.T) {
	f := setup(t)
	if err := os.MkdirAll(filepath.Join(f.repo, ".config"), 0755); err != nil {
		t.Fatal(err)
	}
	config := "[pre-start]\nmarker = \"touch {{ repo_path }}/hook-marker\"\n"
	if err := os.WriteFile(filepath.Join(f.repo, ".config", "wt.toml"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	f.git(t, "add", ".config/wt.toml")
	f.git(t, "commit", "-m", "fixture hook")
	if _, err := command(f.repo, "wt", "hook", "pre-start", "--yes"); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(f.repo, "hook-marker")
	if err := os.Remove(marker); err != nil {
		t.Fatalf("configured hook did not execute: %v", err)
	}
	r := f.prepare(t, "new", "refs/heads/main", "without-hooks")
	result, err := create(r)
	if err != nil || result.Kind != "created" || result.Error != "" {
		t.Fatalf("create with configured hook: %+v %v", result, err)
	}
	for _, path := range []string{marker, filepath.Join(r.Path, "hook-marker")} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("project hook executed during creation: %s", path)
		}
	}
}

func TestSymlinkedHomeCreatesVerifiableWorktree(t *testing.T) {
	f := setup(t)
	alias := filepath.Join(f.root, "home-alias")
	if err := os.Symlink(f.home, alias); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", alias)
	r := f.prepare(t, "new", "refs/heads/main", "linked-home")
	if r.Path != filepath.Join(f.home, ".herdr", "worktrees", "sample", "linked-home") {
		t.Fatalf("destination is not canonical: %s", r.Path)
	}
	result, err := create(r)
	if err != nil || result.Kind != "created" {
		t.Fatalf("create: %+v %v", result, err)
	}
	if inspected := inspect(r, true); inspected.Kind != "created" {
		t.Fatalf("inspect: %+v", inspected)
	}
}

func TestExplicitCheckoutBypassesOnlyDiscoveryFilters(t *testing.T) {
	for _, mode := range []string{"pruned", "ignored"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t)
			if mode == "pruned" {
				next := filepath.Join(f.root, "build")
				if err := os.Rename(f.repo, next); err != nil {
					t.Fatal(err)
				}
				f.repo = next
			} else {
				if _, err := git(f.root, "init"); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(f.root, ".gitignore"), []byte("*\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			discovered, err := project(f.repo, f.root)
			if err != nil {
				t.Fatal(err)
			}
			if err := validateProject(discovered); err == nil || !strings.Contains(err.Error(), "excluded") {
				t.Fatalf("discovery filter missing: %v", err)
			}
			opened, _, err := run([]string{"open", "main", "--checkout", f.repo, "--json"})
			if err != nil {
				t.Fatal(err)
			}
			if opened.(OpenResult).Path != f.repo {
				t.Fatalf("wrong explicit checkout: %+v", opened)
			}
		})
	}
}

func TestCoreListFailureReportsUnstartedCreation(t *testing.T) {
	f := setup(t)
	r := f.prepare(t, "new", "refs/heads/main", "list-failed")
	t.Setenv("WL_FIXTURE_FAIL_LIST", "1")
	_, err := create(r)
	var detail *failure
	if !errors.As(err, &detail) || detail.Kind != "core_unavailable" {
		t.Fatalf("wrong pre-creation failure: %v", err)
	}
	if f.git(t, "branch", "--list", "list-failed") != "" {
		t.Fatal("branch created")
	}
	if _, err := os.Stat(r.Path); !os.IsNotExist(err) {
		t.Fatal("destination created")
	}
}

func TestWorktrunkUnclosedPipesHaveBoundedWaitAndUncertainOutcome(t *testing.T) {
	f := setup(t)
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(filepath.Join(f.bin, "wt")); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(binary, filepath.Join(f.bin, "wt")); err != nil {
		t.Fatal(err)
	}
	pidFile := filepath.Join(f.root, "child.pid")
	t.Setenv("WL_FIXTURE_WT_FAILURE", "held-pipes")
	t.Setenv("WL_FIXTURE_CHILD_PID", pidFile)
	t.Cleanup(func() {
		if raw, err := os.ReadFile(pidFile); err == nil {
			var pid int
			if _, err := fmt.Sscan(string(raw), &pid); err == nil && pid > 0 {
				if child, err := os.FindProcess(pid); err == nil {
					_ = child.Kill()
				}
			}
		}
	})
	r := f.prepare(t, "new", "refs/heads/main", "uncertain")
	start := time.Now()
	result, err := create(r)
	if err != nil || result.Kind != "partial" || result.Error == "" {
		t.Fatalf("uncertain outcome: %+v %v", result, err)
	}
	if time.Since(start) >= 15*time.Second {
		t.Fatal("waited for the descendant instead of bounding the pipe wait")
	}
}
