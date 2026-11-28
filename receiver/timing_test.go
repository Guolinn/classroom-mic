package main

import (
	"context"
	"encoding/binary"
	"testing"
	"time"
)

func TestResidenceMeasuresConsumedAudioAndResets(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.heartbeat = now
	p.push(packet(0, 1000), now)
	p.render(make([]byte, 256), now.Add(25*time.Millisecond))
	s := p.snapshot()
	if s.ResidenceMedian == nil || *s.ResidenceMedian != 25 || s.ResidenceCount != 1 {
		t.Fatalf("wrong arrival-to-render timing: %+v", s)
	}
	p.reset()
	if p.snapshot().ResidenceMedian != nil {
		t.Fatal("mute retained a previous speaker's timing")
	}
	p.heartbeat = now
	p.push(packet(1, 1000), now)
	p.timingSkip = 480
	p.render(make([]byte, 256), now.Add(10*time.Millisecond))
	if p.snapshot().ResidenceMedian != nil {
		t.Fatal("ambiguous blended samples were measured")
	}
}

func TestResidenceWindowIsBoundedAndRejectsInvalidTimes(t *testing.T) {
	var r residenceTiming
	now := time.Now()
	r.observe(time.Time{}, now)
	r.observe(now, now.Add(-time.Millisecond))
	if _, _, n := r.snapshot(); n != 0 {
		t.Fatal("invalid timestamps accepted")
	}
	for i := 0; i < 2000; i++ {
		r.observe(now, now.Add(10*time.Millisecond))
	}
	a, b, n := r.snapshot()
	if n != 1024 || *a != 10 || *b != 10 {
		t.Fatal("unbounded or incorrect recent window")
	}
}

func TestReceiptCongestionCannotBlockAudio(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered, release := make(chan uint32, 1), make(chan struct{})
	replies := receiptReplies(ctx, func(b []byte) error {
		if len(b) != 8 || string(b[:4]) != "MTA1" {
			t.Error("malformed receipt reply")
		}
		entered <- binary.LittleEndian.Uint32(b[4:])
		<-release
		return nil
	})
	replies <- 20
	select {
	case seq := <-entered:
		if seq != 20 {
			t.Fatal("wrong receipt sequence")
		}
	case <-time.After(time.Second):
		t.Fatal("receipt not sent")
	}
	for i := uint32(0); i < 10000; i++ {
		select {
		case replies <- i:
		default:
		}
	}
	if len(replies) != 1 {
		t.Fatal("unbounded reply queue")
	}
	cancel()
	close(release)
}

func TestSenderTimingAllowsOnlyBoundedNumericFields(t *testing.T) {
	s := parseSenderTiming([]byte(`MTS1{"receiptMedianMs":15,"receiptP95Ms":null,"maxWriteMs":-1,"address":5,"maxCaptureGapMs":1e10}`))
	if len(s) != 1 || s["receiptMedianMs"] != 15 {
		t.Fatalf("unfiltered sender summary: %#v", s)
	}
	for _, b := range [][]byte{[]byte(`MTS1{"name":"private"}`), []byte(`MT01{}`), make([]byte, 600)} {
		if parseSenderTiming(b) != nil {
			t.Fatal("invalid or oversized summary accepted")
		}
	}
}
