import webview
import json
import os

# API 클래스: 자바스크립트에서 호출할 파이썬 함수들
class Api:
    def __init__(self):
        # 실행 파일과 같은 위치에 데이터 저장
        self.data_file = os.path.join(os.path.dirname(__file__), "gantt_data.json")

    def save_data(self, data):
        """데이터를 JSON 파일로 저장"""
        try:
            with open(self.data_file, "w", encoding="utf-8") as f:
                f.write(data)
            return {"status": "success"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def load_data(self):
        """저장된 JSON 데이터를 불러오기"""
        if not os.path.exists(self.data_file):
            return None
        try:
            with open(self.data_file, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            print(f"Error loading data: {e}")
            return None

if __name__ == '__main__':
    api = Api()
    
    # 현재 폴더의 Workflow.html 경로 설정
    html_file = os.path.join(os.path.dirname(__file__), "Workflow.html")
    html_url = f"file://{os.path.abspath(html_file)}"

    # 윈도우 생성
    window = webview.create_window(
        'Gantt Manager Pro', 
        url=html_url, 
        js_api=api,
        width=1280, 
        height=800,
        min_size=(800, 600)
    )
    
    # 앱 시작 (debug=True로 설정하면 F12로 개발자 도구 사용 가능)
    webview.start(debug=True)
