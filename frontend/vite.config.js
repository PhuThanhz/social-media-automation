import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";
// Số phiên bản + giờ build hiện ở cuối menu (để kiểm tra máy người dùng đã cập nhật chưa).
// CI đặt APP_VERSION = 1.0.<run_number> và ghi vào tauri.conf.json trước khi build.
const tauriConf = JSON.parse(readFileSync(path.resolve(__dirname, "src-tauri/tauri.conf.json"), "utf-8"));
export default defineConfig(({ command }) => ({
    define: {
        __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || (command === "build" ? tauriConf.version : "dev")),
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
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
}));
