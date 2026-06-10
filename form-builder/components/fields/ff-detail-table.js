import { BaseField } from './base-field.js';
import { generateId } from '../../utils/id-generator.js';

export class FFDetailTable extends BaseField {
  _rowErrors = [];
  _tableErrors = [];

  _getBaseTemplate() {
    return `
      <style>
        :host {
          display: block;
          margin-bottom: 12px;
          font-family: -apple-system, "Microsoft YaHei", sans-serif;
          font-size: 14px;
        }
        :host([hidden]) { display: none; }
        .field-wrapper { position: relative; }
        .field-label {
          display: flex;
          align-items: center;
          margin-bottom: 6px;
          font-weight: 500;
          color: #333;
        }
        .field-label .required { color: #e74c3c; margin-right: 4px; }
        .field-error { color: #e74c3c; font-size: 12px; margin-top: 4px; }
        .field-error:empty { display: none; }
        .table-wrapper {
          border: 1px solid #e8e8e8;
          border-radius: 4px;
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          min-width: 400px;
        }
        thead { background: #fafafa; }
        th {
          padding: 10px 12px;
          text-align: left;
          font-weight: 500;
          font-size: 13px;
          color: #555;
          border-bottom: 1px solid #e8e8e8;
          white-space: nowrap;
        }
        th .required-mark { color: #e74c3c; margin-left: 2px; }
        td {
          padding: 6px 8px;
          border-bottom: 1px solid #f0f0f0;
          vertical-align: top;
        }
        td input, td select {
          width: 100%;
          box-sizing: border-box;
          padding: 6px 8px;
          border: 1px solid #d9d9d9;
          border-radius: 3px;
          font-size: 13px;
          font-family: inherit;
          outline: none;
        }
        td input:focus, td select:focus {
          border-color: #1890ff;
        }
        td input.cell-error, td select.cell-error {
          border-color: #e74c3c;
        }
        .cell-error-msg {
          color: #e74c3c;
          font-size: 11px;
          margin-top: 2px;
        }
        .action-col { width: 40px; text-align: center; }
        .btn-remove-row {
          background: none;
          border: none;
          color: #e74c3c;
          cursor: pointer;
          font-size: 16px;
          padding: 4px 8px;
          border-radius: 3px;
        }
        .btn-remove-row:hover { background: #fff1f0; }
        .table-footer {
          padding: 8px 12px;
          border-top: 1px solid #f0f0f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .btn-add-row {
          background: none;
          border: 1px dashed #1890ff;
          color: #1890ff;
          padding: 6px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-family: inherit;
        }
        .btn-add-row:hover { background: #e6f7ff; }
        .btn-add-row:disabled { opacity: 0.5; cursor: not-allowed; }
        .row-count { color: #888; font-size: 12px; }
        .table-errors { margin-top: 4px; }
        .table-errors div { color: #e74c3c; font-size: 12px; }
        :host(.design-mode) td input,
        :host(.design-mode) td select,
        :host(.design-mode) .btn-add-row,
        :host(.design-mode) .btn-remove-row {
          pointer-events: none;
          opacity: 0.6;
        }
      </style>
      <div class="field-wrapper">
        <label class="field-label">
          <span class="required" style="display:none">*</span>
          <span class="label-text"></span>
        </label>
        <div class="field-body"></div>
        <div class="table-errors"></div>
        <div class="field-error"></div>
      </div>
    `;
  }

  configure(fieldDef) {
    this._fieldDef = fieldDef;
    const label = this.shadowRoot.querySelector('.label-text');
    const required = this.shadowRoot.querySelector('.required');
    if (label) label.textContent = fieldDef.label || '';
    if (required) required.style.display = fieldDef.config?.required ? '' : 'none';

    if (!this._value || !Array.isArray(this._value)) {
      this._value = [];
    }
    // Ensure min rows
    const minRows = fieldDef.config?.minRows || 0;
    while (this._value.length < minRows) {
      this._value.push(this._createEmptyRow());
    }
    this._render();
  }

  _createEmptyRow() {
    const row = { _rowId: generateId('row') };
    const columns = this._fieldDef?.columns || [];
    for (const col of columns) {
      row[col.columnId] = col.type === 'number' ? null : '';
    }
    return row;
  }

