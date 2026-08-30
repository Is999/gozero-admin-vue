import type { Ref } from 'vue';

import type { VbenFormSchema } from '#/adapter/form';
import type { OnActionClickFn, VxeTableGridOptions } from '#/adapter/vxe-table';
import type { AdminMessageApi } from '#/api/message';

import { h, markRaw } from 'vue';

import { VbenTiptapPreview } from '@vben/plugins/tiptap';

import { Popover } from 'ant-design-vue';

import { $t } from '#/locales';

import {
  countTagMeta,
  messageLevelTagMap,
  readStatusTagMap,
} from '../table-tags';
import { messageContentText, sanitizeMessageContentHtml } from './content';
import MessageContentEditor from './message-content-editor.vue';
import MessageReceiverSelect from './message-receiver-select.vue';

// MESSAGE_TYPE_META 定义常用消息类型稳定枚举，文案在使用时从语言包读取。
const MESSAGE_TYPE_META = [
  { labelKey: 'business.message.messageTypeAdminLogin', value: 'admin_login' },
  {
    labelKey: 'business.message.messageTypeMemberOnline',
    value: 'member_online',
  },
  {
    labelKey: 'business.message.messageTypeMemberOffline',
    value: 'member_offline',
  },
  {
    labelKey: 'business.message.messageTypeRechargeLarge',
    value: 'recharge_large',
  },
  {
    labelKey: 'business.message.messageTypeWithdrawRiskAudit',
    value: 'withdraw_risk_audit',
  },
  {
    labelKey: 'business.message.messageTypeRechargeOrderException',
    value: 'recharge_order_exception',
  },
  {
    labelKey: 'business.message.messageTypeWithdrawOrderException',
    value: 'withdraw_order_exception',
  },
  {
    labelKey: 'business.message.messageTypeLeaveMessage',
    value: 'leave_message',
  },
  {
    labelKey: 'business.message.messageTypeWorkHandover',
    value: 'work_handover',
  },
];

// SEND_MESSAGE_TYPE_VALUES 限制公网表单只能创建个人消息，系统事件类型仅用于列表展示和筛选。
const SEND_MESSAGE_TYPE_VALUES = new Set<string>([
  'leave_message',
  'work_handover',
]);

// messageTypeOptions 返回消息类型选项，避免语言切换后沿用模块初始化时的旧文案。
export function messageTypeOptions() {
  return MESSAGE_TYPE_META.map((item) => ({
    label: $t(item.labelKey),
    value: item.value,
  }));
}

// sendMessageTypeOptions 返回公网发送表单允许使用的个人消息类型。
export function sendMessageTypeOptions() {
  return messageTypeOptions().filter((item) =>
    SEND_MESSAGE_TYPE_VALUES.has(item.value),
  );
}

// normalizeSendMessageType 保留个人消息类型，回复系统事件时回退为工作交接。
export function normalizeSendMessageType(
  value: string,
): AdminMessageApi.SendType {
  return SEND_MESSAGE_TYPE_VALUES.has(value)
    ? (value as AdminMessageApi.SendType)
    : 'work_handover';
}

export const PROCESSABLE_MESSAGE_TYPES = new Set([
  'recharge_order_exception',
  'withdraw_order_exception',
  'withdraw_risk_audit',
]);

export function isProcessableMessageType(type: string) {
  return PROCESSABLE_MESSAGE_TYPES.has(String(type || '').trim());
}

// MESSAGE_TYPE_COLOR_MAP 区分消息来源类型，便于收件箱快速扫读。
const MESSAGE_TYPE_COLOR_MAP: Record<string, string> = {
  admin_login: 'blue',
  leave_message: 'cyan',
  member_offline: 'default',
  member_online: 'success',
  recharge_large: 'purple',
  recharge_order_exception: 'warning',
  withdraw_order_exception: 'error',
  withdraw_risk_audit: 'orange',
  work_handover: 'geekblue',
};

// messageLevelOptions 返回消息等级选项，避免语言切换后沿用模块初始化时的旧文案。
export function messageLevelOptions() {
  return [
    { label: $t('business.message.messageLevelInfo'), value: 1 },
    { label: $t('business.message.messageLevelWarning'), value: 2 },
    { label: $t('business.message.messageLevelError'), value: 3 },
  ];
}

