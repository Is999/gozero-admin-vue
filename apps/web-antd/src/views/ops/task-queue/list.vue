<script lang="ts" setup>
// ================= 类型与依赖引入 =================
import type { TaskApi } from '#/api/ops/task';

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page, VbenButton } from '@vben/common-ui';

import { ReloadOutlined } from '@ant-design/icons-vue';
import {
  Alert,
  Button,
  Card,
  message,
  Modal,
  Table,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  fetchTaskObservability,
  fetchTaskQueues,
  pauseTaskQueue,
  resumeTaskQueue,
} from '#/api/ops/task';
import { $t } from '#/locales';
import {
  currentSessionStateIdentity,
  registerSessionStateCleanup,
} from '#/utils/session-state-gate';

import JsonDetailViewer from '../../system/components/json-detail-viewer.vue';
import { useColumns } from './data';

// TASK_QUEUE_REFRESH_INTERVAL_MS 控制 Redis 队列热状态刷新频率。
const TASK_QUEUE_REFRESH_INTERVAL_MS = 15_000;
// TASK_OBSERVABILITY_REFRESH_INTERVAL_MS 限制带 DB 汇总的观测接口刷新频率。
const TASK_OBSERVABILITY_REFRESH_INTERVAL_MS = 60_000;

// TableActionParams 定义表格操作列的事件负载。
type TableActionParams<T = any> = {
  code: string;
  row: T;
};

// ================= 页面状态 =================
// workerSummaryText 用于展示在线 Worker 节点快照。
const workerSummaryText = ref('');
// queueRows 保存当前队列快照，供页面顶部概览卡复用。
const queueRows = ref<TaskApi.TaskQueueItem[]>([]);
// workerRows 保存当前在线 Worker 节点快照。
const workerRows = ref<TaskApi.TaskServerItem[]>([]);
// snapshotLoading 表示队列与 Worker 运行快照正在加载。
const snapshotLoading = ref(false);
// snapshotLoadFailed 表示最近一次运行快照加载失败。
const snapshotLoadFailed = ref(false);
// queueMetricsLimited 表示聚合组超限后部分高成本队列指标已安全降级。
const queueMetricsLimited = ref(false);
// taskObservability 保存轻量 Redis 指标与 DB 历史健康摘要，和队列快照独立降级。
const taskObservability = ref<null | TaskApi.TaskObservabilityResp>(null);
const taskObservabilityLoadFailed = ref(false);
const taskObservabilityLoading = ref(false);
const taskObservabilityRequestSeq = ref(0);
const taskObservabilityLastLoadedAt = ref(0);
// taskQueueRequestSeq 防止账号切换或连续刷新后的旧队列响应覆盖当前页面。
const taskQueueRequestSeq = ref(0);
const taskQueueRefreshTimer = ref<null | number>(null);
// router 用于跳转到任务列表并带入队列筛选条件。
const router = useRouter();
// showWorkerSnapshot 控制 Worker 原始快照展开。
const showWorkerSnapshot = ref(false);

// resetTaskQueueSessionState 丢弃旧账号的观测响应和页面快照。
function resetTaskQueueSessionState() {
  stopTaskQueueAutoRefresh();
  taskQueueRequestSeq.value += 1;
  taskObservabilityRequestSeq.value += 1;
  snapshotLoading.value = false;
  snapshotLoadFailed.value = false;
  queueMetricsLimited.value = false;
  taskObservability.value = null;
  taskObservabilityLoadFailed.value = false;
  taskObservabilityLoading.value = false;
  taskObservabilityLastLoadedAt.value = 0;
  queueRows.value = [];
  workerRows.value = [];
  workerSummaryText.value = '';
}

// unregisterTaskQueueSessionCleanup 在账号切换和页面卸载时解除会话清理回调。
const unregisterTaskQueueSessionCleanup = registerSessionStateCleanup(
  resetTaskQueueSessionState,
);