  _render() {
    const body = this._getBody();
    if (!body) return;
    const columns = this._fieldDef?.columns || [];
    const config = this._fieldDef?.config || {};
    const rows = this._value || [];
    const maxRows = config.maxRows || 50;

    let html = `<div class="table-wrapper"><table>
      <thead><tr>`;
    for (const col of columns) {
      html += `<th>${this._esc(col.label)}${col.config?.required ? '<span class="required-mark">*</span>' : ''}</th>`;
    }
    html += `<th class="action-col"></th></tr></thead><tbody>`;

    if (rows.length === 0) {
      html += `<tr><td colspan="${columns.length + 1}" style="text-align:center;color:#999;padding:20px;">暂无数据，请点击下方添加</td></tr>`;
    } else {
      rows.forEach((row, ri) => {
        html += `<tr data-row="${ri}">`;
        for (const col of columns) {
          const val = row[col.columnId] ?? '';
          const cellErr = this._getCellError(ri, col.columnId);
          html += `<td>`;
          html += this._renderCellInput(col, val, ri, cellErr);
          if (cellErr) html += `<div class="cell-error-msg">${this._esc(cellErr)}</div>`;
          html += `</td>`;
        }
        html += `<td class="action-col"><button class="btn-remove-row" data-row="${ri}" title="删除行">&times;</button></td>`;
        html += `</tr>`;
      });
    }

    html += `</tbody></table>`;
    html += `<div class="table-footer">
      <button class="btn-add-row" ${rows.length >= maxRows ? 'disabled' : ''}>+ 添加行</button>
      <span class="row-count">${rows.length}/${maxRows} 行</span>
    </div></div>`;

    body.innerHTML = html;

    if (this._mode === 'fill') {
      this._bindEvents(body);
    }
    this._renderTableErrors();
  }

  _renderCellInput(col, value, rowIndex, hasError) {
    const errClass = hasError ? 'cell-error' : '';
    const disabled = this._mode === 'design' ? 'disabled' : '';
    switch (col.type) {
      case 'number':
        return `<input type="number" class="${errClass}" value="${value ?? ''}"
          data-row="${rowIndex}" data-col="${col.columnId}"
          ${col.config?.min != null ? `min="${col.config.min}"` : ''}
          ${col.config?.max != null ? `max="${col.config.max}"` : ''}
          ${disabled}>`;
      case 'date':
        return `<input type="date" class="${errClass}" value="${this._esc(value)}"
          data-row="${rowIndex}" data-col="${col.columnId}" ${disabled}>`;
      case 'radio':
        if (!col.options) return '';
        let sel = `<select class="${errClass}" data-row="${rowIndex}" data-col="${col.columnId}" ${disabled}>
          <option value="">请选择</option>`;
        for (const opt of col.options) {
          sel += `<option value="${this._esc(opt.value)}" ${value === opt.value ? 'selected' : ''}>${this._esc(opt.label)}</option>`;
        }
        return sel + `</select>`;
      default: // text
        return `<input type="text" class="${errClass}" value="${this._esc(value)}"
          data-row="${rowIndex}" data-col="${col.columnId}"
          ${col.config?.maxLength ? `maxlength="${col.config.maxLength}"` : ''}
          ${disabled}>`;
    }
  }

