<script lang="ts" setup>
// ================= 类型与依赖引入 =================
import type { TaskApi } from '#/api/ops/task';

import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page, VbenButton } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  message,
  Modal,
  Space,
  Tooltip,
} from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  enqueueTask,
  fetchTaskQueues,
  fetchTaskRegistryTaskTypes,
  fetchTaskRegistryWorkflows,
  triggerTaskWorkflow,
} from '#/api/ops/task';
import { TASK_API_LIMITS } from '#/api/ops/task-types';
import {
  asActionPermission,
  OPS_ACTION_PERMISSION_CODES,
} from '#/constants/permission-codes';
import { $t } from '#/locales';

import JsonDetailViewer from '../../system/components/json-detail-viewer.vue';
import {
  buildSchedulerStatusLabel,
  buildSchedulerSyncStatusLabel,
  getTaskQueueDescription,
  normalizeOptionalNumber,
  parsePayloadText,
  safePrettyJson,
  splitTextToItems,
  utf8ByteLength,
} from '../shared';
import { useEnqueueTaskSchema, useTriggerWorkflowSchema } from './data';
import {
  buildTaskConsoleTime,
  clearTaskConsoleSchedule,
  fillTaskConsoleDelay,
  fillTaskConsoleFields,
  fillTaskConsoleProcessAt,
  taskConsoleDefaults,
} from './defaults';

// ================= 表单配置 =================
// 工作流触发表单。
const [TriggerWorkflowForm, triggerWorkflowFormApi] = useVbenForm({
  commonConfig: {
    colon: true,
    componentProps: { class: 'w-full' },
    labelClass: 'w-2/6',
  },
  layout: 'horizontal',
  schema: useTriggerWorkflowSchema(),
  showDefaultActions: false,
  wrapperClass: 'grid grid-cols-2 gap-x-6 gap-y-4',
});

// 通用任务投递表单。
const [EnqueueTaskForm, enqueueTaskFormApi] = useVbenForm({
  commonConfig: {
    colon: true,
    componentProps: { class: 'w-full' },
    labelClass: 'w-2/6',
  },
  layout: 'horizontal',
  schema: useEnqueueTaskSchema(),
  showDefaultActions: false,
  wrapperClass: 'grid grid-cols-2 gap-x-6 gap-y-4',
});

// ================= 页面状态 =================
// 统一的提交锁，避免重复点击。
const submitting = ref(false);
// router 用于在提交成功后跳转到任务列表页继续排障。
const router = useRouter();
// queueOptions 保存当前任务系统可见队列选项，供总控台表单复用。
const queueOptions = ref<Array<{ label: string; value: string }>>([]);
// taskTypeRegistryItems 保存后端返回的任务类型元信息。
const taskTypeRegistryItems = ref<TaskApi.TaskTypeRegistryItem[]>([]);
// taskTypeOptions 保存当前进程已注册任务类型，供投递任务选择。
const taskTypeOptions = ref<Array<{ label: string; value: string }>>([]);
// selectedTaskType 保存当前选择的任务类型，驱动示例和提示联动。
const selectedTaskType = ref('');
// workflowRegistryItems 保存后端返回的工作流元信息。
const workflowRegistryItems = ref<TaskApi.WorkflowRegistryItem[]>([]);
// workflowOptions 保存当前进程已注册工作流，供工作流触发选择。
const workflowOptions = ref<Array<{ label: string; value: string }>>([]);
// selectedWorkflowName 保存当前选择的工作流名称，驱动说明联动。
const selectedWorkflowName = ref('');
// 工作流触发结果文本。
const workflowTriggerResultText = ref('');
// 通用任务投递结果文本。
const enqueueTaskResultText = ref('');
// schedulerStatus 保存最近一次任务队列接口返回的调度器状态快照。
const schedulerStatus = ref<null | TaskApi.TaskSchedulerItem>(null);
// schedulerStatusText 保存调度器原始快照，便于排障时直接查看后端返回。
const schedulerStatusText = ref('');
// latestWorkflowTrigger 保存最近一次成功触发工作流的回执。
const latestWorkflowTrigger = ref<null | TaskApi.WorkflowTriggerResp>(null);
// latestEnqueueTask 保存最近一次成功投递任务的回执。
const latestEnqueueTask = ref<null | TaskApi.EnqueueTaskResp>(null);
// showWorkflowTriggerGuide 控制工作流触发详细说明展开。
const showWorkflowTriggerGuide = ref(false);
// showEnqueueTaskGuide 控制通用任务投递详细说明展开。
const showEnqueueTaskGuide = ref(false);
// showWorkflowTriggerRaw 控制工作流触发原始回执展开。
const showWorkflowTriggerRaw = ref(false);
// showEnqueueTaskRaw 控制任务投递原始回执展开。
const showEnqueueTaskRaw = ref(false);
// showSchedulerRaw 控制调度器原始回执展开。
const showSchedulerRaw = ref(false);

type FieldGuideRow = {
  description: string;
  label: string;
};

type OverflowTooltipProps = InstanceType<typeof Tooltip>['$props'];

type WorkflowDefaultOptions = {
  force?: boolean;
  previousWorkflowName?: string;
  silent?: boolean;
};

type TaskDefaultOptions = {
  force?: boolean;
  previousTaskType?: string;
  silent?: boolean;
};

// taskQueueHintText 用于在“展开说明”区域展示队列用途说明，降低配置猜测成本。
const taskQueueHintText = computed(() =>
  queueOptions.value
    .map((item) => `${item.value}: ${getTaskQueueDescription(item.value)}`)
    .join('\n'),
);

// triggerWorkflowFieldGuides 定义“手动触发工作流”的核心字段解释与填写建议。
const triggerWorkflowFieldGuides: FieldGuideRow[] = [
  {
    label: $t('business.message.guideTargetsLabel'),
    description: $t('business.message.guideTargetsDesc'),
  },
  {
    label: $t('business.message.guideWorkflowQueueLabel'),
    description: $t('business.message.guideWorkflowQueueDesc'),
  },
  {
    label: $t('business.message.guideShardTotalLabel'),
    description: $t('business.message.guideShardTotalDesc'),
  },
  {
    label: $t('business.message.guideGrayPercentLabel'),
    description: $t('business.message.guideGrayPercentDesc'),
  },
  {
    label: $t('business.message.guideUniqueLabel'),
    description: $t('business.message.guideUniqueDesc'),
  },
  {
    label: $t('business.message.guideRetryTimeoutLabel'),
    description: $t('business.message.guideRetryTimeoutDesc'),
  },
  {
    label: $t('business.message.guideProcessTimeLabel'),
    description: $t('business.message.guideProcessTimeDesc'),
  },
  {
    label: $t('business.message.guideDeadlineLabel'),
    description: $t('business.message.guideDeadlineDesc'),
  },
];

