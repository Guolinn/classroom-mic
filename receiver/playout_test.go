package main

import (
	"encoding/binary"
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
	if s.QueueMs > 30 || s.Resets == 0 {
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
	if p.snapshot().TargetMs > 20 { t.Fatal("unbounded recovery target") }
	p.reset()
	if p.snapshot().TargetMs != 5 {
		t.Fatal("next speaker inherited recovery buffer")
	}
}
