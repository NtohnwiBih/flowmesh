package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/redis/go-redis/v9"
)

func main() {
	ctx, cancel :=context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	checks := []struct {
		name string
		fn func(context.Context) error
	}{
		{"postgres", checkPostgres},
		{"redis", checkRedis},
		{"minio", checkMinio},
	}

	for _, c := range checks {
		if err := c.fn(ctx); err != nil {
			log.Fatalf("Fail %s: %v", c.name, err)
		}
		fmt.Printf("OK %s\n", c.name)
	}
}

func checkPostgres(ctx context.Context) error {
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer pool.Close()

	var n int
	err = pool.QueryRow(ctx, "SELECT count(*) FROM workspaces").Scan(&n)
	return err // proves the migration ran
}

func checkRedis(ctx context.Context) error {
	rdb := redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})
	defer rdb.Close()
	return rdb.Ping(ctx).Err()
}

func checkMinio(ctx context.Context) error {
	client, err := minio.New(os.Getenv("MINIO_ENDPOINT"), &minio.Options{
		Creds: credentials.NewStaticV4(os.Getenv("MINIO_ROOT_USER"), os.Getenv("MINIO_ROOT_PASSWORD"), ""),
		Secure: false,
	})
	if err != nil {
		return err
	}
	bucket := os.Getenv("MINIO_BUCKET")
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return err
	}
	if !exists {
		return client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{})
	}
	return nil
}