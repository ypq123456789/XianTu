import { createCharacter, fetchCharacterProfile, updateCharacterSave } from '@/services/api/characters';
import { verifyStoredToken } from '@/services/api/auth';
import { buildBackendUrl, isBackendConfigured } from '@/services/backendConfig';
import type { CharacterBaseInfo, CharacterProfile, SaveData, SaveSlot } from '@/types/game';

export const OFFICIAL_ONLINE_SLOT = '云端修行';

export type OfficialCloudSave = {
  saveData: SaveData;
  version: number;
  lastSync: string;
  gameTime: string | null;
  worldMap: Record<string, unknown>;
  rawProfile: Record<string, unknown>;
};

export type CloudSyncState = 'disabled' | 'need-login' | 'missing-remote' | 'local-newer' | 'cloud-newer' | 'conflict' | 'synced' | 'error';

export type CloudSyncStatus = {
  state: CloudSyncState;
  message: string;
  localVersion: number;
  remoteVersion: number | null;
  localLastSync: string | null;
  remoteLastSync: string | null;
};

export type OfficialCloudCharacterListItem = {
  charId: string;
  name: string;
  version: number | null;
  lastSync: string | null;
  raw: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const asString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;

const getBaseInfoFromSave = (saveData: SaveData): CharacterBaseInfo => {
  const identity = (saveData as any)?.角色?.身份 ?? {};
  return {
    名字: asString(identity.名字) ?? '云端道友',
    性别: asString(identity.性别) ?? '未知',
    年龄: typeof identity.年龄 === 'number' ? identity.年龄 : 18,
    外貌: asString(identity.外貌) ?? '',
    性格: asString(identity.性格) ?? '',
    背景: asString(identity.背景) ?? '',
  } as unknown as CharacterBaseInfo;
};

const getGameTimeFromSave = (saveData: SaveData): string | undefined => {
  const time = (saveData as any)?.元数据?.时间;
  if (time && typeof time === 'object') {
    const year = (time as any).年 ?? '?';
    const month = (time as any).月 ?? '?';
    const day = (time as any).日 ?? '?';
    return `${year}年${month}月${day}日`;
  }
  return undefined;
};

const getAuthHeaders = (): Headers => {
  const headers = new Headers();
  const token = localStorage.getItem('access_token');
  if (token) headers.append('Authorization', `Bearer ${token}`);
  return headers;
};

const pickArrayPayload = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ['items', 'characters', 'data', 'results']) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  return [];
};

const normalizeListItem = (item: unknown): OfficialCloudCharacterListItem | null => {
  if (!isRecord(item)) return null;
  const charId =
    asString(item.char_id) ??
    asString(item.charId) ??
    asString(item.id) ??
    asString(item.character_id) ??
    asString(item.characterId);
  if (!charId) return null;

  const baseInfo = isRecord(item.base_info) ? item.base_info : {};
  const gameSave = isRecord(item.game_save) ? item.game_save : {};
  return {
    charId,
    name:
      asString(item.name) ??
      asString(item.character_name) ??
      asString(baseInfo.名字) ??
      asString(baseInfo.name) ??
      charId,
    version: typeof gameSave.version === 'number' ? gameSave.version : null,
    lastSync: asString(gameSave.last_sync) ?? asString(item.updated_at) ?? asString(item.created_at) ?? null,
    raw: item,
  };
};

export const extractOfficialCloudSave = (profile: unknown): OfficialCloudSave | null => {
  if (!isRecord(profile)) return null;
  const cloudSave = profile.game_save;
  if (!isRecord(cloudSave)) return null;
  const saveData = cloudSave.save_data;
  if (!saveData || typeof saveData !== 'object') return null;

  return {
    saveData: saveData as SaveData,
    version: typeof cloudSave.version === 'number' ? cloudSave.version : 1,
    lastSync: asString(cloudSave.last_sync) ?? new Date().toISOString(),
    gameTime: asString(cloudSave.game_time) ?? null,
    worldMap: isRecord(cloudSave.world_map) ? cloudSave.world_map : {},
    rawProfile: profile,
  };
};

