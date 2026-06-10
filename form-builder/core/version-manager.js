// Template version management
import { generateId } from '../utils/id-generator.js';

export class VersionManager {
  /**
   * Publish a new version of the template.
   */
  publish(template, changelog = '') {
    const nextVersion = (template.currentVersion || 0) + 1;
    const activeFields = (template.fields || []).filter(f => !f._deleted);
    const snapshot = structuredClone(activeFields);

    if (!template.versions) template.versions = [];
    template.versions.push({
      version: nextVersion,
      publishedAt: new Date().toISOString(),
      snapshot,
      changelog
    });
    template.currentVersion = nextVersion;
    template.metadata.updatedAt = new Date().toISOString();
    return template;
  }

  /**
   * Get the field snapshot for a specific version.
   */
  getVersionSnapshot(template, version) {
    const entry = (template.versions || []).find(v => v.version === version);
    return entry?.snapshot || null;
  }

  /**
   * Get version history list.
   */
  getVersionHistory(template) {
    return [...(template.versions || [])].sort((a, b) => b.version - a.version);
  }

  /**
   * Diff two versions — returns added, removed, modified field lists.
   */
  diffVersions(template, fromVersion, toVersion) {
    const fromFields = this.getVersionSnapshot(template, fromVersion) || [];
    const toFields = this.getVersionSnapshot(template, toVersion) || [];

    const fromMap = new Map(fromFields.map(f => [f.fieldId, f]));
    const toMap = new Map(toFields.map(f => [f.fieldId, f]));

    const added = [];
    const removed = [];
    const modified = [];

    for (const [id, field] of toMap) {
      if (!fromMap.has(id)) {
        added.push(field);
      } else {
        const oldField = fromMap.get(id);
        if (JSON.stringify(oldField) !== JSON.stringify(field)) {
          modified.push({ old: oldField, new: field });
        }
      }
    }

    for (const [id, field] of fromMap) {
      if (!toMap.has(id)) {
        removed.push(field);
      }
    }

    return { added, removed, modified };
  }
}
