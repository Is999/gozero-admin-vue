import type { CommonApi } from '#/api/common';

import { requestClient } from '#/api/request';

// ADMIN_MESSAGE_NOTIFICATIONS_CHANGED_EVENT 表示站内信未读通知状态发生变化。
export const ADMIN_MESSAGE_NOTIFICATIONS_CHANGED_EVENT =
  'admin-message-notifications-changed';

// AdminMessageApi 定义管理员消息（站内信/通知）相关接口类型。
export namespace AdminMessageApi {
  // Level 表示消息等级：1info 2warning 3error。
  export type Level = 1 | 2 | 3;

  // ReadStatus 表示已读状态筛选：0未读 1已读。
  export type ReadStatus = 0 | 1;

  // SendType 表示公网发送入口允许创建的个人消息类型。
  export type SendType = 'leave_message' | 'work_handover';

  // Item 表示管理员收件箱消息项。
  export interface Item {
    id: number; // 消息ID
    replyToId: number; // 被回复的原消息ID，0表示非回复消息
    replyToTitle: string; // 原消息标题
    replyToSenderName: string; // 原消息发送人账号
    replyToCreatedAt: string; // 原消息创建时间
    type: string; // 消息类型
    level: Level; // 消息等级
    title: string; // 消息标题
    content: string; // 消息内容，支持受控富文本HTML
    data: string; // 扩展数据JSON
    link: string; // 跳转链接
    senderAdminId: number; // 发送人管理员ID
    senderAdminName: string; // 发送人账号
    handledStatus: number; // 处理状态：0未处理 1已处理
    handledByAdminName: string; // 处理人账号
    handledAt: string; // 处理时间
    isRead: boolean; // 是否已读
    readAt: string; // 已读时间
    createdAt: string; // 创建时间
  }

  // ListParams 表示收件箱列表查询参数。
  export interface ListParams {
    id?: number; // 精确消息ID
    page?: number; // 页码
    pageSize?: number; // 每页条数
    type?: string; // 消息类型
    level?: Level; // 消息等级
    readStatus?: ReadStatus; // 已读状态
    keyword?: string; // 关键字
    startTime?: string; // 起始时间：YYYY-MM-DD HH:mm:ss
    endTime?: string; // 结束时间：YYYY-MM-DD HH:mm:ss
  }

  // UnreadCountResp 表示未读数量响应。
  export interface UnreadCountResp {
    unread: number; // 未读数量
  }

  // NotificationParams 表示通知列表请求参数。
  export interface NotificationParams {
    limit?: number; // 最大条数
  }

  // MarkReadReq 表示标记已读请求参数。
  export interface MarkReadReq {
    ids?: number[]; // 消息ID列表
    all?: boolean; // 是否全部标记已读
  }

  // DeleteReq 表示删除消息请求参数。
  export interface DeleteReq {
    ids?: number[]; // 消息ID列表
    allRead?: boolean; // 是否删除全部已读
  }

  // AffectedResp 表示批量消息操作影响行数。
  export interface AffectedResp {
    affected: number; // 影响行数
  }

  // SendReq 表示发送消息请求参数。
  export interface SendReq {
    replyToId?: number; // 被回复的原消息ID
    type: SendType; // 个人消息类型；系统通知只能由服务端创建
    level: Level; // 消息等级
    title: string; // 消息标题
    content: string; // 消息内容，支持受控富文本HTML，最多32 KiB
    data?: string; // 扩展数据JSON，最多16 KiB
    link?: string; // 跳转链接，最多500个字符
    receiverIDs: number[]; // 收件人管理员ID列表，必填且最多100人
  }

  // SendResp 表示发送消息结果。
  export interface SendResp {
    id: number; // 消息ID
  }

  // SentListParams 表示已发送列表查询参数。
  export interface SentListParams {
    id?: number; // 精确消息ID
    page?: number; // 页码
    pageSize?: number; // 每页条数
    type?: string; // 消息类型
    level?: Level; // 消息等级
    keyword?: string; // 关键字
    startTime?: string; // 起始时间：YYYY-MM-DD HH:mm:ss
    endTime?: string; // 结束时间：YYYY-MM-DD HH:mm:ss
  }

  // SentItem 表示已发送消息列表项（包含收件人已读统计）。
  export interface SentItem {
    id: number; // 消息ID
    replyToId: number; // 被回复的原消息ID，0表示非回复消息
    replyToTitle: string; // 原消息标题
    replyToSenderName: string; // 原消息发送人账号
    replyToCreatedAt: string; // 原消息创建时间
    type: string; // 消息类型
    level: Level; // 消息等级
    title: string; // 消息标题
    content: string; // 消息内容，支持受控富文本HTML
    data: string; // 扩展数据JSON
    link: string; // 跳转链接
    senderAdminId: number; // 发送人管理员ID
    senderAdminName: string; // 发送人账号
    receiverTotal: number; // 收件人总数
    receiverReadTotal: number; // 已读收件人数
    receiverUnreadTotal: number; // 未读收件人数
    handledStatus: number; // 处理状态：0未处理 1已处理
    handledByAdminName: string; // 处理人账号
    handledAt: string; // 处理时间
    createdAt: string; // 创建时间
  }

