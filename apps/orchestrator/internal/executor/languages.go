package executor

import "time"

type LanguageConfig struct {
	Name           string
	Image          string
	CompileCommand []string
	FileName       string
	RunCommand     []string
	Timeout        time.Duration
	MemoryLimit    int64
	CPULimit       int64
}

var Languages = map[string]LanguageConfig{
	"javascript": {
		Name:           "javascript",
		Image:          "node:20-alpine",
		CompileCommand: nil,
		FileName:       "main.js",
		RunCommand:     []string{"node", "/sandbox/main.js"},
		Timeout:        15 * time.Second,
		MemoryLimit:    128 * 1024 * 1024, // 128MB
		CPULimit:       500_000_000,       // 0.5 CPU
	},
	"go": {
		Name:           "go",
		Image:          "golang:1.25-alpine",
		CompileCommand: []string{"go", "build", "-o", "/sandbox/main", "/sandbox/main.go"},
		FileName:       "main.go",
		RunCommand:     []string{"sh", "-c", "go build -o /sandbox/main /sandbox/main.go && /sandbox/main"},
		Timeout:        15 * time.Second,
		MemoryLimit:    256 * 1024 * 1024, // 256MB
		CPULimit:       500_000_000,       // 0.5 CPU
	},
}
