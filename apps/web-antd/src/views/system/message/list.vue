<script lang="ts" setup>
// ================= 类型与依赖引入 =================
import type { OnActionClickParams } from '#/adapter/vxe-table';
import type { AdminMessageApi } from '#/api/message';

import { computed, h, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page, useVbenDrawer, VbenButton } from '@vben/common-ui';
import { VbenTiptapPreview } from '@vben/plugins/tiptap';
import { useUserStore } from '@vben/stores';

import {
  Alert,
  Input,
  message,
  Modal,
  Radio,
  Space,
  Switch,
  Table,
  Tag,
} from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  deleteAdminMessage,
  fetchAdminMessageList,
  fetchAdminMessageReceivers,
  fetchAdminMessageSentList,
  handleAdminMessage,
  markAdminMessageRead,
  notifyAdminMessageNotificationsChanged,
  sendAdminMessage,
} from '#/api/message';
import { $t } from '#/locales';

import {
  messageContentText,
  normalizeMessageContentForSubmit,
  sanitizeMessageContentHtml,
} from './content';
import {
  isProcessableMessageType,
  messageLevelOptions,
  normalizeSendMessageType,
  resolveMessageTypeLabel,
  useColumns,
  useGridFormSchema,
  useSendFormSchema,
  useSentColumns,
  useSentGridFormSchema,
} from './data';

defineOptions({ name: 'SystemMessageListPage' });

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

// ================= 发送消息表单 =================
// sending 表示当前是否正在提交发送请求。
const sending = ref(false);
// sendDrawerTitle 区分新消息与回复消息抽屉标题。
const sendDrawerTitle = ref('');
// replyToMessageID 保存本次发送关联的原消息ID，0表示普通消息。
const replyToMessageID = ref(0);
const overlayOffsetLeft = ref(0);
// receiversModalWidth 控制收件人已读明细弹框宽度，避免少列数据在宽屏下铺满页面。
const receiversModalWidth = ref(760);

const overlaySafeAreaStyle = computed(() => {
  if (!overlayOffsetLeft.value) {
    return {};
  }
  return {
    left: `${overlayOffsetLeft.value}px`,
    width: `calc(100% - ${overlayOffsetLeft.value}px)`,
  };
});

function measureSidebarWidth() {
  const sidebar = document.querySelector(
    'aside[class*="bg-sidebar"], aside[class*="bg-sidebar-deep"], aside',
  ) as HTMLElement | null;
  const sidebarWidth = sidebar
    ? Math.max(0, Math.round(sidebar.getBoundingClientRect().width))
    : 0;
  const availableWidth = Math.max(720, window.innerWidth - sidebarWidth - 96);
  overlayOffsetLeft.value = sidebarWidth;
  receiversModalWidth.value = Math.min(760, availableWidth);
}

const [SendForm, sendFormApi] = useVbenForm({
  commonConfig: {
    colon: true,
    componentProps: { class: 'w-full' },
    formItemClass: 'col-span-1',
    labelClass: 'w-24',
  },
  layout: 'horizontal',
  schema: useSendFormSchema(),
  showDefaultActions: false,
  wrapperClass: 'grid grid-cols-2 gap-x-6 gap-y-3',
});

// SendDrawer 承载发送消息表单。
const [SendDrawer, sendDrawerApi] = useVbenDrawer({
  onConfirm: onSendConfirm,
});

const activeTab = ref<'inbox' | 'sent'>('inbox');

// ================= 表格配置 =================
// Grid 使用 VbenVxeGrid 承载消息收件箱列表。
const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    commonConfig: {
      formItemClass: 'col-span-1',
    },
    schema: useGridFormSchema(),
    submitOnChange: false,
    wrapperClass: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-4',
  },
  gridOptions: {
    columns: useColumns(onActionClick),
    height: 'auto',
    keepSource: true,
    proxyConfig: {
      ajax: {
        // 查询消息收件箱，并对齐后端 page/pageSize 参数。
        query: async ({ page }: { page: any }, formValues: any) => {
          return await fetchAdminMessageList({
            page: page.currentPage,
            pageSize: page.pageSize,
            ...formValues,
          });
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
      search: true,
      zoom: true,
    },
  },
});

