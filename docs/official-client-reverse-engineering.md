# TeamSpeak 3 官方客户端逆向分析 & csspeak 差距对比

> 分析对象：`/Applications/TeamSpeak 3 Client.app`（macOS，Qt5 + WebEngine，2023-09 构建）
> 对比对象：本项目 **csspeak**（Tauri 2 + Rust `tsclientlib` + React）
> 分析方法：二进制 `strings` 静态符号提取 + 真实服务器抓包（见记忆 [[ts3-test-server]]）+ `tsclientlib` vendored 源码阅读。
> 文档时间：2026-06-20

本文聚焦**语音链路**的差距（这是用户当前优化重点），同时给出整体功能矩阵。

---

## 1. 官方客户端技术构成（逆向所得）

从二进制符号还原出的源码路径与第三方库，能直接看出官方的音频架构：

| 组件 | 逆向证据（二进制内符号 / 源码路径） | 作用 |
| --- | --- | --- |
| Qt5 UI | `libQt5*.dylib`、`src/UI_qt/setup/vad_control.cpp` | 整个界面与设置面板 |
| WebEngine | `libQt5WebEngineCore`、`qtwebengine_locales` | 内嵌网页（横幅/myTeamSpeak） |
| **team_audio** | `deps/team_audio/team_audio/private/encode_{opus,celt,speex}.cpp` | 官方自研编解码封装层 |
| **WebRTC APM** | `deps/webrtc-sound-processing/webrtc-apm/.../audio_processing/*` | 回声消除 / 降噪 / AGC / VAD |
| Speex DSP | `deps/speex_ts/libspeex/jitter.c`、`nb_celp.c` | jitter buffer、Speex 编解码 |
| libopus | `com::teamspeak::audio::EncodeOPUS` | Opus 编解码 |
| Protobuf | `myteamspeak_*.proto`、`google/protobuf/*` | myTeamSpeak 账号/联系人后端协议 |

### 1.1 编解码器（codec）

二进制内的权限字符串完整列出官方支持的全部 codec：

```
b_channel_create_modify_with_codec_speex8        (Speex 8 kHz  Narrowband)
b_channel_create_modify_with_codec_speex16       (Speex 16 kHz Wideband)
b_channel_create_modify_with_codec_speex32       (Speex 32 kHz Ultra-wideband)
b_channel_create_modify_with_codec_celtmono48    (CELT  48 kHz Mono)
b_channel_create_modify_with_codec_opusvoice     (Opus  语音模式)
b_channel_create_modify_with_codec_opusmusic     (Opus  音乐模式 / 立体声)
```

频道的 codec 由频道属性决定（`codec` + `codec_quality` + `codec_latency_factor`），客户端必须能用频道指定的 codec **编码**自己的发言、**解码**他人的发言。官方 6 种全支持。

### 1.2 采集端音频处理链（WebRTC APM）

这是官方与我们差距最大的部分。逆向出的处理模块（按信号流顺序）：

```
麦克风采集
  → 高通滤波 (high_pass_filter)
  → 回声消除 AEC3        echo_canceller / EchoRemoverImpl / aec3_correlator_pre_echo_lag
  → 降噪                  noise_suppression / NoiseFloorEstimator / denoiser_level
  → 瞬态抑制              TransientSuppressorImpl / transient_suppression
  → 自动增益 AGC          Agc / agc2 / clipping_predictor / "Automatic voice gain control"
  → 语音活动检测 VAD      MonoVadImpl / voice_activity_detector.cc / VADControl
  → 舒适噪声              comfort_noise_enabled / comfort_noise_volume_db
  → Opus/CELT/Speex 编码
```

对应设置面板的人类可读说明（直接从二进制提取）：