// enqueueTaskFieldGuides 定义“手动投递通用任务”的核心字段解释与填写建议。
const enqueueTaskFieldGuides: FieldGuideRow[] = [
  {
    label: $t('business.message.guideTaskTypeLabel'),
    description: $t('business.message.guideTaskTypeDesc'),
  },
  {
    label: $t('business.message.guideTaskPayloadLabel'),
    description: $t('business.message.guideTaskPayloadDesc'),
  },
  {
    label: $t('business.message.guideTaskQueueLabel'),
    description: $t('business.message.guideTaskQueueDesc'),
  },
  {
    label: $t('business.message.guideGroupLabel'),
    description: $t('business.message.guideGroupDesc'),
  },
  {
    label: $t('business.message.guideRetryTimeoutLabel'),
    description: $t('business.message.guideTaskRetryTimeoutDesc'),
  },
  {
    label: $t('business.message.guideProcessTimeLabel'),
    description: $t('business.message.guideTaskProcessTimeDesc'),
  },
  {
    label: $t('business.message.guideDeadlineLabel'),
    description: $t('business.message.guideTaskDeadlineDesc'),
  },
  {
    label: $t('business.message.guideUniqueWindowLabel'),
    description: $t('business.message.guideUniqueWindowDesc'),
  },
];

// taskConsoleOverviewCards 生成任务总控台顶部关键态势卡片。
const taskConsoleOverviewCards = computed(() => [
  {
    description: $t('business.message.visibleQueuesDesc'),
    label: $t('business.message.visibleQueues'),
    value: String(queueOptions.value.length),
  },
  {
    description: $t('business.message.registeredTaskTypesDesc'),
    label: $t('business.message.taskType'),
    value: String(taskTypeRegistryItems.value.length),
  },
  {
    description: $t('business.message.registeredWorkflowsDesc'),
    label: $t('business.message.workflow'),
    value: String(workflowRegistryItems.value.length),
  },
  {
    description:
      schedulerStatus.value?.lastMessage ||
      $t('business.message.schedulerStatusNotLoaded'),
    label: $t('business.message.schedulerStatus'),
    value: schedulerStatus.value
      ? buildSchedulerStatusLabel(schedulerStatus.value.lastStatus || '')
      : $t('business.message.waitLoad'),
  },
  {
    description: latestWorkflowTrigger.value
      ? $t('business.message.latestWorkflowName', [
          latestWorkflowTrigger.value.workflowName,
        ])
      : $t('business.message.noWorkflowTriggered'),
    label: $t('business.message.latestWorkflow'),
    value:
      latestWorkflowTrigger.value?.workflowId ||
      $t('business.message.waitTrigger'),
  },
  {
    description: latestEnqueueTask.value
      ? $t('business.message.latestTaskTypeName', [
          latestEnqueueTask.value.taskType,
        ])
      : $t('business.message.noManualTaskEnqueued'),
    label: $t('business.message.latestTask'),
    value:
      latestEnqueueTask.value?.taskId || $t('business.message.waitEnqueue'),
  },
]);

// schedulerSummaryRows 生成“调度器状态总览”区域所需字段。
const schedulerSummaryRows = computed(() => {
  const status = schedulerStatus.value;
  if (!status) {
    return [];
  }
  const lastEnqueueTaskText =
    [status.lastEnqueueTaskName, status.lastEnqueueTaskType]
      .filter((item) => String(item || '').trim())
      .join(' / ') || '-';
  return [
    {
      label: $t('business.message.currentStatus'),
      value: buildSchedulerStatusLabel(status.lastStatus || ''),
      description: $t('business.message.schedulerCurrentStatusDesc'),
    },
    {
      label: $t('business.message.configSwitch'),
      value: status.enabled
        ? $t('business.message.enabled')
        : $t('business.message.disabled'),
      description: $t('business.message.schedulerConfigSwitchDesc'),
    },
    {
      label: $t('business.message.leaderElection'),
      value: status.running
        ? $t('business.message.started')
        : $t('business.message.notStarted'),
      description: $t('business.message.leaderElectionDesc'),
    },
    {
      label: $t('business.message.leaderHeld'),
      value: status.hasLeader
        ? $t('business.message.currentProcessHasLeader')
        : $t('business.message.currentProcessNoLeader'),
      description: $t('business.message.leaderHeldDesc'),
    },
    {
      label: $t('business.message.validPeriodicTaskCount'),
      value: $t('business.message.countUnit', [status.periodicTaskCount || 0]),
      description: $t('business.message.validPeriodicTaskCountDesc'),
    },
    {
      label: $t('business.message.instanceId'),
      value: status.instanceId || '-',
      description: $t('business.message.instanceIdDesc'),
    },
    {
      label: $t('business.message.leaderLockKey'),
      value: status.leaderLockKey || '-',
      description: $t('business.message.leaderLockKeyDesc'),
    },
    {
      label: $t('business.message.latestSyncResult'),
      value: buildSchedulerSyncStatusLabel(status.lastSyncStatus || ''),
      description: $t('business.message.latestSyncResultDesc'),
    },
    {
      label: $t('business.message.latestSyncMessage'),
      value: status.lastSyncMessage || '-',
      description: $t('business.message.latestSyncMessageDesc'),
    },
    {
      label: $t('business.message.latestEnqueuedTask'),
      value: lastEnqueueTaskText,
      description: $t('business.message.latestEnqueuedTaskDesc'),
    },
    {
      label: $t('business.message.latestEnqueueFailure'),
      value: status.lastEnqueueErrorMessage || '-',
      description: $t('business.message.latestEnqueueFailureDesc'),
    },
    {
      label: $t('business.message.latestOverallMessage'),
      value: status.lastMessage || '-',
      description: $t('business.message.latestOverallMessageDesc'),
    },
  ];
});

// schedulerConfigRows 生成“调度器参数快照”区域所需字段。
const schedulerConfigRows = computed(() => {
  const status = schedulerStatus.value;
  if (!status) {
    return [];
  }
  return [
    {
      label: $t('business.message.leaderLease'),
      value: $t('business.message.secondsValue', [status.leaseTtlSeconds || 0]),
      description: $t('business.message.leaderLeaseDesc'),
    },
    {
      label: $t('business.message.renewInterval'),
      value: $t('business.message.secondsValue', [
        status.renewIntervalSeconds || 0,
      ]),
      description: $t('business.message.renewIntervalDesc'),
    },
    {
      label: $t('business.message.syncInterval'),
      value: $t('business.message.secondsValue', [
        status.syncIntervalSeconds || 0,
      ]),
      description: $t('business.message.syncIntervalDesc'),
    },
    {
      label: $t('business.message.heartbeatInterval'),
      value: $t('business.message.secondsValue', [
        status.heartbeatIntervalSeconds || 0,
      ]),
      description: $t('business.message.heartbeatIntervalDesc'),
    },
    {
      label: $t('business.message.schedulerMaxQueueBacklog'),
      value: String(status.maxQueueBacklog || 0),
      description: $t('business.message.schedulerMaxQueueBacklogDesc'),
    },
  ];
});

