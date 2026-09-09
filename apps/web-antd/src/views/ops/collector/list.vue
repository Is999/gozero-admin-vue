<script lang="ts" setup>
// ================= 类型与依赖引入 =================
import type { CollectorApi } from '#/api/ops/collector';

import { computed, onMounted, ref } from 'vue';

import { Page, VbenButton } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  fetchCollectorFailures,
  fetchCollectorOverview,
  retryCollectorFailures,
  runCollector,
} from '#/api/ops/collector';
import {
  asActionPermission,
  OPS_ACTION_PERMISSION_CODES,
  hasAnyPermission,
} from '#/constants/permission-codes';
import { $t } from '#/locales';

import { getCollectorStateOptions, useColumns } from './data';

// ================= 页面状态 =================
// accessStore 保存当前账号的 uuid 权限码集合。
const accessStore = useAccessStore();
// submitting 用于统一控制“运行/重试”等高风险操作的重复点击。
const submitting = ref(false);
// currentRows 保存当前页失败事件快照，用于统计与批量重试。
const currentRows = ref<CollectorApi.FailureItem[]>([]);
// currentTotal 保存当前筛选条件下的失败事件总数。
const currentTotal = ref(0);
// overview 保存 collector 当前积压、配置与近窗口处理统计。
const overview = ref<CollectorApi.OverviewResp | null>(null);

// 查询条件：业务类型。
const searchBizType = ref('');
// 查询条件：失败事件状态。
const searchState = ref<'' | CollectorApi.FailureState>('');

// runLimit 控制“手动执行一轮”最大处理数量，避免误操作造成过大冲击。
const runLimit = ref(200);
// retryDelaySeconds 控制批量重试的延迟秒，便于避开瞬时抖动。
const retryDelaySeconds = ref(60);
// retryLimit 控制一次批量重试的最大条数，避免一键放大事故。
const retryLimit = ref(200);
// resetAttempt 控制人工重试时是否清零失败次数。
const resetAttempt = ref(true);

// canRunCollector 控制“执行一轮”按钮展示。
const canRunCollector = computed(() =>
  hasAnyPermission(accessStore.accessCodes, [
    OPS_ACTION_PERMISSION_CODES.COLLECTOR_FAILURE_RUN,
  ]),
);

// canRetryCollector 控制“批量重试”按钮展示。
const canRetryCollector = computed(() =>
  hasAnyPermission(accessStore.accessCodes, [
    OPS_ACTION_PERMISSION_CODES.COLLECTOR_FAILURE_RETRY,
  ]),
);

// collectorStateOptions 生成当前语言下的 Collector 状态选项。
const collectorStateOptions = computed(() => getCollectorStateOptions());

// stateSummaryCards 生成当前页的状态统计卡片，便于快速判断当前积压/失败分布。
const stateSummaryCards = computed(() => {
  const rows = currentRows.value;
  const countByState: Record<CollectorApi.FailureState, number> = {} as Record<
    CollectorApi.FailureState,
    number
  >;
  for (const item of rows) {
    const state = Number(item.state) as CollectorApi.FailureState;
    countByState[state] = (countByState[state] || 0) + 1;
  }
  return collectorStateOptions.value.map((item) => ({
    label: item.label,
    value: String(countByState[item.value] || 0),
  }));
});

// pageGuideText 汇总生产运维建议，降低误操作成本。
const pageGuideText = computed(() => {
  if ((overview.value?.runningTimeoutCount || 0) > 0) {
    return {
      description: $t('business.message.collectorTimeoutRiskDesc'),
      message: $t('business.message.collectorTimeoutRiskTitle'),
      type: 'warning' as const,
    };
  }
  if ((overview.value?.readyCount || 0) > 5000) {
    return {
      description: $t('business.message.collectorBacklogRiskDesc'),
      message: $t('business.message.collectorBacklogRiskTitle'),
      type: 'warning' as const,
    };
  }
  if (currentRows.value.some((item) => item.state === 4)) {
    return {
      description: $t('business.message.collectorDeadRiskDesc'),
      message: $t('business.message.collectorDeadRiskTitle'),
      type: 'warning' as const,
    };
  }
  if (currentRows.value.some((item) => item.state === 3)) {
    return {
      description: $t('business.message.collectorRetryRiskDesc'),
      message: $t('business.message.collectorRetryRiskTitle'),
      type: 'info' as const,
    };
  }
  return {
    description: $t('business.message.collectorHealthyDesc'),
    message: $t('business.message.collectorHealthyTitle'),
    type: 'success' as const,
  };
});