const [SentGrid] = useVbenVxeGrid({
  formOptions: {
    commonConfig: {
      formItemClass: 'col-span-1',
    },
    schema: useSentGridFormSchema(),
    submitOnChange: false,
    wrapperClass: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-4',
  },
  gridOptions: {
    columns: useSentColumns(onSentActionClick),
    height: 'auto',
    keepSource: true,
    proxyConfig: {
      ajax: {
        query: async ({ page }: { page: any }, formValues: any) => {
          const { readStatus: _readStatus, ...rest } = formValues || {};
          return await fetchAdminMessageSentList({
            page: page.currentPage,
            pageSize: page.pageSize,
            ...rest,
          });
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
      search: true,
      zoom: true,
    },
  },
});

// onActionClick 处理表格操作列事件。
function onActionClick(e: OnActionClickParams<AdminMessageApi.Item>) {
  if (e.code === 'detail') {
    onViewDetail(e.row);
    return;
  }
  if (e.code === 'read') {
    onMarkRead(e.row);
    return;
  }
  if (e.code === 'delete') {
    onDeleteMessage(e.row);
  }
}

function onSentActionClick(e: OnActionClickParams<AdminMessageApi.SentItem>) {
  if (e.code === 'detail') {
    onViewSentDetail(e.row);
    return;
  }
  if (e.code === 'receivers') {
    onViewReceivers(e.row);
  }
}

// parsePayloadText 尝试把扩展数据 JSON 文本解析为对象用于展示。
function parsePayloadText(text = '') {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return '';
  }
  try {
    return JSON.stringify(JSON.parse(rawText), null, 2);
  } catch {
    return rawText;
  }
}

// renderMessageContent 以受控富文本展示消息正文，历史纯文本会自动按换行展示。
function renderMessageContent(content = '') {
  const html =
    sanitizeMessageContentHtml(content) ||
    sanitizeMessageContentHtml($t('business.message.emptyMessageContent'));
  return h('section', { class: 'message-detail-section' }, [
    h('div', { class: 'message-detail-section__header' }, [
      h('span', { class: 'message-detail-section__title' }, [
        $t('business.message.content'),
      ]),
    ]),
    h('div', { class: 'message-detail-section__body' }, [
      h(VbenTiptapPreview, {
        class: 'message-detail-rich message-content-rich',
        content: html,
        minHeight: 0,
      }),
    ]),
  ]);
}

// renderMessageData 单独展示扩展数据，避免与消息正文混在一起。
function renderMessageData(data = '') {
  if (!data) {
    return null;
  }
  return h('section', { class: 'message-detail-section' }, [
    h('div', { class: 'message-detail-section__header' }, [
      h('span', { class: 'message-detail-section__title' }, [
        $t('business.message.messageExtraData'),
      ]),
    ]),
    h('div', { class: 'message-detail-section__body' }, [
      h(
        'pre',
        {
          class:
            'max-h-[360px] overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs dark:bg-gray-900',
        },
        parsePayloadText(data),
      ),
    ]),
  ]);
}

function renderMessageLink(link = '') {
  if (!link) {
    return '-';
  }
  return h('span', { class: 'break-all', title: link }, link);
}

function resolveHandleText(
  row: Pick<
    AdminMessageApi.Item,
    'handledByAdminName' | 'handledStatus' | 'type'
  >,
) {
  if (!isProcessableMessageType(row.type)) {
    return '-';
  }
  if (Number(row.handledStatus || 0) !== 1) {
    return $t('business.message.messagePendingHandle');
  }
  return row.handledByAdminName
    ? $t('business.message.messageHandledBy', [row.handledByAdminName])
    : $t('business.message.messageHandled');
}

function renderDetailMetaItem(label: string, value: any) {
  return h('div', { class: 'message-detail-meta-item' }, [
    h('div', { class: 'message-detail-meta-label' }, label),
    h('div', { class: 'message-detail-meta-value' }, value || '-'),
  ]);
}

function renderDetailMetaGrid(items: Array<{ label: string; value: any }>) {
  return h(
    'div',
    { class: 'message-detail-meta-grid' },
    items.map((item) => renderDetailMetaItem(item.label, item.value)),
  );
}

// renderReplyReference 展示回复关联的原消息，并提供原消息详情入口。
function renderReplyReference(
  row: Pick<
    AdminMessageApi.Item,
    'replyToCreatedAt' | 'replyToId' | 'replyToSenderName' | 'replyToTitle'
  >,
  onViewOriginal: () => void,
) {
  if (!row.replyToId) {
    return null;
  }
  return h('section', { class: 'message-reply-reference' }, [
    h('div', { class: 'message-reply-reference__content' }, [
      h('div', { class: 'message-reply-reference__label' }, [
        $t('business.message.replyToMessage', [row.replyToId]),
      ]),
      h(
        'div',
        { class: 'message-reply-reference__title' },
        row.replyToTitle ||
          $t('business.message.messageTitleWithId', [row.replyToId]),
      ),
      h(
        'div',
        { class: 'message-reply-reference__meta' },
        [row.replyToSenderName, row.replyToCreatedAt]
          .filter(Boolean)
          .join(' / ') || '-',
      ),
    ]),
    h(
      'button',
      {
        class: 'message-reply-reference__action',
        onClick: onViewOriginal,
        type: 'button',
      },
      $t('business.message.viewOriginalMessage'),
    ),
  ]);
}

function renderDetailOverview(options: {
  createdAt?: string;
  level: AdminMessageApi.Level;
  sender?: string;
  subtitle?: string;
  title: string;
  type: string;
}) {
  return h('div', { class: 'message-detail-overview' }, [
    h('div', { class: 'message-detail-overview__main' }, [
      h('div', { class: 'message-detail-overview__eyebrow' }, [
        resolveMessageTypeLabel(options.type),
      ]),
      h('div', { class: 'message-detail-overview__title' }, options.title),
      h('div', { class: 'message-detail-overview__subtitle' }, [
        [options.sender, options.createdAt, options.subtitle]
          .filter(Boolean)
          .join(' / ') || '-',
      ]),
    ]),
    h('div', { class: 'message-detail-overview__tags' }, [
      h(Tag, { color: resolveLevelColor(options.level) }, () =>
        resolveLevelText(options.level),
      ),
      h(Tag, { color: 'processing' }, () =>
        resolveMessageTypeLabel(options.type),
      ),
    ]),
  ]);
}

// resolveLevelText 把消息等级转换为当前语言文案。
function resolveLevelText(level: number) {
  return (
    messageLevelOptions().find((item) => item.value === level)?.label ||
    String(level)
  );
}

// resolveLevelColor 把消息等级映射为 Tag 颜色。
function resolveLevelColor(level: number) {
  if (level === 3) {
    return 'error';
  }
  if (level === 2) {
    return 'warning';
  }
  return 'processing';
}

// requestMarkMessageRead 调用后端把单条收件箱消息写成已读。
async function requestMarkMessageRead(row: AdminMessageApi.Item) {
  await markAdminMessageRead({ ids: [row.id] });
  row.isRead = true;
  notifyAdminMessageNotificationsChanged();
}

// markMessageRead 标记单条收件箱消息已读，并保留手动操作提示。
async function markMessageRead(row: AdminMessageApi.Item) {
  if (row.isRead) {
    message.info($t('business.message.messageAlreadyRead'));
    return;
  }
  await requestMarkMessageRead(row);
  message.success($t('business.message.messageMarkedRead'));
  await gridApi.reload();
}

// autoMarkMessageRead 在查看详情时静默标记已读，失败后回滚当前行展示状态。
async function autoMarkMessageRead(row: AdminMessageApi.Item) {
  try {
    await requestMarkMessageRead(row);
  } catch {
    row.isRead = false;
    await gridApi.reload().catch(() => undefined);
    return;
  }
  await gridApi.reload();
}

// onViewDetail 展示单条消息详情，并闭环回复与处理操作。
function onViewDetail(row: AdminMessageApi.Item) {
  const shouldMarkRead = !row.isRead;
  if (shouldMarkRead) {
    row.isRead = true;
  }
  const detailRow = { ...row };
  if (shouldMarkRead) {
    void autoMarkMessageRead(row);
  }
  const processable = isProcessableMessageType(row.type);
  const handled = Number(row.handledStatus || 0) === 1;
  const currentUsername = String(userStore.userInfo?.username || '').trim();
  const canReply =
    Number(detailRow.senderAdminId || 0) > 0 &&
    (!currentUsername || detailRow.senderAdminName !== currentUsername);
  let handling = false;
  let detailModal: undefined | { destroy: () => void };
  const footerActions = [
    h(VbenButton, { onClick: () => detailModal?.destroy() }, () =>
      $t('business.message.close'),
    ),
  ];
  if (canReply) {
    footerActions.push(
      h(
        VbenButton,
        {
          onClick: () => {
            detailModal?.destroy();
            openReplyDrawer(detailRow);
          },
          type: 'primary',
        },
        () => $t('business.message.reply'),
      ),
    );
  }
  if (processable && !handled) {
    footerActions.push(
      h(
        VbenButton,
        {
          onClick: async () => {
            if (handling) {
              return;
            }
            handling = true;
            try {
              const resp = await handleAdminMessage({ id: detailRow.id });
              if (resp?.alreadyHandled) {
                message.info(
                  resp?.handledByAdminName
                    ? $t('business.message.messageHandledByOperator', [
                        resp.handledByAdminName,
                      ])
                    : $t('business.message.messageHandledByOther'),
                );
              } else {
                message.success($t('business.message.messageMarkedProcessed'));
              }
              detailModal?.destroy();
              await gridApi.reload();
            } finally {
              handling = false;
            }
          },
        },
        () => $t('business.message.markHandled'),
      ),
    );
  }
  detailModal = Modal.info({
    closable: true,
    content: h('div', { class: 'message-detail-shell' }, [
      h(Alert, {
        class: 'message-detail-alert',
        message: detailRow.isRead
          ? $t('business.message.messageAlreadyReadStatus')
          : $t('business.message.messageUnreadStatus'),
        showIcon: true,
        type: detailRow.isRead ? 'info' : 'warning',
      }),
      renderDetailOverview({
        createdAt: detailRow.createdAt,
        level: detailRow.level,
        sender: detailRow.senderAdminName,
        subtitle: detailRow.isRead
          ? $t('business.message.read')
          : $t('business.message.unread'),
        title:
          detailRow.title ||
          $t('business.message.messageTitleWithId', [detailRow.id]),
        type: detailRow.type,
      }),
      renderDetailMetaGrid([
        {
          label: $t('business.message.sender'),
          value: detailRow.senderAdminName,
        },
        { label: $t('business.message.createdAt'), value: detailRow.createdAt },
        { label: $t('business.message.readAt'), value: detailRow.readAt },
        {
          label: $t('business.message.handleStatus'),
          value: resolveHandleText(detailRow),
        },
        { label: $t('business.message.handledAt'), value: detailRow.handledAt },
        {
          label: $t('business.message.messageLink'),
          value: renderMessageLink(detailRow.link),
        },
      ]),
      renderReplyReference(detailRow, () => {
        detailModal?.destroy();
        void openMessageDetailByID(detailRow.replyToId);
      }),
      renderMessageContent(detailRow.content),
      renderMessageData(detailRow.data),
    ]),
    footer: h('div', { class: 'message-detail-footer' }, footerActions),
    maskClosable: true,
    title:
      detailRow.title ||
      $t('business.message.messageDetailTitle', [detailRow.id]),
    width: 860,
    wrapClassName: 'message-detail-modal',
  });
}

function onViewSentDetail(row: AdminMessageApi.SentItem) {
  const sentDetailModal = Modal.info({
    closable: true,
    content: h('div', { class: 'message-detail-shell' }, [
      renderDetailOverview({
        createdAt: row.createdAt,
        level: row.level,
        sender: row.senderAdminName,
        subtitle: $t('business.message.receiverReadStats', [
          row.receiverReadTotal,
          row.receiverTotal,
        ]),
        title: row.title || $t('business.message.messageTitleWithId', [row.id]),
        type: row.type,
      }),
      renderDetailMetaGrid([
        {
          label: $t('business.message.receiverStats'),
          value: $t('business.message.receiverReadStats', [
            row.receiverReadTotal,
            row.receiverTotal,
          ]),
        },
        { label: $t('business.message.sender'), value: row.senderAdminName },
        { label: $t('business.message.createdAt'), value: row.createdAt },
        {
          label: $t('business.message.handleStatus'),
          value: resolveHandleText(row),
        },
        { label: $t('business.message.handledAt'), value: row.handledAt },
        {
          label: $t('business.message.messageLink'),
          value: renderMessageLink(row.link),
        },
      ]),
      renderReplyReference(row, () => {
        sentDetailModal.destroy();
        void openMessageDetailByID(row.replyToId);
      }),
      renderMessageContent(row.content),
      renderMessageData(row.data),
    ]),
    maskClosable: true,
    title: row.title || $t('business.message.sentMessageDetailTitle', [row.id]),
    width: 860,
    wrapClassName: 'message-detail-modal',
  });
}

// openMessageDetailByID 从收件箱或已发送列表精确定位消息并打开详情。
async function openMessageDetailByID(messageID: number) {
  if (!Number.isSafeInteger(messageID) || messageID <= 0) {
    message.warning($t('business.message.messageUnavailable'));
    return;
  }
  const inboxResp = await fetchAdminMessageList({
    id: messageID,
    page: 1,
    pageSize: 1,
  });
  const inboxMessage = inboxResp.list?.find((item) => item.id === messageID);
  if (inboxMessage) {
    activeTab.value = 'inbox';
    onViewDetail(inboxMessage);
    return;
  }
  const sentResp = await fetchAdminMessageSentList({
    id: messageID,
    page: 1,
    pageSize: 1,
  });
  const sentMessage = sentResp.list?.find((item) => item.id === messageID);
  if (sentMessage) {
    activeTab.value = 'sent';
    onViewSentDetail(sentMessage);
    return;
  }
  message.warning($t('business.message.messageUnavailable'));
}

watch(
  () => route.query.messageId,
  async (value) => {
    const rawValue = Array.isArray(value) ? value[0] : value;
    const messageID = Number(rawValue);
    if (!Number.isSafeInteger(messageID) || messageID <= 0) {
      return;
    }
    const { messageId: _messageId, ...query } = route.query;
    await router.replace({ path: route.path, query }).catch(() => undefined);
    await openMessageDetailByID(messageID);
  },
  { immediate: true },
);

const receiversModalOpen = ref(false);
const receiversLoading = ref(false);
const receiversRows = ref<AdminMessageApi.ReceiverItem[]>([]);
const receiversMessageTitle = ref('');
const receiversKeyword = ref('');
const receiversReadFilter = ref<'all' | 'read' | 'unread'>('all');
const receiversOnlyDeleted = ref(false);

watch(
  () => receiversModalOpen.value,
  (isOpen) => {
    if (!isOpen) {
      return;
    }
    window.requestAnimationFrame(measureSidebarWidth);
    receiversKeyword.value = '';
    receiversReadFilter.value = 'all';
    receiversOnlyDeleted.value = false;
  },
);

const receiversStats = computed(() => {
  const rows = receiversRows.value || [];
  const total = rows.length;
  const readTotal = rows.filter(
    (item) => Number(item.readStatus || 0) === 1,
  ).length;
  const deletedTotal = rows.filter(
    (item) => Number(item.deleteStatus || 0) === 1,
  ).length;
  return {
    total,
    readTotal,
    unreadTotal: Math.max(0, total - readTotal),
    deletedTotal,
  };
});

const receiversFilteredRows = computed(() => {
  const keyword = String(receiversKeyword.value || '')
    .trim()
    .toLowerCase();
  const readFilter = receiversReadFilter.value;
  const onlyDeleted = Boolean(receiversOnlyDeleted.value);
  return (receiversRows.value || []).filter((item) => {
    const isRead = Number(item.readStatus || 0) === 1;
    const isDeleted = Number(item.deleteStatus || 0) === 1;
    if (onlyDeleted && !isDeleted) {
      return false;
    }
    if (readFilter === 'read' && !isRead) {
      return false;
    }
    if (readFilter === 'unread' && isRead) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    const name =
      `${item.receiverAdminName || ''} ${item.receiverRealName || ''}`.toLowerCase();
    return name.includes(keyword);
  });
});
const receiversColumns = [
  {
    title: 'ID',
    dataIndex: 'receiverAdminId',
    key: 'receiverAdminId',
    width: 80,
  },
  {
    title: $t('business.message.account'),
    dataIndex: 'receiverAdminName',
    key: 'receiverAdminName',
  },
  {
    title: $t('business.message.realName'),
    dataIndex: 'receiverRealName',
    key: 'receiverRealName',
  },
  {
    title: $t('business.message.read'),
    dataIndex: 'readStatus',
    key: 'readStatus',
    width: 90,
    customRender: ({ text }: any) =>
      h(
        Tag,
        { color: Number(text || 0) === 1 ? 'processing' : 'default' },
        () =>
          Number(text || 0) === 1
            ? $t('business.message.read')
            : $t('business.message.unread'),
      ),
  },
  {
    title: $t('business.message.readAt'),
    dataIndex: 'readAt',
    key: 'readAt',
    width: 170,
  },
  {
    title: $t('business.message.deleted'),
    dataIndex: 'deleteStatus',
    key: 'deleteStatus',
    width: 90,
    customRender: ({ text }: any) =>
      h(Tag, { color: Number(text || 0) === 1 ? 'warning' : 'default' }, () =>
        Number(text || 0) === 1
          ? $t('business.message.yes')
          : $t('business.message.no'),
      ),
  },
];

async function onViewReceivers(row: AdminMessageApi.SentItem) {
  receiversMessageTitle.value =
    row.title || $t('business.message.messageTitleWithId', [row.id]);
  receiversModalOpen.value = true;
  receiversLoading.value = true;
  try {
    receiversRows.value = await fetchAdminMessageReceivers(row.id);
  } finally {
    receiversLoading.value = false;
  }
}

// onMarkRead 标记单条消息已读并刷新列表。
async function onMarkRead(row: AdminMessageApi.Item) {
  await markMessageRead(row);
}

// onDeleteMessage 删除单条消息并刷新列表。
function onDeleteMessage(row: AdminMessageApi.Item) {
  Modal.confirm({
    content: $t('business.message.confirmDeleteMessage', [row.title || row.id]),
    okText: $t('business.message.delete'),
    okType: 'danger',
    onOk: async () => {
      await deleteAdminMessage({ ids: [row.id] });
      notifyAdminMessageNotificationsChanged();
      message.success($t('business.message.deleteSucceeded'));
      await gridApi.reload();
    },
    title: $t('business.message.deleteConfirmTitle'),
  });
}

// openSendDrawer 打开发送消息抽屉。
function openSendDrawer() {
  replyToMessageID.value = 0;
  sendDrawerTitle.value = $t('business.message.sendMessage');
  sendFormApi.resetForm();
  sendFormApi.setValues({
    level: 1,
    type: 'work_handover',
  });
  sendDrawerApi.open();
}

// openReplyDrawer 预填原发送人与标题，并记录回复关联消息ID。
function openReplyDrawer(row: AdminMessageApi.Item) {
  const currentUsername = String(userStore.userInfo?.username || '')
    .trim()
    .toLowerCase();
  if (
    currentUsername &&
    String(row.senderAdminName || '')
      .trim()
      .toLowerCase() === currentUsername
  ) {
    message.warning($t('business.message.selfSendForbidden'));
    return;
  }
  const sourceTitle =
    row.title || $t('business.message.messageTitleWithId', [row.id]);
  replyToMessageID.value = row.id;
  sendDrawerTitle.value = $t('business.message.replyMessage');
  sendFormApi.resetForm();
  sendFormApi.setValues({
    level: row.level,
    receiverIDs: [row.senderAdminId],
    title: $t('business.message.replyTitle', [sourceTitle]).slice(0, 200),
    type: normalizeSendMessageType(row.type),
  });
  sendDrawerApi.open();
}

// onSendConfirm 提交发送消息。
async function onSendConfirm() {
  if (sending.value) {
    return;
  }
  sending.value = true;
  sendDrawerApi.lock();
  try {
    const { valid } = await sendFormApi.validate();
    if (!valid) {
      return;
    }
    const values = await sendFormApi.getValues<AdminMessageApi.SendReq>();
    const content = normalizeMessageContentForSubmit(values.content);
    if (!messageContentText(content)) {
      message.error($t('business.message.messageContentRequired'));
      return;
    }
    if (values.receiverIDs.length > 100) {
      message.error($t('business.message.messageReceiversTooMany'));
      return;
    }
    if (new TextEncoder().encode(content).length > 32 * 1024) {
      message.error($t('business.message.messageContentTooLarge'));
      return;
    }
    if (values.data) {
      if (new TextEncoder().encode(values.data).length > 16 * 1024) {
        message.error($t('business.message.messageExtraDataTooLarge'));
        return;
      }
      try {
        JSON.parse(values.data);
      } catch {
        message.error($t('business.message.messageExtraDataInvalid'));
        return;
      }
    }
    await sendAdminMessage({
      ...values,
      content,
      replyToId: replyToMessageID.value || undefined,
    });
    message.success($t('business.message.sendSucceeded'));
    sendDrawerApi.close();
    await gridApi.reload();
  } finally {
    sending.value = false;
    sendDrawerApi.unlock();
  }
}

// onMarkAllRead 把当前收件箱全部未读消息标记为已读。
async function onMarkAllRead() {
  await markAdminMessageRead({ all: true });
  notifyAdminMessageNotificationsChanged();
  message.success($t('business.message.allMessagesMarkedRead'));
  await gridApi.reload();
}

// onClearRead 清空当前收件箱全部已读消息。
function onClearRead() {
  Modal.confirm({
    content: $t('business.message.confirmClearReadMessages'),
    okText: $t('business.message.clear'),
    okType: 'danger',
    onOk: async () => {
      await deleteAdminMessage({ allRead: true });
      message.success($t('business.message.clearSucceeded'));
      await gridApi.reload();
    },
    title: $t('business.message.clearConfirmTitle'),
  });
}
</script>

<template>
  <Page auto-content-height>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <Space wrap>
        <VbenButton
          :type="activeTab === 'inbox' ? 'primary' : 'default'"
          @click="activeTab = 'inbox'"
        >
          {{ $t('business.message.inbox') }}
        </VbenButton>
        <VbenButton
          :type="activeTab === 'sent' ? 'primary' : 'default'"
          @click="activeTab = 'sent'"
        >
          {{ $t('business.message.sentMessages') }}
        </VbenButton>
      </Space>
      <Space v-if="activeTab === 'inbox'" wrap>
        <VbenButton type="primary" @click="openSendDrawer">
          {{ $t('business.message.sendMessage') }}
        </VbenButton>
        <VbenButton @click="onMarkAllRead">
          {{ $t('business.message.markAllRead') }}
        </VbenButton>
        <VbenButton danger @click="onClearRead">
          {{ $t('business.message.clearRead') }}
        </VbenButton>
      </Space>
    </div>
    <Grid
      v-if="activeTab === 'inbox'"
      :table-title="$t('business.message.messageInbox')"
    />
    <SentGrid v-else :table-title="$t('business.message.mySentMessages')" />

    <SendDrawer
      class="w-full max-w-[1040px]"
      :loading="sending"
      :title="sendDrawerTitle || $t('business.message.sendMessage')"
    >
      <div class="send-message-editor">
        <div class="send-message-guide">
          <div class="send-message-guide__summary">
            <span class="send-message-guide__icon">i</span>
            <div class="send-message-guide__copy">
              <span class="send-message-guide__title">
                {{ $t('business.message.sendMessageGuide') }}
              </span>
              <span class="send-message-guide__desc">
                {{ $t('business.message.sendMessageDesc') }}
              </span>
            </div>
          </div>
          <div
            class="send-message-guide__meta"
            :title="$t('business.message.messageSpecDesc')"
          >
            <span class="send-message-guide__level-label">
              {{ $t('business.message.messageLevel') }}
            </span>
            <Tag color="processing">
              {{ $t('business.message.messageLevelInfo') }}
            </Tag>
            <Tag color="warning">
              {{ $t('business.message.messageLevelWarning') }}
            </Tag>
            <Tag color="error">
              {{ $t('business.message.messageLevelError') }}
            </Tag>
            <span class="send-message-guide__extra">
              {{ $t('business.message.messageExtraDataSuggestion') }}
            </span>
          </div>
        </div>
        <div class="send-message-form">
          <SendForm />
        </div>
      </div>
    </SendDrawer>

    <Modal
      v-model:open="receiversModalOpen"
      :body-style="{ padding: '16px 20px' }"
      :closable="true"
      :footer="null"
      :mask-closable="true"
      :mask-style="overlaySafeAreaStyle"
      :wrap-style="overlaySafeAreaStyle"
      :title="$t('business.message.receiverReadDetails')"
      :width="receiversModalWidth"
    >
      <div class="space-y-3">
        <div class="rounded-md bg-gray-50 p-4 dark:bg-gray-900/40">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs text-gray-500">
                {{ $t('business.message.message') }}
              </div>
              <div class="truncate text-base font-medium leading-6">
                {{ receiversMessageTitle }}
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Tag>
                {{ $t('business.message.totalCount', [receiversStats.total]) }}
              </Tag>
              <Tag color="processing">
                {{
                  $t('business.message.readCount', [receiversStats.readTotal])
                }}
              </Tag>
              <Tag color="default">
                {{
                  $t('business.message.unreadCount', [
                    receiversStats.unreadTotal,
                  ])
                }}
              </Tag>
              <Tag color="warning">
                {{
                  $t('business.message.deletedCount', [
                    receiversStats.deletedTotal,
                  ])
                }}
              </Tag>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Input
              v-model:value="receiversKeyword"
              allow-clear
              autocomplete="off"
              class="w-72"
              id="message-receivers-search"
              name="message-receivers-search"
              :placeholder="$t('business.message.searchAccountName')"
            />
            <Space wrap>
              <Radio.Group
                v-model:value="receiversReadFilter"
                button-style="solid"
              >
                <Radio.Button value="all">
                  {{ $t('business.message.all') }}
                </Radio.Button>
                <Radio.Button value="unread">
                  {{ $t('business.message.unread') }}
                </Radio.Button>
                <Radio.Button value="read">
                  {{ $t('business.message.read') }}
                </Radio.Button>
              </Radio.Group>
              <Switch
                v-model:checked="receiversOnlyDeleted"
                :checked-children="$t('business.message.onlyDeleted')"
                :un-checked-children="$t('business.message.all')"
              />
            </Space>
          </div>
        </div>

        <Table
          class="message-receivers-table"
          :columns="receiversColumns"
          :data-source="receiversFilteredRows"
          :loading="receiversLoading"
          :pagination="false"
          :scroll="{ y: 360 }"
          row-key="receiverAdminId"
          size="small"
        />
      </div>
    </Modal>
  </Page>
</template>

<style scoped>
.send-message-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  container: send-message-editor / inline-size;
}

