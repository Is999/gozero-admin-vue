import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemDocPermissionApi } from '#/api/system';

import { h } from 'vue';

import { useAccess } from '@vben/access';

import { Switch, Tag } from 'ant-design-vue';

import { buildClampTextColumn } from '#/adapter/vxe-table';
import {
  asActionPermission,
  SYSTEM_ACTION_PERMISSION_CODES,
} from '#/constants/permission-codes';
import { $t } from '#/locales';

// docPermissionStatusOptions 返回文档权限状态筛选项。
function docPermissionStatusOptions() {
  return [
    { label: $t('business.message.enable'), value: 1 },
    { label: $t('business.message.disable'), value: 0 },
  ];
}

// docSiteOptions 返回文档站筛选项。
function docSiteOptions() {
  return [
    { label: $t('business.message.adminDocSite'), value: 'admin' },
    { label: $t('business.message.apiDocSite'), value: 'api' },
  ];
}

// useDocPermissionGridFormSchema 返回文档权限列表筛选表单。
export function useDocPermissionGridFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'title',
      label: $t('business.message.docPermissionTitle'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByDocPermissionTitle'),
      },
    },
    {
      component: 'Select',
      fieldName: 'site',
      label: $t('business.message.docPermissionSite'),
      componentProps: {
        allowClear: true,
        options: docSiteOptions(),
        placeholder: $t('business.message.filterByDocPermissionSite'),
      },
    },
    {
      component: 'Input',
      fieldName: 'path',
      label: $t('business.message.docPermissionPath'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByDocPermissionPath'),
      },
    },
    {
      component: 'Select',
      fieldName: 'status',
      label: $t('business.message.status'),
      componentProps: {
        allowClear: true,
        options: docPermissionStatusOptions(),
        placeholder: $t('business.message.filterByStatus'),
      },
    },
  ];
}

// useDocPermissionColumns 返回文档权限管理表格列。
export function useDocPermissionColumns(
  onStatusChange: (
    newStatus: number,
    row: SystemDocPermissionApi.Item,
  ) => PromiseLike<boolean | undefined>,
): VxeTableGridOptions['columns'] {
  const { hasAccessByCodes } = useAccess();
  const canUpdateStatus = hasAccessByCodes(
    asActionPermission(
      SYSTEM_ACTION_PERMISSION_CODES.DOC_PERMISSION_STATUS_UPDATE,
    ),
  );

  return [
    {
      align: 'center',
      field: 'id',
      fixed: 'left',
      title: 'ID',
      width: 90,
    },
    {
      field: 'title',
      fixed: 'left',
      minWidth: 220,
      title: $t('business.message.docPermissionTitle'),
    },
    {
      align: 'center',
      field: 'site',
      slots: {
        default: ({ row }: { row: SystemDocPermissionApi.Item }) =>
          h(
            Tag,
            { color: row.site === 'api' ? 'purple' : 'blue' },
            {
              default: () =>
                row.site === 'api'
                  ? $t('business.message.apiDocSite')
                  : $t('business.message.adminDocSite'),
            },
          ),
      },
      title: $t('business.message.docPermissionSite'),
      width: 140,
    },
    buildClampTextColumn({
      field: 'path',
      minWidth: 360,
      title: $t('business.message.docPermissionPath'),
    }),
    {
      align: 'center',
      field: 'status',
      slots: {
        default: ({ row }: { row: SystemDocPermissionApi.Item }) =>
          h(Switch, {
            checked: row.status === 1,
            checkedChildren: $t('business.message.enable'),
            disabled: !canUpdateStatus,
            key: `doc-permission-status-${row.id}-${row.status}`,
            unCheckedChildren: $t('business.message.disable'),
            async onChange(checked: any) {
              const nextStatus = checked ? 1 : 0;
              const allowChange = await onStatusChange(nextStatus, row);
              if (allowChange !== false) {
                row.status = nextStatus;
              }
            },
          }),
      },
      title: $t('business.message.status'),
      width: 140,
    },
    buildClampTextColumn({
      field: 'description',
      minWidth: 280,
      title: $t('business.message.description'),
    }),
    {
      align: 'center',
      field: 'updatedAt',
      minWidth: 180,
      title: $t('business.message.updatedAt'),
    },
  ];
}