  _bindEvents(body) {
    // Cell input changes
    body.addEventListener('input', (e) => {
      const input = e.target;
      if (!input.dataset.row) return;
      const ri = parseInt(input.dataset.row);
      const colId = input.dataset.col;
      const col = this._fieldDef.columns.find(c => c.columnId === colId);
      if (!col) return;
      if (col.type === 'number') {
        this._value[ri][colId] = input.value === '' ? null : parseFloat(input.value);
      } else {
        this._value[ri][colId] = input.value;
      }
      this._emitChange();
    });

    body.addEventListener('change', (e) => {
      const el = e.target;
      if (el.tagName === 'SELECT' && el.dataset.row) {
        const ri = parseInt(el.dataset.row);
        this._value[ri][el.dataset.col] = el.value;
        this._emitChange();
      }
    });

    // Add row
    const addBtn = body.querySelector('.btn-add-row');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const maxRows = this._fieldDef.config?.maxRows || 50;
        if (this._value.length < maxRows) {
          this._value.push(this._createEmptyRow());
          this._render();
          this._emitChange();
        }
      });
    }

    // Remove row
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-remove-row');
      if (!btn) return;
      const ri = parseInt(btn.dataset.row);
      const minRows = this._fieldDef.config?.minRows || 0;
      if (this._value.length > minRows) {
        this._value.splice(ri, 1);
        this._render();
        this._emitChange();
      }
    });
  }

  _getCellError(rowIndex, colId) {
    const rowErr = this._rowErrors.find(r => r.rowIndex === rowIndex);
    return rowErr?.errors?.[colId]?.[0] || '';
  }

  _renderTableErrors() {
    const container = this.shadowRoot.querySelector('.table-errors');
    if (!container) return;
    container.innerHTML = this._tableErrors.map(e => `<div>${this._esc(e)}</div>`).join('');
  }

  validate() {
    this._errors = [];
    this._rowErrors = [];
    this._tableErrors = [];
    if (!this._fieldDef) return { valid: true, errors: [] };

    const config = this._fieldDef.config || {};
    const rows = this._value || [];
    const columns = this._fieldDef.columns || [];

    // Required: at least one row with data
    if (config.required && rows.length === 0) {
      this._errors.push(this._fieldDef.errorMessages?.required || `${this._fieldDef.label}至少需要一行数据`);
    }

    if (config.minRows && rows.length < config.minRows) {
      this._errors.push(`至少需要${config.minRows}行`);
    }

    // Per-cell validation
    rows.forEach((row, ri) => {
      const rowErrors = {};
      for (const col of columns) {
        const val = row[col.columnId];
        const cellErrors = this._validateCell(col, val);
        if (cellErrors.length > 0) {
          rowErrors[col.columnId] = cellErrors;
        }
      }
      if (Object.keys(rowErrors).length > 0) {
        this._rowErrors.push({ rowIndex: ri, errors: rowErrors });
      }
    });

    // Table-level validation (e.g., column sum)
    const tableValidation = this._fieldDef.tableValidation || [];
    for (const rule of tableValidation) {
      if (rule.type === 'columnSum') {
        const sum = rows.reduce((s, r) => s + (Number(r[rule.columnId]) || 0), 0);
        if (!this._evalOp(sum, rule.value, rule.operator)) {
          this._tableErrors.push(rule.errorMessage || `列合计校验不通过`);
        }
      } else if (rule.type === 'uniqueColumn') {
        const vals = rows.map(r => r[rule.columnId]).filter(v => v !== '' && v != null);
        if (new Set(vals).size !== vals.length) {
          this._tableErrors.push(rule.errorMessage || `列值不能重复`);
        }
      }
    }

    const allErrors = [
      ...this._errors,
      ...this._tableErrors,
      ...this._rowErrors.flatMap(r =>
        Object.values(r.errors).flat().map((e, i) =>
          i === 0 ? `第${r.rowIndex + 1}行: ${e}` : e
        )
      )
    ];

    this._render();
    return { valid: allErrors.length === 0, errors: allErrors };
  }

  _validateCell(col, value) {
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
    if (col.type === 'text') {
      if (config.maxLength && String(value).length > config.maxLength) {
        errors.push(`最多${config.maxLength}个字符`);
      }
    }
    return errors;
  }

  _evalOp(a, b, op) {
    switch (op) {
      case 'equals': return a === b;
      case 'lessThan': return a < b;
      case 'greaterThan': return a > b;
      case 'lessEqual': return a <= b;
      case 'greaterEqual': return a >= b;
      default: return true;
    }
  }

  _updateDisplay() {
    this._render();
  }

  setValue(value) {
    this._value = Array.isArray(value) ? value.map(row => ({
      _rowId: row._rowId || generateId('row'),
      ...row
    })) : [];
    this._render();
  }

  _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

customElements.define('ff-detail-table', FFDetailTable);
