import { memo } from 'react';
import type React from 'react';
import { Button, Badge, Alert, Drawer, Spin } from 'antd';
import { CloseCircleOutlined, CopyOutlined, ReloadOutlined, BugOutlined, CodeOutlined, KeyOutlined } from '@ant-design/icons';
import type { RefetchOptions, QueryObserverResult } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';
import type { DiagnosticEvidence, DiagnosticLogPayload, SocialAccount, PostQueue } from './types';

interface DiagnosticsDrawerProps {
  navigate: NavigateFunction;
  diagnosingPost: PostQueue;
  setDiagnosingPost: React.Dispatch<React.SetStateAction<PostQueue>>;
  setQuickCookieModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setQuickCookieTargetId: React.Dispatch<React.SetStateAction<number>>;
  socialAccounts: SocialAccount[];
  diagnosticLog: DiagnosticLogPayload;
  diagnosticLoading: boolean;
  diagnosticLoadError: Error;
  refetchDiagnostic: (options?: RefetchOptions) => Promise<QueryObserverResult<NoInfer<DiagnosticLogPayload>, Error>>;
  diagnosticEvidence: DiagnosticEvidence;
  copyDiagnostic: (errorOnly?: boolean) => Promise<void>;
}

// Chẩn đoán lỗi bài đăng — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
function DiagnosticsDrawer({
  navigate,
  diagnosingPost,
  setDiagnosingPost,
  setQuickCookieModalOpen,
  setQuickCookieTargetId,
  socialAccounts,
  diagnosticLog,
  diagnosticLoading,
  diagnosticLoadError,
  refetchDiagnostic,
  diagnosticEvidence,
  copyDiagnostic,
}: DiagnosticsDrawerProps) {
  return (
    <Drawer
      open={!!diagnosingPost}
      onClose={() => setDiagnosingPost(null)}
      size={760}
      className="diagnostic-drawer"
      title={
        <div className="flex items-center gap-3">
          <span className="diagnostic-title-icon"><BugOutlined /></span>
          <div>
            <div className="text-sm font-extrabold">Kiểm tra log bài #{diagnosingPost?.id}</div>
            <div className="text-[11px] text-slate-500 font-normal mt-0.5">Đối chiếu lỗi đã lưu với nhật ký Worker</div>
          </div>
        </div>
      }
      extra={<Button size="small" icon={<ReloadOutlined spin={diagnosticLoading} />} onClick={() => refetchDiagnostic()}>Làm mới</Button>}
    >
      {diagnosingPost && (
        <div className="diagnostic-content">
          <div className="diagnostic-summary-grid">
            <div><span>Bài đăng</span><b>#{diagnosingPost.id}</b></div>
            <div><span>Trạng thái</span><b className={`status-${diagnosingPost.status.toLowerCase()}`}>{diagnosingPost.status}</b></div>
            <div><span>Worker log</span><b>{diagnosticLog?.returned || 0} dòng đã quét</b></div>
          </div>

          <section className="diagnostic-section">
            <div className="diagnostic-section-title"><CloseCircleOutlined /> Lỗi hệ thống ghi nhận</div>
            {diagnosingPost.errorMessage ? (
              <div className="diagnostic-error-box"><code>{diagnosingPost.errorMessage}</code></div>
            ) : (
              <Alert type="info" showIcon message="Chưa có thông báo lỗi được lưu cho bài này" description="Nếu bài đang xử lý, hãy làm mới sau vài giây để xem dấu vết mới nhất." />
            )}
          </section>

          <section className="diagnostic-section">
            <div className="diagnostic-section-heading">
              <div>
                <div className="diagnostic-section-title"><CodeOutlined /> Dấu vết trong Worker log</div>
                <div className="diagnostic-match-note">
                  {diagnosticEvidence.exactMatch
                    ? `Đã tìm thấy ${diagnosticEvidence.matchCount} vị trí khớp với bài này.`
                    : 'Chưa tìm thấy định danh chính xác — đang hiển thị các lỗi Worker gần nhất để tham khảo.'}
                </div>
              </div>
              <Badge status={diagnosticEvidence.exactMatch ? 'success' : 'warning'} text={diagnosticEvidence.exactMatch ? 'Khớp chính xác' : 'Dữ liệu tham khảo'} />
            </div>

            <div className="diagnostic-terminal">
              {diagnosticLoading ? (
                <div className="diagnostic-empty"><Spin /><span>Đang quét 5.000 dòng log...</span></div>
              ) : diagnosticLoadError ? (
                <div className="diagnostic-empty"><Alert type="error" showIcon message="Không đọc được Worker log" /></div>
              ) : diagnosticEvidence.lines.length ? (
                diagnosticEvidence.lines.map((line, index) => <code key={`${index}-${line}`}>{line || ' '}</code>)
              ) : (
                <div className="diagnostic-empty">Không có dòng lỗi phù hợp.</div>
              )}
            </div>
          </section>

          <div className="diagnostic-actions">
            <Button icon={<CopyOutlined />} onClick={() => copyDiagnostic(true)}>Sao chép lỗi</Button>
            <Button type="primary" icon={<CopyOutlined />} onClick={() => copyDiagnostic(false)}>Sao chép gói chẩn đoán</Button>
            {diagnosingPost && (diagnosingPost.errorMessage?.toLowerCase().includes('cookie') || diagnosingPost.errorMessage?.toLowerCase().includes('hết hạn') || diagnosingPost.errorMessage?.toLowerCase().includes('không hợp lệ')) && (
              <Button
                type="primary"
                danger
                icon={<KeyOutlined />}
                onClick={() => {
                  const pageId = diagnosingPost.targetFanpageId?.split(':')[0];
                  const matchedAcc = socialAccounts?.find((a) => a.platformAccountId === pageId);
                  setQuickCookieTargetId(matchedAcc?.id);
                  setQuickCookieModalOpen(true);
                }}
                className="font-bold shadow"
              >
                🔑 Cập nhật Cookie ngay
              </Button>
            )}
            <Button
              icon={<CodeOutlined />}
              onClick={() => navigate(`/dashboard/logs?source=worker&lines=5000&query=${encodeURIComponent(diagnosticEvidence.searchToken)}`)}
            >
              Mở Logs đầy đủ
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

// Đang đóng thì bỏ qua các lần render lại theo trang cha (gõ phím, poll...); đang mở thì render như cũ
export default memo(DiagnosticsDrawer, (prev, next) => !prev.diagnosingPost && !next.diagnosingPost);
