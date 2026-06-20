use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tokio::sync::mpsc;

use tsclientlib::audio::AudioHandler;
use tsclientlib::ClientId;
use tsproto_packets::packets::{AudioData, CodecType, OutAudio, OutPacket};

pub const SAMPLE_RATE: u32 = 48000;
/// 20 ms mono frame at 48 kHz.
const FRAME: usize = SAMPLE_RATE as usize / 50;
/// 10 ms mono frame at 48 kHz — the fixed block size WebRTC APM requires.
const APM_FRAME: usize = SAMPLE_RATE as usize / 100;
const MAX_OPUS: usize = 1275;

pub type Handler = AudioHandler<ClientId>;

/// WebRTC audio processing module (AEC3 echo cancel + noise suppression + AGC),
/// shared between the playback and capture callbacks.
///
/// The official TS3 client runs this exact pipeline; without it we have no echo
/// cancellation at all (a speaker + open mic loops the far-end audio straight
/// back). AEC3 needs to know what we *played* (the far-end / "render" signal)
/// to subtract it from what we *captured*, so the same `Processor` instance is
/// fed render frames in the output callback and capture frames in the input
/// callback. Its methods take `&self`, so an `Arc` (no mutex) is enough.
pub struct Apm {
    proc: webrtc_audio_processing::Processor,
    /// Toggles, read every frame so the UI can flip them live.
    pub enabled: std::sync::atomic::AtomicBool,
}

impl Apm {
    fn new() -> Result<Arc<Self>> {
        use webrtc_audio_processing::Processor;
        let proc = Processor::new(SAMPLE_RATE)
            .map_err(|e| anyhow!("webrtc apm init: {e:?}"))?;
        let apm = Self {
            proc,
            enabled: std::sync::atomic::AtomicBool::new(true),
        };
        apm.set_denoise(DenoiseMode::Webrtc);
        Ok(Arc::new(apm))
    }

    /// Apply config for the given denoise mode. AEC + AGC + high-pass are always
    /// on; only the WebRTC noise suppressor is toggled — it's disabled when
    /// DeepFilterNet is doing denoise, to avoid stacking two suppressors.
    fn set_denoise(&self, mode: DenoiseMode) {
        use webrtc_audio_processing::config;
        let noise_suppression = match mode {
            DenoiseMode::Webrtc => Some(config::NoiseSuppression {
                // VeryHigh — the most aggressive WebRTC level, to get closer to
                // the official client's perceived strength (it pairs NS with a
                // transient suppressor we can't configure here).
                level: config::NoiseSuppressionLevel::VeryHigh,
                analyze_linear_aec_output: false,
            }),
            DenoiseMode::Off | DenoiseMode::DeepFilter => None,
        };
        let cfg = config::Config {
            high_pass_filter: Some(config::HighPassFilter { apply_in_full_band: true }),
            echo_canceller: Some(config::EchoCanceller::default()),
            noise_suppression,
            gain_controller: Some(config::GainController::GainController2(
                config::GainController2::default(),
            )),
            ..Default::default()
        };
        self.proc.set_config(cfg);
    }

    fn is_enabled(&self) -> bool {
        self.enabled.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Feed one 10 ms mono frame of the about-to-be-played signal as the AEC
    /// reference. `frame.len()` must equal [`APM_FRAME`].
    fn process_render(&self, frame: &mut [f32]) {
        let mut chans = [frame];
        let _ = self.proc.process_render_frame(&mut chans[..]);
    }

    /// Run one 10 ms mono capture frame through the pipeline in place.
    fn process_capture(&self, frame: &mut [f32]) {
        let mut chans = [frame];
        let _ = self.proc.process_capture_frame(&mut chans[..]);
    }
}

/// Which noise-suppression stage is active. WebRTC and DeepFilter are mutually
/// exclusive so we never double-denoise (which smears speech). AEC + AGC stay
/// on regardless — this only selects the denoiser.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DenoiseMode {
    /// No noise suppression (AEC/AGC still run).
    Off,
    /// WebRTC APM's built-in suppressor.
    Webrtc,
    /// DeepFilterNet3 — deep-learning denoise, stronger on non-stationary noise.
    DeepFilter,
}

impl DenoiseMode {
    pub fn from_str(s: &str) -> Self {
        match s {
            "off" => DenoiseMode::Off,
            "deepfilter" => DenoiseMode::DeepFilter,
            _ => DenoiseMode::Webrtc,
        }
    }
}