- **Echo Cancellation** — "tries to subtract any audio that was played back from the captured signal"（真·回声消除，订阅播放信号做参考）。
- **Echo Reduction (Ducking)** — 说话时压低他人音量，弱化回声（与上面是两套机制）。
- **Automatic voice gain control** — 自动调整采集音量，让你不会比别人太响或太轻。
- **Voice Activity Detection** — 带 `-minvadlevel=` / `-maxvadlevel=` 双阈值 + hold time，远比单一 RMS 阈值稳。
- **Noise Suppression / Denoise** — 带 `denoiser_level` 分级滑块。

### 1.3 协议 / 加密 / 帧格式

抓包与 vendored 源码交叉验证：官方与 `tsclientlib` 在以下层面**完全一致**，这部分无差距：

- 握手：低层 ping/ack（13/15 字节）+ RSA puzzle，EAX/AES 加密。
- 语音帧：Opus Voice，48 kHz，mono，20 ms（50 包/秒）。
- 包结构：C2S `id` 自增、丢包用 `<=1` 字节空 payload 表示流结束。

---

## 2. csspeak 当前语音实现（本项目）

源码：`src-tauri/src/audio.rs`（采集/编码/播放）、`src-tauri/src/connection.rs`（收发路由）。

### 2.1 接收/播放路径 —— 已达官方水准

播放端复用 `tsclientlib` 的 `AudioHandler`（`vendor/.../src/audio.rs`），它实现了一套**自适应 jitter buffer**，质量与官方 Speex jitter buffer 思路一致：

- 每个发言者一条 `AudioQueue`，按包 id 排序、去重、容忍乱序。
- **滑动窗口最小值算法**动态估计抖动，自动伸缩缓冲长度（最大 0.5 s）。
- 缓冲过长时**加速播放**（每 100 样本丢 1 个）或直接截断，压低延迟。
- 丢包用 **Opus 前向纠错（FEC）** 从下一包重建；连续丢包用 **丢包隐藏（PLC）** 补帧；连丢 3 包判定流结束。

结论：**收听质量基本无差距**，差距全在发送端和预处理。

### 2.2 发送/采集路径 —— 本次优化前后

| 环节 | 优化前 | 本次优化后 | 官方 |
| --- | --- | --- | --- |
| Opus 编码器配置 | 全默认（裸 `Encoder::new`） | **signal=Voice、32 kbit/s VBR、in-band FEC、loss=10%** | 同等 + 频道质量档位 |
| 静音判定 VAD | 单帧 RMS 硬阈值，瞬时切断 | **状态机 + 240 ms hold time**，不切词尾 | WebRTC VAD 双阈值 + hold |
| 停止说话 | 不发任何包，靠对端丢包超时 | **显式发空包**，对端立即停高亮 | 同（显式停止） |
| 重采样 | 线性插值 | 线性插值（未改） | WebRTC sinc 重采样 |
| 回声消除 AEC | ❌ 无 | ❌ 仍无 | ✅ WebRTC AEC3 |
| 降噪 | ❌ 无 | ❌ 仍无 | ✅ WebRTC + 分级 |
| 自动增益 AGC | ❌ 无 | ❌ 仍无 | ✅ WebRTC AGC2 |

> 本次代码改动见 `src-tauri/src/audio.rs` 的 `build_encoder()` 与 `build_input()` 输入回调。
> 注意：**故意未开 Opus DTX**——libopus DTX 会发 1 字节静音帧，而接收端把 `<=1` 字节 payload 当作流结束标志，二者冲突会导致说话指示灯闪烁。静音改由我们自己的 VAD + 显式空包处理。

---

## 3. 整体功能矩阵（csspeak vs 官方）

✅ 已实现 ／ ⚠️ 部分 ／ ❌ 缺失

### 语音
| 功能 | csspeak | 官方 | 备注 |
| --- | --- | --- | --- |
| Opus Voice 双向 | ✅ | ✅ | 帧格式一致 |
| 自适应 jitter buffer / FEC / PLC | ✅ | ✅ | 复用 tsclientlib |
| Opus 编码器调优（FEC/VBR/signal） | ✅ | ✅ | **本次新增** |
| VAD hold time + 显式停止 | ✅ | ✅ | **本次新增** |
| 回声消除 / 降噪 / AGC | ❌ | ✅ | **最大差距，需引入 WebRTC APM** |
| CELT / Speex / Opus Music codec | ❌ | ✅ | 进非 Opus 频道会收不到声音 |
| 麦克风/扬声器测试、本地回放 | ❌ | ✅ | |
| Whisper（耳语/喊话列表） | ❌ | ✅ | `WHISPER_LIST` 协议存在 |
| 3D / 定位音效 | ❌ | ✅ | `libQt5Positioning` |

