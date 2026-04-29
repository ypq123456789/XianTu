import { loadCloudCharacterIndex, saveCloudCharacterIndex, type CloudCharacterIndex } from './storageAdapter';

export type WebDAVConfig = {
  endpoint: string;
  username: string;
  password: string;
  basePath: string;
};

const CONFIG_KEY = 'xiantu_webdav_config_v1';
const INDEX_FILE = 'xiantu-cloud-index.json';

const normalizeBasePath = (path: string) => path.trim().replace(/^\/+|\/+$/g, '');
const joinUrl = (base: string, path: string) => `${base.replace(/\/+$/g, '')}/${path.replace(/^\/+/, '')}`;

export function getWebDAVConfig(): WebDAVConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) as WebDAVConfig : null;
  } catch {
    return null;
  }
}

export function saveWebDAVConfig(config: WebDAVConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearWebDAVConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}

function authHeader(config: WebDAVConfig): string {
  return `Basic ${btoa(`${config.username}:${config.password}`)}`;
}

function indexUrl(config: WebDAVConfig): string {
  const basePath = normalizeBasePath(config.basePath || 'xiantu-cloud');
  return joinUrl(config.endpoint, `${basePath}/${INDEX_FILE}`);
}

export async function uploadWebDAVIndex(index: CloudCharacterIndex = loadCloudCharacterIndex()): Promise<void> {
  const config = getWebDAVConfig();
  if (!config) throw new Error('尚未配置 WebDAV');
  const response = await fetch(indexUrl(config), {
    method: 'PUT',
    headers: {
      Authorization: authHeader(config),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(index, null, 2),
  });
  if (!response.ok) throw new Error(`WebDAV 索引上传失败：${response.status}`);
}

export async function downloadWebDAVIndex(): Promise<CloudCharacterIndex> {
  const config = getWebDAVConfig();
  if (!config) throw new Error('尚未配置 WebDAV');
  const response = await fetch(indexUrl(config), {
    method: 'GET',
    headers: { Authorization: authHeader(config) },
  });
  if (!response.ok) throw new Error(`WebDAV 索引下载失败：${response.status}`);
  const index = await response.json() as CloudCharacterIndex;
  saveCloudCharacterIndex(index);
  return index;
}
