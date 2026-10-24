// Edge TTS: giọng tiếng Việt chuẩn, miễn phí, không cần key. Gemini: tốn quota key, giọng đa ngôn ngữ
export const VOICES = [
  {
    label: 'Miễn phí (Microsoft Edge)',
    options: [
      { value: 'vi-VN-NamMinhNeural', label: 'Nam Minh — nam, giọng Bắc' },
      { value: 'vi-VN-HoaiMyNeural:warm', label: 'Hoài My — nữ, trong trẻo, ấm' },
      { value: 'vi-VN-HoaiMyNeural', label: 'Hoài My — nữ, giọng gốc' },
    ],
  },
  {
    label: 'Gemini (cần key AI)',
    options: [
      { value: 'Sulafat', label: 'Sulafat — nữ, ấm áp' },
      { value: 'Achernar', label: 'Achernar — nữ, mềm mại' },
      { value: 'Vindemiatrix', label: 'Vindemiatrix — nữ, dịu dàng' },
      { value: 'Kore', label: 'Kore — nữ, chắc giọng' },
      { value: 'Aoede', label: 'Aoede — nữ, nhẹ nhàng' },
      { value: 'Leda', label: 'Leda — nữ trẻ' },
      { value: 'Zephyr', label: 'Zephyr — nữ, sáng' },
      { value: 'Charon', label: 'Charon — nam, trầm' },
      { value: 'Orus', label: 'Orus — nam, chắc giọng' },
      { value: 'Puck', label: 'Puck — nam, vui' },
      { value: 'Fenrir', label: 'Fenrir — nam, mạnh' },
    ],
  },
];

export const ENGINE_LABEL: Record<string, string> = { edge: 'Edge', gemini: 'Gemini', macos: 'macOS Linh' };
export const isEdgeVoice = (v: string) => v.startsWith('vi-VN-');