### 功能 / 管理
| 功能 | csspeak | 官方 |
| --- | --- | --- |
| 频道树 / 在线用户 / 切频道 | ✅ | ✅ |
| 文字聊天 / Poke / 书签 | ✅ | ✅ |
| 踢出（频道/服务器）/ clientmute | ✅ | ✅ |
| 连接信息（ping/丢包） | ✅ | ✅ |
| 频道密码 / 特权密钥(token) | ✅ | ✅ |
| 文件传输 | ❌ | ✅ |
| 权限系统 UI / 服务器组 / 频道组 | ❌ | ✅ |
| 投诉 / 封禁管理 | ❌ | ✅ |
| 全局热键（后台 PTT） | ⚠️ 仅前台 | ✅ |
| 头像 / myTeamSpeak 账号 / 联系人 | ❌ | ✅ |

---

## 4. 差距优先级建议

按"对语音体验的实际影响 / 实现成本"排序：

1. **回声消除 + 降噪（高优先）**：扬声器外放场景下，没有 AEC 会把对方的声音重新采集回去形成回声。建议引入 `webrtc-audio-processing` 的 Rust 绑定，挂在 `build_input` 的 mono 帧之后、编码之前。这是离官方体验最大的一道坎。
2. **自动增益 AGC（中优先）**：让不同用户音量一致，体验提升明显，可与 APM 一起引入（同一个库）。
3. **VAD 升级为双阈值（中优先）**：当前 240 ms hold 已缓解切词，但单 RMS 阈值在噪声环境误触发。可换 WebRTC VAD 或 Silero。
4. **CELT/Speex 解码 fallback（低优先）**：仅当用户进入非 Opus 频道才需要；现代服务器几乎都用 Opus。
5. **文件传输 / 权限 UI（功能向，非语音）**：按产品需要再排期。

---

## 5. 复现分析的命令

```bash
BIN="/Applications/TeamSpeak 3 Client.app/Contents/MacOS/ts3client_mac"
# codec 支持
strings -n5 "$BIN" | grep -iE "codec_(speex|celt|opus)"
# 音频处理链
strings -n5 "$BIN" | grep -iE "echo|denoise|agc|vad|comfort|transient|noise_supp"
# 设置面板说明文案
strings -n5 "$BIN" | grep -iE "Automatic voice gain|Echo Cancellation|Voice Activity"
```

---

## 6. 开源语音处理方案调研（2026-06-20）

目标：找到能**在降噪/音质上超越官方 WebRTC APM** 的开源方案，且尽量贴合我们的 Rust 技术栈。

关键认知：官方用的 **WebRTC APM 降噪部分本质是 RNNoise 级别的传统/轻量 RNN 方法**，而深度学习降噪（DeepFilterNet 等）在 2022 年后已系统性超越它。但要分清两件事——**降噪(NS)** 和 **回声消除(AEC)** 是两个独立模块，深度降噪模型基本只做 NS，AEC 仍需单独方案。

### 6.1 降噪方案对比

