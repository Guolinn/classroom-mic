package main

import (
	"math"
	"time"
)

const catchupOverlap = 480 // 10 ms at 48 kHz.
const catchupMinLag = 120  // Search 2.5–15 ms for similar waveform phases.
const catchupMaxLag = 720
const catchupReserve = 480 // Leave at least 10 ms beyond the overlap.

var catchupWeight = func() (weights [catchupOverlap]float64) {
	for i := range weights {
		weights[i] = .5 - .5*math.Cos(math.Pi*float64(i)/float64(catchupOverlap-1))
	}
	return
}()

// Short waveform-aligned overlap-add removes persistent excess queueing.
// Unlike speeding up sample playback, matched-phase splices preserve the
// pitch of periodic speech. Dissimilar waveforms are left untouched.
// This is not packet-loss concealment and cannot play audio before arrival.
func (p *playout) catchUp(now time.Time) {
	if !p.started || p.catchupBudget < catchupMinLag || now.Before(p.nextCatchup) || now.Before(p.catchupHold) || p.spliceLeft > 0 || p.splicePending {
		return
	}
	limit := min(catchupMaxLag, p.catchupBudget, p.size-catchupReserve-catchupOverlap)
	if limit < catchupMinLag {
		return
	}
	// A pending packet-loss boundary must be rendered with the normal blend.
	var samples [catchupMaxLag + catchupOverlap]int16
	for i := 0; i < limit+catchupOverlap; i++ {
		index := (p.head + i) % len(p.buf)
		if p.boundary[index] {
			return
		}
		samples[i] = p.buf[index]
	}
	score := func(lag, stride int) float64 {
		var aa, bb, ab float64
		for i := 0; i < catchupOverlap; i += stride {
			a, b := float64(samples[i]), float64(samples[i+lag])
			aa += a * a
			bb += b * b
			ab += a * b
		}
		if aa+bb == 0 {
			return 1
		} // Exact digital silence is safe to shorten.
		return 2 * ab / (aa + bb)
	}
	// Coarse search then full-rate refinement bounds audio-callback work.
	best, quality := 0, -2.0
	for lag := catchupMinLag; lag <= limit; lag += 4 {
		value := score(lag, 4)
		if value > quality || (value == quality && abs(lag-480) < abs(best-480)) {
			best, quality = lag, value
		}
	}
	coarse := best
	quality = -2
	for lag := max(catchupMinLag, coarse-3); lag <= min(limit, coarse+3); lag++ {
		value := score(lag, 1)
		if value > quality || (value == quality && abs(lag-480) < abs(best-480)) {
			best, quality = lag, value
		}
	}
	if quality < .85 {
		p.nextCatchup = now.Add(10 * time.Millisecond)
		return
	}
	// Source samples were copied above, so overlap is safe even when lag < window.
	newHead := (p.head + best) % len(p.buf)
	for i, weight := range catchupWeight {
		p.buf[(newHead+i)%len(p.buf)] = int16(float64(samples[i])*(1-weight) + float64(samples[i+best])*weight)
	}
	p.head, p.size = newHead, p.size-best
	// Blended samples have two source arrival times. Exclude this short region
	// instead of reporting either timestamp as an exact residence measurement.
	p.timingSkip = catchupOverlap
	p.catchupBudget -= best
	p.stats.Catchups++
	p.stats.Compressed += uint64(best)
	p.lastCatchup = now
	p.backlogGoal = 0
	// At most ~10% time compression; no repeated cuts on every output callback.
	p.nextCatchup = now.Add(time.Duration(best) * time.Second / rate * 10)
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
