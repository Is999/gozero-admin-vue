import type { CommonApi } from '#/api/common';

import { requestClient } from '#/api/request';

// RuntimeConfigApi 定义运行期大列表配置管理接口契约。
export namespace RuntimeConfigApi {
  /** 当前 active 版本状态 */
  export interface StateItem {
    /** 当前发布 ID */
    activeReleaseId: number;
    /** 当前版本号 */
    activeVersion: number;
    /** 当前快照 SHA256 */
    activeChecksum: string;
    /** 最近发布时间 */
    publishedAt: string;
  }

  /** 草稿数量 */
  export interface DraftCount {
    /** 周期任务草稿数量 */
    periodicTasks: number;
    /** 归档任务草稿数量 */
    archiveJobs: number;
  }

  /** 发布快照展示结构 */
  export interface Snapshot {
    /** 归档任务配置 */
    archiveJobs: ArchiveJobItem[];
    /** 周期任务配置 */
    taskPeriodic: PeriodicTaskItem[];
  }

  /** 概览响应 */
  export interface OverviewResp {
    /** 配置来源：file/database */
    source: 'database' | 'file' | string;
    /** DB 模式轻量轮询间隔秒数 */
    pollIntervalSeconds: number;
    /** 当前 active 版本状态 */
    state: StateItem;
    /** 草稿数量 */
    draft: DraftCount;
    /** includeSnapshots=true 时返回当前运行态快照，否则为空列表 */
    currentSnapshot: Snapshot;
    /** includeSnapshots=true 时返回当前全量草稿快照，否则为空列表 */
    draftSnapshot: Snapshot;
    /** 草稿快照 SHA256 */
    draftChecksum: string;
    /** 草稿快照是否不同于当前 active 快照 */
    draftChanged: boolean;
  }

  /** 运行配置概览查询参数 */
  export interface OverviewQueryReq {
    /** 是否返回最多各一万条的 active 与草稿全量快照 */
    includeSnapshots?: boolean;
  }

  /** 周期任务查询参数 */
  export interface PeriodicQueryReq {
    /** 当前页码 */
    page?: number;
    /** 每页数量 */
    pageSize?: number;
    /** 工作流过滤 */
    workflow?: string;
    /** 启用状态过滤 */
    enabled?: boolean;
    /** 名称或队列关键字 */
    keyword?: string;
  }

  /** 周期任务配置项 */
  export interface PeriodicTaskItem {
    /** 草稿 ID */
    id?: number;
    /** 是否启用 */
    enabled: boolean;
    /** 周期任务名称 */
    name: string;
    /** cron 表达式 */
    cron?: string;
    /** 固定间隔秒数 */
    everySeconds?: number;
    /** 工作流名称 */
    workflow: string;
    /** 投递队列 */
    queue?: string;
    /** 执行目标列表 */
    targets?: string[];
    /** 分片总数 */
    shardTotal?: number;
    /** 灰度比例 */
    grayPercent?: number;
    /** 覆盖重试次数 */
    retry?: number;
    /** 任务超时秒数 */
    timeoutSeconds?: number;
    /** 截止时间 */
    deadline?: string;
    /** 去重键 */
    uniqueKey?: string;
    /** 去重 TTL 秒数 */
    uniqueTtlSeconds?: number;
    /** 排序值 */
    sortOrder?: number;
    /** 备注 */
    remark?: string;
    /** 创建时间 */
    createdAt?: string;
    /** 更新时间 */
    updatedAt?: string;
  }

  /** 归档任务查询参数 */
  export interface ArchiveQueryReq {
    /** 当前页码 */
    page?: number;
    /** 每页数量 */
    pageSize?: number;
    /** 启用状态过滤 */
    enabled?: boolean;
    /** 数据库过滤 */
    database?: string;
    /** 名称或表名关键字 */
    keyword?: string;
  }

