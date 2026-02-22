const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 항상 위에 표시 토글
  toggleAlwaysOnTop: () => ipcRenderer.send('toggle-always-on-top'),

  // 현재 항상 위 상태 가져오기
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),

  // 데스크탑 알림 표시
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),

  // 항상 위에 표시 상태 변경 이벤트 수신
  onAlwaysOnTopChanged: (callback) => {
    ipcRenderer.on('always-on-top-changed', (event, value) => callback(value));
  }
});