// schedulerTimeRows 生成“调度器时间轴”区域所需字段。
const schedulerTimeRows = computed(() => {
  const status = schedulerStatus.value;
  if (!status) {
    return [];
  }
  return [
    {
      label: $t('business.message.latestStartTime'),
      value: status.lastStartedAt || '-',
      description: $t('business.message.latestStartTimeDesc'),
    },
    {
      label: $t('business.message.latestHeartbeatTime'),
      value: status.lastHeartbeatAt || '-',
      description: $t('business.message.latestHeartbeatTimeDesc'),
    },
    {
      label: $t('business.message.latestAcquireLeader'),
      value: status.lastAcquireAt || '-',
      description: $t('business.message.latestAcquireLeaderDesc'),
    },
    {
      label: $t('business.message.latestReleaseLeader'),
      value: status.lastReleaseAt || '-',
      description: $t('business.message.latestReleaseLeaderDesc'),
    },
    {
      label: $t('business.message.latestSyncTime'),
      value: status.lastSyncAt || '-',
      description: $t('business.message.latestSyncTimeDesc'),
    },
    {
      label: $t('business.message.latestEnqueueTime'),
      value: status.lastEnqueueAt || '-',
      description: $t('business.message.latestEnqueueTimeDesc'),
    },
    {
      label: $t('business.message.latestEnqueueFailureTime'),
      value: status.lastEnqueueErrorAt || '-',
      description: $t('business.message.latestEnqueueFailureTimeDesc'),
    },
  ];
});

// schedulerOperationGuide 基于当前调度器状态生成排障建议，降低“看到了状态但不知道下一步”的成本。
const schedulerOperationGuide = computed(() => {
  const status = schedulerStatus.value;
  if (!status) {
    return {
      description: $t('business.message.schedulerNotLoadedDesc'),
      message: $t('business.message.schedulerNotLoaded'),
      type: 'info' as const,
    };
  }
  if (!status.enabled) {
    return {
      description: $t('business.message.schedulerDisabledGuideDesc'),
      message: $t('business.message.schedulerDisabled'),
      type: 'warning' as const,
    };
  }
  if (status.lastSyncStatus === 'failed' || status.lastEnqueueErrorMessage) {
    return {
      description: $t('business.message.schedulerAbnormalGuideDesc'),
      message: $t('business.message.schedulerAbnormal'),
      type: 'error' as const,
    };
  }
  if (!status.running) {
    return {
      description: $t('business.message.schedulerNotStartedGuideDesc'),
      message: $t('business.message.schedulerNotStarted'),
      type: 'error' as const,
    };
  }
  if (!status.hasLeader) {
    return {
      description: $t('business.message.schedulerNoLeaderGuideDesc'),
      message: $t('business.message.currentProcessNoLeader'),
      type: 'warning' as const,
    };
  }
  return {
    description: $t('business.message.schedulerHealthyGuideDesc'),
    message: $t('business.message.schedulerHealthy'),
    type: 'success' as const,
  };
});

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

// currentTaskTypeMeta 返回当前选中任务类型的元信息。
const currentTaskTypeMeta = computed(() =>
  taskTypeRegistryItems.value.find(
    (item) => item.taskType === selectedTaskType.value,
  ),
);

// currentWorkflowMeta 返回当前选中工作流的元信息。
const currentWorkflowMeta = computed(() =>
  workflowRegistryItems.value.find(
    (item) => item.name === selectedWorkflowName.value,
  ),
);

// findWorkflowMeta 按工作流名称查找注册元信息。
function findWorkflowMeta(workflowName?: string) {
  const normalizedName = String(workflowName || '').trim();
  if (!normalizedName) {
    return undefined;
  }
  return workflowRegistryItems.value.find(
    (item) => item.name === normalizedName,
  );
}

// findTaskTypeMeta 按任务类型查找注册元信息。
function findTaskTypeMeta(taskType?: string) {
  const normalizedTaskType = String(taskType || '').trim();
  if (!normalizedTaskType) {
    return undefined;
  }
  return taskTypeRegistryItems.value.find(
    (item) => item.taskType === normalizedTaskType,
  );
}

// normalizeFormText 统一归一化表单文本，便于判断是否仍是示例值。
function normalizeFormText(value: unknown) {
  return String(value || '').trim();
}

// isWorkflowTargetsExample 判断当前 targets 是否来自已注册工作流示例。
function isWorkflowTargetsExample(text: string) {
  const normalizedText = normalizeFormText(text);
  if (!normalizedText) {
    return false;
  }
  return workflowRegistryItems.value.some(
    (item) => normalizeFormText(item.targetsExample) === normalizedText,
  );
}

// isTaskPayloadExample 判断当前 payload 是否来自已注册任务示例。
function isTaskPayloadExample(text: string) {
  const normalizedText = normalizeFormText(text);
  if (!normalizedText) {
    return false;
  }
  if (
    normalizedText === normalizeFormText(taskConsoleDefaults.minimalPayloadText)
  ) {
    return true;
  }
  return taskTypeRegistryItems.value.some(
    (item) => normalizeFormText(item.payloadExample) === normalizedText,
  );
}

// buildManualUniqueKey 生成短周期防重复点击用的去重键。
function buildManualUniqueKey(kind: string, name: string, targetsText = '') {
  const targetKey = splitTextToItems(targetsText).join('|') || 'all';
  return `${kind}:${name}:${targetKey}`
    .replaceAll(/[^\w:|.-]+/g, '_')
    .slice(0, 160);
}

// isManualUniqueKey 判断当前去重键是否仍是总控台自动生成值。
function isManualUniqueKey(value: unknown) {
  return /^manual[-_a-z]*:/.test(normalizeFormText(value));
}

// rebuildTaskConsoleSchemas 按当前队列和注册清单重建表单 schema，统一维护联动逻辑。
function rebuildTaskConsoleSchemas() {
  triggerWorkflowFormApi.updateSchema(
    useTriggerWorkflowSchema(
      queueOptions.value,
      workflowOptions.value,
      handleWorkflowSelectionChange,
    ),
  );
  enqueueTaskFormApi.updateSchema(
    useEnqueueTaskSchema(
      queueOptions.value,
      taskTypeOptions.value,
      handleTaskTypeSelectionChange,
    ),
  );
}

