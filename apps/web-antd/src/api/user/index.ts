import type { CommonApi } from '#/api/common';

import { requestClient } from '#/api/request';

// UserApi 定义用户管理相关接口类型。
export namespace UserApi {
  // Status 表示用户启用状态，1=启用，0=禁用。
  export type Status = 0 | 1;

  // Item 表示用户列表与详情数据。
  export interface Item {
    id: string; // 用户雪花 ID，后端以字符串返回避免精度丢失
    shardNo: number; // 取模分片
    username: string; // 用户名
    nickname: string; // 昵称
    emailMasked: string; // 邮箱脱敏展示值
    phoneMasked: string; // 手机号脱敏展示值
    avatar: string; // 头像地址
    status: Status; // 状态
    lastLoginAt: string; // 最后登录时间
    lastLoginIP: string; // 最后登录IP
    createdAt: string; // 创建时间
    updatedAt: string; // 更新时间
  }

  // ListParams 表示用户列表查询参数。
  export interface ListParams {
    page?: number; // 当前页码
    pageSize?: number; // 每页条数，后端允许 1-200
    cursorId?: string; // 分表阶段下一页用户 ID 游标，首页不传
    id?: string; // 用户雪花 ID
    shardNo?: number; // 取模分片
    username?: string; // 用户名前缀
    email?: string; // 完整邮箱精确查询
    phone?: string; // 完整手机号精确查询
    status?: Status; // 状态筛选
  }

  // ExportParams 表示用户列表导出筛选参数。
  export interface ExportParams {
    id?: string; // 用户雪花 ID
    shardNo?: number; // 取模分片
    username?: string; // 用户名前缀
    email?: string; // 完整邮箱精确查询
    phone?: string; // 完整手机号精确查询
    status?: Status; // 状态筛选
  }

  // ExportTriggerResp 表示用户列表导出任务提交回执。
  export interface ExportTriggerResp {
    jobId: string; // 导出任务 ID
    queue: string; // 队列名称
    status: string; // 初始状态
    taskId: string; // 后台任务 ID
  }

  // ExportFileItem 表示用户导出的单个文件分片。
  export interface ExportFileItem {
    partNo: number; // 文件编号，从 1 开始
    fileName: string; // 文件名
    rowCount: number; // 当前文件行数
    processedFrom: number; // 全局起始行序号
    processedTo: number; // 全局结束行序号
    fileSize: number; // 文件大小
    downloadReady: boolean; // 是否可下载
    downloadUrl: string; // 下载地址
    createdAt: string; // 生成时间
  }

  // ExportStatusResp 表示用户列表导出任务进度。
  export interface ExportStatusResp {
    jobId: string; // 导出任务 ID
    taskId: string; // 后台任务 ID
    queue: string; // 队列名称
    status: 'failed' | 'queued' | 'running' | 'succeeded'; // 导出状态
    progress: number; // 当前进度百分比
    processed: number; // 已处理行数
    total: number; // 总行数
    estimatedSeconds: number; // 剩余预估秒数
    fileName: string; // 导出文件名
    downloadReady: boolean; // 是否已可下载
    files: ExportFileItem[]; // 已生成的导出文件分片
    partCount: number; // 已生成文件数量
    splitRows: number; // 单文件拆分阈值
    errorMessage: string; // 失败原因
    createdAt: string; // 创建时间
    startedAt: string; // 开始时间
    finishedAt: string; // 完成时间
    updatedAt: string; // 更新时间
    downloadUrl: string; // 下载地址
    processAt: string; // 计划执行时间
    lastProcessedAt: string; // 最近处理时间
    averageRowsPerSec: number; // 平均处理速度
  }

  // ListMeta 表示用户列表附加分页口径。
  export interface ListMeta {
    exactTotal?: boolean; // 是否为精确总数
    hasMore?: boolean; // 分表阶段是否仍有下一页
    nextCursorId?: string; // 下一页用户 ID 游标，末页为空或 0
    statusFilterSupported?: boolean; // 当前列表模式是否支持状态筛选
  }

