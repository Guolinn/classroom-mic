package main

import (
	"encoding/binary"
	"math"
	"testing"
	"time"
)

func speechLikePacket(seq uint32) []byte {
	b := packet(seq, 0)
	for i := 0; i < frameSamples; i++ {
		x := float64(int(seq)*frameSamples+i) / rate
		// Harmonic, amplitude-modulated voice surrogate; not recorded speech.
		envelope := .6 + .3*math.Sin(2*math.Pi*3*x)
		y := envelope * (9000*math.Sin(2*math.Pi*180*x) + 3000*math.Sin(2*math.Pi*360*x) + 1500*math.Sin(2*math.Pi*540*x))
		binary.LittleEndian.PutUint16(b[12+i*2:], uint16(int16(y)))
	}
	return b
}

// A 90 ms network stall releases a burst and then returns to normal delivery.
// The application must remove the residual queue without repeated starvation.
func TestNetworkStallRecovery(t *testing.T) {
	p := newPlayout()
	base := time.Now()
	out := make([]byte, 256)
	seq := uint32(0)
	var settledUnderruns uint64
	var recoveredAt time.Duration
	for f := 0; f < rate*6; f += 128 {
		elapsed := time.Duration(f) * time.Second / rate
		now := base.Add(elapsed)
		p.heartbeat = now
		for {
			arrival := time.Duration(seq+1) * 5 * time.Millisecond
			if arrival >= time.Second && arrival < 1090*time.Millisecond {
				arrival = 1090 * time.Millisecond
			}
			if arrival > elapsed {
				break
			}
			p.push(speechLikePacket(seq), base.Add(arrival))
			seq++
		}
		p.render(out, now)
		if elapsed > 1500*time.Millisecond && recoveredAt == 0 && p.size <= 20*48 {
			recoveredAt = elapsed
		}
		if elapsed < 1500*time.Millisecond {
			settledUnderruns = p.stats.Underruns
		}
	}
	s := p.snapshot()
	t.Logf("remaining queue=%.2f ms, underruns=%d, trims=%d, compressed=%.2f ms, recoveredAt=%v", s.QueueMs, s.Underruns, s.Trims, float64(s.Compressed)/48, recoveredAt)
	if s.QueueMs > 20 {
		t.Errorf("delay remains after the network recovered: %.2f ms", s.QueueMs)
	}
	if s.Underruns != settledUnderruns || s.Trims != 0 || s.Resets != 0 {
		t.Errorf("catch-up interrupted speech: %+v", s)
	}
	if recoveredAt == 0 || recoveredAt > 4*time.Second {
		t.Error("catch-up did not converge promptly after recovery")
	}
	if int(s.Played+s.Compressed)+p.size != int(s.Received)*frameSamples {
		t.Fatal("audio sample accounting lost queued data")
	}
	p.reset()
	p.render(out, base.Add(6*time.Second))
	for _, v := range out {
		if v != 0 {
			t.Fatal("catch-up left audio after mute")
		}
	}
}

func TestCatchupPreservesTonePitchAndAvoidsClicks(t *testing.T) {
	for _, hz := range []float64{80, 180, 440, 1000} {
		p := newPlayout()
		now := time.Now()
		p.heartbeat = now
		p.setVolume(1)
		for seq := uint32(0); seq < 24; seq++ {
			b := packet(seq, 0)
			for i := 0; i < frameSamples; i++ {
				v := int16(8000 * math.Sin(float64(int(seq)*frameSamples+i)*2*math.Pi*hz/rate))
				binary.LittleEndian.PutUint16(b[12+i*2:], uint16(v))
			}
			p.push(b, now)
		}
		p.started = true
		p.catchupBudget = 720
		out := make([]byte, 9600)
		p.render(out, now)
		if p.stats.Catchups != 1 {
			t.Fatalf("no aligned compression for %.0f Hz", hz)
		}
		limit := int(2*8000*math.Sin(math.Pi*hz/rate)*1.15) + 20
		if maxStep(out, 0) > limit {
			t.Fatalf("compression introduced a click at %.0f Hz", hz)
		}
		crossings := 0
		for i := 2; i < len(out); i += 2 {
			a, b := int16(binary.LittleEndian.Uint16(out[i-2:])), int16(binary.LittleEndian.Uint16(out[i:]))
			if a <= 0 && b > 0 {
				crossings++
			}
		}
		if math.Abs(float64(crossings)-hz*.1) > 1 {
			t.Fatalf("tone pitch changed: %.0f Hz, %d cycles in 100 ms", hz, crossings)
		}
	}
}

func TestCatchupDoesNotGateQuietOrUncorrelatedAudio(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.heartbeat = now
	var rng uint32 = 19
	for seq := uint32(0); seq < 24; seq++ {
		b := packet(seq, 0)
		for i := 0; i < frameSamples; i++ {
			rng = 1664525*rng + 1013904223
			// Very quiet aperiodic sound, not silence; do not gate on amplitude.
			binary.LittleEndian.PutUint16(b[12+i*2:], uint16(int16(int(rng>>24)-128)))
		}
		p.push(b, now)
	}
	p.started = true
	p.catchupBudget = 720
	before := p.buf
	head, size := p.head, p.size
	p.catchUp(now)
	if p.stats.Catchups != 0 || p.head != head || p.size != size || p.buf != before {
		t.Fatal("unaligned quiet audio was removed or changed")
	}
	// Loss boundaries must use normal loss blending, even with exact silence.
	clear(p.buf[:])
	p.boundary[(p.head+100)%len(p.buf)] = true
	p.catchUp(now.Add(20 * time.Millisecond))
	if p.stats.Catchups != 0 {
		t.Fatal("compression crossed a loss boundary")
	}
}

func BenchmarkCatchup(b *testing.B) {
	p := newPlayout()
	now := time.Now()
	source := speechLikePacket(0)
	b.ReportAllocs()
	for n := 0; n < b.N; n++ {
		p.head, p.size, p.started, p.catchupBudget = 0, 5760, true, 720
		p.nextCatchup = time.Time{}
		for i := range p.buf {
			p.buf[i] = int16(binary.LittleEndian.Uint16(source[12+(i%240)*2:]))
		}
		p.catchUp(now)
	}
}

func TestCatchupBacksOffAfterRenewedStarvation(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.heartbeat = now
	p.started, p.hadAudio = true, true
	p.lastPacket, p.lastCatchup = now, now.Add(-500*time.Millisecond)
	p.render(make([]byte, 256), now)
	for seq := uint32(0); seq < 24; seq++ {
		p.push(packet(seq, 1000), now)
	}
	p.started, p.catchupBudget = true, 720
	p.catchUp(now.Add(time.Second))
	if p.stats.Catchups != 0 {
		t.Fatal("catch-up continued immediately after renewed starvation")
	}
	p.catchUp(now.Add(5100 * time.Millisecond))
	if p.stats.Catchups != 1 {
		t.Fatal("catch-up never recovered after the bounded hold")
	}
	p.reset()
	if !p.catchupHold.IsZero() || p.catchupBudget != 0 {
		t.Fatal("new speaker inherited catch-up state")
	}
}
