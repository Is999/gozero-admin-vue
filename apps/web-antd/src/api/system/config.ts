import type { CommonApi } from '#/api/common';

import { requestClient } from '#/api/request';
import { fetchBoundedPages } from '#/utils/request/bounded-pagination';

// CONFIG_LIST_MAX_ITEMS 与 CONFIG_LIST_MAX_PAGES 限制配置树聚合范围，禁止无边界全量请求。
const CONFIG_LIST_MAX_ITEMS = 1000;
const CONFIG_LIST_MAX_PAGES = 10;

// SystemConfigApi 定义字典配置相关接口类型。
export namespace SystemConfigApi {
  // Item 表示字典配置列表项。
  export interface Item {
    id: number; // 配置ID
    uuid: string; // 配置UUID
    title: string; // 配置标题
    type: number; // 配置类型
    value: any; // 配置值
    example: any; // 配置示例
    remark: string; // 备注
    page: string; // 页面路径
    pid: number; // 上级配置ID
    pids: string; // 上级配置族谱
    version: number; // 配置版本
    editable: number; // 是否可编辑
    createdAt: string; // 创建时间
    updatedAt: string; // 更新时间
  }

  // ListParams 表示字典配置查询参数。
  export interface ListParams {
    page?: number; // 当前页码
    pageSize?: number; // 每页条数
    uuid?: string; // 配置UUID筛选
    title?: string; // 配置标题筛选
    pagePath?: string; // 页面路径筛选
  }

  // SaveParams 表示新增或编辑字典配置参数。
  export interface SaveParams {
    uuid?: string; // 配置UUID，最多100个字符
    title?: string; // 配置标题
    type?: number; // 配置类型
    value?: any; // 配置值
    example?: any; // 配置示例
    remark?: string; // 备注
    page?: string; // 页面路径
    pid?: number; // 上级配置ID
    version?: number; // 乐观锁版本号，编辑时必传
  }

  // ImportResp 表示字典配置 Excel 导入结果。
  export interface ImportResp {
    created: number; // 新增数量
    updated: number; // 更新数量
    skipped: number; // 跳过数量
    syncPending: boolean; // 是否仍需操作员手动刷新配置缓存
  }

  // ImportBackupResp 表示字典导入前备份结果。
  export interface ImportBackupResp {
    backupId: string; // 备份ID
    expiresAt: string; // 服务器备份过期时间
    fileName: string; // 用户下载文件名
  }
}

// fetchConfigList 分页查询字典配置。
export async function fetchConfigList(params: SystemConfigApi.ListParams) {
  return requestClient.get<CommonApi.ListResult<SystemConfigApi.Item>>(
    '/dicts',
    {
      params,
    },
  );
}

// fetchBoundedConfigItems 按后端单页上限聚合完整配置列表，异常或超限时直接失败。
export async function fetchBoundedConfigItems() {
  return fetchBoundedPages<SystemConfigApi.Item>({
    fetchPage: (page, pageSize) => fetchConfigList({ page, pageSize }),
    getItemKey: (item) => item.id,
    maxItems: CONFIG_LIST_MAX_ITEMS,
    maxPages: CONFIG_LIST_MAX_PAGES,
  });
}

// createConfig 新增字典配置。
export async function createConfig(data: SystemConfigApi.SaveParams) {
  return requestClient.post<CommonApi.CacheSyncResp>('/dicts', data);
}

// downloadConfigExcel 导出字典配置 Excel。
export async function downloadConfigExcel(params: SystemConfigApi.ListParams) {
  return requestClient.download<Blob>('/dicts/export', {
    params,
  });
}

// prepareConfigImportBackup 预检上传文件并生成导入前全量备份。
export async function prepareConfigImportBackup(uploadId: string) {
  return requestClient.post<SystemConfigApi.ImportBackupResp>(
    '/dicts/import/backup',
    {
      uploadId,
    },
  );
}

// downloadConfigImportBackup 下载当前管理员生成的私有导入前备份。
export async function downloadConfigImportBackup(backupId: string) {
  const pathBackupId = encodeURIComponent(backupId);
  return requestClient.download<Blob>(`/dicts/import/backup/${pathBackupId}`, {
    params: { backupId },
  });
}

// importConfigExcel 使用已下载的备份凭证导入字典配置 Excel。
export async function importConfigExcel(uploadId: string, backupId: string) {
  return requestClient.post<SystemConfigApi.ImportResp>('/dicts/import', {
    backupId,
    uploadId,
  });
}

// updateConfig 编辑字典配置。
export async function updateConfig(
  id: number,
  data: SystemConfigApi.SaveParams,
) {
  return requestClient.patch<CommonApi.CacheSyncResp>(`/dicts/${id}`, data);
}

// fetchConfigCache 查看字典配置缓存。
export async function fetchConfigCache(uuid: string) {
  return requestClient.get(`/dicts/cache/${uuid}`);
}

// renewConfigCache 刷新字典配置缓存。
export async function renewConfigCache(uuid: string) {
  return requestClient.post(`/dicts/cache/refresh/${uuid}`);
}
