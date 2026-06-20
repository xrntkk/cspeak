import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface ChannelInfo {
  id: number;
  parent: number;
  name: string;
  order: number;
}

export interface ClientInfo {
  id: number;
  channel: number;
  name: string;
  talking: boolean;
  inputMuted: boolean;
  outputMuted: boolean;
}

export interface ServerSnapshot {
  name: string;
  welcomeMessage: string;
  ownClient: number;
  channels: ChannelInfo[];
  clients: ClientInfo[];
}

export type ConnStatus =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "disconnected"; reason: string | null }
  | { kind: "error"; message: string };

export function connect(address: string, nickname: string) {
  return invoke("connect", { address, nickname });
}

export function disconnect() {
  return invoke("disconnect");
}

export function setMuted(muted: boolean) {
  return invoke("set_muted", { muted });
}

export function setDeafened(deafened: boolean) {
  return invoke("set_deafened", { deafened });
}

export function joinChannel(channel: number) {
  return invoke("join_channel", { channel });
}

export function listDevices() {
  return invoke<[string[], string[]]>("list_devices");
}

export function setInputDevice(name: string | null) {
  return invoke("set_input_device", { name });
}

export function setOutputDevice(name: string | null) {
  return invoke("set_output_device", { name });
}

export function setMicGain(gain: number) {
  return invoke("set_mic_gain", { gain });
}

export function setSpkGain(gain: number) {
  return invoke("set_spk_gain", { gain });
}

export function setSensitivity(threshold: number) {
  return invoke("set_sensitivity", { threshold });
}

export function setPttEnabled(enabled: boolean) {
  return invoke("set_ptt_enabled", { enabled });
}

export function setPttActive(active: boolean) {
  return invoke("set_ptt_active", { active });
}

export function setApmEnabled(enabled: boolean) {
  return invoke("set_apm_enabled", { enabled });
}

export type DenoiseMode = "off" | "webrtc" | "deepfilter";

export function setDenoiseMode(mode: DenoiseMode) {
  return invoke("set_denoise_mode", { mode });
}

export function setClientVolume(client: number, volume: number) {
  return invoke("set_client_volume", { client, volume });
}

export function setMicTest(on: boolean) {
  return invoke("set_mic_test", { on });
}

export interface ChatMessage {
  scope: string;
  from: string;
  fromId: number;
  message: string;
}

export function sendChat(target: string, message: string) {
  return invoke("send_chat", { target, message });
}

export function joinChannelPw(channel: number, password: string) {
  return invoke("join_channel_pw", { channel, password });
}

export function poke(client: number, message: string) {
  return invoke("poke", { client, message });
}

export function kickClient(client: number, message: string, fromServer: boolean) {
  return invoke("kick_client", { client, message, fromServer });
}

export function muteClient(client: number, mute: boolean) {
  return invoke("mute_client", { client, mute });
}

export function requestConnectionInfo(client: number) {
  return invoke("request_connection_info", { client });
}

export function usePrivilegeKey(token: string) {
  return invoke("use_privilege_key", { token });
}

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  downloadUrl: string | null;
  releaseNotes: string | null;
  assets: UpdateAsset[];
  recommendedAsset: UpdateAsset | null;
}

export function checkUpdate() {
  return invoke<UpdateInfo>("check_update");
}

export function downloadUpdate(url: string, filename: string) {
  return invoke<string>("download_update", { url, filename });
}

export function openInstaller(path: string) {
  return invoke<void>("open_installer", { path });
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

export function onUpdateDownloadProgress(cb: (p: DownloadProgress) => void) {
  return listen<DownloadProgress>("update-download-progress", (e) => cb(e.payload));
}

export interface ConnInfo {
  clientId: number;
  pingMs: number | null;
  packetLoss: number | null;
}

export function onConnInfo(cb: (i: ConnInfo) => void) {
  return listen<ConnInfo>("conn-info", (e) => cb(e.payload));
}

export function onChat(cb: (m: ChatMessage) => void) {
  return listen<ChatMessage>("conn-chat", (e) => cb(e.payload));
}

export function onStatus(cb: (s: ConnStatus) => void) {
  return listen<ConnStatus>("conn-status", (e) => cb(e.payload));
}

export function onSnapshot(cb: (s: ServerSnapshot) => void) {
  return listen<ServerSnapshot>("conn-snapshot", (e) => cb(e.payload));
}

export function onTalking(cb: (ids: number[]) => void) {
  return listen<number[]>("conn-talking", (e) => cb(e.payload));
}

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  isFile: boolean;
}

export type FtStatus =
  | { kind: "downloaded"; size: number }
  | { kind: "uploaded" }
  | { kind: "failed"; error: string };

export function listChannelFiles(channel: number) {
  return invoke("list_channel_files", { channel });
}

export function downloadFile(channel: number, path: string, saveTo: string) {
  return invoke("download_file", { channel, path, saveTo });
}

export function uploadFile(channel: number, path: string, file: string) {
  return invoke("upload_file", { channel, path, file });
}

export function onFileList(cb: (files: FileEntry[]) => void) {
  return listen<FileEntry[]>("conn-filelist", (e) => cb(e.payload));
}

export function onFtStatus(cb: (s: FtStatus) => void) {
  return listen<FtStatus>("conn-ft-status", (e) => cb(e.payload));
}