/// DeepFilterNet3 denoiser. Runs on the capture path *after* the APM (so AEC
/// has already removed echo), replacing WebRTC's suppressor with a much
/// stronger deep model. Processes one `hop_size` (480 @ 48 kHz = 10 ms) mono
/// frame at a time, matching the APM block size exactly.
///
/// Lives in the input callback (cpal callbacks are single-threaded), so no
/// locking is needed — `process` takes `&mut self` and the struct is owned by
/// the closure.
pub struct Denoiser {
    model: df::tract::DfTract,
    pub hop_size: usize,
}

// `DfTract` holds `Rc<Tensor>`/`Box<dyn OpState>` internally, so it is `!Send`.
// cpal's stream callback requires `Send` (the stream may outlive the spawning
// thread), but the callback itself only ever runs on the single audio thread
// and the `Denoiser` is owned solely by that closure — never shared or moved
// across threads concurrently. This is the same justification webrtc-audio-
// processing uses for its own `unsafe impl Send`. Safe in this usage.
unsafe impl Send for Denoiser {}

impl Denoiser {
    fn new() -> Result<Self> {
        use df::tract::{DfParams, DfTract, RuntimeParams};
        let params = DfParams::default();
        let rp = RuntimeParams::default_with_ch(1);
        let model =
            DfTract::new(params, &rp).map_err(|e| anyhow!("deepfilter init: {e:?}"))?;
        let hop_size = model.hop_size;
        Ok(Self { model, hop_size })
    }

    /// Enhance one `hop_size` mono frame in place.
    fn process(&mut self, frame: &mut [f32]) {
        use ndarray::{ArrayView2, ArrayViewMut2};
        // DFN works out-of-place: read from `noisy`, write to `enh`.
        let noisy = frame.to_vec();
        let noisy = match ArrayView2::from_shape((1, frame.len()), &noisy) {
            Ok(v) => v,
            Err(_) => return,
        };
        let enh = match ArrayViewMut2::from_shape((1, frame.len()), frame) {
            Ok(v) => v,
            Err(_) => return,
        };
        let _ = self.model.process(noisy, enh);
    }
}

/// Build the Opus encoder with TeamSpeak-grade voice settings.
///
/// The bare `Encoder::new` defaults waste quality on a chat path: no in-band
/// FEC means a single lost packet is a dropout the decoder can't repair, and
/// the encoder doesn't know the signal is speech. We match what the official
/// client asks of libopus: speech-tuned, 32 kbit/s VBR, and in-band FEC primed
/// for ~10% loss.
fn build_encoder() -> Result<audiopus::coder::Encoder> {
    use audiopus::{Application, Bitrate, Channels, SampleRate, Signal};
    let mut enc = audiopus::coder::Encoder::new(
        SampleRate::Hz48000,
        Channels::Mono,
        Application::Voip,
    )
    .map_err(|e| anyhow!("opus encoder: {e}"))?;
    // Tell libopus this is speech so it routes through the SILK path.
    let _ = enc.set_signal(Signal::Voice);
    // 32 kbit/s VBR — TS3's default voice target; transparent for speech.
    let _ = enc.set_bitrate(Bitrate::BitsPerSecond(32_000));
    let _ = enc.set_vbr(true);
    // In-band FEC + a loss estimate so the decoder can reconstruct dropped
    // frames from the redundancy in the *next* packet (see AudioQueue's FEC).
    let _ = enc.set_inband_fec(true);
    let _ = enc.set_packet_loss_perc(10);
    // NOTE: deliberately no DTX. libopus DTX emits 1-byte silence frames, and
    // the receiver's jitter buffer treats any packet with <=1 data byte as an
    // end-of-stream marker — that collision would make the talk indicator
    // flicker. We gate silence ourselves via VAD + an explicit end packet.
    Ok(enc)
}

