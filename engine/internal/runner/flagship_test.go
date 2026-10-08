package runner

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/NtohnwiBih/flowmesh/engine/internal/eventstore"
)

// stepServer is the "external API". It counts requests per step and records
// the idempotency key of each. Step3's FIRST request hangs until released.
type stepServer struct {
	mu        sync.Mutex
	hits      map[string]int
	keys      map[string][]string
	step3Hung chan struct{} // closed when step3's first request arrives
	release   chan struct{} // closed to let the hung request go
	once      sync.Once
}

func newStepServer() *stepServer {
	return &stepServer{
		hits:      map[string]int{},
		keys:      map[string][]string{},
		step3Hung: make(chan struct{}),
		release:   make(chan struct{}),
	}
}

func (s *stepServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	step := strings.TrimPrefix(r.URL.Path, "/")

	s.mu.Lock()
	s.hits[step]++
	n := s.hits[step]
	s.keys[step] = append(s.keys[step], r.Header.Get("X-Idempotency-Key"))
	s.mu.Unlock()

	if step == "step3" && n == 1 {
		s.once.Do(func() { close(s.step3Hung) })
		select {
		case <-s.release: // test finished
		case <-r.Context().Done(): // the killed worker's connection dropped
		}
		return
	}
	fmt.Fprint(w, "ok")
}

func (s *stepServer) count(step string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hits[step]
}

func (s *stepServer) keysFor(step string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.keys[step]...)
}

// buildWorker compiles cmd/worker into a temp dir and returns the path.
func buildWorker(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "worker")
	cmd := exec.Command("go", "build", "-o", bin, "../../cmd/worker")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build worker: %v\n%s", err, out)
	}
	return bin
}

// startWorkerProcess launches the worker binary as a real OS process.
func startWorkerProcess(t *testing.T, bin, redisAddr string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(bin)
	cmd.Env = append(os.Environ(),
		"REDIS_ADDR="+redisAddr,
		"LEASE_TTL=1s",
		"HEARTBEAT_EVERY=200ms",
	)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("start worker process: %v", err)
	}
	t.Cleanup(func() { // safety net: never leave stray processes
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	})
	return cmd
}

func TestExecutionRecoversAfterWorkerFailure(t *testing.T) {
	d := fresh(t)
	api := newStepServer()
	srv := httptest.NewServer(api)
	defer srv.Close()
	defer close(api.release) // runs before srv.Close (LIFO): frees any hung handler

	// Five HTTP steps in a chain. Step 3 may be retried (it is the risky one).
	step := func(id string, retry bool) string {
		r := ""
		if retry {
			r = `,"retry":{"max_attempts":3,"backoff_seconds":0}`
		}
		return fmt.Sprintf(`{"id":%q,"type":"http","config":{"method":"POST","url":%q}%s}`,
			id, srv.URL+"/"+id, r)
	}
	def := `{"schema_version":1,"nodes":[` +
		step("step1", false) + "," + step("step2", false) + "," + step("step3", true) + "," +
		step("step4", false) + "," + step("step5", false) +
		`],"edges":[{"from":"step1","to":"step2"},{"from":"step2","to":"step3"},` +
		`{"from":"step3","to":"step4"},{"from":"step4","to":"step5"}]}`
	execID := seedExecution(t, def)

	redisAddr := rdb.Options().Addr
	bin := buildWorker(t)

	startRunner(t, d)
	victim := startWorkerProcess(t, bin, redisAddr)

	// Wait until step 3 is genuinely in flight inside the victim.
	select {
	case <-api.step3Hung:
	case <-time.After(15 * time.Second):
		t.Fatal("step 3 never started")
	}

	// The crash: SIGKILL cannot be caught, so there is no cleanup of any kind.
	if err := victim.Process.Signal(syscall.SIGKILL); err != nil {
		t.Fatalf("kill: %v", err)
	}
	_, _ = victim.Process.Wait()

	// Recovery: a fresh worker process takes over.
	startWorkerProcess(t, bin, redisAddr)
	waitStatus(t, execID, "COMPLETED", 30*time.Second)

	// ---- Assertions: the expected outcome from the SRS ----

	// Zero duplicate side effects for the steps that finished before the crash.
	for _, s := range []string{"step1", "step2", "step4", "step5"} {
		if n := api.count(s); n != 1 {
			t.Errorf("%s hit the API %d times, want exactly 1", s, n)
		}
	}
	// Step 3 was attempted twice, and both requests carried the SAME key.
	if n := api.count("step3"); n != 2 {
		t.Errorf("step3 hit the API %d times, want 2", n)
	}
	if k := api.keysFor("step3"); len(k) == 2 && (k[0] == "" || k[0] != k[1]) {
		t.Errorf("step3 idempotency keys must match and be non-empty: %v", k)
	}

	// The event timeline tells the whole story.
	evs := loadEvents(t, execID)
	for _, want := range []struct {
		typ     string
		node    string
		attempt int
	}{
		{eventstore.EventNodeCompleted, "step1", 1},
		{eventstore.EventNodeCompleted, "step2", 1},
		{eventstore.EventNodeScheduled, "step3", 1},
		{eventstore.EventNodeFailed, "step3", 1}, // lease expired
		{eventstore.EventNodeScheduled, "step3", 2},
		{eventstore.EventNodeCompleted, "step3", 2},
		{eventstore.EventNodeCompleted, "step4", 1},
		{eventstore.EventNodeCompleted, "step5", 1},
	} {
		if !has(evs, want.typ, want.node, want.attempt) {
			t.Errorf("timeline is missing %s %s attempt %d", want.typ, want.node, want.attempt)
		}
	}
	if last := evs[len(evs)-1]; last.Type != eventstore.EventExecutionCompleted {
		t.Errorf("last event = %s, want EXECUTION_COMPLETED", last.Type)
	}
}