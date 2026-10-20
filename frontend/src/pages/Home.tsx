import { Button } from 'antd';
import {
  ArrowRightOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  FacebookFilled,
  PlayCircleFilled,
  ThunderboltFilled,
  VideoCameraFilled,
} from '@ant-design/icons';
import PublicLayout from '../components/layout/PublicLayout';

const tools = [
  { icon: <CalendarOutlined />, title: 'Lịch nội dung', text: 'Nhìn rõ mọi bài sắp đăng.' },
  { icon: <FacebookFilled />, title: 'Page & Group', text: 'Quản lý kênh tại một nơi.' },
  { icon: <VideoCameraFilled />, title: 'Kho video', text: 'Lưu và dùng lại nhanh chóng.' },
];

const queue = [
  { time: '09:00', name: 'Làm Sen', status: 'Đã đăng', done: true },
  { time: '14:30', name: 'Phú Order Hàng Nhật', status: 'Đang chạy', active: true },
  { time: '19:00', name: 'Đại Sảnh Pickleball', status: 'Chờ đăng' },
];

const HomeContent = () => (
  <div className="home-v2">
    <section className="home-v2-hero">
      <div className="public-container home-v2-grid">
        <div className="home-v2-copy">
          <div className="home-v2-kicker"><span /> PHUSOCIAL WORKSPACE</div>
          <h1>Đăng bài đều.<br /><em>Đỡ tốn công.</em></h1>
          <p>Lên lịch, quản lý Page và theo dõi nội dung Facebook trong một màn hình gọn.</p>
          <div className="home-v2-actions">
            <Button type="primary" size="large" href="/login">
              Vào hệ thống <ArrowRightOutlined />
            </Button>
            <Button size="large" href="#tools">Xem tính năng</Button>
          </div>
          <div className="home-v2-note">
            <CheckCircleFilled /> Thiết lập nhanh · Giao diện tiếng Việt
          </div>
        </div>

        <div className="home-v2-console" aria-label="Lịch đăng hôm nay">
          <div className="home-v2-console-head">
            <div><span className="home-v2-live-dot" /><b>Lịch hôm nay</b></div>
            <span>3 bài</span>
          </div>
          <div className="home-v2-focus-card">
            <span>ĐANG XỬ LÝ</span>
            <b>Phú Order Hàng Nhật</b>
            <small><ClockCircleOutlined /> 14:30 · Facebook</small>
            <i><PlayCircleFilled /></i>
          </div>
          <div className="home-v2-queue">
            {queue.map((item) => (
              <div key={`${item.time}-${item.name}`}>
                <time>{item.time}</time>
                <span><b>{item.name}</b><small>Facebook</small></span>
                <em className={item.done ? 'is-done' : item.active ? 'is-active' : ''}>{item.status}</em>
              </div>
            ))}
          </div>
          <div className="home-v2-console-foot">
            <span><ThunderboltFilled /> Worker sẵn sàng</span>
            <b>Ổn định</b>
          </div>
        </div>
      </div>
    </section>

    <section className="home-v2-tools" id="tools">
      <div className="public-container">
        <div className="home-v2-tools-head">
          <span>CÔNG CỤ CẦN THIẾT</span>
          <h2>Một nơi. Đủ dùng.</h2>
        </div>
        <div className="home-v2-tool-grid">
          {tools.map((tool) => (
            <article key={tool.title}>
              <i>{tool.icon}</i>
              <div><h3>{tool.title}</h3><p>{tool.text}</p></div>
              <ArrowRightOutlined />
            </article>
          ))}
        </div>
      </div>
    </section>

    <section className="home-v2-cta">
      <div className="public-container">
        <div><h2>Sẵn sàng bắt đầu?</h2><p>Mở workspace và quản lý nội dung ngay.</p></div>
        <Button type="primary" size="large" href="/login">Đăng nhập <ArrowRightOutlined /></Button>
      </div>
    </section>
  </div>
);

const Home = () => <PublicLayout><HomeContent /></PublicLayout>;

export { HomeContent };
export default Home;
