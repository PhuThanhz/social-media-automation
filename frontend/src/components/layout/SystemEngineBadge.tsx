import { useQuery } from '@tanstack/react-query';
import { Popover, Button } from 'antd';
import { ThunderboltFilled, SyncOutlined } from '@ant-design/icons';
import api from '../../config/axios';

export default function SystemEngineBadge() {
  const { data, isError, refetch } = useQuery({
    queryKey: ['publishing-overview-badge'],
    queryFn: async () => {
      const res = await api.get('/publishing-control-center/overview');
      return res.data;
    },
    refetchInterval: 15000,
    staleTime: 5000,
  });

  const workerNodes = data?.workerNodes || [];
  const onlineWorkers = workerNodes.filter((w: any) => w.status === 'ONLINE');
  const isAllOnline = workerNodes.length > 0 && onlineWorkers.length === workerNodes.length;
  const isPartialOnline = onlineWorkers.length > 0 && !isAllOnline;

  const queueStats = data?.queueStats;
  const pendingCount = (queueStats?.pending || 0) + (queueStats?.scheduled || 0);
  const publishedCount = queueStats?.published || 0;

  const popoverContent = (
    <div className="w-72 p-1 text-xs select-none">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-700/60">
        <span className="font-extrabold text-slate-200 flex items-center gap-1.5">
          <ThunderboltFilled className="text-amber-400" /> Hệ thống Engine Xuất bản
        </span>
        <Button size="small" type="text" icon={<SyncOutlined />} onClick={() => refetch()} className="text-xs text-slate-400 hover:text-white" />
      </div>

      <div className="space-y-1.5 mb-2.5">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Trình duyệt Worker (Playwright):</div>
        <div className="grid grid-cols-1 gap-1">
          {workerNodes.map((w: any, idx: number) => (
            <div key={w.url || idx} className="flex items-center justify-between p-1.5 px-2 rounded-lg bg-slate-900/90 border border-slate-800">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${w.status === 'ONLINE' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                <span className="font-medium text-slate-200">Worker #{w.port || 3001 + idx}</span>
              </span>
              <span className="text-slate-400 text-[11px]">
                {w.status === 'ONLINE' ? (
                  <span className="text-emerald-400 font-bold">{w.latencyMs ?? 0}ms</span>
                ) : (
                  <span className="text-rose-400 font-bold">Offline</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 mb-2.5 space-y-1">
        <div className="flex justify-between text-slate-400">
          <span>Hàng đợi chờ đăng:</span>
          <b className="text-cyan-300 font-bold">{pendingCount} bài</b>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>Đã xuất bản:</span>
          <b className="text-emerald-300 font-bold">{publishedCount} bài</b>
        </div>
        <div className="flex justify-between text-slate-400">
          <span>Tài khoản kết nối:</span>
          <b className="text-slate-200 font-bold">{data?.totalAccountsCount || 0} nick</b>
        </div>
      </div>
    </div>
  );

  return (
    <Popover content={popoverContent} trigger="click" placement="bottomRight">
      <button
        type="button"
        title="Trạng thái hệ thống xuất bản"
        className={`h-9 px-2.5 sm:px-3 rounded-xl border flex items-center gap-1.5 sm:gap-2 text-xs font-bold transition-all cursor-pointer shrink-0 whitespace-nowrap ${
          isError
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            : isAllOnline
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
            : isPartialOnline
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
            : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700'
        }`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          isError ? 'bg-rose-400' : isAllOnline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
        }`} />
        <span className="hidden lg:inline">
          {isError ? 'Lỗi kết nối' : isAllOnline ? `${onlineWorkers.length} Worker Online` : 'Worker kiểm tra...'}
        </span>
        <span className="lg:hidden font-mono text-[11px]">
          {onlineWorkers.length}W
        </span>
      </button>
    </Popover>
  );
}
