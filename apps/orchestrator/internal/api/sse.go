package api

import (
	"fmt"
	"net/http"
	"strings"
)

type SSEWriter struct {
	w http.ResponseWriter
	f http.Flusher
}

func NewSSEWriter(w http.ResponseWriter) (*SSEWriter, bool) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, false
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	return &SSEWriter{w: w, f: flusher}, true
}

func (s *SSEWriter) Send(event, data string) {
	fmt.Fprintf(s.w, "event: %s\n", event)
	for _, line := range strings.Split(data, "\n") {
		fmt.Fprintf(s.w, "data: %s\n", line)
	}
	fmt.Fprint(s.w, "\n")
	s.f.Flush()
}

func (s *SSEWriter) End() {
	s.Send("end", "")
}
