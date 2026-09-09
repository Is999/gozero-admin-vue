<script lang="ts" setup>
// ================= 类型与依赖引入 =================
import type { OpsAPIRuntimeApi } from '#/api/ops/runtime';
import type { TaskApi } from '#/api/ops/task';

import { computed, nextTick, ref, watch } from 'vue';

import { Page, VbenButton } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  CopyOutlined,
  FileTextOutlined,
  SearchOutlined,
  TableOutlined,
} from '@ant-design/icons-vue';
import {
  Alert,
  Button,
  Card,
  Input,
  message,
  Radio,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  fetchAPIRuntimeConfigReloadItems,
  fetchAPIRuntimeConfigReloadStatus,
  runAPIRuntimeConfigReload,
} from '#/api/ops/runtime';
import {
  fetchConfigReloadItems,
  fetchConfigReloadStatus,
  runConfigReload,
} from '#/api/ops/task';
import {
  asActionPermission,
  OPS_ACTION_PERMISSION_CODES,
  hasAnyPermission,
} from '#/constants/permission-codes';
import { $t } from '#/locales';
import { resolveRequestErrorMessage } from '#/utils/file/download';
import { submitWithMfaRetry, ticketPayload } from '#/utils/security/mfa';
import { copyTextToClipboard } from '#/utils/security/password';

import JsonDetailViewer from '../../system/components/json-detail-viewer.vue';
import TreeExpandToolbar from '../../system/components/tree-expand-toolbar.vue';
import {
  buildHotReloadStatusLabel,
  buildHotReloadTriggerLabel,
  safePrettyJson,
} from '../shared';

type OverflowTooltipProps = InstanceType<typeof Tooltip>['$props'];
// ConfigItemTablePagination 表示 Ant Design 表格分页事件里需要的字段。
type ConfigItemTablePagination = {
  current?: number;
  pageSize?: number;
};
// ConfigItemViewMode 控制配置项结果在 YAML 与表格之间切换。
type ConfigItemViewMode = 'table' | 'yaml';
// ReloadTabKey 标识当前查看的是后台或 API 进程热加载状态。
type ReloadTabKey = 'admin' | 'api';
// ConfigYamlViewMode 控制 YAML 视图展示运行期结构或完整快照。
type ConfigYamlViewMode = 'runtime' | 'snapshot';
// ConfigYamlTokenType 表示 YAML 只读高亮视图中的词法类型。
type ConfigYamlTokenType =
  | 'boolean'
  | 'comment'
  | 'key'
  | 'null'
  | 'number'
  | 'plain'
  | 'punctuation'
  | 'string';
// ConfigYamlToken 表示一段可独立着色的 YAML 文本。
type ConfigYamlToken = {
  // matchIndex 记录搜索命中序号，undefined 表示普通语法高亮片段。
  matchIndex?: number;
  // text 保存原始 YAML 片段文本。
  text: string;
  // type 决定片段在只读视图里的高亮样式。
  type: ConfigYamlTokenType;
};
// ConfigYamlLine 表示带行号的一行 YAML。
type ConfigYamlLine = {
  // matchIndexes 保存本行所有搜索命中序号，用于标记当前定位行。
  matchIndexes: number[];
  // no 使用一基行号，便于排障时定位配置位置。
  no: number;
  // tokens 保存该行按 YAML 语义拆分后的高亮片段。
  tokens: ConfigYamlToken[];
};
// ConfigYamlVisibleLine 表示应用层级折叠后实际展示的一行 YAML。
type ConfigYamlVisibleLine = {
  // collapsed 标记当前节点是否折叠。
  collapsed: boolean;
  // foldable 标记当前行是否拥有缩进层级子节点。
  foldable: boolean;
} & ConfigYamlLine;
// ConfigYamlFoldNode 记录可折叠 YAML 行的结束位置与零基层级。
type ConfigYamlFoldNode = {
  depth: number;
  endLineNo: number;
};
// ConfigYamlSearchMatch 表示当前 YAML 中可跳转的一个搜索命中。
type ConfigYamlSearchMatch = {
  // index 是从 0 开始的命中序号，和 DOM data 属性保持一致。
  index: number;
  // lineNo 记录命中所在行号，便于后续扩展定位提示。
  lineNo: number;
};

// MFA_SCENARIO_API_RUNTIME_MANAGE 表示 API 运行态管理二次校验场景。
const MFA_SCENARIO_API_RUNTIME_MANAGE = 14;

// configYamlTokenClassMap 定义 YAML 高亮颜色类，避免使用 v-html 注入高亮片段。
const configYamlTokenClassMap: Record<ConfigYamlTokenType, string> = {
  boolean: 'config-yaml-token-boolean',
  comment: 'config-yaml-token-comment',
  key: 'config-yaml-token-key',
  null: 'config-yaml-token-null',
  number: 'config-yaml-token-number',
  plain: 'config-yaml-token-plain',
  punctuation: 'config-yaml-token-punctuation',
  string: 'config-yaml-token-string',
};

// ================= 页面状态 =================
// accessStore 保存当前登录账号的 uuid 权限码集合，用于判断是否自动拉取热加载状态。
const accessStore = useAccessStore();
// activeReloadTab 控制 Admin 与 API 热加载分区，避免两类运行态混在同一屏卡片里。
const activeReloadTab = ref<ReloadTabKey>('admin');
// adminReloadStatusLoaded 标记后台热加载状态是否已经由页面自动拉取过。
const adminReloadStatusLoaded = ref(false);
// apiReloadStatusLoaded 标记 API 热加载状态是否已经由页面自动拉取过。
const apiReloadStatusLoaded = ref(false);
// submitting 避免查询与执行热加载时重复点击。
const submitting = ref(false);
// configReloadStatusText 保存热加载接口原始响应，便于排障复制。
const configReloadStatusText = ref('');
// configReloadStatus 保存最近一次配置热加载状态对象。
const configReloadStatus = ref<null | TaskApi.TaskConfigReloadStatusResp>(null);
// showConfigReloadRaw 控制原始 JSON 回执是否展开。
const showConfigReloadRaw = ref(false);
// configItems 保存后端返回的运行态配置项，值已经在后端完成脱敏。
const configItems = ref<TaskApi.TaskConfigItem[]>([]);
// configItemResult 保存配置项查询完整响应，供统计和 YAML 视图共用。
const configItemResult = ref<null | TaskApi.TaskConfigItemQueryResp>(null);
// configItemsLoading 控制配置项查询按钮与表格加载状态。
const configItemsLoading = ref(false);
// configItemsLoaded 标记是否已经完成过一次配置项查询。
const configItemsLoaded = ref(false);
// configItemKeyword 保存配置项搜索关键字，只匹配路径和脱敏展示值。
const configItemKeyword = ref('');
// configItemSearchKeyword 保存最近一次查询实际使用的关键字，用于结果高亮。
const configItemSearchKeyword = ref('');
// configItemSensitiveOnly 控制是否只查询后端判定的敏感配置项。
const configItemSensitiveOnly = ref(false);
// configItemPage 保存配置项表格当前页码。
const configItemPage = ref(1);
// configItemPageSize 保存配置项表格分页大小。
const configItemPageSize = ref(20);
// configItemTotal 保存当前筛选条件下的配置项总数。
const configItemTotal = ref(0);
// configItemViewMode 控制结果展示为 YAML 或表格。
const configItemViewMode = ref<ConfigItemViewMode>('yaml');
// configYamlViewMode 控制 YAML 视图展示完整快照或 runtime.yaml 原结构。
const configYamlViewMode = ref<ConfigYamlViewMode>('runtime');
// configYamlViewRef 指向当前 YAML 滚动容器，用于搜索后自动定位命中项。
const configYamlViewRef = ref<HTMLElement | null>(null);
// configYamlMatchIndex 保存当前高亮定位到的 YAML 搜索命中序号。
const configYamlMatchIndex = ref(0);
// collapsedConfigYamlLines 保存当前 YAML 已折叠节点的一基行号。
const collapsedConfigYamlLines = ref<Set<number>>(new Set());
// apiRuntimeSubmitting 避免 API 热加载状态查询或触发重复点击。
const apiRuntimeSubmitting = ref(false);
// apiRuntimeStatusText 保存 API 热加载接口原始回执，便于复制排障。
const apiRuntimeStatusText = ref('');
// apiRuntimeStatus 保存最近一次 API 热加载状态回执。
const apiRuntimeStatus = ref<null | OpsAPIRuntimeApi.ReloadResp>(null);
// showAPIRuntimeRaw 控制 API 热加载原始 JSON 回执是否展开。
const showAPIRuntimeRaw = ref(false);
// apiConfigItems 保存 API 返回的运行态配置项，值已经由 API 后端脱敏。
const apiConfigItems = ref<TaskApi.TaskConfigItem[]>([]);
// apiConfigItemResult 保存 API 配置项查询完整响应。
const apiConfigItemResult = ref<null | TaskApi.TaskConfigItemQueryResp>(null);
// apiConfigItemsLoading 控制 API 配置项查询按钮与表格加载状态。
const apiConfigItemsLoading = ref(false);
// apiConfigItemsLoaded 标记是否已经完成过一次 API 配置项查询。
const apiConfigItemsLoaded = ref(false);
// apiConfigItemKeyword 保存 API 配置项搜索关键字。
const apiConfigItemKeyword = ref('');
// apiConfigItemSearchKeyword 保存 API 最近一次查询实际使用的关键字。
const apiConfigItemSearchKeyword = ref('');
// apiConfigItemSensitiveOnly 控制是否只查询 API 敏感配置项。
const apiConfigItemSensitiveOnly = ref(false);
// apiConfigItemPage 保存 API 配置项表格当前页码。
const apiConfigItemPage = ref(1);
// apiConfigItemPageSize 保存 API 配置项表格分页大小。
const apiConfigItemPageSize = ref(20);
// apiConfigItemTotal 保存 API 当前筛选条件下配置项总数。
const apiConfigItemTotal = ref(0);
// apiConfigItemViewMode 控制 API 结果展示为 YAML 或表格。
const apiConfigItemViewMode = ref<ConfigItemViewMode>('yaml');
// apiConfigYamlViewMode 控制 API YAML 视图展示运行期结构或完整快照。
const apiConfigYamlViewMode = ref<ConfigYamlViewMode>('runtime');

