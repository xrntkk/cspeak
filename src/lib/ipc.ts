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
