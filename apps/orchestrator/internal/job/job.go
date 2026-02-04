package job

import "sync"

type OutputEvent struct {
	Type string
	Data string
}

type OutputFunc func(typ, data string)

type Job struct {
	mu     sync.RWMutex
	events []OutputEvent
	done   bool
	subs   map[chan OutputEvent]struct{}
}

func NewJob() *Job {
	return &Job{
		events: make([]OutputEvent, 0),
		subs:   make(map[chan OutputEvent]struct{}),
	}
}

func (j *Job) Send(typ, data string) {
	j.mu.Lock()
	defer j.mu.Unlock()

	event := OutputEvent{Type: typ, Data: data}
	j.events = append(j.events, event)

	for ch := range j.subs {
		select {
		case ch <- event:
		default:
			// Slow subscriber, skip
		}
	}
}

func (j *Job) Finish() {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.done = true
	for ch := range j.subs {
		close(ch)
	}
	j.subs = nil
}

func (j *Job) Subscribe() (chan OutputEvent, []OutputEvent, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()

	// Copy existing events for replay
	replay := make([]OutputEvent, len(j.events))
	copy(replay, j.events)

	if j.done {
		// Already finished, just return buffered events
		return nil, replay, true
	}

	// Still running, create subscription
	ch := make(chan OutputEvent, 100)
	j.subs[ch] = struct{}{}

	return ch, replay, false
}

func (j *Job) Unsubscribe(ch chan OutputEvent) {
	j.mu.Lock()
	defer j.mu.Unlock()

	if _, ok := j.subs[ch]; ok {
		delete(j.subs, ch)
		close(ch)
	}
}