// canQueryConfigReloadStatus 判断当前账号是否可以查询热加载状态。
const canQueryConfigReloadStatus = computed(() =>
  hasAnyPermission(
    accessStore.accessCodes,
    OPS_ACTION_PERMISSION_CODES.TASK_CONFIG_RELOAD_STATUS,
  ),
);

// canQueryConfigItems 判断当前账号是否可以查看运行态配置项。
const canQueryConfigItems = computed(() =>
  hasAnyPermission(
    accessStore.accessCodes,
    OPS_ACTION_PERMISSION_CODES.TASK_CONFIG_RELOAD_ITEMS,
  ),
);

// canQueryAPIRuntimeConfigReloadStatus 判断当前账号是否可以查询 API 热加载状态。
const canQueryAPIRuntimeConfigReloadStatus = computed(() =>
  hasAnyPermission(
    accessStore.accessCodes,
    OPS_ACTION_PERMISSION_CODES.API_RUNTIME_CONFIG_RELOAD_STATUS,
  ),
);

// canQueryAPIRuntimeConfigReloadItems 判断当前账号是否可以查询 API 运行态配置项。
const canQueryAPIRuntimeConfigReloadItems = computed(() =>
  hasAnyPermission(
    accessStore.accessCodes,
    OPS_ACTION_PERMISSION_CODES.API_RUNTIME_CONFIG_RELOAD_ITEMS,
  ),
);

// canManageConfigReload 判断当前账号是否具备任一热加载相关操作权限。
const canManageConfigReload = computed(() =>
  hasAnyPermission(accessStore.accessCodes, [
    OPS_ACTION_PERMISSION_CODES.API_RUNTIME_CONFIG_RELOAD_ITEMS,
    OPS_ACTION_PERMISSION_CODES.API_RUNTIME_CONFIG_RELOAD_RUN,
    OPS_ACTION_PERMISSION_CODES.API_RUNTIME_CONFIG_RELOAD_STATUS,
    OPS_ACTION_PERMISSION_CODES.TASK_CONFIG_RELOAD_ITEMS,
    OPS_ACTION_PERMISSION_CODES.TASK_CONFIG_RELOAD_RUN,
    OPS_ACTION_PERMISSION_CODES.TASK_CONFIG_RELOAD_STATUS,
  ]),
);

// configItemColumns 定义运行态配置项表格列。
const configItemColumns = computed(() => [
  {
    title: $t('business.message.configItemPath'),
    dataIndex: 'path',
    key: 'path',
    width: 320,
  },
  {
    title: $t('business.message.configItemValue'),
    dataIndex: 'value',
    key: 'value',
  },
  {
    title: $t('business.message.configItemType'),
    dataIndex: 'valueType',
    key: 'valueType',
    width: 120,
  },
  {
    title: $t('business.message.configItemSensitive'),
    dataIndex: 'sensitive',
    key: 'sensitive',
    width: 120,
  },
]);

// configItemOverviewRows 生成配置项结果总览，帮助确认当前响应来自运行态快照。
const configItemOverviewRows = computed(() => {
  return buildConfigItemOverviewRows(configItemResult.value);
});

// configItemSourceRows 展示热加载来源元信息，避免把 YAML 快照误认为磁盘原文件。
const configItemSourceRows = computed(() => {
  return buildConfigItemSourceRows(configItemResult.value?.source);
});

// configItemSections 保存后端按顶层配置块汇总的数量和敏感项统计。
const configItemSections = computed(
  () => configItemResult.value?.sections || [],
);

// configSnapshotYaml 保存完整运行态配置快照，字段值已由后端脱敏。
const configSnapshotYaml = computed(
  () => configItemResult.value?.snapshotYaml || '',
);
// configRuntimeYaml 保存 runtime.yaml 顶层结构视图，便于确认外部配置已生效。
const configRuntimeYaml = computed(
  () => configItemResult.value?.runtimeYaml || '',
);
// activeConfigYaml 返回当前选中的 YAML 文本，供复制和预览共用。
const activeConfigYaml = computed(() =>
  configYamlViewMode.value === 'runtime'
    ? configRuntimeYaml.value
    : configSnapshotYaml.value,
);
// activeConfigYamlLines 将当前 YAML 文本拆成带高亮 token 的只读行数据。
const activeConfigYamlLines = computed(() =>
  buildConfigYamlLines(activeConfigYaml.value, configItemSearchKeyword.value),
);

// apiConfigItemOverviewRows 生成 API 配置项结果总览。
const apiConfigItemOverviewRows = computed(() =>
  buildConfigItemOverviewRows(apiConfigItemResult.value),
);

// apiConfigItemSourceRows 展示 API 热加载来源元信息。
const apiConfigItemSourceRows = computed(() =>
  buildConfigItemSourceRows(apiConfigItemResult.value?.source),
);

// apiConfigItemSections 保存 API 按顶层配置块汇总的数量和敏感项统计。
const apiConfigItemSections = computed(
  () => apiConfigItemResult.value?.sections || [],
);

// apiConfigSnapshotYaml 保存 API 完整运行态配置快照，字段值已由 API 后端脱敏。
const apiConfigSnapshotYaml = computed(
  () => apiConfigItemResult.value?.snapshotYaml || '',
);

// apiConfigRuntimeYaml 保存 API 外部运行期结构视图。
const apiConfigRuntimeYaml = computed(
  () => apiConfigItemResult.value?.runtimeYaml || '',
);

// activeAPIConfigYaml 返回 API 当前选中的 YAML 文本。
const activeAPIConfigYaml = computed(() =>
  apiConfigYamlViewMode.value === 'runtime'
    ? apiConfigRuntimeYaml.value
    : apiConfigSnapshotYaml.value,
);

// activeAPIConfigYamlLines 将 API YAML 文本拆成带高亮 token 的只读行数据。
const activeAPIConfigYamlLines = computed(() =>
  buildConfigYamlLines(
    activeAPIConfigYaml.value,
    apiConfigItemSearchKeyword.value,
  ),
);

// canQueryActiveConfigItems 判断当前 Tab 是否可查看对应进程的运行态配置项。
const canQueryActiveConfigItems = computed(() =>
  activeReloadTab.value === 'api'
    ? canQueryAPIRuntimeConfigReloadItems.value
    : canQueryConfigItems.value,
);

// activeConfigItemsTitle 返回当前 Tab 的配置项面板标题。
const activeConfigItemsTitle = computed(() =>
  activeReloadTab.value === 'api'
    ? `${$t('business.message.apiConfigHotReload')} / ${$t(
        'business.message.configRuntimeItems',
      )}`
    : $t('business.message.configRuntimeItems'),
);

// activeConfigItemsGuide 返回当前 Tab 的配置项引导文案。
const activeConfigItemsGuide = computed(() =>
  activeReloadTab.value === 'api'
    ? $t('business.message.apiConfigRuntimeItemsGuide')
    : $t('business.message.configRuntimeItemsGuide'),
);

// activeConfigItemsLoading 读取当前 Tab 配置项加载状态。
const activeConfigItemsLoading = computed(() =>
  activeReloadTab.value === 'api'
    ? apiConfigItemsLoading.value
    : configItemsLoading.value,
);

// activeConfigItemsLoaded 读取当前 Tab 配置项是否已加载。
const activeConfigItemsLoaded = computed(() =>
  activeReloadTab.value === 'api'
    ? apiConfigItemsLoaded.value
    : configItemsLoaded.value,
);

// activeConfigItemKeyword 双向绑定当前 Tab 配置项关键字。
const activeConfigItemKeyword = computed({
  get: () =>
    activeReloadTab.value === 'api'
      ? apiConfigItemKeyword.value
      : configItemKeyword.value,
  set: (value: string) => {
    if (activeReloadTab.value === 'api') {
      apiConfigItemKeyword.value = value;
      return;
    }
    configItemKeyword.value = value;
  },
});

// activeConfigItemSensitiveOnly 双向绑定当前 Tab 是否只看敏感项。
const activeConfigItemSensitiveOnly = computed({
  get: () =>
    activeReloadTab.value === 'api'
      ? apiConfigItemSensitiveOnly.value
      : configItemSensitiveOnly.value,
  set: (value: boolean) => {
    if (activeReloadTab.value === 'api') {
      apiConfigItemSensitiveOnly.value = value;
      return;
    }
    configItemSensitiveOnly.value = value;
  },
});

// activeConfigItemViewMode 双向绑定当前 Tab 的配置项展示模式。
const activeConfigItemViewMode = computed({
  get: () =>
    activeReloadTab.value === 'api'
      ? apiConfigItemViewMode.value
      : configItemViewMode.value,
  set: (value: ConfigItemViewMode) => {
    if (activeReloadTab.value === 'api') {
      apiConfigItemViewMode.value = value;
      return;
    }
    configItemViewMode.value = value;
  },
});

// activeConfigYamlViewMode 双向绑定当前 Tab 的 YAML 视图模式。
const activeConfigYamlViewMode = computed({
  get: () =>
    activeReloadTab.value === 'api'
      ? apiConfigYamlViewMode.value
      : configYamlViewMode.value,
  set: (value: ConfigYamlViewMode) => {
    if (activeReloadTab.value === 'api') {
      apiConfigYamlViewMode.value = value;
      return;
    }
    configYamlViewMode.value = value;
  },
});

// activeConfigItemOverviewRows 返回当前 Tab 的配置项统计行。
const activeConfigItemOverviewRows = computed(() =>
  activeReloadTab.value === 'api'
    ? apiConfigItemOverviewRows.value
    : configItemOverviewRows.value,
);

// activeConfigItemSourceRows 返回当前 Tab 的配置来源行。
const activeConfigItemSourceRows = computed(() =>
  activeReloadTab.value === 'api'
    ? apiConfigItemSourceRows.value
    : configItemSourceRows.value,
);