// readStatusOptions 返回已读状态筛选选项，避免语言切换后沿用模块初始化时的旧文案。
function readStatusOptions() {
  return [
    { label: $t('business.message.unread'), value: 0 },
    { label: $t('business.message.read'), value: 1 },
  ];
}

// useSendFormSchema 返回“发送消息”表单 schema。
export function useSendFormSchema(
  presetReceiverOptions: Ref<AdminMessageApi.ReceiverOptionItem[]>,
): VbenFormSchema[] {
  return [
    {
      component: markRaw(MessageReceiverSelect),
      fieldName: 'receiverIDs',
      help: $t('business.message.messageReceiversHelp'),
      label: $t('business.message.messageReceivers'),
      rules: 'selectRequired',
      formItemClass: 'col-span-2',
      componentProps: () => ({
        placeholder: $t('business.message.messageReceiversHelp'),
        presetOptions: presetReceiverOptions.value,
      }),
    },
    {
      component: 'Select',
      defaultValue: 'work_handover',
      fieldName: 'type',
      label: $t('business.message.messageType'),
      rules: 'selectRequired',
      formItemClass: 'col-span-1',
      componentProps: {
        options: sendMessageTypeOptions(),
        placeholder: $t('business.message.selectMessageType'),
        style: { width: '100%' },
      },
    },
    {
      component: 'Select',
      defaultValue: 1,
      fieldName: 'level',
      label: $t('business.message.messageLevel'),
      rules: 'selectRequired',
      formItemClass: 'col-span-1',
      componentProps: {
        options: messageLevelOptions(),
        placeholder: $t('business.message.selectMessageLevel'),
        style: { width: '100%' },
      },
    },
    {
      component: 'Input',
      fieldName: 'title',
      label: $t('business.message.title'),
      rules: 'required',
      formItemClass: 'col-span-2',
      componentProps: {
        allowClear: true,
        maxLength: 200,
        placeholder: $t('business.message.messageTitlePlaceholder'),
        showCount: true,
      },
    },
    {
      component: markRaw(MessageContentEditor),
      fieldName: 'content',
      hideLabel: true,
      label: $t('business.message.content'),
      rules: 'required',
      formItemClass: 'col-span-2 message-send-content-item',
      componentProps: {
        label: $t('business.message.content'),
        maxHeight: 260,
        minHeight: 150,
        placeholder: $t('business.message.messageContentPlaceholder'),
      },
    },
    {
      component: 'Input',
      fieldName: 'link',
      label: $t('business.message.messageLink'),
      formItemClass: 'col-span-2',
      componentProps: {
        allowClear: true,
        maxLength: 500,
        placeholder: $t('business.message.messageLinkPlaceholder'),
        showCount: true,
      },
    },
    {
      component: 'Textarea',
      fieldName: 'data',
      label: $t('business.message.messageExtraData'),
      formItemClass: 'col-span-2',
      componentProps: {
        class: 'w-full font-mono text-xs',
        maxLength: 16 * 1024,
        placeholder: $t('business.message.messageExtraDataPlaceholder'),
        rows: 4,
        showCount: true,
      },
    },
  ];
}

// useGridFormSchema 返回消息收件箱搜索表单配置。
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Select',
      fieldName: 'readStatus',
      label: $t('business.message.readStatus'),
      componentProps: {
        allowClear: true,
        options: readStatusOptions(),
        placeholder: $t('business.message.filterByReadStatus'),
      },
    },
    {
      component: 'Select',
      fieldName: 'type',
      label: $t('business.message.messageType'),
      componentProps: {
        allowClear: true,
        options: messageTypeOptions(),
        placeholder: $t('business.message.filterByMessageType'),
      },
    },
    {
      component: 'Select',
      fieldName: 'level',
      label: $t('business.message.messageLevel'),
      componentProps: {
        allowClear: true,
        options: messageLevelOptions(),
        placeholder: $t('business.message.filterByMessageLevel'),
      },
    },
    {
      component: 'Input',
      fieldName: 'keyword',
      label: $t('business.message.keyword'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByTitleContent'),
      },
    },
  ];
}

