<script lang="ts" setup>
import type { SystemSecretKeyApi } from '#/api/system';

import { computed, ref } from 'vue';

import { useVbenDrawer } from '@vben/common-ui';

import {
  Alert,
  Button,
  Descriptions,
  message,
  Space,
  Tag,
} from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import {
  createSecretKey,
  fetchSecretKeyDetail,
  selfCheckSecretKey,
  updateSecretKey,
  validateSecretKeyPaths,
} from '#/api/system';
import { $t } from '#/locales';
import { showCacheSyncResult } from '#/utils/cache/sync';
import { downloadBlobFile } from '#/utils/file/download';
import { generateLocalRSAPemPair } from '#/utils/security/crypto';
import { submitWithMfaRetry, ticketPayload } from '#/utils/security/mfa';

import FormTips from '../../components/form-tips.vue';
import { useFormSchema } from '../data';

const emit = defineEmits<{ success: [] }>();
// MFA_SCENARIO_SECRET_KEY_MANAGE 表示秘钥管理二次校验场景。
const MFA_SCENARIO_SECRET_KEY_MANAGE = 11;
const formData = ref<Partial<SystemSecretKeyApi.Item>>({});
const validateResult = ref<null | SystemSecretKeyApi.CheckResult>(null);
const validateBusy = ref(false);
const versionList = ref<SystemSecretKeyApi.VersionItem[]>([]);
const localRSAResult = ref<null | {
  generatedAt: string;
  privateFileName: string;
  publicFileName: string;
}>(null);

interface SecretKeyDrawerData extends Partial<SystemSecretKeyApi.Item> {
  initialCheckResult?: SystemSecretKeyApi.CheckResult;
}

const [Form, formApi] = useVbenForm({
  commonConfig: {
    colon: true,
    formItemClass: 'col-span-2 md:col-span-1',
  },
  schema: useFormSchema(),
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2',
});

const [Drawer, drawerApi] = useVbenDrawer({
  onConfirm: onSubmit,
  async onOpenChange(isOpen) {
    if (!isOpen) {
      return;
    }
    const data = drawerApi.getData<SecretKeyDrawerData>();
    formApi.resetForm();
    validateResult.value = data?.initialCheckResult || null;
    localRSAResult.value = null;
    versionList.value = [];
    formData.value = data?.id ? data : {};
    formApi.updateSchema(useFormSchema(Boolean(data?.id)));
    if (data?.id) {
      const detail = await submitWithMfaRetry(
        MFA_SCENARIO_SECRET_KEY_MANAGE,
        (ticket) =>
          fetchSecretKeyDetail(data.id!, {
            keyVersion: data.keyVersion,
            ...ticketPayload(ticket),
          }),
        $t('business.message.secretDetailMfaTitle'),
      );
      applyDetail(detail);
      return;
    }
    formApi.setValues({
      cryptoStatus: 1,
      grayPercent: 0,
      signStatus: 1,
      status: 0,
      versionStatus: 0,
    });
  },
});

const getDrawerTitle = computed(() =>
  formData.value?.id
    ? $t('business.message.secretEditTitle')
    : $t('business.message.secretAddTitle'),
);
const isEditMode = computed(() => Boolean(formData.value?.id));

const drawerIntroTitle = computed(() =>
  formData.value?.id
    ? $t('business.message.secretEditModeTitle')
    : $t('business.message.secretAddModeTitle'),
);

const drawerIntroDescription = computed(() =>
  formData.value?.id
    ? $t('business.message.secretEditModeDesc')
    : $t('business.message.secretAddModeDesc'),
);

const editDangerDescription = computed(() =>
  $t('business.message.secretEditRiskDesc'),
);

const formTips = computed(() => [
  {
    description: $t('business.message.secretTipIdentifierDesc'),
    title: $t('business.message.secretTipIdentifierTitle'),
  },
  {
    description: $t('business.message.secretTipPathModeDesc'),
    title: $t('business.message.secretTipPathModeTitle'),
  },
  {
    description: $t('business.message.secretTipDirectoryDesc'),
    title: $t('business.message.secretTipDirectoryTitle'),
  },
  {
    description: $t('business.message.secretTipEnableCheckDesc'),
    title: $t('business.message.secretTipEnableCheckTitle'),
  },
  {
    description: $t('business.message.secretTipSecuritySwitchDesc'),
    title: $t('business.message.secretTipSecuritySwitchTitle'),
  },
]);

function buildSecretUUID() {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return `app-${Array.from(bytes, (item) => item.toString(16).padStart(2, '0')).join('')}`;
}

function applyDetail(detail: SystemSecretKeyApi.Item) {
  versionList.value = detail.versionList || [];
  formData.value = detail;
  formApi.setValues(detail);
}

