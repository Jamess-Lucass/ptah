package executor

import "time"

type LanguageConfig struct {
	Image       string
	FileName    string
	RunCommand  []string
	Timeout     time.Duration
	MemoryLimit int64
	CPULimit    int64
}

var Languages = map[string]LanguageConfig{
	"javascript": {
		Image:       "node:20-alpine",
		FileName:    "main.js",
		RunCommand:  []string{"node", "/sandbox/main.js"},
		Timeout:     30 * time.Second,
		MemoryLimit: 128 * 1024 * 1024, // 128MB
		CPULimit:    500_000_000,       // 0.5 CPU
	},
	"go": {
		Image:       "golang:1.25-alpine",
		FileName:    "main.go",
		RunCommand:  []string{"go", "run", "/sandbox/main.go"},
		Timeout:     60 * time.Second,
		MemoryLimit: 256 * 1024 * 1024, // 256MB
		CPULimit:    500_000_000,       // 0.5 CPU
	},
	"typescript": {
		Image:       "oven/bun:alpine",
		FileName:    "main.ts",
		RunCommand:  []string{"bun", "run", "/sandbox/main.ts"},
		Timeout:     30 * time.Second,
		MemoryLimit: 128 * 1024 * 1024, // 128MB
		CPULimit:    500_000_000,       // 0.5 CPU
	},
	"csharp": {
		Image:       "mcr.microsoft.com/dotnet/sdk:10.0",
		FileName:    "Program.cs",
		RunCommand:  []string{"dotnet", "run", "--property:NuGetAudit=false", "/sandbox/Program.cs"},
		Timeout:     60 * time.Second,
		MemoryLimit: 512 * 1024 * 1024, // 512MB
		CPULimit:    500_000_000,       // 0.5 CPU
	},
}