| 方案 | 语言/集成 | 质量(主观+PESQ) | 算法延迟 | CPU | 许可证 | 评价 |
| --- | --- | --- | --- | --- | --- | --- |
| WebRTC APM 降噪 | C++(官方在用) | 基准线 | ~10 ms | 极低 | BSD | 传统方法,噪声残留明显 |
| RNNoise / nnnoiseless | C / **纯 Rust**(`nnnoiseless` 0.5.2) | 略优于 WebRTC | ~10 ms | 极低 | BSD/MIT | 轻量,稳态噪声好,非稳态一般 |
| **DeepFilterNet3** | **纯 Rust**(`deep_filter` 0.2.5) | **显著超越前两者**,接近商业 Krisp | ~40 ms | 单核可实时(RTF<1) | **MIT / Apache-2.0 双许可** | ⭐ 全频带 48kHz,深度学习,质量最佳且能商用 |
| GTCRN / DTLN | Python/ONNX | 优于 RNNoise | ~30 ms | 中 | 多为研究许可 | 需自己做 Rust/ONNX 集成,生态弱 |
| Krisp | 闭源 SDK | 最佳 | 低 | 低 | 商业付费 | 体验天花板但要钱、不可自建 |

### 6.2 结论：DeepFilterNet3 是最优选择

理由（按重要性）：

1. **纯 Rust，零外部运行时**：`deep_filter` crate 依赖全是 Rust 数值库(`rustfft`/`realfft`/`ndarray`/`rubato`)，**没有 Python、没有 ONNX runtime、没有 libtorch**。可以像 tsclientlib 一样直接 `use`，与我们的 Tauri 后端无缝集成，符合记忆里"不依赖外部 git 仓库、可 vendor"的原则。
2. **质量确实超官方**：DeepFilterNet 系列在 DNS-Challenge 数据集上 PESQ/POLQA 明显高于 RNNoise(官方 APM 同档)，对键盘声、风扇、人声背景等非稳态噪声尤其好——这正是官方传统降噪的弱项。**降噪音质可以做到优于官方。**
3. **许可证友好**：MIT/Apache-2.0 双许可，可自由商用、可修改、可 vendor，和 csspeak(tsclientlib 也是 Apache-2.0)一致。
4. **48kHz 全频带**：与我们 Opus 48kHz mono 管线天然对齐，无需额外重采样。
5. **延迟可接受**：~40 ms 算法延迟。语音聊天端到端通常 100~200 ms，多这 40 ms 听感无碍；如果做 PTT 场景甚至更不敏感。

代价：模型权重几 MB(打进 app)、比 RNNoise 多吃些 CPU(单核仍实时)。对桌面客户端完全可接受。

### 6.3 回声消除(AEC)——降噪解决不了，需单独补

DeepFilterNet 不做 AEC。外放(不戴耳机)场景的回声仍需独立模块。选项：

- **`webrtc-audio-processing`(`tonarino` 绑定, crate 2.1.0)**：现成 Rust 绑定，直接用 WebRTC 的 AEC3+AGC。**最省事**，AEC 部分与官方同源同水准。
- 纯深度 AEC(NKF-AEC / DTLN-aec)：质量更高但都是 Python/研究代码，Rust 集成成本高，暂不推荐。

### 6.4 推荐落地架构

发送链路在 `build_input` 的 mono 帧之后、Opus 编码之前插入：

```
麦克风采集 → 重采样到 48kHz
  → [webrtc-audio-processing: AEC3 + AGC]   ← 回声消除 + 自动增益(对齐官方)
  → [DeepFilterNet3 降噪]                    ← 深度降噪(超越官方)
  → VAD 状态机(已实现)
  → Opus 编码(已优化)
```

这套组合：**AEC 追平官方，降噪超越官方,AGC 追平官方**，整体采集质量可达到或超过官方客户端，且全部 MIT/Apache/BSD 许可、可 vendor、纯/半 Rust。

实施优先级建议：
1. 先接 `webrtc-audio-processing`(AEC+AGC)——补上当前最大的体验缺口(回声),改动小。
2. 再接 `deep_filter`(DeepFilterNet3)——把降噪拉到超越官方的水平。
3. 两者都按 DSP 链顺序串在编码前，各自可由设置开关控制(对齐官方的勾选项)。

> 注意:DeepFilterNet 模型按帧(10 ms hop)处理，与我们 20 ms Opus 帧需要做缓冲对齐;`webrtc-audio-processing` 要求 10 ms 帧(480 样本@48k)，集成时需把 20 ms 帧拆成 2×10 ms 喂入。

