// Template migration — handles old data preservation across template version changes
import { generateId } from '../utils/id-generator.js';

export class TemplateMigrator {
  /**
   * Migrate a submission from its template version to the current template version.
   * Preserves old values in orphanedValues when fields are deleted.
   */
  migrate(submission, template) {
    const fromVersion = submission.templateVersion;
    const toVersion = template.currentVersion;

    if (fromVersion === toVersion) return submission;

    const fromSnapshot = (template.versions || []).find(v => v.version === fromVersion)?.snapshot || [];
    const toFields = (template.fields || []).filter(f => !f._deleted);
    const toFieldIds = new Set(toFields.map(f => f.fieldId));

    const migrated = structuredClone(submission);
    if (!migrated.orphanedValues) migrated.orphanedValues = {};

    // Step 1: Move removed field values to orphaned
    for (const [fieldId, value] of Object.entries(migrated.values)) {
      if (!toFieldIds.has(fieldId)) {
        const oldFieldDef = fromSnapshot.find(f => f.fieldId === fieldId);
        migrated.orphanedValues[fieldId] = {
          fieldId,
          label: oldFieldDef?.label || fieldId,
          type: oldFieldDef?.type || 'text',
          value: structuredClone(value),
          removedInVersion: toVersion
        };
        delete migrated.values[fieldId];
      }
    }

    // Step 2: Apply defaults for new fields
    for (const field of toFields) {
      if (!(field.fieldId in migrated.values)) {
        migrated.values[field.fieldId] = field.defaultValue !== undefined
          ? structuredClone(field.defaultValue)
          : null;
      }
    }

    // Step 3: Type coercion for changed field types
    for (const field of toFields) {
      const oldField = fromSnapshot.find(f => f.fieldId === field.fieldId);
      if (oldField && oldField.type !== field.type) {
        migrated.values[field.fieldId] = this.#coerceValue(
          migrated.values[field.fieldId],
          oldField.type,
          field.type
        );
      }
    }

    // Step 4: Record migration history
    if (!migrated.history) migrated.history = [];
    migrated.history.push({
      historyId: generateId('hist'),
      savedAt: new Date().toISOString(),
      templateVersion: fromVersion,
      values: structuredClone(submission.values),
      action: 'migrated'
    });

    migrated.templateVersion = toVersion;
    migrated.metadata.updatedAt = new Date().toISOString();

    return migrated;
  }

  /**
   * Attempt to coerce a value from one field type to another.
   */
  #coerceValue(value, fromType, toType) {
    if (value === null || value === undefined) return null;

    // number -> text
    if (fromType === 'number' && toType === 'text') {
      return String(value);
    }
    // text -> number
    if (fromType === 'text' && toType === 'number') {
      const num = parseFloat(value);
      return isNaN(num) ? null : num;
    }
    // radio -> text
    if (fromType === 'radio' && toType === 'text') {
      return String(value);
    }
    // checkbox -> text (join)
    if (fromType === 'checkbox' && toType === 'text') {
      return Array.isArray(value) ? value.join(', ') : String(value);
    }
    // any -> text fallback
    if (toType === 'text') {
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }

    // Incompatible: return null
    return null;
  }

  /**
   * Check if a submission needs migration.
   */
  needsMigration(submission, template) {
    return submission.templateVersion !== template.currentVersion;
  }

  /**
   * Get summary of what would change during migration.
   */
  getMigrationSummary(submission, template) {
    const fromVersion = submission.templateVersion;
    const toVersion = template.currentVersion;
    const fromSnapshot = (template.versions || []).find(v => v.version === fromVersion)?.snapshot || [];
    const toFields = (template.fields || []).filter(f => !f._deleted);
    const toFieldIds = new Set(toFields.map(f => f.fieldId));

    const removedFields = [];
    const newFields = [];
    const typeChanges = [];

    for (const [fieldId] of Object.entries(submission.values)) {
      if (!toFieldIds.has(fieldId)) {
        const oldField = fromSnapshot.find(f => f.fieldId === fieldId);
        removedFields.push(oldField?.label || fieldId);
      }
    }

    for (const field of toFields) {
      if (!(field.fieldId in submission.values)) {
        newFields.push(field.label);
      }
      const oldField = fromSnapshot.find(f => f.fieldId === field.fieldId);
      if (oldField && oldField.type !== field.type) {
        typeChanges.push(`${field.label}: ${oldField.type} → ${field.type}`);
      }
    }

    return { fromVersion, toVersion, removedFields, newFields, typeChanges };
  }
}