// handleWorkflowSelectionChange 同步当前工作流选中值，并尽量自动套用默认参数。
function handleWorkflowSelectionChange(value?: string) {
  const previousWorkflowName = selectedWorkflowName.value;
  selectedWorkflowName.value = String(value || '').trim();
  void applySelectedWorkflowDefaults({
    previousWorkflowName,
    silent: true,
  });
}

// handleTaskTypeSelectionChange 同步当前任务类型选中值，供下方提示区联动展示。
function handleTaskTypeSelectionChange(value?: string) {
  const previousTaskType = selectedTaskType.value;
  selectedTaskType.value = String(value || '').trim();
  void applySelectedTaskDefaults({
    previousTaskType,
    silent: true,
  });
}

// loadQueueOptions 拉取当前任务系统可见队列，并更新总控台表单 schema。
async function loadQueueOptions() {
  try {
    const responseData = await fetchTaskQueues();
    schedulerStatus.value = responseData.scheduler || null;
    schedulerStatusText.value = safePrettyJson(responseData.scheduler || null);
    const options = (responseData.queues || [])
      .map((item) => String(item.name || '').trim())
      .filter(Boolean)
      .map((item) => ({
        label: item,
        value: item,
      }));
    if (options.length === 0) {
      return;
    }
    queueOptions.value = options;
    rebuildTaskConsoleSchemas();
  } catch {
    // 队列读取失败时保持默认 schema，避免总控台不可用。
  }
}

// loadTaskRegistryOptions 拉取已注册任务类型与工作流清单，降低人工填写成本。
async function loadTaskRegistryOptions() {
  try {
    const [taskTypeResp, workflowResp] = await Promise.all([
      fetchTaskRegistryTaskTypes(),
      fetchTaskRegistryWorkflows(),
    ]);
    taskTypeRegistryItems.value = taskTypeResp.items || [];
    taskTypeOptions.value = (taskTypeResp.items || [])
      .map((item) => String(item.taskType || '').trim())
      .filter(Boolean)
      .map((item) => ({
        label:
          taskTypeResp.items.find((row) => row.taskType === item)
            ?.manualRecommended === false
            ? $t('business.message.internalTaskLabel', [item])
            : item,
        value: item,
      }));
    workflowRegistryItems.value = workflowResp.items || [];
    workflowOptions.value = (workflowResp.items || [])
      .filter((item) => String(item.name || '').trim())
      .map((item) => ({
        label: item.description
          ? `${item.name} (${item.description})`
          : item.name,
        value: item.name,
      }));
    rebuildTaskConsoleSchemas();
  } catch {
    // 注册清单读取失败时保留文本输入能力，避免总控台失效。
  }
}

// fillTriggerWorkflowDelay 帮助用户快速填写“延迟执行秒”并清空绝对执行时间。
async function fillTriggerWorkflowDelay(seconds: number) {
  await fillTaskConsoleDelay(triggerWorkflowFormApi, seconds);
  message.success($t('business.message.workflowDelayFilled', [seconds]));
}

// fillEnqueueTaskDelay 帮助用户快速填写“延迟执行秒”并清空绝对执行时间。
async function fillEnqueueTaskDelay(seconds: number) {
  await fillTaskConsoleDelay(enqueueTaskFormApi, seconds);
  message.success($t('business.message.taskDelayFilled', [seconds]));
}

// fillTriggerWorkflowProcessAt 回填工作流绝对执行时间，并清空相对延迟。
async function fillTriggerWorkflowProcessAt(addSeconds = 0) {
  await fillTaskConsoleProcessAt(triggerWorkflowFormApi, addSeconds);
  message.success($t('business.message.workflowAbsoluteRunTimeFilled'));
}

// fillEnqueueTaskProcessAt 回填任务绝对执行时间，并清空相对延迟。
async function fillEnqueueTaskProcessAt(addSeconds = 0) {
  await fillTaskConsoleProcessAt(enqueueTaskFormApi, addSeconds);
  message.success($t('business.message.taskAbsoluteRunTimeFilled'));
}

// clearTriggerWorkflowSchedule 清空工作流触发时间相关字段。
async function clearTriggerWorkflowSchedule() {
  await clearTaskConsoleSchedule(triggerWorkflowFormApi);
}

// clearEnqueueTaskSchedule 清空任务投递时间相关字段。
async function clearEnqueueTaskSchedule() {
  await clearTaskConsoleSchedule(enqueueTaskFormApi);
}

// fillSampleTaskPayload 回填一个最小 JSON 示例，方便手动投递任务时起步。
async function fillSampleTaskPayload() {
  await enqueueTaskFormApi.setFieldValue(
    'payloadText',
    taskConsoleDefaults.minimalPayloadText,
    false,
  );
  message.success($t('business.message.minimalTaskPayloadExampleFilled'));
}

// fillTriggerWorkflowDefaultParams 回填工作流触发的保守默认参数。
async function fillTriggerWorkflowDefaultParams(
  workflowName: string,
  targetsText: string,
  values: Record<string, any>,
  force = false,
) {
  if (
    force ||
    !normalizeFormText(values.uniqueKey) ||
    isManualUniqueKey(values.uniqueKey)
  ) {
    await triggerWorkflowFormApi.setFieldValue(
      'uniqueKey',
      buildManualUniqueKey('manual-workflow', workflowName, targetsText),
      false,
    );
  }
  await fillTaskConsoleFields(
    triggerWorkflowFormApi,
    values,
    [
      { field: 'shardTotal', value: taskConsoleDefaults.shardTotal },
      { field: 'grayPercent', value: taskConsoleDefaults.grayPercent },
      {
        field: 'uniqueTTLSeconds',
        value: taskConsoleDefaults.uniqueTTLSeconds,
      },
      { field: 'retry', value: taskConsoleDefaults.retry },
      { field: 'timeoutSeconds', value: taskConsoleDefaults.timeoutSeconds },
      { field: 'processAt', value: () => buildTaskConsoleTime(0) },
      {
        field: 'processInSeconds',
        value: taskConsoleDefaults.processInSeconds,
      },
      {
        field: 'deadline',
        value: () => buildTaskConsoleTime(taskConsoleDefaults.deadlineSeconds),
      },
    ],
    force,
  );
}

