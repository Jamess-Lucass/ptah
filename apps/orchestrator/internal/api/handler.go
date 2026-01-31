package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/Jamess-Lucass/ptah/apps/orchestrator/internal/executor"
)

const MaxCodeSize = 64 * 1024 // 64KB

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

		sse, ok := NewSSEWriter(w)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		slog.Info("executing", "language", req.Language, "codeSize", len(req.Code))

		err := exec.Execute(r.Context(), languageConfig, req.Code, sse.Send)
		if err != nil {
			sse.Send("error", err.Error())
		}

		sse.End()
	}
}