export const officialBackendCloudProvider = {
  async ensureReady(): Promise<{ ok: boolean; reason?: string }> {
    if (!isBackendConfigured()) return { ok: false, reason: '后端服务器未配置' };
    const tokenValid = await verifyStoredToken();
    if (!tokenValid) return { ok: false, reason: '需要先登录作者后端账号' };
    return { ok: true };
  },

  async createRemoteCharacter(charId: string, baseInfo: CharacterBaseInfo): Promise<void> {
    await createCharacter({ char_id: charId, base_info: baseInfo });
  },

  async downloadSave(charId: string): Promise<OfficialCloudSave | null> {
    const ready = await this.ensureReady();
    if (!ready.ok) throw new Error(ready.reason || '作者后端不可用');
    const profile = await fetchCharacterProfile(charId);
    return extractOfficialCloudSave(profile);
  },

  async listCharacters(): Promise<{ supported: boolean; characters: OfficialCloudCharacterListItem[]; message?: string }> {
    const ready = await this.ensureReady();
    if (!ready.ok) throw new Error(ready.reason || '作者后端不可用');

    const candidates = [
      '/api/v1/characters/',
      '/api/v1/characters',
      '/api/v1/characters/me',
      '/api/v1/auth/me/characters',
    ];

    for (const path of candidates) {
      try {
        const response = await fetch(buildBackendUrl(path), {
          method: 'GET',
          headers: getAuthHeaders(),
        });
        if (response.status === 404 || response.status === 405) continue;
        const rawText = await response.text();
        if (!response.ok) {
          if (response.status === 401) throw new Error('登录已失效或未登录，请先登录后再试。');
          continue;
        }
        const payload = rawText ? JSON.parse(rawText) as unknown : null;
        const characters = pickArrayPayload(payload).map(normalizeListItem).filter(Boolean) as OfficialCloudCharacterListItem[];
        return { supported: true, characters };
      } catch (error) {
        if (error instanceof Error && error.message.includes('登录')) throw error;
      }
    }

    return {
      supported: false,
      characters: [],
      message: '作者后端当前没有开放账号角色列表接口，仍需使用本地/WebDAV 索引或手动输入角色 ID。',
    };
  },

  async uploadSave(charId: string, payload: { saveData: SaveData | null; worldMap?: Record<string, unknown>; gameTime?: string | null; }): Promise<{ version: number; lastSync: string }> {
    const ready = await this.ensureReady();
    if (!ready.ok) throw new Error(ready.reason || '作者后端不可用');
    const result = await updateCharacterSave(charId, {
      save_data: payload.saveData,
      world_map: payload.worldMap ?? {},
      game_time: payload.gameTime ?? null,
    });
    const record = isRecord(result) ? result : {};
    return {
      version: typeof record.version === 'number' ? record.version : 1,
      lastSync: new Date().toISOString(),
    };
  },

  buildLocalProfile(charId: string, cloud: OfficialCloudSave): CharacterProfile {
    const saveData = cloud.saveData;
    const baseInfo = getBaseInfoFromSave(saveData);
    const attrs = (saveData as any)?.角色?.属性;
    const location = (saveData as any)?.角色?.位置;
    const slot: SaveSlot & { 云端同步信息?: NonNullable<CharacterProfile['存档列表'][string]['云端同步信息']> } = {
      存档名: OFFICIAL_ONLINE_SLOT,
      保存时间: cloud.lastSync,
      游戏内时间: cloud.gameTime ?? getGameTimeFromSave(saveData) ?? '',
      角色名字: baseInfo.名字,
      境界: attrs?.境界?.名称 ?? attrs?.境界 ?? '凡人',
      位置: location?.描述 ?? '未知',
      存档数据: saveData,
      云端同步信息: {
        最后同步: cloud.lastSync,
        版本: cloud.version,
        需要同步: false,
        后端创建失败: false,
      },
    };
    (slot as any).世界地图 = cloud.worldMap;

    return {
      模式: '联机',
      角色: baseInfo,
      存档列表: {
        [OFFICIAL_ONLINE_SLOT]: slot,
        上次对话: {
          存档名: '上次对话',
          保存时间: null,
          存档数据: null,
        },
      },
    };
  },

  evaluateStatus(localSlot: SaveSlot | null | undefined, remote: OfficialCloudSave | null): CloudSyncStatus {
    const localInfo = localSlot?.云端同步信息;
    const localVersion = localInfo?.版本 ?? 0;
    const remoteVersion = remote?.version ?? null;
    const localNeedsSync = !!localInfo?.需要同步;

    if (!isBackendConfigured()) {
      return { state: 'disabled', message: '作者后端未配置', localVersion, remoteVersion, localLastSync: localInfo?.最后同步 ?? null, remoteLastSync: remote?.lastSync ?? null };
    }
    if (!remote) {
      return { state: 'missing-remote', message: localNeedsSync ? '云端未找到存档，本地等待上传' : '云端未找到存档', localVersion, remoteVersion, localLastSync: localInfo?.最后同步 ?? null, remoteLastSync: null };
    }
    if (localNeedsSync && remote.version > localVersion) {
      return { state: 'conflict', message: '本地和云端都有新进度，请先备份再选择覆盖方向', localVersion, remoteVersion, localLastSync: localInfo?.最后同步 ?? null, remoteLastSync: remote.lastSync };
    }
    if (remote.version > localVersion) {
      return { state: 'cloud-newer', message: '云端较新，可下载覆盖本地缓存', localVersion, remoteVersion, localLastSync: localInfo?.最后同步 ?? null, remoteLastSync: remote.lastSync };
    }
    if (localNeedsSync || localVersion > remote.version) {
      return { state: 'local-newer', message: '本地较新，等待上传到作者后端', localVersion, remoteVersion, localLastSync: localInfo?.最后同步 ?? null, remoteLastSync: remote.lastSync };
    }
    return { state: 'synced', message: '已同步', localVersion, remoteVersion, localLastSync: localInfo?.最后同步 ?? null, remoteLastSync: remote.lastSync };
  },
};
