<script lang="ts" setup>
import type { Dayjs } from 'dayjs';

import type { TaskApi } from '#/api/ops/task';

import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page, VbenButton } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import { QuestionCircleOutlined } from '@ant-design/icons-vue';
import {
  Alert,
  Button,
  Card,
  Input,
  message,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';
import { RangePicker } from 'ant-design-vue/es/date-picker';
import dayjs from 'dayjs';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteTask,
  fetchTaskFailures,
  fetchTaskItemsOverview,
  fetchTaskQueues,
  fetchTaskRuns,
  getTaskInfo,
  getTaskRunHistory,
  runTaskNow,
} from '#/api/ops/task';
import {
  asActionPermission,
  OPS_ACTION_PERMISSION_CODES,
  hasAnyPermission,
} from '#/constants/permission-codes';
import { $t } from '#/locales';
import { copyTextToClipboard } from '#/utils/security/password';
import {
  currentSessionStateIdentity,
  registerSessionStateCleanup,
} from '#/utils/session-state-gate';

import JsonDetailViewer from '../../system/components/json-detail-viewer.vue';
import CopyableTextCell from '../runtime-config/components/copyable-text-cell.vue';
import {
  getTaskQueueOptions,
  getTaskQueueDescription,
  safePrettyJson,
} from '../shared';
import {
  buildTaskTraceDetailRows,
  buildTaskTraceSummaryRows,
  formatTaskTraceAction,
  hasTaskExecutionTrace,
  taskTraceActionColor,
} from '../task-trace';
import WorkflowIdCell from './components/workflow-id-cell.vue';
import {
  formatTraceCount,
  getTaskStateOptions,
  getTaskExecutionTrace,
  getTaskWorkflowId,
  isExactTaskID,
  useColumns,
} from './data';

import '../task-observation.css';

// FAILURE_HISTORY_DAYS 与后端默认失败摘要保留期一致，列表使用游标按需加载。
const FAILURE_HISTORY_DAYS = 14;
// TASK_RUN_HISTORY_DAYS 与后端全部任务终态摘要默认保留期一致。
const TASK_RUN_HISTORY_DAYS = 1;

type TableActionParams<T = any> = {
  code: string;
  row: T;
};

type TaskStateFilterValue = '' | TaskApi.ListTaskItemsReq['state'];
type TaskStateTotals = Partial<
  Record<TaskApi.ListTaskItemsReq['state'], number>
>;
type TaskTimeRangeValue = [Dayjs, Dayjs] | undefined;
type TaskHistoryView = 'failures' | 'runs';

// TASK_LIST_AUTO_REFRESH_INTERVAL_MS 表示任务运行态列表和详情的自动刷新间隔。
const TASK_LIST_AUTO_REFRESH_INTERVAL_MS = 5000;
// TASK_LIVE_STATES 表示仍可能发生状态或执行指标变化的任务状态。
const TASK_LIVE_STATES = new Set<TaskApi.ListTaskItemsReq['state']>([
  'active',
  'aggregating',
  'pending',
]);

const route = useRoute();
const router = useRouter();
const accessStore = useAccessStore();
const queueOptions = ref<Array<{ label: string; value: string }>>(
  getTaskQueueOptions().map((item) => ({
    label: item.label,
    value: item.value,
  })),
);
const searchQueue = ref('');
const searchState = ref<TaskStateFilterValue>('');
const searchGroup = ref('');
// searchTaskId 保存任务 ID 筛选关键字，和详情深链 route.query.taskId 分开。
const searchTaskId = ref('');
// searchTaskName 记录任务名称关键字，便于按 task_periodic.name 追踪定时任务执行情况。
const searchTaskName = ref('');
const searchWorkflowId = ref('');
// searchTimeRange 保存任务活动时间范围；scheduled 状态对应 nextProcessAt。
const searchTimeRange = ref<TaskTimeRangeValue>();
// vTaskTimeRangeIdentifiers 为 RangePicker 的开始、结束输入补充独立表单标识。
const vTaskTimeRangeIdentifiers = {
  mounted(element: HTMLElement) {
    const [startInput, endInput] =
      element.querySelectorAll<HTMLInputElement>('input');
    startInput?.setAttribute('id', 'task-item-time-range-start');
    startInput?.setAttribute('name', 'task-item-time-range-start');
    endInput?.setAttribute('id', 'task-item-time-range-end');
    endInput?.setAttribute('name', 'task-item-time-range-end');
  },
};
// vTaskHistoryTimeRangeIdentifiers 为历史时间范围补充独立表单标识。
const vTaskHistoryTimeRangeIdentifiers = {
  mounted(element: HTMLElement) {
    const [startInput, endInput] =
      element.querySelectorAll<HTMLInputElement>('input');
    startInput?.setAttribute('id', 'task-history-time-range-start');
    startInput?.setAttribute('name', 'task-history-time-range-start');
    endInput?.setAttribute('id', 'task-history-time-range-end');
    endInput?.setAttribute('name', 'task-history-time-range-end');
  },
};
// routeWorkflowNode 保存工作流状态页带入的节点名称，用于提示当前列表正在定位哪个节点。
const routeWorkflowNode = ref('');
const routeSource = ref('');
const aggregateMode = ref(false);
const currentQueryQueue = ref('');
const currentQueryState = ref<TaskStateFilterValue>('');
const currentQueryGroup = ref('');
// currentQueryTaskId 保存本次实际使用的任务 ID 筛选条件，用于结果摘要回显。
const currentQueryTaskId = ref('');
// currentQueryTaskName 保存本次列表实际使用的任务名称筛选条件，用于结果摘要回显。
const currentQueryTaskName = ref('');
const currentQueryWorkflowId = ref('');
// currentQueryStartTime/EndTime 保存本次实际查询的时间边界，用于摘要回显。
const currentQueryStartTime = ref('');
const currentQueryEndTime = ref('');
const currentTaskRows = ref<TaskApi.TaskItem[]>([]);
// currentTaskTotal 保存最近一次有效查询总数，旧请求失效时保持当前表格分页不变。
const currentTaskTotal = ref(0);
// currentStateTotals 保存后端返回的状态总数快照，用于空状态聚合时显示其它可切换状态。
const currentStateTotals = ref<TaskStateTotals>({});
// taskListScanLimited 标记当前 Redis 内容筛选是否仅覆盖最近 5000 条受控扫描窗口。
const taskListScanLimited = ref(false);
const autoOpenedTaskSignature = ref('');
const initializing = ref(true);
// historyView 控制 DB 历史卡片显示全部任务终态或失败补偿明细。
const historyView = ref<TaskHistoryView>('runs');
// taskRunHistoryRows 保存全部实际任务的短期终态摘要。
const taskRunHistoryRows = ref<TaskApi.TaskRunHistoryItem[]>([]);
const taskRunHistoryLoading = ref(false);
const taskRunHistoryLoadFailed = ref(false);
const taskRunHistoryRequestSeq = ref(0);
const taskRunHistoryNextCursor = ref('');
const taskRunHistoryHasMore = ref(false);
const taskRunHistoryStartTime = ref('');
const taskRunHistoryEndTime = ref('');
const taskRunHistoryDetailID = ref(0);
// taskHistoryTaskID 精确筛选当前 DB 历史视图中的任务 ID。
const taskHistoryTaskID = ref('');
// taskHistoryTaskName 精确筛选全部任务终态中的任务展示名称。
const taskHistoryTaskName = ref('');
// taskHistoryPeriodicName 精确筛选全部任务终态中的周期配置名称。
const taskHistoryPeriodicName = ref('');
// failureHistoryTaskName 精确筛选最终失败任务的展示名称。
const failureHistoryTaskName = ref('');
// failureHistoryPeriodicName 精确筛选最终失败任务的周期配置名称。
const failureHistoryPeriodicName = ref('');
// taskHistoryTimeRange 保存 DB 任务历史的独立时间筛选。
const taskHistoryTimeRange = ref<TaskTimeRangeValue>();
// failureHistoryRows 保存 DB 中短期最终失败摘要，不和 Redis 实时任务混合分页。
const failureHistoryRows = ref<TaskApi.TaskFailureItem[]>([]);
const failureHistoryLoading = ref(false);
const failureHistoryLoadFailed = ref(false);
const failureRerunCheckError = ref('');
const failureHistoryRequestSeq = ref(0);
const failureHistoryNextCursor = ref('');
const failureHistoryHasMore = ref(false);
const failureHistoryStartTime = ref('');
const failureHistoryEndTime = ref('');
const failureRerunTaskId = ref('');
// routeTaskDetailConsumed 标记当前路由中的详情深链已消费，避免页面内查询重复打开。
const routeTaskDetailConsumed = ref(false);

type HandleSearchOptions = {
  // clearTaskDetailQuery 表示是否在本地消费入口上下文，手动查询不改写路由。
  clearTaskDetailQuery?: boolean;
  // preferExactTask 表示完整任务 ID 优先走队列内精确详情查询。
  preferExactTask?: boolean;
};

type OverflowTooltipProps = InstanceType<typeof Tooltip>['$props'];
// TaskDetailModalHandle 保存当前任务详情弹框实例，便于打开新详情前只关闭旧详情，不影响其它确认弹窗。
type TaskDetailModalHandle = ReturnType<typeof Modal.info>;
// TaskDetailTarget 保存当前详情弹框对应的任务，用于运行中静默刷新。
type TaskDetailTarget = Pick<TaskApi.TaskItem, 'id' | 'queue' | 'state'>;

// taskDetailModalHandle 指向当前任务详情弹框；遮罩点击或操作按钮关闭后会重置。
let taskDetailModalHandle: null | TaskDetailModalHandle = null;
// taskDetailModalIdentity 标识当前详情弹框，避免其它弹框关闭回调清理新实例。
let taskDetailModalIdentity = '';
// taskDetailTarget 保存当前详情任务及状态，终态后停止无效详情请求。
const taskDetailTarget = ref<null | TaskDetailTarget>(null);
// taskListAutoRefreshTimer 保存任务列表与运行中详情的自动刷新定时器。
const taskListAutoRefreshTimer = ref<null | number>(null);
// taskListAutoRefreshing 防止自动刷新请求重入。
const taskListAutoRefreshing = ref(false);
// taskListAutoRefreshEnabled 控制 Redis 任务列表是否按五秒周期刷新，默认关闭以降低高频筛选压力。
const taskListAutoRefreshEnabled = ref(false);
// exactTaskQueryLoading 防止完整任务 ID 精确查询被重复提交。
const exactTaskQueryLoading = ref(false);
// taskDetailRequestSeq 标记最后一次初始详情请求，路由或页面失效后拒绝旧响应弹窗。
const taskDetailRequestSeq = ref(0);
// taskListRequestSeq 标记最近一次列表请求，避免旧筛选或旧账号响应覆盖当前页面。
const taskListRequestSeq = ref(0);
// unregisterTaskListSessionCleanup 在账号切换时停止旧账号轮询并清理任务详情。
const unregisterTaskListSessionCleanup = registerSessionStateCleanup(
  resetTaskListSessionState,
);

const canBatchRun = computed(() =>
  hasAnyPermission(accessStore.accessCodes, [
    OPS_ACTION_PERMISSION_CODES.TASK_RUN,
  ]),
);

const canBatchDelete = computed(() =>
  hasAnyPermission(accessStore.accessCodes, [
    OPS_ACTION_PERMISSION_CODES.TASK_DELETE,
  ]),
);

// historyCellText 安全读取历史表的长文本字段，并统一空值占位。
function historyCellText(record: Record<string, any>, dataIndex: unknown) {
  if (typeof dataIndex !== 'string') {
    return '-';
  }
  return String(record[dataIndex] ?? '').trim() || '-';
}

// taskRunHistoryColumns 定义全部任务终态列表的轻量摘要列。
const taskRunHistoryColumns = computed(() => [
  {
    dataIndex: 'taskId',
    ellipsis: true,
    title: $t('business.message.taskId'),
    width: 240,
  },
  {
    dataIndex: 'queue',
    title: $t('business.message.queue'),
    width: 120,
  },
  {
    dataIndex: 'workflowId',
    ellipsis: true,
    title: $t('business.message.workflowId'),
    width: 220,
  },
  {
    dataIndex: 'taskName',
    ellipsis: true,
    title: $t('business.message.taskName'),
    width: 190,
  },
  {
    dataIndex: 'taskType',
    ellipsis: true,
    title: $t('business.message.taskType'),
    width: 190,
  },
  {
    key: 'status',
    title: $t('business.message.taskStatus'),
    width: 100,
  },
  {
    dataIndex: 'periodicName',
    ellipsis: true,
    title: $t('business.message.periodicTaskName'),
    width: 180,
  },
  {
    dataIndex: 'retried',
    title: $t('business.message.retried'),
    width: 90,
  },
  {
    dataIndex: 'maxRetry',
    title: $t('business.message.maxRetry'),
    width: 90,
  },
  {
    dataIndex: 'traceTotal',
    title: $t('business.message.taskTraceTotalCount'),
    width: 110,
  },
  {
    dataIndex: 'durationMs',
    title: $t('business.message.executionDuration'),
    width: 110,
  },
  {
    dataIndex: 'finishedAt',
    title: $t('business.message.finishedAt'),
    width: 190,
  },
  {
    key: 'action',
    title: $t('business.message.actions'),
    width: 90,
  },
]);

// failureHistoryColumns 定义失败补偿所需的最小字段。
const failureHistoryColumns = computed(() => [
  {
    dataIndex: 'taskId',
    ellipsis: true,
    title: $t('business.message.taskId'),
    width: 240,
  },
  {
    dataIndex: 'queue',
    title: $t('business.message.queue'),
    width: 120,
  },
  {
    dataIndex: 'workflowId',
    ellipsis: true,
    title: $t('business.message.workflowId'),
    width: 220,
  },
  {
    dataIndex: 'taskName',
    ellipsis: true,
    title: $t('business.message.taskName'),
    width: 170,
  },
  {
    dataIndex: 'taskType',
    ellipsis: true,
    title: $t('business.message.taskType'),
    width: 180,
  },
  {
    dataIndex: 'periodicName',
    ellipsis: true,
    title: $t('business.message.periodicTaskName'),
    width: 180,
  },
  {
    dataIndex: 'retried',
    title: $t('business.message.retried'),
    width: 90,
  },
  {
    dataIndex: 'maxRetry',
    title: $t('business.message.maxRetry'),
    width: 90,
  },
  {
    dataIndex: 'errorMessage',
    ellipsis: true,
    title: $t('business.message.latestFailureReason'),
    width: 300,
  },
  {
    dataIndex: 'failedAt',
    title: $t('business.message.failedAt'),
    width: 190,
  },
  {
    key: 'action',
    title: $t('business.message.actions'),
    width: 160,
  },
]);

