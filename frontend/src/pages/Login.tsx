import { Button, Checkbox, Form, Input, message } from 'antd';
import { LockOutlined, LoginOutlined, MailOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authService } from '../services/auth.service';
import { useAuthStore } from '../store/authStore';
import type { LoginRequest } from '../types/auth';
import AuthLayout from '../components/layout/AuthLayout';

type LoginFormValues = LoginRequest & { remember: boolean };

const Login = () => {
  const navigate = useNavigate();
  const setLogin = useAuthStore((state) => state.login);

  const loginMutation = useMutation({
    mutationFn: (data: LoginRequest) => authService.login(data),
    onSuccess: (data) => {
      setLogin(data.accessToken);
      message.success('Đăng nhập thành công!');
      navigate('/dashboard');
    },
    onError: () => message.error('Email hoặc mật khẩu chưa đúng. Vui lòng thử lại.'),
  });

  const onFinish = (values: LoginFormValues) => loginMutation.mutate({ email: values.email, password: values.password });

  return (
    <AuthLayout title="Đăng nhập" description="Tiếp tục vào workspace của bạn.">
      <Form<LoginFormValues> name="login_form" initialValues={{ remember: true }} onFinish={onFinish} size="large" layout="vertical" requiredMark={false} className="auth-form">
        <Form.Item label="Email" name="email" rules={[{ required: true, message: 'Vui lòng nhập email.' }, { type: 'email', message: 'Email chưa đúng định dạng.' }]}>
          <Input prefix={<MailOutlined />} placeholder="name@company.com" autoComplete="email" />
        </Form.Item>
        <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: 'Vui lòng nhập mật khẩu.' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="Nhập mật khẩu" autoComplete="current-password" />
        </Form.Item>
        <div className="auth-form-options">
          <Form.Item name="remember" valuePropName="checked" noStyle><Checkbox>Ghi nhớ đăng nhập</Checkbox></Form.Item>
          <a href="mailto:support@phusocial.vn?subject=Hỗ trợ đặt lại mật khẩu">Quên mật khẩu?</a>
        </div>
        <Form.Item className="auth-submit-item">
          <Button type="primary" htmlType="submit" loading={loginMutation.isPending} block icon={<LoginOutlined />} iconPlacement="end">Đăng nhập</Button>
        </Form.Item>
        <p className="auth-switch">Chưa có tài khoản? <Link to="/register">Đăng ký</Link></p>
      </Form>
    </AuthLayout>
  );
};

export default Login;
