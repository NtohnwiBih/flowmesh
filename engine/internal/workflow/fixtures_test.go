package workflow

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSharedFixtures(t *testing.T) {
	for _, tc := range []struct {
		dir string
		ok  bool
	}{{"valid", true}, {"invalid", false}} {
		files, err := filepath.Glob(filepath.Join("..", "..", "..", "schemas", "fixtures", tc.dir, "*.json"))
		if err != nil || len(files) == 0 {
			t.Fatalf("no %s fixtures found (err=%v)", tc.dir, err)
		}
		for _, f := range files {
			t.Run(tc.dir+"/"+filepath.Base(f), func(t *testing.T) {
				data, err := os.ReadFile(f)
				if err != nil {
					t.Fatal(err)
				}
				_, err = Parse(data)
				if tc.ok && err != nil {
					t.Fatalf("should be valid, got: %v", err)
				}
				if !tc.ok && err == nil {
					t.Fatal("should be rejected, but was accepted")
				}
			})
		}
	}
}