### 6.5 实施进展与踩坑(2026-06-20，逐步接入中)

**环境约束(实测)**:
- `webrtc-audio-processing` 2.1.0 的 `bundled` feature 用 **meson + ninja** 从源码编译 WebRTC，本机原本两者都没有 → build 直接失败 `Failed to execute meson`。Homebrew **无 `webrtc-audio-processing` formula**，无法走系统库(pkg-config)路线。结论:必须本地装 meson+ninja 走 bundled 编译。已 `brew install meson ninja`。
- 不带 `bundled` 时 build.rs 走 pkg-config 找系统库,或读 `WEBRTC_AUDIO_PROCESSING_INCLUDE/LIB` 环境变量——本机无系统库,此路不通。
- 采用**独立探针 crate**(`/tmp/apm_probe`)先验证能否编译，避免污染主项目 `Cargo.toml`。这是接入前的必要步骤。

**DeepFilterNet 集成成本上修(重要修正)**:
- crates.io 上的 `deep_filter` 0.2.5 **不含 ML 运行时依赖**(无 tract/onnx/torch)，发布的是 DSP/数据集工具部分。**实时推理**(基于 `tract` 的 `libdf`/`ladspa` 子 crate)**没有发布到 crates.io**，只在 GitHub 源码树里。
- 因此 DeepFilterNet 不能像最初设想那样简单 `cargo add deep_filter` 就用，需要 **vendor GitHub 源码(libdf + tract 运行时 + 模型权重)**，集成量比 AEC 大。优先级不变(AEC 先行)，但降噪这步要预留更多工作量。

### 6.6 已落地:WebRTC APM 接入(2026-06-20 完成)

**第一优先级(AEC+NS+AGC)已实现并编译通过**。改动:

- `src-tauri/Cargo.toml`:加 `webrtc-audio-processing = { version = "2.1.0", features = ["bundled"] }`(需本机 meson+ninja)。
- `src-tauri/src/audio.rs`:
  - 新增 `Apm` 结构(`Arc<Processor>`,方法 `&self` 无需 mutex),`Processor::new(48000)` + `set_config`:**AEC3(自动延迟估计)+ HighPassFilter + NoiseSuppression(High)+ GainController2(AGC)**。init 失败则降级为 `None`(无 APM 继续跑)。
  - **输出回调**:把混音后的播放信号下混成 mono、按 10ms(480样本)块喂 `process_render_frame` —— 这是 AEC 的"远端参考"。
  - **输入回调**:麦克风重采样后按 10ms 块过 `process_capture_frame`(原地消回声/降噪/增益),再进 20ms VAD/编码链。
  - 帧对齐:用 `apm_stage`/`render_acc` 累积缓冲解决 20ms↔10ms 不匹配;gating(静音/PTT)时清空缓冲。
- 全链路开关 `set_apm_enabled` command(Tauri),设置面板加"回声消除/降噪/自动增益"勾选项(默认开),连接时随其他设置一并下发。

**现状对比官方**:AEC/AGC/降噪三项**已追平官方**(同为 WebRTC APM)。剩余唯一音质差距是降噪能否**超越**官方——需后续接 DeepFilterNet3(见 6.5,成本较高)。

### 6.7 已落地:DeepFilterNet3 集成(2026-06-20 完成)

**第二优先级(降噪超越官方)已实现并编译通过**(前后端 + vendored crate,零警告)。

