package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

//go:embed help.txt
var help string

//go:embed skill.md
var skill string

type failure struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Hint    string `json:"hint"`
}

func (e *failure) Error() string            { return e.Message }
func fail(kind, message, hint string) error { return &failure{kind, message, hint} }
func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
func clean(s string) bool {
	return s != "" && !strings.ContainsAny(s, "\x00\r\n") && strings.IndexFunc(s, func(r rune) bool { return r < 32 || r == 127 }) < 0
}
func inside(path, root string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
func real(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(abs)
}
func uuid() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	s := hex.EncodeToString(b)
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}

func command(cwd, program string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, program, args...)
	cmd.Dir = cwd
	cmd.WaitDelay = 5 * time.Second
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = strings.TrimSpace(string(out))
		}
		if message == "" {
			message = err.Error()
		}
		return out, fmt.Errorf("%s: %s: %w", program, message, err)
	}
	return out, nil
}
func git(cwd string, args ...string) (string, error) {
	out, err := command(cwd, "git", append([]string{"--no-optional-locks"}, args...)...)
	return strings.TrimSpace(string(out)), err
}

type Identity struct {
	ID  string `json:"id"`
	Top string `json:"top"`
}
type Project struct {
	ID       string `json:"id"`
	Path     string `json:"path"`
	Root     string `json:"root"`
	Label    string `json:"label"`
	Basename string `json:"basename"`
	Machine  any    `json:"machine"`
	Explicit bool   `json:"explicit,omitempty"`
}
type Ref struct {
	Ref      string  `json:"ref"`
	Symbolic string  `json:"symbolic"`
	Upstream string  `json:"upstream"`
	Kind     string  `json:"kind"`
	Source   any     `json:"source"`
	Name     string  `json:"name"`
	Label    string  `json:"label"`
	Checkout *string `json:"checkout"`
	Reason   string  `json:"reason"`
}
type Launch struct {
	Key   string   `json:"key"`
	Label string   `json:"label"`
	Argv  []string `json:"argv"`
}
type Request struct {
	CoreID   string  `json:"core_id,omitempty"`
	Machine  any     `json:"machine,omitempty"`
	Project  Project `json:"project"`
	Action   string  `json:"action"`
	Ref      string  `json:"ref"`
	Name     string  `json:"name"`
	Path     string  `json:"path"`
	Commit   string  `json:"commit"`
	Upstream string  `json:"upstream"`
	Remote   bool    `json:"remote"`
	Reuse    bool    `json:"reuse"`
	Attempt  string  `json:"attempt,omitempty"`
	Launch   Launch  `json:"launch"`
}
type Result struct {
	Kind    string  `json:"kind"`
	Path    string  `json:"path"`
	Request Request `json:"request"`
	Error   string  `json:"error,omitempty"`
}
type Program struct {
	Key       string   `json:"key"`
	Name      string   `json:"name"`
	Installed bool     `json:"installed"`
	Run       []string `json:"run"`
}
type input struct {
	Operation string `json:"operation"`
	Config    struct {
		ProjectRoot string `json:"project_root"`
	} `json:"config"`
	Path     string    `json:"path"`
	Paths    []string  `json:"paths"`
	Project  Project   `json:"project"`
	Action   string    `json:"action"`
	Ref      string    `json:"ref"`
	Name     string    `json:"name"`
	Checkout *string   `json:"checkout"`
	Remote   string    `json:"remote"`
	Request  Request   `json:"request"`
	Recover  bool      `json:"recover"`
	Agents   []Program `json:"agents"`
}

func identity(path string) (Identity, error) {
	if !clean(path) {
		return Identity{}, errors.New("Supply a local checkout path.")
	}
	text, err := git(path, "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir")
	if err != nil {
		return Identity{}, err
	}
	lines := strings.Split(text, "\n")
	if len(lines) != 2 {
		return Identity{}, errors.New("Git returned invalid checkout identity.")
	}
	top, err := real(lines[0])
	if err != nil {
		return Identity{}, err
	}
	id, err := real(lines[1])
	return Identity{id, top}, err
}

type worktree struct {
	Path, Branch, Head string
	Prunable, Bare     bool
}

func worktrees(path string) ([]worktree, error) {
	text, err := git(path, "worktree", "list", "--porcelain", "-z")
	if err != nil {
		return nil, err
	}
	rows := []worktree{}
	for _, block := range strings.Split(text, "\x00\x00") {
		if block == "" {
			continue
		}
		row := worktree{}
		for _, field := range strings.Split(block, "\x00") {
			key, value, _ := strings.Cut(field, " ")
			switch key {
			case "worktree":
				row.Path = value
			case "branch":
				row.Branch = value
			case "HEAD":
				row.Head = value
			case "prunable":
				row.Prunable = true
			case "bare":
				row.Bare = true
			}
		}
		if row.Path != "" {
			rows = append(rows, row)
		}
	}
	return rows, nil
}

