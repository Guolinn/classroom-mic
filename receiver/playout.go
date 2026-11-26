package main

import (
	"encoding/binary"
	"math"
	"sync"
	"time"
)

const rate = 48000
const frameSamples = 240      // Five milliseconds, mono PCM16.
const maxQueuedSamples = 5760 // Burst allowance, not a target: at most 120 ms.
const spliceSamples = 48      // One millisecond of blending at discontinuities.
const staleAudioAfter = 250 * time.Millisecond

// These counters describe this queue only, never acoustic end-to-end latency.
type audioStats struct {
	OutputCallbacks uint64   `json:"outputCallbacks"`
	Received        uint64   `json:"received"`
	Played          uint64   `json:"playedSamples"`
	Dropped         uint64   `json:"dropped"`
	Underruns       uint64   `json:"underruns"`
	Resets          uint64   `json:"resets"`
	Trims           uint64   `json:"trims"`
	Trimmed         uint64   `json:"trimmedSamples"`
	MaxGapMs        float64  `json:"maxArrivalGapMs"`
	QueueMs         float64  `json:"queueMs"`
	TargetMs        float64  `json:"targetMs"`
	QueueFloorMs    *float64 `json:"queueFloorMs"`
	QueuePeakMs     *float64 `json:"queuePeakMs"`
	ClockCorrection float64  `json:"clockCorrectionPpm"`
	MaxOutputGapMs  float64  `json:"maxOutputGapMs"`
	OutputBlockMs   float64  `json:"outputBlockMs"`
}

type playout struct {
	mu                      sync.Mutex
	buf                     [8192]int16
	boundary                [8192]bool
	head, size, target      int
	started, seen           bool
	seq                     uint32
	volume                  float64
	lastPacket, heartbeat   time.Time
	resumeAt                time.Time
	stats                   audioStats
	tone                    int
	lastSample, spliceFrom  float64
	spliceLeft              int
	hadAudio, splicePending bool
	clock                   sampleClock
	lastOutput              time.Time
}

func newPlayout() *playout {
	return &playout{target: frameSamples, volume: .5, clock: newSampleClock()}
}
func (p *playout) reset() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.head, p.size, p.target = 0, 0, frameSamples
	p.started, p.seen = false, false
	p.stats = audioStats{}
	p.tone = 0
	p.lastPacket = time.Time{}
	p.resumeAt = time.Time{}
	p.lastSample, p.spliceFrom, p.spliceLeft = 0, 0, 0
	p.hadAudio, p.splicePending = false, false
	p.clock = newSampleClock()
	p.lastOutput = time.Time{}
}
func (p *playout) beat() { p.mu.Lock(); p.heartbeat = time.Now(); p.mu.Unlock() }
func (p *playout) setVolume(v float64) {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1 {
		return
	}
	p.mu.Lock()
	p.volume = v
	p.mu.Unlock()
}
func (p *playout) testTone() { p.mu.Lock(); p.tone = rate / 3; p.mu.Unlock() }
func (p *playout) snapshot() audioStats {
	p.mu.Lock()
	defer p.mu.Unlock()
	s := p.stats
	s.QueueMs = float64(p.size) / 48
	s.TargetMs = float64(p.target) / 48
	if p.clock.measured {
		floor, peak := p.clock.floorMs, p.clock.peakMs
		s.QueueFloorMs, s.QueuePeakMs = &floor, &peak
	}
	s.ClockCorrection = (p.clock.rate - 1) * 1e6
	return s
}

func (p *playout) appendSample(sample int16, boundary bool) {
	i := (p.head + p.size) % len(p.buf)
	p.buf[i], p.boundary[i] = sample, boundary
	p.size++
}
func (p *playout) beginSplice() {
	p.spliceFrom, p.spliceLeft = p.lastSample, spliceSamples
}
func (p *playout) smooth(sample float64) int16 {
	if p.spliceLeft > 0 {
		weight := float64(spliceSamples-p.spliceLeft+1) / spliceSamples
		sample = p.spliceFrom*(1-weight) + sample*weight
		p.spliceLeft--
	}
	p.lastSample = sample
	return int16(sample * p.volume)
}
func (p *playout) clearQueue() {
	p.head, p.size = 0, 0
	p.started = false
	p.resumeAt = time.Time{}
	p.clock = newSampleClock()
	if p.hadAudio {
		p.beginSplice()
	}
	p.stats.Resets++
}

