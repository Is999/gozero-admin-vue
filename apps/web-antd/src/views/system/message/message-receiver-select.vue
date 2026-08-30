<script setup lang="ts">
import type { SelectValue } from 'ant-design-vue/es/select';

import type { AdminMessageApi } from '#/api/message';

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { Select } from 'ant-design-vue';

import { fetchAdminMessageReceiverOptions } from '#/api/message';

// ReceiverSelectOption 表示远程收件人查询映射后的 Ant Select 选项。
interface ReceiverSelectOption {
  label: string; // 用户可见的姓名与账号组合。
  value: number; // 后端管理员 ID，提交时保持 number[] 契约。
}

const props = defineProps<{
  disabled?: boolean;
  modelValue?: number[];
  placeholder?: string;
  presetOptions?: AdminMessageApi.ReceiverOptionItem[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number[]];
}>();

// receiverPageSize 固定每次最多读取 50 人，避免打开抽屉时加载全部管理员。
const receiverPageSize = 50;
// receiverSearchDelayMs 合并连续键入，减少姓名搜索对数据库的瞬时请求数。
const receiverSearchDelayMs = 300;

// queryVersion 标识当前搜索代次，旧请求返回后不得覆盖新关键字结果。
let queryVersion = 0;
// searchTimer 保存输入防抖定时器，组件卸载时必须清理。
let searchTimer: ReturnType<typeof setTimeout> | undefined;
const keyword = ref('');
const loading = ref(false);
const page = ref(0);
const total = ref(0);
const remoteOptions = ref<ReceiverSelectOption[]>([]);

// formatReceiverOption 把后端最小字段转换成稳定标签；姓名为空时只展示账号。
function formatReceiverOption(
  item: AdminMessageApi.ReceiverOptionItem,
): ReceiverSelectOption {
  return {
    label: item.realName
      ? `${item.realName}（${item.username}）`
      : item.username,
    value: item.id,
  };
}

// options 合并远程结果、回复预置项和已选值，搜索翻页时不会让已选标签退化成裸 ID。
const options = computed(() => {
  const optionByID = new Map<number, ReceiverSelectOption>();
  for (const item of props.presetOptions || []) {
    const option = formatReceiverOption(item);
    optionByID.set(option.value, option);
  }
  for (const option of remoteOptions.value) {
    optionByID.set(option.value, option);
  }
  for (const adminID of props.modelValue || []) {
    if (!optionByID.has(adminID)) {
      optionByID.set(adminID, { label: String(adminID), value: adminID });
    }
  }
  return [...optionByID.values()];
});

// fetchFirstPage 切换关键字后重置分页；只接受当前代次响应，避免慢请求产生结果倒灌。
async function fetchFirstPage(nextKeyword: string) {
  const version = ++queryVersion;
  keyword.value = nextKeyword.trim();
  loading.value = true;
  try {
    const result = await fetchAdminMessageReceiverOptions({
      keyword: keyword.value || undefined,
      page: 1,
      pageSize: receiverPageSize,
    });
    if (version !== queryVersion) {
      return;
    }
    remoteOptions.value = result.list.map((item) => formatReceiverOption(item));
    page.value = 1;
    total.value = result.total;
  } catch {
    if (version === queryVersion) {
      remoteOptions.value = [];
      page.value = 0;
      total.value = 0;
    }
  } finally {
    if (version === queryVersion) {
      loading.value = false;
    }
  }
}

// fetchNextPage 在同一搜索代次内追加下一页，并按管理员 ID 去重。
async function fetchNextPage() {
  if (loading.value || remoteOptions.value.length >= total.value) {
    return;
  }
  const version = queryVersion;
  const nextPage = page.value + 1;
  loading.value = true;
  try {
    const result = await fetchAdminMessageReceiverOptions({
      keyword: keyword.value || undefined,
      page: nextPage,
      pageSize: receiverPageSize,
    });
    if (version !== queryVersion) {
      return;
    }
    const optionByID = new Map(
      remoteOptions.value.map((option) => [option.value, option]),
    );
    for (const item of result.list) {
      const option = formatReceiverOption(item);
      optionByID.set(option.value, option);
    }
    remoteOptions.value = [...optionByID.values()];
    page.value = nextPage;
    total.value = result.total;
  } catch {
    // 请求拦截器负责向用户展示错误；保留已加载选项，使下次滚动仍可重试当前页。
  } finally {
    if (version === queryVersion) {
      loading.value = false;
    }
  }
}

// onSearch 防抖触发服务端前缀搜索，前端不再过滤固定 500 人快照。
function onSearch(value: string) {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  // 输入一变化就使在途请求失效，并在防抖窗口禁止旧关键字继续翻页，避免结果短暂倒灌。
  queryVersion += 1;
  loading.value = true;
  searchTimer = setTimeout(() => {
    void fetchFirstPage(value);
  }, receiverSearchDelayMs);
}

// onPopupScroll 接近下拉底部时读取下一页，单次响应仍受后端 pageSize 上限保护。
function onPopupScroll(event: Event) {
  const target = event.target as HTMLElement;
  if (target.scrollTop + target.clientHeight >= target.scrollHeight - 24) {
    void fetchNextPage();
  }
}

// onChange 收口 Ant Select 的联合值类型，只向表单提交正整数管理员 ID 数组。
function onChange(value: SelectValue) {
  if (!Array.isArray(value)) {
    emit('update:modelValue', []);
    return;
  }
  const adminIDs = value.filter(
    (item): item is number =>
      typeof item === 'number' && Number.isSafeInteger(item) && item > 0,
  );
  emit('update:modelValue', adminIDs);
}

onMounted(() => {
  void fetchFirstPage('');
});

onBeforeUnmount(() => {
  queryVersion += 1;
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
});
</script>

<template>
  <Select
    allow-clear
    :disabled="disabled"
    :filter-option="false"
    :loading="loading"
    :max-tag-count="3"
    :model-value="modelValue"
    :options="options"
    :placeholder="placeholder"
    mode="multiple"
    show-search
    class="w-full"
    @change="onChange"
    @popup-scroll="onPopupScroll"
    @search="onSearch"
  />
</template>
