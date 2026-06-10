/**
 * 政务表单低代码配置系统 - 应用主控制器
 * Tab management, coordination, filler, preview, history, import/export
 */
(function () {
  'use strict';
  var FB = window.FormBuilder;

  function $(sel, parent) { return (parent || document).querySelector(sel); }
  function $$(sel, parent) { return Array.prototype.slice.call((parent || document).querySelectorAll(sel)); }

  FB.App = {
    designer: null,
    fillerRenderer: null,
    previewRenderer: null,
    currentTab: 'designer',
    _autoSaveTimer: null,

    init: function () {
      this._bindTabs();
      this._bindFiller();
      this._bindPreview();
      this._bindHistory();
      this._bindIO();
      this._bindModal();

      this.designer = new FB.Designer();
      this._seedDemoData();
    },

    /* ========== Tab Management ========== */
    _bindTabs: function () {
      var self = this;
      $$('.tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.switchTab(btn.dataset.tab);
        });
      });
    },

    switchTab: function (tab) {
      this.currentTab = tab;
      $$('.tab-btn').forEach(function (b) {
        b.classList.toggle('active', b.dataset.tab === tab);
      });
      $$('.tab-panel').forEach(function (p) {
        p.classList.toggle('active', p.id === 'tab-' + tab);
      });

      if (tab === 'filler' || tab === 'preview' || tab === 'history' || tab === 'io') {
        this.refreshTemplateSelects();
      }
    },

    /* ========== Template Select Helpers ========== */
    refreshTemplateSelects: function () {
      var index = FB.storage.getTemplateIndex();
      var selectIds = [
        '#filler-template-select',
        '#preview-template-select',
        '#history-template-select',
        '#export-template-select',
        '#export-data-template'
      ];
      for (var si = 0; si < selectIds.length; si++) {
        var el = $(selectIds[si]);
        if (!el) continue;
        var currentVal = el.value;
        el.innerHTML = '<option value="">-- 选择模板 --</option>';
        for (var i = 0; i < index.length; i++) {
          var t = index[i];
          var opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.name + ' (v' + t.version + ')';
          el.appendChild(opt);
        }
        if (currentVal) el.value = currentVal;
      }
    },

    /* ========== Filler ========== */
    _bindFiller: function () {
      var self = this;

      $('#btn-start-fill').addEventListener('click', function () {
        var tplId = $('#filler-template-select').value;
        if (!tplId) { self.toast('请先选择一个模板', 'error'); return; }
        var tpl = FB.storage.getTemplateLatest(tplId);
        if (!tpl) { self.toast('模板不存在', 'error'); return; }

        var allData = FB.storage.getFormDataAll(tplId);
        var drafts = allData.filter(function (r) { return r.data._draft; });
        var initialData = null;
        var recordId = FB.util.uid();
        if (drafts.length > 0) {
          if (confirm('发现未完成的草稿，是否继续编辑？')) {
            initialData = drafts[drafts.length - 1].data;
            recordId = drafts[drafts.length - 1].recordId;
          }
        }

        self._startFill(tpl, initialData, recordId);
      });

      $('#btn-save-draft-fill').addEventListener('click', function () {
        if (!self.fillerRenderer) return;
        self.fillerRenderer.saveDraft();
        $('#fill-status').textContent = '草稿已保存 (' + new Date().toLocaleTimeString() + ')';
        self.toast('草稿已保存', 'success');
      });

      $('#btn-submit-fill').addEventListener('click', function () {
        if (!self.fillerRenderer) return;
        var rid = self.fillerRenderer.submit();
        if (rid) {
          self.toast('提交成功！', 'success');
          $('#fill-status').textContent = '已提交 (记录ID: ' + rid.slice(0, 8) + '...)';
          $('#btn-save-draft-fill').disabled = true;
          $('#btn-submit-fill').disabled = true;
        }
      });

      $('#export-data-template').addEventListener('change', function (e) {
        var tplId = e.target.value;
        var recordSelect = $('#export-data-record');
        recordSelect.innerHTML = '<option value="">-- 选择记录 --</option>';
        if (!tplId) return;
        var records = FB.storage.getFormDataAll(tplId);
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          var opt = document.createElement('option');
          opt.value = r.recordId;
          opt.textContent = r.recordId.slice(0, 8) + '... ' +
            (r.data._draft ? '(草稿)' : '(已提交)') + ' ' +
            new Date(r.savedAt).toLocaleString();
          recordSelect.appendChild(opt);
        }
      });
    },

    _startFill: function (template, initialData, recordId) {
      var self = this;
      var container = $('#filler-content');
      container.innerHTML = '';
      this.fillerRenderer = new FB.Renderer(container);
      this.fillerRenderer.render(template, initialData, { recordId: recordId });

      $('#btn-save-draft-fill').disabled = false;
      $('#btn-submit-fill').disabled = false;
      $('#fill-status').textContent = '填报中...';

      if (this._autoSaveTimer) clearInterval(this._autoSaveTimer);
      this._autoSaveTimer = setInterval(function () {
        if (self.fillerRenderer && self.currentTab === 'filler') {
          self.fillerRenderer.saveDraft();
          $('#fill-status').textContent = '自动保存 (' + new Date().toLocaleTimeString() + ')';
        }
      }, 30000);
    },

    /* ========== Preview ========== */
    _bindPreview: function () {
      var self = this;

      $('#btn-preview-template').addEventListener('click', function () {
        var tplId = $('#preview-template-select').value;
        if (!tplId) { self.toast('请选择模板', 'error'); return; }
        var tpl = FB.storage.getTemplateLatest(tplId);
        if (!tpl) { self.toast('模板不存在', 'error'); return; }

        var container = $('#preview-content');
        container.innerHTML = '';
        self.previewRenderer = new FB.Renderer(container);
        self.previewRenderer.render(tpl, null, { isPreview: true, recordId: 'preview' });
      });

      $('#btn-print-preview').addEventListener('click', function () {
        window.print();
      });
    },

    /* ========== History ========== */
    _bindHistory: function () {
      var self = this;

      $('#btn-load-history').addEventListener('click', function () {
        var tplId = $('#history-template-select').value;
        if (!tplId) { self.toast('请选择模板', 'error'); return; }

        var versions = FB.storage.getTemplateVersions(tplId);
        var list = $('#history-list');
        list.innerHTML = '';

        if (versions.length === 0) {
          list.innerHTML = '<div style="color:#999;text-align:center;padding:20px;">暂无版本记录</div>';
          return;
        }

        for (var vi = versions.length - 1; vi >= 0; vi--) {
          (function (v) {
            var card = document.createElement('div');
            card.className = 'history-version-card';
            var activeFieldCount = 0;
            for (var fi = 0; fi < v.fields.length; fi++) {
              if (!v.fields[fi]._deleted) activeFieldCount++;
            }
            card.innerHTML =
              '<div class="version-tag">v' + v.version + '</div>' +
              '<div class="version-date">' + new Date(v.publishedAt).toLocaleString() + '</div>' +
              '<div style="font-size:12px;color:#666;margin-top:4px;">' + activeFieldCount + ' 个字段</div>';
            card.addEventListener('click', function () {
              $$('.history-version-card', list).forEach(function (c) { c.classList.remove('active'); });
              card.classList.add('active');
              self._showVersionDetail(v, tplId);
            });
            list.appendChild(card);
          })(versions[vi]);
        }
      });
    },

    _showVersionDetail: function (version, templateId) {
      var self = this;
      var detail = $('#history-detail');
      detail.innerHTML = '';

      var activeCount = 0;
      var deletedCount = 0;
      for (var fi = 0; fi < version.fields.length; fi++) {
        if (version.fields[fi]._deleted) deletedCount++;
        else activeCount++;
      }

      var infoDiv = document.createElement('div');
      infoDiv.style.cssText = 'margin-bottom:16px;';
      infoDiv.innerHTML =
        '<h4>' + FB.util.escapeHtml(version.name) + ' - v' + version.version + '</h4>' +
        '<p style="font-size:12px;color:#666;">发布时间: ' + new Date(version.publishedAt).toLocaleString() + '</p>' +
        '<p style="font-size:12px;color:#666;">字段数: ' + activeCount + ' (含已删除: ' + deletedCount + ')</p>';
      detail.appendChild(infoDiv);

      var previewDiv = document.createElement('div');
      detail.appendChild(previewDiv);
      var renderer = new FB.Renderer(previewDiv);
      renderer.render(version, null, { isPreview: true, recordId: 'history-preview' });

      var allData = FB.storage.getFormDataAll(templateId);
      var versionData = allData.filter(function (r) { return r.data._templateVersion === version.version; });
      if (versionData.length > 0) {
        var dataDiv = document.createElement('div');
        dataDiv.style.cssText = 'margin-top:16px;padding-top:16px;border-top:1px solid #eee;';
        dataDiv.innerHTML = '<h4>该版本填报数据 (' + versionData.length + ' 条)</h4>';
        for (var di = 0; di < versionData.length; di++) {
          (function (r) {
            var card = document.createElement('div');
            card.style.cssText = 'background:#f5f5f5;border-radius:6px;padding:10px;margin-top:8px;cursor:pointer;';
            card.innerHTML = '<div style="font-size:12px;">记录: ' + r.recordId.slice(0, 12) + '... ' +
              (r.data._draft ? '(草稿)' : '(已提交)') + ' ' + new Date(r.savedAt).toLocaleString() + '</div>';
            card.addEventListener('click', function () {
              self._showDataWithVersion(version, r.data);
            });
            dataDiv.appendChild(card);
          })(versionData[di]);
        }
        detail.appendChild(dataDiv);
      }

      var actions = document.createElement('div');
      actions.style.cssText = 'margin-top:16px;display:flex;gap:8px;';
      actions.innerHTML =
        '<button class="btn btn-primary" id="btn-load-version-edit">加载到设计器</button>' +
        '<button class="btn btn-secondary" id="btn-export-version">导出此版本</button>';
      detail.appendChild(actions);

      $('#btn-load-version-edit').addEventListener('click', function () {
        self.designer.loadTemplate(version);
        self.switchTab('designer');
        self.toast('已加载历史版本到设计器', 'success');
      });

      $('#btn-export-version').addEventListener('click', function () {
        var json = FB.io.exportTemplate(version);
        FB.io.downloadFile(json, version.name + '_v' + version.version + '.json', 'application/json');
        self.toast('版本已导出', 'success');
      });
    },

    _showDataWithVersion: function (version, data) {
      var self = this;
      var body = document.createElement('div');
      var renderer = new FB.Renderer(body);
      renderer.render(version, data, { isPreview: true, recordId: data._recordId || 'unknown' });
      this.showModal('历史数据回显 (v' + version.version + ')', body, [
        { label: '关闭', cls: 'btn-secondary', action: function () { self.hideModal(); } }
      ]);
    },

    /* ========== Import / Export ========== */
    _bindIO: function () {
      var self = this;

      $('#btn-export-template').addEventListener('click', function () {
        var tplId = $('#export-template-select').value;
        if (!tplId) { self.toast('请选择模板', 'error'); return; }
        var tpl = FB.storage.getTemplateLatest(tplId);
        if (!tpl) { self.toast('模板不存在', 'error'); return; }

        var json = FB.io.exportTemplate(tpl);
        $('#export-template-output').textContent = json;
        FB.io.downloadFile(json, tpl.name + '.json', 'application/json');
        self.toast('模板已导出', 'success');
      });

      $('#btn-import-template').addEventListener('click', function () {
        var jsonText = $('#import-template-input').value.trim();
        if (!jsonText) { self.toast('请粘贴或上传模板 JSON', 'error'); return; }
        self._importTemplate(jsonText);
      });

      $('#import-template-file').addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          $('#import-template-input').value = ev.target.result;
          self._importTemplate(ev.target.result);
        };
        reader.readAsText(file);
      });

      $('#btn-export-data-json').addEventListener('click', function () {
        var tplId = $('#export-data-template').value;
        var recId = $('#export-data-record').value;
        if (!tplId || !recId) { self.toast('请选择模板和记录', 'error'); return; }
        var tpl = FB.storage.getTemplateLatest(tplId);
        var rec = FB.storage.getFormData(tplId, recId);
        if (!tpl || !rec) { self.toast('数据不存在', 'error'); return; }

        var json = FB.io.exportData(tpl, rec.data);
        $('#export-data-output').textContent = json;
        FB.io.downloadFile(json, 'form_data_' + recId.slice(0, 8) + '.json', 'application/json');
        self.toast('数据已导出', 'success');
      });

      $('#btn-export-data-csv').addEventListener('click', function () {
        var tplId = $('#export-data-template').value;
        var recId = $('#export-data-record').value;
        if (!tplId || !recId) { self.toast('请选择模板和记录', 'error'); return; }
        var tpl = FB.storage.getTemplateLatest(tplId);
        var rec = FB.storage.getFormData(tplId, recId);
        if (!tpl || !rec) { self.toast('数据不存在', 'error'); return; }

        var csv = FB.io.exportDataCSV(tpl, rec.data);
        $('#export-data-output').textContent = csv;
        FB.io.downloadFile(csv, 'form_data_' + recId.slice(0, 8) + '.csv', 'text/csv');
        self.toast('CSV 已导出', 'success');
      });
    },

    _importTemplate: function (jsonText) {
      var self = this;
      var resultBox = $('#import-template-result');
      try {
        var data = JSON.parse(jsonText);
        var validation = FB.io.validateImport(data);

        if (!validation.valid) {
          resultBox.className = 'result-box error';
          resultBox.innerHTML = '<strong>导入失败:</strong><br>' +
            validation.errors.map(function (e) { return '• ' + FB.util.escapeHtml(e); }).join('<br>');
          self.toast('模板格式有误', 'error');
          return;
        }

        var existing = FB.storage.getTemplateIndex();
        var tpl = validation.template;
        var hasConflict = false;
        for (var i = 0; i < existing.length; i++) {
          if (existing[i].id === tpl.id) { hasConflict = true; break; }
        }
        if (hasConflict) {
          if (!confirm('已存在同名模板，是否覆盖？取消则创建为新模板。')) {
            tpl.id = FB.util.uid();
          }
        }

        this._ensureFieldIds(tpl.fields);
        FB.storage.saveTemplateDraft(tpl);
        var published = FB.storage.publishTemplate(tpl);

        resultBox.className = 'result-box success';
        resultBox.innerHTML = '<strong>导入成功!</strong><br>模板: ' + FB.util.escapeHtml(published.name) +
          '<br>版本: v' + published.version +
          '<br>字段数: ' + tpl.fields.length;
        self.toast('模板导入成功', 'success');
        self.refreshTemplateSelects();

        $('#import-template-input').value = '';
      } catch (e) {
        resultBox.className = 'result-box error';
        resultBox.innerHTML = '<strong>JSON 解析错误:</strong><br>' + FB.util.escapeHtml(e.message);
        self.toast('JSON 格式无效', 'error');
      }
    },

    _ensureFieldIds: function (fields) {
      if (!fields) return;
      for (var i = 0; i < fields.length; i++) {
        if (!fields[i].id) fields[i].id = FB.util.uid();
        if (fields[i].subFields) this._ensureFieldIds(fields[i].subFields);
        if (fields[i].children) this._ensureFieldIds(fields[i].children);
      }
    },

    /* ========== Modal ========== */
    _bindModal: function () {
      var self = this;
      $('#modal-close').addEventListener('click', function () { self.hideModal(); });
      $('#modal-overlay').addEventListener('click', function (e) {
        if (e.target === e.currentTarget) self.hideModal();
      });
    },

    showModal: function (title, bodyContent, buttons) {
      $('#modal-title').textContent = title;
      var body = $('#modal-body');
      body.innerHTML = '';
      if (typeof bodyContent === 'string') {
        body.innerHTML = bodyContent;
      } else {
        body.appendChild(bodyContent);
      }

      var footer = $('#modal-footer');
      footer.innerHTML = '';
      var self = this;
      (buttons || []).forEach(function (b) {
        var btn = document.createElement('button');
        btn.className = 'btn ' + (b.cls || 'btn-primary');
        btn.textContent = b.label;
        btn.addEventListener('click', b.action);
        footer.appendChild(btn);
      });

      $('#modal-overlay').style.display = 'flex';
    },

    hideModal: function () {
      $('#modal-overlay').style.display = 'none';
    },

    /* ========== Toast ========== */
    toast: function (message, type) {
      type = type || 'info';
      var container = $('#toast-container');
      var toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        toast.style.transition = '.3s ease';
        setTimeout(function () { toast.remove(); }, 300);
      }, 3000);
    },

    /* ========== Demo Data ========== */
    _seedDemoData: function () {
      if (FB.storage.getTemplateIndex().length > 0) return;

      var demoTemplate = {
        id: 'demo_template_001',
        name: '示例：企业登记申请表',
        version: 0,
        fields: [
          FB.createField('text', { label: '企业名称', required: true, placeholder: '请输入企业全称',
            validation: { minLength: '4', maxLength: '100', regex: '' } }),
          FB.createField('text', { label: '统一社会信用代码', required: true, placeholder: '18位代码',
            validation: { regex: '^[0-9A-Z]{18}$' }, errorMessage: '请输入有效的18位统一社会信用代码' }),
          FB.createField('number', { label: '注册资本(万元)', required: true,
            validation: { min: '1', max: '999999' } }),
          FB.createField('date', { label: '成立日期', required: true,
            validation: { maxDate: new Date().toISOString().split('T')[0] } }),
          FB.createField('radio', { label: '企业类型', required: true,
            options: [
              { label: '有限责任公司', value: 'llc' },
              { label: '股份有限公司', value: 'ltd' },
              { label: '个人独资企业', value: 'sole' },
              { label: '合伙企业', value: 'partner' }
            ] }),
          FB.createField('checkbox', { label: '经营范围', required: true,
            options: [
              { label: '技术开发', value: 'tech' },
              { label: '咨询服务', value: 'consult' },
              { label: '生产制造', value: 'mfg' },
              { label: '贸易销售', value: 'trade' },
              { label: '其他', value: 'other' }
            ] }),
          FB.createField('address', { label: '注册地址', required: true }),
          FB.createField('attachment', { label: '营业执照扫描件', required: false,
            validation: { accept: '.pdf,.jpg,.png', maxSize: '10' } }),
          FB.createField('group', { label: '法定代表人信息', description: '请填写法定代表人的基本信息',
            children: [
              FB.createField('text', { label: '姓名', required: true }),
              FB.createField('text', { label: '身份证号', required: true,
                validation: { regex: '^[1-9]\\d{5}(18|19|20)\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]$' },
                errorMessage: '身份证号格式不正确' }),
              FB.createField('text', { label: '联系电话', required: true,
                validation: { regex: '^1[3-9]\\d{9}$' }, errorMessage: '手机号格式不正确' })
            ] }),
          FB.createField('table', { label: '股东信息', required: false,
            minRows: 1, maxRows: 10,
            subFields: [
              { id: FB.util.uid(), type: 'text', label: '股东名称', required: true, validation: {} },
              { id: FB.util.uid(), type: 'number', label: '持股比例(%)', required: true, validation: { min: '0', max: '100' } },
              { id: FB.util.uid(), type: 'text', label: '出资额(万元)', required: true, validation: {} }
            ]
          })
        ],
        createdAt: FB.util.now(),
        updatedAt: FB.util.now()
      };

      // Add conditional logic: show shareholder table only when type is "llc"
      var tableField = null;
      var typeField = null;
      for (var i = 0; i < demoTemplate.fields.length; i++) {
        if (demoTemplate.fields[i].label === '股东信息') tableField = demoTemplate.fields[i];
        if (demoTemplate.fields[i].label === '企业类型') typeField = demoTemplate.fields[i];
      }
      if (tableField && typeField) {
        tableField.conditions = [{ field: typeField.id, operator: 'equals', value: 'llc' }];
      }

      FB.storage.saveTemplateDraft(demoTemplate);
      FB.storage.publishTemplate(demoTemplate);
    }
  };

  /* ========== Initialize on DOM ready ========== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { FB.App.init(); });
  } else {
    FB.App.init();
  }
})();