  // ListResult 表示用户列表响应。
  export type ListResult = CommonApi.ListResult<Item> & {
    meta?: ListMeta;
  };

  // SaveParams 表示新增或编辑用户参数。
  export interface SaveParams extends CommonApi.TwoStepReq {
    username?: string; // 用户名
    password?: string; // 登录密码
    nickname?: string; // 昵称
    email?: string; // 邮箱
    phone?: string; // 手机号
    avatar?: string; // 头像地址
    status?: Status; // 状态
  }

  // RuntimeSyncParams 表示手动同步 API 运行态请求。
  export interface RuntimeSyncParams extends CommonApi.TwoStepReq {
    profile?: boolean; // 是否同步资料缓存
    sessions?: boolean; // 是否失效登录态
  }

  // RuntimeSyncResp 表示 API 运行态同步回执。
  export interface RuntimeSyncResp {
    enabled: boolean; // 是否配置 API 内网同步
    success: boolean; // 本次同步是否成功
    userId: string; // 用户雪花 ID
    profileCacheInvalidated: boolean; // 是否处理资料缓存
    sessionsInvalidated: boolean; // 是否处理登录态
    authVersion: string; // 本次会话失效使用的已提交认证版本十进制字符串
    message: string; // 同步说明
  }

  // MutationResp 表示用户写操作回执。
  export interface MutationResp {
    item?: Item; // 最新用户资料
    sync: RuntimeSyncResp; // API运行态同步结果
  }
}

// fetchUserList 分页查询用户列表。
export async function fetchUserList(params: UserApi.ListParams) {
  return requestClient.get<UserApi.ListResult>('/users', {
    params,
  });
}

// triggerUserExport 提交用户列表异步导出任务。
export async function triggerUserExport(data: UserApi.ExportParams) {
  return requestClient.post<UserApi.ExportTriggerResp>('/users/exports', data);
}

// fetchUserExportStatus 查询用户列表异步导出进度。
export async function fetchUserExportStatus(
  jobId: string,
  signal?: AbortSignal,
) {
  return requestClient.get<UserApi.ExportStatusResp>(
    `/users/exports/status/${encodeURIComponent(jobId)}`,
    { signal, skipGlobalErrorMessage: true },
  );
}

// downloadUserExport 下载用户列表导出文件。
export async function downloadUserExport(jobId: string, partNo?: number) {
  return requestClient.download<Blob>(
    `/users/exports/download/${encodeURIComponent(jobId)}`,
    {
      params: partNo && partNo > 0 ? { partNo } : undefined,
    },
  );
}

// fetchUserDetail 查询用户详情。
export async function fetchUserDetail(id: string) {
  return requestClient.get<UserApi.Item>(`/users/${id}`);
}

// createUser 新增用户。
export async function createUser(data: UserApi.SaveParams) {
  return requestClient.post<UserApi.MutationResp>('/users', data);
}

// updateUser 编辑用户资料。
export async function updateUser(id: string, data: UserApi.SaveParams) {
  return requestClient.patch<UserApi.MutationResp>(`/users/${id}`, data);
}

// updateUserStatus 修改用户状态。
export async function updateUserStatus(
  id: string,
  status: UserApi.Status,
  twoStep?: CommonApi.TwoStepReq,
) {
  return requestClient.patch<UserApi.MutationResp>(`/users/status/${id}`, {
    status,
    ...twoStep,
  });
}

// resetUserPassword 重置用户密码。
export async function resetUserPassword(
  id: string,
  password: string,
  twoStep?: CommonApi.TwoStepReq,
) {
  return requestClient.post<UserApi.MutationResp>(
    `/users/password/reset/${id}`,
    {
      password,
      ...twoStep,
    },
  );
}

// syncUserRuntime 手动同步用户 API 运行态。
export async function syncUserRuntime(
  id: string,
  data: UserApi.RuntimeSyncParams,
) {
  return requestClient.post<UserApi.RuntimeSyncResp>(
    `/users/runtime-sync/${id}`,
    data,
  );
}