// workerColumns 定义在线 Worker 的结构化运行视图。
const workerColumns = computed(() => [
  {
    dataIndex: 'id',
    ellipsis: true,
    title: $t('business.message.workerInstance'),
    width: 220,
  },
  {
    dataIndex: 'host',
    title: $t('business.message.workerHost'),
    width: 180,
  },
  {
    dataIndex: 'pid',
    title: 'PID',
    width: 90,
  },
  {
    dataIndex: 'status',
    title: $t('business.message.workerStatus'),
    width: 110,
  },
  {
    dataIndex: 'concurrency',
    title: $t('business.message.workerConcurrency'),
    width: 110,
  },
  {
    dataIndex: 'strictPriority',
    title: $t('business.message.strictPriority'),
    width: 120,
  },
  {
    dataIndex: 'queues',
    title: $t('business.message.queueWeights'),
    width: 260,
  },
  {
    dataIndex: 'startedAt',
    title: $t('business.message.workerStartedAt'),
    width: 190,
  },
]);

// formatWorkerQueues 格式化 Worker 队列权重。
function formatWorkerQueues(queues?: Record<string, number>) {
  return Object.entries(queues || {})
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([name, weight]) => `${name}:${weight}`)
    .join(' · ');
}

const queueOverviewCards = computed(() => {
  const rows = queueRows.value;
  const pausedCount = rows.filter((item) => item.paused).length;
  const failedCount = rows.reduce(
    (sum, item) => sum + Number(item.failed || 0),
    0,
  );
  const pendingCount = rows.reduce(
    (sum, item) => sum + Number(item.pending || 0),
    0,
  );
  const activeCount = rows.reduce(
    (sum, item) => sum + Number(item.active || 0),
    0,
  );
  return [
    {
      description: $t('business.message.queueTotalDesc'),
      label: $t('business.message.queueTotal'),
      value: String(rows.length),
    },
    {
      description: $t('business.message.pausedQueueDesc'),
      label: $t('business.message.pausedQueue'),
      value: String(pausedCount),
    },
    {
      description: $t('business.message.onlineWorkerDesc'),
      label: $t('business.message.onlineWorker'),
      value: String(workerRows.value.length),
    },
    {
      description: $t('business.message.pendingTaskTotalDesc'),
      label: $t('business.message.pendingTask'),
      value: String(pendingCount),
    },
    {
      description: $t('business.message.activeTaskTotalDesc'),
      label: $t('business.message.activeTask'),
      value: String(activeCount),
    },
    {
      description: $t('business.message.todayFailedDesc'),
      label: $t('business.message.todayFailed'),
      value: String(failedCount),
    },
  ];
});

const queueOpsGuide = computed(() => {
  if (queueRows.value.some((item) => item.paused)) {
    return {
      description: $t('business.message.pausedQueueDetectedDesc'),
      message: $t('business.message.pausedQueueDetected'),
      type: 'warning' as const,
    };
  }
  if (queueRows.value.some((item) => Number(item.failed || 0) > 0)) {
    return {
      description: $t('business.message.failedQueueDetectedDesc'),
      message: $t('business.message.failedQueueDetected'),
      type: 'error' as const,
    };
  }
  return {
    description: $t('business.message.queueHealthyDesc'),
    message: $t('business.message.queueHealthy'),
    type: 'success' as const,
  };
});

// taskObservabilityCards 汇总事故排查最关键的容量与持久化指标。
const taskObservabilityCards = computed(() => {
  const snapshot = taskObservability.value;
  return [
    {
      label: $t('business.message.taskRedisMemory'),
      value: formatBytes(snapshot?.redis.usedBytes || 0),
    },
    {
      label: $t('business.message.taskRedisUsage'),
      value: snapshot?.redis.maxBytes
        ? `${Number(snapshot.redis.usagePercent || 0).toFixed(1)}%`
        : '-',
    },
    {
      label: $t('business.message.completedRetention'),
      value: `${snapshot?.redis.completedTTL || 0}s`,
    },
    {
      label: $t('business.message.historyPendingUsage'),
      value: `${snapshot?.history.pending || 0} · ${formatBytes(snapshot?.history.pendingBytes || 0)} / ${formatBytes(snapshot?.history.pendingMaxBytes || 0)}`,
    },
    {
      label: $t('business.message.workflowLast24Hours'),
      value: String(snapshot?.last24Hours.total || 0),
    },
    {
      label: $t('business.message.workflowSuccessRate'),
      value: `${Number(snapshot?.last24Hours.successRate || 0).toFixed(1)}%`,
    },
  ];
});

// formatBytes 使用紧凑单位展示 Redis 内存。
function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

