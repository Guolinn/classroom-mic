package main

import (
	"encoding/binary"
	"math"
	"testing"
	"time"
)

func packet(seq uint32, sample int16) []byte {
	b := make([]byte, 492)
	copy(b, "MT01")
	binary.LittleEndian.PutUint32(b[4:], seq)
	binary.LittleEndian.PutUint32(b[8:], rate)
	for i := 0; i < 240; i++ {
		binary.LittleEndian.PutUint16(b[12+i*2:], uint16(sample))
	}
	return b
}
func TestContinuousSmallFrames(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.beat()
	p.setVolume(1)
	out := make([]byte, 480)
	for i := 0; i < 100; i++ {
		now = now.Add(5 * time.Millisecond)
		if !p.push(packet(uint32(i), 1200), now) {
			t.Fatal("packet rejected")
		}
		p.render(out, now)
		if binary.LittleEndian.Uint16(out) != 1200 {
			t.Fatal("audio not rendered")
		}
	}
	s := p.snapshot()
	if s.Underruns != 0 || s.Played != 24000 || s.TargetMs != 5 {
		t.Fatalf("unexpected stats: %+v", s)
	}
}
func TestRevocationAndDeadman(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.beat()
	p.push(packet(0, 1200), now)
	p.reset()
	out := make([]byte, 480)
	p.render(out, now)
	for _, b := range out {
		if b != 0 {
			t.Fatal("mute left audio queued")
		}
	}
	p.push(packet(1, 1200), now)
	p.render(out, now.Add(2*time.Second))
	for _, b := range out {
		if b != 0 {
			t.Fatal("lost controller did not silence output")
		}
	}
}
func TestDuplicateStaleAndBurst(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.beat()
	if !p.push(packet(7, 1000), now) || p.push(packet(7, 1000), now) || p.push(packet(6, 1000), now) {
		t.Fatal("sequence protection failed")
	}
	for i := uint32(8); i < 40; i++ {
		p.push(packet(i, 1000), now)
	}
	s := p.snapshot()
	if s.QueueMs > 120 || s.Trims == 0 || s.Resets != 0 {
		t.Fatalf("unbounded backlog: %+v", s)
	}
	if p.push([]byte("bad"), now) {
		t.Fatal("malformed packet accepted")
	}
	b := packet(40, 1000)
	binary.LittleEndian.PutUint32(b[8:], 44100)
	if p.push(b, now) {
		t.Fatal("wrong rate accepted")
	}
}

func TestBatchedPacketsDoNotResetAndRefill(t *testing.T) {
	for _, batch := range []time.Duration{16 * time.Millisecond, 24 * time.Millisecond, 32 * time.Millisecond} {
		p := newPlayout()
		base := time.Now()
		seq := uint32(0)
		nextBatch := batch
		out := make([]byte, 256) // Native 128-frame callbacks.
		for frames := 0; frames < rate*10; frames += 128 {
			elapsed := time.Duration(frames) * time.Second / rate
			now := base.Add(elapsed)
			p.heartbeat = now
			for nextBatch <= elapsed {
				for time.Duration(seq+1)*5*time.Millisecond <= nextBatch {
					p.push(packet(seq, 1000), base.Add(nextBatch))
					seq++
				}
				nextBatch += batch
			}
			p.render(out, now)
		}
		s := p.snapshot()
		t.Logf("batch=%v stats=%+v", batch, s)
		if s.Resets != 0 || s.Underruns > 3 || s.Played < 470000 {
			t.Fatalf("batched capture caused repeated interruptions: %+v", s)
		}
		if s.QueueMs > 50 || s.TargetMs > 20 {
			t.Fatal("unbounded latency policy")
		}
	}
}

func maxStep(out []byte, previous int16) int {
	largest := 0
	for i := 0; i+1 < len(out); i += 2 {
		next := int16(binary.LittleEndian.Uint16(out[i:]))
		step := int(math.Abs(float64(int(next) - int(previous))))
		if step > largest {
			largest = step
		}
		previous = next
	}
	return largest
}
func TestLossAndRecoveryDoNotInjectFullScaleSteps(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.beat()
	p.setVolume(1)
	p.push(packet(0, 20000), now)
	p.render(make([]byte, 480), now)
	p.push(packet(2, -20000), now.Add(10*time.Millisecond))
	out := make([]byte, 960)
	p.render(out, now.Add(10*time.Millisecond))
	if step := maxStep(out, 20000); step > 1000 {
		t.Fatalf("loss inserted an audible hard edge: %d", step)
	}
	// Starvation and later recovery are smoothed too, without extending mute.
	out = make([]byte, 480)
	p.render(out, now.Add(15*time.Millisecond))
	if step := maxStep(out, -20000); step > 1000 {
		t.Fatalf("starvation inserted hard edge: %d", step)
	}
	p.push(packet(3, 20000), now.Add(20*time.Millisecond))
	p.push(packet(4, 20000), now.Add(25*time.Millisecond))
	p.render(out, now.Add(25*time.Millisecond))
	if step := maxStep(out, 0); step > 1000 {
		t.Fatalf("recovery inserted hard edge: %d", step)
	}
	p.reset()
	p.render(out, now.Add(25*time.Millisecond))
	for _, v := range out {
		if v != 0 {
			t.Fatal("explicit mute must remain immediate")
		}
	}
}

func TestOverflowTrimsOldAudioWithoutStoppingPlayback(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.beat()
	p.setVolume(1)
	p.push(packet(0, 20000), now)
	p.render(make([]byte, 256), now)
	for seq := uint32(1); seq < 30; seq++ {
		p.push(packet(seq, -20000), now)
	}
	before := p.snapshot()
	if before.Trims == 0 || before.Resets != 0 || before.QueueMs > 120 || !p.started {
		t.Fatalf("overflow stopped playback: %+v", before)
	}
	out := make([]byte, 256)
	p.render(out, now)
	if step := maxStep(out, 20000); step > 1000 {
		t.Fatalf("queue trim inserted hard edge: %d", step)
	}
	if p.snapshot().Underruns != 0 {
		t.Fatal("trimming created a needless underrun")
	}
}
func TestUnderrunRecoveryAndSpeakerReset(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.beat()
	p.push(packet(0, 1000), now)
	p.render(make([]byte, 960), now)
	if p.snapshot().TargetMs != 10 {
		t.Fatal("recovery buffer missing")
	}
	for i := uint32(1); i <= 8; i++ {
		p.push(packet(i, 1000), now)
		p.render(make([]byte, 4000), now)
	}
	if p.snapshot().TargetMs > 20 {
		t.Fatal("unbounded recovery target")
	}
	p.reset()
	if p.snapshot().TargetMs != 5 {
		t.Fatal("next speaker inherited recovery buffer")
	}
}
