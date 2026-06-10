// File API: export JSON download, import JSON file with validation
import { validateTemplateJSON, validateSubmissionJSON } from '../core/schema.js';

/**
 * Export data as a downloadable JSON file.
 */
export function exportJSON(data, filename = 'export.json') {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import a JSON file. Returns a promise that resolves with the parsed object
 * or rejects with validation errors.
 * @param {string} type - 'template' or 'submission'
 */
export function importJSON(type = 'template') {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) {
        reject(new ImportError('未选择文件', []));
        return;
      }

      // Size check (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        reject(new ImportError('文件过大，最大支持5MB', [
          { path: '', message: `文件大小 ${(file.size / 1024 / 1024).toFixed(2)}MB 超过限制` }
        ]));
        return;
      }

      const reader = new FileReader();

      reader.onerror = () => {
        reject(new ImportError('文件读取失败', [
          { path: '', message: reader.error?.message || '未知读取错误' }
        ]));
      };

      reader.onload = (e) => {
        let parsed;
        try {
          parsed = JSON.parse(e.target.result);
        } catch (err) {
          reject(new ImportError('JSON解析失败', [
            { path: '', message: `JSON语法错误: ${err.message}` }
          ]));
          return;
        }

        // Validate
        const validator = type === 'template' ? validateTemplateJSON : validateSubmissionJSON;
        const result = validator(parsed);

        if (!result.valid) {
          reject(new ImportError('格式校验失败', result.errors));
          return;
        }

        resolve(parsed);
      };

      reader.readAsText(file, 'UTF-8');
    });

    // Handle cancel
    input.addEventListener('cancel', () => {
      reject(new ImportError('已取消', []));
    });

    input.click();
  });
}

export class ImportError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ImportError';
    this.errors = errors;
  }
}
