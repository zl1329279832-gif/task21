// Cross-field and per-field validation engine
import { DependencyGraph } from './dependency-graph.js';

export class ValidationEngine {
  #depGraph = new DependencyGraph();

  buildGraph(fields) {
    this.#depGraph.buildFromFields(fields);
  }

  /**
   * Check if a field is visible given current values and conditions.
   */
  isFieldVisible(fieldDef, allValues, allFields) {
    const conditions = fieldDef.conditions || [];
    if (conditions.length === 0) return true;

    return conditions.every(cond => {
      const sourceValue = allValues[cond.sourceFieldId];
      const met = this.#evaluateCondition(sourceValue, cond.operator, cond.value);
      return cond.action === 'show' ? met : !met;
    });
  }

  /**
   * Validate a single field value.
   */
  validateField(fieldDef, value, allValues) {
    const errors = [];
    const config = fieldDef.config || {};

    // Required check
    if (config.required && this.#isEmpty(value)) {
      errors.push(fieldDef.errorMessages?.required || `${fieldDef.label}不能为空`);
      return { valid: false, errors };
    }

    if (this.#isEmpty(value)) return { valid: true, errors: [] };

    // Type-specific validation
    this.#validateByType(fieldDef, value, config, errors);

    // Cross-field validation
    for (const rule of (fieldDef.crossValidation || [])) {
      const targetValue = allValues[rule.targetFieldId];
      if (!this.#isEmpty(targetValue) && !this.#evaluateOperator(value, targetValue, rule.operator)) {
        errors.push(rule.errorMessage || '跨字段校验不通过');
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate entire form. Uses topological order for dependency-aware evaluation.
   */
  validateForm(fields, values) {
    this.buildGraph(fields);
    const allErrors = new Map();
    const activeFields = fields.filter(f => !f._deleted && f.type !== 'groupDesc');

    for (const field of activeFields) {
      // Skip hidden fields
      if (!this.isFieldVisible(field, values, fields)) continue;

      if (field.type === 'detailTable') {
        const tableResult = this.validateDetailTable(field, values[field.fieldId] || []);
        const tableErrors = [
          ...tableResult.tableErrors,
          ...tableResult.rowErrors.flatMap(r =>
            Object.entries(r.errors).flatMap(([colId, errs]) =>
              errs.map(e => `第${r.rowIndex + 1}行 ${this.#getColLabel(field, colId)}: ${e}`)
            )
          )
        ];
        // Also check table-level required
        if (field.config?.required && (!values[field.fieldId] || values[field.fieldId].length === 0)) {
          tableErrors.unshift(field.errorMessages?.required || `${field.label}至少需要一行数据`);
        }
        if (tableErrors.length > 0) allErrors.set(field.fieldId, tableErrors);
      } else {
        const result = this.validateField(field, values[field.fieldId], values);
        if (!result.valid) allErrors.set(field.fieldId, result.errors);
      }
    }

    return { valid: allErrors.size === 0, errors: allErrors };
  }

  /**
   * Validate a detail table: per-cell, per-row, and table-level rules.
   */
  validateDetailTable(fieldDef, rows) {
    const result = { rowErrors: [], tableErrors: [] };
    const columns = fieldDef.columns || [];

    // Per-cell validation
    (rows || []).forEach((row, ri) => {
      const rowErrors = {};
      for (const col of columns) {
        const cellErrors = this.#validateCell(col, row[col.columnId]);
        if (cellErrors.length > 0) rowErrors[col.columnId] = cellErrors;
      }
      if (Object.keys(rowErrors).length > 0) {
        result.rowErrors.push({ rowIndex: ri, errors: rowErrors });
      }
    });

    // Table-level validation
    for (const rule of (fieldDef.tableValidation || [])) {
      if (rule.type === 'columnSum') {
        const sum = (rows || []).reduce((s, r) => s + (Number(r[rule.columnId]) || 0), 0);
        if (!this.#evaluateOperator(sum, rule.value, rule.operator)) {
          result.tableErrors.push(rule.errorMessage || '表格校验不通过');
        }
      } else if (rule.type === 'uniqueColumn') {
        const vals = (rows || []).map(r => r[rule.columnId]).filter(v => v !== '' && v != null);
        if (new Set(vals).size !== vals.length) {
          result.tableErrors.push(rule.errorMessage || '列值不能重复');
        }
      }
    }

    return result;
  }

  #validateByType(fieldDef, value, config, errors) {
    switch (fieldDef.type) {
      case 'text':
        if (config.minLength && String(value).length < config.minLength) {
          errors.push(fieldDef.errorMessages?.range || `最少输入${config.minLength}个字符`);
        }
        if (config.maxLength && String(value).length > config.maxLength) {
          errors.push(fieldDef.errorMessages?.range || `最多输入${config.maxLength}个字符`);
        }
        if (config.regex) {
          try {
            if (!new RegExp(config.regex).test(value)) {
              errors.push(config.regexMessage || fieldDef.errorMessages?.regex || '格式不正确');
            }
          } catch { /* invalid regex */ }
        }
        break;

      case 'number': {
        const num = Number(value);
        if (isNaN(num)) { errors.push('请输入有效数字'); break; }
        if (config.min != null && num < config.min) {
          errors.push(fieldDef.errorMessages?.range || `不能小于${config.min}`);
        }
        if (config.max != null && num > config.max) {
          errors.push(fieldDef.errorMessages?.range || `不能大于${config.max}`);
        }
        break;
      }

      case 'date':
        if (config.minDate && value < config.minDate) {
          errors.push(fieldDef.errorMessages?.range || `日期不能早于${config.minDate}`);
        }
        if (config.maxDate && value > config.maxDate) {
          errors.push(fieldDef.errorMessages?.range || `日期不能晚于${config.maxDate}`);
        }
        break;

      case 'checkbox':
        if (config.minSelect && Array.isArray(value) && value.length < config.minSelect) {
          errors.push(`至少选择${config.minSelect}项`);
        }
        if (config.maxSelect && Array.isArray(value) && value.length > config.maxSelect) {
          errors.push(`最多选择${config.maxSelect}项`);
        }
        break;

      case 'attachment':
        if (config.maxFiles && Array.isArray(value) && value.length > config.maxFiles) {
          errors.push(`最多上传${config.maxFiles}个文件`);
        }
        break;

      case 'addressCascade':
        if (config.required && typeof value === 'object') {
          const levels = config.levels || 3;
          if (!value.province) errors.push('请选择省份');
          if (levels >= 2 && !value.city) errors.push('请选择城市');
          if (levels >= 3 && !value.district) errors.push('请选择区县');
        }
        break;
    }
  }

  #validateCell(col, value) {
    const errors = [];
    const config = col.config || {};
    const isEmpty = value === null || value === undefined || value === '';

    if (config.required && isEmpty) {
      errors.push(`${col.label}不能为空`);
      return errors;
    }
    if (isEmpty) return errors;

    if (col.type === 'number') {
      const num = Number(value);
      if (config.min != null && num < config.min) errors.push(`不能小于${config.min}`);
      if (config.max != null && num > config.max) errors.push(`不能大于${config.max}`);
    }
    if (col.type === 'text' && config.maxLength && String(value).length > config.maxLength) {
      errors.push(`最多${config.maxLength}个字符`);
    }
    return errors;
  }

  #evaluateCondition(sourceValue, operator, compareValue) {
    switch (operator) {
      case 'equals': return String(sourceValue) === String(compareValue);
      case 'notEquals': return String(sourceValue) !== String(compareValue);
      case 'contains': return String(sourceValue || '').includes(String(compareValue));
      case 'notContains': return !String(sourceValue || '').includes(String(compareValue));
      case 'isEmpty': return this.#isEmpty(sourceValue);
      case 'isNotEmpty': return !this.#isEmpty(sourceValue);
      case 'in': return String(compareValue).split(',').map(s => s.trim()).includes(String(sourceValue));
      case 'notIn': return !String(compareValue).split(',').map(s => s.trim()).includes(String(sourceValue));
      case 'greaterThan': return Number(sourceValue) > Number(compareValue);
      case 'lessThan': return Number(sourceValue) < Number(compareValue);
      case 'greaterEqual': return Number(sourceValue) >= Number(compareValue);
      case 'lessEqual': return Number(sourceValue) <= Number(compareValue);
      default: return true;
    }
  }

  #evaluateOperator(a, b, operator) {
    switch (operator) {
      case 'equals': return a === b || String(a) === String(b);
      case 'notEquals': return a !== b && String(a) !== String(b);
      case 'lessThan': return Number(a) < Number(b);
      case 'greaterThan': return Number(a) > Number(b);
      case 'lessEqual': return Number(a) <= Number(b);
      case 'greaterEqual': return Number(a) >= Number(b);
      default: return true;
    }
  }

  #isEmpty(val) {
    if (val === null || val === undefined || val === '') return true;
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === 'object') return Object.values(val).every(v => !v);
    return false;
  }

  #getColLabel(fieldDef, colId) {
    const col = (fieldDef.columns || []).find(c => c.columnId === colId);
    return col?.label || colId;
  }
}
