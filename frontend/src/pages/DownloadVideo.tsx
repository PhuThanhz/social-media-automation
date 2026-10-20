import { useState } from 'react';
import { Button, Input, Form, Tag, App, Empty } from 'antd';
import { DownloadOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import api from '../config/axios';
import PasteLinkInput from '../components/common/PasteLinkInput';

const { TextArea } = Input;

const WORKER_BASE_URL = import.meta.env.VITE_WORKER_BASE_URL || `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3001`;

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
  `${WORKER_BASE_URL}/api/download-video?url=${encodeURIComponent(vUrl)}&filename=${encodeURIComponent(filename || 'video')}`;

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
    <div className="app-page max-w-6xl mx-auto">
      <div className="app-surface app-page-header">
        <h1 className="app-page-title">Tải video</h1>
        <p className="app-page-description">Tải video từ TikTok, Douyin, Threads, Facebook</p>
      </div>

      <div className="app-surface p-5 sm:p-6">
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
            label="Link video"
            rules={[{ required: true, message: 'Vui lòng dán link video' }]}
            className="!mb-3"
          >
            <PasteLinkInput placeholder="Dán link TikTok, Douyin, Threads hoặc Facebook..." size="large" />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            loading={extractMutation.isPending}
            icon={<LinkOutlined />}
          >
            Lấy video
          </Button>
        </Form>

        {result && (
          <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-6">
              {previewUrl ? (
                <div className="overflow-hidden rounded-xl bg-black aspect-[9/16] max-h-[560px] w-full mx-auto flex items-center justify-center">
                  <video key={previewUrl} src={previewUrl} controls className="w-full h-full object-contain" />
                </div>
              ) : imageUrls.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {imageUrls.map((url, idx) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                      <img src={url} alt={`Ảnh ${idx + 1}`} className="w-full aspect-square object-cover" />
                    </a>
                  ))}
                </div>
              ) : (
                <Empty description="Không tìm thấy video" />
              )}
            </div>

            <div className="lg:col-span-6 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Tag color={SOURCE_COLORS[result.sourceType] || 'default'} className="!m-0">{result.sourceType}</Tag>
                {result.quality?.width && result.quality?.height && (
                  <Tag className="!m-0">{result.quality.width}×{result.quality.height}</Tag>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Caption</span>
                  <Button size="small" icon={<CopyOutlined />} onClick={handleCopyCaption} disabled={!caption}>
                    Copy
                  </Button>
                </div>
                <TextArea rows={6} value={caption} readOnly placeholder="Không có caption" />
              </div>

              {downloadUrl && (
                <Button type="primary" size="large" href={downloadUrl} target="_blank" icon={<DownloadOutlined />}>
                  Tải .MP4
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DownloadVideo;