const queueHintText = computed(() =>
  queueOptions.value
    .map((item) => `${item.value}: ${getTaskQueueDescription(item.value)}`)
    .join('\n'),
);

// taskHistoryHelpText 在 DB 历史入口就近说明实时任务与终态历史的数据边界。
const taskHistoryHelpText = computed(() =>
  [
    $t('business.message.taskHistoryScopeDesc'),
    $t('business.message.taskRealtimeRetentionTitle'),
    $t('business.message.taskRealtimeRetentionDesc'),
  ].join('\n'),
);

// taskStateOptions 展示 Redis 当前仍保存的全部调度状态，completed 仅覆盖短期成功保留窗口。
const taskStateOptions = computed(() => getTaskStateOptions());

const currentStateSummary = computed(() => {
  if (currentQueryState.value) {
    const matched = taskStateOptions.value.find(
      (item) => item.value === currentQueryState.value,
    );
    return matched?.label || currentQueryState.value;
  }
  return currentQueryGroup.value
    ? $t('business.message.allStatesWithAggregating')
    : $t('business.message.allStatesWithoutAggregating');
});

// workflowNodeLocateGuide 展示工作流拓扑跳转带入的精准定位条件。
const workflowNodeLocateGuide = computed(() => {
  if (!currentQueryWorkflowId.value || !currentQueryTaskName.value) {
    return null;
  }
  const nodeName = routeWorkflowNode.value || currentQueryTaskName.value;
  return {
    description: $t('business.message.taskNodeLocatedDesc', [
      currentQueryWorkflowId.value,
      currentQueryTaskName.value,
      nodeName,
    ]),
    message: $t('business.message.taskNodeLocatedTitle', [nodeName]),
  };
});

const taskListOverviewCards = computed(() => {
  // workflowCardLabel 根据当前是否按工作流筛选，展示不同卡片标题。
  let workflowCardLabel = $t('business.message.linkedWorkflow');
  // workflowCardValue 展示当前筛选链路或当前页已关联链路的任务数量。
  let workflowCardValue = String(
    currentTaskRows.value.filter((item) => Boolean(getTaskWorkflowId(item)))
      .length,
  );
  if (currentQueryWorkflowId.value) {
    workflowCardLabel = $t('business.message.filteredWorkflow');
    workflowCardValue = currentQueryWorkflowId.value;
  }
  return [
    {
      description: currentQueryQueue.value
        ? $t('business.message.currentFocusedQueue', [currentQueryQueue.value])
        : $t('business.message.multiQueueAggregateView'),
      label: $t('business.message.queryQueue'),
      value: currentQueryQueue.value || $t('business.message.allQueues'),
    },
    {
      description: $t('business.message.hitStatusDesc'),
      label: $t('business.message.hitStatus'),
      value: currentStateSummary.value,
    },
    {
      description: $t('business.message.runnableTaskCountDesc'),
      label: $t('business.message.taskRunNow'),
      value: String(currentPageRunnableTasks.value.length),
    },
    {
      description: $t('business.message.deletableTaskCountDesc'),
      label: $t('business.message.deletable'),
      value: String(currentPageDeletableTasks.value.length),
    },
    {
      description: $t('business.message.failedTaskCountDesc'),
      label: $t('business.message.failedTasks'),
      value: String(currentPageFailedTasks.value.length),
    },
    {
      description: currentQueryWorkflowId.value
        ? $t('business.message.workflowFilteredDesc')
        : $t('business.message.workflowLinkedCountDesc'),
      label: workflowCardLabel,
      value: workflowCardValue,
    },
  ];
});

const currentTaskSummaryRows = computed(() => {
  const rows = currentTaskRows.value;
  const runnableCount = rows.filter((item) => canRunTask(item)).length;
  const deletableCount = rows.filter((item) => canDeleteTask(item)).length;
  const failedCount = rows.filter((item) =>
    Boolean(String(item.lastErr || '').trim()),
  ).length;
  const traceTotalCount = sumTaskTraceTotalCount(rows);
  const workflowLinkedCount = rows.filter((item) =>
    Boolean(getTaskWorkflowId(item)),
  ).length;
  return [
    {
      label: $t('business.message.currentPageTaskCount'),
      value: String(rows.length),
    },
    { label: $t('business.message.taskRunNow'), value: String(runnableCount) },
    { label: $t('business.message.deletable'), value: String(deletableCount) },
    {
      label: $t('business.message.withFailureInfo'),
      value: String(failedCount),
    },
    {
      label: $t('business.message.linkedWorkflow'),
      value: String(workflowLinkedCount),
    },
    {
      label: $t('business.message.taskTraceTotalCount'),
      value: formatTraceCount(traceTotalCount),
    },
    {
      label: $t('business.message.taskIdFilter'),
      value: currentQueryTaskId.value || $t('business.message.notFiltered'),
    },
    {
      label: $t('business.message.taskNameFilter'),
      value: currentQueryTaskName.value || $t('business.message.notFiltered'),
    },
    {
      label: $t('business.message.taskActivityTime'),
      value: currentQueryTimeRangeLabel.value,
    },
  ];
});

// currentQueryTimeRangeLabel 格式化当前查询时间范围，未筛选时保持明确提示。
const currentQueryTimeRangeLabel = computed(() => {
  if (!currentQueryStartTime.value && !currentQueryEndTime.value) {
    return $t('business.message.notFiltered');
  }
  return `${formatTaskQueryTime(currentQueryStartTime.value)} ~ ${formatTaskQueryTime(
    currentQueryEndTime.value,
  )}`;
});

const quickSummaryActionButtons = computed(() => {
  const rows = currentTaskRows.value;
  const stateTotals = currentStateTotals.value || {};
  const useStateTotals =
    !searchTaskName.value.trim() && !searchWorkflowId.value.trim();
  const retryCount = rows.filter(
    (item) =>
      String(item.state || '')
        .trim()
        .toLowerCase() === 'retry',
  ).length;
  const archivedCount = rows.filter(
    (item) =>
      String(item.state || '')
        .trim()
        .toLowerCase() === 'archived',
  ).length;
  const scheduledCount = rows.filter(
    (item) =>
      String(item.state || '')
        .trim()
        .toLowerCase() === 'scheduled',
  ).length;
  return [
    {
      count: useStateTotals ? Number(stateTotals.retry || 0) : retryCount,
      label: $t('business.message.switchToRetryTasks'),
      state: 'retry' as TaskStateFilterValue,
    },
    {
      count: useStateTotals ? Number(stateTotals.archived || 0) : archivedCount,
      label: $t('business.message.switchToArchivedTasks'),
      state: 'archived' as TaskStateFilterValue,
    },
    {
      count: useStateTotals
        ? Number(stateTotals.scheduled || 0)
        : scheduledCount,
      label: $t('business.message.switchToScheduledTasks'),
      state: 'scheduled' as TaskStateFilterValue,
    },
  ].filter((item) => item.count > 0 && searchState.value !== item.state);
});

const currentPageRunnableTasks = computed(() =>
  currentTaskRows.value.filter((item) => canRunTask(item)),
);

const currentPageDeletableTasks = computed(() =>
  currentTaskRows.value.filter((item) => canDeleteTask(item)),
);

const currentPageFailedTasks = computed(() =>
  currentTaskRows.value.filter((item) =>
    Boolean(String(item.lastErr || '').trim()),
  ),
);

const currentPageFailedRunnableTasks = computed(() =>
  currentPageFailedTasks.value.filter((item) => canRunTask(item)),
);

// exactTaskSearch 表示当前任务 ID 可直接查询详情，绕过受控模糊扫描窗口。
const exactTaskSearch = computed(() => isExactTaskID(searchTaskId.value));

const currentStateOperationGuide = computed(() => {
  const stateValue = String(currentQueryState.value || '').trim();
  switch (stateValue) {
    case 'active': {
      return {
        description: $t('business.message.activeTaskGuideDesc'),
        message: $t('business.message.activeTaskGuideTitle'),
        type: 'info' as const,
      };
    }
    case 'aggregating': {
      return {
        description: $t('business.message.aggregatingTaskGuideDesc'),
        message: $t('business.message.aggregatingTaskGuideTitle'),
        type: 'warning' as const,
      };
    }
    case 'archived': {
      return {
        description: $t('business.message.archivedTaskGuideDesc'),
        message: $t('business.message.archivedTaskGuideTitle'),
        type: 'error' as const,
      };
    }
    case 'completed': {
      return {
        description: $t('business.message.completedTaskGuideDesc'),
        message: $t('business.message.completedTaskGuideTitle'),
        type: 'success' as const,
      };
    }
    case 'pending': {
      return {
        description: $t('business.message.pendingTaskGuideDesc'),
        message: $t('business.message.pendingTaskGuideTitle'),
        type: 'info' as const,
      };
    }
    case 'retry': {
      return {
        description: $t('business.message.retryTaskGuideDesc'),
        message: $t('business.message.retryTaskGuideTitle'),
        type: 'warning' as const,
      };
    }
    case 'scheduled': {
      return {
        description: $t('business.message.scheduledTaskGuideDesc'),
        message: $t('business.message.scheduledTaskGuideTitle'),
        type: 'info' as const,
      };
    }
    default: {
      return {
        description: $t('business.message.allTaskGuideDesc'),
        message: $t('business.message.allTaskGuideTitle'),
        type: 'info' as const,
      };
    }
  }
});

const quickStateActions = computed<
  Array<{
    description: string;
    label: string;
    state: TaskStateFilterValue;
  }>
>(() => [
  {
    description: $t('business.message.commonStatesQuickDesc'),
    label: $t('business.message.commonStatesQuick'),
    state: '',
  },
  {
    description: $t('business.message.retryTasksQuickDesc'),
    label: $t('business.message.taskStateRetry'),
    state: 'retry',
  },
  {
    description: $t('business.message.archivedTasksQuickDesc'),
    label: $t('business.message.taskStateArchived'),
    state: 'archived',
  },
  {
    description: $t('business.message.scheduledTasksQuickDesc'),
    label: $t('business.message.taskStateScheduled'),
    state: 'scheduled',
  },
  {
    description: $t('business.message.pendingTasksQuickDesc'),
    label: $t('business.message.taskStatePending'),
    state: 'pending',
  },
  {
    description: $t('business.message.activeTasksQuickDesc'),
    label: $t('business.message.taskStateActive'),
    state: 'active',
  },
]);

