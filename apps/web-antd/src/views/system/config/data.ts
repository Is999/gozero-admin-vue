import type { VbenFormSchema } from '#/adapter/form';
import type { OnActionClickFn, VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemConfigApi } from '#/api/system';

import { buildClampTextColumn } from '#/adapter/vxe-table';
import {
  asActionPermission,
  SYSTEM_ACTION_PERMISSION_CODES,
} from '#/constants/permission-codes';
import { $t } from '#/locales';

import {
  configLevelTagMeta,
  configTypeTagMap,
  countTagMeta,
} from '../table-tags';

// configTypeOptions 返回字典配置类型，避免语言切换后沿用模块初始化时的旧文案。
function configTypeOptions() {
  return [
    { label: $t('business.message.configTypeGroup'), value: 0 },
    { label: $t('business.message.configTypeObject'), value: 1 },
    { label: $t('business.message.configTypeArray'), value: 2 },
    { label: $t('business.message.configTypeString'), value: 3 },
    { label: $t('business.message.configTypeInteger'), value: 4 },
    { label: $t('business.message.configTypeFloat'), value: 5 },
    { label: $t('business.message.configTypeBoolean'), value: 6 },
  ];
}

// rootConfigOption 返回字典配置树顶级节点选项。
function rootConfigOption(): Array<Record<string, any>> {
  return [
    {
      children: [] as Array<Record<string, any>>,
      id: 0,
      title: $t('business.message.rootConfig'),
    },
  ];
}

// useFormSchema 返回字典管理新增与编辑表单配置。
export function useFormSchema(
  configTree: Array<Record<string, any>> = rootConfigOption(),
): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'uuid',
      label: $t('business.message.configUuid'),
      rules: 'required',
      componentProps: {
        maxlength: 100,
        showCount: true,
      },
    },
    {
      component: 'Input',
      fieldName: 'title',
      label: $t('business.message.configTitle'),
      rules: 'required',
    },
    {
      component: 'Select',
      defaultValue: 1,
      fieldName: 'type',
      label: $t('business.message.configType'),
      rules: 'required',
      componentProps: {
        options: configTypeOptions(),
        style: { width: '100%' },
      },
      formItemClass: 'col-span-1',
    },
    {
      component: 'TreeSelect',
      defaultValue: 0,
      fieldName: 'pid',
      help: $t('business.message.parentConfigHelp'),
      label: $t('business.message.parentConfig'),
      componentProps: {
        allowClear: false,
        fieldNames: {
          children: 'children',
          label: 'title',
          value: 'id',
        },
        style: { width: '100%' },
        treeData: configTree,
        treeDefaultExpandAll: true,
      },
      formItemClass: 'col-span-1',
    },
    {
      component: 'Input',
      fieldName: 'page',
      label: $t('business.message.pagePath'),
    },
    {
      component: 'Textarea',
      fieldName: 'remark',
      label: $t('business.message.remarkDescription'),
    },
    {
      component: 'JsonEditor',
      fieldName: 'example',
      label: $t('business.message.dictExample'),
      componentProps: {
        rows: 12,
      },
    },
    {
      component: 'JsonEditor',
      fieldName: 'value',
      help: $t('business.message.dictValueHelp'),
      label: $t('business.message.dictValue'),
      rules: 'required',
      componentProps: {
        rows: 12,
      },
    },
  ];
}

// useGridFormSchema 返回字典管理列表搜索表单配置。
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'uuid',
      label: $t('business.message.configUuid'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByConfigUuid'),
      },
    },
    {
      component: 'Input',
      fieldName: 'title',
      label: $t('business.message.configTitle'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByConfigTitle'),
      },
    },
    {
      component: 'Input',
      fieldName: 'pagePath',
      label: $t('business.message.pagePath'),
      componentProps: {
        allowClear: true,
        placeholder: $t('business.message.filterByPagePath'),
      },
    },
  ];
}

// formatJsonValue 将配置值格式化为表格中的短文本。
function formatJsonValue(value: any, space?: number) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, space);
}