// activeConfigItemSections 返回当前 Tab 的顶层配置段统计。
const activeConfigItemSections = computed(() =>
  activeReloadTab.value === 'api'
    ? apiConfigItemSections.value
    : configItemSections.value,
);

// activeRuntimeYaml 返回当前 Tab 的外部运行期 YAML 视图。
const activeRuntimeYaml = computed(() =>
  activeReloadTab.value === 'api'
    ? apiConfigRuntimeYaml.value
    : configRuntimeYaml.value,
);

// activeConfigYamlText 返回当前 Tab 已选中的 YAML 文本。
const activeConfigYamlText = computed(() =>
  activeReloadTab.value === 'api'
    ? activeAPIConfigYaml.value
    : activeConfigYaml.value,
);

// activeConfigSearchKeyword 返回当前 Tab 的配置项搜索词。
const activeConfigSearchKeyword = computed(() =>
  activeReloadTab.value === 'api'
    ? apiConfigItemSearchKeyword.value.trim()
    : configItemSearchKeyword.value.trim(),
);

// activeConfigYamlLineRows 返回当前 Tab 已选中的 YAML 行数据。
const activeConfigYamlLineRows = computed(() =>
  activeReloadTab.value === 'api'
    ? activeAPIConfigYamlLines.value
    : activeConfigYamlLines.value,
);

// activeConfigYamlFoldNodes 返回每个可折叠 YAML 节点的范围与层级。
const activeConfigYamlFoldNodes = computed(() =>
  buildConfigYamlFoldNodes(activeConfigYamlText.value),
);
// activeConfigYamlMaxLevel 限制层级输入不超过当前 YAML 的实际深度。
const activeConfigYamlMaxLevel = computed(() =>
  Math.max(
    1,
    ...[...activeConfigYamlFoldNodes.value.values()].map(
      (node) => node.depth + 1,
    ),
  ),
);

// activeConfigYamlVisibleLines 过滤折叠子行；搜索时自动展开以保证命中可定位。
const activeConfigYamlVisibleLines = computed<ConfigYamlVisibleLine[]>(() => {
  const collapsedLines = activeConfigSearchKeyword.value
    ? new Set<number>()
    : collapsedConfigYamlLines.value;

  return activeConfigYamlLineRows.value
    .filter((line) => {
      for (const lineNo of collapsedLines) {
        const endLineNo =
          activeConfigYamlFoldNodes.value.get(lineNo)?.endLineNo;
        if (endLineNo && line.no > lineNo && line.no <= endLineNo) {
          return false;
        }
      }
      return true;
    })
    .map((line) => ({
      ...line,
      collapsed: collapsedLines.has(line.no),
      foldable: activeConfigYamlFoldNodes.value.has(line.no),
    }));
});

// activeConfigYamlMatches 汇总当前 YAML 视图内可跳转的搜索命中。
const activeConfigYamlMatches = computed(() =>
  collectConfigYamlMatches(activeConfigYamlLineRows.value),
);

// activeConfigYamlMatchTotal 返回当前 YAML 视图的搜索命中数量。
const activeConfigYamlMatchTotal = computed(
  () => activeConfigYamlMatches.value.length,
);

// activeConfigYamlCurrentMatch 返回当前命中的一基序号，供页面展示。
const activeConfigYamlCurrentMatch = computed(() =>
  activeConfigYamlMatchTotal.value > 0 ? configYamlMatchIndex.value + 1 : 0,
);

/** 按 YAML 缩进识别每个可折叠节点的结束行与层级。 */
function buildConfigYamlFoldNodes(yaml: string) {
  const lines = yaml.split('\n');
  const nodes = new Map<number, ConfigYamlFoldNode>();
  const getIndent = (line: string) => {
    let indent = 0;
    for (const char of line) {
      if (char === ' ') {
        indent += 1;
      } else if (char === '\t') {
        indent += 2;
      } else {
        break;
      }
    }
    return indent;
  };
  const isContentLine = (line: string) => {
    const text = line.trim();
    return text.length > 0 && !text.startsWith('#');
  };
  const contentLines = lines.flatMap((line, index) =>
    isContentLine(line)
      ? [{ indent: getIndent(line), index, lineNo: index + 1 }]
      : [],
  );
  const parentIndents: number[] = [];

  contentLines.forEach((line, contentIndex) => {
    while (
      parentIndents.length > 0 &&
      parentIndents[parentIndents.length - 1]! >= line.indent
    ) {
      parentIndents.pop();
    }
    const child = contentLines[contentIndex + 1];
    if (child && child.indent > line.indent) {
      let endLineNo = lines.length;
      for (
        let nextIndex = contentIndex + 2;
        nextIndex < contentLines.length;
        nextIndex += 1
      ) {
        const next = contentLines[nextIndex]!;
        if (next.indent <= line.indent) {
          endLineNo = next.index;
          break;
        }
      }
      nodes.set(line.lineNo, {
        depth: parentIndents.length,
        endLineNo,
      });
    }
    parentIndents.push(line.indent);
  });

  return nodes;
}

/** 切换单个 YAML 层级节点的折叠状态。 */
function toggleConfigYamlFold(lineNo: number) {
  const next = new Set(collapsedConfigYamlLines.value);
  if (next.has(lineNo)) {
    next.delete(lineNo);
  } else {
    next.add(lineNo);
  }
  collapsedConfigYamlLines.value = next;
}

/** 展开当前 YAML 的全部层级。 */
function expandAllConfigYaml() {
  collapsedConfigYamlLines.value = new Set();
}

/** 折叠当前 YAML 的全部层级。 */
function collapseAllConfigYaml() {
  collapsedConfigYamlLines.value = new Set(
    activeConfigYamlFoldNodes.value.keys(),
  );
}

/** 展开 YAML 到指定层级，并保留更深层节点已有状态。 */
function expandConfigYamlLevel(level: number) {
  const next = new Set(collapsedConfigYamlLines.value);
  activeConfigYamlFoldNodes.value.forEach((node, lineNo) => {
    if (node.depth < level) {
      next.delete(lineNo);
    }
  });
  collapsedConfigYamlLines.value = next;
}

/** 从指定层级向下折叠 YAML，并保留更高层节点状态。 */
function collapseConfigYamlLevel(level: number) {
  const next = new Set(collapsedConfigYamlLines.value);
  const startDepth = Math.max(0, level - 1);
  activeConfigYamlFoldNodes.value.forEach((node, lineNo) => {
    if (node.depth >= startDepth) {
      next.add(lineNo);
    }
  });
  collapsedConfigYamlLines.value = next;
}

watch(activeConfigYamlText, () => {
  collapsedConfigYamlLines.value = new Set();
});

// activeConfigTableItems 返回当前 Tab 的配置项表格数据。
const activeConfigTableItems = computed(() =>
  activeReloadTab.value === 'api' ? apiConfigItems.value : configItems.value,
);

// activeConfigItemPage 返回当前 Tab 的配置项页码。
const activeConfigItemPage = computed(() =>
  activeReloadTab.value === 'api'
    ? apiConfigItemPage.value
    : configItemPage.value,
);

// activeConfigItemPageSize 返回当前 Tab 的配置项页大小。
const activeConfigItemPageSize = computed(() =>
  activeReloadTab.value === 'api'
    ? apiConfigItemPageSize.value
    : configItemPageSize.value,
);

// activeConfigItemTotal 返回当前 Tab 的配置项总数。
const activeConfigItemTotal = computed(() =>
  activeReloadTab.value === 'api'
    ? apiConfigItemTotal.value
    : configItemTotal.value,
);

// hotReloadSummaryRows 生成“热加载状态总览”区域所需字段。
const hotReloadSummaryRows = computed(() => {
  const status = configReloadStatus.value;
  if (!status) {
    return [];
  }
  return [
    {
      label: $t('business.message.currentStatus'),
      value: buildHotReloadStatusLabel(status.lastStatus),
      description: $t('business.message.hotReloadCurrentStatusDesc'),
    },
    {
      label: $t('business.message.isEnabled'),
      value: status.enabled
        ? $t('business.message.enabled')
        : $t('business.message.disabled'),
      description: $t('business.message.hotReloadEnabledDesc'),
    },
    {
      label: $t('business.message.isWatching'),
      value: status.watching
        ? $t('business.message.backgroundWatching')
        : $t('business.message.notWatching'),
      description: $t('business.message.hotReloadWatchingDesc'),
    },
    {
      label: $t('business.message.latestTriggerSource'),
      value: buildHotReloadTriggerLabel(status.lastTriggerSource),
      description: $t('business.message.latestTriggerSourceDesc'),
    },
    {
      label: $t('business.message.configFile'),
      value: status.configFile || '-',
      description: $t('business.message.configFileDesc'),
    },
    {
      label: $t('business.message.pollInterval'),
      value: $t('business.message.secondsValue', [
        status.checkIntervalSeconds || 0,
      ]),
      description: $t('business.message.pollIntervalDesc'),
    },
    {
      label: $t('business.message.configVersion'),
      value: status.configVersion || '-',
      description: $t('business.message.configVersionDesc'),
    },
    {
      label: $t('business.message.restartRequired'),
      value: status.restartRequired
        ? $t('business.message.needRestartProcess')
        : $t('business.message.noRestartRequired'),
      description: $t('business.message.restartRequiredDesc'),
    },
    {
      label: $t('business.message.restartReason'),
      value: status.restartReason || '-',
      description: $t('business.message.restartReasonDesc'),
    },
    {
      label: $t('business.message.latestResultMessage'),
      value: status.lastMessage || '-',
      description: $t('business.message.latestResultMessageDesc'),
    },
    {
      label: $t('business.message.latestFailureCategory'),
      value: status.lastFailureCategory || '-',
      description: $t('business.message.latestFailureCategoryDesc'),
    },
    {
      label: $t('business.message.successCount'),
      value: $t('business.message.timesValue', [status.reloadCount || 0]),
      description: $t('business.message.successCountDesc'),
    },
    {
      label: $t('business.message.suppressedFailureCount'),
      value: $t('business.message.timesValue', [
        status.suppressedFailureCount || 0,
      ]),
      description: $t('business.message.suppressedFailureCountDesc'),
    },
  ];
});

