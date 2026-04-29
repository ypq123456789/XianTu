<template>
  <section class="cloud-save-manager">
    <div class="cloud-header">
      <div>
        <h4>云存档同步</h4>
        <p>兼容作者后端；WebDAV 用于保存角色索引，方便新设备找回角色。</p>
      </div>
      <span class="provider-pill">official</span>
    </div>

    <div class="status-card" :class="status?.state || 'idle'">
      <div class="status-title">{{ statusTitle }}</div>
      <div class="status-detail">{{ status?.message || '点击检查云端状态。' }}</div>
      <div class="status-meta" v-if="status">
        <span>本地版本 {{ status.localVersion }}</span>
        <span>云端版本 {{ status.remoteVersion ?? '未知' }}</span>
      </div>
    </div>

    <div class="cloud-actions">
      <button type="button" @click="checkStatus" :disabled="busy || !hasOnlineCharacter">检查状态</button>
      <button type="button" @click="saveCurrent" :disabled="busy || !hasOnlineCharacter">上传当前进度</button>
      <button type="button" @click="restoreCurrent" :disabled="busy || !hasOnlineCharacter">下载云端覆盖</button>
    </div>

    <div class="restore-row">
      <input v-model="restoreCharId" placeholder="输入角色 ID，如 char_..." />
      <button type="button" @click="restoreById" :disabled="busy || !restoreCharId.trim()">从作者后端恢复</button>
    </div>

    <div class="webdav-box">
      <div class="webdav-title">WebDAV 索引备份</div>
      <div class="webdav-grid">
        <input v-model="webdav.endpoint" placeholder="WebDAV 地址" />
        <input v-model="webdav.username" placeholder="用户名" />
        <input v-model="webdav.password" placeholder="密码" type="password" />
        <input v-model="webdav.basePath" placeholder="目录，如 xiantu-cloud" />
      </div>
      <div class="cloud-actions compact">
        <button type="button" @click="saveWebDAV" :disabled="busy">保存配置</button>
        <button type="button" @click="uploadIndex" :disabled="busy">上传索引</button>
        <button type="button" @click="downloadIndex" :disabled="busy">下载索引</button>
      </div>
      <p class="webdav-hint">作者后端没有角色列表接口时，WebDAV 索引负责告诉新设备有哪些 charId。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useCharacterStore } from '@/stores/characterStore';
import { toast } from '@/utils/toast';
import { exportCloudCharacterIndex } from '@/services/storageAdapter';
import { downloadWebDAVIndex, getWebDAVConfig, saveWebDAVConfig, uploadWebDAVIndex } from '@/services/webdavStorage';
import type { CloudSyncStatus } from '@/services/officialBackendCloudProvider';

const characterStore = useCharacterStore();
const busy = ref(false);
const status = ref<CloudSyncStatus | null>(null);
const restoreCharId = ref('');
const existingWebDAV = getWebDAVConfig();
const webdav = reactive({
  endpoint: existingWebDAV?.endpoint ?? '',
  username: existingWebDAV?.username ?? '',
  password: existingWebDAV?.password ?? '',
  basePath: existingWebDAV?.basePath ?? 'xiantu-cloud',
});

const hasOnlineCharacter = computed(() => characterStore.activeCharacterProfile?.模式 === '联机');
const statusTitle = computed(() => {
  const state = status.value?.state;
  if (state === 'synced') return '已同步';
  if (state === 'cloud-newer') return '云端较新';
  if (state === 'local-newer') return '本地较新';
  if (state === 'conflict') return '存在冲突';
  if (state === 'missing-remote') return '云端缺失';
  if (state === 'error') return '检查失败';
  return '未检查';
});

async function run(task: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await task();
  } finally {
    busy.value = false;
  }
}

async function checkStatus() {
  await run(async () => {
    status.value = await characterStore.refreshActiveCloudSyncStatus();
    if (status.value) toast.info(status.value.message);
  });
}