// applySelectedWorkflowDefaults 自动套用当前工作流默认队列和目标示例。
async function applySelectedWorkflowDefaults(
  options: WorkflowDefaultOptions = {},
) {
  const workflowMeta = currentWorkflowMeta.value;
  if (!workflowMeta) {
    if (!options.silent) {
      message.warning($t('business.message.workflowDefaultsUnavailable'));
    }
    return;
  }
  const previousMeta = findWorkflowMeta(options.previousWorkflowName);
  const currentValues =
    await triggerWorkflowFormApi.getValues<Record<string, any>>();
  const currentQueue = normalizeFormText(currentValues.queue);
  const previousQueue = normalizeFormText(previousMeta?.defaultQueue);
  const nextQueue = normalizeFormText(workflowMeta.defaultQueue);
  if (
    nextQueue &&
    (options.force || !currentQueue || currentQueue === previousQueue)
  ) {
    await triggerWorkflowFormApi.setFieldValue('queue', nextQueue, false);
  }
  const currentTargets = normalizeFormText(currentValues.targetsText);
  const previousTargetsExample = normalizeFormText(
    previousMeta?.targetsExample,
  );
  const nextTargetsExample = normalizeFormText(workflowMeta.targetsExample);
  const shouldReplaceTargets =
    options.force ||
    !currentTargets ||
    currentTargets === previousTargetsExample ||
    isWorkflowTargetsExample(currentTargets);
  if (shouldReplaceTargets) {
    await triggerWorkflowFormApi.setFieldValue(
      'targetsText',
      nextTargetsExample,
      false,
    );
  }
  await fillTriggerWorkflowDefaultParams(
    workflowMeta.name,
    shouldReplaceTargets ? nextTargetsExample : currentTargets,
    currentValues,
    options.force,
  );
  if (!options.silent) {
    message.success($t('business.message.workflowDefaultsFilled'));
  }
}

// fillSelectedWorkflowQueue 按当前工作流元信息回填默认执行队列。
async function fillSelectedWorkflowQueue() {
  const workflowMeta = currentWorkflowMeta.value;
  if (!workflowMeta?.defaultQueue) {
    message.warning($t('business.message.workflowDefaultQueueUnavailable'));
    return;
  }
  await triggerWorkflowFormApi.setFieldValue(
    'queue',
    workflowMeta.defaultQueue,
    false,
  );
  message.success($t('business.message.workflowDefaultQueueFilled'));
}

// fillSelectedWorkflowTargetsExample 按当前工作流元信息回填执行目标示例。
async function fillSelectedWorkflowTargetsExample() {
  const workflowMeta = currentWorkflowMeta.value;
  if (!workflowMeta?.targetsExample) {
    message.warning($t('business.message.workflowTargetExampleUnavailable'));
    return;
  }
  await triggerWorkflowFormApi.setFieldValue(
    'targetsText',
    workflowMeta.targetsExample,
    false,
  );
  message.success($t('business.message.workflowTargetExampleFilled'));
}

// fillEnqueueTaskDefaultParams 回填通用任务投递的保守默认参数。
async function fillEnqueueTaskDefaultParams(
  values: Record<string, any>,
  force = false,
) {
  if (force) {
    await enqueueTaskFormApi.setFieldValue('group', '', false);
  }
  await fillTaskConsoleFields(
    enqueueTaskFormApi,
    values,
    [
      { field: 'queue', value: taskConsoleDefaults.queue },
      { field: 'retry', value: taskConsoleDefaults.retry },
      { field: 'timeoutSeconds', value: taskConsoleDefaults.timeoutSeconds },
      { field: 'processAt', value: () => buildTaskConsoleTime(0) },
      {
        field: 'processInSeconds',
        value: taskConsoleDefaults.processInSeconds,
      },
      {
        field: 'deadline',
        value: () => buildTaskConsoleTime(taskConsoleDefaults.deadlineSeconds),
      },
      {
        field: 'uniqueTTLSeconds',
        value: taskConsoleDefaults.uniqueTTLSeconds,
      },
    ],
    force,
  );
}

// applySelectedTaskDefaults 自动套用当前任务类型推荐 payload 和默认投递参数。
async function applySelectedTaskDefaults(options: TaskDefaultOptions = {}) {
  const taskMeta = currentTaskTypeMeta.value;
  if (!taskMeta) {
    if (!options.silent) {
      message.warning($t('business.message.taskDefaultsUnavailable'));
    }
    return;
  }
  const previousMeta = findTaskTypeMeta(options.previousTaskType);
  const currentValues =
    await enqueueTaskFormApi.getValues<Record<string, any>>();
  const currentPayload = normalizeFormText(currentValues.payloadText);
  const previousPayloadExample = normalizeFormText(
    previousMeta?.payloadExample,
  );
  const nextPayloadText =
    normalizeFormText(taskMeta.payloadExample) ||
    taskConsoleDefaults.minimalPayloadText;
  const shouldReplacePayload =
    options.force ||
    !currentPayload ||
    currentPayload === previousPayloadExample ||
    isTaskPayloadExample(currentPayload);
  if (shouldReplacePayload) {
    await enqueueTaskFormApi.setFieldValue(
      'payloadText',
      nextPayloadText,
      false,
    );
  }
  await fillEnqueueTaskDefaultParams(currentValues, options.force);
  if (!options.silent) {
    message.success($t('business.message.taskDefaultsFilled'));
  }
}

// fillSelectedTaskPayloadExample 按当前任务类型元信息回填推荐 JSON 示例。
async function fillSelectedTaskPayloadExample() {
  const exampleText = currentTaskTypeMeta.value?.payloadExample || '';
  if (!exampleText) {
    message.warning($t('business.message.taskPayloadExampleUnavailable'));
    return;
  }
  await enqueueTaskFormApi.setFieldValue('payloadText', exampleText, false);
  message.success($t('business.message.taskPayloadExampleFilled'));
}

// confirmInternalTaskEnqueue 对“不建议人工投递”的内部任务增加二次确认，避免误操作。
async function confirmInternalTaskEnqueue() {
  const taskMeta = currentTaskTypeMeta.value;
  if (!taskMeta || taskMeta.manualRecommended !== false) {
    return true;
  }
  return await new Promise<boolean>((resolve) => {
    Modal.confirm({
      cancelText: $t('business.message.cancel'),
      content: $t('business.message.confirmInternalTaskEnqueueDesc', [
        taskMeta.taskType,
      ]),
      okText: $t('business.message.enqueueAnyway'),
      title: $t('business.message.confirmInternalTaskEnqueue'),
      onCancel() {
        resolve(false);
      },
      onOk() {
        resolve(true);
      },
    });
  });
}