// hotReloadTimeRows 生成“热加载时间轴”区域所需字段。
const hotReloadTimeRows = computed(() => {
  const status = configReloadStatus.value;
  if (!status) {
    return [];
  }
  return [
    {
      label: $t('business.message.latestCheckTime'),
      value: status.lastCheckedAt || '-',
      description: $t('business.message.latestCheckTimeDesc'),
    },
    {
      label: $t('business.message.latestReloadTime'),
      value: status.lastReloadAt || '-',
      description: $t('business.message.latestReloadTimeDesc'),
    },
    {
      label: $t('business.message.latestSuccessTime'),
      value: status.lastSuccessAt || '-',
      description: $t('business.message.latestSuccessTimeDesc'),
    },
    {
      label: $t('business.message.latestFailureTime'),
      value: status.lastFailureAt || '-',
      description: $t('business.message.latestFailureTimeDesc'),
    },
  ];
});

// hotReloadDetailRows 合并状态与时间字段，用紧凑描述表展示。
const hotReloadDetailRows = computed(() => [
  ...hotReloadSummaryRows.value,
  ...hotReloadTimeRows.value,
]);

// apiRuntimeDetailRows 生成 API 服务热加载状态摘要。
const apiRuntimeDetailRows = computed(() => {
  const result = apiRuntimeStatus.value;
  if (!result) {
    return [];
  }
  const status = result.status;
  const rows = [
    {
      label: $t('business.message.connectionStatus'),
      value: result.connected
        ? $t('business.message.connected')
        : $t('business.message.disconnected'),
      description: result.message || '-',
    },
  ];
  if (!status) {
    return rows;
  }
  return [
    ...rows,
    {
      label: $t('business.message.currentStatus'),
      value: buildHotReloadStatusLabel(status.lastStatus),
      description: $t('business.message.hotReloadCurrentStatusDesc'),
    },
    {
      label: $t('business.message.configVersion'),
      value: status.configVersion || '-',
      description: $t('business.message.configVersionDesc'),
    },
    {
      label: $t('business.message.latestReloadTime'),
      value: status.lastReloadAt || '-',
      description: $t('business.message.latestReloadTimeDesc'),
    },
    {
      label: $t('business.message.restartRequired'),
      value: status.restartRequired
        ? $t('business.message.needRestartProcess')
        : $t('business.message.noRestartRequired'),
      description: status.restartReason || '-',
    },
    {
      label: $t('business.message.latestResultMessage'),
      value: status.lastMessage || '-',
      description: $t('business.message.latestResultMessageDesc'),
    },
  ];
});

// buildConfigItemOverviewRows 生成运行态配置项结果总览。
function buildConfigItemOverviewRows(
  result?: null | TaskApi.TaskConfigItemQueryResp,
) {
  if (!result) {
    return [];
  }
  return [
    {
      label: $t('business.message.configMatchedItems'),
      value: String(result.total || 0),
      description: result.keyword || $t('business.message.all'),
    },
    {
      label: $t('business.message.configTotalItems'),
      value: String(result.totalItems || 0),
      description: $t('business.message.configTotalItemsDesc'),
    },
    {
      label: $t('business.message.configSensitiveItems'),
      value: String(result.sensitiveTotal || 0),
      description: $t('business.message.configSensitiveItemsDesc'),
    },
    {
      label: $t('business.message.configSnapshotVersion'),
      value: result.source?.configVersion || '-',
      description: $t('business.message.configSnapshotVersionDesc'),
    },
  ];
}

// buildConfigItemSourceRows 生成运行态配置项来源元信息。
function buildConfigItemSourceRows(source?: TaskApi.TaskConfigSourceMeta) {
  if (!source) {
    return [];
  }
  return [
    {
      label: $t('business.message.configSource'),
      value:
        source.source === 'runtime_snapshot'
          ? $t('business.message.configSourceRuntimeSnapshot')
          : source.source || '-',
    },
    {
      label: $t('business.message.configFile'),
      value: source.configFile || '-',
    },
    {
      label: $t('business.message.runtimeConfigFile'),
      value: source.runtimeFile || '-',
    },
    {
      label: $t('business.message.currentStatus'),
      value: buildHotReloadStatusLabel(source.lastStatus),
    },
    {
      label: $t('business.message.latestTriggerSource'),
      value: buildHotReloadTriggerLabel(source.lastTriggerSource),
    },
    {
      label: $t('business.message.latestReloadTime'),
      value: source.lastReloadAt || '-',
    },
    {
      label: $t('business.message.latestSuccessTime'),
      value: source.lastSuccessAt || '-',
    },
    {
      label: $t('business.message.restartRequired'),
      value: source.restartRequired
        ? $t('business.message.needRestartProcess')
        : $t('business.message.noRestartRequired'),
    },
  ];
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

// buildConfigYamlLines 生成 YAML 行号、语法 token 和搜索命中，避免模板解析字符串。
function buildConfigYamlLines(
  yamlText: string,
  keyword = '',
): ConfigYamlLine[] {
  const normalized = String(yamlText || '')
    .replaceAll('\r\n', '\n')
    .replace(/\n$/, '');
  if (!normalized) {
    return [];
  }
  let nextMatchIndex = 0;
  const normalizedKeyword = keyword.trim();
  return normalized.split('\n').map((line, index) => {
    const tokens = markConfigYamlMatches(
      tokenizeConfigYamlLine(line),
      normalizedKeyword,
      () => {
        const matchIndex = nextMatchIndex;
        nextMatchIndex += 1;
        return matchIndex;
      },
    );
    return {
      matchIndexes: tokens.flatMap((token) =>
        typeof token.matchIndex === 'number' ? [token.matchIndex] : [],
      ),
      no: index + 1,
      tokens,
    };
  });
}

// markConfigYamlMatches 在保留 YAML 语法高亮的同时拆出搜索命中片段。
function markConfigYamlMatches(
  tokens: ConfigYamlToken[],
  keyword: string,
  takeMatchIndex: () => number,
): ConfigYamlToken[] {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return tokens;
  }
  return tokens.flatMap((token) =>
    splitConfigYamlMatchToken(token, normalizedKeyword, takeMatchIndex),
  );
}

// splitConfigYamlMatchToken 按不区分大小写的搜索词拆分单个 YAML token。
function splitConfigYamlMatchToken(
  token: ConfigYamlToken,
  normalizedKeyword: string,
  takeMatchIndex: () => number,
): ConfigYamlToken[] {
  const normalizedText = token.text.toLowerCase();
  const parts: ConfigYamlToken[] = [];
  let start = 0;
  while (start < token.text.length) {
    const matchStart = normalizedText.indexOf(normalizedKeyword, start);
    if (matchStart === -1) {
      parts.push({ text: token.text.slice(start), type: token.type });
      break;
    }
    if (matchStart > start) {
      parts.push({
        text: token.text.slice(start, matchStart),
        type: token.type,
      });
    }
    const matchEnd = matchStart + normalizedKeyword.length;
    parts.push({
      matchIndex: takeMatchIndex(),
      text: token.text.slice(matchStart, matchEnd),
      type: token.type,
    });
    start = matchEnd;
  }
  return parts.length > 0 ? parts : [token];
}

// collectConfigYamlMatches 汇总当前 YAML 行中的搜索命中位置。
function collectConfigYamlMatches(
  lines: ConfigYamlLine[],
): ConfigYamlSearchMatch[] {
  return lines.flatMap((line) =>
    line.matchIndexes.map((matchIndex) => ({
      index: matchIndex,
      lineNo: line.no,
    })),
  );
}

// tokenizeConfigYamlLine 对单行 YAML 做轻量词法拆分，覆盖配置预览常见结构。
function tokenizeConfigYamlLine(line: string): ConfigYamlToken[] {
  const leading = line.match(/^\s*/)?.[0] || '';
  const rest = line.slice(leading.length);
  if (!rest) {
    return [{ text: leading || ' ', type: 'plain' }];
  }
  const tokens = leading ? [{ text: leading, type: 'plain' as const }] : [];
  if (rest.startsWith('#')) {
    return [...tokens, { text: rest, type: 'comment' }];
  }
  if (rest.startsWith('- ')) {
    return [
      ...tokens,
      { text: '- ', type: 'punctuation' },
      ...tokenizeConfigYamlContent(rest.slice(2)),
    ];
  }
  return [...tokens, ...tokenizeConfigYamlContent(rest)];
}

// tokenizeConfigYamlContent 识别 key/value 或普通值。
function tokenizeConfigYamlContent(content: string): ConfigYamlToken[] {
  const colonIndex = findConfigYamlKeyColon(content);
  if (colonIndex < 0) {
    return tokenizeConfigYamlValue(content);
  }

  const keyText = content.slice(0, colonIndex);
  const valueText = content.slice(colonIndex + 1);
  const keyTrailing = keyText.match(/\s*$/)?.[0] || '';
  const keyName = keyText.slice(0, keyText.length - keyTrailing.length);
  const tokens: ConfigYamlToken[] = [];
  if (keyName) {
    tokens.push({ text: keyName, type: 'key' });
  }
  if (keyTrailing) {
    tokens.push({ text: keyTrailing, type: 'plain' });
  }
  tokens.push({ text: ':', type: 'punctuation' });
  return [...tokens, ...tokenizeConfigYamlValue(valueText)];
}

