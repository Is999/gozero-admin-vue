import type { CommonApi } from '#/api/common';

import { requestClient } from '#/api/request';

// SystemAdminLogApi 定义后台操作日志相关接口类型。
export namespace SystemAdminLogApi {
  // Item 表示后台审计日志列表项。
  export interface Item {
    id: number; // 日志ID
    userID: number; // 操作管理员ID
    username: string; // 管理员用户名
    action: string; // 操作动作
    route: string; // 路由别名
    method: string; // 后端方法标识
    describe: string; // 中文描述
    data: string; // 请求参数快照
    ip: string; // 客户端IP
    ipaddr: string; // IP归属地
    traceId: string; // Trace ID
    spanId: string; // Span ID
    httpStatus: number; // HTTP状态码
    bizCode: number; // 业务码
    latencyMs: number; // 请求耗时毫秒
    success: boolean; // 是否成功
    errorMessage: string; // 错误信息
    createdAt: string; // 创建时间
  }

  // ListParams 表示后台审计日志查询参数。
  export interface ListParams {
    page?: number; // 当前页码
    pageSize?: number; // 每页条数
    traceID?: string; // Trace ID筛选
    userID?: number; // 用户 ID筛选
    username?: string; // 用户名筛选
    action?: string; // 操作动作筛选
    startTime?: string; // 查询开始时间，格式 YYYY-MM-DD HH:mm:ss
    endTime?: string; // 查询结束时间，单次跨度不超过 31 天
    orderBy?: 'createdAt' | 'id'; // 仅允许按创建时间或主键排序
    order?: 'asc' | 'desc'; // 排序方向
  }
}

// fetchAdminLogList 分页查询后台操作日志。
export async function fetchAdminLogList(params: SystemAdminLogApi.ListParams) {
  return requestClient.get<CommonApi.ListResult<SystemAdminLogApi.Item>>(
    '/admin-logs',
    {
      params,
    },
  );
}