var usableName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$`)
var bareTOMLKey = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func manifestName(path string) string {
	read := func(name string) []byte {
		f, err := os.Open(filepath.Join(path, name))
		if err != nil {
			return nil
		}
		defer f.Close()
		b, _ := io.ReadAll(io.LimitReader(f, 65537))
		if len(b) > 65536 || !utf8.Valid(b) || bytes.ContainsRune(b, 0) {
			return nil
		}
		return bytes.TrimPrefix(b, []byte{0xef, 0xbb, 0xbf})
	}
	var pkg struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(read("package.json"), &pkg) == nil {
		name := pkg.Name
		if strings.HasPrefix(name, "@") {
			scope, bare, ok := strings.Cut(name[1:], "/")
			if ok && usableName.MatchString(scope) {
				name = bare
			}
		}
		if usableName.MatchString(name) {
			return name
		}
	}
	return pythonName(string(read("pyproject.toml")))
}

// Mask strings and comments before looking for TOML table/key names. This
// bounded static subset cannot mistake a description's contents for metadata.
func pythonName(text string) string {
	var masked strings.Builder
	literals := map[string]string{}
	for i := 0; i < len(text); {
		quote := text[i]
		if quote == '#' {
			for i < len(text) && text[i] != '\n' {
				i++
			}
			continue
		}
		if quote != '\'' && quote != '"' {
			masked.WriteByte(quote)
			i++
			continue
		}
		width := 1
		if strings.HasPrefix(text[i:], strings.Repeat(string(quote), 3)) {
			width = 3
		}
		delim := strings.Repeat(string(quote), width)
		start := i + width
		end := start
		for end < len(text) && !strings.HasPrefix(text[end:], delim) {
			if width == 1 && (text[end] == '\r' || text[end] == '\n') {
				return ""
			}
			if quote == '"' && text[end] == '\\' {
				end++
				if end >= len(text) || width == 1 && (text[end] == '\r' || text[end] == '\n') {
					return ""
				}
			}
			end++
		}
		if end >= len(text) {
			return ""
		}
		body := text[start:end]
		if width == 3 {
			body = strings.TrimPrefix(strings.TrimPrefix(body, "\r\n"), "\n")
		}
		if quote == '"' {
			body = strings.ReplaceAll(body, "\r\n", "\n")
			decoded, err := strconv.Unquote("\"" + strings.ReplaceAll(body, "\n", `\n`) + "\"")
			if err != nil {
				decoded = "" // Unsupported unrelated literals cannot become names.
			}
			body = decoded
		}
		token := fmt.Sprintf("\x00%d\x00", len(literals))
		literals[token] = body
		masked.WriteString(token)
		i = end + width
	}
	key := func(text string) ([]string, bool) {
		parts := strings.Split(text, ".")
		for i, part := range parts {
			part = strings.TrimSpace(part)
			if value, ok := literals[part]; ok {
				parts[i] = value
			} else if bareTOMLKey.MatchString(part) {
				parts[i] = part
			} else {
				return nil, false
			}
		}
		return parts, true
	}
	section := []string{}
	depth := 0
	names := map[string]string{}
	for _, raw := range strings.Split(masked.String(), "\n") {
		line := strings.TrimSpace(raw)
		if depth == 0 {
			if strings.HasPrefix(line, "[[") && strings.HasSuffix(line, "]]") {
				section = nil
				continue
			}
			if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
				var ok bool
				section, ok = key(line[1 : len(line)-1])
				if !ok {
					return ""
				}
				continue
			}
			field, value, ok := strings.Cut(line, "=")
			if ok && section != nil {
				parts, valid := key(field)
				if valid {
					parts = append(append([]string{}, section...), parts...)
					path := strings.Join(parts, ".")
					name, literal := literals[strings.TrimSpace(value)]
					validPath := len(parts) == 2 && parts[0] == "project" && parts[1] == "name" || len(parts) == 3 && parts[0] == "tool" && parts[1] == "poetry" && parts[2] == "name"
					if literal && validPath {
						if _, duplicate := names[path]; duplicate {
							return ""
						}
						names[path] = ""
						if usableName.MatchString(name) {
							names[path] = name
						}
					}
				}
			}
		}
		for _, char := range line {
			if char == '[' || char == '{' {
				depth++
			} else if char == ']' || char == '}' {
				depth--
			}
			if depth < 0 {
				return ""
			}
		}
	}
	if depth != 0 {
		return ""
	}
	if names["project.name"] != "" {
		return names["project.name"]
	}
	return names["tool.poetry.name"]
}
func project(path, root string) (Project, error) {
	explicit := root == ""
	id, err := identity(path)
	if err != nil {
		return Project{}, err
	}
	primary := id.Top
	if id.ID != filepath.Join(id.Top, ".git") {
		rows, err := worktrees(id.Top)
		if err != nil {
			return Project{}, err
		}
		if len(rows) == 0 || rows[0].Bare {
			return Project{}, errors.New("No primary checkout.")
		}
		primary, err = real(rows[0].Path)
		if err != nil {
			return Project{}, err
		}
	}
	if root == "" {
		root = filepath.Dir(filepath.Dir(primary))
	}
	root, err = real(root)
	if err != nil {
		return Project{}, err
	}
	name := ""
	origin, e := git(primary, "config", "--get", "remote.origin.url")
	if e == nil {
		url := origin
		if strings.Contains(url, "://") {
			url = strings.SplitN(strings.SplitN(url, "?", 2)[0], "#", 2)[0]
		}
		url = strings.TrimRight(url, "/")
		name = filepath.Base(url)
		if !strings.Contains(url, "/") {
			name = url[strings.LastIndex(url, ":")+1:]
		}
		name = strings.TrimSuffix(name, ".git")
		if !clean(name) || name == "." || name == ".." {
			return Project{}, errors.New("Origin has no safe repository name.")
		}
	} else {
		var exit *exec.ExitError
		if !errors.As(e, &exit) || exit.ExitCode() != 1 {
			return Project{}, e
		}
		name = manifestName(primary)
		if name == "" {
			name = filepath.Base(primary)
			if (name == "main" || name == "master" || name == "trunk") && filepath.Dir(primary) != root && inside(filepath.Dir(primary), root) {
				name = filepath.Base(filepath.Dir(primary))
			}
		}
	}
	label, _ := filepath.Rel(root, primary)
	return Project{ID: id.ID, Path: primary, Root: root, Label: label, Basename: name, Explicit: explicit}, nil
}
func validateProject(p Project) error {
	if !clean(p.ID) || !clean(p.Path) || !clean(p.Root) {
		return errors.New("Select a project.")
	}
	current, err := project(p.Path, p.Root)
	if err != nil {
		return err
	}
	if current.ID != p.ID || current.Path != p.Path || !inside(p.Path, p.Root) || current.Basename != p.Basename {
		return errors.New("Project identity changed; Refresh and select it again.")
	}
	if p.Explicit {
		return nil
	}
	rel, _ := filepath.Rel(p.Root, p.Path)
	for _, component := range strings.Split(rel, string(filepath.Separator)) {
		if pruned[component] {
			return errors.New("Project is now excluded; Refresh.")
		}
	}
	if excluded, err := ignored(p.Path, p.Root); err != nil {
		return err
	} else if excluded {
		return errors.New("Project is now excluded; Refresh.")
	}
	return nil
}
func validateRoot(path string) (string, error) {
	if !clean(path) || !filepath.IsAbs(path) {
		return "", errors.New("Configure project_root as one absolute, readable directory.")
	}
	root, err := real(path)
	if err != nil {
		return "", err
	}
	f, err := os.Open(root)
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("Project root is not a directory.")
	}
	_, err = f.Readdirnames(1)
	if errors.Is(err, io.EOF) {
		err = nil
	}
	return root, err
}

var pruned = map[string]bool{"node_modules": true, "vendor": true, "target": true, "build": true, "dist": true, ".next": true, "coverage": true}

func brokenMetadata(err error) bool {
	text := err.Error()
	return strings.Contains(text, "fatal: gitfile does not point to a valid repository:") || strings.Contains(text, "fatal: not a git repository:")
}

func ignored(path, root string) (bool, error) {
	for p := filepath.Dir(path); inside(p, root); p = filepath.Dir(p) {
		if _, err := os.Lstat(filepath.Join(p, ".git")); err == nil {
			_, err := command(p, "git", "--no-optional-locks", "check-ignore", "--quiet", "--", path)
			if err == nil {
				return true, nil
			}
			var exit *exec.ExitError
			if !errors.As(err, &exit) || exit.ExitCode() != 1 && !(exit.ExitCode() == 128 && brokenMetadata(err)) {
				return false, err
			}
			if exit.ExitCode() == 1 {
				return false, nil
			}
		}
		if p == root || p == filepath.Dir(p) {
			break
		}
	}
	return false, nil
}
func discover(root string) ([]Project, error) {
	root, err := validateRoot(root)
	if err != nil {
		return nil, err
	}
	candidates := []string{}
	err = filepath.WalkDir(root, func(path string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if !d.IsDir() {
			return nil
		}
		if !clean(path) {
			return filepath.SkipDir
		}
		if d.Name() == ".git" {
			return filepath.SkipDir
		}
		if path != root && pruned[d.Name()] {
			return filepath.SkipDir
		}
		if _, e := os.Lstat(filepath.Join(path, ".git")); e == nil {
			candidates = append(candidates, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	type metadata struct {
		project Project
		err     error
	}
	jobs := make(chan string)
	results := make(chan metadata)
	var workers sync.WaitGroup
	for range 4 {
		workers.Go(func() {
			for path := range jobs {
				excluded, err := ignored(path, root)
				if err != nil {
					results <- metadata{err: err}
					continue
				}
				if excluded {
					continue
				}
				p, err := project(path, root)
				if err != nil {
					if !brokenMetadata(err) {
						results <- metadata{err: err}
					}
					continue
				}
				if p.Path == path && path != root && inside(path, root) {
					results <- metadata{project: p}
				}
			}
		})
	}
	go func() {
		for _, path := range candidates {
			jobs <- path
		}
		close(jobs)
		workers.Wait()
		close(results)
	}()
	found := map[string]Project{}
	var firstError error
	for result := range results {
		if result.err != nil {
			if firstError == nil {
				firstError = result.err
			}
			continue
		}
		found[result.project.ID] = result.project
	}
	if firstError != nil {
		return nil, firstError
	}
	out := []Project{}
	for _, p := range found {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out, nil
}
func choices(p Project) ([]Ref, error) {
	if err := validateProject(p); err != nil {
		return nil, err
	}
	rows, err := worktrees(p.Path)
	if err != nil {
		return nil, err
	}
	remoteText, err := git(p.Path, "remote")
	if err != nil {
		return nil, err
	}
	remotes := strings.Fields(remoteText)
	sort.Slice(remotes, func(i, j int) bool { return len(remotes[i]) > len(remotes[j]) })
	text, err := git(p.Path, "for-each-ref", "--format=%(refname)%00%(symref)%00%(upstream)", "refs/heads", "refs/remotes")
	if err != nil {
		return nil, err
	}
	refs := []Ref{}
	locals := map[string]bool{}
	for _, line := range strings.Split(text, "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, "\x00")
		if len(f) != 3 {
			return nil, errors.New("Invalid Git ref metadata.")
		}
		if f[1] != "" {
			continue
		}
		r := Ref{Ref: f[0], Symbolic: f[1], Upstream: f[2], Kind: "local", Source: "local"}
		short := strings.TrimPrefix(f[0], "refs/heads/")
		if strings.HasPrefix(f[0], "refs/remotes/") {
			r.Kind = "remote"
			r.Source = nil
			short = strings.TrimPrefix(f[0], "refs/remotes/")
			for _, remote := range remotes {
				if strings.HasPrefix(short, remote+"/") {
					r.Source = remote
					r.Name = strings.TrimPrefix(short, remote+"/")
					break
				}
			}
		} else {
			locals[short] = true
		}
		if r.Name == "" {
			r.Name = short
		}
		r.Label = short + " · " + r.Kind
		refs = append(refs, r)
	}
	for i := range refs {
		r := &refs[i]
		for _, row := range rows {
			if row.Branch == r.Ref {
				path := row.Path
				r.Checkout = &path
				if row.Prunable {
					r.Reason = "Worktree is unavailable at " + path + ". Repair it in Git, then Refresh."
				}
				break
			}
		}
		if r.Kind == "remote" {
			if r.Source == nil {
				r.Reason = "Remote is no longer configured."
			} else if locals[r.Name] {
				r.Reason = "A local branch named " + r.Name + " already exists."
			}
		}
	}
	return refs, nil
}

var slugPattern = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func worktreeRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	home, err = real(home)
	if err != nil {
		return "", err
	}
	root := os.Getenv("HERDR_WORKTREE_ROOT")
	if root == "" {
		configHome := os.Getenv("XDG_CONFIG_HOME")
		if configHome == "" {
			configHome = filepath.Join(home, ".config")
		}
		if !filepath.IsAbs(configHome) {
			return "", errors.New("XDG_CONFIG_HOME must be an absolute directory.")
		}
		path := filepath.Join(configHome, "herdr-worktree-launcher", "config.json")
		data, readErr := os.ReadFile(path)
		if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
			return "", fmt.Errorf("Cannot read Worktree Launcher config: %w", readErr)
		}
		if readErr == nil {
			var config struct {
				WorktreeRoot string `json:"worktree_root"`
			}
			if err = json.Unmarshal(data, &config); err != nil {
				return "", fmt.Errorf("Invalid Worktree Launcher config: %w", err)
			}
			root = config.WorktreeRoot
		}
	}
	if root == "" {
		return filepath.Join(home, ".herdr", "worktrees"), nil
	}
	if !clean(root) || !filepath.IsAbs(root) {
		return "", errors.New("worktree_root must be an absolute path to an existing directory.")
	}
	root, err = real(root)
	if err != nil {
		return "", fmt.Errorf("Cannot use worktree_root; create its directory first: %w", err)
	}
	info, err := os.Stat(root)
	if err != nil {
		return "", err
	}
	if !info.IsDir() || filepath.Dir(root) == root {
		return "", errors.New("worktree_root must be a directory other than the filesystem root.")
	}
	return root, nil
}

func destination(p Project, name string) (string, error) {
	slug := strings.Trim(slugPattern.ReplaceAllString(name, "-"), "-")
	if slug == "" || slug == "." || slug == ".." || !clean(p.Basename) || p.Basename == "." || p.Basename == ".." || strings.ContainsAny(p.Basename, "/\\") {
		return "", errors.New("Branch has no safe destination slug.")
	}
	root, err := worktreeRoot()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, p.Basename, slug), nil
}
func validateDestination(path string) error {
	root, err := worktreeRoot()
	if err != nil {
		return err
	}
	if !filepath.IsAbs(path) || !inside(path, root) || path == root {
		return errors.New("Unsafe destination.")
	}
	if _, err = os.Lstat(path); err == nil {
		return fmt.Errorf("Destination is occupied: %s", path)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for p := filepath.Dir(path); ; p = filepath.Dir(p) {
		info, e := os.Lstat(p)
		if e == nil && (info.Mode()&os.ModeSymlink != 0 || !info.IsDir()) {
			return fmt.Errorf("Destination ancestor is a symlink or unavailable: %s", p)
		}
		if e != nil && !errors.Is(e, os.ErrNotExist) {
			return e
		}
		if p == filepath.Dir(p) {
			break
		}
	}
	return nil
}

func dependencies() error {
	for _, program := range []string{"git", "wt", "hc"} {
		if _, err := exec.LookPath(program); err != nil {
			return fail("dependency_missing", program+" is not on PATH.", "Install "+program+" and add it to PATH. Worktree management requires Worktrunk's wt.")
		}
	}
	return nil
}
func preflight(expectedCore string) error {
	if os.Getenv("HC_SOCKET") == "" && os.Getenv("HC_SESSION") == "" && expectedCore == "" {
		return fail("context_missing", "Set HC_SOCKET or HC_SESSION to an already running local core before creating or opening a checkout.", "The launcher never starts or selects a default core.")
	}
	if err := dependencies(); err != nil {
		return err
	}
	coreID, err := runningCoreID()
	if err != nil {
		return err
	}
	if expectedCore != "" && coreID != expectedCore {
		return fail("core_unavailable", "The Herdr core connection changed. No worktree or session operation was started.", "Refresh Worktree Launcher to use the app's current core.")
	}
	return nil
}
func runningCoreID() (string, error) {
	out, err := command("", "hc", "server", "status", "--json")
	if err != nil {
		return "", fail("core_unavailable", "The selected core is not running: "+err.Error(), "Start the intended core separately, then reopen Worktree Launcher or set HC_SOCKET or HC_SESSION.")
	}
	var status struct {
		PID  int `json:"pid"`
		Core struct {
			ID string `json:"id"`
		} `json:"core"`
	}
	if json.Unmarshal(out, &status) != nil || status.PID <= 0 || status.Core.ID == "" {
		return "", fail("core_unavailable", "hc server status did not prove that the selected core is already running.", "Check HC_SOCKET or HC_SESSION and hc server status --json.")
	}
	return status.Core.ID, nil
}
func prepare(in input) (Request, error) {
	if in.Action != "new" && in.Action != "existing" {
		return Request{}, errors.New("Select Existing branch or New branch.")
	}
	refs, err := choices(in.Project)
	if err != nil {
		return Request{}, err
	}
	var selected *Ref
	for i := range refs {
		if refs[i].Ref == in.Ref {
			selected = &refs[i]
			break
		}
	}
	if selected == nil {
		return Request{}, errors.New("Selected branch/ref is stale; Refresh and choose again.")
	}
	name := in.Name
	if in.Action == "existing" {
		if selected.Reason != "" {
			return Request{}, errors.New(selected.Reason)
		}
		if in.Checkout != nil && (selected.Checkout == nil || *selected.Checkout != *in.Checkout) {
			return Request{}, errors.New("Existing worktree changed; Refresh and select the branch again.")
		}
		name = selected.Name
	} else {
		if !clean(name) || strings.HasPrefix(name, "-") || strings.HasPrefix(name, "@{") {
			return Request{}, errors.New("Enter a valid new branch name.")
		}
		if _, err = git(in.Project.Path, "check-ref-format", "--branch", name); err != nil {
			return Request{}, err
		}
		for _, r := range refs {
			if r.Name == name {
				return Request{}, fmt.Errorf("A local or fetched remote branch named %s already exists.", name)
			}
		}
	}
	reuse := in.Action == "existing" && selected.Checkout != nil
	path := ""
	if reuse {
		path = *selected.Checkout
	} else {
		path, err = destination(in.Project, name)
		if err != nil {
			return Request{}, err
		}
		if err = validateDestination(path); err != nil {
			return Request{}, err
		}
	}
	commit, err := git(in.Project.Path, "rev-parse", "--verify", in.Ref+"^{commit}")
	if err != nil {
		return Request{}, err
	}
	upstream := ""
	if in.Action == "existing" {
		upstream = selected.Upstream
		if selected.Kind == "remote" {
			upstream = in.Ref
		}
	}
	r := Request{Project: in.Project, Action: in.Action, Ref: in.Ref, Name: name, Path: path, Commit: commit, Upstream: upstream, Remote: selected.Kind == "remote", Reuse: reuse, Launch: Launch{Key: "shell", Label: "Shell"}}
	if reuse {
		result := inspect(r, false)
		if result.Kind != "created" {
			return Request{}, errors.New(result.Error)
		}
	}
	return r, nil
}
func inspect(r Request, recover bool) Result {
	result := Result{Path: r.Path, Request: r}
	partial := func(err error) Result {
		result.Kind = "partial"
		result.Error = "Cannot reconcile operation: " + err.Error() + ". Inspect Git before retrying."
		return result
	}
	if !clean(r.Path) || !filepath.IsAbs(r.Path) || !clean(r.Name) || !clean(r.Commit) || (r.Action != "new" && r.Action != "existing") {
		return partial(errors.New("operation request is incomplete"))
	}
	id, err := identity(r.Project.Path)
	if err != nil {
		return partial(err)
	}
	if id.ID != r.Project.ID || id.Top != r.Project.Path {
		return partial(errors.New("project checkout identity changed"))
	}
	if !recover {
		if err = validateProject(r.Project); err != nil {
			return partial(err)
		}
	}
	rows, err := worktrees(r.Project.Path)
	if err != nil {
		return partial(err)
	}
	var row *worktree
	for i := range rows {
		if rows[i].Path == r.Path {
			row = &rows[i]
			break
		}
	}
	if row != nil && !row.Prunable && row.Branch == "refs/heads/"+r.Name && (recover || r.Reuse || row.Head == r.Commit) {
		actual, e := identity(r.Path)
		top, e2 := real(r.Path)
		if e == nil && e2 == nil && actual.ID == r.Project.ID && actual.Top == top && top == r.Path {
			upstream, e := git(r.Path, "for-each-ref", "--format=%(upstream)", "refs/heads/"+r.Name)
			if e == nil && (recover || r.Reuse || upstream == r.Upstream) {
				result.Kind = "created"
				return result
			}
		}
	}
	if r.Reuse {
		return partial(fmt.Errorf("existing worktree is unavailable or changed at %s", r.Path))
	}
	branch, err := git(r.Project.Path, "show-ref", "--verify", "--quiet", "refs/heads/"+r.Name)
	_ = branch
	exists := err == nil
	if err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 1 {
			return partial(err)
		}
	}
	_, statErr := os.Lstat(r.Path)
	occupied := statErr == nil
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return partial(statErr)
	}
	if row != nil || occupied || ((r.Action == "new" || r.Remote) && exists) {
		return partial(errors.New("destination, worktree or branch already exists; repair it manually"))
	}
	result.Kind = "absent"
	return result
}
func create(r Request) (Result, error) {
	if err := preflight(r.CoreID); err != nil {
		return Result{}, err
	}
	if _, err := core("terminal.list", map[string]any{}); err != nil {
		return Result{}, fail("core_unavailable", err.Error(), "No worktree operation was started.")
	}
	if r.Reuse {
		return inspect(r, false), nil
	}
	fresh, err := prepare(input{Project: r.Project, Action: r.Action, Ref: r.Ref, Name: r.Name})
	if err != nil {
		return inspectWithError(r, err), nil
	}
	if fresh.Path != r.Path || fresh.Name != r.Name || fresh.Reuse || fresh.Commit != r.Commit || fresh.Upstream != r.Upstream || fresh.Remote != r.Remote {
		return inspectWithError(r, errors.New("Prepared operation changed; Refresh and prepare again.")), nil
	}
	if err = validateDestination(r.Path); err != nil {
		return inspectWithError(r, err), nil
	}
	if err = os.MkdirAll(filepath.Dir(r.Path), 0755); err != nil {
		return inspectWithError(r, err), nil
	}
	if err = validateDestination(r.Path); err != nil {
		return inspectWithError(r, err), nil
	}
	args := []string{"switch", "--no-cd", "--no-hooks", "--format=json", "--path", r.Path}
	if r.Action == "new" {
		args = append(args, "--create", r.Name, "--base", r.Commit)
	} else if r.Remote {
		args = append(args, strings.TrimPrefix(r.Ref, "refs/remotes/"))
	} else {
		args = append(args, r.Name)
	}
	out, runErr := command(r.Project.Path, "wt", args...)
	// Worktrunk may emit its successful checkout before a later failure. Parse that
	// output even on nonzero exit; Git identity remains the authority for recovery.
	var wtResult map[string]any
	if len(bytes.TrimSpace(out)) > 0 && json.Unmarshal(out, &wtResult) != nil && runErr == nil {
		runErr = errors.New("Worktrunk returned invalid JSON; inspect the preserved checkout.")
	}
	result := inspect(r, false)
	if runErr != nil {
		result.Error = runErr.Error()
		if result.Kind == "absent" && (errors.Is(runErr, context.DeadlineExceeded) || errors.Is(runErr, exec.ErrWaitDelay)) {
			result.Kind = "partial"
			result.Error += "; Worktrunk completion is unconfirmed; inspect Git before retrying"
		}
		if result.Kind == "created" {
			result.Error += "; checkout preserved at " + r.Path
		}
	}
	return result, nil
}
func inspectWithError(r Request, err error) Result {
	result := inspect(r, false)
	if result.Error == "" {
		result.Error = err.Error()
	}
	return result
}

func programs(overrides []Program) []Program {
	stock := []Program{{Key: "shell", Name: "Shell", Run: []string{}}, {Key: "claude", Name: "Claude", Run: []string{"claude"}}, {Key: "pi", Name: "Pi", Run: []string{"pi"}}, {Key: "opencode", Name: "OpenCode", Run: []string{"opencode"}}, {Key: "codex", Name: "Codex", Run: []string{"codex", "--no-daemon"}}}
	for i := range stock {
		p := &stock[i]
		if p.Key == "shell" {
			p.Installed = true
			continue
		}
		for _, override := range overrides {
			if override.Key == p.Key {
				if clean(override.Name) {
					p.Name = override.Name
				}
				p.Run = override.Run
				break
			}
		}
		valid := len(p.Run) > 0
		for _, arg := range p.Run {
			if strings.ContainsRune(arg, 0) {
				valid = false
			}
		}
		if valid {
			path, err := exec.LookPath(p.Run[0])
			if err == nil {
				p.Installed = true
				p.Run = append([]string{path}, p.Run[1:]...)
			}
		}
		if p.Run == nil {
			p.Run = []string{}
		}
	}
	return stock
}
func launchProgram(launch Launch) (string, []string, error) {
	key := launch.Key
	if key == "" {
		key = "shell"
	}
	if key == "shell" {
		return key, []string{}, nil
	}
	for _, p := range programs(nil) {
		if p.Key == key {
			argv := p.Run
			if len(launch.Argv) > 0 {
				argv = launch.Argv
			}
			if len(argv) == 0 {
				return "", nil, errors.New(key + " is not installed.")
			}
			for _, arg := range argv {
				if strings.ContainsRune(arg, 0) {
					return "", nil, errors.New("Invalid program argument.")
				}
			}
			path, err := exec.LookPath(argv[0])
			if err != nil {
				return "", nil, errors.New(key + " is not installed.")
			}
			resolved := append([]string{path}, argv[1:]...)
			if key == "codex" {
				found := false
				for _, arg := range resolved[1:] {
					if arg == "--no-daemon" {
						found = true
					}
				}
				if !found {
					resolved = append(resolved, "--no-daemon")
				}
			}
			return key, resolved, nil
		}
	}
	return "", nil, errors.New("Unsupported program: " + key)
}

func core(method string, params any) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "hc", "connect")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err = cmd.Start(); err != nil {
		return nil, err
	}
	defer func() { _ = stdin.Close(); _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	if err = json.NewEncoder(stdin).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params}); err != nil {
		return nil, err
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), 8*1024*1024)
	for scanner.Scan() {
		var response struct {
			ID     int             `json:"id"`
			Result json.RawMessage `json:"result"`
			Error  *struct {
				Message string `json:"message"`
				Data    struct {
					Message string `json:"message"`
					Hint    string `json:"hint"`
				} `json:"data"`
			} `json:"error"`
		}
		if json.Unmarshal(scanner.Bytes(), &response) != nil {
			continue
		}
		if response.ID != 1 {
			continue
		}
		if response.Error != nil {
			message := response.Error.Data.Message
			if message == "" {
				message = response.Error.Message
			}
			return nil, fail("core_error", message, response.Error.Data.Hint)
		}
		return response.Result, nil
	}
	if ctx.Err() != nil {
		return nil, errors.New("Herdr core did not respond within 30 seconds.")
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	return nil, fmt.Errorf("Herdr core connection closed: %s", strings.TrimSpace(stderr.String()))
}

type terminal struct {
	Address    string `json:"address"`
	State      string `json:"state"`
	Cwd        string `json:"cwd"`
	Foreground struct {
		Cwd string `json:"cwd"`
	} `json:"foreground"`
	Labels map[string]string `json:"labels"`
}
type OpenResult struct {
	Path     string `json:"path"`
	Terminal string `json:"terminal"`
	Space    string `json:"space"`
	Tab      string `json:"tab"`
	Program  string `json:"program"`
}

func openCheckout(r Request) (OpenResult, error) {
	if err := preflight(r.CoreID); err != nil {
		return OpenResult{}, err
	}
	result := inspect(r, true)
	if result.Kind != "created" {
		return OpenResult{}, errors.New(result.Error)
	}
	key, argv, err := launchProgram(r.Launch)
	if err != nil {
		return OpenResult{}, err
	}
	data, err := core("terminal.list", map[string]any{})
	if err != nil {
		return OpenResult{}, err
	}
	var list struct {
		Terminals []terminal `json:"terminals"`
	}
	if err = json.Unmarshal(data, &list); err != nil {
		return OpenResult{}, err
	}
	start := func(cwd string, argv []string, labels map[string]string) (terminal, error) {
		data, err := core("terminal.run", map[string]any{"cwd": cwd, "argv": argv, "no_parent": true, "keep": true, "labels": labels})
		if err != nil {
			return terminal{}, fmt.Errorf("%w; checkout preserved at %s. Retry opening this checkout.", err, r.Path)
		}
		var t terminal
		if err = json.Unmarshal(data, &t); err != nil {
			return terminal{}, fmt.Errorf("%w; checkout preserved at %s", err, r.Path)
		}
		if t.Address == "" || strings.Contains(t.Address, "/") || t.State != "live" {
			return terminal{}, fmt.Errorf("Terminal did not stay running; checkout preserved at %s", r.Path)
		}
		return t, nil
	}
	space := ""
	tab := uuid()
	canonicalFound := r.Path == r.Project.Path
	var retry *OpenResult
	identities := map[string]Identity{}
	for _, t := range list.Terminals {
		if t.State != "live" || t.Address == "" || strings.Contains(t.Address, "/") {
			continue
		}
		cwd := t.Foreground.Cwd
		if cwd == "" {
			cwd = t.Cwd
		}
		if cwd == "" {
			continue
		}
		id, known := identities[cwd]
		if !known {
			id, _ = identity(cwd)
			identities[cwd] = id
		}
		if id.ID != r.Project.ID {
			continue
		}
		if id.Top == r.Project.Path && t.Labels["herdr.space"] != "" && t.Labels["herdr.tab"] != "" {
			canonicalFound = true
		}
		if id.Top != r.Path {
			continue
		}
		if r.Attempt != "" && t.Labels["herdr-worktree-launcher.attempt"] == r.Attempt && t.Labels["herdr-worktree-launcher.program"] == key {
			if t.Labels["herdr.space"] != "" && t.Labels["herdr.tab"] != "" {
				retry = &OpenResult{r.Path, t.Address, t.Labels["herdr.space"], t.Labels["herdr.tab"], key}
			}
		}
		if space == "" {
			space = t.Labels["herdr.space"]
		}
	}
	if !canonicalFound {
		_, err := start(r.Project.Path, []string{}, map[string]string{"herdr.space": uuid(), "herdr.tab": uuid(), "herdr-worktree-launcher.program": "shell"})
		if err != nil {
			return OpenResult{}, err
		}
	}
	if retry != nil {
		return *retry, nil
	}
	if space == "" {
		space = uuid()
	}
	labels := map[string]string{"herdr.space": space, "herdr.tab": tab, "herdr-worktree-launcher.program": key}
	if r.Attempt != "" {
		labels["herdr-worktree-launcher.attempt"] = r.Attempt
	}
	t, err := start(r.Path, argv, labels)
	if err != nil {
		return OpenResult{}, err
	}
	return OpenResult{r.Path, t.Address, space, tab, key}, nil
}

func validateRemote(p Project, remote string) error {
	if err := validateProject(p); err != nil {
		return err
	}
	text, err := git(p.Path, "remote")
	if err != nil {
		return err
	}
	valid := false
	for _, name := range strings.Fields(text) {
		if name == remote {
			valid = true
		}
	}
	if !valid {
		return errors.New("Select a configured Git remote.")
	}
	return nil
}
func fetch(p Project, remote string) ([]Ref, error) {
	if err := validateRemote(p, remote); err != nil {
		return nil, err
	}
	if _, err := git(p.Path, "fetch", "--no-tags", "--no-recurse-submodules", "--", remote); err != nil {
		return nil, err
	}
	return choices(p)
}

func api(in input) (any, error) {
	switch in.Operation {
	case "context":
		home, err := os.UserHomeDir()
		coreID, _ := runningCoreID()
		return map[string]any{"userHome": home, "protocol": 1, "machine": nil, "core_id": coreID}, err
	case "validateRoot":
		return validateRoot(in.Config.ProjectRoot)
	case "directories":
		root, err := validateRoot(in.Path)
		if err != nil {
			return nil, err
		}
		entries, err := os.ReadDir(root)
		if err != nil {
			return nil, err
		}
		rows := []map[string]string{}
		for _, entry := range entries {
			path := filepath.Join(root, entry.Name())
			info, err := os.Stat(path)
			if err == nil && info.IsDir() && clean(path) {
				rows = append(rows, map[string]string{"path": path, "label": entry.Name()})
			}
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i]["label"] < rows[j]["label"] })
		if filepath.Dir(root) != root {
			rows = append([]map[string]string{{"path": filepath.Dir(root), "label": ".. (Parent directory)"}}, rows...)
		}
		return map[string]any{"path": root, "entries": rows}, nil
	case "discover":
		return discover(in.Config.ProjectRoot)
	case "project":
		return project(in.Path, "")
	case "selection":
		p, err := project(in.Path, "")
		if err != nil {
			return nil, err
		}
		ref, err := git(in.Path, "symbolic-ref", "--quiet", "HEAD")
		var exit *exec.ExitError
		if err != nil && (!errors.As(err, &exit) || exit.ExitCode() != 1) {
			return nil, err
		}
		return map[string]any{"project": p, "ref": ref}, nil
	case "identity":
		return identity(in.Path)
	case "identities":
		out := map[string]Identity{}
		for _, path := range in.Paths {
			if !clean(path) {
				continue
			}
			if id, err := identity(path); err == nil {
				out[path] = id
			}
		}
		return out, nil
	case "choices":
		return choices(in.Project)
	case "remotes":
		if err := validateProject(in.Project); err != nil {
			return nil, err
		}
		text, err := git(in.Project.Path, "remote")
		rows := []map[string]string{}
		for _, name := range strings.Fields(text) {
			rows = append(rows, map[string]string{"name": name, "label": name})
		}
		return rows, err
	case "fetch":
		return fetch(in.Project, in.Remote)
	case "destination":
		return destination(in.Project, in.Name)
	case "prepare":
		return prepare(in)
	case "create":
		return create(in.Request)
	case "inspect":
		return inspect(in.Request, in.Recover), nil
	case "open":
		return openCheckout(in.Request)
	case "programs":
		return programs(in.Agents), nil
	default:
		return nil, errors.New("Unknown API operation: " + in.Operation)
	}
}
func selectRef(refs []Ref, text string) (Ref, error) {
	for _, r := range refs {
		if r.Ref == text || r.Kind == "local" && r.Name == text || r.Kind == "remote" && fmt.Sprint(r.Source)+"/"+r.Name == text {
			return r, nil
		}
	}
	matches := []Ref{}
	for _, r := range refs {
		if r.Name == text {
			matches = append(matches, r)
		}
	}
	if len(matches) == 1 {
		return matches[0], nil
	}
	if len(matches) > 1 {
		return Ref{}, fmt.Errorf("Branch %s is ambiguous. Include its remote name.", text)
	}
	return Ref{}, fmt.Errorf("Branch %s is unavailable. Fetch it, then retry.", text)
}
func isTerminal(file *os.File) bool {
	info, err := file.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}
func run(args []string) (any, bool, error) {
	values := map[string]string{}
	flags := map[string]bool{}
	positionals := []string{}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if strings.HasPrefix(arg, "--") {
			key, value, has := strings.Cut(strings.TrimPrefix(arg, "--"), "=")
			switch key {
			case "help", "skill", "version", "json", "attach", "dry-run":
				if has {
					return nil, false, fmt.Errorf("Option --%s takes no value", key)
				}
				flags[key] = true
			case "checkout", "base", "execute", "request", "fetch":
				if !has {
					i++
					if i >= len(args) {
						return nil, false, fmt.Errorf("Missing value for --%s", key)
					}
					value = args[i]
				}
				values[key] = value
			default:
				return nil, false, fmt.Errorf("Unknown option: --%s", key)
			}
		} else if arg == "-h" {
			flags["help"] = true
		} else if strings.HasPrefix(arg, "-") {
			return nil, false, fmt.Errorf("Unknown option: %s", arg)
		} else {
			positionals = append(positionals, arg)
		}
	}
	if flags["help"] {
		fmt.Print(help)
		return nil, false, nil
	}
	if flags["skill"] {
		fmt.Print(skill)
		return nil, false, nil
	}
	if flags["version"] {
		fmt.Println("herdr-worktree-launcher 1.0.0")
		return nil, false, nil
	}
	isAPI := len(positionals) > 0 && positionals[0] == "api"
	if isAPI {
		if flags["dry-run"] {
			return nil, true, errors.New("--dry-run applies only to new and open commands, not API operations.")
		}
		if _, ok := values["fetch"]; ok {
			return nil, true, errors.New("For API requests, use the fetch operation before prepare/create.")
		}
		if len(positionals) != 1 || values["request"] == "" {
			return nil, true, errors.New("Usage: herdr-worktree-launcher api --request '<JSON>'")
		}
		var in input
		if err := json.Unmarshal([]byte(values["request"]), &in); err != nil {
			return nil, true, err
		}
		result, err := api(in)
		return result, true, err
	}
	jsonOutput := flags["json"]
	if flags["attach"] && (jsonOutput || !isTerminal(os.Stdin)) {
		return nil, jsonOutput, errors.New("--attach requires an interactive terminal without --json.")
	}
	interactive := len(positionals) == 0 && isTerminal(os.Stdin) && !jsonOutput
	if len(positionals) > 2 || len(positionals) == 0 && !interactive {
		return nil, jsonOutput, errors.New(help)
	}
	reader := bufio.NewReader(os.Stdin)
	ask := func(label, fallback string) (string, error) {
		if !isTerminal(os.Stdin) || jsonOutput {
			return "", fmt.Errorf("%s Supply it as an argument.", label)
		}
		fmt.Fprint(os.Stderr, label)
		if fallback != "" {
			fmt.Fprintf(os.Stderr, " [%s]", fallback)
		}
		fmt.Fprint(os.Stderr, ": ")
		line, err := reader.ReadString('\n')
		if err != nil {
			return "", err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			line = fallback
		}
		return line, nil
	}
	var err error
	checkout, explicitCheckout := values["checkout"]
	if explicitCheckout && checkout == "" {
		return nil, jsonOutput, errors.New("--checkout PATH requires a nonempty path.")
	}
	if !explicitCheckout {
		checkout, err = os.Getwd()
		if err != nil {
			return nil, jsonOutput, err
		}
	}
	if interactive && !explicitCheckout {
		checkout, err = ask("Checkout path", checkout)
		if err != nil {
			return nil, jsonOutput, err
		}
	}
	action := ""
	name := ""
	if len(positionals) > 0 {
		action = positionals[0]
	} else {
		action, err = ask("Action (new/open)", "new")
		if err != nil {
			return nil, jsonOutput, err
		}
	}
	if action != "new" && action != "open" {
		return nil, jsonOutput, errors.New("Choose new or open.")
	}
	if action == "open" && values["base"] != "" {
		return nil, jsonOutput, errors.New("--base applies only to new branches.")
	}
	if len(positionals) > 1 {
		name = positionals[1]
	} else {
		name, err = ask("Branch", "")
		if err != nil {
			return nil, jsonOutput, err
		}
	}
	if name == "" {
		return nil, jsonOutput, errors.New("Supply a branch name.")
	}
	if flags["dry-run"] {
		err = dependencies()
	} else {
		err = preflight("")
	}
	if err != nil {
		return nil, jsonOutput, err
	}
	p, err := project(checkout, "")
	if err != nil {
		return nil, jsonOutput, err
	}
	var refs []Ref
	if remote, requested := values["fetch"]; requested {
		if flags["dry-run"] {
			if err = validateRemote(p, remote); err == nil {
				refs, err = choices(p)
			}
		} else {
			refs, err = fetch(p, remote)
		}
	} else {
		refs, err = choices(p)
	}
	if err != nil {
		return nil, jsonOutput, err
	}
	base := values["base"]
	if action == "new" && base == "" {
		base, err = git(checkout, "symbolic-ref", "--quiet", "HEAD")
		if err != nil {
			return nil, jsonOutput, errors.New("Selected checkout is detached. Supply --base.")
		}
		if interactive {
			base, err = ask("Base branch", strings.TrimPrefix(base, "refs/heads/"))
			if err != nil {
				return nil, jsonOutput, err
			}
		}
	}
	key := values["execute"]
	if key == "" {
		key = "shell"
		if interactive {
			available := []string{}
			for _, p := range programs(nil) {
				if p.Installed {
					available = append(available, p.Key)
				}
			}
			key, err = ask("Program ("+strings.Join(available, ", ")+")", key)
			if err != nil {
				return nil, jsonOutput, err
			}
		}
	}
	_, argv, err := launchProgram(Launch{Key: key})
	if err != nil {
		return nil, jsonOutput, err
	}
	selected, err := selectRef(refs, func() string {
		if action == "new" {
			return base
		}
		return name
	}())
	if err != nil {
		if flags["dry-run"] && values["fetch"] != "" {
			return nil, jsonOutput, fmt.Errorf("%w Dry-run did not fetch; branch checks use current local refs.", err)
		}
		return nil, jsonOutput, err
	}
	in := input{Project: p, Action: "existing", Ref: selected.Ref, Checkout: selected.Checkout}
	if action == "new" {
		in.Action = "new"
		in.Name = name
		in.Checkout = nil
	}
	r, err := prepare(in)
	if err != nil {
		return nil, jsonOutput, err
	}
	r.Launch = Launch{Key: key, Label: key, Argv: argv}
	if flags["dry-run"] {
		id, err := identity(checkout)
		if err != nil {
			return nil, jsonOutput, err
		}
		worktreeAction := "create"
		if r.Reuse {
			worktreeAction = "reuse"
		}
		plan := map[string]any{
			"dry_run": true, "checkout": id.Top, "project": p.Path, "action": action,
			"branch": r.Name, "ref": r.Ref, "commit": r.Commit, "path": r.Path,
			"worktree_action": worktreeAction, "program": key, "argv": argv,
			"fetch": values["fetch"], "refs_state": "local", "session_action": "new_terminal_and_tab",
			"space_action": "reuse_matching_or_create", "ensure_primary_space": r.Path != p.Path, "core_checked": false, "attach": flags["attach"],
		}
		if jsonOutput {
			return plan, true, nil
		}
		fmt.Printf("Dry run (no changes)\nCheckout: %s\nProject: %s\nAction: %s\nBranch: %s\nSource: %s (%s)\nWorktree: %s %s\nProgram: %s %q\n", id.Top, p.Path, action, r.Name, r.Ref, r.Commit, worktreeAction, r.Path, key, argv)
		if remote := values["fetch"]; remote != "" {
			fmt.Printf("Fetch: would fetch %s before resolving branches; this preview uses current local refs.\n", remote)
		}
		fmt.Println("Session: open a fresh terminal and tab; reuse a matching checkout space or create one.")
		if r.Path != p.Path {
			fmt.Printf("Primary space: ensure a shell space for %s.\n", p.Path)
		}
		if flags["attach"] {
			fmt.Println("Attach: attach this terminal after opening the session.")
		}
		fmt.Println("Core: not contacted; a real run requires HC_SOCKET or HC_SESSION and a running core.")
		return nil, false, nil
	}
	r.Attempt = uuid()
	result, err := create(r)
	if err != nil {
		return nil, jsonOutput, err
	}
	if result.Kind != "created" || result.Error != "" {
		return nil, jsonOutput, fmt.Errorf("%s; checkout preserved if present at %s. Inspect Git before retrying.", result.Error, result.Path)
	}
	opened, err := openCheckout(r)
	if err != nil {
		return nil, jsonOutput, err
	}
	if jsonOutput {
		return opened, true, nil
	}
	fmt.Printf("Worktree: %s\nTerminal: %s\nAttach: hc attach %s\n", opened.Path, opened.Terminal, opened.Terminal)
	if flags["attach"] {
		cmd := exec.Command("hc", "attach", opened.Terminal)
		cmd.Stdin = os.Stdin
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err = cmd.Run(); err != nil {
			return nil, false, err
		}
	}
	return nil, false, nil
}
func main() {
	result, jsonOutput, err := run(os.Args[1:])
	if err != nil {
		var detail *failure
		if !errors.As(err, &detail) {
			detail = &failure{"operation_failed", err.Error(), ""}
		} else {
			detail = &failure{detail.Kind, err.Error(), detail.Hint}
		}
		if jsonOutput || len(os.Args) > 1 && os.Args[1] == "api" {
			_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"error": detail})
		}
		fmt.Fprintln(os.Stderr, detail.Message)
		if detail.Hint != "" {
			fmt.Fprintln(os.Stderr, detail.Hint)
		}
		os.Exit(1)
	}
	if jsonOutput {
		_ = json.NewEncoder(os.Stdout).Encode(result)
	}
}
