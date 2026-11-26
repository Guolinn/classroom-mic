package main

import (
	"testing"
	"time"
)

// The owner's receiver reported a 98 ms arrival gap, no sequence loss and
// substantial self-inflicted trimming. Test those larger arrival batches,
// not just the 16–32 ms synthetic batches used for the first correction.
func TestLargeArrivalBatchesPreserveAudio(t *testing.T) {
	patterns := [][]time.Duration{
		{64 * time.Millisecond},
		{85 * time.Millisecond},
		{98 * time.Millisecond},
		{32 * time.Millisecond, 85 * time.Millisecond, 64 * time.Millisecond, 98 * time.Millisecond},
	}
	for _, intervals := range patterns {
		p := newPlayout()
		base := time.Now()
		next, index, seq := intervals[0], 0, uint32(0)
		out := make([]byte, 256)
		for frames := 0; frames < rate*20; frames += 128 {
			elapsed := time.Duration(frames) * time.Second / rate
			now := base.Add(elapsed)
			p.heartbeat = now
			for next <= elapsed {
				for time.Duration(seq+1)*5*time.Millisecond <= next {
					p.push(packet(seq, 1000), base.Add(next))
					seq++
				}
				index++
				next += intervals[index%len(intervals)]
			}
			p.render(out, now)
		}
		s := p.snapshot()
		t.Logf("intervals=%v received=%d played=%d underruns=%d trims=%d trimmedMs=%.1f resets=%d queueMs=%.1f targetMs=%.1f", intervals, s.Received, s.Played, s.Underruns, s.Trims, float64(s.Trimmed)/48, s.Resets, s.QueueMs, s.TargetMs)
		if s.Trims != 0 || s.Resets != 0 || s.Underruns > 3 || s.Played < 948000 {
			t.Errorf("arrival batching discarded speech or repeatedly interrupted playback: %+v", s)
		}
		if s.QueueMs > 120 || s.TargetMs > 20 {
			t.Errorf("queue exceeded the bounded burst allowance: %+v", s)
		}
		// A larger burst allowance must not leave any tail after explicit mute.
		p.reset()
		p.render(out, base.Add(20*time.Second))
		for _, value := range out {
			if value != 0 {
				t.Fatal("mute retained a queued sample")
			}
		}
	}
}

func TestBriefArrivalGapDoesNotDiscardPlayableTail(t *testing.T) {
	p := newPlayout()
	now := time.Now()
	p.heartbeat = now
	for seq := uint32(0); seq < 24; seq++ {
		p.push(packet(seq, 1000), now)
	}
	// Preserve queued samples across a gap just over the former 100 ms timer.
	p.render(make([]byte, 256), now.Add(110*time.Millisecond))
	if p.snapshot().Resets != 0 || p.snapshot().Played == 0 {
		t.Fatal("playable burst was discarded by the idle timer")
	}
	p.render(make([]byte, 256), now.Add(300*time.Millisecond))
	if p.snapshot().QueueMs != 0 {
		t.Fatal("stale queued audio was retained indefinitely")
	}
}