// loadTaskObservability 独立加载观测摘要，DB 异常不能拖垮实时队列表格。
async function loadTaskObservability(options: { force?: boolean } = {}) {
  if (
    taskObservabilityLoading.value ||
    (!options.force &&
      Date.now() - taskObservabilityLastLoadedAt.value <
        TASK_OBSERVABILITY_REFRESH_INTERVAL_MS)
  ) {
    return;
  }
  const sourceSessionIdentity = currentSessionStateIdentity();
  const requestSeq = taskObservabilityRequestSeq.value + 1;
  taskObservabilityRequestSeq.value = requestSeq;
  taskObservabilityLoadFailed.value = false;
  taskObservabilityLoading.value = true;
  try {
    const result = await fetchTaskObservability();
    if (
      requestSeq !== taskObservabilityRequestSeq.value ||
      sourceSessionIdentity !== currentSessionStateIdentity()
    ) {
      return;
    }
    taskObservability.value = result;
    taskObservabilityLastLoadedAt.value = Date.now();
  } catch {
    if (
      requestSeq === taskObservabilityRequestSeq.value &&
      sourceSessionIdentity === currentSessionStateIdentity()
    ) {
      taskObservabilityLoadFailed.value = true;
    }
  } finally {
    if (requestSeq === taskObservabilityRequestSeq.value) {
      taskObservabilityLoading.value = false;
    }
  }
}

// ================= 表格配置 =================
// Grid 负责展示任务队列概览。
const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: useColumns(onActionClick),
    keepSource: true,
    maxHeight: 680,
    proxyConfig: {
      ajax: {
        query: async () => {
          const sourceSessionIdentity = currentSessionStateIdentity();
          const requestSeq = taskQueueRequestSeq.value + 1;
          taskQueueRequestSeq.value = requestSeq;
          void loadTaskObservability();
          snapshotLoading.value = true;
          snapshotLoadFailed.value = false;
          try {
            const responseData = await fetchTaskQueues();
            if (
              requestSeq !== taskQueueRequestSeq.value ||
              sourceSessionIdentity !== currentSessionStateIdentity()
            ) {
              return {
                list: queueRows.value,
                total: queueRows.value.length,
              };
            }
            queueRows.value = responseData.queues || [];
            workerRows.value = responseData.servers || [];
            queueMetricsLimited.value = Boolean(responseData.metricsLimited);
            workerSummaryText.value = JSON.stringify(
              responseData.servers || [],
              null,
              2,
            );
            return {
              list: responseData.queues || [],
              total: responseData.queues?.length || 0,
            };
          } catch (error) {
            if (
              requestSeq !== taskQueueRequestSeq.value ||
              sourceSessionIdentity !== currentSessionStateIdentity()
            ) {
              return {
                list: queueRows.value,
                total: queueRows.value.length,
              };
            }
            queueRows.value = [];
            workerRows.value = [];
            queueMetricsLimited.value = false;
            workerSummaryText.value = '';
            snapshotLoadFailed.value = true;
            throw error;
          } finally {
            if (requestSeq === taskQueueRequestSeq.value) {
              snapshotLoading.value = false;
            }
          }
        },
      },
      response: {
        result: 'list',
        total: 'total',
      },
    },
    rowConfig: {
      keyField: 'name',
    },
    toolbarConfig: {
      custom: true,
      refresh: true,
      zoom: true,
    },
  },
});

// ================= 业务方法 =================
// onActionClick 处理操作列点击事件。
function onActionClick(e: TableActionParams<TaskApi.TaskQueueItem>) {
  switch (e.code) {
    case 'pauseConsume':
    case 'resumeConsume': {
      void handleToggleQueueConsume(e.row);
      break;
    }
    case 'viewTasks': {
      void handleOpenQueueTasks(e.row);
      break;
    }
  }
}

// handleOpenQueueTasks 跳转到任务列表页，并自动带入当前队列。
async function handleOpenQueueTasks(row: TaskApi.TaskQueueItem) {
  await router.push({
    name: 'OpsTaskItem',
    query: {
      queue: row.name,
      source: $t('business.message.taskQueueSource', [row.name]),
    },
  });
}

// handleToggleQueueConsume 根据当前暂停状态执行暂停或恢复。
async function handleToggleQueueConsume(row: TaskApi.TaskQueueItem) {
  const actionLabel = row.paused
    ? $t('business.message.resumeConsume')
    : $t('business.message.pauseConsume');
  Modal.confirm({
    title: $t('business.message.confirmQueueConsumeAction', [actionLabel]),
    content: $t('business.message.confirmQueueConsumeActionDesc', [
      row.name,
      actionLabel,
    ]),
    async onOk() {
      await (row.paused
        ? resumeTaskQueue({ queue: row.name })
        : pauseTaskQueue({ queue: row.name }));
      message.success(
        $t('business.message.queueConsumeActionSucceeded', [
          row.name,
          actionLabel,
        ]),
      );
      await gridApi.query();
    },
  });
}

