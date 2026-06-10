import { BaseField } from './base-field.js';
import { getProvinces, getCities, getDistricts } from '../../data/address-data.js';

export class FFAddress extends BaseField {
  _value = { province: '', city: '', district: '', detail: '' };
  _rendered = false;

  _render() {
    if (!this._fieldDef) return;
    const body = this._getBody();
    if (!body) return;

    const config = this._fieldDef.config || {};
    const levels = config.levels ?? 3;
    const showDetail = config.showDetail ?? true;
    const isDesign = this._mode === 'design';

    body.innerHTML = '';

    // --- Styles scoped to field-body ---
    const style = document.createElement('style');
    style.textContent = `
      .address-selects {
        display: flex;
        flex-direction: row;
        gap: 8px;
      }
      .address-selects select {
        flex: 1;
        min-width: 0;
      }
      .address-detail {
        margin-top: 8px;
      }
      .address-detail input {
        width: 100%;
      }
    `;
    body.appendChild(style);

    // --- Select row ---
    const row = document.createElement('div');
    row.className = 'address-selects';

    // Province select
    const provinceSelect = document.createElement('select');
    provinceSelect.className = 'addr-province';
    provinceSelect.disabled = isDesign;
    this._populateProvinceOptions(provinceSelect);
    row.appendChild(provinceSelect);

    // City select (hidden if levels < 2)
    if (levels >= 2) {
      const citySelect = document.createElement('select');
      citySelect.className = 'addr-city';
      citySelect.disabled = isDesign;
      this._populateCityOptions(citySelect, this._value.province);
      row.appendChild(citySelect);
    }

    // District select (hidden if levels < 3)
    if (levels >= 3) {
      const districtSelect = document.createElement('select');
      districtSelect.className = 'addr-district';
      districtSelect.disabled = isDesign;
      this._populateDistrictOptions(districtSelect, this._value.city);
      row.appendChild(districtSelect);
    }

    body.appendChild(row);

    // --- Detail input ---
    if (showDetail) {
      const detailWrap = document.createElement('div');
      detailWrap.className = 'address-detail';
      const detailInput = document.createElement('input');
      detailInput.type = 'text';
      detailInput.className = 'addr-detail';
      detailInput.placeholder = '详细地址';
      detailInput.disabled = isDesign;
      detailInput.value = this._value.detail || '';
      detailWrap.appendChild(detailInput);
      body.appendChild(detailWrap);
    }

    // --- Event listeners (fill mode only) ---
    if (!isDesign) {
      this._bindEvents(body, levels, showDetail);
    }

    this._rendered = true;
  }

  // ------ Option population helpers ------

  _populateProvinceOptions(select) {
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择';
    placeholder.disabled = true;
    placeholder.selected = !this._value.province;
    select.appendChild(placeholder);

    const provinces = getProvinces();
    for (const p of provinces) {
      const opt = document.createElement('option');
      opt.value = p.code;
      opt.textContent = p.name;
      if (this._value.province === p.code) opt.selected = true;
      select.appendChild(opt);
    }
  }

  _populateCityOptions(select, provinceCode) {
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择';
    placeholder.disabled = true;
    placeholder.selected = !this._value.city;
    select.appendChild(placeholder);

    if (!provinceCode) return;
    const cities = getCities(provinceCode);
    for (const c of cities) {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = c.name;
      if (this._value.city === c.code) opt.selected = true;
      select.appendChild(opt);
    }
  }

  _populateDistrictOptions(select, cityCode) {
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择';
    placeholder.disabled = true;
    placeholder.selected = !this._value.district;
    select.appendChild(placeholder);

    if (!cityCode) return;
    const districts = getDistricts(cityCode);
    for (const d of districts) {
      const opt = document.createElement('option');
      opt.value = d.code;
      opt.textContent = d.name;
      if (this._value.district === d.code) opt.selected = true;
      select.appendChild(opt);
    }
  }

  // ------ Event binding ------

  _bindEvents(body, levels, showDetail) {
    const provinceSelect = body.querySelector('.addr-province');
    const citySelect = body.querySelector('.addr-city');
    const districtSelect = body.querySelector('.addr-district');
    const detailInput = body.querySelector('.addr-detail');

    // Province change
    provinceSelect.addEventListener('change', () => {
      this._value.province = provinceSelect.value;
      this._value.city = '';
      this._value.district = '';

      if (citySelect) {
        this._populateCityOptions(citySelect, this._value.province);
      }
      if (districtSelect) {
        this._populateDistrictOptions(districtSelect, '');
      }

      this.clearError();
      this._emitChange();
    });

    // City change
    if (citySelect && levels >= 2) {
      citySelect.addEventListener('change', () => {
        this._value.city = citySelect.value;
        this._value.district = '';

        if (districtSelect) {
          this._populateDistrictOptions(districtSelect, this._value.city);
        }

        this.clearError();
        this._emitChange();
      });
    }

    // District change
    if (districtSelect && levels >= 3) {
      districtSelect.addEventListener('change', () => {
        this._value.district = districtSelect.value;
        this.clearError();
        this._emitChange();
      });
    }

    // Detail input
    if (detailInput && showDetail) {
      detailInput.addEventListener('input', () => {
        this._value.detail = detailInput.value;
        this._emitChange();
      });
    }
  }

  // ------ Value display update ------

  _updateDisplay() {
    const body = this._getBody();
    if (!body || !this._rendered) {
      this._render();
      return;
    }

    const config = this._fieldDef?.config || {};
    const levels = config.levels ?? 3;

    const provinceSelect = body.querySelector('.addr-province');
    const citySelect = body.querySelector('.addr-city');
    const districtSelect = body.querySelector('.addr-district');
    const detailInput = body.querySelector('.addr-detail');

    if (provinceSelect) {
      this._populateProvinceOptions(provinceSelect);
      provinceSelect.value = this._value.province || '';
    }

    if (citySelect && levels >= 2) {
      this._populateCityOptions(citySelect, this._value.province);
      citySelect.value = this._value.city || '';
    }

    if (districtSelect && levels >= 3) {
      this._populateDistrictOptions(districtSelect, this._value.city);
      districtSelect.value = this._value.district || '';
    }

    if (detailInput) {
      detailInput.value = this._value.detail || '';
    }
  }

  // ------ Validation ------

  _validateType(config, _value) {
    const levels = config.levels ?? 3;
    const val = this._value;

    if (config.required) {
      if (!val.province) {
        this._errors.push('请选择省份');
        return;
      }
      if (levels >= 2 && !val.city) {
        this._errors.push('请选择城市');
        return;
      }
      if (levels >= 3 && !val.district) {
        this._errors.push('请选择区/县');
        return;
      }
    }
  }
}

customElements.define('ff-address', FFAddress);
