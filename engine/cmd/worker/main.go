package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

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

	w, err := worker.New(dispatch.New(rdb), worker.Config{
		ID:      id,
		Queue:   "http",
		Handler: worker.HTTPHandler(nil),
	})
	if err != nil {
		slog.Error("setup failed", "err", err)
		os.Exit(1)
	}

	slog.Info("worker started", "id", id, "queue", "http")
	_ = w.Run(ctx)
	slog.Info("worker stopped")
}