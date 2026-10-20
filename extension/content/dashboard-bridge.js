// Cầu nối giới hạn cho trang ToolZutter chạy local. Trang web chỉ yêu cầu tiện ích
// chuyển danh tính Page rồi mở bài; mọi thao tác Like/Cảm xúc vẫn do người dùng thực hiện.
(function () {
  if (window.top !== window) return;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const request = event.data;
    if (!request || request.source !== 'TOOLZUTTER_WEB' || !request.requestId) return;
    if (!['PING_ASSISTED_ENGAGEMENT', 'OPEN_PAGE_ENGAGEMENT'].includes(request.action)) return;

    chrome.runtime.sendMessage({
      action: request.action,
      payload: request.payload || {},
    }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      window.postMessage({
        source: 'TOOLZUTTER_EXTENSION',
        requestId: request.requestId,
        response: runtimeError
          ? { success: false, message: runtimeError.message }
          : (response || { success: false, message: 'Tiện ích không phản hồi.' }),
      }, window.location.origin);
    });
  });

  window.postMessage({ source: 'TOOLZUTTER_EXTENSION_READY' }, window.location.origin);
})();
