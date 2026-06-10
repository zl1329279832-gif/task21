// Template and submission JSON schema validation
export const FIELD_TYPES = [
  'text', 'number', 'date', 'radio', 'checkbox',
  'attachment', 'addressCascade', 'detailTable', 'groupDesc'
];

export const OPERATORS = [
  'equals', 'notEquals', 'contains', 'notContains',
  'greaterThan', 'lessThan', 'greaterEqual', 'lessEqual',
  'isEmpty', 'isNotEmpty', 'in', 'notIn'
];

export const CONDITION_ACTIONS = ['show', 'hide'];

export function validateTemplateJSON(json) {
  const errors = [];
  if (!json || typeof json !== 'object') {
    errors.push({ path: '', message: '模板必须是一个JSON对象' });
    return { valid: false, errors };
  }
  if (!json.templateId || typeof json.templateId !== 'string') {
    errors.push({ path: 'templateId', message: '缺少模板ID或格式不正确' });
  }
  if (!json.name || typeof json.name !== 'string') {
    errors.push({ path: 'name', message: '缺少模板名称' });
  }
  if (typeof json.currentVersion !== 'number' || json.currentVersion < 0) {
    errors.push({ path: 'currentVersion', message: '版本号必须是非负整数' });
  }
  if (!Array.isArray(json.fields)) {
    errors.push({ path: 'fields', message: 'fields必须是数组' });
  } else {
    const fieldIds = new Set();
    json.fields.forEach((field, i) => {
      const fp = `fields[${i}]`;
      if (!field.fieldId) {
        errors.push({ path: `${fp}.fieldId`, message: `第${i + 1}个字段缺少fieldId` });
      } else if (fieldIds.has(field.fieldId)) {
        errors.push({ path: `${fp}.fieldId`, message: `fieldId "${field.fieldId}" 重复` });
      } else {
        fieldIds.add(field.fieldId);
      }
      if (!FIELD_TYPES.includes(field.type)) {
        errors.push({ path: `${fp}.type`, message: `不支持的字段类型 "${field.type}"` });
      }
      if (!field.label || typeof field.label !== 'string') {
        errors.push({ path: `${fp}.label`, message: `第${i + 1}个字段缺少label` });
      }
      if (typeof field.order !== 'number') {
        errors.push({ path: `${fp}.order`, message: `第${i + 1}个字段缺少order` });
      }
      if (field.conditions && Array.isArray(field.conditions)) {
        field.conditions.forEach((cond, ci) => {
          if (!cond.sourceFieldId) {
            errors.push({ path: `${fp}.conditions[${ci}].sourceFieldId`, message: '条件缺少源字段ID' });
          }
          if (!OPERATORS.includes(cond.operator)) {
            errors.push({ path: `${fp}.conditions[${ci}].operator`, message: `不支持的操作符 "${cond.operator}"` });
          }
        });
      }
      if (field.type === 'detailTable' && !Array.isArray(field.columns)) {
        errors.push({ path: `${fp}.columns`, message: '明细表格必须包含columns数组' });
      }
      if (field.type === 'radio' || field.type === 'checkbox') {
        if (!field.options || !Array.isArray(field.options) || field.options.length === 0) {
          errors.push({ path: `${fp}.options`, message: `${field.type}字段必须包含options` });
        }
      }
    });
  }
  if (json.versions && !Array.isArray(json.versions)) {
    errors.push({ path: 'versions', message: 'versions必须是数组' });
  }
  return { valid: errors.length === 0, errors };
}

export function validateSubmissionJSON(json) {
  const errors = [];
  if (!json || typeof json !== 'object') {
    errors.push({ path: '', message: '提交数据必须是一个JSON对象' });
    return { valid: false, errors };
  }
  if (!json.submissionId) errors.push({ path: 'submissionId', message: '缺少提交ID' });
  if (!json.templateId) errors.push({ path: 'templateId', message: '缺少模板ID' });
  if (typeof json.templateVersion !== 'number') errors.push({ path: 'templateVersion', message: '缺少模板版本号' });
  if (!['draft', 'submitted', 'returned'].includes(json.status)) {
    errors.push({ path: 'status', message: '状态必须是 draft/submitted/returned' });
  }
  if (!json.values || typeof json.values !== 'object') {
    errors.push({ path: 'values', message: 'values必须是对象' });
  }
  return { valid: errors.length === 0, errors };
}

export function createEmptyTemplate(name = '新建表单') {
  return {
    templateId: '',
    name,
    description: '',
    currentVersion: 0,
    versions: [],
    fields: [],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };
}

export function createEmptySubmission(templateId, templateVersion) {
  return {
    submissionId: '',
    templateId,
    templateVersion,
    status: 'draft',
    values: {},
    orphanedValues: {},
    history: [],
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submittedAt: null,
      returnedAt: null,
      returnReason: ''
    }
  };
}