/// State shared between the cpal callbacks and the worker thread. Survives
/// stream rebuilds (device switching), so settings persist across changes.
#[derive(Clone)]
pub struct Shared {
    pub handler: Arc<Mutex<Handler>>,
    pub muted: Arc<Mutex<bool>>,
    pub deafened: Arc<Mutex<bool>>,
    pub talking: Arc<Mutex<Vec<u16>>>,
    /// Capture gain multiplier (mic volume).
    pub mic_gain: Arc<Mutex<f32>>,
    /// Playback gain multiplier (speaker volume).
    pub spk_gain: Arc<Mutex<f32>>,
    /// RMS threshold for voice activation; 0.0 = always transmit.
    pub sensitivity: Arc<Mutex<f32>>,
    /// Push-to-talk mode enabled.
    pub ptt_enabled: Arc<Mutex<bool>>,
    /// PTT key currently held.
    pub ptt_active: Arc<Mutex<bool>>,
    /// WebRTC echo-cancel/denoise/AGC pipeline. `None` if init failed.
    pub apm: Option<Arc<Apm>>,
    /// Selected noise-suppression stage (Off / WebRTC / DeepFilter).
    pub denoise_mode: Arc<Mutex<DenoiseMode>>,
    /// Per-speaker playback volume multipliers (client id → gain). Missing =
    /// 1.0. Applied to each talker's queue before mixing.
    pub client_volumes: Arc<Mutex<std::collections::HashMap<u16, f32>>>,
    /// Mic-test mode: loop captured (processed) audio back to the local speaker
    /// instead of sending it. Lets the user hear their own mic + denoise.
    pub mic_test: Arc<Mutex<bool>>,
    /// Ring of mono 48 kHz samples staged for loopback playback during mic test.
    pub loopback: Arc<Mutex<std::collections::VecDeque<f32>>>,
}

impl Shared {
    fn new() -> Self {
        let apm = match Apm::new() {
            Ok(a) => Some(a),
            Err(e) => {
                tracing::error!(%e, "webrtc apm init failed; running without echo cancel/denoise");
                None
            }
        };
        Self {
            handler: Arc::new(Mutex::new(Handler::new())),
            muted: Arc::new(Mutex::new(false)),
            deafened: Arc::new(Mutex::new(false)),
            talking: Arc::new(Mutex::new(Vec::new())),
            mic_gain: Arc::new(Mutex::new(1.0)),
            spk_gain: Arc::new(Mutex::new(1.0)),
            sensitivity: Arc::new(Mutex::new(0.0)),
            ptt_enabled: Arc::new(Mutex::new(false)),
            ptt_active: Arc::new(Mutex::new(false)),
            apm,
            denoise_mode: Arc::new(Mutex::new(DenoiseMode::Webrtc)),
            client_volumes: Arc::new(Mutex::new(std::collections::HashMap::new())),
            mic_test: Arc::new(Mutex::new(false)),
            loopback: Arc::new(Mutex::new(std::collections::VecDeque::new())),
        }
    }
}

/// Owns the cpal streams (which are `!Send`, so they live on the worker thread).
pub struct AudioEngine {
    input: Option<cpal::Stream>,
    output: Option<cpal::Stream>,
    host: cpal::Host,
    mic_tx: mpsc::Sender<OutPacket>,
    pub shared: Shared,
}

