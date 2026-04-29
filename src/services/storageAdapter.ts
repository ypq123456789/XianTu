import type { CharacterProfile, LocalStorageRoot, SaveData } from '@/types/game';
import { officialBackendCloudProvider, OFFICIAL_ONLINE_SLOT, type CloudSyncStatus } from './officialBackendCloudProvider';

export type CloudProviderKind = 'official' | 'webdav';

export type CloudCharacterIndexItem = {
  charId: string;
  name: string;
  mode: '联机';
  slotKey: string;
  version: number;
  lastSyncAt: string;
  provider: CloudProviderKind;
};

export type CloudCharacterIndex = {
  schemaVersion: 1;
  updatedAt: string;
  characters: CloudCharacterIndexItem[];
};

const INDEX_KEY = 'xiantu_cloud_character_index_v1';

const emptyIndex = (): CloudCharacterIndex => ({ schemaVersion: 1, updatedAt: new Date().toISOString(), characters: [] });

export function loadCloudCharacterIndex(): CloudCharacterIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return emptyIndex();
    const parsed = JSON.parse(raw) as CloudCharacterIndex;
    if (!Array.isArray(parsed.characters)) return emptyIndex();
    return parsed;
  } catch {
    return emptyIndex();
  }
}

export function saveCloudCharacterIndex(index: CloudCharacterIndex): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify({ ...index, updatedAt: new Date().toISOString() }));
}

export function upsertCloudIndexFromProfile(charId: string, profile: CharacterProfile, provider: CloudProviderKind = 'official'): void {
  if (profile.模式 !== '联机') return;
  const slot = profile.存档列表?.[OFFICIAL_ONLINE_SLOT];
  const next: CloudCharacterIndexItem = {
    charId,
    name: profile.角色?.名字 || slot?.角色名字 || charId,
    mode: '联机',
    slotKey: OFFICIAL_ONLINE_SLOT,
    version: slot?.云端同步信息?.版本 ?? 1,
    lastSyncAt: slot?.云端同步信息?.最后同步 || slot?.保存时间 || new Date().toISOString(),
    provider,
  };
  const index = loadCloudCharacterIndex();
  const existing = index.characters.findIndex(item => item.charId === charId && item.provider === provider);
  if (existing >= 0) index.characters[existing] = next;
  else index.characters.push(next);
  saveCloudCharacterIndex(index);
}

export function exportCloudCharacterIndex(root: LocalStorageRoot): CloudCharacterIndex {
  Object.entries(root.角色列表).forEach(([charId, profile]) => upsertCloudIndexFromProfile(charId, profile));
  return loadCloudCharacterIndex();
}

export async function restoreOfficialCharacterById(charId: string): Promise<{ profile: CharacterProfile; saveData: SaveData }> {
  const cloud = await officialBackendCloudProvider.downloadSave(charId);
  if (!cloud) throw new Error('作者后端没有返回该角色的云端存档，请确认角色 ID 是否正确。');
  return { profile: officialBackendCloudProvider.buildLocalProfile(charId, cloud), saveData: cloud.saveData };
}

export async function getOfficialCloudStatus(charId: string, profile?: CharacterProfile | null): Promise<CloudSyncStatus> {
  const cloud = await officialBackendCloudProvider.downloadSave(charId);
  return officialBackendCloudProvider.evaluateStatus(profile?.存档列表?.[OFFICIAL_ONLINE_SLOT], cloud);
}