// overviewBacklogCards 汇总当前 Collector 全局积压状态。
const overviewBacklogCards = computed(() => {
  const currentOverview = overview.value;
  return [
    {
      label: $t('business.message.collectorReadyToRun'),
      value: String(currentOverview?.readyCount || 0),
      description: $t('business.message.collectorOldestBacklog', [
        formatSeconds(currentOverview?.oldestReadyAgeSeconds || 0),
      ]),
    },
    {
      label: $t('business.message.collectorStateRunning'),
      value: String(currentOverview?.runningCount || 0),
      description: $t('business.message.collectorTimeoutCount', [
        currentOverview?.runningTimeoutCount || 0,
      ]),
    },
    {
      label: $t('business.message.collectorStateRetry'),
      value: String(currentOverview?.retryCount || 0),
      description: $t('business.message.collectorDeadCount', [
        currentOverview?.deadCount || 0,
      ]),
    },
    {
      label: $t('business.message.collectorDoneTotal'),
      value: String(currentOverview?.doneCount || 0),
      description: $t('business.message.collectorPendingCount', [
        currentOverview?.pendingCount || 0,
      ]),
    },
  ];
});

// overviewWindowCards 汇总最近 1/5/15 分钟吞吐与耗时。
const overviewWindowCards = computed(() => {
  const currentOverview = overview.value;
  const windows = [
    currentOverview?.recent1m,
    currentOverview?.recent5m,
    currentOverview?.recent15m,
  ].filter(Boolean);
  return windows.map((item) => ({
    label: $t('business.message.collectorRecentMinutes', [item!.windowMinutes]),
    value: `${item!.successCount} / ${item!.failCount}`,
    description: $t('business.message.collectorAvgMaxCost', [
      formatMilliseconds(item!.avgCostMs),
      formatMilliseconds(item!.maxCostMs),
    ]),
  }));
});

// runtimeMetricCards 汇总当前进程正常链路运行态吞吐。
const runtimeMetricCards = computed(() => {
  const totals = overview.value?.runtimeMetrics?.totals;
  return [
    {
      label: $t('business.message.collectorKafkaPublished'),
      value: formatCount(totals?.published || 0),
      description: $t('business.message.collectorKafkaPublishFailed', [
        formatCount(totals?.publishFailed || 0),
      ]),
    },
    {
      label: $t('business.message.collectorKafkaConsumed'),
      value: formatCount(totals?.consumed || 0),
      description: $t('business.message.collectorKafkaInvalidDuplicate', [
        formatCount(totals?.invalid || 0),
        formatCount(totals?.duplicate || 0),
      ]),
    },
    {
      label: $t('business.message.collectorProcessorSucceeded'),
      value: formatCount(totals?.succeeded || 0),
      description: $t('business.message.collectorProcessorProcessedFailed', [
        formatCount(totals?.processed || 0),
        formatCount(totals?.failed || 0),
      ]),
    },
    {
      label: $t('business.message.collectorProcessorBatches'),
      value: formatCount(totals?.batches || 0),
      description: $t('business.message.collectorFailedBatchDead', [
        formatCount(totals?.failedBatches || 0),
        formatCount(totals?.dead || 0),
      ]),
    },
  ];
});

// runtimeWindowCards 汇总当前进程最近 1/5/15 分钟正常处理窗口。
const runtimeWindowCards = computed(() => {
  const metrics = overview.value?.runtimeMetrics;
  const windows = [
    metrics?.recent1m,
    metrics?.recent5m,
    metrics?.recent15m,
  ].filter((item) => item && item.windowMinutes > 0);
  return windows.map((item) => ({
    label: $t('business.message.collectorRecentMinutes', [item!.windowMinutes]),
    value: $t('business.message.collectorRuntimeWindowValue', [
      formatCount(item!.processed || 0),
      formatCount(item!.succeeded || 0),
      formatCount(item!.failed || 0),
      formatCount(item!.duplicate || 0),
    ]),
    description: $t('business.message.collectorRuntimeWindowDesc', [
      formatDecimal(item!.avgBatchSize || 0),
      formatMilliseconds(item!.avgCostMs || 0),
      formatMilliseconds(item!.maxCostMs || 0),
    ]),
    lastEventAt: item!.lastEventAt || '-',
  }));
});

