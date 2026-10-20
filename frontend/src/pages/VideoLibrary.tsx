import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { App, Card, Typography, Select, Button, Table, Space, Tag, Tooltip, Modal, Checkbox } from 'antd';
import {
  VideoCameraOutlined, CopyOutlined, ThunderboltOutlined,
  ReloadOutlined, ShareAltOutlined, InfoCircleOutlined
} from '@ant-design/icons';
import api from '../config/axios';

const { Title, Text } = Typography;

interface FbVideo {
  id: string;
  description?: string;
  source?: string;
  updated_time?: string;
}

interface Connection {
  id: number;
  pageName?: string;
  platformAccountId: string;
  accessToken: string;
  accountType: string;
}

const VideoLibrary = () => {
  const { message } = App.useApp();
  const [selectedPageId, setSelectedPageId] = useState<string>('');
  const [selectedAccessToken, setSelectedAccessToken] = useState<string>('');
  const [crosspostModal, setCrosspostModal] = useState<{ visible: boolean; video: FbVideo | null }>({ visible: false, video: null });
  const [selectedTargetPages, setSelectedTargetPages] = useState<string[]>([]);

  // Lấy danh sách kết nối Fanpage
  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: async () => {
      const res = await api.get('/connections');
      return res.data;
    }
  });

  // Lấy danh sách video từ Fanpage đã chọn
  const { data: videosData, isLoading: videosLoading, refetch: refetchVideos } = useQuery({
    queryKey: ['page-videos', selectedPageId],
    queryFn: async () => {
      const res = await api.get('/tools/page-videos', {
        params: { pageId: selectedPageId, accessToken: selectedAccessToken }
      });
      return res.data;
    },
    enabled: !!selectedPageId && !!selectedAccessToken
  });

  const videos: FbVideo[] = videosData?.data || [];

  // Mutation Crosspost Video
  const crosspostMutation = useMutation({
    mutationFn: async ({ video, targetPageIds }: { video: FbVideo; targetPageIds: string[] }) => {
      const targetPages = connections
        .filter(c => targetPageIds.includes(c.platformAccountId))
        .map(c => ({
          pageId: c.platformAccountId,
          accessToken: c.accessToken,
          description: video.description || ''
        }));

      const res = await api.post('/tools/crosspost-video', {
        videoId: video.id,
        originalAccessToken: selectedAccessToken,
        targetPages
      });
      return res.data;
    },
    onSuccess: (data) => {
      message.success(`🚀 Đã đăng chéo thành công sang ${data.crosspostedCount}/${data.totalTargets} Fanpage!`);
      setCrosspostModal({ visible: false, video: null });
      setSelectedTargetPages([]);
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.error || 'Lỗi khi đăng chéo video!');
    }
  });

  const columns = [
    {
      title: 'Video ID',
      dataIndex: 'id',
      key: 'id',
      width: 180,
      render: (id: string) => (
        <div className="flex items-center gap-2">
          <Tag color="blue" className="font-mono text-xs">{id}</Tag>
          <Tooltip title="Copy Video ID">
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={() => { navigator.clipboard.writeText(id); message.success('Đã copy Video ID!'); }}
            />
          </Tooltip>
        </div>
      )
    },
    {
      title: 'Mô tả / Caption',
      dataIndex: 'description',
      key: 'description',
      render: (desc: string) => (
        <Text className="text-sm text-slate-700 line-clamp-2">
          {desc || <span className="text-slate-400 italic">Không có caption</span>}
        </Text>
      )
    },
    {
      title: 'Cập nhật lúc',
      dataIndex: 'updated_time',
      key: 'updated_time',
      width: 160,
      render: (t: string) => t ? (
        <Text className="text-xs text-slate-500">
          {new Date(t).toLocaleString('vi-VN')}
        </Text>
      ) : '-'
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 200,
      render: (_: any, record: FbVideo) => (
        <Space>
          {record.source && (
            <Tooltip title="Xem / tải video">
              <Button
                size="small"
                type="default"
                icon={<VideoCameraOutlined />}
                href={record.source}
                target="_blank"
                className="rounded-lg"
              >
                Xem
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Đăng chéo sang Fanpage khác không cần tải lại file!">
            <Button
              size="small"
              type="primary"
              icon={<ShareAltOutlined />}
              className="bg-purple-600 hover:bg-purple-500 border-none rounded-lg font-bold"
              onClick={() => {
                setCrosspostModal({ visible: true, video: record });
                setSelectedTargetPages([]);
              }}
            >
              Đăng Chéo
            </Button>
          </Tooltip>
        </Space>
      )
    }
  ];

  const otherConnections = connections.filter(c => c.platformAccountId !== selectedPageId);

  return (
    <div className="app-page">
      {/* Header */}
      <div className="app-surface app-page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Title level={4} className="!mb-1 text-slate-800 flex items-center gap-2">
            <VideoCameraOutlined className="text-blue-600" /> Thư viện video
          </Title>
          <Text className="text-xs text-slate-500 font-medium">
            Xem, quản lý và đăng chéo video sang các Fanpage khác
          </Text>
        </div>
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-4 py-2 rounded-xl">
          <InfoCircleOutlined className="text-blue-600" />
          <Text className="text-xs text-blue-700 font-semibold">Chỉ hoạt động với Fanpage dùng PAGE_TOKEN (Graph API)</Text>
        </div>
      </div>

      {/* Filter Fanpage */}
      <Card variant="borderless" className="shadow-sm rounded-2xl border border-slate-200/80 bg-white">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1">
            <Text className="font-bold text-slate-700 block mb-2">🎯 Chọn Fanpage để xem Video:</Text>
            <Select
              size="large"
              style={{ width: '100%' }}
              placeholder="Chọn Fanpage (PAGE_TOKEN)..."
              onChange={(val) => {
                const conn = connections.find(c => c.platformAccountId === val);
                setSelectedPageId(val);
                setSelectedAccessToken(conn?.accessToken || '');
              }}
              options={connections
                .filter(c => c.accountType === 'PAGE_TOKEN')
                .map(c => ({
                  value: c.platformAccountId,
                  label: `🎯 ${c.pageName || c.platformAccountId} (PAGE_TOKEN)`
                }))
              }
            />
          </div>
          <Button
            icon={<ReloadOutlined />}
            size="large"
            disabled={!selectedPageId}
            onClick={() => refetchVideos()}
            className="rounded-xl font-semibold h-11"
          >
            Làm mới
          </Button>
        </div>

        {!selectedPageId && (
          <div className="mt-6 text-center py-12 text-slate-400">
            <VideoCameraOutlined style={{ fontSize: 48 }} className="mb-4 opacity-30" />
            <div className="font-semibold text-base">Chọn Fanpage ở trên để xem danh sách video đã đăng</div>
          </div>
        )}

        {selectedPageId && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <Text className="font-bold text-slate-700">
                📹 Danh sách Video ({videos.length} video)
              </Text>
              {videos.length > 0 && (
                <Tag color="blue" className="font-semibold">
                  <ThunderboltOutlined /> Tất cả video sẵn sàng Đăng Chéo!
                </Tag>
              )}
            </div>
            <Table
              columns={columns}
              dataSource={videos}
              rowKey="id"
              loading={videosLoading}
              pagination={{ pageSize: 10, showTotal: (total) => `Tổng ${total} video` }}
              locale={{ emptyText: 'Không có video nào hoặc Fanpage chưa có video được đăng qua Graph API' }}
              className="rounded-xl overflow-hidden"
              scroll={{ x: 'max-content' }}
            />
          </div>
        )}
      </Card>

      {/* Modal Crosspost */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-purple-700 font-bold">
            <ShareAltOutlined />
            <span className="text-lg">Đăng Chéo Video sang Fanpage Khác</span>
          </div>
        }
        open={crosspostModal.visible}
        onCancel={() => { setCrosspostModal({ visible: false, video: null }); setSelectedTargetPages([]); }}
        onOk={() => {
          if (!crosspostModal.video || selectedTargetPages.length === 0) {
            message.warning('Vui lòng chọn ít nhất 1 Fanpage đích!');
            return;
          }
          crosspostMutation.mutate({ video: crosspostModal.video, targetPageIds: selectedTargetPages });
        }}
        okText="🚀 Đăng Chéo Ngay"
        cancelText="Hủy"
        confirmLoading={crosspostMutation.isPending}
        okButtonProps={{ className: 'bg-purple-600 hover:bg-purple-500 border-none font-bold' }}
        width={520}
        centered
      >
        <div className="py-3 space-y-4">
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <Text className="text-sm text-purple-800 font-semibold">
              📹 Video ID: <span className="font-mono text-purple-600">{crosspostModal.video?.id}</span>
            </Text>
            {crosspostModal.video?.description && (
              <div className="mt-2 text-xs text-purple-700 line-clamp-2">
                {crosspostModal.video.description}
              </div>
            )}
          </div>
          <div>
            <Text className="font-bold text-slate-700 block mb-3">
              Chọn Fanpage đích (không tải lại file, chỉ cần VIDEO_ID):
            </Text>
            {otherConnections.length === 0 ? (
              <div className="text-slate-400 text-sm italic">Không có Fanpage nào khác để đăng chéo</div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                {otherConnections.map(c => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedTargetPages.includes(c.platformAccountId)
                        ? 'border-purple-400 bg-purple-50'
                        : 'border-slate-200 hover:border-purple-300 hover:bg-purple-50/50'
                    }`}
                    onClick={() => {
                      setSelectedTargetPages(prev =>
                        prev.includes(c.platformAccountId)
                          ? prev.filter(p => p !== c.platformAccountId)
                          : [...prev, c.platformAccountId]
                      );
                    }}
                  >
                    <Checkbox checked={selectedTargetPages.includes(c.platformAccountId)} />
                    <div>
                      <div className="font-semibold text-sm text-slate-700">{c.pageName || c.platformAccountId}</div>
                      <div className="text-xs text-slate-400">{c.accountType} · ID: {c.platformAccountId}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {selectedTargetPages.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3">
              <Text className="text-xs text-green-700 font-semibold">
                ✅ Sẽ đăng chéo sang {selectedTargetPages.length} Fanpage — 0 MB băng thông upload!
              </Text>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default VideoLibrary;
