package main

import (
	"encoding/binary"
	"math"
	"sync"
	"time"
)

const rate = 48000
const frameSamples = 240 // Five milliseconds, mono PCM16.

// These counters describe this queue only, never acoustic end-to-end latency.
type audioStats struct {
	OutputCallbacks uint64 `json:"outputCallbacks"`
	Received  uint64  `json:"received"`
	Played    uint64  `json:"playedSamples"`
	Dropped   uint64  `json:"dropped"`
	Underruns uint64  `json:"underruns"`
	Resets    uint64  `json:"resets"`
	QueueMs   float64 `json:"queueMs"`
	TargetMs  float64 `json:"targetMs"`
}

type playout struct {
	mu                    sync.Mutex
	buf                   [4096]int16
	head, size, target    int
	started, seen         bool
	seq                   uint32
	volume                float64
	lastPacket, heartbeat time.Time
	stats                 audioStats
	tone                  int
}

func newPlayout() *playout { return &playout{target: frameSamples, volume: .5} }
func (p *playout) reset() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.head, p.size, p.target = 0, 0, frameSamples
	p.started, p.seen = false, false
	p.stats = audioStats{}
	p.tone = 0
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
	return s
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
	if p.seen && seq-p.seq > 1 {
		gap := seq - p.seq - 1
		p.stats.Dropped += uint64(gap)
		// A short missing packet becomes silence; a long gap starts fresh.
		if gap <= 2 && p.size+int(gap)*frameSamples < 1440 {
			for i := 0; i < int(gap)*frameSamples; i++ {
				p.buf[(p.head+p.size)%len(p.buf)] = 0
				p.size++
			}
		} else {
			p.head, p.size = 0, 0
			p.started = false
			p.stats.Resets++
		}
	}
	if p.size+frameSamples > 1440 || (!p.lastPacket.IsZero() && now.Sub(p.lastPacket) > 100*time.Millisecond) {
		p.head, p.size = 0, 0
		p.started = false
		p.stats.Resets++
	}
	for i := 0; i < frameSamples; i++ {
		p.buf[(p.head+p.size)%len(p.buf)] = int16(binary.LittleEndian.Uint16(b[12+i*2:]))
		p.size++
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
	// A suspended tab or lost control connection cannot leave a microphone open.
	if p.heartbeat.IsZero() || now.Sub(p.heartbeat) > time.Second {
		p.size = 0
		p.started = false
		p.tone = 0
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
	if now.Sub(p.lastPacket) > 100*time.Millisecond {
		p.size = 0
		p.started = false
		return
	}
	if !p.started {
		if p.size < p.target {
			return
		}
		p.started = true
	}
	for i := 0; i+1 < len(out); i += 2 {
		if p.size == 0 {
			p.started = false
			p.target = min(p.target+frameSamples, 4*frameSamples)
			p.stats.Underruns++
			return
		}
		v := int16(float64(p.buf[p.head]) * p.volume)
		binary.LittleEndian.PutUint16(out[i:], uint16(v))
		p.head = (p.head + 1) % len(p.buf)
		p.size--
		p.stats.Played++
	}
}
