const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Đọc API Key từ .env hoặc môi trường
let GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
if (!GEMINI_API_KEY) {
  try {
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/GEMINI_API_KEY=([^\r\n]+)/);
      if (match) GEMINI_API_KEY = match[1].trim();
    }
  } catch (e) {}
}

// Cập nhật 2026-10-06: gemini-2.0-* đã bị khai tử, 2.5-flash hay hết quota
const FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
];

/**
 * Mẫu bình luận dự phòng chất lượng cao theo ngành nghề khi không có mạng/API
 */
const NICHE_FALLBACKS = {
  ECONOMY: [
    'Phân tích rất thực tế và sát với thị trường hiện tại 👍',
    'Góc nhìn kinh tế vĩ mô rất sâu sắc, cảm ơn ad đã chia sẻ! 👏',
    'Chuẩn luôn ạ, giai đoạn này quản trị dòng tiền là quan trọng nhất.',
    'Bài viết rất bổ ích, mình đã lưu lại để tham khảo thêm ✨',
    'Nhận định rất khách quan, đúng những điều mình đang băn khoăn ❤️',
    'Cảm ơn thông tin giá trị, hóng các bài phân tích tiếp theo của page ạ!',
    'Thông tin kịp thời quá, đúng lúc thị trường đang có nhiều biến động.',
    'Góc nhìn rất đa chiều, chia sẻ thực sự hữu ích cho anh em làm ăn.',
  ],
  GENERAL: [
    'Bài viết hay và rất ý nghĩa ạ! 👍',
    'Cảm ơn bạn đã chia sẻ thông tin hữu ích này ❤️',
    'Chuẩn không cần chỉnh luôn ạ! 👏',
    'Đã lưu lại khi cần, tuyệt vời quá nè 🌟',
    'Ủng hộ nhiệt tình, chúc trang ngày càng phát triển nhé! 🍀',
    'Quá hay, chia sẻ rất thực tế và dễ hiểu 🥰',
    'Tuyệt vời quá bạn ơi, đúng điều mình đang tìm kiếm ✨',
    'Hóng thêm nhiều bài viết chất lượng như này từ trang ạ!',
  ],
};

/**
 * Gọi Gemini AI tạo danh sách bình luận seeding tự nhiên theo ngữ cảnh
 */
async function generateSeedingComments({
  topic = 'GENERAL',
  postContent = '',
  postUrl = '',
  count = 8,
  tone = 'natural',
} = {}) {
  const safeCount = Math.max(3, Math.min(25, Number(count) || 8));

  if (!GEMINI_API_KEY) {
    console.warn('[AI Seeding] ⚠️ Chưa có GEMINI_API_KEY, sử dụng bộ bình luận tự nhiên dự phòng.');
    const pool = NICHE_FALLBACKS[topic.toUpperCase()] || NICHE_FALLBACKS.GENERAL;
    return pool.slice(0, safeCount);
  }

  const prompt = `Bạn là chuyên gia Seeding mạng xã hội Facebook tại Việt Nam.
Nhiệm vụ của bạn là viết ${safeCount} bình luận (comments) tiếng Việt CỰC KỲ TỰ NHIÊN, chân thực như người dùng thật 100% để tương tác cho bài viết Facebook sau:

${postContent ? `[Nội dung bài viết]:\n${postContent.slice(0, 1500)}\n` : ''}
${postUrl ? `[Link bài viết]: ${postUrl}\n` : ''}
[Chủ đề / Ngành nghề]: ${topic}
[Phong cách]: ${tone} (tự nhiên, đa dạng góc nhìn, có câu hỏi han, có câu đồng tình, có câu khen ngợi, có câu chia sẻ kinh nghiệm).

YÊU CẦU NGHIÊM NGẶT:
1. Đa dạng hóa độ dài: có câu ngắn 5-8 từ, có câu vừa 10-20 từ.
2. Dùng từ ngữ tự nhiên đời thường của người Việt (ạ, nha, nè, nhé, đúng thật, chuẩn luôn, cảm ơn bác, hóng...). Thêm emoji phù hợp nhưng không lạm dụng (1-2 emoji mỗi comment).
3. TUYỆT ĐỐI KHÔNG dùng các từ cấm hay từ của bot: "test", "bot", "tool", "tự động", "auto", "seeding".
4. TUYỆT ĐỐI KHÔNG để số thứ tự, gạch đầu dòng, dấu ngoặc kép hay lời dẫn.
5. Mỗi bình luận nằm trên MỘT DÒNG riêng biệt. CHỈ trả về đúng ${safeCount} dòng bình luận.`;

  for (const model of FALLBACK_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const resp = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            topP: 0.95,
          },
        },
        { timeout: 25000 }
      );

      const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text.trim()) {
        const lines = text
          .split('\n')
          .map((line) => line.replace(/^[\d+.\-•*"\s]+|["\s]+$/g, '').trim())
          .filter((line) => line.length > 3 && !line.toLowerCase().includes('dưới đây'));

        if (lines.length > 0) {
          console.log(`[AI Seeding] ✅ Đã sinh thành công ${lines.length} bình luận bằng model ${model}!`);
          return lines.slice(0, safeCount);
        }
      }
    } catch (err) {
      console.warn(`[AI Seeding] ⚠️ Model ${model} gặp lỗi: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  // Fallback nếu các model đều lỗi
  const pool = NICHE_FALLBACKS[topic.toUpperCase()] || NICHE_FALLBACKS.GENERAL;
  return pool.slice(0, safeCount);
}

module.exports = {
  generateSeedingComments,
};