// useColumns 返回字典管理表格列配置。
export function useColumns<T = SystemConfigApi.Item>(
  onActionClick: OnActionClickFn<T>,
): VxeTableGridOptions['columns'] {
  return [
    buildClampTextColumn({
      field: 'id',
      fixed: 'left',
      title: 'ID',
      width: 80,
    }),
    buildClampTextColumn({
      field: 'title',
      fixed: 'left',
      minWidth: 220,
      treeNode: true,
      title: $t('business.message.dictTitle'),
    }),
    buildClampTextColumn(
      { field: 'uuid', minWidth: 180, title: $t('business.message.dictUuid') },
      {
        copyButtonText: $t('business.message.copyUuid'),
        copyEmptyMessage: $t('business.message.noDictionaryUuidToCopy'),
        copySuccessMessage: $t('business.message.dictionaryUuidCopied'),
        dblclickCopySuccessMessage: $t('business.message.dictionaryUuidCopied'),
        emptyDblclickCopyMessage: $t('business.message.noDictionaryUuidToCopy'),
      },
    ),
    {
      align: 'center',
      cellRender: {
        attrs: { tagMap: configTypeTagMap() },
        name: 'CellTag',
      },
      field: 'type',
      title: $t('business.message.type'),
      width: 100,
    },
    buildClampTextColumn({
      field: 'parentTitle',
      minWidth: 140,
      title: $t('business.message.parentConfig'),
    }),
    {
      align: 'center',
      cellRender: {
        attrs: {
          getMeta: ({ value }: { value: unknown }) => configLevelTagMeta(value),
        },
        name: 'CellTag',
      },
      field: 'levelText',
      title: $t('business.message.level'),
      width: 90,
    },
    {
      field: 'pageLink',
      align: 'center',
      cellRender: {
        attrs: {
          copyButtonText: $t('business.message.copyPagePath'),
          copySuccessMessage: $t('business.message.pagePathCopied'),
          labelField: 'pageLinkLabel',
        },
        name: 'CellRoutePathLink',
      },
      minWidth: 140,
      showOverflow: false,
      title: $t('business.message.pagePath'),
    },
    buildClampTextColumn({
      field: 'groupPath',
      minWidth: 220,
      title: $t('business.message.configPath'),
    }),
    buildClampTextColumn(
      {
        field: 'value',
        minWidth: 220,
        title: $t('business.message.dictValue'),
      },
      {
        copyButtonText: $t('business.message.copyDictValue'),
        copyEmptyMessage: $t('business.message.noDictionaryValueToCopy'),
        copySuccessMessage: $t('business.message.dictionaryValueCopied'),
        dblclickCopySuccessMessage: $t(
          'business.message.dictionaryValueCopied',
        ),
        emptyDblclickCopyMessage: $t(
          'business.message.noDictionaryValueToCopy',
        ),
        getText: ({ row }) =>
          formatJsonValue((row as SystemConfigApi.Item).value, 2),
      },
    ),
    {
      align: 'center',
      cellRender: {
        attrs: {
          getMeta: ({ value }: { value: unknown }) =>
            countTagMeta(value, 'processing'),
        },
        name: 'CellTag',
      },
      field: 'version',
      title: $t('business.message.version'),
      width: 90,
    },
    buildClampTextColumn({
      field: 'remark',
      minWidth: 180,
      title: $t('business.message.remarkDescription'),
    }),
    buildClampTextColumn({
      field: 'updatedAt',
      minWidth: 170,
      title: $t('business.message.updatedAt'),
    }),
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
            code: 'edit',
            icon: 'edit',
            iconOnly: true,
            text: $t('business.message.edit'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.SYSTEM_CONFIG_UPDATE,
            ),
          },
          {
            code: 'cache',
            icon: 'search',
            iconOnly: true,
            text: $t('business.message.cacheManagement'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.CACHE_KEY_INFO,
            ),
          },
          {
            code: 'viewCache',
            icon: 'detail',
            iconOnly: true,
            text: $t('business.message.viewCache'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.SYSTEM_CONFIG_CACHE,
            ),
          },
          {
            code: 'refreshCache',
            icon: 'reload',
            iconOnly: true,
            text: $t('business.message.refreshCache'),
            auth: asActionPermission(
              SYSTEM_ACTION_PERMISSION_CODES.SYSTEM_CONFIG_RENEW,
            ),
          },
        ],
      },
      field: 'operation',
      fixed: 'right',
      headerAlign: 'center',
      showOverflow: false,
      title: $t('business.message.operation'),
      width: 76,
    },
  ];
}
