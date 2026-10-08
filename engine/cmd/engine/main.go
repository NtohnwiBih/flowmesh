package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/NtohnwiBih/flowmesh/engine/internal/dispatch"
	"github.com/NtohnwiBih/flowmesh/engine/internal/eventstore"
	"github.com/NtohnwiBih/flowmesh/engine/internal/runner"
)

func main() {
	if err := run(); err != nil {
		slog.Error("engine stopped with error", "err", err)
		os.Exit(1)
	}
	slog.Info("engine stopped")
}

// run holds the real logic. os.Exit skips deferred calls, so main only
// calls it and exits afterwards, letting run's defers fire first.
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL is required")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("postgres ping: %w", err)
	}

	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "localhost:6379"
	}
	rdb := redis.NewClient(&redis.Options{Addr: addr})
	defer rdb.Close()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}

	r := runner.New(
		eventstore.New(pool),
		dispatch.New(rdb),
		runner.PGRepo{Pool: pool},
		envDuration("TICK", 500*time.Millisecond),
	)
	slog.Info("engine started", "redis", addr)
	return r.Run(ctx)
}

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