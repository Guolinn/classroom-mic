package main

import (
	"errors"
	"sync"
	"time"
)

// Open the output immediately before use. Keeping a silent CoreAudio device
// running while waiting for a phone produced distorted live playback on the
// tested Mac, despite clean samples and regular callbacks. A fresh device at
// connection time avoided the failure. Each speaking turn gets a fresh output.
type audioOutput struct {
	mu         sync.Mutex
	open       func() (func(), error)
	close      func()
	timer      *time.Timer
	generation uint64
	closed     bool
}

func (o *audioOutput) cancelTimer() {
	o.generation++
	if o.timer != nil {
		o.timer.Stop()
		o.timer = nil
	}
}

func (o *audioOutput) start() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return errors.New("audio output is closed")
	}
	o.cancelTimer()
	if o.close != nil {
		return nil
	}
	close, err := o.open()
	if err != nil {
		return err
	}
	o.close = close
	return nil
}

func (o *audioOutput) stopLocked() {
	o.cancelTimer()
	if o.close != nil {
		o.close()
		o.close = nil
	}
}

func (o *audioOutput) stop() {
	if o == nil {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.stopLocked()
}

// Test tones finish without leaving an idle output running. A later start
// invalidates this timer so it cannot stop a new speaking turn.
func (o *audioOutput) stopAfter(delay time.Duration) {
	if o == nil {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.cancelTimer()
	if o.close == nil {
		return
	}
	generation := o.generation
	o.timer = time.AfterFunc(delay, func() {
		o.mu.Lock()
		defer o.mu.Unlock()
		if o.generation == generation {
			o.stopLocked()
		}
	})
}

func (o *audioOutput) shutdown() {
	if o == nil {
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.closed = true
	o.stopLocked()
}