const [Grid, gridApi] = useVbenVxeGrid({
  gridOptions: {
    columns: useColumns(onActionClick),
    keepSource: true,
    maxHeight: 680,
    proxyConfig: {
      autoLoad: false,
      ajax: {
        query: async ({ page }: { page: any }) => {
          const sourceSessionIdentity = currentSessionStateIdentity();
          const currentRequestSeq = taskListRequestSeq.value + 1;
          taskListRequestSeq.value = currentRequestSeq;
          const timeRange = buildTaskTimeRangeParams();
          const requestIsCurrent = () =>
            currentRequestSeq === taskListRequestSeq.value &&
            sourceSessionIdentity === currentSessionStateIdentity();
          let result: Awaited<ReturnType<typeof queryTasksByFilters>>;
          try {
            result = await queryTasksByFilters({
              endTime: timeRange.endTime,
              group: searchGroup.value || undefined,
              page: page.currentPage,
              pageSize: page.pageSize,
              stateValue: searchState.value,
              startTime: timeRange.startTime,
            });
          } catch (error) {
            if (!requestIsCurrent()) {
              return {
                list: currentTaskRows.value,
                total: currentTaskTotal.value,
              };
            }
            throw error;
          }
          if (!requestIsCurrent()) {
            return {
              list: currentTaskRows.value,
              total: currentTaskTotal.value,
            };
          }
          aggregateMode.value = result.aggregateMode;
          currentQueryQueue.value = searchQueue.value;
          currentQueryState.value = result.effectiveState;
          currentQueryGroup.value = searchGroup.value;
          currentQueryTaskId.value = searchTaskId.value.trim();
          currentQueryTaskName.value = searchTaskName.value.trim();
          currentQueryWorkflowId.value = searchWorkflowId.value;
          currentQueryStartTime.value = timeRange.startTime || '';
          currentQueryEndTime.value = timeRange.endTime || '';
          currentTaskRows.value = result.list;
          currentTaskTotal.value = result.total;
          currentStateTotals.value = result.stateTotals;
          taskListScanLimited.value = result.scanLimited;
          syncTaskListAutoRefresh();
          await tryAutoOpenTaskDetail();
          return {
            list: result.list,
            total: result.total,
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

function normalizeRouteQueryValue(value: unknown) {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  return String(value || '').trim();
}

// normalizeRouteTimeRange 从路由参数恢复时间范围，非法或缺边界时忽略。
function normalizeRouteTimeRange(): TaskTimeRangeValue {
  const start = normalizeRouteQueryValue(route.query.startTime);
  const end = normalizeRouteQueryValue(route.query.endTime);
  if (!start || !end) {
    return undefined;
  }
  const startAt = dayjs(start);
  const endAt = dayjs(end);
  if (!startAt.isValid() || !endAt.isValid() || startAt.isAfter(endAt)) {
    return undefined;
  }
  return [startAt, endAt];
}

async function loadQueueOptions() {
  try {
    const responseData = await fetchTaskQueues();
    const dynamicOptions = (responseData.queues || [])
      .map((item) => String(item.name || '').trim())
      .filter(Boolean)
      .map((item) => ({
        label: item,
        value: item,
      }));
    if (dynamicOptions.length > 0) {
      queueOptions.value = dynamicOptions;
    }
  } catch {
    // 读取队列失败时继续使用内置兜底队列，避免查询入口失效。
  }
}

// taskRunHistoryFilter 返回全部任务终态可安全使用的等值过滤条件。
function taskRunHistoryFilter() {
  const historyTaskId = taskHistoryTaskID.value.trim();
  const realtimeTaskId = searchTaskId.value.trim();
  const taskId = historyTaskId || realtimeTaskId;
  if (!historyTaskId && realtimeTaskId && !isExactTaskID(realtimeTaskId)) {
    return { skip: true } as const;
  }
  const state = searchState.value;
  if (state && state !== 'archived' && state !== 'completed') {
    return { skip: true } as const;
  }
  // status 把 Redis 终态筛选转换为 DB 历史状态。
  let status: TaskApi.ListTaskRunsReq['status'];
  if (state === 'completed') {
    status = 'success';
  } else if (state === 'archived') {
    status = 'failed';
  }
  return {
    skip: false,
    status,
    taskId: taskId || undefined,
    workflowId: searchWorkflowId.value.trim() || undefined,
  };
}

// loadTaskRunHistory 独立加载全部任务终态摘要，列表查询不读取快照 JSON。
async function loadTaskRunHistory(options: { append?: boolean } = {}) {
  const append = options.append === true;
  if (append && taskRunHistoryLoading.value) {
    return;
  }
  const cursor = append ? taskRunHistoryNextCursor.value : undefined;
  if (append && !cursor) {
    return;
  }
  const filter = taskRunHistoryFilter();
  if (filter.skip) {
    if (!append) {
      taskRunHistoryRequestSeq.value += 1;
      taskRunHistoryRows.value = [];
      taskRunHistoryNextCursor.value = '';
      taskRunHistoryHasMore.value = false;
      taskRunHistoryLoadFailed.value = false;
    }
    return;
  }
  if (!append) {
    const timeRange = buildTaskHistoryTimeRangeParams();
    if (timeRange.startTime && timeRange.endTime) {
      taskRunHistoryStartTime.value = timeRange.startTime;
      taskRunHistoryEndTime.value = timeRange.endTime;
    } else {
      const end = new Date();
      taskRunHistoryEndTime.value = end.toISOString();
      taskRunHistoryStartTime.value = new Date(
        end.getTime() - TASK_RUN_HISTORY_DAYS * 86_400_000,
      ).toISOString();
    }
  }
  const sourceSessionIdentity = currentSessionStateIdentity();
  const requestSeq = taskRunHistoryRequestSeq.value + 1;
  taskRunHistoryRequestSeq.value = requestSeq;
  taskRunHistoryLoading.value = true;
  taskRunHistoryLoadFailed.value = false;
  try {
    const result = await fetchTaskRuns({
      cursor,
      endTime: taskRunHistoryEndTime.value,
      pageSize: 20,
      queue: searchQueue.value.trim() || undefined,
      startTime: taskRunHistoryStartTime.value,
      status: filter.status,
      taskId: filter.taskId,
      workflowId: filter.workflowId,
      taskName: taskHistoryTaskName.value.trim() || undefined,
      periodicName: taskHistoryPeriodicName.value.trim() || undefined,
    });
    if (
      requestSeq !== taskRunHistoryRequestSeq.value ||
      sourceSessionIdentity !== currentSessionStateIdentity()
    ) {
      return;
    }
    const rows = result.items || [];
    taskRunHistoryRows.value = append
      ? [...taskRunHistoryRows.value, ...rows]
      : rows;
    taskRunHistoryNextCursor.value = result.nextCursor || '';
    taskRunHistoryHasMore.value = Boolean(
      result.hasMore && taskRunHistoryNextCursor.value,
    );
  } catch {
    if (requestSeq === taskRunHistoryRequestSeq.value) {
      taskRunHistoryLoadFailed.value = true;
    }
  } finally {
    if (requestSeq === taskRunHistoryRequestSeq.value) {
      taskRunHistoryLoading.value = false;
    }
  }
}

// loadFailureHistory 独立加载最终失败历史，数据库异常不影响 Redis 实时任务操作。
async function loadFailureHistory(options: { append?: boolean } = {}) {
  const append = options.append === true;
  if (append && failureHistoryLoading.value) {
    return;
  }
  const cursor = append ? failureHistoryNextCursor.value : undefined;
  if (append && !cursor) {
    return;
  }
  if (!append) {
    const timeRange = buildTaskHistoryTimeRangeParams();
    if (timeRange.startTime && timeRange.endTime) {
      failureHistoryStartTime.value = timeRange.startTime;
      failureHistoryEndTime.value = timeRange.endTime;
    } else {
      const end = new Date();
      failureHistoryEndTime.value = end.toISOString();
      failureHistoryStartTime.value = new Date(
        end.getTime() - FAILURE_HISTORY_DAYS * 86_400_000,
      ).toISOString();
    }
  }
  const sourceSessionIdentity = currentSessionStateIdentity();
  const requestSeq = failureHistoryRequestSeq.value + 1;
  failureHistoryRequestSeq.value = requestSeq;
  failureHistoryLoading.value = true;
  failureHistoryLoadFailed.value = false;
  failureRerunCheckError.value = '';
  try {
    const result = await fetchTaskFailures({
      cursor,
      endTime: failureHistoryEndTime.value,
      pageSize: 20,
      queue: searchQueue.value.trim() || undefined,
      startTime: failureHistoryStartTime.value,
      taskId:
        taskHistoryTaskID.value.trim() ||
        (isExactTaskID(searchTaskId.value)
          ? searchTaskId.value.trim()
          : undefined),
      taskName: failureHistoryTaskName.value.trim() || undefined,
      periodicName: failureHistoryPeriodicName.value.trim() || undefined,
      workflowId: searchWorkflowId.value.trim() || undefined,
    });
    if (
      requestSeq !== failureHistoryRequestSeq.value ||
      sourceSessionIdentity !== currentSessionStateIdentity()
    ) {
      return;
    }
    const rows = result.items || [];
    failureHistoryRows.value = append
      ? [...failureHistoryRows.value, ...rows]
      : rows;
    failureHistoryNextCursor.value = result.nextCursor || '';
    failureHistoryHasMore.value = Boolean(
      result.hasMore && failureHistoryNextCursor.value,
    );
    failureRerunCheckError.value = result.rerunCheckError || '';
  } catch {
    if (requestSeq === failureHistoryRequestSeq.value) {
      failureHistoryLoadFailed.value = true;
    }
  } finally {
    if (requestSeq === failureHistoryRequestSeq.value) {
      failureHistoryLoading.value = false;
    }
  }
}

async function queryTasksByFilters(queryParams: {
  endTime?: string;
  group?: string;
  page: number;
  pageSize: number;
  startTime?: string;
  stateValue: TaskStateFilterValue;
}) {
  const { endTime, group, page, pageSize, startTime, stateValue } = queryParams;
  const responseData = await fetchTaskItemsOverview({
    group: String(group || '').trim() || undefined,
    includeAggregating: !!String(group || '').trim(),
    page,
    pageSize,
    queue: searchQueue.value.trim() || undefined,
    state: stateValue || undefined,
    endTime,
    startTime,
    taskId: searchTaskId.value.trim() || undefined,
    taskName: searchTaskName.value.trim() || undefined,
    workflowId: searchWorkflowId.value.trim() || undefined,
  });
  return {
    aggregateMode: !!responseData.aggregateMode,
    effectiveState: (responseData.effectiveState || '') as TaskStateFilterValue,
    list: responseData.tasks || [],
    scanLimited: !!responseData.scanLimited,
    stateTotals: responseData.stateTotals || {},
    total: responseData.total || 0,
  };
}

// buildTaskTimeRangeParams 将前端时间范围转换为后端约定的 RFC3339 字段。
function buildTaskTimeRangeParams() {
  const [startAt, endAt] = searchTimeRange.value || [];
  return {
    endTime: endAt ? endAt.toDate().toISOString() : undefined,
    startTime: startAt ? startAt.toDate().toISOString() : undefined,
  };
}

// buildTaskHistoryTimeRangeParams 转换 DB 历史卡片的独立时间范围。
function buildTaskHistoryTimeRangeParams() {
  const [startAt, endAt] = taskHistoryTimeRange.value || [];
  return {
    endTime: endAt ? endAt.toDate().toISOString() : undefined,
    startTime: startAt ? startAt.toDate().toISOString() : undefined,
  };
}

// formatTaskQueryTime 将 RFC3339 时间转成页面展示时间。
function formatTaskQueryTime(value: string) {
  if (!value) {
    return $t('business.message.noLimit');
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm:ss') : value;
}

function buildTaskDetailPayload(
  input:
    | Pick<TaskApi.TaskItem, 'id' | 'queue'>
    | { queue: string; taskId: string },
) {
  return {
    queue: String(input.queue || '').trim(),
    taskId:
      'taskId' in input
        ? String(input.taskId || '').trim()
        : String(input.id || '').trim(),
  };
}

// getTaskHeaderValue 从任务头信息里提取指定字段，兼容大小写差异。
function getTaskHeaderValue(task: TaskApi.TaskItem, headerName: string) {
  const normalizedName = String(headerName || '')
    .trim()
    .toLowerCase();
  const headerEntries = Object.entries(task.headers || {});
  const matchedEntry = headerEntries.find(
    ([key]) =>
      String(key || '')
        .trim()
        .toLowerCase() === normalizedName,
  );
  return String(matchedEntry?.[1] || '').trim();
}

// buildOverflowTooltipProps 返回统一的长文本悬浮展示配置。
function buildOverflowTooltipProps(text: string): OverflowTooltipProps {
  return {
    overlayStyle: {
      maxWidth: '720px',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    },
    placement: 'topLeft' as const,
    title: text,
  };
}

// formatTaskDurationMs 把任务耗时转换成详情弹窗展示文本。
function formatTaskDurationMs(ms?: number) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return '-';
  }
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  }
  if (value < 3_600_000) {
    return `${(value / 60_000).toFixed(value >= 600_000 ? 0 : 1)}m`;
  }
  return `${(value / 3_600_000).toFixed(value >= 36_000_000 ? 0 : 1)}h`;
}

// sumTaskTraceTotalCount 汇总当前页任务运行指标总处理量。
function sumTaskTraceTotalCount(tasks: TaskApi.TaskItem[]) {
  let total = 0;
  for (const task of tasks) {
    const trace = getTaskExecutionTrace(task);
    const count = Number(trace?.totalCount || 0);
    if (Number.isFinite(count) && count > 0) {
      total += count;
    }
  }
  return total;
}

// taskDetailToneClass 返回任务详情信息块的视觉语义。
function taskDetailToneClass(tone?: string) {
  const toneMap: Record<string, string> = {
    danger:
      'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
    default:
      'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700/70 dark:bg-slate-900/40 dark:text-slate-100',
    info: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300',
    primary:
      'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    warning:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  };
  return toneMap[tone || 'default'] || toneMap.default;
}

// taskStateTagColor 返回任务状态标签颜色。
function taskStateTagColor(state?: string) {
  const normalized = String(state || '').trim();
  const colorMap: Record<string, string> = {
    active: 'processing',
    aggregating: 'purple',
    archived: 'error',
    completed: 'success',
    pending: 'default',
    retry: 'warning',
    scheduled: 'blue',
  };
  return colorMap[normalized] || 'default';
}

// renderTaskDetailField 渲染任务详情中的单个信息块。
function renderTaskDetailField(row: Array<any>) {
  const [label, rawValue, tone, mono] = row;
  const value = String(rawValue || '-');
  return h(
    'div',
    {
      class: `rounded-lg border px-4 py-3 ${taskDetailToneClass(tone)}`,
    },
    [
      h(
        'div',
        {
          class: 'text-xs font-medium text-slate-500 dark:text-slate-400',
        },
        label,
      ),
      h(Tooltip, buildOverflowTooltipProps(value), {
        default: () =>
          h(
            'div',
            {
              class: [
                'mt-1 truncate text-sm font-semibold',
                mono ? 'font-mono' : '',
              ]
                .filter(Boolean)
                .join(' '),
              title: value,
            },
            value,
          ),
      }),
    ],
  );
}

// hasTaskDetailValue 判断详情字段是否包含需要展示的信息。
function hasTaskDetailValue(rawValue: unknown) {
  if (rawValue === null || rawValue === undefined) {
    return false;
  }
  const value = String(rawValue).trim();
  return value !== '' && value !== '-';
}

// visibleTaskDetailRows 过滤无值详情项，保留零值、否等业务状态。
function visibleTaskDetailRows(rows: Array<Array<any>>) {
  return rows.filter((row) => hasTaskDetailValue(row[1]));
}

// renderTaskDetailSection 渲染任务详情分区。
function renderTaskDetailSection(
  title: string,
  rows: Array<Array<any>>,
  gridClass = 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3',
) {
  const visibleRows = visibleTaskDetailRows(rows);
  if (visibleRows.length === 0) {
    return null;
  }
  return h('section', { class: 'space-y-2' }, [
    h('div', { class: 'text-sm font-semibold' }, title),
    h(
      'div',
      { class: gridClass },
      visibleRows.map((row) => renderTaskDetailField(row)),
    ),
  ]);
}

// renderTaskHistoryHero 渲染数据库终态详情的统一摘要与快捷操作。
function renderTaskHistoryHero(
  task: TaskApi.TaskFailureItem | TaskApi.TaskRunHistoryItem,
  status: 'failed' | 'success',
  onViewWorkflow?: () => void,
) {
  const statusText =
    status === 'success'
      ? $t('business.message.success')
      : $t('business.message.failed');
  const durationMs = 'durationMs' in task ? task.durationMs : undefined;
  const finishedAt = 'finishedAt' in task ? task.finishedAt : task.failedAt;
  return h(
    'section',
    {
      class:
        'rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/70 dark:bg-slate-900/60',
    },
    [
      h('div', { class: 'flex flex-wrap items-start justify-between gap-3' }, [
        h('div', { class: 'min-w-0' }, [
          h(
            Tooltip,
            buildOverflowTooltipProps(task.taskName || task.taskId || '-'),
            {
              default: () =>
                h(
                  'div',
                  {
                    class:
                      'truncate text-base font-semibold text-slate-900 dark:text-slate-100',
                  },
                  task.taskName || task.taskId || '-',
                ),
            },
          ),
          h(
            'div',
            {
              class:
                'mt-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400',
            },
            task.taskId || '-',
          ),
        ]),
        h(Space, { size: 8, wrap: true }, () => [
          h(Tag, { color: status === 'success' ? 'success' : 'error' }, () =>
            $t('business.message.taskStateTag', [statusText]),
          ),
          h(Tag, { color: 'processing' }, () =>
            $t('business.message.taskQueueTag', [task.queue || '-']),
          ),
          h(Tag, { color: 'blue' }, () => 'DB'),
        ]),
      ]),
      h(
        'div',
        {
          class:
            'mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 text-xs dark:border-slate-700/70',
        },
        [
          h('div', { class: 'flex flex-wrap items-center gap-x-5 gap-y-2' }, [
            durationMs === undefined
              ? null
              : h('div', {}, [
                  h(
                    'span',
                    { class: 'text-slate-500 dark:text-slate-400' },
                    `${$t('business.message.executionDuration')}：`,
                  ),
                  h(
                    'span',
                    {
                      class: 'font-semibold text-slate-800 dark:text-slate-100',
                    },
                    formatTaskDurationMs(durationMs),
                  ),
                ]),
            h('div', {}, [
              h(
                'span',
                { class: 'text-slate-500 dark:text-slate-400' },
                `${
                  status === 'success'
                    ? $t('business.message.finishedAt')
                    : $t('business.message.failedAt')
                }：`,
              ),
              h(
                'span',
                { class: 'font-semibold text-slate-800 dark:text-slate-100' },
                formatTaskQueryTime(finishedAt),
              ),
            ]),
          ]),
          h('div', { class: 'flex flex-wrap items-center gap-2' }, [
            h(
              Button,
              {
                size: 'small',
                onClick: () =>
                  copyTextToClipboard(
                    task.taskId,
                    $t('business.message.taskIdCopied'),
                    $t('business.message.noTaskIdToCopy'),
                  ),
              },
              () => $t('business.message.copyTaskId'),
            ),
            task.workflowId
              ? h(
                  Button,
                  {
                    size: 'small',
                    onClick: () =>
                      copyTextToClipboard(
                        task.workflowId || '',
                        $t('business.message.workflowIdCopied'),
                        $t('business.message.noWorkflowIdToCopy'),
                      ),
                  },
                  () => $t('business.message.copyWorkflowId'),
                )
              : null,
            task.workflowId && onViewWorkflow
              ? h(
                  Button,
                  {
                    size: 'small',
                    type: 'primary',
                    onClick: onViewWorkflow,
                  },
                  () => $t('business.message.viewWorkflowStatus'),
                )
              : null,
          ]),
        ],
      ),
    ],
  );
}

// renderTaskHistorySnapshotGuide 以紧凑说明展示数据库快照的数据边界。
function renderTaskHistorySnapshotGuide() {
  return h(
    'div',
    {
      class:
        'rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs leading-5 text-slate-600 dark:text-slate-300',
    },
    $t('business.message.taskHistoryDetailSnapshotGuide'),
  );
}

// renderTaskFailureReasonSection 展示完整失败原因并提供复制入口。
function renderTaskFailureReasonSection(errorMessage?: string) {
  const failureReason = String(errorMessage || '').trim();
  if (!failureReason) {
    return null;
  }
  return h('section', { class: 'space-y-2' }, [
    h('div', { class: 'flex flex-wrap items-center justify-between gap-2' }, [
      h(
        'div',
        { class: 'text-sm font-semibold' },
        $t('business.message.latestFailureReason'),
      ),
      h(
        Button,
        {
          size: 'small',
          onClick: () =>
            copyTextToClipboard(
              failureReason,
              $t('business.message.copied'),
              $t('business.message.noValueToCopy', [
                $t('business.message.latestFailureReason'),
              ]),
            ),
        },
        () => $t('business.message.copy'),
      ),
    ]),
    h(Alert, {
      description: h(
        'div',
        { class: 'whitespace-pre-wrap break-all font-mono text-xs leading-5' },
        failureReason,
      ),
      message: $t('business.message.taskHistoryFailureDetailGuide'),
      showIcon: true,
      type: 'error',
    }),
  ]);
}

// renderTaskExecutionTraceSection 渲染任务执行处理量摘要和动作明细。
function renderTaskExecutionTraceSection(trace?: TaskApi.TaskExecutionTrace) {
  if (!hasTaskExecutionTrace(trace)) {
    return null;
  }
  const currentTrace = trace as TaskApi.TaskExecutionTrace;
  const summaryRows = buildTaskTraceSummaryRows(currentTrace);
  const detailRows = buildTaskTraceDetailRows(currentTrace);
  const gridClass =
    'grid grid-cols-[120px_minmax(320px,520px)_88px_76px_88px] items-center gap-3 px-3 py-2';
  return h(
    'section',
    {
      class:
        'space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/50',
    },
    [
      h('div', { class: 'flex flex-wrap items-center justify-between gap-2' }, [
        h(
          'div',
          { class: 'text-sm font-semibold' },
          $t('business.message.taskExecutionTrace'),
        ),
        currentTrace.name
          ? h(Tag, { color: 'processing' }, () => currentTrace.name)
          : null,
      ]),
      h(
        'div',
        { class: 'grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4' },
        summaryRows.map((row) =>
          h(
            'div',
            {
              class: `rounded-lg border px-4 py-3 ${taskDetailToneClass(String(row[2] || 'default'))}`,
            },
            [
              h(
                'div',
                { class: 'text-xs text-[var(--vben-text-color-secondary)]' },
                row[0],
              ),
              h(
                'div',
                { class: 'mt-1 truncate text-sm font-semibold' },
                typeof row[1] === 'string' ? row[1] : formatTraceCount(row[1]),
              ),
            ],
          ),
        ),
      ),
      detailRows.length > 0
        ? h(
            'div',
            {
              class: 'overflow-x-auto',
            },
            [
              h(
                'div',
                {
                  class:
                    'inline-block min-w-[964px] w-max overflow-hidden rounded-lg border border-slate-200 align-top dark:border-slate-700/70',
                },
                [
                  h(
                    'div',
                    {
                      class: `${gridClass} border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-400`,
                    },
                    [
                      $t('business.message.taskTraceAction'),
                      $t('business.message.taskTraceObject'),
                      $t('business.message.taskTraceCount'),
                      $t('business.message.taskTraceTimes'),
                      $t('business.message.taskTraceElapsed'),
                    ].map((label, index) =>
                      h(
                        'div',
                        { class: index >= 2 ? 'text-right' : '' },
                        label,
                      ),
                    ),
                  ),
                  ...detailRows.map((detail) =>
                    h(
                      'div',
                      {
                        class: `${gridClass} border-b border-slate-100 last:border-b-0 dark:border-slate-800`,
                      },
                      [
                        h(
                          Tag,
                          { color: taskTraceActionColor(detail.action) },
                          () => formatTaskTraceAction(detail.action),
                        ),
                        h(
                          Tooltip,
                          buildOverflowTooltipProps(detail.name || '-'),
                          {
                            default: () =>
                              h(
                                'div',
                                {
                                  class:
                                    'min-w-0 truncate rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200',
                                  title: detail.name || '-',
                                },
                                detail.name || '-',
                              ),
                          },
                        ),
                        h(
                          'div',
                          {
                            class:
                              'text-right text-sm font-semibold tabular-nums',
                          },
                          [formatTraceCount(detail.count)],
                        ),
                        h('div', { class: 'text-right text-sm tabular-nums' }, [
                          formatTraceCount(detail.times),
                        ]),
                        h('div', { class: 'text-right text-sm tabular-nums' }, [
                          formatTaskDurationMs(detail.elapsedMs),
                        ]),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          )
        : null,
    ],
  );
}

// formatTaskResultText 返回任务结果展示文本；未写 result 时给出明确提示。
function formatTaskResultText(task: TaskApi.TaskItem) {
  const result = task.result;
  if (!result || Object.keys(result).length === 0) {
    return $t('business.message.taskResultEmptyGuide');
  }
  return safePrettyJson(result);
}

// buildTaskOperationGuide 返回当前任务状态对应的处理建议，降低误操作成本。
function buildTaskOperationGuide(task: TaskApi.TaskItem) {
  const taskState = String(task.state || '')
    .trim()
    .toLowerCase();
  switch (taskState) {
    case 'active': {
      return {
        description: $t('business.message.taskDetailActiveDesc'),
        message: $t('business.message.taskDetailActiveTitle'),
        type: 'info' as const,
      };
    }
    case 'archived': {
      return {
        description: $t('business.message.taskDetailArchivedDesc'),
        message: $t('business.message.taskDetailArchivedTitle'),
        type: 'error' as const,
      };
    }
    case 'completed': {
      return {
        description: $t('business.message.taskDetailCompletedDesc'),
        message: $t('business.message.taskDetailCompletedTitle'),
        type: 'success' as const,
      };
    }
    case 'pending': {
      return {
        description: $t('business.message.taskDetailPendingDesc'),
        message: $t('business.message.taskDetailPendingTitle'),
        type: 'info' as const,
      };
    }
    case 'retry': {
      return {
        description: $t('business.message.taskDetailRetryDesc'),
        message: $t('business.message.taskDetailRetryTitle'),
        type: 'warning' as const,
      };
    }
    case 'scheduled': {
      return {
        description: $t('business.message.taskDetailScheduledDesc'),
        message: $t('business.message.taskDetailScheduledTitle'),
        type: 'info' as const,
      };
    }
    default: {
      return {
        description: $t('business.message.taskDetailDefaultDesc'),
        message: $t('business.message.taskDetailDefaultTitle'),
        type: 'info' as const,
      };
    }
  }
}

// renderTaskDetailGuideAlert 渲染任务状态提示；有失败信息时合并展示，避免详情顶部出现重复提示框。
function renderTaskDetailGuideAlert(
  operationGuide: ReturnType<typeof buildTaskOperationGuide>,
  lastErr?: string,
) {
  const errorText = String(lastErr || '').trim();
  return h(Alert, {
    description: errorText
      ? h('div', { class: 'space-y-3' }, [
          h('div', operationGuide.description),
          h('div', {
            class: 'border-t border-current/20',
          }),
          h('div', { class: 'space-y-1' }, [
            h(
              'div',
              { class: 'text-sm font-semibold' },
              $t('business.message.latestFailureReason'),
            ),
            h('div', { class: 'break-words' }, errorText),
          ]),
        ])
      : operationGuide.description,
    message: operationGuide.message,
    showIcon: true,
    type: errorText ? 'error' : operationGuide.type,
  });
}

// invalidateTaskDetailRequest 让尚未返回的初始详情请求失效。
function invalidateTaskDetailRequest() {
  taskDetailRequestSeq.value += 1;
}

// closeTaskDetailModal 仅关闭任务详情弹框，避免 Modal.destroyAll 误关正在确认的删除/立即执行弹框。
function closeTaskDetailModal() {
  const currentHandle = taskDetailModalHandle;
  taskDetailModalHandle = null;
  taskDetailModalIdentity = '';
  taskDetailTarget.value = null;
  currentHandle?.destroy();
  syncTaskListAutoRefresh();
}

// stopTaskListAutoRefresh 停止任务运行态自动刷新。
function stopTaskListAutoRefresh() {
  if (taskListAutoRefreshTimer.value === null) {
    return;
  }
  window.clearInterval(taskListAutoRefreshTimer.value);
  taskListAutoRefreshTimer.value = null;
}

// resetTaskListSessionState 清理旧账号遗留的轮询、列表快照和任务详情。
function resetTaskListSessionState() {
  invalidateTaskDetailRequest();
  taskListRequestSeq.value += 1;
  taskRunHistoryRequestSeq.value += 1;
  failureHistoryRequestSeq.value += 1;
  taskListAutoRefreshing.value = false;
  exactTaskQueryLoading.value = false;
  taskRunHistoryLoading.value = false;
  taskRunHistoryLoadFailed.value = false;
  taskRunHistoryRows.value = [];
  taskRunHistoryNextCursor.value = '';
  taskRunHistoryHasMore.value = false;
  taskRunHistoryStartTime.value = '';
  taskRunHistoryEndTime.value = '';
  taskRunHistoryDetailID.value = 0;
  taskHistoryTaskID.value = '';
  taskHistoryTaskName.value = '';
  taskHistoryPeriodicName.value = '';
  failureHistoryTaskName.value = '';
  failureHistoryPeriodicName.value = '';
  taskHistoryTimeRange.value = undefined;
  failureHistoryLoading.value = false;
  failureHistoryLoadFailed.value = false;
  failureRerunCheckError.value = '';
  failureHistoryRows.value = [];
  failureHistoryNextCursor.value = '';
  failureHistoryHasMore.value = false;
  failureHistoryStartTime.value = '';
  failureHistoryEndTime.value = '';
  failureRerunTaskId.value = '';
  currentQueryState.value = '';
  currentTaskRows.value = [];
  currentTaskTotal.value = 0;
  currentStateTotals.value = {};
  taskListScanLimited.value = false;
  taskListAutoRefreshEnabled.value = false;
  closeTaskDetailModal();
  stopTaskListAutoRefresh();
}

// hasLiveTask 判断任务是否仍可能更新状态或执行指标。
function hasLiveTask(task?: null | TaskDetailTarget) {
  return TASK_LIVE_STATES.has(
    String(task?.state || '')
      .trim()
      .toLowerCase() as TaskApi.ListTaskItemsReq['state'],
  );
}

// shouldAutoRefreshTaskList 判断列表开关或运行中详情是否需要五秒轮询。
function shouldAutoRefreshTaskList() {
  if (hasLiveTask(taskDetailTarget.value)) {
    return true;
  }
  return taskListAutoRefreshEnabled.value;
}

// syncTaskListAutoRefresh 按列表开关和运行中详情状态启停五秒自动刷新。
function syncTaskListAutoRefresh() {
  if (!shouldAutoRefreshTaskList()) {
    stopTaskListAutoRefresh();
    return;
  }
  if (taskListAutoRefreshTimer.value !== null) {
    return;
  }
  taskListAutoRefreshTimer.value = window.setInterval(() => {
    void refreshTaskListSilently();
  }, TASK_LIST_AUTO_REFRESH_INTERVAL_MS);
}

// handleTaskListAutoRefreshChange 根据用户开关立即启停列表轮询，不主动发起额外查询。
function handleTaskListAutoRefreshChange() {
  syncTaskListAutoRefresh();
}

// refreshOpenTaskDetailSilently 刷新当前运行中任务详情，终态回执仍会最后更新一次。
async function refreshOpenTaskDetailSilently() {
  const target = taskDetailTarget.value;
  if (!target || !hasLiveTask(target)) {
    return;
  }
  const sourceSessionIdentity = currentSessionStateIdentity();
  const expectedIdentity = `${target.queue}\u0000${target.id}`;
  try {
    const responseData = await getTaskInfo(
      {
        queue: target.queue,
        taskId: target.id,
      },
      { silent: true },
    );
    if (
      taskDetailModalIdentity !== expectedIdentity ||
      sourceSessionIdentity !== currentSessionStateIdentity() ||
      !taskDetailModalHandle
    ) {
      return;
    }
    showTaskDetailModal(responseData);
  } catch {
    // 静默刷新失败时保留当前详情，下一轮继续尝试。
  }
}

// refreshTaskListSilently 按当前可见内容刷新列表或运行中详情，避免后台标签和重复请求增加服务端负载。
async function refreshTaskListSilently() {
  if (
    document.visibilityState !== 'visible' ||
    taskListAutoRefreshing.value ||
    initializing.value
  ) {
    return;
  }
  const sourceSessionIdentity = currentSessionStateIdentity();
  taskListAutoRefreshing.value = true;
  try {
    if (taskListAutoRefreshEnabled.value) {
      await gridApi.query();
    }
    if (hasLiveTask(taskDetailTarget.value)) {
      await refreshOpenTaskDetailSilently();
    }
    syncTaskListAutoRefresh();
  } finally {
    if (sourceSessionIdentity === currentSessionStateIdentity()) {
      taskListAutoRefreshing.value = false;
    }
  }
}

// openWorkflowStatus 按工作流和任务标识跳转，并保留任务列表来源上下文。
async function openWorkflowStatus(workflowId: string, taskId: string) {
  if (!workflowId) {
    message.warning($t('business.message.taskWorkflowIdMissing'));
    return;
  }
  await router.push({
    name: 'OpsWorkflowStatus',
    query: {
      source: $t('business.message.taskListTaskDetailSource', [taskId]),
      workflowId,
    },
  });
}

// openWorkflowStatusFromTask 按 Redis 任务头里的 workflowId 跳转到工作流状态页。
async function openWorkflowStatusFromTask(task: TaskApi.TaskItem) {
  await openWorkflowStatus(getTaskWorkflowId(task), task.id);
}

// openWorkflowStatusFromHistory 从 DB 终态记录打开对应工作流状态页。
async function openWorkflowStatusFromHistory(record: Record<string, any>) {
  const task = record as TaskApi.TaskRunHistoryItem;
  await openWorkflowStatus(String(task.workflowId || '').trim(), task.taskId);
}

function showTaskDetailModal(task: TaskApi.TaskItem) {
  const detailIdentity = `${task.queue}\u0000${task.id}`;
  const workflowId = getTaskWorkflowId(task);
  const workflowName = getTaskHeaderValue(task, 'x-app-workflow-name');
  const workflowNode = getTaskHeaderValue(task, 'x-app-workflow-node');
  const workflowSource = getTaskHeaderValue(task, 'x-app-task-source');
  const operationGuide = buildTaskOperationGuide(task);
  const executionTrace = getTaskExecutionTrace(task);
  const primaryWorkflowId = workflowId;
  const summaryRows = [
    [$t('business.message.taskId'), task.id || '-', 'primary', true],
    [$t('business.message.taskName'), task.taskName || '-', 'primary'],
    [$t('business.message.taskType'), task.taskType || '-', 'default'],
    [$t('business.message.taskGroup'), task.group || '-', 'default'],
    [
      $t('business.message.retryProgress'),
      `${task.retried || 0} / ${task.maxRetry || 0}`,
      task.retried > 0 ? 'warning' : 'default',
    ],
    [
      $t('business.message.timeoutSeconds'),
      String(task.timeoutSec || 0),
      'default',
    ],
    [$t('business.message.startedAt'), task.startedAt || '-', 'default'],
    [
      $t('business.message.executionDuration'),
      formatTaskDurationMs(task.durationMs),
      'success',
    ],
    [
      $t('business.message.nextProcessAt'),
      task.nextProcessAt || '-',
      task.nextProcessAt ? 'info' : 'default',
    ],
    [
      $t('business.message.lastFailedAt'),
      task.lastFailedAt || '-',
      task.lastFailedAt ? 'danger' : 'default',
    ],
    [$t('business.message.completedAt'), task.completedAt || '-', 'success'],
    [
      $t('business.message.orphanedTask'),
      task.isOrphaned ? $t('business.message.yes') : $t('business.message.no'),
      task.isOrphaned ? 'danger' : 'default',
    ],
  ];
  const workflowSummaryRows = primaryWorkflowId
    ? [
        [
          $t('business.message.workflowInstanceId'),
          primaryWorkflowId,
          'primary',
          true,
        ],
        [$t('business.message.workflowName'), workflowName || '-', 'primary'],
        [$t('business.message.workflowNode'), workflowNode || '-', 'info'],
        [
          $t('business.message.triggerSource'),
          workflowSource || '-',
          'success',
        ],
      ]
    : [];
  let nextModalHandle: null | TaskDetailModalHandle = null;
  const modalConfig = {
    afterClose: () => {
      if (taskDetailModalHandle !== nextModalHandle) {
        return;
      }
      taskDetailModalHandle = null;
      taskDetailModalIdentity = '';
      taskDetailTarget.value = null;
      syncTaskListAutoRefresh();
    },
    closable: true,
    footer: null,
    icon: null,
    keyboard: true,
    maskClosable: true,
    onCancel: invalidateTaskDetailRequest,
    title: $t('business.message.taskDetailTitle', [task.id]),
    width: 980,
    content: h('div', { class: 'space-y-4' }, [
      h(
        'section',
        {
          class:
            'rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/70 dark:bg-slate-900/60',
        },
        [
          h(
            'div',
            { class: 'flex flex-wrap items-start justify-between gap-3' },
            [
              h('div', { class: 'min-w-0' }, [
                h(
                  Tooltip,
                  buildOverflowTooltipProps(task.taskName || task.id || '-'),
                  {
                    default: () =>
                      h(
                        'div',
                        {
                          class:
                            'truncate text-base font-semibold text-slate-900 dark:text-slate-100',
                        },
                        task.taskName || task.id || '-',
                      ),
                  },
                ),
                h(
                  'div',
                  {
                    class:
                      'mt-1 truncate font-mono text-xs text-slate-500 dark:text-slate-400',
                  },
                  task.id || '-',
                ),
              ]),
              h(Space, { size: 8, wrap: true }, () => [
                h(Tag, { color: taskStateTagColor(task.state) }, () =>
                  $t('business.message.taskStateTag', [task.state || '-']),
                ),
                h(Tag, { color: 'processing' }, () =>
                  $t('business.message.taskQueueTag', [task.queue || '-']),
                ),
                workflowSource
                  ? h(Tag, { color: 'cyan' }, () => workflowSource)
                  : null,
              ]),
            ],
          ),
          h(
            'div',
            { class: 'mt-4 grid grid-cols-1 gap-3 md:grid-cols-3' },
            visibleTaskDetailRows([
              [
                $t('business.message.taskStatus'),
                task.state || '-',
                task.state === 'completed' ? 'success' : 'primary',
              ],
              [
                $t('business.message.executionDuration'),
                formatTaskDurationMs(task.durationMs),
                'success',
              ],
              [
                $t('business.message.nextProcessAt'),
                task.nextProcessAt || '-',
                task.nextProcessAt ? 'info' : 'default',
              ],
            ]).map((row) => renderTaskDetailField(row)),
          ),
        ],
      ),
      h('section', { class: 'grid gap-3' }, [
        renderTaskDetailGuideAlert(operationGuide, task.lastErr),
        h('div', { class: 'flex flex-wrap items-center gap-2 pt-1' }, [
          h(
            Button,
            {
              size: 'small',
              onClick: () =>
                copyTextToClipboard(
                  task.id || '',
                  $t('business.message.taskIdCopied'),
                  $t('business.message.noTaskIdToCopy'),
                ),
            },
            () => $t('business.message.copyTaskId'),
          ),
          primaryWorkflowId
            ? h(
                Button,
                {
                  size: 'small',
                  onClick: () =>
                    copyTextToClipboard(
                      String(primaryWorkflowId || ''),
                      $t('business.message.workflowIdCopied'),
                      $t('business.message.noWorkflowIdToCopy'),
                    ),
                },
                () => $t('business.message.copyWorkflowId'),
              )
            : null,
          primaryWorkflowId
            ? h(
                Button,
                {
                  size: 'small',
                  onClick: async () => {
                    searchWorkflowId.value = String(primaryWorkflowId || '');
                    await handleSearch();
                  },
                },
                () => $t('business.message.filterSameWorkflowTasks'),
              )
            : null,
          workflowId
            ? h(
                Button,
                {
                  size: 'small',
                  type: 'primary',
                  onClick: async () => {
                    closeTaskDetailModal();
                    await openWorkflowStatusFromTask(task);
                  },
                },
                () => $t('business.message.viewWorkflowStatus'),
              )
            : null,
          canRunTask(task)
            ? h(
                Button,
                {
                  size: 'small',
                  onClick: () => {
                    closeTaskDetailModal();
                    handleRunTask(task);
                  },
                },
                () => $t('business.message.runThisTaskNow'),
              )
            : null,
          canDeleteTask(task)
            ? h(
                Button,
                {
                  danger: true,
                  size: 'small',
                  onClick: () => {
                    closeTaskDetailModal();
                    handleDeleteTask(task);
                  },
                },
                () => $t('business.message.deleteThisTask'),
              )
            : null,
        ]),
      ]),
      workflowSummaryRows.length > 0
        ? renderTaskDetailSection(
            $t('business.message.linkedWorkflow'),
            workflowSummaryRows,
            'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4',
          )
        : null,
      renderTaskDetailSection(
        $t('business.message.taskDetailBasicInfo'),
        summaryRows,
      ),
      renderTaskExecutionTraceSection(executionTrace),
      h('div', { class: 'space-y-4' }, [
        h('div', {}, [
          h(
            'div',
            { class: 'mb-2 text-sm font-semibold' },
            $t('business.message.taskHeaders'),
          ),
          h(JsonDetailViewer, {
            copyLabel: $t('business.message.copyHeaders'),
            searchPlaceholder: $t('business.message.jsonDataSearchPlaceholder'),
            value: task.headers || {},
            onCopy: () =>
              copyTextToClipboard(
                safePrettyJson(task.headers || {}),
                $t('business.message.taskHeadersCopied'),
                $t('business.message.noTaskHeadersToCopy'),
              ),
          }),
        ]),
        h('div', {}, [
          h(
            'div',
            { class: 'mb-2 text-sm font-semibold' },
            $t('business.message.taskPayload'),
          ),
          h(JsonDetailViewer, {
            copyLabel: $t('business.message.copyPayload'),
            searchPlaceholder: $t('business.message.jsonDataSearchPlaceholder'),
            value: task.payload || {},
            onCopy: () =>
              copyTextToClipboard(
                safePrettyJson(task.payload || {}),
                $t('business.message.taskPayloadCopied'),
                $t('business.message.noTaskPayloadToCopy'),
              ),
          }),
        ]),
        h('div', {}, [
          h(
            'div',
            { class: 'mb-2 text-sm font-semibold' },
            $t('business.message.taskResult'),
          ),
          h(JsonDetailViewer, {
            copyLabel: $t('business.message.copyResult'),
            searchPlaceholder: $t('business.message.jsonDataSearchPlaceholder'),
            value: formatTaskResultText(task),
            onCopy: () =>
              copyTextToClipboard(
                formatTaskResultText(task),
                $t('business.message.taskResultCopied'),
                $t('business.message.noTaskResultToCopy'),
              ),
          }),
        ]),
      ]),
    ]),
  };
  if (taskDetailModalHandle && taskDetailModalIdentity === detailIdentity) {
    taskDetailTarget.value = {
      id: task.id,
      queue: task.queue,
      state: task.state,
    };
    taskDetailModalHandle.update({
      content: modalConfig.content,
      title: modalConfig.title,
    });
    syncTaskListAutoRefresh();
    return;
  }
  closeTaskDetailModal();
  nextModalHandle = Modal.info(modalConfig);
  taskDetailModalHandle = nextModalHandle;
  taskDetailModalIdentity = detailIdentity;
  taskDetailTarget.value = {
    id: task.id,
    queue: task.queue,
    state: task.state,
  };
  syncTaskListAutoRefresh();
}

async function queryTaskDetail(
  input:
    | Pick<TaskApi.TaskItem, 'id' | 'queue'>
    | { queue: string; taskId: string },
  options: { silent?: boolean } = {},
) {
  const requestSeq = taskDetailRequestSeq.value + 1;
  taskDetailRequestSeq.value = requestSeq;
  const sourceSessionIdentity = currentSessionStateIdentity();
  const requestPayload = buildTaskDetailPayload(input);
  const responseData = await getTaskInfo(requestPayload, options);
  if (
    requestSeq !== taskDetailRequestSeq.value ||
    sourceSessionIdentity !== currentSessionStateIdentity()
  ) {
    return undefined;
  }
  showTaskDetailModal(responseData);
  return responseData;
}

// queryExactTaskFromFilter 使用队列和完整任务 ID 直接读取详情，避免高频任务挤占模糊扫描窗口。
async function queryExactTaskFromFilter() {
  const taskId = searchTaskId.value.trim();
  if (!isExactTaskID(taskId)) {
    return false;
  }
  const queue = searchQueue.value.trim();
  if (!queue) {
    message.warning($t('business.message.taskIdExactQueueRequired'));
    return true;
  }
  if (exactTaskQueryLoading.value) {
    return true;
  }
  const sourceSessionIdentity = currentSessionStateIdentity();
  exactTaskQueryLoading.value = true;
  try {
    try {
      await queryTaskDetail({ queue, taskId }, { silent: true });
    } catch (error) {
      if (await showTaskRunHistoryDetailByTask({ id: taskId, queue })) {
        return true;
      }
      throw error;
    }
  } finally {
    if (sourceSessionIdentity === currentSessionStateIdentity()) {
      exactTaskQueryLoading.value = false;
    }
  }
  return true;
}

async function tryAutoOpenTaskDetail() {
  const queue = searchQueue.value.trim();
  const taskId = normalizeRouteQueryValue(route.query.taskId);
  const historyId = Number(normalizeRouteQueryValue(route.query.historyId));
  if (routeTaskDetailConsumed.value) {
    return;
  }
  if (Number.isSafeInteger(historyId) && historyId > 0) {
    const historySignature = `history:${historyId}`;
    if (autoOpenedTaskSignature.value === historySignature) {
      return;
    }
    autoOpenedTaskSignature.value = historySignature;
    try {
      showTaskRunHistoryDetail(await getTaskRunHistory(historyId));
      routeTaskDetailConsumed.value = true;
    } catch {
      if (autoOpenedTaskSignature.value === historySignature) {
        autoOpenedTaskSignature.value = '';
      }
    }
    return;
  }
  if (!queue || !taskId) {
    return;
  }
  const currentSignature = [
    queue,
    taskId,
    searchState.value,
    searchGroup.value,
    searchTaskId.value.trim(),
    searchTaskName.value.trim(),
    searchWorkflowId.value,
    ...Object.values(buildTaskTimeRangeParams()),
  ].join('|');
  if (autoOpenedTaskSignature.value === currentSignature) {
    return;
  }
  autoOpenedTaskSignature.value = currentSignature;
  try {
    const responseData = await queryTaskDetail(
      { queue, taskId },
      { silent: true },
    );
    if (!responseData) {
      if (autoOpenedTaskSignature.value === currentSignature) {
        autoOpenedTaskSignature.value = '';
      }
      return;
    }
    routeTaskDetailConsumed.value = true;
  } catch {
    if (
      await showTaskRunHistoryDetailByTask({
        id: taskId,
        queue,
      })
    ) {
      routeTaskDetailConsumed.value = true;
      return;
    }
    if (autoOpenedTaskSignature.value === currentSignature) {
      autoOpenedTaskSignature.value = '';
    }
  }
}

function applyRouteQueryToFilters() {
  const routeQueue = normalizeRouteQueryValue(route.query.queue);
  const routeState = normalizeRouteQueryValue(
    route.query.state,
  ) as TaskStateFilterValue;
  const routeGroup = normalizeRouteQueryValue(route.query.group);
  // searchTaskId 是列表筛选参数；taskId 继续保留给任务详情深链使用。
  const routeSearchTaskId = normalizeRouteQueryValue(route.query.searchTaskId);
  // routeTaskName 允许外部页面把周期任务名带入任务列表，直接定位对应执行记录。
  const routeTaskName = normalizeRouteQueryValue(route.query.taskName);
  const routeWorkflowId = normalizeRouteQueryValue(route.query.workflowId);
  const routeNode = normalizeRouteQueryValue(route.query.workflowNode);
  searchQueue.value = routeQueue;
  searchState.value = taskStateOptions.value.some(
    (item) => item.value === routeState,
  )
    ? routeState
    : '';
  searchGroup.value = routeGroup;
  searchTaskId.value = routeSearchTaskId;
  searchTaskName.value = routeTaskName;
  searchWorkflowId.value = routeWorkflowId;
  searchTimeRange.value = normalizeRouteTimeRange();
  routeWorkflowNode.value = routeNode;
  routeSource.value = normalizeRouteQueryValue(route.query.source);
  routeTaskDetailConsumed.value = false;
}

function onActionClick(e: TableActionParams<TaskApi.TaskItem>) {
  switch (e.code) {
    case 'delete': {
      handleDeleteTask(e.row);
      break;
    }
    case 'detail': {
      void handleQueryTaskDetail(e.row);
      break;
    }
    case 'runNow': {
      handleRunTask(e.row);
      break;
    }
    case 'workflowStatus': {
      void openWorkflowStatusFromTask(e.row);
      break;
    }
  }
}

async function handleQueryTaskDetail(row: TaskApi.TaskItem) {
  const isTerminal = ['archived', 'completed'].includes(
    String(row.state || ''),
  );
  if (!isTerminal) {
    await queryTaskDetail(row);
    return;
  }
  try {
    await queryTaskDetail(row, { silent: true });
    return;
  } catch {
    // Redis 成功记录可能在用户点击前过期，继续读取短期 DB 终态详情。
  }
  if (await showTaskRunHistoryDetailByTask(row)) {
    return;
  }
  message.warning($t('business.message.taskHistoryDetailExpired'));
}

function canRunTask(row: TaskApi.TaskItem) {
  return ['archived', 'retry', 'scheduled'].includes(String(row.state || ''));
}

function canDeleteTask(row: TaskApi.TaskItem) {
  return ['archived', 'pending', 'retry', 'scheduled'].includes(
    String(row.state || ''),
  );
}

function handleRunTask(row: TaskApi.TaskItem) {
  if (!canRunTask(row)) {
    message.warning($t('business.message.taskRunNowStateLimited'));
    return;
  }
  Modal.confirm({
    title: $t('business.message.confirmRunTaskNow'),
    content: $t('business.message.confirmRunTaskNowContent', [row.id]),
    async onOk() {
      await runTaskNow({
        queue: row.queue,
        taskId: row.id,
      });
      message.success($t('business.message.taskRunNowSucceeded', [row.id]));
      await handleSearch();
    },
  });
}

// handleRunFailure 仅对仍存在 Redis archived 任务的失败历史开放补偿执行。
function handleRunFailure(record: Record<string, any>) {
  const row = record as TaskApi.TaskFailureItem;
  if (!row.rerunnable) {
    message.warning($t('business.message.failureHistoryRerunExpired'));
    return;
  }
  Modal.confirm({
    title: $t('business.message.confirmRunTaskNow'),
    content: $t('business.message.confirmRunTaskNowContent', [row.taskId]),
    async onOk() {
      failureRerunTaskId.value = row.taskId;
      try {
        await runTaskNow({ queue: row.queue, taskId: row.taskId });
        message.success(
          $t('business.message.taskRunNowSucceeded', [row.taskId]),
        );
        await handleSearch();
      } finally {
        failureRerunTaskId.value = '';
      }
    },
  });
}

// showTaskRunHistoryDetail 展示任务终态摘要和有界处理明细。
function showTaskRunHistoryDetail(task: TaskApi.TaskRunHistoryItem) {
  const workflowRows = task.workflowId
    ? [
        [$t('business.message.workflowId'), task.workflowId, 'primary', true],
        [
          $t('business.message.workflowName'),
          task.workflowName || '-',
          'default',
        ],
        [
          $t('business.message.workflowNode'),
          task.workflowNode || '-',
          'default',
        ],
        [
          $t('business.message.shardNo'),
          task.shardTotal > 0 ? `${task.shardIndex}/${task.shardTotal}` : '-',
          'default',
        ],
      ]
    : [];
  const legacyTraceRows = [
    [$t('business.message.taskTraceTotalCount'), task.traceTotal, 'primary'],
    [$t('business.message.taskTraceReadCount'), task.traceRead, 'info'],
    [$t('business.message.taskTraceUpsertCount'), task.traceWrite, 'success'],
    [$t('business.message.taskTraceDeleteCount'), task.traceDelete, 'warning'],
    [
      $t('business.message.taskTraceErrorCount'),
      task.traceError,
      task.traceError > 0 ? 'danger' : 'default',
    ],
  ].filter((row) => Number(row[1] || 0) > 0);
  const detailSections = [
    renderTaskHistoryHero(
      task,
      task.status,
      task.workflowId
        ? () => void openWorkflowStatusFromHistory(task)
        : undefined,
    ),
    renderTaskHistorySnapshotGuide(),
    workflowRows.length > 0
      ? renderTaskDetailSection(
          $t('business.message.linkedWorkflow'),
          workflowRows,
          'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4',
        )
      : null,
    renderTaskDetailSection($t('business.message.taskDetailBasicInfo'), [
      [$t('business.message.taskType'), task.taskType || '-', 'default'],
      [$t('business.message.triggerSource'), task.source || '-', 'default'],
      [
        $t('business.message.periodicTaskName'),
        task.periodicName || '-',
        'default',
      ],
      [
        $t('business.message.retryProgress'),
        `${task.retried || 0} / ${task.maxRetry || 0}`,
        task.retried > 0 ? 'warning' : 'default',
      ],
      [
        $t('business.message.startedAt'),
        formatTaskQueryTime(task.startedAt),
        'default',
      ],
      [
        $t('business.message.finishedAt'),
        formatTaskQueryTime(task.finishedAt),
        'default',
      ],
      [$t('business.message.traceId'), task.traceId || '-', 'default', true],
      [
        $t('business.message.persistedAt'),
        task.persistedAt ? formatTaskQueryTime(task.persistedAt) : '-',
        'default',
      ],
    ]),
    hasTaskExecutionTrace(task.executionTrace) || legacyTraceRows.length === 0
      ? null
      : renderTaskDetailSection(
          $t('business.message.taskExecutionTrace'),
          legacyTraceRows,
        ),
    renderTaskFailureReasonSection(task.errorMessage),
    renderTaskExecutionTraceSection(task.executionTrace),
  ].filter(Boolean);
  Modal.info({
    closable: true,
    content: h('div', { class: 'space-y-3' }, detailSections),
    footer: null,
    icon: null,
    keyboard: true,
    maskClosable: true,
    title: $t('business.message.taskHistoryDetailTitle'),
    width: 960,
  });
}

// showTaskFailureDetail 展示最终失败摘要、完整错误和补偿边界。
function showTaskFailureDetail(record: Record<string, any>) {
  const task = record as TaskApi.TaskFailureItem;
  const workflowRows = task.workflowId
    ? [
        [$t('business.message.workflowId'), task.workflowId, 'primary', true],
        [
          $t('business.message.workflowName'),
          task.workflowName || '-',
          'default',
        ],
        [
          $t('business.message.workflowNode'),
          task.workflowNode || '-',
          'default',
        ],
      ]
    : [];
  const detailSections = [
    renderTaskHistoryHero(
      task,
      'failed',
      task.workflowId
        ? () => void openWorkflowStatusFromHistory(task)
        : undefined,
    ),
    renderTaskHistorySnapshotGuide(),
    workflowRows.length > 0
      ? renderTaskDetailSection(
          $t('business.message.linkedWorkflow'),
          workflowRows,
        )
      : null,
    renderTaskDetailSection($t('business.message.taskDetailBasicInfo'), [
      [$t('business.message.taskType'), task.taskType || '-', 'default'],
      [$t('business.message.triggerSource'), task.source || '-', 'default'],
      [
        $t('business.message.periodicTaskName'),
        task.periodicName || '-',
        'default',
      ],
      [
        $t('business.message.retryProgress'),
        `${task.retried || 0} / ${task.maxRetry || 0}`,
        task.retried > 0 ? 'warning' : 'default',
      ],
      [$t('business.message.traceId'), task.traceId || '-', 'default', true],
      [
        $t('business.message.rerunnable'),
        task.rerunnable
          ? $t('business.message.yes')
          : $t('business.message.no'),
        task.rerunnable ? 'success' : 'warning',
      ],
      [
        $t('business.message.rerunExpireAt'),
        task.rerunExpireAt ? formatTaskQueryTime(task.rerunExpireAt) : '-',
        task.rerunnable ? 'info' : 'default',
      ],
    ]),
    renderTaskFailureReasonSection(task.errorMessage),
  ].filter(Boolean);
  Modal.info({
    closable: true,
    content: h('div', { class: 'space-y-3' }, detailSections),
    footer: null,
    icon: null,
    keyboard: true,
    maskClosable: true,
    title: $t('business.message.taskFailureDetailTitle'),
    width: 960,
  });
}

// showTaskRunHistoryDetailByTask 在 Redis 终态过期后按等值条件读取 DB 历史详情。
async function showTaskRunHistoryDetailByTask(
  task: Partial<Pick<TaskApi.TaskItem, 'state'>> &
    Pick<TaskApi.TaskItem, 'id' | 'queue'>,
) {
  const requestSeq = taskDetailRequestSeq.value + 1;
  taskDetailRequestSeq.value = requestSeq;
  const sourceSessionIdentity = currentSessionStateIdentity();
  const requestIsCurrent = () =>
    requestSeq === taskDetailRequestSeq.value &&
    sourceSessionIdentity === currentSessionStateIdentity();
  let historyItem = taskRunHistoryRows.value.find(
    (item) => item.taskId === task.id && item.queue === task.queue,
  );
  if (!historyItem) {
    const end = new Date();
    let status: TaskApi.ListTaskRunsReq['status'];
    if (task.state === 'archived') {
      status = 'failed';
    } else if (task.state === 'completed') {
      status = 'success';
    }
    const result = await fetchTaskRuns({
      endTime: end.toISOString(),
      pageSize: 1,
      queue: task.queue,
      startTime: new Date(
        end.getTime() - TASK_RUN_HISTORY_DAYS * 86_400_000,
      ).toISOString(),
      status,
      taskId: task.id,
    });
    [historyItem] = result.items || [];
  }
  if (!requestIsCurrent() || !historyItem) {
    return false;
  }
  taskRunHistoryDetailID.value = historyItem.id;
  try {
    const detail = await getTaskRunHistory(historyItem.id);
    if (!requestIsCurrent()) {
      return false;
    }
    showTaskRunHistoryDetail(detail);
    return true;
  } finally {
    if (taskRunHistoryDetailID.value === historyItem.id) {
      taskRunHistoryDetailID.value = 0;
    }
  }
}

// handleTaskRunHistoryDetail 按主键读取单条快照，避免列表批量加载 JSON 明细。
async function handleTaskRunHistoryDetail(record: Record<string, any>) {
  const row = record as TaskApi.TaskRunHistoryItem;
  const requestSeq = taskDetailRequestSeq.value + 1;
  taskDetailRequestSeq.value = requestSeq;
  const sourceSessionIdentity = currentSessionStateIdentity();
  taskRunHistoryDetailID.value = row.id;
  try {
    const detail = await getTaskRunHistory(row.id);
    if (
      requestSeq !== taskDetailRequestSeq.value ||
      sourceSessionIdentity !== currentSessionStateIdentity()
    ) {
      return;
    }
    showTaskRunHistoryDetail(detail);
  } finally {
    if (taskRunHistoryDetailID.value === row.id) {
      taskRunHistoryDetailID.value = 0;
    }
  }
}

// loadActiveTaskHistory 只刷新当前可见的 DB 历史视图，避免无效双查询。
function loadActiveTaskHistory(options: { append?: boolean } = {}) {
  return historyView.value === 'runs'
    ? loadTaskRunHistory(options)
    : loadFailureHistory(options);
}

// handleHistoryViewChange 切换 DB 历史职责，并按当前筛选条件延迟查询。
async function handleHistoryViewChange(view: TaskHistoryView) {
  if (historyView.value === view) {
    return;
  }
  historyView.value = view;
  await loadActiveTaskHistory();
}

// showAllTerminalTaskHistory 切换到数据库全部终态并滚动到可视区域，避免把 Redis 空闲态误认为没有历史任务。
async function showAllTerminalTaskHistory() {
  historyView.value = 'runs';
  document
    .querySelector<HTMLElement>('#task-terminal-history')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await loadTaskRunHistory();
}

// handleTaskHistorySearch 仅刷新 DB 历史，不改变上方 Redis 实时任务筛选。
async function handleTaskHistorySearch() {
  await loadActiveTaskHistory();
}

// handleTaskHistoryReset 清空 DB 历史专用筛选并恢复当前历史视图。
async function handleTaskHistoryReset() {
  taskHistoryTaskID.value = '';
  taskHistoryTaskName.value = '';
  taskHistoryPeriodicName.value = '';
  failureHistoryTaskName.value = '';
  failureHistoryPeriodicName.value = '';
  taskHistoryTimeRange.value = undefined;
  await loadActiveTaskHistory();
}

function handleDeleteTask(row: TaskApi.TaskItem) {
  if (!canDeleteTask(row)) {
    message.warning($t('business.message.taskDeleteStateLimited'));
    return;
  }
  Modal.confirm({
    title: $t('business.message.confirmDeleteTask'),
    content: $t('business.message.confirmDeleteTaskContent', [row.id]),
    async onOk() {
      await deleteTask({
        queue: row.queue,
        taskId: row.id,
      });
      message.success($t('business.message.taskDeleteSucceeded', [row.id]));
      await handleSearch();
    },
  });
}

async function handleSearch(options: HandleSearchOptions = {}) {
  const { clearTaskDetailQuery = true, preferExactTask = false } = options;
  invalidateTaskDetailRequest();
  autoOpenedTaskSignature.value = '';
  if (clearTaskDetailQuery) {
    // Vben 会把 query 变化当成页签重新激活，因此页面内筛选只消费上下文。
    routeTaskDetailConsumed.value = true;
    routeSource.value = '';
    routeWorkflowNode.value = '';
  }
  if (preferExactTask && exactTaskSearch.value) {
    try {
      await queryExactTaskFromFilter();
    } catch {
      message.warning($t('business.message.taskHistoryDetailExpired'));
    }
    await loadActiveTaskHistory();
    return;
  }
  await Promise.all([gridApi.query(), loadActiveTaskHistory()]);
}

async function handleQuickStateFilter(state: TaskStateFilterValue) {
  searchState.value = state;
  if (state !== 'aggregating') {
    searchGroup.value = '';
  }
  await handleSearch();
}

async function handleCopyFailedTaskIds(tasks: TaskApi.TaskItem[]) {
  const taskIds = tasks
    .map((item) => String(item.id || '').trim())
    .filter(Boolean)
    .join('\n');
  await copyTextToClipboard(
    taskIds,
    $t('business.message.failedTaskIdsCopied'),
    $t('business.message.noFailedTaskIdsToCopy'),
  );
}

async function handleCopyFailedTaskQueuePairs(tasks: TaskApi.TaskItem[]) {
  const taskText = tasks
    .map(
      (item) =>
        `${String(item.queue || '').trim()} / ${String(item.id || '').trim()}`,
    )
    .filter((item) => item !== ' / ')
    .join('\n');
  await copyTextToClipboard(
    taskText,
    $t('business.message.failedTaskQueuePairsCopied'),
    $t('business.message.noFailedTaskQueuePairsToCopy'),
  );
}

async function runTasksInBatch(tasks: TaskApi.TaskItem[]) {
  const successIds: string[] = [];
  const failedItems: Array<{ error: string; id: string }> = [];
  for (const item of tasks) {
    try {
      await runTaskNow({
        queue: item.queue,
        taskId: item.id,
      });
      successIds.push(item.id);
    } catch (error) {
      failedItems.push({
        error: String(error),
        id: item.id,
      });
    }
  }
  return { failedItems, successIds };
}

async function deleteTasksInBatch(tasks: TaskApi.TaskItem[]) {
  const successIds: string[] = [];
  const failedItems: Array<{ error: string; id: string }> = [];
  for (const item of tasks) {
    try {
      await deleteTask({
        queue: item.queue,
        taskId: item.id,
      });
      successIds.push(item.id);
    } catch (error) {
      failedItems.push({
        error: String(error),
        id: item.id,
      });
    }
  }
  return { failedItems, successIds };
}

function showBatchResultModal(params: {
  failedItems: Array<{ error: string; id: string }>;
  operationLabel: string;
  successIds: string[];
}) {
  const { failedItems, operationLabel, successIds } = params;
  if (failedItems.length === 0) {
    message.success(
      $t('business.message.batchTaskOperationSucceeded', [
        operationLabel,
        successIds.length,
      ]),
    );
    return;
  }
  Modal.warning({
    content: h('div', { class: 'space-y-3' }, [
      h(Alert, {
        description: $t('business.message.batchTaskOperationPartialDesc', [
          successIds.length,
          failedItems.length,
        ]),
        message: $t('business.message.batchTaskOperationPartialTitle', [
          operationLabel,
        ]),
        showIcon: true,
        type: 'warning',
      }),
      h(
        'pre',
        {
          class: 'overflow-auto rounded bg-[#0f172a] p-4 text-sm text-white',
        },
        safePrettyJson(failedItems),
      ),
      h(Space, { size: 8, wrap: true }, () => [
        h(
          Button,
          {
            size: 'small',
            type: 'primary',
            onClick: () =>
              copyTextToClipboard(
                failedItems.map((item) => item.id).join('\n'),
                $t('business.message.failedTaskIdsCopied'),
                $t('business.message.noFailedTaskIdsToCopy'),
              ),
          },
          () => $t('business.message.copyFailedTaskId'),
        ),
      ]),
    ]),
    title: $t('business.message.batchTaskOperationResult', [operationLabel]),
    width: 860,
  });
}

function handleBatchRunCurrentPage() {
  const tasks = currentPageRunnableTasks.value;
  if (tasks.length === 0) {
    message.warning($t('business.message.noRunnableTasksOnPage'));
    return;
  }
  Modal.confirm({
    title: $t('business.message.confirmBatchRunCurrentPage'),
    content: $t('business.message.confirmBatchRunCurrentPageContent', [
      tasks.length,
    ]),
    async onOk() {
      const result = await runTasksInBatch(tasks);
      showBatchResultModal({
        failedItems: result.failedItems,
        operationLabel: $t('business.message.taskRunNow'),
        successIds: result.successIds,
      });
      await handleSearch();
    },
  });
}

function handleBatchDeleteCurrentPage() {
  const tasks = currentPageDeletableTasks.value;
  if (tasks.length === 0) {
    message.warning($t('business.message.noDeletableTasksOnPage'));
    return;
  }
  Modal.confirm({
    title: $t('business.message.confirmBatchDeleteCurrentPage'),
    content: $t('business.message.confirmBatchDeleteCurrentPageContent', [
      tasks.length,
    ]),
    async onOk() {
      const result = await deleteTasksInBatch(tasks);
      showBatchResultModal({
        failedItems: result.failedItems,
        operationLabel: $t('business.message.delete'),
        successIds: result.successIds,
      });
      await handleSearch();
    },
  });
}

async function handleReset() {
  searchQueue.value = '';
  searchState.value = '';
  searchGroup.value = '';
  searchTaskId.value = '';
  searchTaskName.value = '';
  searchWorkflowId.value = '';
  searchTimeRange.value = undefined;
  routeWorkflowNode.value = '';
  routeSource.value = '';
  currentQueryStartTime.value = '';
  currentQueryEndTime.value = '';
  currentTaskRows.value = [];
  currentTaskTotal.value = 0;
  currentStateTotals.value = {};
  taskListScanLimited.value = false;
  autoOpenedTaskSignature.value = '';
  routeTaskDetailConsumed.value = true;
  await handleSearch();
}

onMounted(async () => {
  // 路由筛选必须在首个异步请求前完成，避免用户首次操作被迟到的初始化状态覆盖。
  applyRouteQueryToFilters();
  initializing.value = false;
  await Promise.all([
    loadQueueOptions(),
    handleSearch({ clearTaskDetailQuery: false }),
  ]);
});

onBeforeUnmount(() => {
  unregisterTaskListSessionCleanup();
  resetTaskListSessionState();
});

watch(
  () => route.fullPath,
  async () => {
    if (initializing.value) {
      return;
    }
    applyRouteQueryToFilters();
    await handleSearch({ clearTaskDetailQuery: false });
  },
);
</script>

<template>
  <Page :title="$t('business.message.taskList')">
    <div class="task-observation-stack">
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
              {{ $t('business.message.taskListConsoleEyebrow') }}
            </div>
            <div
              class="mt-2 text-2xl font-semibold tracking-tight text-foreground dark:text-white"
            >
              {{ $t('business.message.taskListConsoleTitle') }}
            </div>
            <div
              class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground dark:text-slate-300"
            >
              {{ $t('business.message.taskListConsoleDesc') }}
            </div>
          </div>
          <div
            class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2"
          >
            <div
              v-for="item in taskListOverviewCards"
              :key="item.label"
              class="min-w-0 rounded-xl border border-border bg-background/70 dark:border-white/10 dark:bg-white/5 px-3 py-3 backdrop-blur"
            >
              <div
                class="truncate text-[11px] uppercase tracking-[0.18em] text-muted-foreground dark:text-slate-400"
              >
                {{ item.label }}
              </div>
              <Tooltip
                v-bind="buildOverflowTooltipProps(String(item.value || '-'))"
              >
                <div
                  class="mt-1 truncate text-lg font-semibold text-foreground dark:text-white"
                  :title="String(item.value || '-')"
                >
                  {{ item.value }}
                </div>
              </Tooltip>
              <Tooltip
                v-bind="
                  buildOverflowTooltipProps(String(item.description || '-'))
                "
              >
                <div
                  class="mt-1 line-clamp-1 text-[11px] leading-4 text-muted-foreground dark:text-slate-400"
                  :title="String(item.description || '-')"
                >
                  {{ item.description }}
                </div>
              </Tooltip>
            </div>
          </div>
        </div>
      </section>

      <Alert
        v-if="routeSource"
        :message="$t('business.message.currentResultFromSource', [routeSource])"
        show-icon
        type="info"
      />
      <Alert
        v-if="workflowNodeLocateGuide"
        :description="workflowNodeLocateGuide.description"
        :message="workflowNodeLocateGuide.message"
        show-icon
        type="success"
      />
      <Alert
        v-if="aggregateMode"
        :message="$t('business.message.aggregateQueryView')"
        :description="
          $t('business.message.aggregateQueryViewDesc', [currentStateSummary])
        "
        show-icon
        type="warning"
      />
      <Card
        class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
      >
        <template #title>
          <span class="inline-flex items-center gap-1.5">
            <span>{{ $t('business.message.taskFilterQuickSwitch') }}</span>
            <Tooltip
              v-bind="
                buildOverflowTooltipProps(
                  $t('business.message.taskListOperationHint'),
                )
              "
            >
              <QuestionCircleOutlined
                class="cursor-help text-[var(--vben-text-color-secondary)]"
                tabindex="0"
                :aria-label="$t('business.message.taskFilterQuickSwitch')"
              />
            </Tooltip>
          </span>
        </template>
        <div class="min-w-0">
          <div
            class="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4"
          >
            <div class="min-w-0">
              <div class="mb-2 text-sm font-medium">
                {{ $t('business.message.workflowId') }}
              </div>
              <Input
                v-model:value="searchWorkflowId"
                id="task-item-workflow-id-filter"
                name="task-item-workflow-id-filter"
                autocomplete="off"
                allow-clear
                class="w-full"
                :placeholder="
                  $t('business.message.workflowIdFilterPlaceholder')
                "
              />
            </div>
            <div class="min-w-0">
              <div class="mb-2 text-sm font-medium">
                {{ $t('business.message.taskName') }}
              </div>
              <Input
                v-model:value="searchTaskName"
                id="task-item-name-filter"
                name="task-item-name-filter"
                autocomplete="off"
                allow-clear
                class="w-full"
                :placeholder="$t('business.message.taskNameFilterPlaceholder')"
              />
            </div>
            <div class="min-w-0">
              <div
                class="mb-2 inline-flex items-center gap-1.5 text-sm font-medium"
              >
                <span>{{ $t('business.message.taskId') }}</span>
                <Tooltip
                  v-bind="
                    buildOverflowTooltipProps(
                      $t('business.message.taskIdExactQueryHint'),
                    )
                  "
                >
                  <QuestionCircleOutlined
                    class="cursor-help text-[var(--vben-text-color-secondary)]"
                    tabindex="0"
                    :aria-label="$t('business.message.taskIdExactQueryHint')"
                  />
                </Tooltip>
              </div>
              <Input
                v-model:value="searchTaskId"
                id="task-item-id-filter"
                name="task-item-id-filter"
                autocomplete="off"
                allow-clear
                class="w-full"
                :placeholder="$t('business.message.taskIdFilterPlaceholder')"
                @press-enter="handleSearch({ preferExactTask: true })"
              />
            </div>
            <div class="min-w-0">
              <div class="mb-2 text-sm font-medium">
                {{ $t('business.message.aggregateGroup') }}
              </div>
              <Input
                v-model:value="searchGroup"
                id="task-item-group-filter"
                name="task-item-group-filter"
                autocomplete="off"
                allow-clear
                class="w-full"
                :placeholder="$t('business.message.aggregateGroupPlaceholder')"
              />
            </div>
            <div v-task-time-range-identifiers class="min-w-0">
              <div class="mb-2 text-sm font-medium">
                {{ $t('business.message.timeRange') }}
              </div>
              <RangePicker
                v-model:value="searchTimeRange"
                class="w-full"
                format="YYYY-MM-DD HH:mm:ss"
                :placeholder="[
                  $t('business.message.startTime'),
                  $t('business.message.endTime'),
                ]"
                show-time
              />
            </div>
            <div class="min-w-0">
              <div
                class="mb-2 inline-flex items-center gap-1.5 text-sm font-medium"
              >
                <span>{{ $t('business.message.queueName') }}</span>
                <Tooltip v-bind="buildOverflowTooltipProps(queueHintText)">
                  <QuestionCircleOutlined
                    class="cursor-help text-[var(--vben-text-color-secondary)]"
                    tabindex="0"
                    :aria-label="$t('business.message.queueNameGuide')"
                  />
                </Tooltip>
              </div>
              <Select
                v-model:value="searchQueue"
                allow-clear
                class="w-full"
                :options="queueOptions"
                :placeholder="$t('business.message.queueAllPlaceholder')"
                show-search
              />
            </div>
            <div class="min-w-0">
              <div
                class="mb-2 inline-flex items-center gap-1.5 text-sm font-medium"
              >
                <span>{{ $t('business.message.taskStatus') }}</span>
                <Tooltip
                  v-bind="
                    buildOverflowTooltipProps(
                      `${currentStateOperationGuide.message}\n${currentStateOperationGuide.description}`,
                    )
                  "
                >
                  <QuestionCircleOutlined
                    class="cursor-help text-[var(--vben-text-color-secondary)]"
                    tabindex="0"
                    :aria-label="currentStateOperationGuide.message"
                  />
                </Tooltip>
              </div>
              <Select
                v-model:value="searchState"
                class="w-full"
                :options="taskStateOptions"
                :placeholder="$t('business.message.taskStatusAllPlaceholder')"
              />
            </div>
            <div class="flex min-w-0 flex-wrap items-end justify-end gap-2">
              <VbenButton @click="handleReset">
                {{ $t('business.message.reset') }}
              </VbenButton>
              <VbenButton
                :loading="exactTaskQueryLoading"
                type="primary"
                @click="handleSearch({ preferExactTask: true })"
              >
                {{
                  exactTaskSearch
                    ? $t('business.message.taskIdExactQuery')
                    : $t('business.message.search')
                }}
              </VbenButton>
            </div>
          </div>
          <div class="mt-3">
            <div class="mb-2 text-sm font-medium">
              {{ $t('business.message.quickStatusSwitch') }}
            </div>
            <Space :size="8" wrap>
              <Tooltip
                v-for="item in quickStateActions"
                :key="item.label"
                v-bind="buildOverflowTooltipProps(item.description)"
              >
                <Button
                  :type="searchState === item.state ? 'primary' : 'default'"
                  @click="handleQuickStateFilter(item.state)"
                >
                  {{ item.label }}
                </Button>
              </Tooltip>
              <Tooltip
                v-bind="
                  buildOverflowTooltipProps(
                    $t('business.message.taskHistoryScopeDesc'),
                  )
                "
              >
                <Button @click="showAllTerminalTaskHistory">
                  {{ $t('business.message.taskHistoryRuns') }}
                </Button>
              </Tooltip>
            </Space>
          </div>
        </div>
        <div
          class="mt-4 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3"
        >
          <div
            v-for="item in currentTaskSummaryRows"
            :key="item.label"
            class="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-950/40"
          >
            <div class="text-[11px] text-[var(--vben-text-color-secondary)]">
              {{ item.label }}
            </div>
            <div class="mt-1 text-base font-semibold">
              {{ item.value }}
            </div>
          </div>
        </div>
      </Card>

      <div
        class="min-w-0 rounded-2xl border border-slate-200/70 bg-white/95 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3 dark:border-slate-700/60"
        >
          <div>
            <div class="flex items-center gap-2">
              <div
                class="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                {{ $t('business.message.taskList') }}
              </div>
              <Tooltip
                v-if="taskListScanLimited"
                :title="$t('business.message.taskListScanLimitedDesc')"
              >
                <Tag color="orange">
                  {{ $t('business.message.taskListScanLimited') }}
                </Tag>
              </Tooltip>
            </div>
            <div class="text-xs text-slate-500 dark:text-slate-300">
              {{ $t('business.message.taskListGridDesc') }}
            </div>
          </div>
          <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <Space v-if="quickSummaryActionButtons.length > 0" :size="8" wrap>
              <Button
                v-for="item in quickSummaryActionButtons"
                :key="item.label"
                size="small"
                @click="handleQuickStateFilter(item.state)"
              >
                {{ item.label }}（{{ item.count }}）
              </Button>
            </Space>
            <Space v-if="currentPageFailedTasks.length > 0" :size="8" wrap>
              <Button
                size="small"
                @click="handleCopyFailedTaskIds(currentPageFailedTasks)"
              >
                {{
                  $t('business.message.copyFailedTaskIds', [
                    currentPageFailedTasks.length,
                  ])
                }}
              </Button>
              <Button
                size="small"
                @click="handleCopyFailedTaskQueuePairs(currentPageFailedTasks)"
              >
                {{ $t('business.message.copyQueueTaskIds') }}
              </Button>
              <Button
                v-if="currentPageFailedRunnableTasks.length > 0"
                size="small"
                @click="handleCopyFailedTaskIds(currentPageFailedRunnableTasks)"
              >
                {{
                  $t('business.message.copyRunnableTaskIds', [
                    currentPageFailedRunnableTasks.length,
                  ])
                }}
              </Button>
            </Space>
            <Space v-if="canBatchRun || canBatchDelete" :size="8" wrap>
              <Button
                v-if="canBatchRun"
                v-access="
                  asActionPermission(OPS_ACTION_PERMISSION_CODES.TASK_RUN)
                "
                size="small"
                type="primary"
                @click="handleBatchRunCurrentPage"
              >
                {{
                  $t('business.message.batchRunNowCount', [
                    currentPageRunnableTasks.length,
                  ])
                }}
              </Button>
              <Button
                v-if="canBatchDelete"
                v-access="
                  asActionPermission(OPS_ACTION_PERMISSION_CODES.TASK_DELETE)
                "
                danger
                size="small"
                @click="handleBatchDeleteCurrentPage"
              >
                {{
                  $t('business.message.batchDeleteCount', [
                    currentPageDeletableTasks.length,
                  ])
                }}
              </Button>
            </Space>
          </div>
        </div>
        <Grid :table-title="$t('business.message.taskList')">
          <template #toolbar-tools>
            <Tooltip :title="$t('business.message.taskListAutoRefreshDesc')">
              <span
                class="mr-1 inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300"
              >
                <span>{{ $t('business.message.taskListAutoRefresh') }}</span>
                <Switch
                  v-model:checked="taskListAutoRefreshEnabled"
                  size="small"
                  :aria-label="$t('business.message.taskListAutoRefresh')"
                  @change="handleTaskListAutoRefreshChange"
                />
              </span>
            </Tooltip>
          </template>
        </Grid>
      </div>

      <Card
        id="task-terminal-history"
        class="task-observation-card min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
      >
        <template #title>
          <span class="inline-flex items-center gap-1.5">
            <span>{{ $t('business.message.taskHistory') }}</span>
            <Tag color="blue">DB</Tag>
            <Tooltip v-bind="buildOverflowTooltipProps(taskHistoryHelpText)">
              <QuestionCircleOutlined
                class="cursor-help text-[var(--vben-text-color-secondary)]"
                tabindex="0"
                :aria-label="$t('business.message.taskHistory')"
              />
            </Tooltip>
          </span>
        </template>
        <template #extra>
          <Space :size="8" wrap>
            <Button
              size="small"
              :type="historyView === 'runs' ? 'primary' : 'default'"
              @click="handleHistoryViewChange('runs')"
            >
              {{ $t('business.message.taskHistoryRuns') }}
            </Button>
            <Button
              size="small"
              :type="historyView === 'failures' ? 'primary' : 'default'"
              @click="handleHistoryViewChange('failures')"
            >
              {{ $t('business.message.taskHistoryFailures') }}
            </Button>
            <Button
              size="small"
              :loading="
                historyView === 'runs'
                  ? taskRunHistoryLoading
                  : failureHistoryLoading
              "
              @click="loadActiveTaskHistory()"
            >
              {{ $t('business.message.refresh') }}
            </Button>
          </Space>
        </template>
        <div
          class="task-history-filter-bar"
          :class="
            historyView === 'runs'
              ? 'task-history-filter-bar--task'
              : 'task-history-filter-bar--task-failure'
          "
        >
          <Input
            v-model:value="taskHistoryTaskID"
            allow-clear
            autocomplete="off"
            id="task-history-task-id"
            name="task-history-task-id"
            :placeholder="$t('business.message.taskHistoryTaskIdPlaceholder')"
            @press-enter="handleTaskHistorySearch"
          />
          <Input
            v-if="historyView === 'runs'"
            v-model:value="taskHistoryTaskName"
            allow-clear
            autocomplete="off"
            id="task-history-task-name"
            name="task-history-task-name"
            :placeholder="$t('business.message.taskHistoryTaskNamePlaceholder')"
            @press-enter="handleTaskHistorySearch"
          />
          <Input
            v-if="historyView === 'runs'"
            v-model:value="taskHistoryPeriodicName"
            allow-clear
            autocomplete="off"
            id="task-history-periodic-name"
            name="task-history-periodic-name"
            :placeholder="
              $t('business.message.taskHistoryPeriodicNamePlaceholder')
            "
            @press-enter="handleTaskHistorySearch"
          />
          <Input
            v-else
            v-model:value="failureHistoryTaskName"
            allow-clear
            autocomplete="off"
            id="task-history-failure-task-name"
            name="task-history-failure-task-name"
            :placeholder="
              $t('business.message.failureHistoryTaskNamePlaceholder')
            "
            @press-enter="handleTaskHistorySearch"
          />
          <Input
            v-if="historyView === 'failures'"
            v-model:value="failureHistoryPeriodicName"
            allow-clear
            autocomplete="off"
            id="task-history-failure-periodic-name"
            name="task-history-failure-periodic-name"
            :placeholder="
              $t('business.message.failureHistoryPeriodicNamePlaceholder')
            "
            @press-enter="handleTaskHistorySearch"
          />
          <div v-task-history-time-range-identifiers class="min-w-0">
            <RangePicker
              v-model:value="taskHistoryTimeRange"
              class="w-full"
              format="YYYY-MM-DD HH:mm:ss"
              :placeholder="[
                $t('business.message.startTime'),
                $t('business.message.endTime'),
              ]"
              show-time
            />
          </div>
          <div class="task-history-filter-actions">
            <Button
              type="primary"
              :loading="
                historyView === 'runs'
                  ? taskRunHistoryLoading
                  : failureHistoryLoading
              "
              @click="handleTaskHistorySearch"
            >
              {{ $t('business.message.search') }}
            </Button>
            <Button
              :disabled="
                historyView === 'runs'
                  ? taskRunHistoryLoading
                  : failureHistoryLoading
              "
              @click="handleTaskHistoryReset"
            >
              {{ $t('business.message.reset') }}
            </Button>
          </div>
        </div>
        <Alert
          v-if="historyView === 'runs' && taskRunHistoryLoadFailed"
          class="mb-3"
          show-icon
          type="warning"
          :message="$t('business.message.taskHistoryLoadFailed')"
        />
        <Alert
          v-else-if="historyView === 'failures' && failureHistoryLoadFailed"
          class="mb-3"
          show-icon
          type="warning"
          :message="$t('business.message.failureHistoryLoadFailed')"
        />
        <Alert
          v-else-if="historyView === 'failures' && failureRerunCheckError"
          class="mb-3"
          show-icon
          type="warning"
          :message="$t('business.message.failureRerunCheckFailed')"
          :description="failureRerunCheckError"
        />
        <Table
          v-if="historyView === 'runs'"
          class="task-observation-table"
          :columns="taskRunHistoryColumns"
          :data-source="taskRunHistoryRows"
          :loading="taskRunHistoryLoading"
          :locale="{ emptyText: $t('business.message.taskHistoryEmpty') }"
          :pagination="false"
          row-key="id"
          :scroll="{ x: 1920 }"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.dataIndex === 'taskId'">
              <CopyableTextCell
                :copied-message="$t('business.message.taskIdCopied')"
                :copy-label="$t('business.message.copyTaskId')"
                :empty-message="$t('business.message.noTaskIdToCopy')"
                :text="record.taskId"
              />
            </template>
            <template v-else-if="column.dataIndex === 'workflowId'">
              <WorkflowIdCell
                :text="record.workflowId"
                @open="openWorkflowStatusFromHistory(record)"
              />
            </template>
            <template
              v-else-if="
                ['taskName', 'periodicName'].includes(String(column.dataIndex))
              "
            >
              <CopyableTextCell
                :copied-message="
                  column.dataIndex === 'taskName'
                    ? $t('business.message.taskNameCopied')
                    : $t('business.message.periodicTaskNameCopied')
                "
                :copy-label="
                  column.dataIndex === 'taskName'
                    ? $t('business.message.copyTaskName')
                    : $t('business.message.copyPeriodicTaskName')
                "
                :empty-message="
                  column.dataIndex === 'taskName'
                    ? $t('business.message.noTaskNameToCopy')
                    : $t('business.message.noPeriodicTaskNameToCopy')
                "
                :text="
                  column.dataIndex === 'taskName'
                    ? record.taskName
                    : record.periodicName
                "
              />
            </template>
            <template v-else-if="column.dataIndex === 'taskType'">
              <Tooltip
                v-bind="
                  buildOverflowTooltipProps(
                    historyCellText(record, column.dataIndex),
                  )
                "
              >
                <span
                  class="block max-w-full cursor-help overflow-hidden text-ellipsis whitespace-nowrap"
                >
                  {{ historyCellText(record, column.dataIndex) }}
                </span>
              </Tooltip>
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag :color="record.status === 'success' ? 'success' : 'error'">
                {{
                  record.status === 'success'
                    ? $t('business.message.success')
                    : $t('business.message.failed')
                }}
              </Tag>
            </template>
            <template v-else-if="column.dataIndex === 'durationMs'">
              {{ formatTaskDurationMs(record.durationMs) }}
            </template>
            <template v-else-if="column.dataIndex === 'finishedAt'">
              {{ formatTaskQueryTime(record.finishedAt) }}
            </template>
            <template v-else-if="column.key === 'action'">
              <Button
                :loading="taskRunHistoryDetailID === record.id"
                size="small"
                type="link"
                @click="handleTaskRunHistoryDetail(record)"
              >
                {{ $t('business.message.detail') }}
              </Button>
            </template>
          </template>
        </Table>
        <Table
          v-else
          class="task-observation-table"
          :columns="failureHistoryColumns"
          :data-source="failureHistoryRows"
          :loading="failureHistoryLoading"
          :locale="{ emptyText: $t('business.message.failureHistoryEmpty') }"
          :pagination="false"
          row-key="id"
          :scroll="{ x: 1900 }"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.dataIndex === 'taskId'">
              <CopyableTextCell
                :copied-message="$t('business.message.taskIdCopied')"
                :copy-label="$t('business.message.copyTaskId')"
                :empty-message="$t('business.message.noTaskIdToCopy')"
                :text="record.taskId"
              />
            </template>
            <template
              v-else-if="
                ['taskName', 'periodicName'].includes(String(column.dataIndex))
              "
            >
              <CopyableTextCell
                :copied-message="
                  column.dataIndex === 'taskName'
                    ? $t('business.message.taskNameCopied')
                    : $t('business.message.periodicTaskNameCopied')
                "
                :copy-label="
                  column.dataIndex === 'taskName'
                    ? $t('business.message.copyTaskName')
                    : $t('business.message.copyPeriodicTaskName')
                "
                :empty-message="
                  column.dataIndex === 'taskName'
                    ? $t('business.message.noTaskNameToCopy')
                    : $t('business.message.noPeriodicTaskNameToCopy')
                "
                :text="
                  column.dataIndex === 'taskName'
                    ? record.taskName
                    : record.periodicName
                "
              />
            </template>
            <template v-else-if="column.dataIndex === 'taskType'">
              <Tooltip
                v-bind="
                  buildOverflowTooltipProps(
                    historyCellText(record, column.dataIndex),
                  )
                "
              >
                <span
                  class="block max-w-full cursor-help overflow-hidden text-ellipsis whitespace-nowrap"
                >
                  {{ historyCellText(record, column.dataIndex) }}
                </span>
              </Tooltip>
            </template>
            <template v-else-if="column.dataIndex === 'errorMessage'">
              <Tooltip
                v-bind="
                  buildOverflowTooltipProps(
                    historyCellText(record, column.dataIndex),
                  )
                "
              >
                <span
                  class="block max-w-full cursor-help overflow-hidden text-ellipsis whitespace-nowrap"
                >
                  {{ historyCellText(record, column.dataIndex) }}
                </span>
              </Tooltip>
            </template>
            <template v-else-if="column.key === 'action'">
              <Space :size="4">
                <Button
                  size="small"
                  type="link"
                  @click="showTaskFailureDetail(record)"
                >
                  {{ $t('business.message.detail') }}
                </Button>
                <Tooltip
                  :title="
                    record.rerunnable
                      ? $t('business.message.taskRunNow')
                      : $t('business.message.failureHistoryRerunExpired')
                  "
                >
                  <Button
                    v-access="
                      asActionPermission(OPS_ACTION_PERMISSION_CODES.TASK_RUN)
                    "
                    :disabled="!record.rerunnable"
                    :loading="failureRerunTaskId === record.taskId"
                    size="small"
                    type="link"
                    @click="handleRunFailure(record)"
                  >
                    {{ $t('business.message.taskRunNow') }}
                  </Button>
                </Tooltip>
              </Space>
            </template>
          </template>
        </Table>
        <div
          v-if="
            historyView === 'runs'
              ? taskRunHistoryHasMore
              : failureHistoryHasMore
          "
          class="mt-3 text-center"
        >
          <Button
            :loading="
              historyView === 'runs'
                ? taskRunHistoryLoading
                : failureHistoryLoading
            "
            size="small"
            @click="loadActiveTaskHistory({ append: true })"
          >
            {{ $t('business.message.loadMoreHistory') }}
          </Button>
        </div>
      </Card>
    </div>
  </Page>
</template>