// bizTypeTopRows 汇总最近 15 分钟最需要关注的业务类型排行。
const bizTypeTopRows = computed(() => overview.value?.bizTypeTop15m || []);

// runtimeBizTypeRows 汇总最近 15 分钟处理量最高的业务类型排行。
const runtimeBizTypeRows = computed(
  () => overview.value?.runtimeMetrics?.bizTypeTop15m || [],
);

// runtimeFreshnessText 展示当前进程运行态指标更新时间。
const runtimeFreshnessText = computed(() => {
  const metrics = overview.value?.runtimeMetrics;
  if (!metrics) {
    return $t('business.message.collectorOverviewLoading');
  }
  return [
    $t('business.message.collectorRuntimeScope', [metrics.scope || '-']),
    $t('business.message.collectorRuntimeStartedAt', [
      metrics.startedAt || '-',
    ]),
    $t('business.message.collectorRuntimeGeneratedAt', [
      metrics.generatedAt || '-',
    ]),
  ].join(' | ');
});

// collectorConfigSummary 汇总当前生效的重要 Collector 参数，便于判断是否需要继续调参。
const collectorConfigSummary = computed(() => {
  const currentOverview = overview.value;
  if (!currentOverview) {
    return $t('business.message.collectorOverviewLoading');
  }
  return [
    $t('business.message.collectorKafkaBatch', [
      currentOverview.kafkaBatchSize,
    ]),
    $t('business.message.collectorFailureRetryBatch', [
      currentOverview.failureRunnerBatchSize,
    ]),
    $t('business.message.collectorPollInterval', [
      currentOverview.failureRunnerIntervalSecs,
    ]),
    $t('business.message.collectorLeaseSeconds', [
      currentOverview.runningLeaseSeconds,
    ]),
    $t('business.message.collectorMaxRetry', [currentOverview.maxRetryTimes]),
  ].join(' | ');
});

// overviewFreshnessText 展示概览生成时间和缓存命中信息，避免巡检时误判实时性。
const overviewFreshnessText = computed(() => {
  const currentOverview = overview.value;
  if (!currentOverview) {
    return $t('business.message.collectorOverviewLoading');
  }
  const cacheMode = currentOverview.overviewCacheHit
    ? $t('business.message.cacheHit')
    : $t('business.message.realtimeAggregate');
  return [
    $t('business.message.collectorOverviewTime', [
      currentOverview.overviewGeneratedAt || '-',
    ]),
    cacheMode,
    $t('business.message.collectorCacheWindow', [
      currentOverview.overviewCacheTTLSeconds || 0,
    ]),
    $t('business.message.collectorCacheAge', [
      formatSeconds(currentOverview.overviewCacheAgeSeconds || 0),
    ]),
  ].join(' | ');
});

// ================= 表格配置 =================
const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: useColumns(),
    keepSource: true,
    maxHeight: 680,
    proxyConfig: {
      autoLoad: false,
      ajax: {
        query: async ({
          page,
        }: {
          page: { currentPage: number; pageSize: number };
        }) => {
          const state =
            searchState.value === '' ? undefined : searchState.value;
          const responseData = await fetchCollectorFailures({
            bizType: searchBizType.value.trim() || undefined,
            state,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
          currentRows.value = responseData.list || [];
          currentTotal.value = responseData.total || 0;
          return {
            list: responseData.list || [],
            total: responseData.total || 0,
          };
        },
      },
      response: {
        result: 'list',
        total: 'total',
      },
    },
    rowConfig: {
      keyField: 'id',
    },
    toolbarConfig: {
      custom: true,
      refresh: true,
      search: false,
      zoom: true,
    },
  },
});

// ================= 业务方法 =================
// handleQuery 刷新列表数据。
function handleQuery() {
  void Promise.all([gridApi.query(), loadOverview()]);
}

