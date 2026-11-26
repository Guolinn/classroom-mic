package main

import (
	"time"
)

// Correct small capture/output clock differences without hard sample cuts.
// The per-second minimum tracks the queue floor, not the top of a burst.
// This deliberately cannot accelerate away a network-sized arrival burst.
type sampleClock struct {
	rate, goal, phase float64
	drift             float64
	window            time.Time
	low, high         int
	floorMs, peakMs   float64
	measured          bool
}

func newSampleClock() sampleClock { return sampleClock{rate: 1, goal: 1} }
func (c *sampleClock) observe(queued int, now time.Time) bool {
	updated := false
	if c.window.IsZero() {
		c.window, c.low, c.high = now, queued, queued
	}
	c.low = min(c.low, queued)
	c.high = max(c.high, queued)
	if now.Sub(c.window) >= time.Second {
		updated = true
		c.floorMs, c.peakMs = float64(c.low)/48, float64(c.high)/48
		c.measured = true
		errorSeconds := float64(c.low-frameSamples) / rate
		// Retain the learned rate difference when the queue reaches its floor.
		// A proportional-only controller repeatedly loses that correction.
		c.drift = max(-.001, min(.001, c.drift+errorSeconds*.02))
		c.goal = 1 + max(-.002, min(.002, c.drift+errorSeconds*.3))
		c.window, c.low, c.high = now, queued, queued
	}
	// Smooth speed changes across output callbacks. Limit is +/-0.2%.
	c.rate += (c.goal - c.rate) * .02
	return updated
}