  /** 归档任务配置项 */
  export interface ArchiveJobItem {
    /** 草稿 ID */
    id?: number;
    /** 是否启用 */
    enabled: boolean;
    /** 归档任务名称 */
    name: string;
    /** 热表数据库 */
    database: string;
    /** 热表名 */
    tableName: string;
    /** 归档时间列 */
    timeColumn?: string;
    /** 时间列类型 */
    timeColumnType?: string;
    /** 字符串时间格式 */
    timeColumnFormat?: string;
    /** Unix 时间单位 */
    timeColumnUnixUnit?: string;
    /** 主键列 */
    primaryKey?: string;
    /** 归档过滤条件 */
    archiveCondition?: string;
    /** 清理过滤条件 */
    deleteCondition?: string;
    /** 历史表拆分粒度 */
    splitUnit?: string;
    /** 自定义分段天数 */
    customDays?: number;
    /** 热表保留天数 */
    hotKeepDays?: number;
    /** 归档延迟天数 */
    archiveDelayDays?: number;
    /** 归档窗口秒数 */
    archiveWindowSeconds?: number;
    /** 归档窗口模式 */
    archiveWindowMode?: string;
    /** 单次最大归档窗口数 */
    archiveMaxWindowsPerRun?: number;
    /** auto 最大追赶窗口数 */
    archiveAutoMaxWindows?: number;
    /** auto 轻量行数阈值 */
    archiveAutoLightRows?: number;
    /** auto 轻量耗时阈值毫秒 */
    archiveAutoLightMs?: number;
    /** 是否禁用删除 */
    deleteDisabled?: boolean;
    /** 删除延迟天数 */
    deleteDelayDays?: number;
    /** 删除窗口秒数 */
    deleteWindowSeconds?: number;
    /** 单次最大删除窗口数 */
    deleteMaxWindowsPerRun?: number;
    /** 归档批次大小 */
    batchSize?: number;
    /** 删除批次大小 */
    deleteBatchSize?: number;
    /** 最大历史表数量 */
    maxHistoryTables?: number;
    /** 历史表前缀 */
    historyTablePrefix?: string;
    /** 历史表命名规则 */
    historyTableNameRule?: string;
    /** 首次归档起点 */
    startAt?: string;
    /** 查询是否强制走主库 */
    queryWriteDb?: boolean;
    /** 排序值 */
    sortOrder?: number;
    /** 备注 */
    remark?: string;
    /** 创建时间 */
    createdAt?: string;
    /** 更新时间 */
    updatedAt?: string;
  }

  /** 归档区间状态数量 */
  export interface ArchiveProgressCounts {
    /** 区间总数 */
    total: number;
    /** 待领取区间数 */
    pending: number;
    /** 正在归档区间数 */
    running: number;
    /** 已归档待删除区间数 */
    done: number;
    /** 正在删除区间数 */
    deleting: number;
    /** 已完成热表删除区间数 */
    deleted: number;
    /** 归档失败待重试区间数 */
    failed: number;
  }

  /** 归档任务当前执行阶段 */
  export type ArchiveProgressPhase =
    | 'caught_up'
    | 'deleting'
    | 'failed'
    | 'idle'
    | 'inactive'
    | 'lease_expired'
    | 'not_started'
    | 'pending'
    | 'running'
    | 'waiting_delete';

  /** 单个归档区间执行详情 */
  export interface ArchiveSegmentItem {
    /** 区间 ID */
    id: number;
    /** 历史表名 */
    historyTableName: string;
    /** 区间起点（含） */
    rangeStart: string;
    /** 区间终点（不含） */
    rangeEnd: string;
    /** 区间状态 */
    status: string;
    /** 当前持有 worker */
    workerId: string;
    /** 当前租约过期时间 */
    leaseExpiresAt: string;
    /** 最近归档主键游标 */
    lastArchivedId: string;
    /** 最近归档时间游标 */
    lastArchivedTime: string;
    /** 累计归档行数 */
    rowsArchived: number;
    /** 领取次数 */
    attemptCount: number;
    /** 最近更新时间 */
    updatedAt: string;
    /** 归档完成时间 */
    completedAt: string;
    /** 复制阶段按时间游标估算的区间进度百分比 */
    estimatedProgressPercent: null | number;
  }

