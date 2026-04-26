// VNPost Province Code Lookup
// Map Vietnamese province names to VNPost codes
export const PROVINCE_CODES = {
  'hà nội': '10', 'ha noi': '10',
  'hà giang': '20', 'ha giang': '20',
  'nghệ an': '43', 'nghe an': '43',
  'quảng trị': '48', 'quang tri': '48',
  'huế': '49', 'hue': '49',
  'đà nẵng': '50', 'da nang': '50',
  'quảng nam': '51', 'quang nam': '51',
  'bình định': '55', 'binh dinh': '55',
  'phú yên': '56', 'phu yen': '56',
  'khánh hòa': '57', 'khanh hoa': '57',
  'gia lai': '61',
  'đắk lắk': '63', 'dak lak': '63', 'đắk lăk': '63',
  'lâm đồng': '66', 'lam dong': '66',
  'hồ chí minh': '70', 'ho chi minh': '70', 'tp hcm': '70', 'sài gòn': '70', 'sai gon': '70',
  'bình dương': '75', 'binh duong': '75',
  'đồng nai': '76', 'dong nai': '76',
  'bình thuận': '77', 'binh thuan': '77',
  'tây ninh': '80', 'tay ninh': '80',
  'đồng tháp': '81', 'dong thap': '81',
  'long an': '82',
  'tiền giang': '84', 'tien giang': '84',
  'vĩnh long': '85', 'vinh long': '85',
  'bến tre': '86', 'ben tre': '86',
  'trà vinh': '87', 'tra vinh': '87',
  'an giang': '90',
  'kiên giang': '91', 'kien giang': '91',
  'cần thơ': '94', 'can tho': '94',
  'hậu giang': '95', 'hau giang': '95',
  'sóc trăng': '96', 'soc trang': '96',
  'bạc liêu': '97', 'bac lieu': '97',
  'cà mau': '98', 'ca mau': '98',
  'quảng bình': '47', 'quang binh': '47',
  'quảng ngãi': '52', 'quang ngai': '52',
  'ninh thuận': '58', 'ninh thuan': '58',
  'kon tum': '60',
  'đắk nông': '64', 'dak nong': '64',
  'bình phước': '74', 'binh phuoc': '74',
  'bà rịa': '78', 'ba ria': '78', 'vũng tàu': '78', 'vung tau': '78',
  'thái bình': '30', 'thai binh': '30',
  'nam định': '31', 'nam dinh': '31',
  'hải phòng': '32', 'hai phong': '32',
  'thanh hóa': '40', 'thanh hoa': '40',
  'hà tĩnh': '42', 'ha tinh': '42',
  'quảng trị': '48',
}

// Find province code from address text
export function findProvinceCode(address) {
  const lower = address.toLowerCase()
    .replace(/tỉnh\s+/g, '')
    .replace(/tp\.?\s*/g, '')
    .replace(/thành phố\s+/g, '')
  
  for (const [name, code] of Object.entries(PROVINCE_CODES)) {
    if (lower.includes(name)) return code
  }
  return null
}