**Vendor**(`vendor/deepfilter/`,与 tsclientlib 同模式):
- 从 GitHub `libDF`(crate `deep_filter` 0.5.7-pre,lib 名 `df`)经 jsdelivr 镜像取源码,只 vendor tract feature 闭包:`lib.rs`(DSP)+`transforms.rs`+`logging.rs`+`tract.rs`+`models/DeepFilterNet3_onnx.tar.gz`(完整 7.98MB,含 enc/erb_dec/df_dec/config)。
- 裁剪版 `Cargo.toml`:只留 tract 路径依赖,删 dataset/hdf5(git 依赖)/capi/wasm。
- **关键踩坑**:
  1. crates.io 的 `deep_filter` 0.2.5 是纯 DSP/数据集工具,**无推理**;实时推理只在 GitHub libDF,需 vendor。
  2. **tract 版本锁定**:vendored tract.rs 用 `m.symbols.sym()`(改自 @main 的 `symbol_table`);tract `0.21.0–0.21.6` 用 ndarray 0.15(匹配 DSP 代码),`0.21.7+` 升 ndarray 0.16 会类型冲突。**锁 `=0.21.6`**。tract 0.19(v0.5.6 源对应版本)在 rsproxy 不可得。  3. jsdelivr `@main` 下大模型会截断(只 3.1MB),`@v0.5.6` tag 完整。
  4. 模型 `include_bytes!` 路径:从 `src/tract.rs` 改为 `../models/`。

**接入**(`src-tauri/src/audio.rs`):
- 新增 `DenoiseMode`(Off/Webrtc/DeepFilter)+ `Denoiser`(包 `DfTract`)。`DfTract` 含 `Rc`/`dyn` 是 `!Send`,而 cpal 回调要求 `Send` → 用 `unsafe impl Send`(同 webrtc-apm 自己的做法,仅单线程音频回调持有,安全)。
- 采集链:`mic → resample → APM(AEC/AGC) → [DeepFilter 10ms,仅 DeepFilter 模式] → 20ms acc → VAD → Opus`。DFN hop_size=480=10ms,与 APM 块大小一致,同一循环驱动。
- 三档互斥:DeepFilter 模式下**关掉 APM 的 WebRTC NS**(避免双重降噪),只保留 AEC+AGC;`set_denoise` 动态 `set_config`。
- 容错:DFN/模型 init 失败降级跳过,APM init 失败降级为 None。

**UI**:`set_denoise_mode` command 全链路 + 设置面板"降噪:关/WebRTC/AI 降噪"三档单选(默认 AI 降噪)+ 独立的 AEC/AGC 开关。

**结论:降噪现已超越官方**——AEC/AGC 追平官方(同 WebRTC),降噪用 DeepFilterNet3(深度学习,对非稳态噪声显著优于官方的 WebRTC NS)。整体采集质量达到设计目标。待实机联调验证听感。

### 6.8 修正:tract 版本 + 实机验证(2026-06-20 当晚)

实测发现"选 AI 降噪跟没开一样"——根因是 **6.7 里锁的 tract 0.21.6 在运行时加载模型就失败**(`DfTract::new` 报 `Patch created duplicate name`,tract 0.20+/0.21+ 重写了 ONNX 优化器,与这个为 0.19 导出的 DFN3 模型不兼容)。失败被 `Option`→None 容错静默吞掉,AI 档退化成 no-op。**编译能过 ≠ 运行能用**——这是关键教训。

修复:
- **改用官方验证组合**:vendored 源码换成 **v0.5.6 tag**(`lib.rs`/`transforms.rs`/`tract.rs`,用 `symbol_table` 而非 `symbols`),tract 锁 **`=0.19.16`**(rsproxy **可得**,之前查 `tract-core` 漏看了;0.19.16 用 ndarray 0.15)。去掉 logging mod(v0.5.6 不含),`log` 转非可选 dep。
- **写了烟雾测试验证**(`cargo run --example smoke`,已删):tract 0.19.16 下 `DfTract::new` 成功,`process` 把 24000 样本测试信号能量从 1808→814(降噪 ~55%),确认**真正生效**(0.21.6 下是直接 `new` 失败)。
- **WebRTC 档增强**:NoiseSuppression 从 `High` 提到 `VeryHigh`,缩小与官方(官方额外有瞬态抑制器)的差距。

**最终状态(编译通过,烟雾测试验证 DFN 生效)**:AI 降噪档真正运行 DeepFilterNet3,降噪超越官方;WebRTC 档用 VeryHigh;待实机听感联调。