  // ReceiverOptionParams 表示可用收件人选项查询参数。
  export interface ReceiverOptionParams {
    page?: number; // 页码
    pageSize?: number; // 每页条数
    keyword?: string; // 账号或姓名关键字
  }

  // ReceiverOptionItem 表示当前管理员可选择的消息收件人。
  export interface ReceiverOptionItem {
    id: number; // 管理员ID
    username: string; // 管理员账号
    realName: string; // 管理员姓名
  }

  // ReceiverItem 表示收件人已读明细项。
  export interface ReceiverItem {
    receiverAdminId: number; // 收件人管理员ID
    receiverAdminName: string; // 收件人账号
    receiverRealName: string; // 收件人姓名
    readStatus: number; // 已读状态：0未读 1已读
    readAt: string; // 已读时间
    deleteStatus: number; // 删除状态：0未删 1已删
    deletedAt: string; // 删除时间
  }

  // HandleReq 表示标记消息已处理请求参数。
  export interface HandleReq {
    id: number; // 消息ID
  }

  // HandleResp 表示消息处理状态更新结果。
  export interface HandleResp {
    id: number; // 消息ID
    handledStatus: number; // 处理状态：0未处理 1已处理
    handledByAdminName: string; // 处理人账号
    handledAt: string; // 处理时间
    alreadyHandled: boolean; // 是否在本次请求前已处理
  }
}

// fetchAdminMessageList 分页查询管理员消息收件箱。
export async function fetchAdminMessageList(
  params: AdminMessageApi.ListParams,
) {
  return requestClient.get<CommonApi.ListResult<AdminMessageApi.Item>>(
    '/admin-messages',
    {
      params,
    },
  );
}

// fetchAdminMessageSentList 分页查询管理员已发送消息列表。
export async function fetchAdminMessageSentList(
  params: AdminMessageApi.SentListParams,
) {
  return requestClient.get<CommonApi.ListResult<AdminMessageApi.SentItem>>(
    '/admin-messages/sent',
    {
      params,
    },
  );
}

// fetchAdminMessageReceiverOptions 查询当前管理员可选择的消息收件人。
export async function fetchAdminMessageReceiverOptions(
  params: AdminMessageApi.ReceiverOptionParams,
) {
  return requestClient.get<
    CommonApi.ListResult<AdminMessageApi.ReceiverOptionItem>
  >('/admin-messages/receiver-options', { params });
}

// fetchAdminMessageReceivers 查询指定消息的收件人已读明细（仅发送人可见）。
export async function fetchAdminMessageReceivers(id: number) {
  return requestClient.get<AdminMessageApi.ReceiverItem[]>(
    `/admin-messages/${id}/receivers`,
  );
}

// fetchAdminMessageUnreadCount 查询当前管理员未读消息数量。
export async function fetchAdminMessageUnreadCount() {
  return requestClient.get<AdminMessageApi.UnreadCountResp>(
    '/admin-messages/unread-count',
  );
}

// fetchAdminMessageNotifications 查询顶部铃铛通知列表。
export async function fetchAdminMessageNotifications(
  params?: AdminMessageApi.NotificationParams,
) {
  return requestClient.get<AdminMessageApi.Item[]>(
    '/admin-messages/notifications',
    {
      params,
    },
  );
}

// notifyAdminMessageNotificationsChanged 通知布局刷新顶部铃铛未读列表。
export function notifyAdminMessageNotificationsChanged() {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(ADMIN_MESSAGE_NOTIFICATIONS_CHANGED_EVENT));
}

// markAdminMessageRead 标记消息已读（支持批量与全部）。
export async function markAdminMessageRead(data: AdminMessageApi.MarkReadReq) {
  return requestClient.patch<AdminMessageApi.AffectedResp>(
    '/admin-messages/read',
    data,
  );
}

// deleteAdminMessage 删除消息（软删除，支持批量与清空全部已读）。
export async function deleteAdminMessage(data: AdminMessageApi.DeleteReq) {
  return requestClient.post<AdminMessageApi.AffectedResp>(
    '/admin-messages/delete',
    data,
  );
}

// sendAdminMessage 发送管理员消息到收件箱。
export async function sendAdminMessage(data: AdminMessageApi.SendReq) {
  return requestClient.post<AdminMessageApi.SendResp>(
    '/admin-messages/send',
    data,
  );
}

// handleAdminMessage 标记消息为已处理（仅支持部分业务类型）。
export async function handleAdminMessage(data: AdminMessageApi.HandleReq) {
  return requestClient.post<AdminMessageApi.HandleResp>(
    '/admin-messages/handle',
    data,
  );
}
