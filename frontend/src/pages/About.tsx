import { Button } from 'antd';
import {
  ArrowRightOutlined, CheckCircleFilled, CompassOutlined, HeartFilled,
  SafetyCertificateOutlined, TeamOutlined, ThunderboltFilled,
} from '@ant-design/icons';
import PublicLayout from '../components/layout/PublicLayout';

const values = [
  { icon: <CompassOutlined />, title: 'Đơn giản là ưu tiên', text: 'Công nghệ chỉ có ý nghĩa khi giúp công việc dễ hơn. Mỗi màn hình đều được thiết kế để người dùng biết bước tiếp theo là gì.' },
  { icon: <SafetyCertificateOutlined />, title: 'Minh bạch và kiểm soát', text: 'Bạn luôn thấy bài nào đang chờ, bài nào đã đăng và điều gì cần xử lý — không có quy trình bí ẩn.' },
  { icon: <HeartFilled />, title: 'Xây dựng cho người Việt', text: 'Ngôn ngữ gần gũi, cách dùng thực tế và hỗ trợ đúng bối cảnh vận hành nội dung tại Việt Nam.' },
];

const About = () => (
  <PublicLayout>
    <section className="about-hero">
      <div className="public-container about-hero-inner">
        <div className="public-eyebrow"><span /> Câu chuyện PhuSocial</div>
        <h1>Giúp đội ngũ sáng tạo<br /><em>lấy lại thời gian của mình.</em></h1>
        <p>Chúng tôi tin rằng quản lý mạng xã hội không nên là chuỗi thao tác lặp đi lặp lại. PhuSocial được tạo ra để biến một quy trình phức tạp thành trải nghiệm rõ ràng, dễ dùng và đáng tin cậy.</p>
      </div>
    </section>

    <section className="about-story public-section"><div className="public-container about-story-grid"><div className="about-story-visual"><div className="about-orbit orbit-one" /><div className="about-orbit orbit-two" /><div className="about-core"><ThunderboltFilled /><b>PhuSocial</b><small>Publish with confidence</small></div><span className="about-chip chip-one"><CheckCircleFilled /> Đúng lịch</span><span className="about-chip chip-two"><TeamOutlined /> Một đội ngũ</span></div><div className="about-story-copy"><div className="public-eyebrow"><span /> Vì sao chúng tôi bắt đầu</div><h2>Nội dung tốt cần thời gian. Việc đăng bài thì không nên.</h2><p>Khi một đội ngũ phải chuyển qua quá nhiều công cụ, kiểm tra từng bài thủ công và luôn lo lắng về lịch đăng, năng lượng dành cho sáng tạo sẽ dần biến mất.</p><p>PhuSocial gom tất cả vào một nơi: kết nối kênh, chuẩn bị nội dung, lên lịch, theo dõi KPI và xử lý lỗi. Mục tiêu rất đơn giản — giúp mỗi ngày làm việc trở nên bình tĩnh hơn.</p><ul><li><CheckCircleFilled /> Ít thao tác lặp lại hơn</li><li><CheckCircleFilled /> Trạng thái luôn rõ ràng</li><li><CheckCircleFilled /> Dễ dùng với cả thành viên mới</li></ul></div></div></section>

    <section className="about-values"><div className="public-container"><div className="public-section-heading centered"><div className="public-eyebrow"><span /> Điều chúng tôi theo đuổi</div><h2>Một sản phẩm tử tế bắt đầu<br />từ trải nghiệm tử tế.</h2></div><div className="about-values-grid">{values.map(value => <article key={value.title}><div>{value.icon}</div><h3>{value.title}</h3><p>{value.text}</p></article>)}</div></div></section>

    <section className="about-numbers"><div className="public-container"><div><b>01</b><span>Không gian làm việc tập trung</span></div><div><b>24/7</b><span>Theo dõi hàng chờ tự động</span></div><div><b>100%</b><span>Trải nghiệm tiếng Việt</span></div></div></section>

    <section className="home-cta"><div className="public-container"><div><span className="cta-spark"><ThunderboltFilled /></span><h2>Cùng PhuSocial xây dựng<br />quy trình tốt hơn.</h2><p>Thiết lập không gian làm việc đầu tiên của bạn chỉ trong vài phút.</p><div><Button type="primary" size="large" href="/register">Bắt đầu miễn phí <ArrowRightOutlined /></Button><Button size="large" href="/login">Đăng nhập</Button></div></div></div></section>
  </PublicLayout>
);

export default About;