// findConfigYamlKeyColon 查找未被引号包裹的 key 分隔冒号。
function findConfigYamlKeyColon(content: string): number {
  let quote: null | string = null;
  for (let index = 0; index < content.length; index += 1) {
    const current = content[index];
    const previous = content[index - 1];
    if (quote) {
      if (current === quote && previous !== '\\') {
        quote = null;
      }
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (
      current === ':' &&
      (index === content.length - 1 || /\s/.test(content[index + 1] || ''))
    ) {
      return index;
    }
  }
  return -1;
}

// tokenizeConfigYamlValue 标记 YAML 标量值；敏感值仍来自后端脱敏结果。
function tokenizeConfigYamlValue(valueText: string): ConfigYamlToken[] {
  if (!valueText) {
    return [];
  }
  const leading = valueText.match(/^\s*/)?.[0] || '';
  const body = valueText.slice(leading.length);
  const tokens: ConfigYamlToken[] = leading
    ? [{ text: leading, type: 'plain' }]
    : [];
  if (!body) {
    return tokens;
  }
  if (body.startsWith('#')) {
    return [...tokens, { text: body, type: 'comment' }];
  }

  const commentIndex = findConfigYamlInlineComment(body);
  const valuePart = commentIndex >= 0 ? body.slice(0, commentIndex) : body;
  const commentPart = commentIndex >= 0 ? body.slice(commentIndex) : '';
  const valueTrailing = valuePart.match(/\s*$/)?.[0] || '';
  const valueCore = valuePart.slice(0, valuePart.length - valueTrailing.length);

  if (valueCore) {
    tokens.push({ text: valueCore, type: configYamlValueType(valueCore) });
  }
  if (valueTrailing) {
    tokens.push({ text: valueTrailing, type: 'plain' });
  }
  if (commentPart) {
    tokens.push({ text: commentPart, type: 'comment' });
  }
  return tokens;
}

// findConfigYamlInlineComment 查找值后的行内注释起点。
function findConfigYamlInlineComment(text: string): number {
  let quote: null | string = null;
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const previous = text[index - 1];
    if (quote) {
      if (current === quote && previous !== '\\') {
        quote = null;
      }
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (current === '#' && (index === 0 || /\s/.test(previous || ''))) {
      return index;
    }
  }
  return -1;
}

// configYamlValueType 返回 YAML 标量值对应的高亮类型。
function configYamlValueType(value: string): ConfigYamlTokenType {
  const trimmed = value.trim();
  if (/^(false|true)$/i.test(trimmed)) {
    return 'boolean';
  }
  if (/^(null|~)$/i.test(trimmed)) {
    return 'null';
  }
  if (/^[-+]?\d+(?:\.\d+)?$/.test(trimmed)) {
    return 'number';
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return 'string';
  }
  if (
    trimmed === '[' ||
    trimmed === ']' ||
    trimmed === '{' ||
    trimmed === '}'
  ) {
    return 'punctuation';
  }
  return 'string';
}

// configYamlContainsSearch 判断指定 YAML 是否包含当前搜索词。
function configYamlContainsSearch(yamlText: string, keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return false;
  }
  return String(yamlText || '')
    .toLowerCase()
    .includes(normalizedKeyword);
}

// resolveConfigYamlViewMode 搜索后优先停留在含命中的 YAML 视图。
function resolveConfigYamlViewMode(
  result: TaskApi.TaskConfigItemQueryResp,
  keyword: string,
  currentMode: ConfigYamlViewMode,
): ConfigYamlViewMode {
  const currentYaml =
    currentMode === 'runtime' ? result.runtimeYaml : result.snapshotYaml;
  if (configYamlContainsSearch(currentYaml, keyword)) {
    return currentMode;
  }
  if (configYamlContainsSearch(result.runtimeYaml, keyword)) {
    return 'runtime';
  }
  if (configYamlContainsSearch(result.snapshotYaml, keyword)) {
    return 'snapshot';
  }
  return result.runtimeYaml ? 'runtime' : 'snapshot';
}

// activateConfigYamlSearch 定位到当前 YAML 的第一个搜索命中。
function activateConfigYamlSearch() {
  configYamlMatchIndex.value = 0;
  queueScrollToConfigYamlMatch();
}

// queueScrollToConfigYamlMatch 等待 DOM 刷新后滚动到当前命中。
function queueScrollToConfigYamlMatch() {
  void nextTick(scrollToConfigYamlMatch);
}

// scrollToConfigYamlMatch 将当前命中滚动到 YAML 可视区域中部。
function scrollToConfigYamlMatch() {
  if (
    activeConfigItemViewMode.value !== 'yaml' ||
    !activeConfigSearchKeyword.value ||
    activeConfigYamlMatchTotal.value <= 0
  ) {
    return;
  }
  const matchElement = configYamlViewRef.value?.querySelector<HTMLElement>(
    `[data-config-match-index="${configYamlMatchIndex.value}"]`,
  );
  matchElement?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest',
  });
}

// handleConfigYamlMatchJump 循环切换 YAML 搜索的上一个或下一个命中。
function handleConfigYamlMatchJump(step: number) {
  const total = activeConfigYamlMatchTotal.value;
  if (total <= 0) {
    return;
  }
  configYamlMatchIndex.value =
    (configYamlMatchIndex.value + step + total) % total;
  queueScrollToConfigYamlMatch();
}

// handleFetchConfigReloadStatus 查询配置热加载状态。
async function handleFetchConfigReloadStatus() {
  submitting.value = true;
  try {
    const responseData = await fetchConfigReloadStatus();
    configReloadStatus.value = responseData;
    configReloadStatusText.value = safePrettyJson(responseData);
    message.success($t('business.message.configHotReloadStatusQueried'));
  } catch (error) {
    const errorMessage = await resolveRequestErrorMessage(error);
    configReloadStatus.value = null;
    configReloadStatusText.value = $t('business.message.queryFailed', [
      errorMessage,
    ]);
  } finally {
    submitting.value = false;
  }
}

// handleRunConfigReload 手动触发配置热加载。
async function handleRunConfigReload() {
  submitting.value = true;
  try {
    const responseData = await runConfigReload();
    configReloadStatus.value = responseData;
    configReloadStatusText.value = safePrettyJson(responseData);
    if (configItemsLoaded.value && canQueryConfigItems.value) {
      await handleFetchConfigItems(false, false);
    }
    message.success($t('business.message.configHotReloadExecuted'));
  } catch (error) {
    const errorMessage = await resolveRequestErrorMessage(error);
    configReloadStatus.value = null;
    configReloadStatusText.value = $t('business.message.runFailed', [
      errorMessage,
    ]);
  } finally {
    submitting.value = false;
  }
}

// handleFetchAPIRuntimeConfigReloadStatus 查询 API 服务配置热加载状态。
async function handleFetchAPIRuntimeConfigReloadStatus() {
  apiRuntimeSubmitting.value = true;
  try {
    const responseData = await fetchAPIRuntimeConfigReloadStatus();
    apiRuntimeStatus.value = responseData;
    apiRuntimeStatusText.value = safePrettyJson(responseData);
    message.success($t('business.message.apiConfigHotReloadStatusQueried'));
  } catch (error) {
    const errorMessage = await resolveRequestErrorMessage(error);
    apiRuntimeStatus.value = null;
    apiRuntimeStatusText.value = $t('business.message.queryFailed', [
      errorMessage,
    ]);
  } finally {
    apiRuntimeSubmitting.value = false;
  }
}

// handleRunAPIRuntimeConfigReload 手动触发 API 服务配置热加载。
async function handleRunAPIRuntimeConfigReload() {
  apiRuntimeSubmitting.value = true;
  try {
    const responseData = await submitWithMfaRetry(
      MFA_SCENARIO_API_RUNTIME_MANAGE,
      (ticket) => runAPIRuntimeConfigReload(ticketPayload(ticket)),
      $t('business.message.triggerApiHotReloadMfaTitle'),
    );
    apiRuntimeStatus.value = responseData;
    apiRuntimeStatusText.value = safePrettyJson(responseData);
    if (
      apiConfigItemsLoaded.value &&
      canQueryAPIRuntimeConfigReloadItems.value
    ) {
      await handleFetchAPIConfigItems(false, false);
    }
    message.success($t('business.message.apiConfigHotReloadExecuted'));
  } catch (error) {
    const errorMessage = await resolveRequestErrorMessage(error);
    apiRuntimeStatus.value = null;
    apiRuntimeStatusText.value = $t('business.message.runFailed', [
      errorMessage,
    ]);
  } finally {
    apiRuntimeSubmitting.value = false;
  }
}

// handleFetchAPIConfigItems 查询 API 当前运行态配置项。
async function handleFetchAPIConfigItems(resetPage = true, showToast = true) {
  if (!canQueryAPIRuntimeConfigReloadItems.value) {
    return;
  }
  if (resetPage) {
    apiConfigItemPage.value = 1;
  }
  apiConfigItemsLoading.value = true;
  const searchKeyword = apiConfigItemKeyword.value.trim();
  try {
    const responseData = await fetchAPIRuntimeConfigReloadItems({
      keyword: searchKeyword,
      page: apiConfigItemPage.value,
      pageSize: apiConfigItemPageSize.value,
      sensitiveOnly: apiConfigItemSensitiveOnly.value,
    });
    if (!responseData.connected || !responseData.items) {
      apiConfigItemResult.value = null;
      apiConfigItems.value = [];
      apiConfigItemTotal.value = 0;
      apiConfigItemSearchKeyword.value = '';
      apiConfigItemsLoaded.value = true;
      message.warning(responseData.message || '-');
      return;
    }
    const firstLoad = !apiConfigItemsLoaded.value;
    const itemsResult = responseData.items;
    apiConfigItemResult.value = itemsResult;
    apiConfigItems.value = itemsResult.items || [];
    apiConfigItemTotal.value = Number(itemsResult.total || 0);
    apiConfigItemPage.value = Number(itemsResult.page || 1);
    apiConfigItemPageSize.value = Number(itemsResult.pageSize || 20);
    apiConfigItemSearchKeyword.value = String(
      itemsResult.keyword || searchKeyword,
    ).trim();
    apiConfigItemsLoaded.value = true;
    if (firstLoad) {
      apiConfigItemViewMode.value = 'yaml';
      apiConfigYamlViewMode.value = resolveConfigYamlViewMode(
        itemsResult,
        apiConfigItemSearchKeyword.value,
        apiConfigYamlViewMode.value,
      );
    } else if (
      !itemsResult.runtimeYaml &&
      apiConfigYamlViewMode.value === 'runtime'
    ) {
      apiConfigYamlViewMode.value = 'snapshot';
    } else if (apiConfigItemSearchKeyword.value) {
      apiConfigItemViewMode.value = 'yaml';
      apiConfigYamlViewMode.value = resolveConfigYamlViewMode(
        itemsResult,
        apiConfigItemSearchKeyword.value,
        apiConfigYamlViewMode.value,
      );
    }
    if (apiConfigItemSearchKeyword.value) {
      activateConfigYamlSearch();
    }
    if (showToast) {
      message.success($t('business.message.configItemsQueried'));
    }
  } catch (error) {
    const errorMessage = await resolveRequestErrorMessage(error);
    apiConfigItemResult.value = null;
    apiConfigItems.value = [];
    apiConfigItemTotal.value = 0;
    apiConfigItemSearchKeyword.value = '';
    message.error($t('business.message.queryFailed', [errorMessage]));
  } finally {
    apiConfigItemsLoading.value = false;
  }
}

