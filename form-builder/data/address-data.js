/**
 * Chinese province/city/district cascade data (representative subset for demo).
 * Codes follow the GB/T 2260 standard.
 */

export const addressData = {
  provinces: [
    {
      code: '110000',
      name: '北京市',
      cities: [
        {
          code: '110100',
          name: '市辖区',
          districts: [
            { code: '110101', name: '东城区' },
            { code: '110102', name: '西城区' },
            { code: '110105', name: '朝阳区' },
            { code: '110108', name: '海淀区' }
          ]
        }
      ]
    },
    {
      code: '310000',
      name: '上海市',
      cities: [
        {
          code: '310100',
          name: '市辖区',
          districts: [
            { code: '310101', name: '黄浦区' },
            { code: '310104', name: '徐汇区' },
            { code: '310115', name: '浦东新区' }
          ]
        }
      ]
    },
    {
      code: '440000',
      name: '广东省',
      cities: [
        {
          code: '440100',
          name: '广州市',
          districts: [
            { code: '440106', name: '天河区' },
            { code: '440104', name: '越秀区' },
            { code: '440111', name: '白云区' }
          ]
        },
        {
          code: '440300',
          name: '深圳市',
          districts: [
            { code: '440305', name: '南山区' },
            { code: '440304', name: '福田区' },
            { code: '440306', name: '宝安区' }
          ]
        }
      ]
    },
    {
      code: '330000',
      name: '浙江省',
      cities: [
        {
          code: '330100',
          name: '杭州市',
          districts: [
            { code: '330106', name: '西湖区' },
            { code: '330102', name: '上城区' },
            { code: '330110', name: '余杭区' }
          ]
        },
        {
          code: '330200',
          name: '宁波市',
          districts: [
            { code: '330203', name: '海曙区' },
            { code: '330212', name: '鄞州区' }
          ]
        }
      ]
    },
    {
      code: '320000',
      name: '江苏省',
      cities: [
        {
          code: '320100',
          name: '南京市',
          districts: [
            { code: '320102', name: '玄武区' },
            { code: '320104', name: '秦淮区' },
            { code: '320106', name: '鼓楼区' }
          ]
        },
        {
          code: '320500',
          name: '苏州市',
          districts: [
            { code: '320508', name: '姑苏区' },
            { code: '320506', name: '吴中区' }
          ]
        }
      ]
    },
    {
      code: '510000',
      name: '四川省',
      cities: [
        {
          code: '510100',
          name: '成都市',
          districts: [
            { code: '510104', name: '锦江区' },
            { code: '510105', name: '青羊区' },
            { code: '510107', name: '武侯区' }
          ]
        }
      ]
    },
    {
      code: '420000',
      name: '湖北省',
      cities: [
        {
          code: '420100',
          name: '武汉市',
          districts: [
            { code: '420106', name: '武昌区' },
            { code: '420102', name: '汉口区' },
            { code: '420111', name: '洪山区' }
          ]
        }
      ]
    }
  ]
};

/**
 * Get all provinces as [{code, name}].
 */
export function getProvinces() {
  return addressData.provinces.map(p => ({ code: p.code, name: p.name }));
}

/**
 * Get cities for a given province code. Returns [{code, name}].
 */
export function getCities(provinceCode) {
  const province = addressData.provinces.find(p => p.code === provinceCode);
  if (!province) return [];
  return province.cities.map(c => ({ code: c.code, name: c.name }));
}

/**
 * Get districts for a given city code. Returns [{code, name}].
 */
export function getDistricts(cityCode) {
  for (const province of addressData.provinces) {
    const city = province.cities.find(c => c.code === cityCode);
    if (city) {
      return city.districts.map(d => ({ code: d.code, name: d.name }));
    }
  }
  return [];
}