  /** 归档任务执行详情 */
  export interface ArchiveProgressResp {
    /** 归档任务草稿 ID */
    jobId: number;
    /** 归档任务名 */
    jobName: string;
    /** 当前运行态是否存在同名任务 */
    runtimeMatched: boolean;
    /** 当前运行态归档模块和同名任务是否均已启用 */
    runtimeEnabled: boolean;
    /** 归档水位表和区间表是否均已创建 */
    schemaReady: boolean;
    /** 当前执行阶段 */
    phase: ArchiveProgressPhase;
    /** 已完整复制到历史表的排他上界 */
    watermarkTime: string;
    /** 水位最近更新时间 */
    watermarkUpdatedAt: string;
    /** 当前允许归档到的排他上界 */
    eligibleUntil: string;
    /** 已规划区间的最远排他上界 */
    plannedUntil: string;
    /** 有可靠基线时的滞后秒数 */
    lagSeconds: null | number;
    /** 各区间状态数量 */
    counts: ArchiveProgressCounts;
    /** 当前活动或最近租约过期的执行区间 */
    currentSegment: ArchiveSegmentItem | null;
    /** 最近区间，按起点倒序排列 */
    recentSegments: ArchiveSegmentItem[];
    /** 本次运行态快照生成时间 */
    fetchedAt: string;
  }

  /** 预检结果 */
  export interface ValidateResp {
    /** 是否通过预检 */
    valid: boolean;
    /** 预检信息列表 */
    messages: string[];
    /** 草稿快照 SHA256 */
    checksum: string;
  }

  /** 发布和回滚回执 */
  export interface PublishResp {
    /** 新发布 ID */
    releaseId: number;
    /** 新版本号 */
    versionNo: number;
    /** 快照 SHA256 */
    checksum: string;
    /** 当前实例是否已完成运行态应用 */
    applied: boolean;
    /** 是否需要重启完全生效 */
    restartRequired: boolean;
    /** 重启原因 */
    restartReason: string;
  }

  /** 发布请求 */
  export interface PublishReq extends CommonApi.TwoStepReq {
    /** 发布备注 */
    remark?: string;
  }

  /** 回滚请求 */
  export interface RollbackReq extends CommonApi.TwoStepReq {
    /** 目标发布 ID */
    releaseId: number;
    /** 回滚备注 */
    remark?: string;
  }

  /** 发布历史查询参数 */
  export interface ReleaseQueryReq {
    /** 当前页码 */
    page?: number;
    /** 每页数量 */
    pageSize?: number;
  }

  /** 发布历史列表项 */
  export interface ReleaseItem {
    /** 发布 ID */
    id: number;
    /** 发布版本号 */
    versionNo: number;
    /** 快照 SHA256 */
    checksum: string;
    /** 来源发布 ID */
    baseReleaseId: number;
    /** 是否需要重启 */
    restartRequired: boolean;
    /** 重启原因 */
    restartReason: string;
    /** 发布备注 */
    remark: string;
    /** 发布管理员 ID */
    publishedByAdminId: number;
    /** 发布管理员账号 */
    publishedByName: string;
    /** 发布时间 */
    publishedAt: string;
  }

  /** 发布快照详情 */
  export interface ReleaseDetailResp extends ReleaseItem {
    /** 发布快照 JSON */
    snapshotJson: string;
    /** 发布快照 YAML */
    snapshotYaml: string;
  }
}

const RUNTIME_CONFIG_PREFIX = '/runtime-config';

// fetchRuntimeConfigOverview 查询运行配置概览，默认不拉取全量快照。
export async function fetchRuntimeConfigOverview(
  params: RuntimeConfigApi.OverviewQueryReq = {},
) {
  return requestClient.get<RuntimeConfigApi.OverviewResp>(
    `${RUNTIME_CONFIG_PREFIX}/overview`,
    { params },
  );
}

