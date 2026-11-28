package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"math"
	"sort"
	"time"
)

var timingFields = [...]string{"receiptMedianMs", "receiptP95Ms", "receiptSamples", "transportRttMs", "transportMinRttMs", "transportRttVariationMs", "maxCaptureGapMs", "maxDispatchLagMs", "maxSendGapMs", "maxWriteMs"}

func parseSenderTiming(packet []byte) map[string]float64 {
	if len(packet) < 6 || len(packet) > 512 || string(packet[:4]) != "MTS1" {
		return nil
	}
	var supplied map[string]*float64
	if json.Unmarshal(packet[4:], &supplied) != nil {
		return nil
	}
	clean := make(map[string]float64)
	for _, key := range timingFields {
		if v := supplied[key]; v != nil && !math.IsNaN(*v) && !math.IsInf(*v, 0) && *v >= 0 && *v <= 60000 {
			clean[key] = *v
		}
	}
	return clean
}

// Replies must never block audio reception when the reverse path is congested.
// One worker and one queued reply bound the extra work for each audio session.
func receiptReplies(ctx context.Context, send func([]byte) error) chan<- uint32 {
	replies := make(chan uint32, 1)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case seq := <-replies:
				ack := [8]byte{'M', 'T', 'A', '1'}
				binary.LittleEndian.PutUint32(ack[4:], seq)
				if err := send(ack[:]); err != nil {
					return
				}
			}
		}
	}()
	return replies
}

// A bounded recent window, sampled once per native output callback. This is
// arrival-to-render residence, not capture, network or speaker latency.
type residenceTiming struct {
	values      [1024]float64
	next, count int
}

func (t *residenceTiming) observe(arrived, rendered time.Time) {
	if arrived.IsZero() || rendered.Before(arrived) {
		return
	}
	ms := float64(rendered.Sub(arrived)) / float64(time.Millisecond)
	if ms > 1000 {
		return
	}
	t.values[t.next] = ms
	t.next = (t.next + 1) % len(t.values)
	t.count = min(t.count+1, len(t.values))
}

func (t *residenceTiming) snapshot() (median, p95 *float64, count int) {
	if t.count == 0 {
		return nil, nil, 0
	}
	var values [1024]float64
	copy(values[:], t.values[:t.count])
	sort.Float64s(values[:t.count])
	a, b := values[t.count/2], values[min(t.count-1, t.count*95/100)]
	return &a, &b, t.count
}