.send-message-guide {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 6px 14px;
  place-content: flex-start;
  align-items: flex-start;
  min-width: 0;
  block-size: max-content;
  min-height: 0;
  padding: 10px 12px;
  background: hsl(var(--accent) / 38%);
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}

.send-message-guide__summary,
.send-message-guide__meta {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  min-width: 0;
}

.send-message-guide__summary {
  flex: 1 1 520px;
}

.send-message-guide__meta {
  flex: 1 1 420px;
  flex-wrap: wrap;
  justify-content: flex-start;
}

@container send-message-editor (max-width: 900px) {
  .send-message-guide {
    gap: 4px;
    padding: 8px 10px;
  }

  .send-message-guide__summary {
    flex-basis: 100%;
  }

  .send-message-guide__meta {
    display: none;
  }
}

.send-message-guide__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: hsl(var(--primary));
  border: 1px solid hsl(var(--primary) / 48%);
  border-radius: 999px;
}

.send-message-guide__copy {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}

.send-message-guide__title {
  flex: none;
  font-size: 13px;
  font-weight: 700;
  color: hsl(var(--foreground));
}

.send-message-guide__desc,
.send-message-guide__extra {
  min-width: 0;
  overflow: visible;
  text-overflow: clip;
  font-size: 12px;
  line-height: 1.5;
  color: var(--vben-text-color-secondary);
  white-space: normal;
}

