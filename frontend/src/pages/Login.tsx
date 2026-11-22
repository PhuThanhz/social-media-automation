import { Button, Checkbox, Flex, Form, Input, message } from 'antd';
import { LockOutlined, LoginOutlined, MailOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authService } from '../services/auth.service';
import { useAuthStore } from '../store/authStore';
import type { LoginRequest } from '../types/auth';
import AuthLayout from '../components/layout/AuthLayout';
import { isTauri } from '../services/license.service';

// Bản Desktop đăng nhập bằng tên đăng nhập do chủ tài khoản cấp, không có đăng ký
const desktop = isTauri();

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
    onError: () => message.error(desktop ? 'Tên đăng nhập hoặc mật khẩu chưa đúng, hoặc tài khoản đã bị khóa.' : 'Email hoặc mật khẩu chưa đúng. Vui lòng thử lại.'),
  });

  const onFinish = (values: LoginFormValues) => {
    loginMutation.mutate({ email: values.email, password: values.password });
  };

  return (
    <AuthLayout
      title={desktop ? "Đăng nhập PhuSocial Pro" : "Đăng nhập"}
    >
      <Form<LoginFormValues>
        name="login_form"
        initialValues={{ remember: true }}
        onFinish={onFinish}
        size="large"
        layout="vertical"
        requiredMark={false}
        className="auth-simple-form"
      >
        <Form.Item
          label={<span className="auth-simple-label">{desktop ? 'Tên đăng nhập' : 'Email'}</span>}
          name="email"
          rules={desktop
            ? [{ required: true, message: 'Vui lòng nhập tên đăng nhập.' }]
            : [
              { required: true, message: 'Vui lòng nhập email.' },
              { type: 'email', message: 'Email chưa đúng định dạng.' },
            ]}
          style={{ marginBottom: 16 }}
        >
          <Input
            prefix={<MailOutlined className="auth-simple-input-icon" />}
            placeholder={desktop ? 'Tên đăng nhập' : 'name@company.com'}
            autoComplete={desktop ? 'username' : 'email'}
            className="auth-simple-input"
          />
        </Form.Item>

        <Form.Item
          label={<span className="auth-simple-label">Mật khẩu</span>}
          name="password"
          rules={[{ required: true, message: 'Vui lòng nhập mật khẩu.' }]}
          style={{ marginBottom: 16 }}
        >
          <Input.Password
            prefix={<LockOutlined className="auth-simple-input-icon" />}
            placeholder="Nhập mật khẩu"
            autoComplete="current-password"
            className="auth-simple-input"
          />
        </Form.Item>

        <Flex align="center" justify="space-between" className="auth-simple-row">
          <Form.Item name="remember" valuePropName="checked" noStyle>
            <Checkbox className="auth-simple-check">Ghi nhớ đăng nhập</Checkbox>
          </Form.Item>
          {desktop ? (
            <span className="auth-simple-hint">Quên mật khẩu? Nhờ chủ tài khoản đặt lại.</span>
          ) : (
            <a
              href="mailto:support@phusocial.vn?subject=Hỗ trợ đặt lại mật khẩu"
              className="auth-simple-link"
            >
              Quên mật khẩu?
            </a>
          )}
        </Flex>

        <Form.Item style={{ marginBottom: 8, paddingTop: 8 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={loginMutation.isPending}
            block
            icon={<LoginOutlined />}
            iconPlacement="end"
            className="auth-simple-submit"
          >
            Đăng nhập
          </Button>
        </Form.Item>

        {!desktop && <div className="auth-simple-switch">
          Chưa có tài khoản?{' '}
          <Link to="/register" className="auth-simple-switch-link">
            Đăng ký ngay
          </Link>
        </div>}
      </Form>
    </AuthLayout>
  );
};

export default Login;