// handleFetchConfigItems 查询当前运行态配置项；后端只返回脱敏后的展示值。
async function handleFetchConfigItems(resetPage = true, showToast = true) {
  if (!canQueryConfigItems.value) {
    return;
  }
  if (resetPage) {
    configItemPage.value = 1;
  }
  configItemsLoading.value = true;
  const searchKeyword = configItemKeyword.value.trim();
  try {
    const responseData = await fetchConfigReloadItems({
      keyword: searchKeyword,
      page: configItemPage.value,
      pageSize: configItemPageSize.value,
      sensitiveOnly: configItemSensitiveOnly.value,
    });
    const firstLoad = !configItemsLoaded.value;
    configItemResult.value = responseData;
    configItems.value = responseData.items || [];
    configItemTotal.value = Number(responseData.total || 0);
    configItemPage.value = Number(responseData.page || 1);
    configItemPageSize.value = Number(responseData.pageSize || 20);
    configItemSearchKeyword.value = String(
      responseData.keyword || searchKeyword,
    ).trim();
    configItemsLoaded.value = true;
    if (firstLoad) {
      configItemViewMode.value = 'yaml';
      configYamlViewMode.value = resolveConfigYamlViewMode(
        responseData,
        configItemSearchKeyword.value,
        configYamlViewMode.value,
      );
    } else if (
      !responseData.runtimeYaml &&
      configYamlViewMode.value === 'runtime'
    ) {
      configYamlViewMode.value = 'snapshot';
    } else if (configItemSearchKeyword.value) {
      configItemViewMode.value = 'yaml';
      configYamlViewMode.value = resolveConfigYamlViewMode(
        responseData,
        configItemSearchKeyword.value,
        configYamlViewMode.value,
      );
    }
    if (configItemSearchKeyword.value) {
      activateConfigYamlSearch();
    }
    if (showToast) {
      message.success($t('business.message.configItemsQueried'));
    }
  } catch (error) {
    const errorMessage = await resolveRequestErrorMessage(error);
    configItemResult.value = null;
    configItems.value = [];
    configItemTotal.value = 0;
    configItemSearchKeyword.value = '';
    message.error($t('business.message.queryFailed', [errorMessage]));
  } finally {
    configItemsLoading.value = false;
  }
}

// handleConfigItemTableChange 同步分页变化后重新查询当前筛选条件。
function handleConfigItemTableChange(pagination: ConfigItemTablePagination) {
  configItemPage.value = Number(pagination.current || 1);
  configItemPageSize.value = Number(pagination.pageSize || 20);
  void handleFetchConfigItems(false, false);
}

// handleAPIConfigItemTableChange 同步 API 配置项分页变化后重新查询。
function handleAPIConfigItemTableChange(pagination: ConfigItemTablePagination) {
  apiConfigItemPage.value = Number(pagination.current || 1);
  apiConfigItemPageSize.value = Number(pagination.pageSize || 20);
  void handleFetchAPIConfigItems(false, false);
}

// handleFetchActiveConfigItems 根据当前 Tab 查询对应进程的运行态配置项。
function handleFetchActiveConfigItems(resetPage = true, showToast = true) {
  if (activeReloadTab.value === 'api') {
    return handleFetchAPIConfigItems(resetPage, showToast);
  }
  return handleFetchConfigItems(resetPage, showToast);
}

// handleActiveConfigItemTableChange 根据当前 Tab 同步配置项分页。
function handleActiveConfigItemTableChange(
  pagination: ConfigItemTablePagination,
) {
  if (activeReloadTab.value === 'api') {
    handleAPIConfigItemTableChange(pagination);
    return;
  }
  handleConfigItemTableChange(pagination);
}

// handleCopyConfigYaml 复制当前选中的脱敏 YAML，便于排障时保留可读快照。
async function handleCopyConfigYaml() {
  await copyTextToClipboard(
    activeConfigYaml.value,
    $t('business.message.configYamlCopied'),
    $t('business.message.noConfigYamlToCopy'),
  );
}

// handleCopyAPIConfigYaml 复制 API 当前选中的脱敏 YAML。
async function handleCopyAPIConfigYaml() {
  await copyTextToClipboard(
    activeAPIConfigYaml.value,
    $t('business.message.configYamlCopied'),
    $t('business.message.noConfigYamlToCopy'),
  );
}

// handleCopyActiveConfigYaml 根据当前 Tab 复制对应进程的脱敏 YAML。
function handleCopyActiveConfigYaml() {
  if (activeReloadTab.value === 'api') {
    return handleCopyAPIConfigYaml();
  }
  return handleCopyConfigYaml();
}

// loadActiveReloadStatusOnce 按当前 Tab 首次进入时加载对应进程状态，避免打开页面同时请求后台与 API。
function loadActiveReloadStatusOnce() {
  if (activeReloadTab.value === 'api') {
    if (
      apiReloadStatusLoaded.value ||
      !canQueryAPIRuntimeConfigReloadStatus.value
    ) {
      return;
    }
    apiReloadStatusLoaded.value = true;
    void handleFetchAPIRuntimeConfigReloadStatus();
    return;
  }

  if (adminReloadStatusLoaded.value || !canQueryConfigReloadStatus.value) {
    return;
  }
  adminReloadStatusLoaded.value = true;
  void handleFetchConfigReloadStatus();
}

watch(activeConfigSearchKeyword, () => {
  configYamlMatchIndex.value = 0;
});

watch(activeConfigYamlMatchTotal, (total) => {
  if (total <= 0 || configYamlMatchIndex.value >= total) {
    configYamlMatchIndex.value = 0;
  }
});

watch(
  [activeReloadTab, activeConfigItemViewMode, activeConfigYamlViewMode],
  () => {
    queueScrollToConfigYamlMatch();
  },
  { flush: 'post' },
);

watch(
  [
    activeReloadTab,
    canQueryConfigReloadStatus,
    canQueryAPIRuntimeConfigReloadStatus,
  ],
  loadActiveReloadStatusOnce,
  { immediate: true },
);
</script>

