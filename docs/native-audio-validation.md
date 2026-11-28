# Native receiver validation — November 27, 2026

## Live output

The owner heard severe crackle during actual iPhone playback, while replaying the same generated audio samples sounded clean. Fixed speech sent locally through the complete transport also sounded clean. Removing the teacher browser from the control path did not eliminate the problem. This distinguished the failure from microphone capture alone and from corruption of the saved PCM; it did not establish a general operating-system defect.

A candidate that opened the sound device only when the phone connected sounded clean. The 0.1.5 implementation closes the device on mute or disconnect and after the speaker test, and opens a fresh device for the next speaking turn. The owner confirmed that a live iPhone microphone through the normal classroom request/approval workflow no longer had electrical noise or broken playback. An optional native integration test reopened the actual output three times, verified that callbacks stopped between uses, and measured startup under 8 ms on this Mac. Ordinary automated tests do not access speakers or microphones. The release receiver does not record audio.

## Remaining delay

The same live microphone report still showed significant queueing:

| Measurement | Observed value | Interpretation |
| --- | --- | --- |
| Receiver arrival to render | median 100.3 ms; 95th percentile 106.1 ms | Time inside the receiver, excluding microphone, network transit and hardware output. |
| Audio receipt round trip | median 9 ms; 95th percentile 74 ms | Sampled acknowledgement timing on the phone's clock; includes scheduling and both directions. |
| Longest arrival gap | 100.0 ms | A period with no new audio arriving at the receiver. |
| Maximum sender interval | 15 ms | The observed phone sender did not report a matching 100 ms pause. |
| Longest output callback gap | 2.8 ms | The native output callback remained regular in this sample. |
| Queue resets / trims / sequence loss | 0 / 0 / 0 | This run preserved received audio rather than discarding it to lower the displayed queue. |

These values must not be added together or interpreted as complete mouth-to-speaker latency. The exact cause of the recurring arrival gaps remains unproven.

A separate iPhone fixed-speech run marked the Mac UDP socket with Darwin's interactive voice network service type. All 2,073 packets arrived, but the longest arrival gap was still 97.2 ms and median receiver residence was 101.9 ms. The receipt round trip was 8 ms median and 68 ms at the 95th percentile. This single comparison did not demonstrate a useful latency improvement, so the socket-setting experiment is not included in 0.1.5.

An offline replay of roughly ten seconds of actual synthetic-speech arrival timing compared hard queue ceilings. A 20 ms ceiling produced a median receiver residence of 16.8 ms but caused 21 underruns and discarded 1,515 ms of audio. A 60 ms ceiling still caused 21 underruns and discarded 755 ms. The existing 120 ms maximum preserved all queued speech, with three startup/recovery underruns and median residence around 96 ms. Lowering the ceiling was therefore rejected as a default fix.

## Recovering after a stall

For a stall that ends and leaves persistent backlog, 0.1.5 adds a smoothly varying resampling fallback when waveform matching cannot find a safe splice. The fallback is limited to +1.8% in addition to the existing +/-0.2% clock correction, can slightly change pitch and tempo, and stops accelerating through renewed arrival gaps. In a deterministic aperiodic single-stall case, the remaining queue falls from about 86 ms without the fallback to 7.2 ms after ten seconds, with no additional starvation or trimming. This is a recovery result, not a claim that recurring 100 ms network gaps can be removed by resampling.

Diagnostics use bounded recent windows and numerical summaries only. Sorting residence measurements happens outside the audio callback's queue lock. Old receivers remain compatible and show unavailable measurements where they cannot acknowledge audio. The 50 JavaScript tests, Go race tests, native lifecycle check and production build passed during this investigation. Actual classroom-speaker acoustic delay remains to be measured.
