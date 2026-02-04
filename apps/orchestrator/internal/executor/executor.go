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

	"github.com/Jamess-Lucass/ptah/apps/orchestrator/internal/job"
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

func (e *Executor) Execute(ctx context.Context, lang LanguageConfig, code string, emit job.OutputFunc) error {
	ctx, cancel := context.WithTimeout(ctx, lang.Timeout)
	defer cancel()

	slog.Info("checking image")

	if err := e.ensureImage(ctx, lang.Image); err != nil {
		return fmt.Errorf("image pull failed: %w", err)
	}

	slog.Info("starting execution", "language", lang.Image)

	tmpDir, cleanup, err := e.writeCode(lang.FileName, code)
	if err != nil {
		return fmt.Errorf("failed to write code: %w", err)
	}
	defer cleanup()

	emit("status", "running")
	exitCode, err := e.runContainer(ctx, lang, tmpDir, lang.RunCommand, emit)
	if err != nil {
		return fmt.Errorf("container failed: %w", err)
	}
	emit("status", fmt.Sprintf("exit:%d", exitCode))

	return nil
}

// runContainer creates, starts, streams, and waits for a container to finish.
func (e *Executor) runContainer(ctx context.Context, lang LanguageConfig, tmpDir string, cmd []string, emit job.OutputFunc) (int64, error) {
	slog.Info("creating container", "image", lang.Image)
	containerID, err := e.createContainer(ctx, lang, tmpDir, cmd)
	if err != nil {
		return -1, err
	}
	defer e.removeContainer(containerID)

	slog.Info("starting container", "image", lang.Image)
	if err := e.docker.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil {
		return -1, err
	}

	slog.Info("tailing container logs", "image", lang.Image)
	e.streamLogs(ctx, containerID, emit)
	return e.waitForExit(ctx, containerID), nil
}

func (e *Executor) ensureImage(ctx context.Context, img string) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	slog.Info("getting images")

	images, err := e.docker.ImageList(ctx, image.ListOptions{
		Filters: filters.NewArgs(filters.Arg("reference", img)),
	})
	if err != nil {
		slog.Error("image list failed", "error", err)
		return err
	}
	if len(images) > 0 {
		slog.Info("image found locally", "image", img)
		return nil
	}

	slog.Info("pulling image", "image", img)
	r, err := e.docker.ImagePull(ctx, img, image.PullOptions{})
	if err != nil {
		slog.Error("image pull failed", "error", err)
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
			Image:        lang.Image,
			Cmd:          cmd,
			WorkingDir:   "/sandbox",
			AttachStdout: true,
			AttachStderr: true,
			Tty:          false,
		},
		&container.HostConfig{
			Binds: []string{tmpDir + ":/sandbox"},
			Resources: container.Resources{
				Memory:     lang.MemoryLimit,
				MemorySwap: lang.MemoryLimit, // Prevent swap usage
				NanoCPUs:   lang.CPULimit,
				PidsLimit:  &[]int64{256}[0], // Limit process count (fork bomb protection)
			},
			// Security options
			SecurityOpt: []string{
				"no-new-privileges:true", // Prevent privilege escalation
			},
			CapDrop:    []string{"ALL"}, // Drop all Linux capabilities
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

func (e *Executor) streamLogs(ctx context.Context, containerID string, emit job.OutputFunc) {
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

	wg := sync.WaitGroup{}
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
