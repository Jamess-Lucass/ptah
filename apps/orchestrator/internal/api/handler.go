package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/Jamess-Lucass/ptah/apps/orchestrator/internal/executor"
	"github.com/Jamess-Lucass/ptah/apps/orchestrator/internal/job"
	"github.com/google/uuid"
)

const MaxCodeSize = 64 * 1024 // 64KB

var jobs = struct {
	sync.RWMutex
	m map[string]*job.Job
}{m: make(map[string]*job.Job)}

type ExecuteRequest struct {
	Language string `json:"language"`
	Code     string `json:"code"`
}

func HandleExecute(exec *executor.Executor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req ExecuteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}

		languageConfig, ok := executor.Languages[req.Language]
		if !ok {
			http.Error(w, "unsupported language", http.StatusBadRequest)
			return
		}

		if len(req.Code) == 0 {
			http.Error(w, "code is required", http.StatusBadRequest)
			return
		}

		if len(req.Code) > MaxCodeSize {
			http.Error(w, "code too large (max 64KB)", http.StatusBadRequest)
			return
		}

		jobId := uuid.NewString()
		j := job.NewJob()

		jobs.Lock()
		jobs.m[jobId] = j
		jobs.Unlock()

		slog.Info("created job", "jobId", jobId, "language", req.Language)

		go func() {
			err := exec.Execute(context.Background(), languageConfig, req.Code, j.Send)
			if err != nil {
				j.Send("error", err.Error())
			}

			j.Finish()

			slog.Info("finished job", "jobId", jobId)

			// Cleanup after 2 minutes
			time.Sleep(2 * time.Minute)

			slog.Info("cleaning up job", "jobId", jobId)

			jobs.Lock()
			delete(jobs.m, jobId)
			jobs.Unlock()
		}()

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"jobId": jobId}); err != nil {
			slog.Error("failed to encode response", "error", err)
			http.Error(w, "failed to encode response", http.StatusInternalServerError)
			return
		}
	}
}

func HandleJobStream(w http.ResponseWriter, r *http.Request) {
	jobId := r.PathValue("jobId")

	jobs.RLock()
	job, ok := jobs.m[jobId]
	jobs.RUnlock()

	if !ok {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}

	sse, ok := NewSSEWriter(w)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	ch, replay, done := job.Subscribe()

	// Send buffered events first
	for _, event := range replay {
		sse.Build(event.Type, event.Data)
	}
	sse.Flush()

	if done {
		// Job already finished, we're done
		sse.Send("end", "")
		return
	}

	defer job.Unsubscribe(ch)

	for event := range ch {
		sse.Send(event.Type, event.Data)
	}

	sse.Send("end", "")
}