// ================= 业务方法 =================
// handleTriggerWorkflow 提交“手动触发工作流”表单。
async function handleTriggerWorkflow() {
  const { valid } = await triggerWorkflowFormApi.validate();
  if (!valid) {
    return;
  }
  submitting.value = true;
  try {
    const values =
      await triggerWorkflowFormApi.getValues<Record<string, any>>();
    const targets = splitTextToItems(values.targetsText || '');
    const targetsBytes = targets.reduce(
      (total, target) => total + utf8ByteLength(target),
      0,
    );
    if (targetsBytes > TASK_API_LIMITS.workflowTargetsBytes) {
      throw new Error(
        $t('business.message.workflowTargetsTooLarge', [
          String(TASK_API_LIMITS.workflowTargetsBytes),
        ]),
      );
    }
    const uniqueKey = String(values.uniqueKey || '').trim();
    if (utf8ByteLength(uniqueKey) > TASK_API_LIMITS.uniqueKeyBytes) {
      throw new Error(
        $t('business.message.uniqueKeyTooLarge', [
          String(TASK_API_LIMITS.uniqueKeyBytes),
        ]),
      );
    }
    const requestPayload: TaskApi.TriggerWorkflowReq = {
      name: values.name,
      targets,
      queue: values.queue || undefined,
      shardTotal: normalizeOptionalNumber(values.shardTotal),
      grayPercent: normalizeOptionalNumber(values.grayPercent),
      uniqueKey: uniqueKey || undefined,
      uniqueTTLSeconds: normalizeOptionalNumber(values.uniqueTTLSeconds),
      retry: normalizeOptionalNumber(values.retry),
      timeoutSeconds: normalizeOptionalNumber(values.timeoutSeconds),
      processAt: values.processAt || undefined,
      processInSeconds: normalizeOptionalNumber(values.processInSeconds),
      deadline: values.deadline || undefined,
    };
    const responseData = await triggerTaskWorkflow(requestPayload);
    latestWorkflowTrigger.value = responseData;
    workflowTriggerResultText.value = safePrettyJson(responseData);
    message.success($t('business.message.workflowTriggered'));
  } catch (error) {
    latestWorkflowTrigger.value = null;
    workflowTriggerResultText.value = $t('business.message.triggerFailed', [
      String(error),
    ]);
  } finally {
    submitting.value = false;
  }
}

// handleEnqueueTask 提交“手动投递通用任务”表单。
async function handleEnqueueTask() {
  const { valid } = await enqueueTaskFormApi.validate();
  if (!valid) {
    return;
  }
  const canContinue = await confirmInternalTaskEnqueue();
  if (!canContinue) {
    return;
  }
  submitting.value = true;
  try {
    const values = await enqueueTaskFormApi.getValues<Record<string, any>>();
    const payloadText = String(values.payloadText || '{}');
    if (utf8ByteLength(payloadText) > TASK_API_LIMITS.payloadBytes) {
      throw new Error(
        $t('business.message.taskPayloadTooLarge', [
          String(TASK_API_LIMITS.payloadBytes),
        ]),
      );
    }
    const requestPayload: TaskApi.EnqueueTaskReq = {
      taskType: values.taskType,
      payload: parsePayloadText(payloadText),
      queue: values.queue || undefined,
      group: values.group || undefined,
      retry: normalizeOptionalNumber(values.retry),
      timeoutSeconds: normalizeOptionalNumber(values.timeoutSeconds),
      processAt: values.processAt || undefined,
      processInSeconds: normalizeOptionalNumber(values.processInSeconds),
      deadline: values.deadline || undefined,
      uniqueTTLSeconds: normalizeOptionalNumber(values.uniqueTTLSeconds),
    };
    const responseData = await enqueueTask(requestPayload);
    latestEnqueueTask.value = responseData;
    enqueueTaskResultText.value = safePrettyJson(responseData);
    message.success($t('business.message.genericTaskEnqueued'));
  } catch (error) {
    latestEnqueueTask.value = null;
    enqueueTaskResultText.value = $t('business.message.enqueueFailed', [
      String(error),
    ]);
  } finally {
    submitting.value = false;
  }
}

// handleOpenWorkflowTask 跳转到任务列表页，并定位最近一次工作流入口任务。
async function handleOpenWorkflowTask() {
  const currentWorkflow = latestWorkflowTrigger.value;
  if (!currentWorkflow) {
    return;
  }
  await router.push({
    name: 'OpsTaskItem',
    query: {
      queue: currentWorkflow.queue,
      source: $t('business.message.taskConsoleWorkflowSource', [
        currentWorkflow.workflowName,
      ]),
      taskId: currentWorkflow.taskId,
    },
  });
}

// handleReuseWorkflowID 把最近一次 workflowId 带到独立工作流状态页。
async function handleReuseWorkflowID() {
  const currentWorkflow = latestWorkflowTrigger.value;
  if (!currentWorkflow) {
    return;
  }
  await router.push({
    name: 'OpsWorkflowStatus',
    query: {
      source: $t('business.message.taskConsoleWorkflowSource', [
        currentWorkflow.workflowName,
      ]),
      workflowId: currentWorkflow.workflowId,
    },
  });
}

// handleOpenEnqueueTask 跳转到任务列表页，并定位最近一次手动投递任务。
async function handleOpenEnqueueTask() {
  const currentTask = latestEnqueueTask.value;
  if (!currentTask) {
    return;
  }
  await router.push({
    name: 'OpsTaskItem',
    query: {
      queue: currentTask.queue,
      source: $t('business.message.taskConsoleManualEnqueueSource', [
        currentTask.taskType,
      ]),
      taskId: currentTask.taskId,
    },
  });
}

// handleOpenSchedulerLastTask 跳转到任务列表页，并按最近一次周期入队任务名称筛选执行记录。
async function handleOpenSchedulerLastTask() {
  const taskName = String(
    schedulerStatus.value?.lastEnqueueTaskName || '',
  ).trim();
  if (!taskName) {
    message.warning($t('business.message.schedulerNoLatestEnqueuedTaskName'));
    return;
  }
  await router.push({
    name: 'OpsTaskItem',
    query: {
      source: $t('business.message.taskConsoleLatestEnqueuedSource', [
        taskName,
      ]),
      taskName,
    },
  });
}

onMounted(() => {
  void (async () => {
    rebuildTaskConsoleSchemas();
    await Promise.all([loadQueueOptions(), loadTaskRegistryOptions()]);
  })();
});
</script>

