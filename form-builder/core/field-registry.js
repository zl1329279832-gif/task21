// Field type registry - maps type strings to metadata and defaults
import { generateId } from '../utils/id-generator.js';

const FIELD_DEFS = {
  text: {
    tag: 'ff-text',
    label: '文本输入',
    icon: 'T',
    category: 'basic',
    defaultConfig: { required: false, maxLength: 200, minLength: 0, regex: '', regexMessage: '', placeholder: '' },
    defaultValue: ''
  },
  number: {
    tag: 'ff-number',
    label: '数字输入',
    icon: '#',
    category: 'basic',
    defaultConfig: { required: false, min: null, max: null, step: 1, precision: 0 },
    defaultValue: null
  },
  date: {
    tag: 'ff-date',
    label: '日期选择',
    icon: 'D',
    category: 'basic',
    defaultConfig: { required: false, minDate: '', maxDate: '', format: 'YYYY-MM-DD' },
    defaultValue: ''
  },
  radio: {
    tag: 'ff-radio',
    label: '单选',
    icon: '◉',
    category: 'choice',
    defaultConfig: { required: false },
    defaultOptions: [
      { value: 'option1', label: '选项1' },
      { value: 'option2', label: '选项2' }
    ],
    defaultValue: ''
  },
  checkbox: {
    tag: 'ff-checkbox',
    label: '多选',
    icon: '☑',
    category: 'choice',
    defaultConfig: { required: false, minSelect: 0, maxSelect: 0 },
    defaultOptions: [
      { value: 'option1', label: '选项1' },
      { value: 'option2', label: '选项2' }
    ],
    defaultValue: []
  },
  attachment: {
    tag: 'ff-attachment',
    label: '附件上传',
    icon: '📎',
    category: 'advanced',
    defaultConfig: { required: false, maxFiles: 5, accept: '', maxSizeMB: 10 },
    defaultValue: []
  },
  addressCascade: {
    tag: 'ff-address',
    label: '地址级联',
    icon: '⌂',
    category: 'advanced',
    defaultConfig: { required: false, levels: 3, showDetail: true },
    defaultValue: { province: '', city: '', district: '', detail: '' }
  },
  detailTable: {
    tag: 'ff-detail-table',
    label: '明细表格',
    icon: '▦',
    category: 'advanced',
    defaultConfig: { required: false, minRows: 0, maxRows: 50 },
    defaultColumns: [
      { columnId: '', type: 'text', label: '列1', config: { required: false, maxLength: 100 } }
    ],
    defaultValue: []
  },
  groupDesc: {
    tag: 'ff-group-desc',
    label: '分组说明',
    icon: '§',
    category: 'layout',
    defaultConfig: { description: '', collapsible: false, defaultCollapsed: false },
    defaultValue: null
  }
};

class FieldRegistry {
  getTypes() {
    return Object.keys(FIELD_DEFS);
  }

  getDefinition(type) {
    return FIELD_DEFS[type] || null;
  }

  getTag(type) {
    return FIELD_DEFS[type]?.tag || null;
  }

  getLabel(type) {
    return FIELD_DEFS[type]?.label || type;
  }

  getIcon(type) {
    return FIELD_DEFS[type]?.icon || '?';
  }

  getByCategory(category) {
    return Object.entries(FIELD_DEFS)
      .filter(([, def]) => def.category === category)
      .map(([type]) => type);
  }

  getCategories() {
    return [
      { key: 'basic', label: '基础字段' },
      { key: 'choice', label: '选择字段' },
      { key: 'advanced', label: '高级字段' },
      { key: 'layout', label: '布局字段' }
    ];
  }

  createFieldDef(type, order = 0) {
    const def = FIELD_DEFS[type];
    if (!def) throw new Error(`Unknown field type: ${type}`);

    const field = {
      fieldId: generateId('fld'),
      type,
      label: def.label,
      order,
      config: { ...def.defaultConfig },
      defaultValue: structuredClone(def.defaultValue),
      conditions: [],
      crossValidation: [],
      errorMessages: {},
      _deleted: false,
      _deletedAt: null
    };

    if (def.defaultOptions) {
      field.options = def.defaultOptions.map(opt => ({
        ...opt,
        value: generateId('opt')
      }));
    }

    if (def.defaultColumns) {
      field.columns = def.defaultColumns.map(col => ({
        ...col,
        columnId: generateId('col')
      }));
      field.tableValidation = [];
    }

    if (type === 'groupDesc') {
      field.childFieldIds = [];
    }

    return field;
  }
}

export const fieldRegistry = new FieldRegistry();
