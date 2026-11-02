import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        host: true,
        port: 3000,
        strictPort: true,
    },
    build: {
        // Vite 8 (Rolldown): codeSplitting.groups thay cho manualChunks (đã deprecated)
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        // react tách riêng (ưu tiên cao hơn) để không bị kéo vào vendor-antd theo dependency
                        { name: "vendor-react", test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router-dom)[\\/]/, priority: 20 },
                        { name: "vendor-antd-icons", test: /[\\/]node_modules[\\/]@ant-design[\\/]icons[\\/]/, priority: 15 },
                        { name: "vendor-query", test: /[\\/]node_modules[\\/]@tanstack[\\/]/, priority: 15 },
                        { name: "vendor-rc", test: /[\\/]node_modules[\\/]@rc-component[\\/]/, priority: 12 },
                        { name: "vendor-antd", test: /[\\/]node_modules[\\/]antd[\\/]/, priority: 10 },
                        { name: "vendor-calendar", test: /[\\/]node_modules[\\/]@fullcalendar[\\/]/, priority: 10 },
                        { name: "vendor-xlsx", test: /[\\/]node_modules[\\/]xlsx[\\/]/, priority: 10 },
                    ],
                },
            },
        },
    },
});
