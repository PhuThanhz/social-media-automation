import { Button, Checkbox, Form, Input, message } from 'antd';
import { ArrowRightOutlined, LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authService } from '../services/auth.service';
import type { RegisterRequest } from '../types/auth';
import AuthLayout from '../components/layout/AuthLayout';

type RegisterFormValues = RegisterRequest & { confirm: string; terms: boolean };

const Register = () => {
  const navigate = useNavigate();
  const registerMutation = useMutation({
    mutationFn: (data: RegisterRequest) => authService.register(data),
    onSuccess: () => {
      message.success('Tạo tài khoản thành công. Bạn có thể đăng nhập ngay!');
      navigate('/login');
    },
    onError: (error: any) => message.error(error.response?.data || 'Chưa thể tạo tài khoản. Vui lòng thử lại.'),
  });

  const onFinish = (values: RegisterFormValues) => registerMutation.mutate({ username: values.username, email: values.email, password: values.password });

  return (
    <AuthLayout title="Tạo tài khoản của bạn" description="Bắt đầu xây dựng quy trình nội dung gọn gàng chỉ trong vài phút.">
      <Form<RegisterFormValues> name="register_form" onFinish={onFinish} size="large" layout="vertical" requiredMark={false} className="auth-form">
        <Form.Item label="Họ và tên" name="username" rules={[{ required: true, message: 'Vui lòng nhập họ và tên.' }]}>
          <Input prefix={<UserOutlined />} placeholder="Nguyễn Văn An" autoComplete="name" />
        </Form.Item>
        <Form.Item label="Email" name="email" rules={[{ required: true, message: 'Vui lòng nhập email.' }, { type: 'email', message: 'Email chưa đúng định dạng.' }]}>
          <Input prefix={<MailOutlined />} placeholder="name@company.com" autoComplete="email" />
        </Form.Item>
        <div className="auth-two-columns">
          <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu.' }, { min: 6, message: 'Tối thiểu 6 ký tự.' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Tối thiểu 6 ký tự" autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="Xác nhận mật khẩu" name="confirm" dependencies={['password']} rules={[{ required: true, message: 'Vui lòng xác nhận mật khẩu.' }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue('password') === value ? Promise.resolve() : Promise.reject(new Error('Mật khẩu chưa khớp.')); } })]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Nhập lại mật khẩu" autoComplete="new-password" />
          </Form.Item>
        </div>
        <Form.Item name="terms" valuePropName="checked" rules={[{ validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error('Bạn cần đồng ý để tiếp tục.')) }]}>
          <Checkbox>Tôi đồng ý với <a href="mailto:support@phusocial.vn">điều khoản sử dụng</a> và chính sách bảo mật.</Checkbox>
        </Form.Item>
        <Form.Item className="auth-submit-item">
          <Button type="primary" htmlType="submit" loading={registerMutation.isPending} block icon={<ArrowRightOutlined />} iconPlacement="end">Tạo tài khoản miễn phí</Button>
        </Form.Item>
        <div className="auth-divider"><span>hoặc</span></div>
        <p className="auth-switch">Bạn đã có tài khoản? <Link to="/login">Đăng nhập ngay</Link></p>
      </Form>
    </AuthLayout>
  );
};

export default Register;