.send-message-guide__extra {
  flex: 1 1 260px;
  max-width: none;
}

.send-message-guide__level-label {
  flex: none;
  font-size: 12px;
  color: var(--vben-text-color-secondary);
}

.send-message-form {
  padding: 12px 14px;
  background: hsl(var(--accent) / 30%);
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}

.send-message-form :deep(.ant-form-item) {
  margin-bottom: 0;
}

:global(.message-send-content-item .vben-tiptap) {
  display: flex;
  flex-direction: column;
  min-height: calc(var(--vben-tiptap-min-height) + 58px);
  max-height: min(72vh, 720px);
  overflow: hidden;
  resize: vertical;
}

:global(.message-send-content-item .vben-tiptap__editor) {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

:global(.message-send-content-item .vben-tiptap__content) {
  flex: 1 1 auto;
  max-height: none;
  overflow-y: auto;
}

:global(.message-content-cell) {
  min-width: 0;
  text-align: left;
  cursor: pointer;
}

:global(.message-content-cell__summary) {
  display: -webkit-box;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-line-clamp: 2;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.45;
  color: hsl(var(--foreground));
  overflow-wrap: anywhere;
  white-space: normal;
  -webkit-box-orient: vertical;
}

:global(.message-content-cell--empty) {
  color: var(--vben-text-color-secondary);
}

:global(.message-rich-popover) {
  max-width: min(560px, calc(100vw - 48px));
}

:global(.message-rich-popover .ant-popover-inner) {
  padding: 0;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
}

:global(.message-rich-popover .ant-popover-inner-content) {
  padding: 0;
}

:global(.message-rich-popover__content) {
  box-sizing: border-box;
  width: min(540px, calc(100vw - 72px));
  max-height: 360px;
  padding: 12px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.7;
  color: hsl(var(--foreground));
}

:global(.message-detail-modal .ant-modal-body) {
  padding-top: 12px;
}

:global(.message-detail-modal .message-detail-shell) {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

:global(.message-detail-modal .message-detail-footer) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  padding-top: 16px;
}

:global(.message-detail-modal .message-reply-reference) {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: hsl(var(--primary) / 8%);
  border: 1px solid hsl(var(--primary) / 30%);
  border-radius: 8px;
}

:global(.message-detail-modal .message-reply-reference__content) {
  min-width: 0;
}

:global(.message-detail-modal .message-reply-reference__label) {
  font-size: 12px;
  font-weight: 700;
  color: hsl(var(--primary));
}

:global(.message-detail-modal .message-reply-reference__title) {
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 700;
  color: hsl(var(--foreground));
  white-space: nowrap;
}

:global(.message-detail-modal .message-reply-reference__meta) {
  margin-top: 4px;
  font-size: 12px;
  color: var(--vben-text-color-secondary);
}

:global(.message-detail-modal .message-reply-reference__action) {
  flex: none;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--primary));
  background: transparent;
  border: 1px solid hsl(var(--primary) / 38%);
  border-radius: 6px;
}