async function saveCurrent() {
  await run(async () => {
    await characterStore.saveCurrentGame({ notifyIfNoActive: true });
    status.value = await characterStore.refreshActiveCloudSyncStatus();
    toast.success('已尝试上传当前联机进度');
  });
}

async function restoreCurrent() {
  await run(async () => {
    const active = characterStore.rootState.当前激活存档;
    if (!active) return;
    const ok = await characterStore.restoreOfficialCloudCharacter(active.角色ID);
    if (ok) status.value = await characterStore.refreshActiveCloudSyncStatus();
  });
}

async function restoreById() {
  await run(async () => {
    const ok = await characterStore.restoreOfficialCloudCharacter(restoreCharId.value);
    if (ok) {
      restoreCharId.value = '';
      status.value = await characterStore.refreshActiveCloudSyncStatus();
    }
  });
}

function saveWebDAV() {
  saveWebDAVConfig({ ...webdav });
  toast.success('WebDAV 配置已保存到本地浏览器');
}

async function uploadIndex() {
  await run(async () => {
    saveWebDAV();
    const index = exportCloudCharacterIndex(characterStore.rootState);
    await uploadWebDAVIndex(index);
    toast.success('云角色索引已上传到 WebDAV');
  });
}

async function downloadIndex() {
  await run(async () => {
    saveWebDAV();
    const index = await downloadWebDAVIndex();
    toast.success(`已下载 ${index.characters.length} 条云角色索引`);
  });
}
</script>

<style scoped>
.cloud-save-manager {
  border: 1px solid rgba(102, 126, 234, 0.28);
  background: linear-gradient(135deg, rgba(28, 38, 68, 0.72), rgba(18, 24, 44, 0.86));
  border-radius: 16px;
  padding: 1rem;
  margin-bottom: 1rem;
  color: var(--color-text);
}
.cloud-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}
.cloud-header h4 { margin: 0 0 0.25rem; }
.cloud-header p, .webdav-hint { margin: 0; color: var(--color-text-secondary); font-size: 0.85rem; }
.provider-pill {
  border: 1px solid rgba(125, 211, 252, 0.5);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.75rem;
  color: #7dd3fc;
}
.status-card {
  margin: 0.8rem 0;
  padding: 0.8rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
}
.status-card.synced { border-left: 3px solid #22c55e; }
.status-card.cloud-newer, .status-card.local-newer { border-left: 3px solid #f59e0b; }
.status-card.conflict, .status-card.error { border-left: 3px solid #ef4444; }
.status-title { font-weight: 700; }
.status-detail, .status-meta { color: var(--color-text-secondary); font-size: 0.85rem; margin-top: 0.25rem; }
.status-meta { display: flex; gap: 1rem; flex-wrap: wrap; }
.cloud-actions, .restore-row {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 0.75rem;
}
.cloud-actions button, .restore-row button {
  border: 1px solid rgba(125, 211, 252, 0.35);
  border-radius: 10px;
  padding: 0.55rem 0.8rem;
  background: rgba(14, 165, 233, 0.12);
  color: var(--color-text);
  cursor: pointer;
}
.cloud-actions button:disabled, .restore-row button:disabled { opacity: 0.5; cursor: not-allowed; }
.restore-row input, .webdav-grid input {
  flex: 1;
  min-width: 180px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text);
}
.webdav-box {
  margin-top: 0.9rem;
  padding-top: 0.9rem;
  border-top: 1px dashed rgba(255, 255, 255, 0.16);
}
.webdav-title { font-weight: 700; margin-bottom: 0.55rem; }
.webdav-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.55rem; }
.compact { margin-top: 0.55rem; }
@media (max-width: 700px) {
  .webdav-grid { grid-template-columns: 1fr; }
  .cloud-actions button, .restore-row button, .restore-row input { width: 100%; }
}
</style>