// handleReset 清空筛选条件并刷新列表。
function handleReset() {
  searchBizType.value = '';
  searchState.value = '';
  void Promise.all([gridApi.query(), loadOverview()]);
}

// loadOverview 拉取 Collector 概览与近窗口性能观察信息。
async function loadOverview() {
  overview.value = await fetchCollectorOverview();
}

// handleRunCollector 执行一轮 Collector 失败账本重试。
function handleRunCollector() {
  if (submitting.value) {
    return;
  }
  Modal.confirm({
    title: $t('business.message.collectorConfirmRunTitle'),
    content: $t('business.message.collectorConfirmRunDesc'),
    okText: $t('business.message.confirmRun'),
    cancelText: $t('business.message.cancel'),
    async onOk() {
      submitting.value = true;
      try {
        const responseData = await runCollector({
          limit: Number(runLimit.value || 0) || undefined,
        });
        message.success(
          $t('business.message.collectorRunTriggered', [
            responseData.processed || 0,
          ]),
        );
        await Promise.all([gridApi.query(), loadOverview()]);
      } catch (error) {
        message.error(
          $t('business.message.collectorRunFailed', [String(error)]),
        );
      } finally {
        submitting.value = false;
      }
    },
  });
}

// resolveRetryCandidates 根据当前列表筛选出可重试失败事件 ID（优先 state=待重试/死信）。
function resolveRetryCandidates() {
  const ids = currentRows.value
    .filter((item) => item.state === 3 || item.state === 4)
    .map((item) => Number(item.id))
    .filter((item) => Number.isFinite(item) && item > 0);
  const limitValue = Number(retryLimit.value || 0);
  return limitValue > 0 ? ids.slice(0, limitValue) : ids;
}

// handleRetryBatch 对当前筛选结果中可重试失败事件执行批量重试。
function handleRetryBatch() {
  if (submitting.value) {
    return;
  }
  const ids = resolveRetryCandidates();
  if (ids.length === 0) {
    message.warning($t('business.message.noRetryableFailuresOnPage'));
    return;
  }
  Modal.confirm({
    title: $t('business.message.confirmBatchRetry'),
    content: $t('business.message.collectorConfirmRetryDesc', [ids.length]),
    okText: $t('business.message.confirmRetry'),
    cancelText: $t('business.message.cancel'),
    async onOk() {
      submitting.value = true;
      try {
        await retryCollectorFailures({
          delaySeconds: Number(retryDelaySeconds.value || 0) || undefined,
          ids,
          resetAttempt: !!resetAttempt.value,
        });
        message.success($t('business.message.batchRetrySubmitted'));
        await Promise.all([gridApi.query(), loadOverview()]);
      } catch (error) {
        message.error(
          $t('business.message.collectorRetryFailed', [String(error)]),
        );
      } finally {
        submitting.value = false;
      }
    },
  });
}

onMounted(() => {
  void Promise.all([gridApi.query(), loadOverview()]);
});

// formatSeconds 把秒数转成更易读的时长展示。
function formatSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0s';
  }
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${(seconds / 3600).toFixed(seconds >= 36_000 ? 0 : 1)}h`;
}

// formatMilliseconds 把毫秒耗时格式化为便于巡检的文本。
function formatMilliseconds(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0ms';
  }
  if (ms < 1000) {
    return `${ms.toFixed(ms >= 100 ? 0 : 1)}ms`;
  }
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 2)}s`;
}

// formatDecimal 格式化小数指标，避免卡片数值过长。
function formatDecimal(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  return value.toFixed(value >= 100 ? 0 : 1);
}

// formatCount 格式化数量指标，保证大数展示稳定。
function formatCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  return Math.floor(value).toLocaleString();
}
</script>