// Header: ASCII MT01, sequence uint32 LE, sample rate uint32 LE, 240 PCM16 samples.
// Authentication is bound to the WebTransport session, not supplied by packets.
func (p *playout) push(b []byte, now time.Time) bool {
	if len(b) != 12+frameSamples*2 || string(b[:4]) != "MT01" || binary.LittleEndian.Uint32(b[8:12]) != rate {
		return false
	}
	seq := binary.LittleEndian.Uint32(b[4:8])
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.seen && int32(seq-p.seq) <= 0 {
		p.stats.Dropped++
		return false
	}
	if !p.lastPacket.IsZero() {
		p.stats.MaxGapMs = math.Max(p.stats.MaxGapMs, float64(now.Sub(p.lastPacket))/float64(time.Millisecond))
		if now.Sub(p.lastPacket) > staleAudioAfter {
			p.clearQueue()
		}
	}
	gapBoundary := false
	if p.seen && seq-p.seq > 1 {
		gap := seq - p.seq - 1
		p.stats.Dropped += uint64(gap)
		// Smooth both ends of short losses instead of hard-cutting to/from zero.
		if gap <= 2 && p.size+int(gap+1)*frameSamples <= maxQueuedSamples {
			for i := 0; i < int(gap)*frameSamples; i++ {
				p.appendSample(0, i == 0)
			}
			gapBoundary = true
		} else {
			p.clearQueue()
		}
	}
	if excess := p.size + frameSamples - maxQueuedSamples; excess > 0 {
		// Keep useful audio and playback running. Emptying the entire queue here
		// caused a repeated reset/refill cycle with batched browser callbacks.
		// The cap must also accommodate the ~100 ms arrival gaps observed on
		// physical phones. A 50 ms cap discarded valid speech from these bursts.
		p.head = (p.head + excess) % len(p.buf)
		p.size -= excess
		p.stats.Trims++
		p.stats.Trimmed += uint64(excess)
		p.splicePending = true
		p.clock.phase = 0
	}
	if p.size == 0 && !p.started && p.hadAudio && p.resumeAt.IsZero() {
		// A whole burst immediately exceeds the sample-count target. After an
		// underrun, reserve one frame of real time as well, so restarting on
		// the first burst does not repeat the same starvation on the next one.
		p.resumeAt = now.Add(5 * time.Millisecond)
	}
	for i := 0; i < frameSamples; i++ {
		p.appendSample(int16(binary.LittleEndian.Uint16(b[12+i*2:])), gapBoundary && i == 0)
	}
	p.seq, p.seen, p.lastPacket = seq, true, now
	p.stats.Received++
	return true
}

func (p *playout) render(out []byte, now time.Time) {
	clear(out)
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stats.OutputCallbacks++
	if !p.lastOutput.IsZero() {
		p.stats.MaxOutputGapMs = math.Max(p.stats.MaxOutputGapMs, float64(now.Sub(p.lastOutput))/float64(time.Millisecond))
	}
	p.lastOutput = now
	p.stats.OutputBlockMs = float64(len(out)/2) / 48
	// A suspended tab or lost control connection cannot leave a microphone open.
	if p.heartbeat.IsZero() || now.Sub(p.heartbeat) > time.Second {
		p.size = 0
		p.started = false
		p.resumeAt = time.Time{}
		p.tone = 0
		p.lastSample, p.spliceLeft = 0, 0
		p.hadAudio, p.splicePending = false, false
		p.clock = newSampleClock()
		return
	}
	if p.tone > 0 {
		for i := 0; i+1 < len(out) && p.tone > 0; i += 2 {
			phase := float64(rate/3 - p.tone)
			envelope := math.Min(1, math.Min(phase/240, float64(p.tone)/240))
			v := int16(math.Sin(phase*2*math.Pi*660/rate) * .08 * p.volume * envelope * 32767)
			binary.LittleEndian.PutUint16(out[i:], uint16(v))
			p.tone--
		}
		return
	}
	if now.Sub(p.lastPacket) > staleAudioAfter {
		if p.size > 0 || p.started {
			p.clearQueue()
		}
	}
	if !p.started {
		if p.size >= p.target && !now.Before(p.resumeAt) {
			p.started = true
			p.resumeAt = time.Time{}
			if p.hadAudio {
				p.beginSplice()
			}
		}
	}
	for i := 0; i+1 < len(out); i += 2 {
		if p.started && p.size == 0 {
			p.started = false
			p.resumeAt = time.Time{}
			p.target = min(p.target+frameSamples, 4*frameSamples)
			p.stats.Underruns++
			p.beginSplice()
			p.clock.phase = 0
		}
		var sample float64
		if p.started {
			if p.splicePending || p.boundary[p.head] {
				p.beginSplice()
				p.splicePending = false
				p.boundary[p.head] = false
			}
			sample = float64(p.buf[p.head])
			next := (p.head + 1) % len(p.buf)
			if p.size > 1 && !p.boundary[next] {
				sample += (float64(p.buf[next]) - sample) * p.clock.phase
			}
			p.clock.phase += p.clock.rate
			consume := int(p.clock.phase)
			p.clock.phase -= float64(consume)
			if consume >= p.size {
				consume = p.size
				p.clock.phase = 0
			}
			for j := 0; j < consume; j++ {
				if j > 0 && p.boundary[p.head] {
					p.splicePending = true
				}
				p.head = (p.head + 1) % len(p.buf)
				p.size--
			}
			p.hadAudio = true
			p.stats.Played += uint64(consume)
		}
		v := p.smooth(sample)
		binary.LittleEndian.PutUint16(out[i:], uint16(v))
	}
	if p.hadAudio {
		p.clock.observe(p.size, now)
	}
}
