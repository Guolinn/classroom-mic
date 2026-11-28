package main

import (
	"os"
	"testing"
	"time"
)

// Explicit, audible integration check. No microphone access or audio recording.
// Ordinary go test never opens the user's speaker.
func TestNativeOutputLifecycle(t *testing.T) {
	if os.Getenv("MICTURN_TEST_NATIVE_OUTPUT") != "1" {
		t.Skip("set MICTURN_TEST_NATIVE_OUTPUT=1 for quiet test tones on the selected speaker")
	}
	p := newPlayout()
	p.setVolume(.03)
	o := &audioOutput{open: func() (func(), error) { return audioDevice(p) }}
	defer o.shutdown()
	for turn := 0; turn < 3; turn++ {
		p.reset()
		p.beat()
		began := time.Now()
		if err := o.start(); err != nil {
			t.Fatal(err)
		}
		t.Logf("turn %d: device opened in %v", turn+1, time.Since(began))
		p.testTone()
		time.Sleep(400 * time.Millisecond)
		if p.snapshot().OutputCallbacks == 0 {
			t.Fatal("speaker callback did not start")
		}
		o.stop()
		stopped := p.snapshot().OutputCallbacks
		time.Sleep(100 * time.Millisecond)
		if p.snapshot().OutputCallbacks != stopped {
			t.Fatal("audio callbacks continued after mute")
		}
	}
}
