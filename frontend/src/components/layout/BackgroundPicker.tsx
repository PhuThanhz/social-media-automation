import { App, Button, Modal, Upload } from 'antd';
import { CheckOutlined, UploadOutlined } from '@ant-design/icons';
import {
  BACKGROUNDS, CUSTOM_BACKGROUND_ID, fileToBackgroundDataUrl,
  resolveBackgroundImage, useBackgroundStore,
} from '../../store/backgroundStore';

interface BackgroundPickerProps {
  open: boolean;
  onClose: () => void;
}

export default function BackgroundPicker({ open, onClose }: BackgroundPickerProps) {
  const { message } = App.useApp();
  const { backgroundId, customImage, setBackground, setCustomImage } = useBackgroundStore();

  const options = [
    ...BACKGROUNDS.map((b) => ({ id: b.id, label: b.label, preview: b.thumb ? `url("${b.thumb}")` : resolveBackgroundImage(b.id, null) })),
    ...(customImage ? [{ id: CUSTOM_BACKGROUND_ID, label: 'Ảnh của bạn', preview: `url("${customImage}")` }] : []),
  ];

  const handleUpload = async (file: File) => {
    try {
      setCustomImage(await fileToBackgroundDataUrl(file));
      message.success('Đã đặt ảnh làm hình nền');
    } catch {
      message.error('Không đọc được ảnh, thử ảnh khác');
    }
    return false;
  };

  return (
    <Modal
      title="Hình nền giao diện"
      open={open}
      onCancel={onClose}
      width={640}
      footer={[
        <Upload key="upload" accept="image/*" showUploadList={false} beforeUpload={handleUpload}>
          <Button icon={<UploadOutlined />}>Tải ảnh của bạn</Button>
        </Upload>,
        <Button key="done" type="primary" onClick={onClose}>Xong</Button>,
      ]}
    >
      <div className="bg-picker-grid">
        {options.map((o) => {
          const selected = o.id === backgroundId;
          return (
            <button
              key={o.id}
              type="button"
              className={`bg-picker-item${selected ? ' is-selected' : ''}`}
              onClick={() => setBackground(o.id)}
            >
              <span className="bg-picker-thumb" style={{ backgroundImage: o.preview }}>
                {selected && <CheckOutlined className="bg-picker-check" />}
              </span>
              <span className="bg-picker-label">{o.label}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