// fetchRuntimePeriodicTasks 分页查询周期任务草稿。
export async function fetchRuntimePeriodicTasks(
  params: RuntimeConfigApi.PeriodicQueryReq,
) {
  return requestClient.get<
    CommonApi.ListResult<RuntimeConfigApi.PeriodicTaskItem>
  >(`${RUNTIME_CONFIG_PREFIX}/periodic`, { params });
}

// saveRuntimePeriodicTask 保存周期任务草稿。
export async function saveRuntimePeriodicTask(
  data: RuntimeConfigApi.PeriodicTaskItem,
) {
  return requestClient.post(`${RUNTIME_CONFIG_PREFIX}/periodic`, data);
}

// deleteRuntimePeriodicTask 删除周期任务草稿。
export async function deleteRuntimePeriodicTask(id: number) {
  return requestClient.delete(`${RUNTIME_CONFIG_PREFIX}/periodic/${id}`);
}

// fetchRuntimeArchiveJobs 分页查询归档任务草稿。
export async function fetchRuntimeArchiveJobs(
  params: RuntimeConfigApi.ArchiveQueryReq,
) {
  return requestClient.get<
    CommonApi.ListResult<RuntimeConfigApi.ArchiveJobItem>
  >(`${RUNTIME_CONFIG_PREFIX}/archive-jobs`, { params });
}

// fetchRuntimeArchiveProgress 查询归档任务当前水位和区间执行详情。
export async function fetchRuntimeArchiveProgress(id: number) {
  return requestClient.get<RuntimeConfigApi.ArchiveProgressResp>(
    `${RUNTIME_CONFIG_PREFIX}/archive-jobs/${id}/progress`,
  );
}

// saveRuntimeArchiveJob 保存归档任务草稿。
export async function saveRuntimeArchiveJob(
  data: RuntimeConfigApi.ArchiveJobItem,
) {
  return requestClient.post(`${RUNTIME_CONFIG_PREFIX}/archive-jobs`, data);
}

// deleteRuntimeArchiveJob 删除归档任务草稿。
export async function deleteRuntimeArchiveJob(id: number) {
  return requestClient.delete(`${RUNTIME_CONFIG_PREFIX}/archive-jobs/${id}`);
}

// validateRuntimeConfigDraft 预检运行配置草稿。
export async function validateRuntimeConfigDraft() {
  return requestClient.post<RuntimeConfigApi.ValidateResp>(
    `${RUNTIME_CONFIG_PREFIX}/validate`,
  );
}

// publishRuntimeConfig 发布运行配置草稿。
export async function publishRuntimeConfig(data: RuntimeConfigApi.PublishReq) {
  return requestClient.post<RuntimeConfigApi.PublishResp>(
    `${RUNTIME_CONFIG_PREFIX}/publish`,
    data,
  );
}

// rollbackRuntimeConfig 回滚到指定发布快照。
export async function rollbackRuntimeConfig(
  data: RuntimeConfigApi.RollbackReq,
) {
  return requestClient.post<RuntimeConfigApi.PublishResp>(
    `${RUNTIME_CONFIG_PREFIX}/rollback`,
    data,
  );
}

// fetchRuntimeConfigReleases 分页查询发布历史。
export async function fetchRuntimeConfigReleases(
  params: RuntimeConfigApi.ReleaseQueryReq,
) {
  return requestClient.get<CommonApi.ListResult<RuntimeConfigApi.ReleaseItem>>(
    `${RUNTIME_CONFIG_PREFIX}/releases`,
    { params },
  );
}

// fetchRuntimeConfigRelease 查询发布快照详情。
export async function fetchRuntimeConfigRelease(releaseId: number) {
  return requestClient.get<RuntimeConfigApi.ReleaseDetailResp>(
    `${RUNTIME_CONFIG_PREFIX}/releases/${releaseId}`,
  );
}
