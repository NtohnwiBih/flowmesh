package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/NtohnwiBih/flowmesh/engine/internal/dispatch"
	"github.com/NtohnwiBih/flowmesh/engine/internal/worker"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "localhost:6379"
	}
	rdb := redis.NewClient(&redis.Options{Addr: addr})
	defer rdb.Close()

	host, _ := os.Hostname()
	id := fmt.Sprintf("%s-%d", host, os.Getpid())

	cfg := worker.Config{
		ID:             id,
		Queue:          "http",
		Handler:        worker.HTTPHandler(nil),
		LeaseTTL:       envDuration("LEASE_TTL", 0),
		HeartbeatEvery: envDuration("HEARTBEAT_EVERY", 0),
	}
	w, err := worker.New(dispatch.New(rdb), cfg)
	if err != nil {
		slog.Error("setup failed", "err", err)
		os.Exit(1)
	}

	slog.Info("worker started", "id", id, "queue", cfg.Queue)
	_ = w.Run(ctx)
	slog.Info("worker stopped")
}

// envDuration reads a Go duration like "1s" or "300ms" from the environment.
// A missing or invalid value returns def (0 means "use the worker default").
func envDuration(name string, def time.Duration) time.Duration {
	v := os.Getenv(name)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		slog.Warn("ignoring invalid duration", "name", name, "value", v)
		return def
	}
	return d
}