function versionTagColor(version: SystemSecretKeyApi.VersionItem) {
  if (version.isStable && version.isGray) {
    return 'processing';
  }
  if (version.isStable) {
    return 'success';
  }
  if (version.isGray) {
    return 'gold';
  }
  return version.status === 1 ? 'default' : 'error';
}

async function getCurrentValues() {
  return await formApi.getValues<SystemSecretKeyApi.SaveParams>();
}

// validateSecuritySwitches 提前反馈后端安全契约，最终权威校验仍由服务端执行。
function validateSecuritySwitches(values: SystemSecretKeyApi.SaveParams) {
  if (values.cryptoStatus === 1 && values.signStatus !== 1) {
    message.error($t('business.message.secretCryptoRequiresSigning'));
    return false;
  }
  return true;
}

async function onGenerateSecretUUID() {
  await formApi.setFieldValue('uuid', buildSecretUUID(), false);
  message.success($t('business.message.secretIdentifierGenerated'));
}

async function onLoadVersion(version: SystemSecretKeyApi.VersionItem) {
  const currentValues = await getCurrentValues();
  const nextValues: SystemSecretKeyApi.SaveParams = {
    ...currentValues,
    aesIvRef: version.aesIvRef,
    aesKeyRef: version.aesKeyRef,
    keyVersion: version.keyVersion,
    remark: version.remark || currentValues.remark,
    rsaPrivateKeyServerRef: version.rsaPrivateKeyServerRef,
    rsaPublicKeyServerRef: version.rsaPublicKeyServerRef,
    rsaPublicKeyUserRef: version.rsaPublicKeyUserRef,
    versionStatus: version.status,
  };
  formData.value = {
    ...formData.value,
    ...nextValues,
    keyVersion: version.keyVersion,
    versionStatus: version.status,
  };
  validateResult.value = null;
  await formApi.setValues(nextValues);
}

function resultTagColor(item: SystemSecretKeyApi.CheckItem) {
  return item.passed ? 'success' : 'error';
}

async function runValidation(mode: 'self-check' | 'validate') {
  const { valid } = await formApi.validate();
  if (!valid) {
    return null;
  }
  const values = await formApi.getValues<SystemSecretKeyApi.SaveParams>();
  if (!validateSecuritySwitches(values)) {
    return null;
  }
  validateBusy.value = true;
  try {
    const result = await submitWithMfaRetry(
      MFA_SCENARIO_SECRET_KEY_MANAGE,
      (ticket) => {
        if (mode === 'self-check' && formData.value.uuid) {
          return selfCheckSecretKey(formData.value.uuid, {
            keyVersion: values.keyVersion,
            ...ticketPayload(ticket),
          });
        }
        return validateSecretKeyPaths({
          ...values,
          ...ticketPayload(ticket),
        });
      },
      mode === 'self-check'
        ? $t('business.message.secretSelfCheckMfaTitle')
        : $t('business.message.secretPathValidateMfaTitle'),
    );
    validateResult.value = result;
    return result;
  } finally {
    validateBusy.value = false;
  }
}

async function onValidatePaths() {
  const result = await runValidation('validate');
  if (result) {
    message.success(
      result.allPassed
        ? $t('business.message.secretPathValidatePassed')
        : $t('business.message.secretPathValidateCompleted'),
    );
  }
}

async function onSelfCheck() {
  if (!formData.value.uuid) {
    message.warning($t('business.message.saveSecretBeforeRuntimeSelfCheck'));
    return;
  }
  const result = await runValidation('self-check');
  if (result) {
    message.success(
      result.allPassed
        ? $t('business.message.secretRuntimeSelfCheckPassed')
        : $t('business.message.secretRuntimeSelfCheckCompleted'),
    );
  }
}

async function onGenerateRSA() {
  const values = await getCurrentValues();
  const safeUUID = String(values.uuid || '')
    .trim()
    .replaceAll(/[^\w.-]+/g, '_');
  const safeVersion = String(values.keyVersion || '')
    .trim()
    .replaceAll(/[^\w.-]+/g, '_');
  const baseName = [safeUUID || 'secret-key', safeVersion || 'local']
    .filter(Boolean)
    .join('_');
  const pair = await generateLocalRSAPemPair();
  const publicFileName = `${baseName}_public.pem`;
  const privateFileName = `${baseName}_private.pem`;
  downloadBlobFile(
    new Blob([pair.publicKeyPem], { type: 'application/x-pem-file' }),
    publicFileName,
  );
  downloadBlobFile(
    new Blob([pair.privateKeyPem], { type: 'application/x-pem-file' }),
    privateFileName,
  );
  localRSAResult.value = {
    generatedAt: new Date().toLocaleString(),
    privateFileName,
    publicFileName,
  };
  message.success($t('business.message.rsaKeyPairGeneratedAndDownloaded'));
}

