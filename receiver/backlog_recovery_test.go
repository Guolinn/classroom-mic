package main

import (
	"encoding/binary"
	"math"
	"testing"
	"time"
)

// Aperiodic input models the case where waveform matching cannot find a safe
// splice. This is generated sound, not a recording of the user's microphone.
func TestAperiodicStallRecovery(t *testing.T) {
	p := newPlayout()
	base := time.Now()
	out := make([]byte, 256)
	seq, rng := uint32(0), uint32(73)
	var settled uint64
	for f := 0; f < rate*10; f += 128 {
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
			b := packet(seq, 0)
			for i := 0; i < frameSamples; i++ {
				rng = 1664525*rng + 1013904223
				binary.LittleEndian.PutUint16(b[12+i*2:], uint16(int16(int(rng>>16)%12001-6000)))
			}
			p.push(b, base.Add(arrival))
			seq++
		}
		p.render(out, now)
		if p.backlogRate < 0 || p.backlogRate > .018001 || p.clock.rate+p.backlogRate > 1.020001 {
			t.Fatal("unbounded recovery rate")
		}
		if elapsed < 1500*time.Millisecond {
			settled = p.stats.Underruns
		}
	}
	s := p.snapshot()
	t.Logf("aperiodic recovery: queue=%.2f ms underruns=%d trims=%d resets=%d matches=%d", s.QueueMs, s.Underruns, s.Trims, s.Resets, s.Catchups)
	if s.QueueMs > 25 {
		t.Fatal("non-periodic audio retained excess delay after network recovery")
	}
	if s.Underruns != settled || s.Trims != 0 || s.Resets != 0 {
		t.Fatal("recovery interrupted audio")
	}
	if int(s.Played+s.Compressed)+p.size != int(s.Received)*frameSamples {
		t.Fatal("audio accounting mismatch")
	}
}

func TestBacklogResamplingIsContinuousAndMuteIsImmediate(t *testing.T) {
	p := newPlayout()
	p.setVolume(1)
	p.backlogRate, p.backlogGoal = .018, .018
	base := time.Now()
	p.heartbeat = base
	seq := uint32(0)
	position, maxError := 0.0, 0.0
	out := make([]byte, 256)
	for frame := 0; frame < rate; frame += 128 {
		for p.size < 512 {
			b := packet(seq, 0)
			for i := 0; i < frameSamples; i++ {
				v := int16(10000 * math.Sin(float64(int(seq)*frameSamples+i)*2*math.Pi*1000/rate))
				binary.LittleEndian.PutUint16(b[12+i*2:], uint16(v))
			}
			p.push(b, base)
			seq++
		}
		p.render(out, base)
		for i := 0; i < 128; i++ {
			actual := float64(int16(binary.LittleEndian.Uint16(out[i*2:])))
			expected := 10000 * math.Sin(position*2*math.Pi*1000/rate)
			maxError = math.Max(maxError, math.Abs(actual-expected))
			position += 1.018
		}
	}
	if maxError > 25 {
		t.Fatalf("recovery created discontinuities: error %.2f", maxError)
	}
	p.reset()
	p.render(out, base)
	if p.backlogRate != 0 || p.backlogGoal != 0 {
		t.Fatal("mute retained recovery rate")
	}
	for _, value := range out {
		if value != 0 {
			t.Fatal("mute retained sound")
		}
	}
}