:global(.message-detail-modal .message-reply-reference__action:hover) {
  background: hsl(var(--primary) / 10%);
}

:global(.message-detail-modal .message-detail-alert) {
  border-radius: 8px;
}

:global(.message-detail-modal .message-detail-overview) {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 14px;
  background: hsl(var(--accent) / 34%);
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}

:global(.message-detail-modal .message-detail-overview__main) {
  min-width: 0;
}

:global(.message-detail-modal .message-detail-overview__eyebrow) {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  color: hsl(var(--primary));
}

:global(.message-detail-modal .message-detail-overview__title) {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.35;
  color: hsl(var(--foreground));
  white-space: nowrap;
}

:global(.message-detail-modal .message-detail-overview__subtitle) {
  margin-top: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 1.45;
  color: var(--vben-text-color-secondary);
  white-space: nowrap;
}

:global(.message-detail-modal .message-detail-overview__tags) {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  max-width: 240px;
}

:global(.message-detail-modal .message-detail-meta-grid) {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

:global(.message-detail-modal .message-detail-meta-item) {
  min-width: 0;
  padding: 10px 12px;
  background: hsl(var(--accent) / 24%);
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}

:global(.message-detail-modal .message-detail-meta-label) {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 1.3;
  color: var(--vben-text-color-secondary);
  white-space: nowrap;
}

:global(.message-detail-modal .message-detail-meta-value) {
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: hsl(var(--foreground));
  white-space: nowrap;
}

:global(.message-detail-modal .message-detail-section) {
  overflow: hidden;
  background: hsl(var(--accent) / 18%);
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
}

:global(.message-detail-modal .message-detail-section__header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid hsl(var(--border));
}

:global(.message-detail-modal .message-detail-section__title) {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
  color: hsl(var(--foreground));
}

:global(.message-detail-modal .message-detail-section__body) {
  padding: 12px;
}

:global(.message-detail-modal .message-detail-rich) {
  max-height: 420px;
  padding: 0;
  overflow: auto;
  font-size: 14px;
  line-height: 1.75;
  color: hsl(var(--foreground));
}

:global(.message-detail-modal .message-content-rich h1),
:global(.message-detail-modal .message-content-rich h2),
:global(.message-detail-modal .message-content-rich h3),
:global(.message-detail-modal .message-content-rich h4),
:global(.message-rich-popover__content h1),
:global(.message-rich-popover__content h2),
:global(.message-rich-popover__content h3),
:global(.message-rich-popover__content h4) {
  margin: 0.35em 0;
  font-weight: 700;
}

:global(.message-detail-modal .message-content-rich p),
:global(.message-rich-popover__content p) {
  margin: 0 0 0.65em;
}

:global(.message-detail-modal .message-content-rich p:last-child),
:global(.message-rich-popover__content p:last-child) {
  margin-bottom: 0;
}

:global(.message-detail-modal .message-content-rich ul),
:global(.message-detail-modal .message-content-rich ol),
:global(.message-rich-popover__content ul),
:global(.message-rich-popover__content ol) {
  padding-left: 1.5em;
  margin: 0.35em 0;
}

:global(.message-detail-modal .message-content-rich blockquote),
:global(.message-rich-popover__content blockquote) {
  padding-left: 0.75em;
  margin: 0.5em 0;
  color: var(--vben-text-color-secondary);
  border-left: 3px solid hsl(var(--border));
}

:global(.message-detail-modal .message-content-rich code),
:global(.message-rich-popover__content code) {
  padding: 0.1em 0.35em;
  background: hsl(var(--accent));
  border-radius: 4px;
}

:global(.message-detail-modal .message-content-rich pre),
:global(.message-rich-popover__content pre) {
  padding: 0.75em;
  overflow: auto;
  background: hsl(var(--accent));
  border-radius: 6px;
}

:global(.message-detail-modal .message-content-rich a),
:global(.message-rich-popover__content a) {
  color: hsl(var(--primary));
  text-decoration: underline;
}

:global(.message-detail-modal .message-content-rich img),
:global(.message-rich-popover__content img) {
  max-width: 100%;
  border-radius: 6px;
}

:global(.message-detail-modal .message-content-rich hr),
:global(.message-rich-popover__content hr) {
  margin: 0.75em 0;
  border: 0;
  border-top: 1px solid hsl(var(--border));
}

.message-receivers-table :deep(.ant-table) {
  color: var(--vben-text-color);
  background: transparent;
}

.message-receivers-table :deep(.ant-table-container) {
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
}

.message-receivers-table :deep(.ant-table-thead > tr > th) {
  font-weight: 600;
  color: hsl(var(--foreground));
  background: hsl(var(--accent));
  border-bottom-color: hsl(var(--border));
}

.message-receivers-table :deep(.ant-table-thead > tr > th::before) {
  background-color: hsl(var(--heavy));
}

.message-receivers-table :deep(.ant-table-tbody > tr > td) {
  color: var(--vben-text-color);
  border-bottom-color: hsl(var(--border));
}

.message-receivers-table :deep(.ant-table-tbody > tr:hover > td) {
  background: hsl(var(--accent) / 58%);
}

.message-receivers-table :deep(.ant-empty-description) {
  color: var(--vben-text-color-secondary);
}

@media (max-width: 1024px) {
  .send-message-guide {
    flex-direction: column;
    align-items: flex-start;
  }

  .send-message-guide__meta {
    justify-content: flex-start;
  }

  .send-message-guide__copy {
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
  }

  .send-message-guide__desc,
  .send-message-guide__extra {
    max-width: none;
    white-space: normal;
  }

  :global(.message-detail-modal .message-detail-meta-grid) {
    grid-template-columns: 1fr;
  }

  :global(.message-detail-modal .message-detail-overview) {
    flex-direction: column;
  }

  :global(.message-detail-modal .message-reply-reference) {
    flex-direction: column;
    align-items: flex-start;
  }

  :global(.message-detail-modal .message-detail-overview__title),
  :global(.message-detail-modal .message-detail-overview__subtitle) {
    white-space: normal;
  }
}
</style>