export function useSentGridFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Select',
      fieldName: 'type',
      label: $t('business.message.messageType'),
      componentProps: {
        allowClear: true,
        options: messageTypeOptions(),
        placeholder: $t('business.message.filterByMessageType'),
      },
    },
    {
      component: 'Select',
      fieldName: 'level',
      label: $t('business.message.messageLevel'),
      componentProps: {
        allowClear: true,
        options: messageLevelOptions(),
        placeholder: $t('business.message.filterByMessageLevel'),
      },
    },
    {
      component: 'Input',
      fieldName: 'keyword',
      label: $t('business.message.keyword'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByTitleContent'),
      },
    },
  ];
}

// resolveMessageTypeLabel 把消息类型编码转换为当前语言展示文本。
export function resolveMessageTypeLabel(type: string) {
  return (
    messageTypeOptions().find((item) => item.value === type)?.label ||
    type ||
    '-'
  );
}

// messageTypeTagMap 返回消息类型标签样式。
function messageTypeTagMap() {
  return Object.fromEntries(
    messageTypeOptions().map((item) => [
      item.value,
      {
        color: MESSAGE_TYPE_COLOR_MAP[item.value] || 'default',
        text: item.label,
      },
    ]),
  );
}

// messageHandleTagMeta 根据消息是否可处理返回处理状态标签。
function messageHandleTagMeta(
  row: Pick<
    AdminMessageApi.Item,
    'handledByAdminName' | 'handledStatus' | 'type'
  >,
) {
  if (!isProcessableMessageType(row.type)) {
    return { color: 'default', text: '-' };
  }
  return Number(row.handledStatus || 0) === 1
    ? {
        color: 'success',
        text: row.handledByAdminName
          ? $t('business.message.messageHandledBy', [row.handledByAdminName])
          : $t('business.message.messageHandled'),
      }
    : { color: 'warning', text: $t('business.message.messagePendingHandle') };
}

// renderMessageContentCell 在列表中展示可扫读摘要，并通过悬浮/点击查看格式化富文本预览。
function renderMessageContentCell(content = '') {
  const html = sanitizeMessageContentHtml(content);
  const text = messageContentText(content) || '-';
  if (!html || text === '-') {
    return h('span', { class: 'message-content-cell--empty' }, '-');
  }
  return h(
    Popover,
    {
      overlayClassName: 'message-rich-popover',
      placement: 'topLeft',
      trigger: ['hover', 'click'],
    },
    {
      content: () =>
        h(VbenTiptapPreview, {
          class: 'message-rich-popover__content message-content-rich',
          content: html,
          minHeight: 0,
        }),
      default: () =>
        h(
          'div',
          {
            class: 'message-content-cell',
            title: text,
          },
          [h('div', { class: 'message-content-cell__summary' }, text)],
        ),
    },
  );
}

// useColumns 返回消息管理表格列配置。
export function useColumns<T = AdminMessageApi.Item>(
  onActionClick: OnActionClickFn<T>,
): VxeTableGridOptions['columns'] {
  return [
    { field: 'id', fixed: 'left', title: 'ID', width: 90 },
    {
      align: 'center',
      cellRender: {
        attrs: { tagMap: messageTypeTagMap() },
        name: 'CellTag',
      },
      field: 'type',
      minWidth: 150,
      title: $t('business.message.type'),
    },
    {
      align: 'center',
      cellRender: {
        attrs: { tagMap: messageLevelTagMap() },
        name: 'CellTag',
      },
      field: 'level',
      title: $t('business.message.messageLevel'),
      width: 90,
    },
    { field: 'title', minWidth: 200, title: $t('business.message.title') },
    {
      field: 'content',
      minWidth: 320,
      slots: {
        default: ({ row }: { row: AdminMessageApi.Item }) =>
          renderMessageContentCell(row.content),
      },
      title: $t('business.message.content'),
    },
    {
      align: 'center',
      cellRender: {
        attrs: { tagMap: readStatusTagMap() },
        name: 'CellTag',
      },
      field: 'isRead',
      title: $t('business.message.read'),
      width: 90,
    },
    {
      align: 'center',
      cellRender: {
        attrs: {
          getMeta: ({ row }: { row: AdminMessageApi.Item }) =>
            messageHandleTagMeta(row),
        },
        name: 'CellTag',
      },
      field: 'handledStatus',
      minWidth: 140,
      title: $t('business.message.handleStatus'),
    },
    {
      field: 'handledAt',
      minWidth: 170,
      title: $t('business.message.handledAt'),
    },
    {
      field: 'senderAdminName',
      minWidth: 120,
      title: $t('business.message.sender'),
    },
    {
      field: 'createdAt',
      minWidth: 170,
      title: $t('business.message.createdAt'),
    },
    { field: 'readAt', minWidth: 170, title: $t('business.message.readAt') },
    {
      align: 'center',
      cellRender: {
        attrs: {
          nameField: 'title',
          onClick: onActionClick,
        },
        name: 'CellOperation',
        options: [
          {
            code: 'detail',
            icon: 'detail',
            iconOnly: true,
            text: $t('business.message.detail'),
          },
          {
            code: 'read',
            icon: 'read',
            iconOnly: true,
            text: $t('business.message.read'),
          },
          {
            code: 'delete',
            icon: 'delete',
            iconOnly: true,
            text: $t('business.message.delete'),
            danger: true,
          },
        ],
      },
      field: 'operation',
      fixed: 'right',
      headerAlign: 'center',
      showOverflow: false,
      title: $t('business.message.operation'),
      width: 112,
    },
  ];
}

