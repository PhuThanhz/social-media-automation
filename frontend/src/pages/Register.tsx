import { Button, Checkbox, Col, Form, Input, Row, message } from 'antd';
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
    onError: (error: any) =>
      message.error(error.response?.data || 'Chưa thể tạo tài khoản. Vui lòng thử lại.'),
  });

  const onFinish = (values: RegisterFormValues) =>
    registerMutation.mutate({
      username: values.username,
      email: values.email,
      password: values.password,
    });

  return (
    <AuthLayout
      title="Tạo tài khoản"
    >
      <Form<RegisterFormValues>
        name="register_form"
        onFinish={onFinish}
        size="large"
        layout="vertical"
        requiredMark={false}
        className="auth-simple-form is-tight"
      >
        <Form.Item
          label={<span className="auth-simple-label">Họ và tên</span>}
          name="username"
          rules={[{ required: true, message: 'Vui lòng nhập họ và tên.' }]}
          style={{ marginBottom: 12 }}
        >
          <Input
            prefix={<UserOutlined className="auth-simple-input-icon" />}
            placeholder="Nguyễn Văn An"
            autoComplete="name"
            className="auth-simple-input"
          />
        </Form.Item>

        <Form.Item
          label={<span className="auth-simple-label">Email</span>}
          name="email"
          rules={[
            { required: true, message: 'Vui lòng nhập email.' },
            { type: 'email', message: 'Email chưa đúng định dạng.' },
          ]}
          style={{ marginBottom: 12 }}
        >
          <Input
            prefix={<MailOutlined className="auth-simple-input-icon" />}
            placeholder="name@company.com"
            autoComplete="email"
            className="auth-simple-input"
          />
        </Form.Item>

        <Row gutter={[12, 12]} className="auth-simple-pair">
          <Col xs={24} sm={12}>
            <Form.Item
              label={<span className="auth-simple-label">Mật khẩu</span>}
              name="password"
              rules={[
                { required: true, message: 'Vui lòng nhập mật khẩu.' },
                { min: 6, message: 'Tối thiểu 6 ký tự.' },
              ]}
              style={{ marginBottom: 0 }}
            >
              <Input.Password
                prefix={<LockOutlined className="auth-simple-input-icon" />}
                placeholder="Tối thiểu 6 ký tự"
                autoComplete="new-password"
                className="auth-simple-input"
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label={<span className="auth-simple-label">Xác nhận</span>}
              name="confirm"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Vui lòng xác nhận mật khẩu.' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    return !value || getFieldValue('password') === value
                      ? Promise.resolve()
                      : Promise.reject(new Error('Mật khẩu chưa khớp.'));
                  },
                }),
              ]}
              style={{ marginBottom: 0 }}
            >
              <Input.Password
                prefix={<LockOutlined className="auth-simple-input-icon" />}
                placeholder="Nhập lại mật khẩu"
                autoComplete="new-password"
                className="auth-simple-input"
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="terms"
          valuePropName="checked"
          rules={[
            {
              validator: (_, value) =>
                value ? Promise.resolve() : Promise.reject(new Error('Bạn cần đồng ý để tiếp tục.')),
            },
          ]}
          style={{ marginBottom: 12 }}
        >
          <Checkbox className="auth-simple-check">
            Tôi đồng ý với điều khoản sử dụng và chính sách bảo mật
          </Checkbox>
        </Form.Item>

        <Form.Item style={{ marginBottom: 8, paddingTop: 4 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={registerMutation.isPending}
            block
            icon={<ArrowRightOutlined />}
            iconPlacement="end"
            className="auth-simple-submit"
          >
            Tạo tài khoản miễn phí
          </Button>
        </Form.Item>

        <div className="auth-simple-switch">
          Bạn đã có tài khoản?{' '}
          <Link to="/login" className="auth-simple-switch-link">
            Đăng nhập ngay
          </Link>
        </div>
      </Form>
    </AuthLayout>
  );
};

export default Register;