<template>
  <Page :title="$t('business.message.collectorFailure')">
    <div class="grid min-w-0 gap-2">
      <!-- 浅色卡片沿用主题色与正文对比度，深色外观仅在暗色主题启用。 -->
      <section
        class="min-w-0 overflow-hidden rounded-2xl border border-border bg-card bg-[radial-gradient(circle_at_top_left,_hsl(var(--primary)/0.08),_transparent_55%)] dark:border-cyan-500/20 dark:bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(15,23,42,0.9))] px-5 py-4 text-foreground shadow-sm dark:text-slate-100 dark:shadow-[0_16px_44px_rgba(15,23,42,0.3)]"
      >
        <div
          class="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start"
        >
          <div class="min-w-0">
            <div
              class="text-xs font-semibold uppercase tracking-[0.28em] text-primary dark:text-cyan-300/80"
            >
              Collector Ops
            </div>
            <div
              class="mt-2 text-2xl font-semibold tracking-tight text-foreground dark:text-white"
            >
              {{ $t('business.message.collectorConsoleTitle') }}
            </div>
            <div
              class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground dark:text-slate-300"
            >
              {{ $t('business.message.collectorConsoleDesc') }}
            </div>
          </div>
          <div
            class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2"
          >
            <div
              v-for="item in stateSummaryCards"
              :key="item.label"
              class="min-w-0 rounded-xl border border-border bg-background/70 dark:border-white/10 dark:bg-white/5 px-3 py-3 backdrop-blur"
            >
              <div
                class="truncate text-[11px] uppercase tracking-[0.18em] text-muted-foreground dark:text-slate-400"
              >
                {{ item.label }}
              </div>
              <div
                class="mt-1 text-lg font-semibold text-foreground dark:text-white"
              >
                {{ item.value }}
              </div>
              <div
                class="mt-1 text-[11px] leading-4 text-muted-foreground dark:text-slate-400"
              >
                {{ $t('business.message.currentPage') }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <Alert
        :description="pageGuideText.description"
        :message="pageGuideText.message"
        show-icon
        :type="pageGuideText.type"
      />

      <div class="grid min-w-0 gap-2 xl:grid-cols-2">
        <Card
          class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.collectorRuntimeThroughput')"
        >
          <div class="grid min-w-0 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <div
              v-for="item in runtimeMetricCards"
              :key="item.label"
              class="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/90 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-800/60"
            >
              <div class="text-xs text-slate-500 dark:text-slate-300">
                {{ item.label }}
              </div>
              <div
                class="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100"
              >
                {{ item.value }}
              </div>
              <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {{ item.description }}
              </div>
            </div>
          </div>
          <div
            class="mt-3 break-words text-xs text-slate-500 dark:text-slate-400"
          >
            {{ runtimeFreshnessText }}
          </div>
        </Card>

        <Card
          class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.collectorRuntimeRecentWindows')"
        >
          <div class="grid min-w-0 gap-3 md:grid-cols-3">
            <div
              v-for="item in runtimeWindowCards"
              :key="item.label"
              class="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/90 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-800/60"
            >
              <div class="text-xs text-slate-500 dark:text-slate-300">
                {{ item.label }}
              </div>
              <div
                class="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                {{ item.value }}
              </div>
              <div
                class="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400"
              >
                {{ item.description }}
              </div>
              <div class="mt-1 truncate text-xs text-slate-400">
                {{
                  $t('business.message.collectorLastEventAt', [
                    item.lastEventAt,
                  ])
                }}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div class="grid min-w-0 gap-2 xl:grid-cols-2">
        <Card
          class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.collectorGlobalBacklog')"
        >
          <div class="grid min-w-0 gap-3 sm:grid-cols-2">
            <div
              v-for="item in overviewBacklogCards"
              :key="item.label"
              class="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/90 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-800/60"
            >
              <div class="text-xs text-slate-500 dark:text-slate-300">
                {{ item.label }}
              </div>
              <div
                class="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100"
              >
                {{ item.value }}
              </div>
              <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {{ item.description }}
              </div>
            </div>
          </div>
        </Card>

        <Card
          class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.collectorRecentWindowPerformance')"
        >
          <div class="grid min-w-0 gap-3 md:grid-cols-3">
            <div
              v-for="item in overviewWindowCards"
              :key="item.label"
              class="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/90 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-800/60"
            >
              <div class="text-xs text-slate-500 dark:text-slate-300">
                {{ item.label }}
              </div>
              <div
                class="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100"
              >
                {{ item.value }}
              </div>
              <div
                class="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400"
              >
                {{ $t('business.message.successFailed') }};
                {{ item.description }}
              </div>
            </div>
          </div>
          <div
            class="mt-3 break-words rounded-xl border border-dashed border-slate-200/70 px-3 py-2 text-xs text-slate-500 dark:border-slate-700/60 dark:text-slate-300"
          >
            {{ $t('business.message.currentParameters') }}:
            {{ collectorConfigSummary }}
          </div>
          <div
            class="mt-2 break-words text-xs text-slate-500 dark:text-slate-400"
          >
            {{ overviewFreshnessText }}
          </div>
        </Card>
      </div>

      <div class="grid min-w-0 gap-2 xl:grid-cols-2">
        <Card
          class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.collectorRuntimeBizTypeRank')"
        >
          <div v-if="runtimeBizTypeRows.length > 0" class="space-y-3">
            <div
              v-for="item in runtimeBizTypeRows"
              :key="item.bizType"
              class="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/90 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-800/60"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div
                    class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
                  >
                    {{ item.bizType }}
                  </div>
                  <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {{
                      $t('business.message.collectorRuntimeBizTypeStatDesc', [
                        formatCount(item.processed),
                        formatCount(item.succeeded),
                        formatCount(item.failed),
                        formatCount(item.duplicate),
                      ])
                    }}
                  </div>
                </div>
                <div
                  class="text-right text-xs text-slate-500 dark:text-slate-400"
                >
                  <div>
                    {{
                      $t('business.message.collectorRuntimeBizTypeBatchDesc', [
                        formatCount(item.batches),
                        formatDecimal(item.avgBatchSize),
                      ])
                    }}
                  </div>
                  <div class="mt-1">
                    {{
                      $t('business.message.collectorAvgMaxCostSlash', [
                        formatMilliseconds(item.avgCostMs),
                        formatMilliseconds(item.maxCostMs),
                      ])
                    }}
                  </div>
                  <div class="mt-1">
                    {{
                      $t('business.message.collectorLastEventAt', [
                        item.lastEventAt || '-',
                      ])
                    }}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-slate-500 dark:text-slate-300">
            {{ $t('business.message.collectorNoRuntimeBizTypeRank') }}
          </div>
        </Card>

        <Card
          class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.collectorBizTypeHotRank')"
        >
          <div v-if="bizTypeTopRows.length > 0" class="space-y-3">
            <div
              v-for="item in bizTypeTopRows"
              :key="item.bizType"
              class="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/90 px-4 py-3 dark:border-slate-700/60 dark:bg-slate-800/60"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div
                    class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
                  >
                    {{ item.bizType }}
                  </div>
                  <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {{
                      $t('business.message.collectorBizTypeStatDesc', [
                        item.readyCount,
                        item.runningCount,
                        item.retryCount,
                        item.deadCount,
                      ])
                    }}
                  </div>
                </div>
                <div
                  class="text-right text-xs text-slate-500 dark:text-slate-400"
                >
                  <div>
                    {{
                      $t('business.message.collectorSuccessFailCount', [
                        item.recentSuccessCount,
                        item.recentFailCount,
                      ])
                    }}
                  </div>
                  <div class="mt-1">
                    {{
                      $t('business.message.collectorAvgMaxCostSlash', [
                        formatMilliseconds(item.recentAvgCostMs),
                        formatMilliseconds(item.recentMaxCostMs),
                      ])
                    }}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-slate-500 dark:text-slate-300">
            {{ $t('business.message.collectorNoBizTypeRank') }}
          </div>
        </Card>
      </div>

      <div
        class="min-w-0 rounded-2xl border border-slate-200/70 bg-white/95 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
      >
        <div
          class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/70 px-4 py-3 dark:border-slate-700/60"
        >
          <div>
            <div
              class="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              {{ $t('business.message.filterAndOperation') }}
            </div>
            <div class="text-xs leading-5 text-slate-500 dark:text-slate-300">
              {{ $t('business.message.collectorFilterOperationDesc') }}
            </div>
          </div>

          <Space :size="8" wrap>
            <VbenButton
              v-if="canRunCollector"
              v-access="
                asActionPermission(
                  OPS_ACTION_PERMISSION_CODES.COLLECTOR_FAILURE_RUN,
                )
              "
              type="primary"
              :disabled="submitting"
              @click="handleRunCollector"
            >
              {{
                submitting
                  ? $t('business.message.running')
                  : $t('business.message.runOnce')
              }}
            </VbenButton>
            <VbenButton
              v-if="canRetryCollector"
              v-access="
                asActionPermission(
                  OPS_ACTION_PERMISSION_CODES.COLLECTOR_FAILURE_RETRY,
                )
              "
              type="primary"
              :disabled="submitting"
              @click="handleRetryBatch"
            >
              {{
                submitting
                  ? $t('business.message.submitting')
                  : $t('business.message.batchRetry')
              }}
            </VbenButton>
          </Space>
        </div>

        <div class="grid min-w-0 gap-3 px-4 py-3 md:grid-cols-2 xl:grid-cols-3">
          <div class="min-w-0">
            <div class="mb-1 text-xs text-slate-500 dark:text-slate-300">
              {{ $t('business.message.eventCategoryBizType') }}
            </div>
            <Input
              v-model:value="searchBizType"
              id="collector-biz-type-filter"
              name="collector-biz-type-filter"
              autocomplete="off"
              allow-clear
              :placeholder="$t('business.message.collectorBizTypePlaceholder')"
            />
          </div>
          <div class="min-w-0">
            <div class="mb-1 text-xs text-slate-500 dark:text-slate-300">
              {{ $t('business.message.collectorFailureState') }}
            </div>
            <Select
              v-model:value="searchState"
              allow-clear
              class="w-full"
              :placeholder="$t('business.message.allStates')"
              :options="collectorStateOptions"
            />
          </div>
          <div class="flex min-w-0 flex-wrap items-end gap-2">
            <Button type="primary" @click="handleQuery">
              {{ $t('business.message.search') }}
            </Button>
            <Button @click="handleReset">
              {{ $t('business.message.reset') }}
            </Button>
          </div>
        </div>

        <div
          class="grid min-w-0 gap-3 border-t border-slate-200/70 px-4 py-3 md:grid-cols-3 dark:border-slate-700/60"
        >
          <div class="min-w-0">
            <div class="mb-1 text-xs text-slate-500 dark:text-slate-300">
              {{ $t('business.message.runLimitLabel') }}
            </div>
            <InputNumber
              v-model:value="runLimit"
              id="collector-run-limit"
              name="collector-run-limit"
              :min="1"
              :precision="0"
              class="w-full"
              :placeholder="$t('business.message.default200')"
            />
          </div>
          <div class="min-w-0">
            <div class="mb-1 text-xs text-slate-500 dark:text-slate-300">
              {{ $t('business.message.retryDelaySecondsLabel') }}
            </div>
            <InputNumber
              v-model:value="retryDelaySeconds"
              id="collector-retry-delay-seconds"
              name="collector-retry-delay-seconds"
              :min="0"
              :precision="0"
              class="w-full"
              :placeholder="$t('business.message.default60')"
            />
          </div>
          <div class="min-w-0">
            <div class="mb-1 text-xs text-slate-500 dark:text-slate-300">
              {{ $t('business.message.retryLimitLabel') }}
            </div>
            <InputNumber
              v-model:value="retryLimit"
              id="collector-retry-limit"
              name="collector-retry-limit"
              :min="1"
              :precision="0"
              class="w-full"
              :placeholder="$t('business.message.default200')"
            />
          </div>
        </div>

        <div
          class="break-words border-t border-slate-200/70 px-4 py-3 text-xs text-slate-500 dark:border-slate-700/60 dark:text-slate-300"
        >
          {{ $t('business.message.collectorMatchedTotalHint', [currentTotal]) }}
          <template v-if="resetAttempt">
            {{ $t('business.message.collectorResetAttemptHint') }}
          </template>
          <Button
            class="ml-2 px-0"
            size="small"
            type="link"
            @click="resetAttempt = !resetAttempt"
          >
            {{
              resetAttempt
                ? $t('business.message.switchToKeepAttempt')
                : $t('business.message.switchToResetAttempt')
            }}
          </Button>
        </div>
      </div>

      <Grid
        class="min-w-0"
        :table-title="$t('business.message.collectorFailureList')"
      />
    </div>
  </Page>
</template>
