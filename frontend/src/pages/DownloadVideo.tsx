import { runtime, withSessionToken } from '../config/runtime';
import { useState } from 'react';
import { Button, Input, Form, Tag, App, Empty, Card, Typography, Space, Row, Col } from 'antd';
import { DownloadOutlined, CopyOutlined, LinkOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import api from '../config/axios';
import PasteLinkInput from '../components/common/PasteLinkInput';

const { TextArea } = Input;
const { Title, Text } = Typography;

const WORKER_BASE_URL = runtime.workerBase;

interface ExtractResult {
  success: boolean;
  videoUrl?: string | null;
  mediaUrls?: string[];
  title: string;
  content?: string;
  sourceType: 'TIKTOK' | 'DOUYIN' | 'THREADS' | 'FACEBOOK';
  quality?: {
    width?: number | null;
    height?: number | null;
  } | null;
  error?: string;
}

const SOURCE_COLORS: Record<ExtractResult['sourceType'], string> = {
  TIKTOK: 'magenta',
  DOUYIN: 'red',
  THREADS: 'default',
  FACEBOOK: 'blue',
};

const getDownloadUrl = (vUrl: string, filename: string) =>
  withSessionToken(`${WORKER_BASE_URL}/api/download-video?url=${encodeURIComponent(vUrl)}&filename=${encodeURIComponent(filename || 'video')}`);

const DownloadVideo = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [result, setResult] = useState<ExtractResult | null>(null);

  const extractMutation = useMutation({
    mutationFn: async (values: { url: string }) => {
      const response = await api.post('/tools/extract-video', { url: values.url });
      return response.data as ExtractResult;
    },
    onSuccess: (data) => {
      if (data.success) {
        setResult(data);
      } else {
        setResult(null);
        message.error(data.error || 'Không tìm thấy video trong link này');
      }
    },
    onError: () => {
      setResult(null);
      message.error('Lỗi khi lấy video, vui lòng kiểm tra lại đường dẫn');
    },
  });

  const caption = result?.content || result?.title || '';
  const downloadUrl = result?.videoUrl ? getDownloadUrl(result.videoUrl, caption.slice(0, 30)) : null;
  const previewUrl = downloadUrl ? `${downloadUrl}&inline=1` : null;
  const imageUrls = !result?.videoUrl ? (result?.mediaUrls || []) : [];

  const handleCopyCaption = () => {
    if (!caption) return;
    navigator.clipboard.writeText(caption);
    message.success('Đã sao chép caption');
  };

  return (
    <div className="app-page max-w-5xl mx-auto space-y-5">
      <Card variant="borderless">
        <Space align="center" size="middle" className="mb-2">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 text-lg">
            <VideoCameraOutlined />
          </div>
          <div>
            <Title level={4} className="!mb-0.5 !text-slate-100">Tải video</Title>
            <Text className="text-xs text-slate-400">Tải video và bài viết đa phương tiện từ TikTok, Douyin, Threads, Facebook</Text>
          </div>
        </Space>
      </Card>

      <Card variant="borderless">
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => {
            setResult(null);
            extractMutation.mutate(values);
          }}
        >
          <Form.Item
            name="url"
            label={<span className="text-xs font-semibold text-slate-300">Đường dẫn video / bài viết</span>}
            rules={[{ required: true, message: 'Vui lòng dán link video' }]}
            className="!mb-4"
          >
            <PasteLinkInput placeholder="Dán link TikTok, Douyin, Threads hoặc Facebook..." size="large" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={extractMutation.isPending}
            icon={<LinkOutlined />}
            className="font-semibold px-6 rounded-xl"
          >
            Lấy video
          </Button>
        </Form>

        {result && (
          <div className="mt-6 pt-6 border-t border-slate-800">
            <Row gutter={[24, 24]} align="top">
              <Col xs={24} lg={12}>
                {previewUrl ? (
                  <div className="overflow-hidden rounded-2xl bg-black/90 aspect-[9/16] max-h-[520px] w-full mx-auto flex items-center justify-center border border-slate-800 shadow-xl">
                    <video key={previewUrl} src={previewUrl} controls className="w-full h-full object-contain" />
                  </div>
                ) : imageUrls.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {imageUrls.map((url, idx) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-slate-800 hover:border-blue-500 transition-all">
                        <img src={url} alt={`Ảnh ${idx + 1}`} className="w-full aspect-square object-cover" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <Empty description="Không tìm thấy video" />
                )}
              </Col>

              <Col xs={24} lg={12} className="space-y-4">
                <Space wrap size="small">
                  <Tag color={SOURCE_COLORS[result.sourceType] || 'default'} className="!m-0 font-semibold">{result.sourceType}</Tag>
                  {result.quality?.width && result.quality?.height && (
                    <Tag className="!m-0 font-mono">{result.quality.width}×{result.quality.height}</Tag>
                  )}
                </Space>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Text className="text-xs font-semibold text-slate-300">Nội dung Caption</Text>
                    <Button size="small" icon={<CopyOutlined />} onClick={handleCopyCaption} disabled={!caption}>
                      Sao chép
                    </Button>
                  </div>
                  <TextArea rows={6} value={caption} readOnly placeholder="Không có caption" className="rounded-xl font-sans text-xs" />
                </div>

                {downloadUrl && (
                  <Button type="primary" size="large" href={downloadUrl} target="_blank" icon={<DownloadOutlined />} className="w-full font-semibold rounded-xl">
                    Tải về tệp .MP4
                  </Button>
                )}
              </Col>
            </Row>
          </div>
        )}
      </Card>
    </div>
  );
};

export default DownloadVideo;
