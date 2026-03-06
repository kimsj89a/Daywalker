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
  },

  // 메인 창 열기 (위젯에서 호출)
  openMainWindow: () => ipcRenderer.send('open-main-window'),

  // 로컬 파일 저장/읽기
  loadLocalData: (filename) => ipcRenderer.invoke('load-local-data', filename),
  saveLocalData: (filename, data) => ipcRenderer.invoke('save-local-data', filename, data),
  getDataPath: () => ipcRenderer.invoke('get-data-path')
});