export function useSentColumns<T = AdminMessageApi.SentItem>(
  onActionClick: OnActionClickFn<T>,
): VxeTableGridOptions['columns'] {
  return [
    { field: 'id', fixed: 'left', title: 'ID', width: 90 },
    {
      align: 'center',
      cellRender: {
        attrs: { tagMap: messageTypeTagMap() },
        name: 'CellTag',
      },
      field: 'type',
      minWidth: 150,
      title: $t('business.message.type'),
    },
    {
      align: 'center',
      cellRender: {
        attrs: { tagMap: messageLevelTagMap() },
        name: 'CellTag',
      },
      field: 'level',
      title: $t('business.message.messageLevel'),
      width: 90,
    },
    { field: 'title', minWidth: 200, title: $t('business.message.title') },
    {
      field: 'content',
      minWidth: 320,
      slots: {
        default: ({ row }: { row: AdminMessageApi.SentItem }) =>
          renderMessageContentCell(row.content),
      },
      title: $t('business.message.content'),
    },
    {
      align: 'center',
      cellRender: {
        attrs: {
          getMeta: ({ value }: { value: unknown }) =>
            countTagMeta(value, 'processing'),
        },
        name: 'CellTag',
      },
      field: 'receiverTotal',
      title: $t('business.message.messageReceivers'),
      width: 90,
    },
    {
      align: 'center',
      cellRender: {
        attrs: {
          getMeta: ({ value }: { value: unknown }) =>
            countTagMeta(value, 'success'),
        },
        name: 'CellTag',
      },
      field: 'receiverReadTotal',
      title: $t('business.message.read'),
      width: 90,
    },
    {
      align: 'center',
      cellRender: {
        attrs: {
          getMeta: ({ value }: { value: unknown }) =>
            countTagMeta(value, 'warning'),
        },
        name: 'CellTag',
      },
      field: 'receiverUnreadTotal',
      title: $t('business.message.unread'),
      width: 90,
    },
    {
      align: 'center',
      cellRender: {
        attrs: {
          getMeta: ({ row }: { row: AdminMessageApi.SentItem }) =>
            messageHandleTagMeta(row),
        },
        name: 'CellTag',
      },
      field: 'handledStatus',
      minWidth: 140,
      title: $t('business.message.handleStatus'),
    },
    {
      field: 'handledAt',
      minWidth: 170,
      title: $t('business.message.handledAt'),
    },
    {
      field: 'createdAt',
      minWidth: 170,
      title: $t('business.message.createdAt'),
    },
    {
      align: 'center',
      cellRender: {
        attrs: {
          nameField: 'title',
          onClick: onActionClick,
        },
        name: 'CellOperation',
        options: [
          {
            code: 'detail',
            icon: 'detail',
            iconOnly: true,
            text: $t('business.message.detail'),
          },
          {
            code: 'receivers',
            icon: 'receivers',
            iconOnly: true,
            text: $t('business.message.receiverDetails'),
          },
        ],
      },
      field: 'operation',
      fixed: 'right',
      headerAlign: 'center',
      showOverflow: false,
      title: $t('business.message.operation'),
      width: 96,
    },
  ];
}
