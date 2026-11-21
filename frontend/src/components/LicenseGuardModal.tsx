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
  const [countdown, setCountdown] = useState<number | null>(null);
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
      if (fresh.revoked) {
        setIsOpen(true);
        setRevokedReason(fresh.reason || 'Bản quyền đã bị khóa hoặc thu hồi từ xa!');
      } else if (fresh.valid && fresh.info) {
        setIsOpen(false);
        onAuthorized?.(fresh.info);
      }

      // Rust kiểm tra định kỳ mỗi 30s; chỉ khi Admin chủ động bấm Khóa (revoked = true) mới đóng app
      unlisten = await licenseService.onInvalid((state) => {
        if (state.revoked) {
          setRevokedReason(`${state.reason || 'Bản quyền đã bị khóa hoặc thu hồi từ xa!'}`);
          setIsOpen(true);
        }
      });
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  // Đếm ngược 5 giây rồi tắt hẳn ứng dụng khi bị khóa bản quyền
  useEffect(() => {
    if (revokedReason) {
      setCountdown(5);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(timer);
            licenseService.kill();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [revokedReason]);

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
          <p className="text-[13px] text-slate-300 mt-1">
            Ứng dụng Desktop tự động hóa PhuSocial
          </p>
        </div>

        {revokedReason && (
          <div className="bg-rose-950/90 border-2 border-rose-500/70 rounded-xl p-4 text-left flex items-start gap-3.5 shadow-2xl shadow-rose-950/80">
            <CloseCircleFilled className="text-rose-400 text-xl mt-0.5 shrink-0" />
            <div className="space-y-1.5 flex-1">
              <div className="text-sm font-bold text-white tracking-wide flex items-center justify-between">
                <span>Bản quyền không còn hiệu lực</span>
                {countdown !== null && (
                  <span className="text-xs bg-rose-600/50 text-rose-100 font-mono px-2 py-0.5 rounded-full border border-rose-400/50 animate-pulse">
                    Đóng sau {countdown}s
                  </span>
                )}
              </div>
              <div className="text-xs text-rose-100 font-medium leading-relaxed">
                {revokedReason}
              </div>
            </div>
          </div>
        )}

        {/* Khối hiển thị mã HWID */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-left space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <DesktopOutlined className="text-cyan-400" /> Mã phần cứng máy (HWID):
            </span>
            <Tooltip title="Sao chép gửi cho Admin cấp bản quyền">
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                onClick={copyHWID}
                className="!text-xs !text-cyan-300 hover:!text-cyan-200"
              >
                Sao chép
              </Button>
            </Tooltip>
          </div>
          <div className="font-mono text-[13px] font-bold text-cyan-300 bg-slate-950/80 p-2 rounded-lg border border-slate-800/80 select-all break-all">
            {hwid}
          </div>
          <p className="text-xs text-slate-300 italic">
            * Mỗi bản quyền được khóa cứng vào đúng máy tính này để bảo mật dữ liệu và chống dùng chung.
          </p>
        </div>

        {/* Khối nhập License Key */}
        <div className="space-y-2 text-left pt-1">
          <label className="text-[13px] font-semibold text-slate-200 flex items-center gap-1.5">
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

        <div className="pt-1 text-xs text-slate-300 flex items-center justify-center gap-1.5">
          <span>Hỗ trợ kỹ thuật & Gia hạn bản quyền:</span>
          <span className="text-slate-100 font-medium">Admin Thạnh Phú</span>
        </div>
      </div>
    </Modal>
  );
};
