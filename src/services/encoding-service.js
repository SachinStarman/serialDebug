const iconv = require('iconv-lite');

class EncodingService {
  constructor() {
    this.supportedEncodings = {
      'ASCII': 'ascii',
      'UTF-8': 'utf-8',
      'GB2312': 'gb2312',
      'GBK': 'gbk',
      'UNICODE': 'utf-16le',
      'BIG5': 'big5',
      'Shift_JIS': 'shift_jis',
    };
  }

  getSupportedEncodings() {
    return Object.keys(this.supportedEncodings);
  }

  encode(text, encoding = 'UTF-8') {
    const enc = this.supportedEncodings[encoding] || 'utf-8';
    return Array.from(iconv.encode(text, enc));
  }

  decode(buffer, encoding = 'UTF-8') {
    const enc = this.supportedEncodings[encoding] || 'utf-8';
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    return iconv.decode(buf, enc);
  }
}

module.exports = EncodingService;
