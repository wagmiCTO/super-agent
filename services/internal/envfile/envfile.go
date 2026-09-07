// Package envfile loads a .env file into the process environment.
//
// It exists so a developer can keep credentials in services/.env instead of
// exporting them by hand, without the file ever becoming a config format:
// anything already set in the real environment wins, so a deployment is
// configured the ordinary way and the file is a local convenience only.
package envfile

import (
	"bufio"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Load reads the named file and sets any variable that is not already present
// in the environment. A missing file is not an error — running without one is
// the normal case in anything but local development.
func Load(path string) error {
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("envfile: open %s: %w", path, err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for line := 1; scanner.Scan(); line++ {
		key, value, ok := parseLine(scanner.Text())
		if !ok {
			continue
		}
		if key == "" {
			return fmt.Errorf("envfile: %s:%d: malformed line", path, line)
		}
		if _, set := os.LookupEnv(key); set {
			continue
		}
		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("envfile: set %s: %w", key, err)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("envfile: read %s: %w", path, err)
	}
	return nil
}

// LoadNearest walks up from the working directory looking for a .env, so a
// command works the same whether it is run from the module root or from its
// own directory. It stops at the first one found, and at the filesystem root.
func LoadNearest(name string) error {
	dir, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("envfile: %w", err)
	}
	for {
		candidate := filepath.Join(dir, name)
		if _, err := os.Stat(candidate); err == nil {
			return Load(candidate)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return nil
		}
		dir = parent
	}
}

// parseLine splits one line into a key and value. It reports ok=false for
// blanks and comments, which are skipped, and key=="" for a malformed line.
func parseLine(raw string) (key, value string, ok bool) {
	line := strings.TrimSpace(raw)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false
	}
	line = strings.TrimPrefix(line, "export ")

	key, value, found := strings.Cut(line, "=")
	if !found {
		return "", "", true
	}
	key = strings.TrimSpace(key)
	value = strings.TrimSpace(value)

	// Strip one layer of matching quotes; an unquoted value keeps any inline
	// comment, because a secret may legitimately contain a '#'.
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			value = value[1 : len(value)-1]
		}
	}
	return key, value, true
}