/// Enumerate available input and output device names.
pub fn list_devices() -> (Vec<String>, Vec<String>) {
    let host = cpal::default_host();
    let inputs = host
        .input_devices()
        .map(|it| it.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default();
    let outputs = host
        .output_devices()
        .map(|it| it.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default();
    (inputs, outputs)
}

/// Find a device by name, or fall back to the host default.
fn find_device(
    host: &cpal::Host,
    name: Option<&str>,
    input: bool,
) -> Option<cpal::Device> {
    if let Some(name) = name {
        let devs = if input { host.input_devices() } else { host.output_devices() };
        if let Ok(mut devs) = devs {
            if let Some(d) = devs.find(|d| d.name().map(|n| n == name).unwrap_or(false)) {
                return Some(d);
            }
        }
    }
    if input {
        host.default_input_device()
    } else {
        host.default_output_device()
    }
}


/// Pick a stream config, preferring 48 kHz (the TS/Opus native rate).
fn pick_config(
    supported: impl Iterator<Item = cpal::SupportedStreamConfigRange>,
    want_channels: u16,
) -> Option<cpal::SupportedStreamConfig> {
    let ranges: Vec<_> = supported.collect();
    // Prefer exact 48 kHz with the desired channel count.
    for r in &ranges {
        if r.channels() == want_channels
            && r.min_sample_rate().0 <= SAMPLE_RATE
            && r.max_sample_rate().0 >= SAMPLE_RATE
        {
            return Some(r.clone().with_sample_rate(cpal::SampleRate(SAMPLE_RATE)));
        }
    }
    // Fall back: any range that covers 48 kHz.
    for r in &ranges {
        if r.min_sample_rate().0 <= SAMPLE_RATE && r.max_sample_rate().0 >= SAMPLE_RATE {
            return Some(r.clone().with_sample_rate(cpal::SampleRate(SAMPLE_RATE)));
        }
    }
    ranges.into_iter().next().map(|r| r.with_max_sample_rate())
}

impl AudioEngine {
    /// `mic_tx` receives encoded Opus packets to forward to `con.send_audio`.
    pub fn new(mic_tx: mpsc::Sender<OutPacket>) -> Result<Self> {
        let host = cpal::default_host();
        let shared = Shared::new();
        let mut engine = Self { input: None, output: None, host, mic_tx, shared };
        engine.rebuild_output(None)?;
        engine.rebuild_input(None)?;
        Ok(engine)
    }

    pub fn rebuild_output(&mut self, name: Option<&str>) -> Result<()> {
        self.output = None; // drop old stream first
        let stream = build_output(&self.host, name, self.shared.clone())?;
        stream.play()?;
        self.output = Some(stream);
        Ok(())
    }

    pub fn rebuild_input(&mut self, name: Option<&str>) -> Result<()> {
        self.input = None;
        let stream = build_input(&self.host, name, self.mic_tx.clone(), self.shared.clone())?;
        stream.play()?;
        self.input = Some(stream);
        Ok(())
    }
}

fn build_output(
    host: &cpal::Host,
    name: Option<&str>,
    shared: Shared,
) -> Result<cpal::Stream> {
    let device =
        find_device(host, name, false).ok_or_else(|| anyhow!("no output device"))?;
    let cfg = pick_config(device.supported_output_configs()?, 2)
        .ok_or_else(|| anyhow!("no usable output config"))?;
    let channels = cfg.channels() as usize;
    let config: cpal::StreamConfig = cfg.into();

    let Shared {
        handler, deafened, talking, spk_gain, apm, client_volumes, mic_test, loopback, ..
    } = shared;
    // Scratch buffer of 48 kHz stereo samples pulled from the handler.
    let mut scratch: Vec<f32> = Vec::new();
    // Accumulates mono playback samples to feed AEC in exact 10 ms blocks.
    let mut render_acc: Vec<f32> = Vec::with_capacity(APM_FRAME * 2);
    let stream = device.build_output_stream(
        &config,
        move |out: &mut [f32], _| {
            // Deafened: output silence and skip mixing entirely.
            if *deafened.lock().unwrap() {
                for s in out.iter_mut() {
                    *s = 0.0;
                }
                talking.lock().unwrap().clear();
                return;
            }
            let frames = out.len() / channels;
            scratch.resize(frames * 2, 0.0);
            for s in scratch.iter_mut() {
                *s = 0.0;
            }
            if *mic_test.lock().unwrap() {
                // Mic test: play the looped-back mic samples (mono → stereo
                // scratch) instead of remote talkers.
                let mut lb = loopback.lock().unwrap();
                for i in 0..frames {
                    let s = lb.pop_front().unwrap_or(0.0);
                    scratch[i * 2] = s;
                    scratch[i * 2 + 1] = s;
                }
                talking.lock().unwrap().clear();
            } else {
                // Apply per-speaker volume to each talker's queue before mixing.
                let vols = client_volumes.lock().unwrap();
                let mut h = handler.lock().unwrap();
                for (id, queue) in h.get_mut_queues().iter_mut() {
                    queue.volume = vols.get(&id.0).copied().unwrap_or(1.0);
                }
                let active = h.fill_buffer(&mut scratch);
                *talking.lock().unwrap() = active.iter().map(|id| id.0).collect();
            }
            let gain = *spk_gain.lock().unwrap();
            // Map 48 kHz stereo scratch → device channel layout, applying gain.
            for (i, frame) in out.chunks_mut(channels).enumerate() {
                let l = scratch[i * 2] * gain;
                let r = scratch[i * 2 + 1] * gain;
                match channels {
                    1 => frame[0] = (l + r) * 0.5,
                    _ => {
                        frame[0] = l;
                        frame[1] = r;
                        for c in frame.iter_mut().skip(2) {
                            *c = 0.0;
                        }
                    }
                }
            }
            // Feed the just-played signal to AEC as the render reference, mono,
            // in 10 ms blocks. This is what makes echo cancellation possible:
            // the capture side subtracts this from the mic input.
            if let Some(apm) = &apm {
                if apm.is_enabled() {
                    for i in 0..frames {
                        render_acc.push((scratch[i * 2] + scratch[i * 2 + 1]) * 0.5 * gain);
                    }
                    while render_acc.len() >= APM_FRAME {
                        let mut block: Vec<f32> = render_acc.drain(..APM_FRAME).collect();
                        apm.process_render(&mut block);
                    }
                }
            }
        },
        |err| tracing::error!(%err, "output stream error"),
        None,
    )?;
    Ok(stream)
}

fn build_input(
    host: &cpal::Host,
    name: Option<&str>,
    mic_tx: mpsc::Sender<OutPacket>,
    shared: Shared,
) -> Result<cpal::Stream> {
    let device =
        find_device(host, name, true).ok_or_else(|| anyhow!("no input device"))?;
    let cfg = pick_config(device.supported_input_configs()?, 1)
        .ok_or_else(|| anyhow!("no usable input config"))?;
    let in_channels = cfg.channels() as usize;
    let in_rate = cfg.sample_rate().0;
    let config: cpal::StreamConfig = cfg.into();

    let encoder = build_encoder()?;

    let Shared {
        muted, mic_gain, sensitivity, ptt_enabled, ptt_active, apm, denoise_mode,
        mic_test, loopback, ..
    } = shared;
    // Accumulate mono 48 kHz samples until we have a full 20 ms frame.
    let mut acc: Vec<f32> = Vec::with_capacity(FRAME * 2);
    // Staging buffer for resampled audio awaiting 10 ms APM processing.
    let mut apm_stage: Vec<f32> = Vec::with_capacity(APM_FRAME * 2);
    let mut resampler = LinearResampler::new(in_rate, SAMPLE_RATE);
    let mut opus_out = [0u8; MAX_OPUS];

    // DeepFilterNet3 denoiser, created once per stream. hop_size is 480 @ 48 kHz
    // (10 ms), the same block size as the APM, so a single 10 ms loop drives
    // both. `None` if model/tract init fails — we just skip DFN then.
    let mut denoiser = match Denoiser::new() {
        Ok(d) => {
            if d.hop_size != APM_FRAME {
                tracing::warn!(hop = d.hop_size, "DFN hop != 480; disabling DFN");
                None
            } else {
                Some(d)
            }
        }
        Err(e) => {
            tracing::error!(%e, "deepfilter init failed; AI denoise unavailable");
            None
        }
    };
    // Tracks the denoise mode the APM is currently configured for, so we only
    // call set_denoise when it actually changes. APM starts in Webrtc.
    let mut last_mode = DenoiseMode::Webrtc;

    // VAD state machine. `transmitting` is true during a talk burst;
    // `hold_frames` keeps the mic open for a short tail after the level drops
    // below threshold, so quiet word endings ("...s", "...ng") aren't clipped.
    // When a burst ends we emit one empty packet — the receiver's jitter buffer
    // reads a <=1-byte payload as end-of-stream and drops the talk highlight at
    // once, instead of waiting ~3 lost packets to time out.
    let mut transmitting = false;
    let mut hold_frames: u32 = 0;
    // ~240 ms tail at 20 ms/frame.
    const HOLD: u32 = 12;

    let send_end = |tx: &mpsc::Sender<OutPacket>| {
        let end = OutAudio::new(&AudioData::C2S {
            id: 0,
            codec: CodecType::OpusVoice,
            data: &[],
        });
        let _ = tx.try_send(end);
    };

    let stream = device.build_input_stream(
        &config,
        move |input: &[f32], _| {
            // Mic test bypasses mute/PTT so the user can always hear themselves.
            let gated = !*mic_test.lock().unwrap()
                && (*muted.lock().unwrap()
                    || (*ptt_enabled.lock().unwrap() && !*ptt_active.lock().unwrap()));
            if gated {
                // Mute or PTT release: close the burst cleanly and discard any
                // half-buffered audio so we don't resume with stale samples.
                if transmitting {
                    send_end(&mic_tx);
                    transmitting = false;
                    hold_frames = 0;
                }
                acc.clear();
                apm_stage.clear();
                return;
            }
            let gain = *mic_gain.lock().unwrap();
            // Downmix interleaved → mono, applying mic gain.
            let mono = input.chunks(in_channels).map(|f| {
                f.iter().copied().sum::<f32>() / in_channels as f32 * gain
            });

            // Resolve the active denoise mode; when it changes, reconfigure the
            // APM (WebRTC suppressor on only in Webrtc mode).
            let mode = *denoise_mode.lock().unwrap();
            if mode != last_mode {
                if let Some(apm) = &apm {
                    apm.set_denoise(mode);
                }
                last_mode = mode;
            }

            // Capture chain, all in 10 ms blocks: APM (AEC/AGC, +WebRTC NS in
            // Webrtc mode) → DeepFilterNet (only in DeepFilter mode) → 20 ms acc.
            match &apm {
                Some(apm) if apm.is_enabled() => {
                    resampler.process(mono, &mut apm_stage);
                    while apm_stage.len() >= APM_FRAME {
                        let mut block: Vec<f32> = apm_stage.drain(..APM_FRAME).collect();
                        apm.process_capture(&mut block);
                        if mode == DenoiseMode::DeepFilter {
                            if let Some(d) = &mut denoiser {
                                d.process(&mut block);
                            }
                        }
                        acc.extend_from_slice(&block);
                    }
                }
                // No APM: still run DFN directly if selected.
                _ => {
                    resampler.process(mono, &mut apm_stage);
                    while apm_stage.len() >= APM_FRAME {
                        let mut block: Vec<f32> = apm_stage.drain(..APM_FRAME).collect();
                        if mode == DenoiseMode::DeepFilter {
                            if let Some(d) = &mut denoiser {
                                d.process(&mut block);
                            }
                        }
                        acc.extend_from_slice(&block);
                    }
                }
            }

            let threshold = *sensitivity.lock().unwrap();
            let testing = *mic_test.lock().unwrap();
            while acc.len() >= FRAME {
                let frame: Vec<f32> = acc.drain(..FRAME).collect();

                // Mic test: play the processed frame back locally instead of
                // sending it to the server. Cap the ring so it can't grow
                // unbounded if playback stalls.
                if testing {
                    let mut lb = loopback.lock().unwrap();
                    if lb.len() < SAMPLE_RATE as usize {
                        lb.extend(frame.iter().copied());
                    }
                    continue;
                }

                // Voice activation. threshold == 0.0 means continuous transmit.
                let voiced = if threshold > 0.0 {
                    let rms = (frame.iter().map(|s| s * s).sum::<f32>()
                        / frame.len() as f32)
                        .sqrt();
                    rms >= threshold
                } else {
                    true
                };

                if voiced {
                    transmitting = true;
                    hold_frames = HOLD;
                } else if transmitting && hold_frames > 0 {
                    // In the tail window: keep sending so the ending isn't cut.
                    hold_frames -= 1;
                } else if transmitting {
                    // Tail expired: end the burst and stop encoding silence.
                    send_end(&mic_tx);
                    transmitting = false;
                    continue;
                } else {
                    // Idle and below threshold: nothing to send.
                    continue;
                }

                match encoder.encode_float(&frame, &mut opus_out[..]) {
                    Ok(len) => {
                        let packet = OutAudio::new(&AudioData::C2S {
                            id: 0,
                            codec: CodecType::OpusVoice,
                            data: &opus_out[..len],
                        });
                        let _ = mic_tx.try_send(packet);
                    }
                    Err(e) => tracing::error!(%e, "opus encode failed"),
                }
            }
        },
        |err| tracing::error!(%err, "input stream error"),
        None,
    )?;
    Ok(stream)
}

/// Minimal linear resampler for the mic path (device rate → 48 kHz mono).
/// Voice-quality only; a no-op when rates already match.
struct LinearResampler {
    ratio: f64,
    pos: f64,
    last: f32,
    passthrough: bool,
}

impl LinearResampler {
    fn new(from: u32, to: u32) -> Self {
        Self {
            ratio: from as f64 / to as f64,
            pos: 0.0,
            last: 0.0,
            passthrough: from == to,
        }
    }

    fn process(&mut self, input: impl Iterator<Item = f32>, out: &mut Vec<f32>) {
        if self.passthrough {
            out.extend(input);
            return;
        }
        for s in input {
            while self.pos < 1.0 {
                let interp = self.last + (s - self.last) * self.pos as f32;
                out.push(interp);
                self.pos += self.ratio;
            }
            self.pos -= 1.0;
            self.last = s;
        }
    }
}
