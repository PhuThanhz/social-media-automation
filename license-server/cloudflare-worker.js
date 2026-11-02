/**
 * ⚠️ CHƯA DÙNG ĐƯỢC VỚI APP DESKTOP HIỆN TẠI.
 * App Desktop chỉ chấp nhận token ký Ed25519 (xem issueToken trong server.js); worker này không ký token,
 * không kiểm tra hạn dùng và không có Admin API. Hãy dùng server.js (VPS) cho tới khi worker được viết lại.
 */
/**
 * CLOUDFLARE WORKER LICENSE SERVER (0 đồng - Miễn phí trọn đời)
 * 
 * Hướng dẫn triển khai (Deploy trong 2 phút):
 * 1. Truy cập https://dash.cloudflare.com -> Workers & Pages -> Create Application
 * 2. Chọn "Create Worker", dán toàn bộ code này vào.
 * 3. Tạo 1 KV Namespace tên là: LICENSE_KV và bind vào Worker với biến tên `LICENSE_KV`.
 * 4. Tạo biến Secret `ADMIN_SECRET` = "mat_khau_cua_ban".
 * 5. Bấm Deploy! Bạn sẽ có ngay API https://ten-worker-cua-ban.workers.dev
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-secret',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. API Kích Hoạt: POST /api/license/activate
    if (url.pathname === '/api/license/activate' && request.method === 'POST') {
      try {
        const { licenseKey, hwid } = await request.json();
        if (!licenseKey || !hwid) {
          return Response.json({ success: false, message: 'Thiếu licenseKey hoặc hwid' }, { status: 400, headers: corsHeaders });
        }

        const dataStr = await env.LICENSE_KV.get(`key:${licenseKey.trim().toUpperCase()}`);
        if (!dataStr) {
          return Response.json({ success: false, message: 'Mã License Key không tồn tại' }, { status: 404, headers: corsHeaders });
        }

        const license = JSON.parse(dataStr);
        if (license.status === 'LOCKED') {
          return Response.json({ success: false, message: 'License đã bị khóa từ xa bởi Admin!' }, { status: 403, headers: corsHeaders });
        }

        if (!license.hwid) {
          // Gắn máy lần đầu
          license.hwid = hwid.trim();
          license.last_ping_at = new Date().toISOString();
          await env.LICENSE_KV.put(`key:${license.license_key}`, JSON.stringify(license));
          return Response.json({ success: true, message: 'Kích hoạt thành công!', clientName: license.client_name, status: 'ACTIVE', expiresAt: license.expires_at }, { headers: corsHeaders });
        }

        if (license.hwid !== hwid.trim()) {
          return Response.json({ success: false, message: 'License này đã gắn với máy tính khác!' }, { status: 403, headers: corsHeaders });
        }

        return Response.json({ success: true, message: 'Xác thực thành công!', clientName: license.client_name, status: 'ACTIVE', expiresAt: license.expires_at }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ success: false, error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 2. API Ping Heartbeat: POST /api/license/ping
    if (url.pathname === '/api/license/ping' && request.method === 'POST') {
      try {
        const { licenseKey, hwid } = await request.json();
        const dataStr = await env.LICENSE_KV.get(`key:${licenseKey.trim().toUpperCase()}`);
        if (!dataStr) {
          return Response.json({ valid: false, status: 'NOT_FOUND' }, { status: 404, headers: corsHeaders });
        }

        const license = JSON.parse(dataStr);
        if (license.status === 'LOCKED') {
          return Response.json({ valid: false, status: 'LOCKED', message: 'Tài khoản đã bị khóa từ xa bởi quản trị viên.' }, { headers: corsHeaders });
        }

        if (license.hwid && license.hwid !== hwid.trim()) {
          return Response.json({ valid: false, status: 'HWID_MISMATCH' }, { headers: corsHeaders });
        }

        license.last_ping_at = new Date().toISOString();
        await env.LICENSE_KV.put(`key:${license.license_key}`, JSON.stringify(license));
        return Response.json({ valid: true, status: 'ACTIVE', clientName: license.client_name }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ valid: false, error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    return Response.json({ message: 'ToolZutter Cloudflare License Service is Running' }, { headers: corsHeaders });
  }
};