<template>
  <Page :title="$t('business.message.configHotReload')">
    <div class="min-w-0 space-y-2">
      <Alert
        v-if="!canManageConfigReload"
        :message="$t('business.message.noConfigHotReloadPermission')"
        :description="$t('business.message.noConfigHotReloadPermissionDesc')"
        show-icon
        type="warning"
      />
      <Tabs v-model:active-key="activeReloadTab" class="config-reload-tabs">
        <Tabs.TabPane
          key="admin"
          :tab="$t('business.message.configHotReload')"
        />
        <Tabs.TabPane
          key="api"
          :tab="$t('business.message.apiConfigHotReload')"
        />
      </Tabs>
      <div class="mt-3 grid min-w-0 gap-2">
        <Card
          v-if="activeReloadTab === 'admin'"
          class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.configHotReload')"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div
              class="min-w-0 flex-1 text-sm leading-6 text-slate-500 dark:text-slate-300"
            >
              {{ $t('business.message.configHotReloadGuide') }}
            </div>
            <Space class="shrink-0" :size="8" wrap>
              <VbenButton
                v-access="
                  asActionPermission(
                    OPS_ACTION_PERMISSION_CODES.TASK_CONFIG_RELOAD_STATUS,
                  )
                "
                :disabled="submitting"
                @click="handleFetchConfigReloadStatus"
              >
                {{ $t('business.message.queryHotReloadStatus') }}
              </VbenButton>
              <VbenButton
                v-access="
                  asActionPermission(
                    OPS_ACTION_PERMISSION_CODES.TASK_CONFIG_RELOAD_RUN,
                  )
                "
                type="primary"
                :disabled="submitting"
                @click="handleRunConfigReload"
              >
                {{ $t('business.message.triggerHotReload') }}
              </VbenButton>
              <VbenButton
                v-if="configReloadStatusText"
                :disabled="submitting"
                @click="showConfigReloadRaw = !showConfigReloadRaw"
              >
                {{
                  showConfigReloadRaw
                    ? $t('business.message.closeRawReceipt')
                    : $t('business.message.viewRawReceipt')
                }}
              </VbenButton>
            </Space>
          </div>
          <div
            v-if="hotReloadDetailRows.length > 0"
            class="mt-4 overflow-hidden border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/30"
          >
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
              <div
                v-for="item in hotReloadDetailRows"
                :key="item.label"
                class="min-w-0 border-b border-slate-200 px-4 py-3 last:border-b-0 md:border-r md:[&:nth-child(2n)]:border-r-0 xl:[&:nth-child(2n)]:border-r xl:[&:nth-child(4n)]:border-r-0 dark:border-slate-700"
              >
                <div class="truncate text-xs font-medium text-slate-400">
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
                <Tooltip v-bind="buildOverflowTooltipProps(item.description)">
                  <div class="mt-2 truncate text-xs text-slate-500">
                    {{ item.description }}
                  </div>
                </Tooltip>
              </div>
            </div>
          </div>
          <JsonDetailViewer
            v-if="showConfigReloadRaw && configReloadStatusText"
            class="mt-4"
            :search-placeholder="
              $t('business.message.jsonDataSearchPlaceholder')
            "
            :value="configReloadStatusText"
          />
        </Card>

        <Card
          v-if="activeReloadTab === 'api'"
          class="min-w-0 border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="$t('business.message.apiConfigHotReload')"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div
              class="min-w-0 flex-1 text-sm leading-6 text-slate-500 dark:text-slate-300"
            >
              {{ $t('business.message.apiConfigHotReloadGuide') }}
            </div>
            <Space class="shrink-0" :size="8" wrap>
              <VbenButton
                v-access="
                  asActionPermission(
                    OPS_ACTION_PERMISSION_CODES.API_RUNTIME_CONFIG_RELOAD_STATUS,
                  )
                "
                :disabled="apiRuntimeSubmitting"
                @click="handleFetchAPIRuntimeConfigReloadStatus"
              >
                {{ $t('business.message.queryApiHotReloadStatus') }}
              </VbenButton>
              <VbenButton
                v-access="
                  asActionPermission(
                    OPS_ACTION_PERMISSION_CODES.API_RUNTIME_CONFIG_RELOAD_RUN,
                  )
                "
                type="primary"
                :disabled="apiRuntimeSubmitting"
                @click="handleRunAPIRuntimeConfigReload"
              >
                {{ $t('business.message.triggerApiHotReload') }}
              </VbenButton>
              <VbenButton
                v-if="apiRuntimeStatusText"
                :disabled="apiRuntimeSubmitting"
                @click="showAPIRuntimeRaw = !showAPIRuntimeRaw"
              >
                {{
                  showAPIRuntimeRaw
                    ? $t('business.message.closeRawReceipt')
                    : $t('business.message.viewRawReceipt')
                }}
              </VbenButton>
            </Space>
          </div>
          <div
            v-if="apiRuntimeDetailRows.length > 0"
            class="mt-4 overflow-hidden border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/30"
          >
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
              <div
                v-for="item in apiRuntimeDetailRows"
                :key="item.label"
                class="min-w-0 border-b border-slate-200 px-4 py-3 last:border-b-0 md:border-r md:[&:nth-child(2n)]:border-r-0 xl:[&:nth-child(2n)]:border-r xl:[&:nth-child(4n)]:border-r-0 dark:border-slate-700"
              >
                <div class="truncate text-xs font-medium text-slate-400">
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
                <Tooltip v-bind="buildOverflowTooltipProps(item.description)">
                  <div class="mt-2 truncate text-xs text-slate-500">
                    {{ item.description }}
                  </div>
                </Tooltip>
              </div>
            </div>
          </div>
          <JsonDetailViewer
            v-if="showAPIRuntimeRaw && apiRuntimeStatusText"
            class="mt-4"
            :search-placeholder="
              $t('business.message.jsonDataSearchPlaceholder')
            "
            :value="apiRuntimeStatusText"
          />
        </Card>

        <Card
          v-if="canQueryActiveConfigItems"
          class="border border-slate-200/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70"
          :title="activeConfigItemsTitle"
        >
          <template v-if="activeConfigItemsLoaded">
            <div
              class="overflow-hidden border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/30"
            >
              <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
                <div
                  v-for="item in activeConfigItemOverviewRows"
                  :key="item.label"
                  class="min-w-0 border-b border-slate-200 px-4 py-3 last:border-b-0 md:border-r md:[&:nth-child(2n)]:border-r-0 xl:[&:nth-child(2n)]:border-r xl:[&:nth-child(4n)]:border-r-0 dark:border-slate-700"
                >
                  <div class="truncate text-xs font-medium text-slate-500">
                    {{ item.label }}
                  </div>
                  <Tooltip
                    v-bind="buildOverflowTooltipProps(String(item.value))"
                  >
                    <div
                      class="mt-1 truncate text-base font-semibold text-slate-950 dark:text-slate-50"
                    >
                      {{ item.value }}
                    </div>
                  </Tooltip>
                  <Tooltip v-bind="buildOverflowTooltipProps(item.description)">
                    <div class="mt-1 truncate text-xs text-slate-400">
                      {{ item.description }}
                    </div>
                  </Tooltip>
                </div>
              </div>
            </div>

            <div
              class="mt-5 overflow-hidden border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-950/30"
            >
              <div
                class="border-b border-slate-200 px-4 py-3 text-xs font-medium text-slate-500 dark:border-slate-700"
              >
                {{ $t('business.message.configSourceMeta') }}
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
                <div
                  v-for="item in activeConfigItemSourceRows"
                  :key="item.label"
                  class="min-w-0 border-b border-slate-200 px-4 py-3 last:border-b-0 md:border-r md:[&:nth-child(2n)]:border-r-0 xl:[&:nth-child(2n)]:border-r xl:[&:nth-child(4n)]:border-r-0 dark:border-slate-700"
                >
                  <div class="truncate text-xs text-slate-400">
                    {{ item.label }}
                  </div>
                  <Tooltip
                    v-bind="buildOverflowTooltipProps(String(item.value))"
                  >
                    <div
                      class="mt-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200"
                    >
                      {{ item.value }}
                    </div>
                  </Tooltip>
                </div>
              </div>
            </div>

            <div
              v-if="activeConfigItemSections.length > 0"
              class="mt-5 border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/30"
            >
              <div class="mb-2 text-xs font-medium text-slate-500">
                {{ $t('business.message.configTopSections') }}
              </div>
              <div class="flex flex-wrap gap-2">
                <Tag
                  v-for="section in activeConfigItemSections"
                  :key="section.name"
                  :color="section.sensitiveTotal > 0 ? 'warning' : 'default'"
                >
                  {{ section.name }} · {{ section.total }} /
                  {{ section.sensitiveTotal }}
                </Tag>
              </div>
            </div>
          </template>

          <div
            class="config-query-panel flex flex-col gap-4 border border-slate-200 bg-slate-50/70 p-5 dark:border-slate-700 dark:bg-slate-950/30"
            :class="{ 'mt-5': activeConfigItemsLoaded }"
          >
            <div class="config-query-toolbar grid gap-4">
              <Input
                v-model:value="activeConfigItemKeyword"
                id="config-reload-item-search"
                name="config-reload-item-search"
                allow-clear
                autocomplete="off"
                class="config-query-input w-full"
                :maxlength="128"
                :placeholder="
                  $t('business.message.configItemSearchPlaceholder')
                "
                size="large"
                @press-enter="() => handleFetchActiveConfigItems(true)"
              />
              <div
                class="config-query-actions flex min-w-0 shrink-0 flex-col gap-3 sm:flex-row sm:items-center"
              >
                <Switch
                  v-model:checked="activeConfigItemSensitiveOnly"
                  class="config-query-switch"
                  :checked-children="$t('business.message.sensitiveOnly')"
                  :disabled="activeConfigItemsLoading"
                  :un-checked-children="$t('business.message.all')"
                  @change="() => handleFetchActiveConfigItems(true, false)"
                />
                <Button
                  class="config-query-button"
                  :disabled="activeConfigItemsLoading"
                  :loading="activeConfigItemsLoading"
                  size="large"
                  type="primary"
                  @click="handleFetchActiveConfigItems(true)"
                >
                  <template #icon>
                    <SearchOutlined />
                  </template>
                  {{ $t('business.message.searchConfigItems') }}
                </Button>
              </div>
            </div>

            <Alert
              v-if="!activeConfigItemsLoaded"
              class="config-query-alert"
              :message="activeConfigItemsGuide"
              show-icon
              type="info"
            />
          </div>

          <template v-if="activeConfigItemsLoaded">
            <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <Radio.Group
                  v-model:value="activeConfigItemViewMode"
                  button-style="solid"
                >
                  <Radio.Button value="yaml">
                    <FileTextOutlined />
                    {{ $t('business.message.yamlView') }}
                  </Radio.Button>
                  <Radio.Button value="table">
                    <TableOutlined />
                    {{ $t('business.message.tableView') }}
                  </Radio.Button>
                </Radio.Group>
                <Radio.Group
                  v-if="activeConfigItemViewMode === 'yaml'"
                  v-model:value="activeConfigYamlViewMode"
                  button-style="solid"
                >
                  <Radio.Button value="runtime" :disabled="!activeRuntimeYaml">
                    {{ $t('business.message.runtimeYamlView') }}
                  </Radio.Button>
                  <Radio.Button value="snapshot">
                    {{ $t('business.message.snapshotYamlView') }}
                  </Radio.Button>
                </Radio.Group>
              </div>
              <Space class="shrink-0" :size="8" wrap>
                <Space
                  v-if="
                    activeConfigItemViewMode === 'yaml' &&
                    activeConfigSearchKeyword
                  "
                  class="config-yaml-match-nav"
                  :size="6"
                >
                  <span class="config-yaml-match-count">
                    {{
                      $t('business.message.configMatchCounter', [
                        activeConfigYamlCurrentMatch,
                        activeConfigYamlMatchTotal,
                      ])
                    }}
                  </span>
                  <Tooltip :title="$t('business.message.previousConfigMatch')">
                    <Button
                      :aria-label="$t('business.message.previousConfigMatch')"
                      :disabled="activeConfigYamlMatchTotal <= 0"
                      @click="handleConfigYamlMatchJump(-1)"
                    >
                      <template #icon>
                        <ArrowUpOutlined />
                      </template>
                    </Button>
                  </Tooltip>
                  <Tooltip :title="$t('business.message.nextConfigMatch')">
                    <Button
                      :aria-label="$t('business.message.nextConfigMatch')"
                      :disabled="activeConfigYamlMatchTotal <= 0"
                      @click="handleConfigYamlMatchJump(1)"
                    >
                      <template #icon>
                        <ArrowDownOutlined />
                      </template>
                    </Button>
                  </Tooltip>
                </Space>
                <TreeExpandToolbar
                  v-if="activeConfigItemViewMode === 'yaml'"
                  :collapse-all-handler="collapseAllConfigYaml"
                  :collapse-level-handler="collapseConfigYamlLevel"
                  :disabled="activeConfigYamlFoldNodes.size === 0"
                  :expand-all-handler="expandAllConfigYaml"
                  :expand-level-handler="expandConfigYamlLevel"
                  :max-level="activeConfigYamlMaxLevel"
                />
                <Button
                  v-if="activeConfigItemViewMode === 'yaml'"
                  :disabled="!activeConfigYamlText"
                  @click="handleCopyActiveConfigYaml"
                >
                  <template #icon>
                    <CopyOutlined />
                  </template>
                  {{ $t('business.message.copyConfigYaml') }}
                </Button>
              </Space>
            </div>

            <div
              v-if="activeConfigItemViewMode === 'yaml'"
              ref="configYamlViewRef"
              :aria-label="$t('business.message.yamlView')"
              class="config-yaml-view mt-4 max-h-[640px] overflow-auto border border-border bg-card font-mono text-[13px] leading-5 shadow-inner dark:border-slate-700 dark:bg-slate-950"
              role="region"
            >
              <div
                v-if="activeConfigYamlVisibleLines.length > 0"
                class="min-w-max py-3"
              >
                <div
                  v-for="line in activeConfigYamlVisibleLines"
                  :key="line.no"
                  class="config-yaml-line grid min-w-max"
                  :class="{
                    'config-yaml-line-current':
                      line.matchIndexes.includes(configYamlMatchIndex),
                  }"
                >
                  <span
                    class="config-yaml-line-no sticky left-0 select-none border-r border-border bg-card px-3 text-right text-muted-foreground dark:border-slate-800 dark:bg-slate-950 dark:text-slate-500"
                  >
                    {{ line.no }}
                  </span>
                  <button
                    v-if="line.foldable"
                    :aria-label="
                      line.collapsed
                        ? $t('business.message.expand')
                        : $t('business.message.collapse')
                    "
                    class="config-yaml-fold-toggle"
                    type="button"
                    @click="toggleConfigYamlFold(line.no)"
                  >
                    <CaretRightOutlined v-if="line.collapsed" />
                    <CaretDownOutlined v-else />
                  </button>
                  <span
                    v-else
                    aria-hidden="true"
                    class="config-yaml-fold-placeholder"
                  ></span>
                  <code class="whitespace-pre px-3">
                    <span
                      v-for="(token, tokenIndex) in line.tokens"
                      :key="`${line.no}-${tokenIndex}`"
                      :class="[
                        configYamlTokenClassMap[token.type],
                        typeof token.matchIndex === 'number'
                          ? 'config-yaml-match'
                          : '',
                        token.matchIndex === configYamlMatchIndex
                          ? 'config-yaml-match-current'
                          : '',
                      ]"
                      :data-config-match-index="token.matchIndex"
                    >
                      {{ token.text }}
                    </span>
                  </code>
                </div>
              </div>
              <div v-else class="px-4 py-4 text-muted-foreground">-</div>
            </div>

            <Table
              v-else
              class="mt-4"
              :columns="configItemColumns"
              :data-source="activeConfigTableItems"
              :loading="activeConfigItemsLoading"
              :pagination="{
                current: activeConfigItemPage,
                pageSize: activeConfigItemPageSize,
                showSizeChanger: true,
                total: activeConfigItemTotal,
              }"
              :scroll="{ x: 960 }"
              row-key="path"
              size="small"
              @change="handleActiveConfigItemTableChange"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'path'">
                  <Tooltip
                    v-bind="
                      buildOverflowTooltipProps(String(record.path || '-'))
                    "
                  >
                    <span
                      class="block max-w-full truncate font-mono text-xs text-slate-700 dark:text-slate-200"
                    >
                      {{ record.path || '-' }}
                    </span>
                  </Tooltip>
                </template>
                <template v-else-if="column.key === 'value'">
                  <Tooltip
                    v-bind="
                      buildOverflowTooltipProps(String(record.value || '-'))
                    "
                  >
                    <span
                      class="block max-w-full truncate font-mono text-xs"
                      :class="
                        record.sensitive
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-slate-700 dark:text-slate-200'
                      "
                    >
                      {{ record.value || '-' }}
                    </span>
                  </Tooltip>
                </template>
                <template v-else-if="column.key === 'valueType'">
                  <Tag color="processing">
                    {{ record.valueType || '-' }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'sensitive'">
                  <Tag :color="record.sensitive ? 'warning' : 'default'">
                    {{
                      record.sensitive
                        ? $t('business.message.masked')
                        : $t('business.message.plain')
                    }}
                  </Tag>
                </template>
              </template>
            </Table>
          </template>
        </Card>
      </div>
    </div>
  </Page>
</template>

<style scoped>
.config-query-panel {
  border-radius: 8px;
}

.config-reload-tabs {
  padding: 0 12px;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}

.config-reload-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 0;
}

