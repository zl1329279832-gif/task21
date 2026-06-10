// Directed graph for conditional display dependencies + cycle detection
export class DependencyGraph {
  #adjacency = new Map(); // Map<fieldId, Set<fieldId>> — edge from source to dependent

  clear() {
    this.#adjacency.clear();
  }

  addNode(fieldId) {
    if (!this.#adjacency.has(fieldId)) {
      this.#adjacency.set(fieldId, new Set());
    }
  }

  addEdge(sourceFieldId, dependentFieldId) {
    this.addNode(sourceFieldId);
    this.addNode(dependentFieldId);
    this.#adjacency.get(sourceFieldId).add(dependentFieldId);
  }

  removeEdge(sourceFieldId, dependentFieldId) {
    const deps = this.#adjacency.get(sourceFieldId);
    if (deps) deps.delete(dependentFieldId);
  }

  removeNode(fieldId) {
    this.#adjacency.delete(fieldId);
    for (const deps of this.#adjacency.values()) {
      deps.delete(fieldId);
    }
  }

  getDependents(fieldId) {
    return [...(this.#adjacency.get(fieldId) || [])];
  }

  getSources(fieldId) {
    const sources = [];
    for (const [src, deps] of this.#adjacency) {
      if (deps.has(fieldId)) sources.push(src);
    }
    return sources;
  }

  /**
   * Detect cycles using DFS with 3-color marking.
   * WHITE(0) = unvisited, GRAY(1) = in current path, BLACK(2) = fully explored
   */
  detectCycle() {
    const color = new Map();
    for (const node of this.#adjacency.keys()) {
      color.set(node, 0);
    }

    for (const node of this.#adjacency.keys()) {
      if (color.get(node) === 0) {
        const result = this.#dfs(node, color, []);
        if (result.hasCycle) return result;
      }
    }
    return { hasCycle: false, cyclePath: null };
  }

  #dfs(node, color, path) {
    color.set(node, 1); // GRAY
    path.push(node);

    for (const neighbor of (this.#adjacency.get(node) || [])) {
      if (color.get(neighbor) === 1) {
        const cycleStart = path.indexOf(neighbor);
        return { hasCycle: true, cyclePath: path.slice(cycleStart).concat(neighbor) };
      }
      if (color.get(neighbor) === 0) {
        const result = this.#dfs(neighbor, color, path);
        if (result.hasCycle) return result;
      }
    }

    color.set(node, 2); // BLACK
    path.pop();
    return { hasCycle: false, cyclePath: null };
  }

  /**
   * Check if adding an edge would create a cycle, without persisting the edge.
   */
  wouldCreateCycle(sourceFieldId, dependentFieldId) {
    this.addEdge(sourceFieldId, dependentFieldId);
    const result = this.detectCycle();
    this.removeEdge(sourceFieldId, dependentFieldId);
    return result;
  }

  /**
   * Topological sort — returns fieldIds in dependency order.
   * If A affects B's visibility, A appears before B.
   */
  topologicalSort() {
    const inDegree = new Map();
    for (const node of this.#adjacency.keys()) {
      if (!inDegree.has(node)) inDegree.set(node, 0);
      for (const dep of this.#adjacency.get(node)) {
        inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
      }
    }

    const queue = [];
    for (const [node, deg] of inDegree) {
      if (deg === 0) queue.push(node);
    }

    const sorted = [];
    while (queue.length > 0) {
      const node = queue.shift();
      sorted.push(node);
      for (const dep of (this.#adjacency.get(node) || [])) {
        const newDeg = inDegree.get(dep) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) queue.push(dep);
      }
    }

    return sorted;
  }

  /**
   * Build graph from template fields' conditions array.
   */
  buildFromFields(fields) {
    this.clear();
    for (const field of fields) {
      if (field._deleted) continue;
      this.addNode(field.fieldId);
      for (const cond of (field.conditions || [])) {
        // Edge: source field's value affects this field's visibility
        this.addEdge(cond.sourceFieldId, field.fieldId);
      }
    }
  }
}