// handleRefresh 刷新任务队列列表。
function handleRefresh() {
  void loadTaskObservability({ force: true });
  void gridApi.query();
}

// stopTaskQueueAutoRefresh 停止队列热状态轮询。
function stopTaskQueueAutoRefresh() {
  if (taskQueueRefreshTimer.value !== null) {
    window.clearInterval(taskQueueRefreshTimer.value);
    taskQueueRefreshTimer.value = null;
  }
}

// refreshTaskQueueSilently 仅在页面可见且上一轮已结束时刷新实时队列。
function refreshTaskQueueSilently() {
  if (document.visibilityState !== 'visible' || snapshotLoading.value) {
    return;
  }
  void gridApi.query();
}

// startTaskQueueAutoRefresh 启动单例队列轮询，历史汇总由独立的一分钟节流保护。
function startTaskQueueAutoRefresh() {
  if (taskQueueRefreshTimer.value !== null) {
    return;
  }
  taskQueueRefreshTimer.value = window.setInterval(
    refreshTaskQueueSilently,
    TASK_QUEUE_REFRESH_INTERVAL_MS,
  );
}

onMounted(startTaskQueueAutoRefresh);

onBeforeUnmount(() => {
  stopTaskQueueAutoRefresh();
  taskQueueRequestSeq.value += 1;
  taskObservabilityRequestSeq.value += 1;
  unregisterTaskQueueSessionCleanup();
});
</script>