.config-query-alert {
  border-radius: 8px;
}

.config-yaml-match-nav {
  min-height: 24px;
}

.config-yaml-match-count {
  min-width: 72px;
  font-size: 12px;
  color: #64748b;
  text-align: center;
}

.config-query-button {
  min-width: 136px;
  height: 44px;
}

.config-query-toolbar {
  grid-template-columns: minmax(0, 1fr);
}

.config-query-actions {
  justify-self: start;
}

:deep(.config-query-input.ant-input),
:deep(.config-query-input.ant-input-affix-wrapper) {
  min-height: 44px;
}

:deep(.config-query-switch.ant-switch) {
  min-width: 116px;
  height: 44px;
  line-height: 44px;
}

:deep(.config-query-switch.ant-switch .ant-switch-handle) {
  inset-inline-start: 4px;
  top: 4px;
  width: 36px;
  height: 36px;
}

:deep(.config-query-switch.ant-switch .ant-switch-handle::before) {
  border-radius: 50%;
}

:deep(.config-query-switch.ant-switch.ant-switch-checked .ant-switch-handle) {
  inset-inline-start: calc(100% - 40px);
}

:deep(.config-query-switch.ant-switch .ant-switch-inner) {
  display: grid;
  place-items: center;
  height: 100%;
  padding-inline: 46px 14px;
}

:deep(.config-query-switch.ant-switch.ant-switch-checked .ant-switch-inner) {
  padding-inline: 14px 46px;
}

:deep(.config-query-switch.ant-switch .ant-switch-inner-checked),
:deep(.config-query-switch.ant-switch .ant-switch-inner-unchecked) {
  grid-area: 1 / 1;
  height: auto;
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
}

:deep(
  .config-query-switch.ant-switch:not(.ant-switch-checked)
    .ant-switch-inner-checked
) {
  display: none;
}

:deep(
  .config-query-switch.ant-switch.ant-switch-checked .ant-switch-inner-unchecked
) {
  display: none;
}

@media (min-width: 900px) {
  .config-query-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .config-query-actions {
    justify-self: end;
  }
}

/* 浅色语法色使用深色阶保证白底可读，暗色主题沿用原有代码配色。 */
.config-yaml-view {
  color: hsl(var(--foreground));
}

:is(.dark .config-yaml-view) {
  color: #dbeafe;
}

.config-yaml-line {
  grid-template-columns: 3.25rem 1.5rem minmax(0, 1fr);
}

.config-yaml-line:hover {
  background: hsl(var(--primary) / 6%);
}

:is(.dark .config-yaml-line:hover) {
  background: rgb(30 64 175 / 16%);
}

.config-yaml-line-current {
  background: hsl(var(--primary) / 12%);
}

:is(.dark .config-yaml-line-current) {
  background: rgb(30 64 175 / 28%);
}

.config-yaml-line-no {
  z-index: 1;
  font-variant-numeric: tabular-nums;
}

.config-yaml-fold-toggle,
.config-yaml-fold-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
}

.config-yaml-fold-toggle {
  color: rgb(100 116 139);
  cursor: pointer;
}

.config-yaml-fold-toggle:hover {
  color: rgb(37 99 235);
}

:is(.dark .config-yaml-fold-toggle) {
  color: rgb(148 163 184);
}

:is(.dark .config-yaml-fold-toggle:hover) {
  color: rgb(96 165 250);
}

.config-yaml-token-key {
  font-weight: 600;
  color: #0369a1;
}

:is(.dark .config-yaml-token-key) {
  color: #7dd3fc;
}

.config-yaml-token-punctuation {
  color: #64748b;
}

:is(.dark .config-yaml-token-punctuation) {
  color: #94a3b8;
}

.config-yaml-token-string {
  color: #047857;
}

:is(.dark .config-yaml-token-string) {
  color: #a7f3d0;
}

.config-yaml-token-number {
  color: #b45309;
}

:is(.dark .config-yaml-token-number) {
  color: #fbbf24;
}

.config-yaml-token-boolean {
  color: #6d28d9;
}

:is(.dark .config-yaml-token-boolean) {
  color: #c4b5fd;
}

.config-yaml-token-null {
  color: #b91c1c;
}

:is(.dark .config-yaml-token-null) {
  color: #fca5a5;
}

.config-yaml-token-comment {
  font-style: italic;
  color: #64748b;
}

.config-yaml-token-plain {
  color: #334155;
}

:is(.dark .config-yaml-token-plain) {
  color: #cbd5e1;
}

/* 搜索命中覆盖语法颜色，避免不同 token 在同一高亮底色上对比度不一致。 */
.config-yaml-view .config-yaml-match {
  padding: 0 2px;
  color: #92400e;
  background: #fef3c7;
  border-radius: 3px;
}

:is(.dark .config-yaml-view) .config-yaml-match {
  color: #fef3c7;
  background: rgb(180 83 9 / 55%);
}

.config-yaml-view .config-yaml-match-current,
:is(.dark .config-yaml-view) .config-yaml-match-current {
  color: #111827;
  background: #fde047;
  box-shadow: 0 0 0 1px rgb(253 224 71 / 60%);
}
</style>
