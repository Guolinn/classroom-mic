package main

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestOutputOpensOnlyForPlaybackAndReopensAfterMute(t *testing.T) {
	var opens, stops int
	o := &audioOutput{open: func() (func(), error) {
		opens++
		return func() { stops++ }, nil
	}}
	if opens != 0 {
		t.Fatal("idle receiver opened an output")
	}
	for i := 0; i < 2; i++ {
		if err := o.start(); err != nil {
			t.Fatal(err)
		}
	}
	if opens != 1 {
		t.Fatal("duplicate start opened overlapping outputs")
	}
	o.stop()
	o.stop()
	if stops != 1 {
		t.Fatal("mute did not close exactly one output")
	}
	if err := o.start(); err != nil {
		t.Fatal(err)
	}
	if opens != 2 {
		t.Fatal("new speaking turn reused the idle device")
	}
	o.shutdown()
	if err := o.start(); err == nil {
		t.Fatal("shutdown allowed playback to restart")
	}
	if stops != 2 {
		t.Fatal("shutdown leaked an output")
	}
}

func TestOutputFailureCanBeRetried(t *testing.T) {
	attempts := 0
	o := &audioOutput{open: func() (func(), error) {
		attempts++
		if attempts == 1 {
			return nil, errors.New("device unavailable")
		}
		return func() {}, nil
	}}
	defer o.shutdown()
	if err := o.start(); err == nil {
		t.Fatal("failed device reported success")
	}
	if err := o.start(); err != nil {
		t.Fatal(err)
	}
}

func TestTestToneReleasesOutputAndCannotStopNewPlayback(t *testing.T) {
	var stops atomic.Int32
	o := &audioOutput{open: func() (func(), error) {
		return func() { stops.Add(1) }, nil
	}}
	defer o.shutdown()
	if err := o.start(); err != nil {
		t.Fatal(err)
	}
	o.stopAfter(20 * time.Millisecond)
	deadline := time.Now().Add(2 * time.Second)
	for stops.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if stops.Load() != 1 {
		t.Fatal("finished test tone left an idle output open")
	}
	if err := o.start(); err != nil {
		t.Fatal(err)
	}
	o.stopAfter(100 * time.Millisecond)
	if err := o.start(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(150 * time.Millisecond)
	if stops.Load() != 1 {
		t.Fatal("old test tone timer stopped new playback")
	}
}

func TestConcurrentOutputOperationsDoNotOverlapDevices(t *testing.T) {
	var live, peak atomic.Int32
	o := &audioOutput{open: func() (func(), error) {
		n := live.Add(1)
		if n > peak.Load() {
			peak.Store(n)
		}
		return func() { live.Add(-1) }, nil
	}}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _ = o.start(); o.stop() }()
	}
	wg.Wait()
	o.shutdown()
	if live.Load() != 0 || peak.Load() > 1 {
		t.Fatal("overlapping or leaked output devices")
	}
}

func TestReceiverMuteClosesOutputAndClearsSamples(t *testing.T) {
	stopped := false
	r := &receiver{player: newPlayout(), ticket: secret(), output: &audioOutput{open: func() (func(), error) {
		return func() { stopped = true }, nil
	}}}
	if err := r.output.start(); err != nil {
		t.Fatal(err)
	}
	r.player.beat()
	r.player.push(packet(0, 5000), time.Now())
	r.mute()
	if !stopped || r.ticket != "" || r.player.snapshot().QueueMs != 0 {
		t.Fatal("mute left a speaker, ticket, or queued audio active")
	}
}
