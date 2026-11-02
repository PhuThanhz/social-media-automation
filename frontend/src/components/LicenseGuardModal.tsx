import React, { useState, useEffect } from 'react';
import { Modal, Input, Button, Tag, message, Alert, Tooltip } from 'antd';
import { 
  SafetyCertificateOutlined, 
  CopyOutlined, 
  KeyOutlined, 
  LockOutlined, 
  CheckCircleFilled, 
  CloseCircleFilled, 
  DesktopOutlined 
} from '@ant-design/icons';
import { licenseService, isTauri, LicenseInfo } from '../services/license.service';

interface LicenseGuardModalProps {
  onAuthorized?: (info: LicenseInfo) => void;
}

export const LicenseGuardModal: React.FC<LicenseGuardModalProps> = (props) => {
  // Bản web (trình duyệt) không khóa bản quyền; chỉ bản Desktop giao cho khách
  if (!isTauri()) return null;
  return <DesktopLicenseGuard {...props} />;
};

const DesktopLicenseGuard: React.FC<LicenseGuardModalProps> = ({ onAuthorized }) => {
  const [hwid, setHwid] = useState<string>('Đang đọc mã máy...');
  const [keyInput, setKeyInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [revokedReason, setRevokedReason] = useState<string | null>(null);
  // Chỉ mở khi đã biết bản quyền chưa hợp lệ (tránh chớp hộp thoại mỗi lần mở app)
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      setHwid(await licenseService.getHWID());

      // Token còn hạn trong máy → mở app ngay, rồi xác nhận lại với server
      const local = await licenseService.status();
      if (local.valid && local.info) {
        onAuthorized?.(local.info);
      } else {
        setIsOpen(true);
      }
      const fresh = await licenseService.refresh();
      if (!fresh.valid) {
        setIsOpen(true);
        if (local.valid || fresh.revoked) setRevokedReason(fresh.reason);
      } else if (!local.valid && fresh.info) {
        setIsOpen(false);
        onAuthorized?.(fresh.info);
      }

      // Rust kiểm tra định kỳ; key bị khóa thì báo ở đây rồi tự đóng app sau vài giây
      unlisten = await licenseService.onInvalid((state) => {
        setRevokedReason(`${state.reason || 'Bản quyền không còn hiệu lực.'} Ứng dụng sẽ tự đóng.`);
        setIsOpen(true);
      });
    })();

    return () => unlisten?.();
  }, []);

  const handleActivate = async () => {
    if (!keyInput.trim()) {
      return message.warning('Vui lòng nhập License Key!');
    }
    setLoading(true);
    try {
      const res = await licenseService.activate(keyInput);
      if (res.success && res.state?.info) {
        setRevokedReason(null);
        setIsOpen(false);
        message.success('Kích hoạt bản quyền thành công! Chúc bạn sử dụng hiệu quả.');
        onAuthorized?.(res.state.info);
      } else {
        message.error(res.message || 'Mã bản quyền không hợp lệ hoặc đã bị khóa!');
      }
    } finally {
      setLoading(false);
    }
  };

  const copyHWID = () => {
    navigator.clipboard.writeText(hwid);
    message.success('Đã sao chép mã máy HWID vào bộ nhớ tạm!');
  };

  return (
    <Modal
      open={isOpen}
      closable={false}
      maskClosable={false}
      footer={null}
      centered
      width={480}
      className="license-guard-modal"
      styles={{
        body: {
          background: 'linear-gradient(145deg, #0f172a, #0b0f19)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          borderRadius: '20px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 40px rgba(59, 130, 246, 0.15)',
          padding: '28px',
          color: '#f8fafc',
        },
      }}
    >
      <div className="text-center space-y-3">
        <div className="inline-flex p-3.5 rounded-2xl bg-blue-600/15 border border-blue-500/30 text-blue-400 text-3xl shadow-lg shadow-blue-500/10">
          <SafetyCertificateOutlined />
        </div>

        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Xác Thực Bản Quyền Phần Mềm</h2>
          <p className="text-xs text-slate-400 mt-1">
            Ứng dụng Desktop tự động hóa ToolZutter
          </p>
        </div>

        {revokedReason && (
          <Alert
            type="error"
            showIcon
            message="Bản quyền không còn hiệu lực"
            description={revokedReason}
            className="!bg-rose-950/60 !border-rose-600/40 !text-rose-200 text-left rounded-xl"
          />
        )}

        {/* Khối hiển thị mã HWID */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-left space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
              <DesktopOutlined className="text-cyan-400" /> Mã phần cứng máy (HWID):
            </span>
            <Tooltip title="Sao chép gửi cho Admin cấp bản quyền">
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                onClick={copyHWID}
                className="!text-xs !text-cyan-400 hover:!text-cyan-300"
              >
                Sao chép
              </Button>
            </Tooltip>
          </div>
          <div className="font-mono text-xs font-bold text-cyan-300 bg-slate-950/80 p-2 rounded-lg border border-slate-800/80 select-all break-all">
            {hwid}
          </div>
          <p className="text-[10px] text-slate-500 italic">
            * Mỗi bản quyền được khóa cứng vào đúng máy tính này để bảo mật dữ liệu và chống dùng chung.
          </p>
        </div>

        {/* Khối nhập License Key */}
        <div className="space-y-2 text-left pt-1">
          <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <KeyOutlined className="text-blue-400" /> Nhập License Key của bạn:
          </label>
          <Input.Password
            size="large"
            prefix={<LockOutlined className="text-slate-500" />}
            placeholder="Ví dụ: ZTR-XXXX-XXXX-XXXX"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onPressEnter={handleActivate}
            className="!bg-slate-950 !border-slate-700 !text-white !rounded-xl font-mono text-sm"
          />
        </div>

        <div className="pt-2">
          <Button
            type="primary"
            size="large"
            block
            loading={loading}
            onClick={handleActivate}
            className="!h-11 !rounded-xl !bg-gradient-to-r !from-blue-600 !to-indigo-600 hover:!from-blue-500 hover:!to-indigo-500 !font-bold !text-sm !border-0 shadow-lg shadow-blue-600/30"
          >
            KÍCH HOẠT VÀ MỞ ỨNG DỤNG
          </Button>
        </div>

        <div className="pt-1 text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
          <span>Hỗ trợ kỹ thuật & Gia hạn bản quyền:</span>
          <span className="text-slate-400 font-medium">Admin Thạnh Phú</span>
        </div>
      </div>
    </Modal>
  );
};
