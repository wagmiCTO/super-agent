package envfile

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseLine(t *testing.T) {
	tests := []struct {
		name      string
		in        string
		key, want string
		ok        bool
	}{
		{"plain", "FOO=bar", "FOO", "bar", true},
		{"spaces around equals", "FOO = bar", "FOO", "bar", true},
		{"export prefix", "export FOO=bar", "FOO", "bar", true},
		{"double quoted", `FOO="bar baz"`, "FOO", "bar baz", true},
		{"single quoted", "FOO='bar baz'", "FOO", "bar baz", true},
		{"empty value", "FOO=", "FOO", "", true},
		{"hex secret keeps 0x", "K=0xdeadbeef", "K", "0xdeadbeef", true},
		{"hash is kept, it may be part of a secret", "K=ab#cd", "K", "ab#cd", true},
		{"comment", "# a comment", "", "", false},
		{"blank", "   ", "", "", false},
		{"malformed", "NOEQUALS", "", "", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			key, value, ok := parseLine(tc.in)
			if ok != tc.ok || key != tc.key || value != tc.want {
				t.Errorf("parseLine(%q) = (%q, %q, %v), want (%q, %q, %v)",
					tc.in, key, value, ok, tc.key, tc.want, tc.ok)
			}
		})
	}
}

// The real environment must win, so a deployment is never overridden by a
// stray file and a one-off override on the command line works.
func TestExistingEnvironmentWins(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("ENVFILE_A=from-file\nENVFILE_B=from-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ENVFILE_A", "from-environment")

	if err := Load(path); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got := os.Getenv("ENVFILE_A"); got != "from-environment" {
		t.Errorf("ENVFILE_A = %q, want the environment value", got)
	}
	if got := os.Getenv("ENVFILE_B"); got != "from-file" {
		t.Errorf("ENVFILE_B = %q, want the file value", got)
	}
	os.Unsetenv("ENVFILE_B")
}

func TestMissingFileIsNotAnError(t *testing.T) {
	if err := Load(filepath.Join(t.TempDir(), "absent")); err != nil {
		t.Errorf("Load of a missing file returned %v, want nil", err)
	}
}