async function onSubmit() {
  const { valid } = await formApi.validate();
  if (!valid) {
    return;
  }
  const values = await formApi.getValues<SystemSecretKeyApi.SaveParams>();
  if (!validateSecuritySwitches(values)) {
    return;
  }
  const isEdit = Boolean(formData.value?.id);
  drawerApi.lock();
  try {
    const cacheSyncResult = await submitWithMfaRetry(
      MFA_SCENARIO_SECRET_KEY_MANAGE,
      (ticket) =>
        isEdit
          ? updateSecretKey(formData.value.id!, {
              ...values,
              ...ticketPayload(ticket),
            })
          : createSecretKey({
              ...values,
              ...ticketPayload(ticket),
            }),
      isEdit
        ? $t('business.message.secretEditMfaTitle')
        : $t('business.message.secretAddMfaTitle'),
    );
    showCacheSyncResult(
      cacheSyncResult,
      isEdit
        ? $t('business.message.secretEditSucceeded')
        : $t('business.message.secretAddSucceeded'),
    );
    if (!isEdit) {
      validateResult.value = null;
    }
    drawerApi.close();
    emit('success');
  } finally {
    drawerApi.unlock();
  }
}
</script>

<template>
  <Drawer class="w-full max-w-[980px]" :title="getDrawerTitle">
    <Alert
      class="mx-4 mt-4"
      :description="drawerIntroDescription"
      :message="drawerIntroTitle"
      show-icon
      type="info"
    />
    <Alert
      v-if="isEditMode"
      class="mx-4 mt-3"
      :description="editDangerDescription"
      :message="$t('business.message.secretEditDangerAlertTitle')"
      show-icon
      type="error"
    />
    <section
      class="border-[var(--vben-border-color)]/80 mx-4 mt-4 rounded border bg-[var(--vben-background-color)] px-4 py-5"
    >
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div class="grid gap-1">
          <span class="text-base font-semibold text-[var(--vben-text-color)]">
            {{ $t('business.message.secretPathRegistration') }}
          </span>
          <span class="text-sm text-[var(--vben-text-color-secondary)]">
            {{ $t('business.message.secretPathRegistrationDesc') }}
          </span>
        </div>
        <Space v-if="!isEditMode" :size="8" wrap>
          <Button type="primary" @click="onGenerateSecretUUID">
            {{ $t('business.message.secretGenerateIdentifier') }}
          </Button>
        </Space>
        <Space :size="8" wrap>
          <Button :loading="validateBusy" @click="onValidatePaths">
            {{ $t('business.message.secretPathValidate') }}
          </Button>
          <Button
            v-if="isEditMode"
            :loading="validateBusy"
            type="primary"
            @click="onSelfCheck"
          >
            {{ $t('business.message.secretRunSelfCheck') }}
          </Button>
        </Space>
      </div>
      <section
        v-if="isEditMode && versionList.length > 0"
        class="border-[var(--vben-border-color)]/80 mb-4 rounded border px-4 py-3"
      >
        <div class="mb-2 text-sm font-medium text-[var(--vben-text-color)]">
          {{ $t('business.message.secretExistingVersions') }}
        </div>
        <Space :size="[8, 8]" wrap>
          <Button
            v-for="version in versionList"
            :key="version.id"
            size="small"
            :type="
              version.keyVersion === formData.keyVersion ? 'primary' : 'default'
            "
            @click="onLoadVersion(version)"
          >
            {{ version.keyVersion }}
          </Button>
        </Space>
        <Space class="mt-2" :size="[8, 8]" wrap>
          <Tag
            v-for="version in versionList"
            :key="`${version.id}-tag`"
            :color="versionTagColor(version)"
          >
            {{ version.keyVersion }}
            <template v-if="version.isStable">
              / {{ $t('business.message.secretStable') }}
            </template>
            <template v-if="version.isGray">
              / {{ $t('business.message.secretGray') }}
            </template>
          </Tag>
        </Space>
      </section>
      <section
        class="border-[var(--vben-border-color)]/80 mb-4 rounded border px-4 py-3"
      >
        <div class="mb-2 text-sm font-medium text-[var(--vben-text-color)]">
          {{ $t('business.message.secretLocalRsaTool') }}
        </div>
        <div class="mb-3 text-sm text-[var(--vben-text-color-secondary)]">
          {{ $t('business.message.secretLocalRsaDesc') }}
        </div>
        <Space :size="[8, 8]" wrap>
          <Button @click="onGenerateRSA">
            {{ $t('business.message.secretGenerateDownloadRsa') }}
          </Button>
        </Space>
        <Descriptions
          v-if="localRSAResult"
          class="mt-3"
          :column="2"
          bordered
          size="small"
        >
          <Descriptions.Item
            :label="$t('business.message.secretGeneratedLocation')"
            :span="2"
          >
            {{ $t('business.message.secretBrowserLocal') }}
          </Descriptions.Item>
          <Descriptions.Item
            :label="$t('business.message.secretPublicFileName')"
          >
            {{ localRSAResult.publicFileName }}
          </Descriptions.Item>
          <Descriptions.Item
            :label="$t('business.message.secretPrivateFileName')"
          >
            {{ localRSAResult.privateFileName }}
          </Descriptions.Item>
          <Descriptions.Item
            :label="$t('business.message.secretGeneratedAt')"
            :span="2"
          >
            {{ localRSAResult.generatedAt }}
          </Descriptions.Item>
        </Descriptions>
      </section>
      <div
        class="mb-4 rounded border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-500 dark:text-red-400"
      >
        <span class="font-semibold">
          {{ $t('business.message.secretHighRiskPrefix') }}
        </span>
        {{ $t('business.message.secretHighRiskDesc') }}
      </div>
      <Form class="secret-key-form" />
      <section
        v-if="validateResult"
        class="border-[var(--vben-border-color)]/80 mt-4 rounded border bg-[var(--vben-background-color)] px-4 py-4"
      >
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div class="grid gap-1">
            <span class="text-base font-semibold text-[var(--vben-text-color)]">
              {{ $t('business.message.secretValidationResult') }}
            </span>
            <span class="text-sm text-[var(--vben-text-color-secondary)]">
              {{ $t('business.message.secretValidationResultDesc') }}
            </span>
          </div>
          <Space :size="8" wrap>
            <Tag :color="validateResult.allPassed ? 'success' : 'error'">
              {{
                validateResult.allPassed
                  ? $t('business.message.secretAllPassed')
                  : $t('business.message.secretHasIssues')
              }}
            </Tag>
            <Tag
              :color="validateResult.runtimeChecked ? 'processing' : 'default'"
            >
              {{
                validateResult.runtimeChecked
                  ? $t('business.message.secretRuntimeChecked')
                  : $t('business.message.secretStaticPrecheckOnly')
              }}
            </Tag>
          </Space>
        </div>
        <Descriptions :column="2" bordered size="small">
          <Descriptions.Item
            :label="$t('business.message.secretIdentifierLabel')"
          >
            {{ validateResult.uuid || '-' }}
          </Descriptions.Item>
          <Descriptions.Item
            :label="$t('business.message.secretCurrentVersion')"
          >
            {{ validateResult.keyVersion || '-' }}
          </Descriptions.Item>
          <Descriptions.Item :label="$t('business.message.secretCheckMode')">
            {{
              validateResult.mode === 'self_check'
                ? $t('business.message.secretSelfCheckMode')
                : $t('business.message.secretPathCheckMode')
            }}
          </Descriptions.Item>
          <Descriptions.Item :label="$t('business.message.secretCanSave')">
            <Tag :color="validateResult.canSave ? 'success' : 'error'">
              {{
                validateResult.canSave
                  ? $t('business.message.secretAllowed')
                  : $t('business.message.secretNotAllowed')
              }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item :label="$t('business.message.secretCanEnable')">
            <Tag :color="validateResult.canEnable ? 'success' : 'error'">
              {{
                validateResult.canEnable
                  ? $t('business.message.secretAllowed')
                  : $t('business.message.secretNotAllowed')
              }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item :label="$t('business.message.secretCacheRefresh')">
            <Tag :color="validateResult.cacheRefreshed ? 'success' : 'default'">
              {{
                validateResult.cacheRefreshed
                  ? $t('business.message.secretCacheRefreshedStatus')
                  : $t('business.message.secretCacheNotRefreshedStatus')
              }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item :label="$t('business.message.secretDuration')">
            {{ validateResult.durationMs }} ms
          </Descriptions.Item>
          <Descriptions.Item
            :label="$t('business.message.secretCompletedAt')"
            :span="2"
          >
            {{ validateResult.checkedAt || '-' }}
          </Descriptions.Item>
        </Descriptions>
        <div class="mt-4 grid gap-2">
          <div
            v-for="item in validateResult.items"
            :key="item.key"
            class="border-[var(--vben-border-color)]/80 flex flex-wrap items-start gap-2 rounded border px-3 py-2"
          >
            <Tag :color="resultTagColor(item)">
              {{
                item.passed
                  ? $t('business.message.secretCheckPassed')
                  : $t('business.message.secretCheckFailed')
              }}
            </Tag>
            <span class="font-medium text-[var(--vben-text-color)]">{{
              item.label
            }}</span>
            <span class="text-[var(--vben-text-color-secondary)]">{{
              item.message
            }}</span>
          </div>
        </div>
      </section>
    </section>
    <FormTips
      :title="$t('business.message.secretFormTipsTitle')"
      :tips="formTips"
    />
  </Drawer>
</template>
