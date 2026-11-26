package main

import (
	"encoding/binary"
	"fmt"
	"math"
	"testing"
	"time"
)

// Independent capture and output clocks, including arrival bursts observed in
// the owner's reports. This is synthetic; it does not measure either device.
func TestLongRunningIndependentClocks(t *testing.T) {
	for _, batch := range []time.Duration{5 * time.Millisecond, 98 * time.Millisecond} {
		for _, ppm := range []float64{-500, 0, 500} {
			t.Run(fmt.Sprintf("batch=%v/ppm=%.0f", batch, ppm), func(t *testing.T) {
				p := newPlayout()
				base := time.Now()
				out := make([]byte, 256)
				seq, next := uint32(0), batch
				var settledUnderruns uint64
				for f := 0; f < rate*180; f += 128 {
					elapsed := time.Duration(f) * time.Second / rate
					now := base.Add(elapsed)
					p.heartbeat = now
					for next <= elapsed {
						for float64(seq+1)*.005 <= next.Seconds()*(1+ppm/1e6) {
							p.push(packet(seq, 1000), base.Add(next))
							seq++
						}
						next += batch
					}
					p.render(out, now)
					if f < rate*10 {
						settledUnderruns = p.stats.Underruns
					}
					if math.Abs(p.clock.rate-1) > .002001 {
						t.Fatal("unbounded playback-rate correction")
					}
				}
				s := p.snapshot()
				if s.QueueFloorMs == nil {
					t.Fatal("missing completed queue measurement")
				}
				t.Logf("underruns=%d trims=%d queue=%.2f floor=%.2f correction=%.0f ppm", s.Underruns, s.Trims, s.QueueMs, *s.QueueFloorMs, s.ClockCorrection)
				if s.Underruns != settledUnderruns || s.Trims != 0 || s.Resets != 0 {
					t.Fatalf("clock mismatch caused recurring interruptions: %+v", s)
				}
				if s.QueueFloorMs == nil || *s.QueueFloorMs > 12 || s.QueueMs > 120 {
					t.Fatal("clock mismatch accumulated excessive queued audio")
				}
			})
		}
	}
}

func TestLossBoundariesDuringRateCorrection(t *testing.T) {
	for _, ratio := range []float64{.998, 1.002} {
		p := newPlayout()
		now := time.Now()
		p.heartbeat = now
		p.setVolume(1)
		p.clock.rate, p.clock.goal = ratio, ratio
		for seq := uint32(0); seq < 4; seq++ {
			p.push(packet(seq, 20000), now)
		}
		p.render(make([]byte, 256), now)
		// Missing sequence 4 inserts silence, followed by opposite-polarity audio.
		for seq := uint32(5); seq < 10; seq++ {
			p.push(packet(seq, -20000), now)
		}
		out := make([]byte, 5000)
		p.render(out, now)
		if step := maxStep(out, 20000); step > 1000 {
			t.Fatalf("ratio %.3f introduced a hard loss/recovery edge: %d", ratio, step)
		}
	}
}

// Validate the actual rendered waveform against a continuous reference, not
// just queue counters. Both correction signs cross thousands of packet edges.
func TestRateCorrectionPreservesContinuousWaveform(t *testing.T) {
	for _, ratio := range []float64{.998, 1, 1.002} {
		p := newPlayout()
		p.setVolume(1)
		base := time.Now()
		p.heartbeat = base
		p.clock.rate, p.clock.goal = ratio, ratio
		seq := uint32(0)
		out := make([]byte, 256)
		maxError, maxJump, previous := 0.0, 0.0, 0.0
		position := 0.0
		for f := 0; f < rate*2; f += 128 {
			for p.size < 512 {
				b := packet(seq, 0)
				for i := 0; i < frameSamples; i++ {
					v := int16(10000 * math.Sin(float64(int(seq)*frameSamples+i)*2*math.Pi*1000/rate))
					binary.LittleEndian.PutUint16(b[12+i*2:], uint16(v))
				}
				p.push(b, base)
				seq++
			}
			p.render(out, base) // Keep the controller fixed while testing resampling.
			for i := 0; i < 128; i++ {
				actual := float64(int16(binary.LittleEndian.Uint16(out[i*2:])))
				expected := 10000 * math.Sin(position*2*math.Pi*1000/rate)
				maxError = math.Max(maxError, math.Abs(actual-expected))
				maxJump = math.Max(maxJump, math.Abs(actual-previous))
				previous = actual
				position += ratio
			}
		}
		if maxError > 25 || maxJump > 1320 {
			t.Fatalf("ratio %.3f introduced waveform error %.2f / jump %.2f", ratio, maxError, maxJump)
		}
		p.reset()
		p.render(out, base)
		for _, v := range out {
			if v != 0 {
				t.Fatal("rate correction extended explicit mute")
			}
		}
		if p.clock.rate != 1 || p.clock.phase != 0 {
			t.Fatal("next speaker inherited clock correction")
		}
	}
}

func TestOutputGapDiagnostics(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.heartbeat = now
	p.push(packet(0, 1000), now)
	p.render(make([]byte, 256), now)
	p.render(make([]byte, 256), now.Add(80*time.Millisecond))
	s := p.snapshot()
	if s.MaxOutputGapMs != 80 || math.Abs(s.OutputBlockMs-128.0/48) > .001 {
		t.Fatalf("output scheduling gap missing: %+v", s)
	}
	if s.QueueFloorMs != nil {
		t.Fatal("no complete measurement window yet")
	}
	p.reset()
	if p.snapshot().MaxOutputGapMs != 0 {
		t.Fatal("new speaker inherited old scheduling gap")
	}
}