<template>
  <Page :title="$t('business.message.taskConsole')">
    <div class="grid gap-2">
      <section
        class="overflow-hidden rounded-2xl border border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_34%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(15,23,42,0.9))] px-5 py-4 text-slate-100 shadow-[0_16px_44px_rgba(15,23,42,0.3)]"
      >
        <div
          class="grid gap-4 xl:grid-cols-[minmax(320px,0.78fr)_minmax(0,1.22fr)] xl:items-start"
        >
          <div>
            <div
              class="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80"
            >
              {{ $t('business.message.taskConsoleEyebrow') }}
            </div>
            <div class="mt-2 text-2xl font-semibold tracking-tight text-white">
              {{ $t('business.message.taskConsoleTitle') }}
            </div>
            <div class="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              {{ $t('business.message.taskConsoleDesc') }}
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
            <div
              v-for="item in taskConsoleOverviewCards"
              :key="item.label"
              class="rounded-xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur"
            >
              <div
                class="truncate text-[11px] uppercase tracking-[0.18em] text-slate-400"
              >
                {{ item.label }}
              </div>
              <div
                class="mt-1 truncate text-lg font-semibold text-white"
                :title="String(item.value || '-')"
              >
                {{ item.value }}
              </div>
              <div
                class="mt-1 line-clamp-1 text-[11px] leading-4 text-slate-400"
                :title="String(item.description || '-')"
              >
                {{ item.description }}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-2">
        <Card
          class="border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.schedulerStatus')"
        >
          <Alert
            :description="schedulerOperationGuide.description"
            :message="schedulerOperationGuide.message"
            show-icon
            :type="schedulerOperationGuide.type"
          />
          <Space class="mt-4" :size="8" wrap>
            <Button
              v-if="schedulerStatusText"
              size="small"
              @click="showSchedulerRaw = !showSchedulerRaw"
            >
              {{
                showSchedulerRaw
                  ? $t('business.message.closeRawReceipt')
                  : $t('business.message.viewRawReceipt')
              }}
            </Button>
            <Button
              v-if="schedulerStatus?.lastEnqueueTaskName"
              size="small"
              type="primary"
              @click="handleOpenSchedulerLastTask"
            >
              {{ $t('business.message.viewRecentEnqueuedTask') }}
            </Button>
          </Space>
          <JsonDetailViewer
            v-if="showSchedulerRaw && schedulerStatusText"
            class="mt-4"
            :search-placeholder="
              $t('business.message.jsonDataSearchPlaceholder')
            "
            :value="schedulerStatusText"
          />
          <div
            v-if="schedulerSummaryRows.length > 0"
            class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
          >
            <div
              v-for="item in [
                ...schedulerSummaryRows,
                ...schedulerConfigRows,
                ...schedulerTimeRows,
              ]"
              :key="item.label"
              class="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-950/40"
            >
              <div class="text-xs uppercase tracking-[0.16em] text-slate-400">
                {{ item.label }}
              </div>
              <Tooltip
                v-if="String(item.value || '').trim()"
                v-bind="buildOverflowTooltipProps(String(item.value))"
              >
                <div
                  class="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
                  :title="String(item.value)"
                >
                  {{ item.value }}
                </div>
              </Tooltip>
              <div
                v-else
                class="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                {{ item.value }}
              </div>
              <div class="mt-2 text-xs leading-5 text-slate-500">
                {{ item.description }}
              </div>
            </div>
          </div>
        </Card>

        <Card
          class="border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.manualTriggerWorkflow')"
        >
          <div class="mb-4 flex justify-end gap-2">
            <VbenButton
              v-access="
                asActionPermission(
                  OPS_ACTION_PERMISSION_CODES.TASK_WORKFLOW_TRIGGER,
                )
              "
              type="primary"
              :disabled="submitting"
              @click="handleTriggerWorkflow"
            >
              {{
                submitting
                  ? $t('business.message.submitting')
                  : $t('business.message.triggerWorkflow')
              }}
            </VbenButton>
          </div>
          <div
            class="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-3"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div
                class="text-sm font-medium text-slate-900 dark:text-slate-100"
              >
                {{ $t('business.message.workflowTriggerAdvice') }}
              </div>
              <Button
                size="small"
                type="link"
                @click="showWorkflowTriggerGuide = !showWorkflowTriggerGuide"
              >
                {{
                  showWorkflowTriggerGuide
                    ? $t('business.message.collapseDescription')
                    : $t('business.message.expandDescription')
                }}
              </Button>
            </div>
            <div
              v-if="showWorkflowTriggerGuide"
              class="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-300"
            >
              <div>
                {{ $t('business.message.workflowTriggerGuideDesc') }}
              </div>
              <ul class="mt-2 list-disc space-y-1 pl-5">
                <li
                  v-for="item in triggerWorkflowFieldGuides"
                  :key="item.label"
                >
                  <span class="font-medium text-slate-700 dark:text-slate-200">
                    {{ item.label }}:
                  </span>
                  <span>{{ item.description }}</span>
                </li>
              </ul>
              <pre
                v-if="taskQueueHintText"
                class="mt-3 overflow-auto rounded-xl border border-slate-200/70 bg-slate-950/90 px-3 py-2 text-[11px] leading-5 text-slate-100 dark:border-slate-700/60"
                v-text="taskQueueHintText"
              ></pre>
            </div>
          </div>
          <Space class="mb-4" :size="8" wrap>
            <Button size="small" @click="fillTriggerWorkflowDelay(60)">
              {{ $t('business.message.delayOneMinute') }}
            </Button>
            <Button size="small" @click="fillTriggerWorkflowDelay(300)">
              {{ $t('business.message.delayFiveMinutes') }}
            </Button>
            <Button size="small" @click="fillTriggerWorkflowProcessAt(0)">
              {{ $t('business.message.fillCurrentTime') }}
            </Button>
            <Button size="small" @click="clearTriggerWorkflowSchedule">
              {{ $t('business.message.clearTimeFields') }}
            </Button>
          </Space>
          <div
            v-if="currentWorkflowMeta"
            class="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-sm"
          >
            <div class="font-medium text-slate-900 dark:text-slate-100">
              {{
                $t('business.message.workflowMetaSummary', [
                  currentWorkflowMeta.name,
                  currentWorkflowMeta.defaultQueue || '-',
                  currentWorkflowMeta.nodeCount,
                ])
              }}
            </div>
            <div
              class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-300"
            >
              {{
                currentWorkflowMeta.usageHint ||
                $t('business.message.noExtraUsageHint')
              }}
              <template v-if="currentWorkflowMeta.targetsExample">
                {{
                  $t('business.message.executionTargetExampleInline', [
                    currentWorkflowMeta.targetsExample,
                  ])
                }}
              </template>
            </div>
          </div>
          <Space v-if="currentWorkflowMeta" class="mb-4" :size="8" wrap>
            <Button
              size="small"
              type="primary"
              @click="applySelectedWorkflowDefaults({ force: true })"
            >
              {{ $t('business.message.fillWorkflowDefaults') }}
            </Button>
            <Button size="small" @click="fillSelectedWorkflowQueue">
              {{ $t('business.message.fillDefaultQueue') }}
            </Button>
            <Button size="small" @click="fillSelectedWorkflowTargetsExample">
              {{ $t('business.message.fillExecutionTargetExample') }}
            </Button>
          </Space>
          <TriggerWorkflowForm />
          <div
            v-if="latestWorkflowTrigger"
            class="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-4"
          >
            <div class="mb-2 text-sm font-semibold">
              {{ $t('business.message.latestTriggerReceipt') }}
            </div>
            <div class="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
              <div>
                {{ $t('business.message.workflow') }}:
                {{ latestWorkflowTrigger.workflowName }}
              </div>
              <div>
                {{ $t('business.message.queue') }}:
                {{ latestWorkflowTrigger.queue }}
              </div>
              <div>
                {{ $t('business.message.entryTask') }}:
                {{ latestWorkflowTrigger.taskId }}
              </div>
            </div>
            <Space class="mt-3" :size="8" wrap>
              <Button
                size="small"
                type="primary"
                @click="handleOpenWorkflowTask"
              >
                {{ $t('business.message.viewEntryTask') }}
              </Button>
              <Button size="small" @click="handleReuseWorkflowID">
                {{ $t('business.message.queryWorkflowStatus') }}
              </Button>
              <Button
                size="small"
                @click="showWorkflowTriggerRaw = !showWorkflowTriggerRaw"
              >
                {{
                  showWorkflowTriggerRaw
                    ? $t('business.message.closeRawReceipt')
                    : $t('business.message.viewRawReceipt')
                }}
              </Button>
            </Space>
          </div>
          <JsonDetailViewer
            v-if="showWorkflowTriggerRaw && workflowTriggerResultText"
            class="mt-4"
            :search-placeholder="
              $t('business.message.jsonDataSearchPlaceholder')
            "
            :value="workflowTriggerResultText"
          />
        </Card>

        <Card
          class="border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.manualEnqueueTask')"
        >
          <div class="mb-4 flex justify-end gap-2">
            <VbenButton
              v-access="
                asActionPermission(OPS_ACTION_PERMISSION_CODES.TASK_ENQUEUE)
              "
              type="primary"
              :disabled="submitting"
              @click="handleEnqueueTask"
            >
              {{
                submitting
                  ? $t('business.message.submitting')
                  : $t('business.message.enqueueTask')
              }}
            </VbenButton>
          </div>
          <div
            class="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-3"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div
                class="text-sm font-medium text-slate-900 dark:text-slate-100"
              >
                {{ $t('business.message.enqueueTaskAdvice') }}
              </div>
              <Button
                size="small"
                type="link"
                @click="showEnqueueTaskGuide = !showEnqueueTaskGuide"
              >
                {{
                  showEnqueueTaskGuide
                    ? $t('business.message.collapseDescription')
                    : $t('business.message.expandDescription')
                }}
              </Button>
            </div>
            <div
              v-if="showEnqueueTaskGuide"
              class="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-300"
            >
              <div>
                {{ $t('business.message.enqueueTaskGuideDesc') }}
              </div>
              <ul class="mt-2 list-disc space-y-1 pl-5">
                <li v-for="item in enqueueTaskFieldGuides" :key="item.label">
                  <span class="font-medium text-slate-700 dark:text-slate-200">
                    {{ item.label }}:
                  </span>
                  <span>{{ item.description }}</span>
                </li>
              </ul>
              <pre
                v-if="taskQueueHintText"
                class="mt-3 overflow-auto rounded-xl border border-slate-200/70 bg-slate-950/90 px-3 py-2 text-[11px] leading-5 text-slate-100 dark:border-slate-700/60"
                v-text="taskQueueHintText"
              ></pre>
            </div>
          </div>
          <Space class="mb-4" :size="8" wrap>
            <Button
              size="small"
              type="primary"
              @click="applySelectedTaskDefaults({ force: true })"
            >
              {{ $t('business.message.fillTaskDefaults') }}
            </Button>
            <Button size="small" @click="fillSampleTaskPayload">
              {{ $t('business.message.fillJsonExample') }}
            </Button>
            <Button size="small" @click="fillSelectedTaskPayloadExample">
              {{ $t('business.message.fillCurrentTaskExample') }}
            </Button>
            <Button size="small" @click="fillEnqueueTaskDelay(60)">
              {{ $t('business.message.delayOneMinute') }}
            </Button>
            <Button size="small" @click="fillEnqueueTaskProcessAt(0)">
              {{ $t('business.message.fillCurrentTime') }}
            </Button>
            <Button size="small" @click="clearEnqueueTaskSchedule">
              {{ $t('business.message.clearTimeFields') }}
            </Button>
          </Space>
          <div
            v-if="currentTaskTypeMeta"
            class="mb-4 rounded-xl border px-3 py-3 text-sm"
            :class="
              currentTaskTypeMeta.manualRecommended
                ? 'border-sky-500/20 bg-sky-500/5'
                : 'border-amber-500/20 bg-amber-500/5'
            "
          >
            <div class="font-medium text-slate-900 dark:text-slate-100">
              {{ currentTaskTypeMeta.taskType }} /
              {{
                currentTaskTypeMeta.description ||
                $t('business.message.registeredTaskHandler')
              }}
              <template v-if="!currentTaskTypeMeta.manualRecommended">
                / {{ $t('business.message.notRecommendedManualEnqueue') }}
              </template>
            </div>
            <div
              class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-300"
            >
              {{
                currentTaskTypeMeta.usageHint ||
                $t('business.message.noExtraUsageHint')
              }}
              <template v-if="currentTaskTypeMeta.payloadExample">
                {{ $t('business.message.payloadExampleAvailable') }}
              </template>
            </div>
          </div>
          <EnqueueTaskForm />
          <div
            v-if="latestEnqueueTask"
            class="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-4"
          >
            <div class="mb-2 text-sm font-semibold">
              {{ $t('business.message.latestEnqueueReceipt') }}
            </div>
            <div class="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
              <div>
                {{ $t('business.message.taskType') }}:
                {{ latestEnqueueTask.taskType }}
              </div>
              <div>
                {{ $t('business.message.queue') }}:
                {{ latestEnqueueTask.queue }}
              </div>
              <div>
                {{ $t('business.message.taskId') }}:
                {{ latestEnqueueTask.taskId }}
              </div>
            </div>
            <Space class="mt-3" :size="8" wrap>
              <Button
                size="small"
                type="primary"
                @click="handleOpenEnqueueTask"
              >
                {{ $t('business.message.viewTaskDetail') }}
              </Button>
              <Button
                size="small"
                @click="showEnqueueTaskRaw = !showEnqueueTaskRaw"
              >
                {{
                  showEnqueueTaskRaw
                    ? $t('business.message.closeRawReceipt')
                    : $t('business.message.viewRawReceipt')
                }}
              </Button>
            </Space>
          </div>
          <JsonDetailViewer
            v-if="showEnqueueTaskRaw && enqueueTaskResultText"
            class="mt-4"
            :search-placeholder="
              $t('business.message.jsonDataSearchPlaceholder')
            "
            :value="enqueueTaskResultText"
          />
        </Card>
      </div>
    </div>
  </Page>
</template>