<template>
  <Page
    content-class="min-w-0 overflow-x-hidden"
    :title="$t('business.message.taskQueueOverview')"
  >
    <div class="grid min-w-0 max-w-full gap-2">
      <section
        class="overflow-hidden rounded-2xl border border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(15,23,42,0.9))] px-5 py-4 text-slate-100 shadow-[0_16px_44px_rgba(15,23,42,0.3)]"
      >
        <div
          class="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,0.78fr)_minmax(0,1.22fr)] xl:items-start"
        >
          <div class="min-w-0">
            <div
              class="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80"
            >
              Queue Observatory
            </div>
            <div class="mt-2 text-2xl font-semibold tracking-tight text-white">
              {{ $t('business.message.taskQueuePanelTitle') }}
            </div>
            <div class="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              {{ $t('business.message.taskQueuePanelDesc') }}
            </div>
          </div>
          <div
            class="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-4"
          >
            <div
              v-for="item in queueOverviewCards"
              :key="item.label"
              class="min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur"
            >
              <div
                class="truncate text-[11px] uppercase tracking-[0.18em] text-slate-400"
              >
                {{ item.label }}
              </div>
              <div class="mt-1 text-lg font-semibold text-white">
                {{ item.value }}
              </div>
              <div
                class="mt-1 line-clamp-1 text-[11px] leading-4 text-slate-400"
              >
                {{ item.description }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <Alert
        v-if="snapshotLoadFailed"
        show-icon
        type="error"
        :message="$t('business.message.taskQueueSnapshotLoadFailed')"
      />
      <Alert
        v-if="!snapshotLoadFailed"
        :description="queueOpsGuide.description"
        :message="queueOpsGuide.message"
        show-icon
        :type="queueOpsGuide.type"
      />
      <Alert
        v-if="queueMetricsLimited"
        show-icon
        type="warning"
        :message="$t('business.message.taskQueueMetricsLimited')"
      />

      <Alert
        v-if="taskObservabilityLoadFailed"
        show-icon
        type="warning"
        :message="$t('business.message.taskObservabilityLoadFailed')"
      />
      <Alert
        v-else-if="
          taskObservability?.redisError || taskObservability?.historyError
        "
        show-icon
        type="warning"
        :message="$t('business.message.taskObservabilityPartial')"
        :description="
          taskObservability.historyError || taskObservability.redisError
        "
      />

      <Card
        class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
        :title="$t('business.message.taskCapacityAndHistory')"
      >
        <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div
            v-for="item in taskObservabilityCards"
            :key="item.label"
            class="rounded-xl border border-slate-200/70 px-3 py-3 dark:border-slate-700"
          >
            <div class="text-xs text-slate-500 dark:text-slate-300">
              {{ item.label }}
            </div>
            <div class="mt-1 text-lg font-semibold">{{ item.value }}</div>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <Tag
            :color="
              taskObservability?.history.status === 'healthy'
                ? 'success'
                : taskObservability?.history.status === 'disabled'
                  ? 'default'
                  : 'warning'
            "
          >
            {{ $t('business.message.historyPersistence') }}:
            {{ taskObservability?.history.status || '-' }}
          </Tag>
          <Tag v-if="taskObservability?.history.dropped" color="error">
            {{ $t('business.message.historyDropped') }}:
            {{ taskObservability.history.dropped }}
          </Tag>
          <Tag>{{ taskObservability?.generatedAt || '-' }}</Tag>
        </div>
      </Card>
      <div
        class="min-w-0 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3 dark:border-slate-700/60"
        >
          <div>
            <div
              class="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              {{ $t('business.message.taskQueueList') }}
            </div>
            <div class="text-xs leading-5 text-slate-500 dark:text-slate-300">
              {{ $t('business.message.taskQueueListDesc') }}
            </div>
          </div>
          <VbenButton
            type="primary"
            :loading="snapshotLoading"
            @click="handleRefresh"
          >
            <ReloadOutlined />
            {{ $t('business.message.refreshQueue') }}
          </VbenButton>
        </div>
        <div class="min-w-0 overflow-x-auto px-0 py-0">
          <Grid :table-title="$t('business.message.taskQueueList')" />
        </div>
      </div>

      <Card
        class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
        :title="$t('business.message.onlineWorkerSnapshot')"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="text-sm leading-6 text-slate-500 dark:text-slate-300">
            {{ $t('business.message.onlineWorkerSnapshotDesc') }}
          </div>
          <Button
            size="small"
            @click="showWorkerSnapshot = !showWorkerSnapshot"
          >
            {{
              showWorkerSnapshot
                ? $t('business.message.closeSnapshot')
                : $t('business.message.viewRawSnapshot')
            }}
          </Button>
        </div>
        <JsonDetailViewer
          v-if="showWorkerSnapshot && workerSummaryText"
          class="mt-4"
          :search-placeholder="$t('business.message.jsonDataSearchPlaceholder')"
          :value="workerSummaryText"
        />
        <Table
          class="worker-table mt-4"
          :columns="workerColumns"
          :data-source="workerRows"
          :loading="snapshotLoading"
          :locale="{ emptyText: $t('business.message.noOnlineWorker') }"
          :pagination="false"
          :row-key="(record) => record.id"
          :scroll="{ x: 1280 }"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.dataIndex === 'status'">
              <Tag :color="record.status === 'active' ? 'success' : 'warning'">
                {{ record.status || '-' }}
              </Tag>
            </template>
            <template v-else-if="column.dataIndex === 'strictPriority'">
              <Tag :color="record.strictPriority ? 'processing' : 'default'">
                {{
                  record.strictPriority
                    ? $t('business.message.enabled')
                    : $t('business.message.disabled')
                }}
              </Tag>
            </template>
            <template v-else-if="column.dataIndex === 'queues'">
              <span
                class="block min-w-0 whitespace-normal break-words font-mono text-xs leading-5"
              >
                {{ formatWorkerQueues(record.queues) || '-' }}
              </span>
            </template>
            <template v-else-if="column.dataIndex === 'startedAt'">
              {{ record.startedAt || '-' }}
            </template>
          </template>
        </Table>
      </Card>
    </div>
  </Page>
</template>

<style scoped>
.worker-table :deep(.ant-table) {
  color: hsl(var(--foreground));
  background: transparent;
}

.worker-table :deep(.ant-table-container) {
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
}

.worker-table :deep(.ant-table-thead > tr > th) {
  font-weight: 600;
  color: hsl(var(--foreground));
  background: hsl(var(--accent));
  border-bottom-color: hsl(var(--border));
}

.worker-table :deep(.ant-table-thead > tr > th::before) {
  background-color: hsl(var(--heavy));
}

.worker-table :deep(.ant-table-tbody > tr > td) {
  color: hsl(var(--foreground));
  background: hsl(var(--card));
  border-bottom-color: hsl(var(--border));
}

.worker-table :deep(.ant-table-tbody > tr:hover > td) {
  background: hsl(var(--accent-hover));
}
</style>
