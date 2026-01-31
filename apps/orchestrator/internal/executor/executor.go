package executor

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

type Executor struct {
	docker *client.Client
}

func New(docker *client.Client) *Executor {
	return &Executor{docker: docker}
}

type EmitFunc func(stream, data string)

func (e *Executor) Execute(ctx context.Context, lang LanguageConfig, code string, emit EmitFunc) error {
	ctx, cancel := context.WithTimeout(ctx, lang.Timeout)
	defer cancel()

	if err := e.ensureImage(ctx, lang.Image); err != nil {
		return fmt.Errorf("image pull failed: %w", err)
	}

	tmpDir, cleanup, err := e.writeCode(lang.FileName, code)
	if err != nil {
		return fmt.Errorf("failed to write code: %w", err)
	}
	defer cleanup()

	// Compile phase (if needed)
	if len(lang.CompileCommand) > 0 {
		emit("status", "compiling")
		exitCode, err := e.runContainer(ctx, lang, tmpDir, lang.CompileCommand, emit)
		if err != nil {
			return fmt.Errorf("compile container failed: %w", err)
		}
		if exitCode != 0 {
			emit("status", fmt.Sprintf("compile-failed:%d", exitCode))
			return nil
		}
	}

	// Run phase
	emit("status", "running")
	exitCode, err := e.runContainer(ctx, lang, tmpDir, lang.RunCommand, emit)
	if err != nil {
		return fmt.Errorf("run container failed: %w", err)
	}
	emit("status", fmt.Sprintf("exit:%d", exitCode))

	return nil
}

// runContainer creates, starts, streams, and waits for a container to finish.
func (e *Executor) runContainer(ctx context.Context, lang LanguageConfig, tmpDir string, cmd []string, emit EmitFunc) (int64, error) {
	containerID, err := e.createContainer(ctx, lang, tmpDir, cmd)
	if err != nil {
		return -1, err
	}
	defer e.removeContainer(containerID)

	if err := e.docker.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
		return -1, err
	}

	e.streamLogs(ctx, containerID, emit)
	return e.waitForExit(ctx, containerID), nil
}

func (e *Executor) ensureImage(ctx context.Context, img string) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	images, err := e.docker.ImageList(ctx, image.ListOptions{
		Filters: filters.NewArgs(filters.Arg("reference", img)),
	})
	if err != nil {
		return err
	}
	if len(images) > 0 {
		return nil
	}

	slog.Info("pulling image", "image", img)
	r, err := e.docker.ImagePull(ctx, img, image.PullOptions{})
	if err != nil {
		return err
	}
	defer r.Close()
	io.Copy(io.Discard, r)
	return nil
}

func (e *Executor) writeCode(filename, code string) (dir string, cleanup func(), err error) {
	tmpDir, err := os.MkdirTemp("", "sandbox-")
	if err != nil {
		return "", nil, err
	}

	codePath := filepath.Join(tmpDir, filename)
	if err := os.WriteFile(codePath, []byte(code), 0444); err != nil {
		os.RemoveAll(tmpDir)
		return "", nil, err
	}

	return tmpDir, func() { os.RemoveAll(tmpDir) }, nil
}

func (e *Executor) createContainer(ctx context.Context, lang LanguageConfig, tmpDir string, cmd []string) (string, error) {
	cont, err := e.docker.ContainerCreate(ctx,
		&container.Config{
			Image:           lang.Image,
			Cmd:             cmd,
			WorkingDir:      "/sandbox",
			NetworkDisabled: true,
			AttachStdout:    true,
			AttachStderr:    true,
			Tty:             false,
		},
		&container.HostConfig{
			Binds:       []string{tmpDir + ":/sandbox"},
			NetworkMode: "none",
			Resources: container.Resources{
				Memory:     lang.MemoryLimit,
				MemorySwap: lang.MemoryLimit,
				NanoCPUs:   lang.CPULimit,
			},
			AutoRemove: false,
		},
		nil,
		nil,
		"",
	)
	if err != nil {
		return "", err
	}

	return cont.ID, nil
}

func (e *Executor) removeContainer(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := e.docker.ContainerRemove(ctx, id, container.RemoveOptions{Force: true}); err != nil {
		slog.Warn("failed to remove container", "id", id[:12], "error", err)
	}
}

func (e *Executor) streamLogs(ctx context.Context, containerID string, emit EmitFunc) {
	logs, err := e.docker.ContainerLogs(ctx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
		Timestamps: false,
	})
	if err != nil {
		emit("error", fmt.Sprintf("logs failed: %v", err))
		return
	}
	defer logs.Close()

	stdoutR, stdoutW := io.Pipe()
	stderrR, stderrW := io.Pipe()

	go func() {
		defer stdoutW.Close()
		defer stderrW.Close()
		stdcopy.StdCopy(stdoutW, stderrW, logs)
	}()

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdoutR)
		for scanner.Scan() {
			emit("stdout", scanner.Text())
		}
	}()

	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderrR)
		for scanner.Scan() {
			emit("stderr", scanner.Text())
		}
	}()

	wg.Wait()
}

func (e *Executor) waitForExit(ctx context.Context, containerID string) int64 {
	statusCh, errCh := e.docker.ContainerWait(ctx, containerID, container.WaitConditionNotRunning)

	select {
	case err := <-errCh:
		if err != nil {
			slog.Warn("container wait error", "error", err)
		}
		return -1
	case status := <-statusCh:
		return status.StatusCode
	case <-ctx.Done():
		return -1
	}
}
