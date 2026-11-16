export interface FacebookCookies {
  cUser: string;
  xs: string;
  datr: string;
  sb: string;
  fr: string;
  wd: string;
  dpr: string;
  locale: string;
  vpd: string;
  presence: string;
  pas: string;
  ps_l: string;
  ps_n: string;
  wl_cbv: string;
  extraPairs: Record<string, string>;
}

export const INITIAL_FACEBOOK_COOKIES: FacebookCookies = {
  cUser: '',
  xs: '',
  datr: '',
  sb: '',
  fr: '',
  wd: '',
  dpr: '',
  locale: '',
  vpd: '',
  presence: '',
  pas: '',
  ps_l: '',
  ps_n: '',
  wl_cbv: '',
  extraPairs: {},
};

export function assignCookieField(target: FacebookCookies, rawName: string, val: string) {
  const name = rawName.trim().toLowerCase();
  const cleanVal = val.trim();
  if (!name || !cleanVal) return;

  switch (name) {
    case 'c_user':
      target.cUser = cleanVal;
      break;
    case 'xs':
      target.xs = cleanVal;
      break;
    case 'datr':
      target.datr = cleanVal;
      break;
    case 'sb':
      target.sb = cleanVal;
      break;
    case 'fr':
      target.fr = cleanVal;
      break;
    case 'wd':
      target.wd = cleanVal;
      break;
    case 'dpr':
      target.dpr = cleanVal;
      break;
    case 'locale':
      target.locale = cleanVal;
      break;
    case 'vpd':
      target.vpd = cleanVal;
      break;
    case 'presence':
      target.presence = cleanVal;
      break;
    case 'pas':
      target.pas = cleanVal;
      break;
    case 'ps_l':
      target.ps_l = cleanVal;
      break;
    case 'ps_n':
      target.ps_n = cleanVal;
      break;
    case 'wl_cbv':
      target.wl_cbv = cleanVal;
      break;
    default:
      target.extraPairs[rawName.trim()] = cleanVal;
      break;
  }
}

export function parseAllFacebookCookies(rawText: string, defaultCUser = ''): {
  cookies: FacebookCookies;
  isValid: boolean;
  fullCookie: string;
  count: number;
  hasSecuritySuite: boolean;
} {
  const result: FacebookCookies = { ...INITIAL_FACEBOOK_COOKIES, extraPairs: {} };
  const text = (rawText || '').trim();

  if (!text && !defaultCUser) {
    return { cookies: result, isValid: false, fullCookie: '', count: 0, hasSecuritySuite: false };
  }

  // 1. JSON format từ Extension (J2Team, Cookie-Editor, EditThisCookie dạng [...] hoặc {"url": "...", "cookies": [...]})
  let isJsonParsed = false;
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      const parsedJson = JSON.parse(text);
      const arr = Array.isArray(parsedJson)
        ? parsedJson
        : Array.isArray(parsedJson.cookies)
        ? parsedJson.cookies
        : null;

      if (Array.isArray(arr)) {
        for (const item of arr) {
          const name = String(item?.name || item?.key || '').trim();
          const val = String(item?.value || item?.val || '').trim();
          if (name && val) {
            assignCookieField(result, name, val);
          }
        }
        isJsonParsed = true;
      } else if (parsedJson && typeof parsedJson === 'object') {
        // Hỗ trợ dạng key-value trực tiếp: {"c_user": "...", "xs": "..."}
        for (const [k, v] of Object.entries(parsedJson)) {
          if (k && v !== undefined && v !== null && typeof v !== 'object') {
            assignCookieField(result, k, String(v));
          }
        }
        isJsonParsed = true;
      }
    } catch {
      // fallback sang regex / text splitter
    }
  }

  if (!isJsonParsed) {
    // 2. Phân tích chuỗi name=val; name2=val2 hoặc từng dòng
    const entries = text.split(/[;\n\r]+/);
    for (const entry of entries) {
      const trimmed = entry.trim();
      if (!trimmed) continue;

      const eqIdx = trimmed.indexOf('=');
      const colonIdx = trimmed.indexOf(':');

      let name = '';
      let val = '';

      if (eqIdx > 0 && (colonIdx < 0 || eqIdx < colonIdx)) {
        name = trimmed.slice(0, eqIdx).trim().replace(/^["']|["']$/g, '');
        val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      } else if (colonIdx > 0) {
        name = trimmed.slice(0, colonIdx).trim().replace(/^["']|["']$/g, '');
        val = trimmed.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      } else if (!result.xs && trimmed.length > 20 && trimmed.includes('%3A')) {
        name = 'xs';
        val = trimmed;
      }

      if (name && val) {
        assignCookieField(result, name, val);
      }
    }
  }

  if (!result.cUser && defaultCUser) {
    result.cUser = defaultCUser;
  }

  const isValid = Boolean(result.cUser && result.xs);
  const fullCookie = buildCookieString(result);
  const count = countCookies(result);
  const hasSecuritySuite = Boolean(result.cUser && result.xs && (result.datr || result.sb));

  return {
    cookies: result,
    isValid,
    fullCookie,
    count,
    hasSecuritySuite,
  };
}

export function buildCookieString(cookies: Partial<FacebookCookies>): string {
  const parts: string[] = [];
  if (cookies.cUser) parts.push(`c_user=${cookies.cUser.trim()}`);
  if (cookies.xs) parts.push(`xs=${cookies.xs.trim()}`);
  if (cookies.datr) parts.push(`datr=${cookies.datr.trim()}`);
  if (cookies.sb) parts.push(`sb=${cookies.sb.trim()}`);
  if (cookies.fr) parts.push(`fr=${cookies.fr.trim()}`);
  if (cookies.wd) parts.push(`wd=${cookies.wd.trim()}`);
  if (cookies.dpr) parts.push(`dpr=${cookies.dpr.trim()}`);
  if (cookies.locale) parts.push(`locale=${cookies.locale.trim()}`);
  if (cookies.vpd) parts.push(`vpd=${cookies.vpd.trim()}`);
  if (cookies.presence) parts.push(`presence=${cookies.presence.trim()}`);
  if (cookies.pas) parts.push(`pas=${cookies.pas.trim()}`);
  if (cookies.ps_l) parts.push(`ps_l=${cookies.ps_l.trim()}`);
  if (cookies.ps_n) parts.push(`ps_n=${cookies.ps_n.trim()}`);
  if (cookies.wl_cbv) parts.push(`wl_cbv=${cookies.wl_cbv.trim()}`);
  if (cookies.extraPairs) {
    for (const [k, v] of Object.entries(cookies.extraPairs)) {
      if (k && v) parts.push(`${k}=${v.trim()}`);
    }
  }
  return parts.join('; ');
}

export function countCookies(cookies: Partial<FacebookCookies>): number {
  let cnt = 0;
  if (cookies.cUser) cnt++;
  if (cookies.xs) cnt++;
  if (cookies.datr) cnt++;
  if (cookies.sb) cnt++;
  if (cookies.fr) cnt++;
  if (cookies.wd) cnt++;
  if (cookies.dpr) cnt++;
  if (cookies.locale) cnt++;
  if (cookies.vpd) cnt++;
  if (cookies.presence) cnt++;
  if (cookies.pas) cnt++;
  if (cookies.ps_l) cnt++;
  if (cookies.ps_n) cnt++;
  if (cookies.wl_cbv) cnt++;
  if (cookies.extraPairs) cnt += Object.keys(cookies.extraPairs).length;
  return cnt;
}
