import React, { useState, useMemo } from 'react';
import { Modal, Button, Input, Table, Tooltip, App, Tag, Segmented } from 'antd';
import type { TableProps } from 'antd';
import {
  LinkOutlined,
  CopyOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  SearchOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  ShareAltOutlined,
  CheckCircleFilled,
  VideoCameraOutlined,
  PictureOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { PostQueue } from './types';
import { detectPostMedia, type PostMediaType } from './shared';

interface ExportPendingLinksModalProps {
  open: boolean;
  onClose: () => void;
  posts: PostQueue[];
  selectedRowKeys?: React.Key[];
  initialSelectedOnly?: boolean;
}

export default function ExportPendingLinksModal({
  open,
  onClose,
  posts,
  selectedRowKeys = [],
  initialSelectedOnly = false,
}: ExportPendingLinksModalProps) {
  const { message } = App.useApp();
  const [scope, setScope] = useState<'PENDING' | 'SELECTED' | 'ALL'>(
    initialSelectedOnly && selectedRowKeys.length > 0 ? 'SELECTED' : 'PENDING'
  );
  const [mediaTypeFilter, setMediaTypeFilter] = useState<PostMediaType>('ALL');
  const [deduplicate, setDeduplicate] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [allCopied, setAllCopied] = useState<boolean>(false);

  // Đồng bộ scope khi mở modal
  React.useEffect(() => {
    if (open) {
      if (initialSelectedOnly && selectedRowKeys.length > 0) {
        setScope('SELECTED');
      } else {
        setScope('PENDING');
      }
      setMediaTypeFilter('ALL');
      setSearchText('');
      setAllCopied(false);
    }
  }, [open, initialSelectedOnly, selectedRowKeys.length]);

  // Lọc bài theo scope đã chọn
  const basePosts = useMemo(() => {
    if (!posts || posts.length === 0) return [];
    if (scope === 'SELECTED') {
      const selectedSet = new Set(selectedRowKeys.map(String));
      return posts.filter((p) => selectedSet.has(String(p.id)));
    }
    if (scope === 'PENDING') {
      return posts.filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING');
    }
    return posts;
  }, [posts, scope, selectedRowKeys]);

  // Thống kê số lượng media trong phạm vi hiện tại
  const mediaCounts = useMemo(() => {
    let video = 0;
    let image = 0;
    let text = 0;
    basePosts.forEach((p) => {
      const info = detectPostMedia(p);
      if (info.hasVideo) video++;
      else if (info.hasImage) image++;
      else text++;
    });
    return { all: basePosts.length, video, image, text };
  }, [basePosts]);

  // Lọc theo Media Type, Tìm kiếm, Lọc trùng
  const filteredPosts = useMemo(() => {
    let result = basePosts;

    // 1. Lọc theo định dạng Media
    if (mediaTypeFilter !== 'ALL') {
      result = result.filter((p) => {
        const info = detectPostMedia(p);
        if (mediaTypeFilter === 'VIDEO') return info.hasVideo;
        if (mediaTypeFilter === 'IMAGE') return info.hasImage && !info.hasVideo;
        if (mediaTypeFilter === 'TEXT') return info.isTextOnly || info.isColorBackground;
        return true;
      });
    }

    // 2. Lọc theo tìm kiếm từ khóa
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      result = result.filter(
        (p) =>
          (p.title && p.title.toLowerCase().includes(q)) ||
          (p.originalUrl && p.originalUrl.toLowerCase().includes(q)) ||
          (p.targetGroupNames && p.targetGroupNames.toLowerCase().includes(q)) ||
          (p.targetFanpageId && p.targetFanpageId.toLowerCase().includes(q)) ||
          String(p.id).includes(q)
      );
    }

    // 3. Lọc trùng link
    if (deduplicate) {
      const seen = new Set<string>();
      result = result.filter((p) => {
        const link = (p.originalUrl || '').trim();
        if (!link) return true;
        if (seen.has(link)) return false;
        seen.add(link);
        return true;
      });
    }
    return result;
  }, [basePosts, mediaTypeFilter, searchText, deduplicate]);

  // Trích xuất danh sách link hợp lệ
  const validUrls = useMemo(() => {
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const p of filteredPosts) {
      const url = (p.originalUrl || '').trim();
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        if (!deduplicate || !seen.has(url)) {
          urls.push(url);
          seen.add(url);
        }
      }
    }
    return urls;
  }, [filteredPosts, deduplicate]);

  // Sao chép 1 link riêng lẻ
  const handleCopySingle = async (url: string, id: number) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      message.success('Đã sao chép link!');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      message.error('Không thể sao chép vào bộ nhớ đệm');
    }
  };

  // Sao chép toàn bộ link
  const handleCopyAll = async () => {
    if (validUrls.length === 0) {
      message.warning('Không có đường link nào để sao chép');
      return;
    }
    try {
      await navigator.clipboard.writeText(validUrls.join('\n'));
      setAllCopied(true);
      message.success(`Đã sao chép toàn bộ ${validUrls.length} link vào clipboard!`);
      setTimeout(() => setAllCopied(false), 3000);
    } catch {
      message.error('Không thể sao chép vào bộ nhớ đệm');
    }
  };

  // Xuất file .TXT
  const handleExportTxt = () => {
    if (validUrls.length === 0) {
      message.warning('Không có đường link nào để xuất');
      return;
    }
    const content = validUrls.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `danh_sach_link_cho_dang_${dayjs().format('YYYYMMDD_HHmmss')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    message.success(`Đã tải xuống file TXT (${validUrls.length} link)`);
  };

  // Xuất file CSV (UTF-8 có BOM để mở bằng Excel tiếng Việt không bị lỗi font)
  const handleExportCsv = () => {
    if (filteredPosts.length === 0) {
      message.warning('Không có dữ liệu bài viết để xuất');
      return;
    }

    const headers = ['STT', 'ID Bài', 'Tiêu đề', 'Định dạng', 'Đường link gốc', 'Nơi đăng (Nhóm/Page)', 'Giờ hẹn đăng', 'Trạng thái'];
    const rows = filteredPosts.map((p, idx) => {
      const mediaInfo = detectPostMedia(p);
      return [
        idx + 1,
        p.id,
        `"${(p.title || '').replace(/"/g, '""')}"`,
        `"${mediaInfo.badgeText}"`,
        `"${(p.originalUrl || '').replace(/"/g, '""')}"`,
        `"${(p.targetGroupNames || p.targetFanpageId || '').replace(/"/g, '""')}"`,
        p.scheduledAt ? dayjs(p.scheduledAt).format('YYYY-MM-DD HH:mm:ss') : '',
        p.status || 'PENDING',
      ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `xuat_link_cho_dang_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    message.success(`Đã tải xuống file CSV (${filteredPosts.length} dòng)`);
  };

  const columns: TableProps<PostQueue>['columns'] = [
    {
      title: '#',
      dataIndex: 'index',
      key: 'index',
      width: 45,
      align: 'center',
      render: (_: unknown, __: unknown, index: number) => (
        <span className="font-mono text-xs text-slate-400 font-semibold">{index + 1}</span>
      ),
    },
    {
      title: 'Định dạng',
      key: 'mediaType',
      width: 105,
      align: 'center',
      render: (_: unknown, record: PostQueue) => {
        const info = detectPostMedia(record);
        return (
          <Tooltip title={`${info.label} (${info.badgeText})`}>
            <Tag color={info.tagColor} className="m-0 text-xs font-semibold">
              {info.badgeText}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Tiêu đề bài viết',
      dataIndex: 'title',
      key: 'title',
      width: 260,
      render: (title: string, record: PostQueue) => (
        <div className="space-y-0.5">
          <div className="font-medium text-xs text-slate-200 line-clamp-2" title={title || record.content}>
            {title || record.content?.slice(0, 80) || '(Không có tiêu đề)'}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            ID: #{record.id}
          </div>
        </div>
      ),
    },
    {
      title: 'Đường link gốc',
      dataIndex: 'originalUrl',
      key: 'originalUrl',
      render: (url: string, record: PostQueue) => {
        if (!url) {
          return <span className="text-slate-500 italic text-xs">(Không có link gốc)</span>;
        }
        const isCopied = copiedId === record.id;
        return (
          <div className="flex items-center gap-2 max-w-full">
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-blue-400 hover:text-blue-300 underline font-mono truncate max-w-[260px] sm:max-w-[340px] inline-block"
              title={url}
            >
              {url}
            </a>
            <Tooltip title={isCopied ? 'Đã sao chép!' : 'Sao chép link'}>
              <button
                type="button"
                onClick={() => handleCopySingle(url, record.id)}
                className={`p-1 rounded-md text-xs transition-colors shrink-0 cursor-pointer ${
                  isCopied
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700'
                }`}
              >
                {isCopied ? <CheckOutlined /> : <CopyOutlined />}
              </button>
            </Tooltip>
          </div>
        );
      },
    },
    {
      title: 'Nơi đăng',
      key: 'target',
      width: 160,
      render: (_: unknown, record: PostQueue) => (
        <div className="text-xs space-y-0.5 max-w-[150px]">
          {record.targetGroupNames ? (
            <div className="truncate text-slate-300" title={record.targetGroupNames}>
              👥 {record.targetGroupNames}
            </div>
          ) : null}
          {record.targetFanpageId ? (
            <div className="truncate text-slate-400 text-[11px]" title={record.targetFanpageId}>
              📄 {record.targetFanpageId}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Giờ hẹn đăng',
      dataIndex: 'scheduledAt',
      key: 'scheduledAt',
      width: 130,
      render: (scheduledAt: string) => {
        if (!scheduledAt) return <span className="text-slate-500 text-xs">—</span>;
        const d = dayjs(scheduledAt);
        return (
          <div className="text-xs font-mono text-amber-300 flex items-center gap-1">
            <ClockCircleOutlined className="text-[11px] text-amber-400 shrink-0" />
            <span>{d.format('HH:mm DD/MM')}</span>
          </div>
        );
      },
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 95,
      align: 'center',
      render: (status: string) => {
        if (status === 'PENDING') {
          return <Tag color="warning" className="m-0 text-[11px] font-semibold">Chờ đăng</Tag>;
        }
        if (status === 'PROCESSING') {
          return <Tag color="processing" className="m-0 text-[11px] font-semibold">Đang đăng</Tag>;
        }
        if (status === 'PUBLISHED') {
          return <Tag color="success" className="m-0 text-[11px] font-semibold">Đã đăng</Tag>;
        }
        if (status === 'FAILED') {
          return <Tag color="error" className="m-0 text-[11px] font-semibold">Lỗi</Tag>;
        }
        return <Tag className="m-0 text-[11px]">{status}</Tag>;
      },
    },
  ];

  return (
    <Modal
      title={
        <div className="flex items-center justify-between gap-3 pr-6 py-0.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
              <LinkOutlined />
            </div>
            <div>
              <div className="font-bold text-base text-slate-100 flex items-center gap-2">
                <span>Danh sách Link bài chờ đăng</span>
                <span className="px-2 py-0.5 rounded-lg bg-blue-500/20 text-blue-300 font-mono text-xs font-bold border border-blue-500/30">
                  {validUrls.length} link / {filteredPosts.length} bài
                </span>
              </div>
            </div>
          </div>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={1060}
      className="max-w-[calc(100vw-24px)] export-pending-links-modal"
      footer={
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-1">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>
              Tổng số link hợp lệ: <strong className="text-blue-300 font-mono">{validUrls.length}</strong>
            </span>
            <span>•</span>
            <span>
              Bài hiển thị: <strong className="text-slate-200 font-mono">{filteredPosts.length}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              type="primary"
              icon={allCopied ? <CheckCircleFilled /> : <CopyOutlined />}
              onClick={handleCopyAll}
              className={`${
                allCopied ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'
              } text-white font-semibold text-xs rounded-xl h-8 px-4 border-none shadow-sm transition-all`}
            >
              {allCopied ? 'Đã sao chép tất cả!' : `Sao chép tất cả (${validUrls.length} link)`}
            </Button>
            <Button
              onClick={onClose}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 rounded-xl text-xs h-8 px-4"
            >
              Đóng
            </Button>
          </div>
        </div>
      }
    >
      <div className="py-2 space-y-3">
        {/* THANH ĐIỀU KHIỂN & BỘ LỌC PHẠM VI */}
        <div className="p-3 bg-slate-900/90 rounded-2xl border border-slate-800/80 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
          {/* Lọc phạm vi */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400 font-medium">Phạm vi:</span>
            <Segmented
              size="small"
              value={scope}
              onChange={(val) => setScope(val as 'PENDING' | 'SELECTED' | 'ALL')}
              options={[
                { label: 'Chờ đăng', value: 'PENDING' },
                ...(selectedRowKeys.length > 0
                  ? [{ label: `Đã chọn (${selectedRowKeys.length})`, value: 'SELECTED' }]
                  : []),
                { label: 'Tất cả trạng thái', value: 'ALL' },
              ]}
              className="bg-slate-950/80 text-xs p-0.5 rounded-xl border border-slate-800"
            />

            <button
              type="button"
              onClick={() => setDeduplicate((prev) => !prev)}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                deduplicate
                  ? 'bg-blue-600/30 text-blue-200 border-blue-500/50 shadow-sm'
                  : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <ShareAltOutlined />
              <span>Lọc trùng link</span>
            </button>
          </div>

          {/* Nút Xuất File Nhanh */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={handleCopyAll}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 rounded-xl text-xs h-8 px-3 font-semibold shadow-xs"
            >
              Sao chép tất cả ({validUrls.length})
            </Button>

            <Button
              size="small"
              icon={<FileTextOutlined />}
              onClick={handleExportTxt}
              className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/40 rounded-xl text-xs h-8 px-3 font-semibold shadow-xs"
            >
              Xuất TXT
            </Button>

            <Button
              size="small"
              icon={<FileExcelOutlined />}
              onClick={handleExportCsv}
              className="bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border-teal-500/40 rounded-xl text-xs h-8 px-3 font-semibold shadow-xs"
            >
              Xuất CSV (Excel)
            </Button>
          </div>
        </div>

        {/* THANH LỌC ĐỊNH DẠNG MEDIA & Ô TÌM KIẾM */}
        <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          {/* Lọc nhanh theo Media */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-400 font-semibold flex items-center gap-1 shrink-0 mr-1">
              <FilterOutlined className="text-sky-400" />
              <span>Định dạng:</span>
            </span>

            <button
              type="button"
              onClick={() => setMediaTypeFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                mediaTypeFilter === 'ALL'
                  ? 'bg-blue-600/30 border-blue-500 text-blue-200'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Tất cả ({mediaCounts.all})
            </button>

            <button
              type="button"
              onClick={() => setMediaTypeFilter(mediaTypeFilter === 'VIDEO' ? 'ALL' : 'VIDEO')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border flex items-center gap-1 ${
                mediaTypeFilter === 'VIDEO'
                  ? 'bg-purple-600/35 border-purple-400 text-purple-100 shadow-sm'
                  : 'bg-purple-950/20 border-purple-500/30 text-purple-300 hover:text-white'
              }`}
            >
              <VideoCameraOutlined />
              <span>🎬 Video ({mediaCounts.video})</span>
            </button>

            <button
              type="button"
              onClick={() => setMediaTypeFilter(mediaTypeFilter === 'IMAGE' ? 'ALL' : 'IMAGE')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border flex items-center gap-1 ${
                mediaTypeFilter === 'IMAGE'
                  ? 'bg-cyan-600/35 border-cyan-400 text-cyan-100 shadow-sm'
                  : 'bg-cyan-950/20 border-cyan-500/30 text-cyan-300 hover:text-white'
              }`}
            >
              <PictureOutlined />
              <span>🖼️ Ảnh ({mediaCounts.image})</span>
            </button>

            <button
              type="button"
              onClick={() => setMediaTypeFilter(mediaTypeFilter === 'TEXT' ? 'ALL' : 'TEXT')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border flex items-center gap-1 ${
                mediaTypeFilter === 'TEXT'
                  ? 'bg-slate-700 border-slate-500 text-slate-100 shadow-sm'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <FileTextOutlined />
              <span>📝 Text ({mediaCounts.text})</span>
            </button>
          </div>

          {/* Ô Tìm kiếm */}
          <div className="w-full sm:w-64">
            <Input
              size="small"
              prefix={<SearchOutlined className="text-slate-400" />}
              placeholder="Tìm theo link, tiêu đề..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              className="rounded-lg text-xs bg-slate-900 border-slate-800 text-slate-100 h-7"
            />
          </div>
        </div>

        {/* BẢNG DANH SÁCH CHI TIẾT */}
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <Table
            size="small"
            columns={columns}
            dataSource={filteredPosts}
            rowKey="id"
            pagination={{
              pageSize: 15,
              showSizeChanger: true,
              pageSizeOptions: ['15', '30', '50', '100'],
              size: 'small',
            }}
            scroll={{ y: 380, x: 800 }}
            locale={{ emptyText: 'Không tìm thấy bài viết nào khớp' }}
            className="export-links-table"
          />
        </div>
      </div>
    </Modal>
  );
}
